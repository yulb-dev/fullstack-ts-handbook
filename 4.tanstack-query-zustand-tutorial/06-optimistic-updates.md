# 第 6 章：乐观更新——先改缓存、失败回滚

> 上一章：[第 5 章 useMutation](./05-mutations.md) | 返回目录：[README](./README.md) | 下一章：[第 7 章 进阶查询模式](./07-advanced-query-patterns.md)

上一章末尾你可能觉得：点「标记完成」要等接口返回、界面才更新，有点卡。**乐观更新（Optimistic Update）** 就是来消灭这个卡顿的：

> **假设这次操作会成功，先立刻更新界面（改缓存），等真正的服务器响应回来再校正；万一失败，就把界面回滚到原样。**

这让「点赞」「勾选完成」「拖拽排序」这类高频操作**感觉是即时的**，是现代应用「跟手感」的关键。TanStack Query 官方提供了两种实现方式，本章都会讲，并重点讨论一个新手常忽视的话题：**并发乐观更新与最终一致性风险**。

## 6.1 两种乐观更新方式

官方文档明确给出两条路：

1. **通过 UI（variables）**：不碰缓存，用 mutation 返回的 `variables` + `isPending` 在界面上临时多渲染一项。简单、代码少、不用处理回滚。
2. **通过缓存（onMutate + setQueryData）**：在 `onMutate` 里直接改查询缓存。多处界面共享同一份数据时，改缓存能自动同步所有地方，但要自己处理回滚。

先看简单的第一种，再重点讲更强大的第二种。

## 6.2 方式一：通过 UI（variables）——最简单

思路：mutation 在 pending 时，`variables`（你传给 `mutate` 的参数）依然可读。于是「正在新增的任务」可以先半透明地渲染在列表末尾，等真的成功后 invalidate 刷新，它就变成正常项。

```tsx
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'

function AddTaskWithUI() {
  const queryClient = useQueryClient()
  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: () => fetchTasks() })

  const addTask = useMutation({
    mutationFn: (title: string) => createTask({ title }),
    // 一定要 return 这个 Promise，让 mutation 保持 pending 到刷新完成
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const { isPending, isError, variables, mutate } = addTask

  return (
    <>
      <ul>
        {tasksQuery.data?.items.map((t) => <li key={t.id}>{t.title}</li>)}
        {/* 乐观渲染：pending 时把"还没确认"的新项以半透明显示 */}
        {isPending && <li style={{ opacity: 0.5 }}>{variables}</li>}
        {/* 失败了可以继续显示它，并提供重试按钮（variables 不会被清空）*/}
        {isError && (
          <li style={{ color: 'red' }}>
            {variables}
            <button onClick={() => mutate(variables)}>重试</button>
          </li>
        )}
      </ul>
      <button onClick={() => mutate('新任务')}>添加</button>
    </>
  )
}
```

要点：

- `variables` 在**失败后也不会被清空**，所以你能显示「这条没提交成功，点这里重试」；
- 如果 mutation 和 query **不在同一个组件**，用 `useMutationState` 配合 `mutationKey` 从别处读到正在进行的 mutation 的 `variables`（它返回数组，因为可能并发多个）。

**优点**：代码最少，**根本不用写回滚逻辑**（pending 一结束，临时项自然消失）。
**局限**：只在「这一个组件、这一处 UI」显示乐观结果。如果屏幕上有多个地方都要反映这次更新，方式二更省心。

## 6.3 方式二：通过缓存（onMutate + setQueryData）——最强大

这是官方主推、也是面试和实战里最能体现功力的方式。核心是 `onMutate` 里的**四步套路**，请务必背下来：

```
onMutate（mutation 开始前）:
  1. cancelQueries  —— 取消正在进行的后台刷新，防止它覆盖我们的乐观结果
  2. getQueryData   —— 给当前缓存拍一张"快照"，留着回滚用
  3. setQueryData   —— 乐观地把缓存改成"假设成功后"的样子
  4. return 快照     —— 把快照返回，它会作为 context 传给 onError/onSettled
onError（失败）:
  5. setQueryData(快照) —— 用快照把缓存回滚到操作前
onSettled（无论成败）:
  6. invalidateQueries —— 重新拉取，让缓存最终对齐服务器真值
```

### 场景 A：更新单个任务（标记完成）

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'

function useOptimisticUpdateTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<Task> }) => updateTask(id, patch),

    onMutate: async ({ id, patch }) => {
      // 1. 取消这条任务相关的、正在进行的后台刷新，别让它覆盖乐观结果
      await queryClient.cancelQueries({ queryKey: ['task', id] })

      // 2. 拍下当前缓存的快照
      const previousTask = queryClient.getQueryData<Task>(['task', id])

      // 3. 乐观更新：把缓存改成"假设成功"的样子
      queryClient.setQueryData<Task>(['task', id], (old) =>
        old ? { ...old, ...patch } : old,
      )

      // 4. 返回快照，供回滚使用
      return { previousTask }
    },

    // 5. 失败：用快照回滚
    onError: (err, variables, context) => {
      if (context?.previousTask) {
        queryClient.setQueryData(['task', variables.id], context.previousTask)
      }
    },

    // 6. 无论成败：重新拉取，让缓存对齐服务器真值
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['task', variables.id] })
    },
  })
}
```

### 场景 B：往列表里新增一项

新增会影响列表缓存 `['tasks']`，乐观更新就是在数组末尾（或开头）先塞一项：

```tsx
function useOptimisticAddTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createTask,

    onMutate: async (newTask) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] })

      const previousTasks = queryClient.getQueryData<TaskPage>(['tasks'])

      // 用一个临时 id（比如负数或时间戳）先占位，成功后会被真数据替换
      const optimisticTask: Task = {
        id: -Date.now(),
        title: newTask.title,
        status: 'todo',
        createdAt: Date.now(),
      }

      queryClient.setQueryData<TaskPage>(['tasks'], (old) =>
        old ? { ...old, items: [optimisticTask, ...old.items] } : old,
      )

      return { previousTasks }
    },

    onError: (err, newTask, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(['tasks'], context.previousTasks)
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}
```

> 用**临时 id**（如 `-Date.now()`）是个常见技巧：它让 React 的 `key` 稳定，成功后 `onSettled` 的 invalidate 会用服务器返回的真实数据整体替换掉乐观数据，临时 id 自然消失。

### 关键细节解读

- **为什么第 1 步要 `cancelQueries`？** 假设你乐观改缓存的同时，正好有个窗口聚焦触发的后台刷新在飞。如果不取消它，它带着**旧数据**回来，会**覆盖**你刚写进去的乐观结果，界面就会「闪一下又变回去」。取消它是乐观更新稳定的前提。
- **为什么要拍快照？** 因为失败时你需要「操作前的样子」才能精确回滚。快照存在 onMutate 的返回值里，通过 context 传给 onError。
- **为什么 onSettled 还要 invalidate？** 因为乐观更新只是「猜」，服务器才是真相。无论成功失败，最后都重新拉一次，让缓存收敛到服务器真值——这就是**最终一致性**的落地：允许短暂不一致，但保证最终对齐。
- **`setQueryData` 的函数式更新**：传 `(old) => newValue` 能拿到当前缓存值，避免你自己去 getQueryData。**注意不要直接改 `old`（要返回新对象）**，保持不可变。

## 6.4 该用哪种方式？

官方给的判断标准很清晰：

| 情况 | 推荐方式 |
| --- | --- |
| 乐观结果只在**一处** UI 显示 | **方式一（variables）**：代码少，不用回滚 |
| 乐观结果要在**多处**共享/反映 | **方式二（改缓存）**：改一处缓存，所有订阅者自动更新 |
| 需要精确回滚到旧值 | 方式二（快照回滚） |
| 只想「假装成功、失败就算了」 | 方式一（pending 结束临时项自动消失） |

对 TaskFlow：「新增任务的输入框旁临时预览」用方式一即可；「勾选完成、拖拽改状态、多处显示同一任务」用方式二。

## 6.5 并发 mutation 与最终一致性风险（重点）

这是乐观更新**最容易出事**、也是新手最容易忽视的部分。请认真读。

### 风险来源：多个乐观更新同时在飞

乐观更新的本质是「先本地猜、后服务器校准」。当**只有一个** mutation 时，这很安全。但真实应用里用户操作很快，可能**连续触发多个 mutation**，它们并行执行、乱序返回。这时：

- 每个 mutation 的 `onMutate` 都在改**同一份缓存**；
- 每个的 `onError` 快照，是**它自己开始那一刻**的缓存——但那一刻的缓存可能已经被**另一个 mutation 改过了**；
- 于是一个 mutation 回滚时，可能把**另一个 mutation 的乐观结果一起抹掉**。

### 一个具体的翻车场景

设想用户快速勾选任务 A 完成、又勾选任务 B 完成，两个 mutation 并行：

```
t0: 缓存 = [A:todo, B:todo]
t1: mutationA.onMutate 拍快照 [A:todo, B:todo]，改缓存 → [A:done, B:todo]
t2: mutationB.onMutate 拍快照 [A:done, B:todo]，改缓存 → [A:done, B:done]
t3: mutationA 请求失败 → onError 用 t1 的快照回滚 → 缓存 = [A:todo, B:todo]
                                          ↑ 糟糕！B 的乐观结果被 A 的回滚连带抹掉了
```

结果：B 明明成功了（或还在飞），界面却因为 A 的回滚而错误地显示 B 未完成。这就是**并发乐观更新的一致性风险**。

### 应对策略

1. **onSettled 一定要 invalidate（兜底）**：无论并发多混乱，最后一次 invalidate 会把缓存重新对齐到服务器真值。这是「最终一致」的安全网——**短暂的错误会被随后的刷新纠正**。所以乐观更新的每个 mutation 都**必须**在 onSettled 里失效相关 query。

2. **用函数式 setQueryData，基于最新缓存改**：`setQueryData(key, (old) => ...)` 里的 `old` 是**调用时刻**的缓存，比你在外面提前算好再 set 更能适应并发（但快照回滚的问题依然在）。

3. **对「同一资源的连续修改」用 scope 串行化**：如果多个 mutation 改的是**同一个东西**（比如同一个任务的状态），让它们并行没有意义还容易冲突。用第 5 章的 `scope.id` 把它们排队：
   ```tsx
   useMutation({
     mutationFn: updateTask,
     scope: { id: 'task-updates' }, // 同 scope 串行，避免并发互相覆盖
     // ... onMutate/onError/onSettled
   })
   ```
   串行后，「拍快照→改缓存→（成功/失败）」是一个完整回合再轮到下一个，翻车场景基本消失。

4. **回滚时用「重新失效」代替「写回快照」更稳妥**：有些团队在 onError 里不写回快照，而是直接 `invalidateQueries` 让服务器说了算。代价是失败时会有一次网络往返、界面可能闪一下，但**不会有并发回滚互相覆盖的问题**。是否用快照回滚，取决于你对「即时回滚」和「并发安全」的权衡。

5. **认识到乐观更新的适用边界**：它最适合**低风险、高频、失败率低**的操作（点赞、勾选、拖拽排序）。对**高风险、有业务校验、可能失败**的操作（提交订单、转账、有复杂权限的编辑），**不要用乐观更新**——老老实实等服务器返回，用 `isPending` 显示 loading，反而是更负责任的设计。

### 一句话总结最终一致性

> 乐观更新让界面「先相信会成功」，`onSettled` 的 invalidate 保证「最终以服务器为准」。中间那段短暂的不一致是可以接受的——**前提是你为并发做好了兜底（invalidate + 必要时 scope 串行）**。没有兜底的乐观更新，就是在赌网络永远成功、用户永远慢慢点。

## 6.6 实战：TaskFlow 的「勾选完成」乐观更新

把上面所学落地成一个可运行的例子，配合 Devtools 观察缓存变化：

```tsx
// src/components/TaskItem.tsx
import { useOptimisticUpdateTask } from '../hooks/useOptimisticUpdateTask'

export function TaskItem({ task }: { task: Task }) {
  const updateTask = useOptimisticUpdateTask() // 6.3 场景 A 的 hook

  const toggleDone = () => {
    updateTask.mutate({
      id: task.id,
      patch: { status: task.status === 'done' ? 'todo' : 'done' },
    })
  }

  return (
    <li>
      <input
        type="checkbox"
        checked={task.status === 'done'}
        onChange={toggleDone}
        // pending 时给个视觉反馈，但不 disabled（乐观更新本就假定成功）
        disabled={false}
      />
      <span style={{ textDecoration: task.status === 'done' ? 'line-through' : 'none' }}>
        {task.title}
      </span>
      {updateTask.isError && <span style={{ color: 'red' }}>（失败，已回滚）</span>}
    </li>
  )
}
```

实验方法：把 Mock API 的 `updateTask` 里临时加一句 `maybeFail(1)`（让它 100% 失败），点勾选框，你会看到——**勾选状态立刻变了（乐观更新），紧接着又弹回原样（onError 回滚），并显示「失败，已回滚」**。这就是「先改缓存、失败回滚」的完整闭环。

## 本章小结与自检

- [ ] 能说出乐观更新的定义：先假设成功改界面、后按服务器结果校正、失败则回滚；
- [ ] 知道两种方式：**variables（UI，简单不用回滚）** 与 **onMutate+setQueryData（改缓存，多处共享）**，并能按场景选择；
- [ ] 背得出改缓存方式的四步套路：cancelQueries → 拍快照 → setQueryData → return 快照；
- [ ] 知道 onError 用快照回滚、onSettled 用 invalidate 兜底对齐真值；
- [ ] 理解为什么要先 `cancelQueries`（防止后台刷新覆盖乐观结果）；
- [ ] **能解释并发乐观更新的翻车场景**（一个 mutation 的回滚可能抹掉另一个的乐观结果）；
- [ ] 知道应对手段：onSettled 必须 invalidate、必要时用 scope 串行、高风险操作不要用乐观更新；
- [ ] 理解「最终一致性」：允许短暂不一致，但保证最终对齐服务器。

下一章，我们扩展查询的花样：分页、无限滚动、依赖查询、预取与后台刷新。

---

> 上一章：[第 5 章 useMutation](./05-mutations.md) | 返回目录：[README](./README.md) | 下一章：[第 7 章 进阶查询模式](./07-advanced-query-patterns.md)
