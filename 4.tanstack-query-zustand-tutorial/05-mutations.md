# 第 5 章：修改数据——useMutation 与失效联动

> 上一章：[第 4 章 缓存生命周期](./04-cache-lifecycle.md) | 返回目录：[README](./README.md) | 下一章：[第 6 章 乐观更新](./06-optimistic-updates.md)

`useQuery` 负责「读」，`useMutation` 负责「写」——创建、更新、删除，或任何会在服务器上产生副作用的操作。这一章讲透 mutation 的生命周期、成功之后如何失效相关缓存、如何取消请求、以及重试与错误处理。

## 5.1 useMutation 基础

一个最简单的 mutation——新增任务：

```tsx
import { useMutation } from '@tanstack/react-query'
import { createTask } from './api/mockApi'

function NewTaskForm() {
  const mutation = useMutation({
    // mutationFn：接收"变量"，返回 Promise。通常是一个 POST/PUT/DELETE
    mutationFn: (newTask: { title: string }) => createTask(newTask),
  })

  return (
    <div>
      {/* mutation 的状态驱动 UI */}
      {mutation.isPending ? (
        '正在新增…'
      ) : (
        <>
          {mutation.isError && <div>出错了：{mutation.error.message}</div>}
          {mutation.isSuccess && <div>新增成功！</div>}
          <button onClick={() => mutation.mutate({ title: '写周报' })}>
            创建任务
          </button>
        </>
      )}
    </div>
  )
}
```

关键区别（对比 useQuery）：

- `useQuery` 在组件挂载时**自动**执行；`useMutation` **不会自动执行**，要你调用 `mutation.mutate(变量)` 才触发；
- `mutate` 接收**一个**变量（可以是单值或对象），这个变量会传给 `mutationFn`。

## 5.2 mutation 的生命周期与四种状态

一个 mutation 在任意时刻只处于以下四种状态之一：

- `isIdle`（`status === 'idle'`）：初始/刚 reset 的空闲态；
- `isPending`（`status === 'pending'`）：正在执行；
- `isError`（`status === 'error'`）：失败，`error` 里是错误；
- `isSuccess`（`status === 'success'`）：成功，`data` 里是服务器返回的结果。

生命周期图：

```
idle ──mutate()──▶ pending ──成功──▶ success
                     │
                     └──失败──▶ error
   （调用 reset() 可从 success/error 回到 idle）
```

## 5.3 生命周期回调：onMutate / onError / onSuccess / onSettled

`useMutation` 提供四个回调，让你在生命周期的各个阶段插入副作用。这是 mutation 真正的威力所在：

```tsx
useMutation({
  mutationFn: addTask,
  onMutate: (variables) => {
    // mutation 即将开始（在 mutationFn 之前）。
    // 可返回一个"上下文"值，之后会传给 onError/onSuccess/onSettled。
    // 乐观更新就在这里改缓存（第 6 章详解）。
    return { id: 1 }
  },
  onError: (error, variables, context) => {
    // 失败了。context 就是 onMutate 返回的值 —— 通常在这里回滚。
    console.log('回滚乐观更新', context)
  },
  onSuccess: (data, variables, context) => {
    // 成功了。data 是服务器返回结果 —— 通常在这里失效相关 query。
  },
  onSettled: (data, error, variables, context) => {
    // 无论成功还是失败都会执行（类似 finally）。
  },
})
```

**执行顺序**：`onMutate` → （mutationFn 执行）→ `onSuccess` 或 `onError` → `onSettled`。

如果回调返回 Promise，下一个回调会**等它 resolve 后再执行**。这很重要：在 `onSuccess` 里 `return queryClient.invalidateQueries(...)`（返回 Promise），能让 mutation 一直保持 pending，直到重新拉取的数据到位——避免界面出现「短暂闪烁旧数据」。

> **v5 最新签名提醒**：TanStack Query 最新版本给这些回调增加了参数。`onMutate` 现在能收到第二个参数 `context`（含 `context.client` 即 QueryClient），而 onMutate 的返回值在后续回调里以 `onMutateResult` 之名作为**倒数第二个参数**传入，最后再跟一个含 `client` 的 `context`。也就是新写法形如 `onError: (err, variables, onMutateResult, context) => context.client.setQueryData(...)`。本教程为稳妥和通用，采用经典写法——用 `useQueryClient()` 拿到 client、用第三个参数接收 onMutate 的返回值。两种写法都能工作，你读到最新官方文档时不会困惑。

## 5.4 核心模式：成功后失效相关 query

这是 mutation 与 query 协作的**最重要模式**，请务必掌握。

问题的本质：你新增了一个任务，服务器上任务列表变了，但 TanStack Query 缓存里那份 `['tasks']` 还是旧的。**怎么让界面更新？**

答案：在 `onSuccess`（或 `onSettled`）里调用 `invalidateQueries`，把相关 query 标记为过期并重新拉取。

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'

function NewTaskForm() {
  const queryClient = useQueryClient() // 从 Context 拿到全局 client

  const mutation = useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      // 新增成功后，让所有 ['tasks'] 开头的缓存失效并刷新
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

  return <button onClick={() => mutation.mutate({ title: '新任务' })}>新增</button>
}
```

**为什么第 3、4 章一直强调 query key 的组织方式？** 就在这里兑现了：因为新增任务会影响**所有**任务列表（全部/待办/进行中/已完成、各分页），而它们的 key 都以 `['tasks', ...]` 开头，所以一句 `invalidateQueries({ queryKey: ['tasks'] })` 就能全部刷新。这就是「精准失效」的力量。

### onSuccess vs onSettled：该用哪个？

- 大多数「改了数据要刷新列表」的场景，用 `onSuccess` 即可；
- 如果你希望**无论成功失败都刷新**（比如乐观更新后要把界面拉回服务器真值），用 `onSettled`。第 6 章的乐观更新会用 `onSettled` 做兜底刷新。
- 记得 `return` 那个 Promise，让 mutation 等到刷新完成：
  ```tsx
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  //     ↑ 返回 Promise，mutation 会保持 pending 直到重新拉取完成
  ```

### 另一种选择：直接用返回数据更新缓存

如果服务器返回了完整的最新数据，你也可以不重新请求，而是直接把数据写进缓存（`setQueryData`），省一次网络往返：

```tsx
onSuccess: (newTask) => {
  queryClient.setQueryData(['task', newTask.id], newTask) // 更新单条详情缓存
  queryClient.invalidateQueries({ queryKey: ['tasks'] }) // 列表仍需刷新（顺序/分页可能变）
}
```

`setQueryData` vs `invalidateQueries` 的取舍：**前者是「我确信这份数据就是最新的，直接写进缓存」，后者是「让 TanStack Query 重新去问服务器要」。** 列表类数据通常用 invalidate（因为排序、分页、总数都可能变），单条详情若服务器原样返回则可用 setQueryData。

## 5.5 mutate vs mutateAsync

两者都触发 mutation，区别在返回值：

- **`mutate(variables)`**：无返回值（`void`），**不会抛错**。错误通过 `onError` / `mutation.error` 处理。适合放在事件回调里。
- **`mutateAsync(variables)`**：返回 Promise，**成功 resolve、失败 reject（抛错）**。适合需要 `await` 结果或 `try/catch` 串联后续逻辑：

```tsx
const mutation = useMutation({ mutationFn: createTask })

async function handleSubmit() {
  try {
    const task = await mutation.mutateAsync({ title: '写周报' })
    console.log('拿到服务器返回的新任务', task)
    // 可以继续 await 别的操作……
  } catch (error) {
    console.error('失败了', error)
  }
}
```

> ⚠️ 用 `mutateAsync` 时**务必处理 rejection**（try/catch 或 .catch），否则会出现「未捕获的 Promise 异常」警告。绝大多数 UI 场景用 `mutate` 更省心。

## 5.6 组件级回调 vs hook 级回调

除了写在 `useMutation` 里的回调，你还能在**调用 `mutate` 时**传入组件专属的回调：

```tsx
mutation.mutate(
  { title: '新任务' },
  {
    onSuccess: () => {
      // 这是"这个组件、这次调用"专属的成功回调，在 hook 级 onSuccess 之后执行
      navigate('/tasks') // 比如成功后跳转
    },
  },
)
```

一个重要区别（官方特别指出）：

- **hook 级回调**（写在 `useMutation` 里）：**每次** `mutate` 都会执行，且**即使组件卸载了也会执行**——适合放「失效缓存」这类与组件无关的逻辑；
- **mutate 级回调**（写在 `mutate` 调用里）：如果组件在 mutation 完成**前卸载了，就不会执行**——适合放「跳转、弹 toast」这类依赖组件还活着的逻辑。

这个区分能避免一类隐蔽 bug：把 `navigate` 放进 hook 级 onSuccess，结果组件已经卸载导致跳转异常。

## 5.7 reset：清空 mutation 状态

mutation 成功后会一直停在 `isSuccess`（错误会停在 `isError`）。有时你想把它清回初始的 `idle`（比如关掉表单、清除错误提示），用 `reset()`：

```tsx
const mutation = useMutation({ mutationFn: createTask })

// 点击错误提示就清除它
{mutation.error && (
  <p onClick={() => mutation.reset()}>
    出错了：{mutation.error.message}（点我清除）
  </p>
)}
```

## 5.8 取消请求：AbortSignal 与 cancelQueries

「取消请求」在服务端状态里是个真需求：用户快速切换筛选，上一个还没回来的请求就该被取消，否则可能「后发的请求先回来，覆盖了新数据」（竞态）。

### queryFn 里的 signal（查询取消）

TanStack Query 给每个 queryFn 传入一个 `AbortSignal`（就是 3.2 讲的 `QueryFunctionContext.signal`）。**当查询过期或不活跃时，这个 signal 会被 abort。** 你只要把它传给 `fetch`，就能实现自动取消：

```tsx
useQuery({
  queryKey: ['tasks', { status }],
  queryFn: async ({ signal }) => {
    const res = await fetch(`/api/tasks?status=${status}`, { signal }) // ← 传入 signal
    if (!res.ok) throw new Error('请求失败')
    return res.json()
  },
})
```

**默认行为要点**：默认情况下，一个 query 在 Promise resolve 前被卸载/弃用时**并不会主动取消**——resolve 后数据照样进缓存（这样你切回来还能用上）。但**只要你消费了 `signal`**，请求就会真正被中断，对应 query 的状态也会回退到之前的样子。axios、graphql-request 等也都支持传入 signal。

### cancelQueries：手动取消

你也可以主动取消某些查询（比如乐观更新前，先取消正在进行的后台刷新，防止它覆盖你的乐观结果——第 6 章会用到）：

```tsx
const queryClient = useQueryClient()

// 取消所有 tasks 相关的、正在进行的请求
await queryClient.cancelQueries({ queryKey: ['tasks'] })

// 手动取消按钮
<button onClick={() => queryClient.cancelQueries({ queryKey: ['tasks'] })}>
  取消加载
</button>
```

`cancelQueries` 支持 `silent`（不把 CancelledError 传给 onError）和 `revert`（把状态回退到请求前）等选项。

> 注意：取消**对 Suspense 版 hooks**（`useSuspenseQuery` 等）无效，这是官方明确的限制。

## 5.9 重试与错误处理

### mutation 默认不重试

和 query（默认重试 3 次）不同，**mutation 默认 `retry: 0`，即失败不重试**。这很合理——重复提交一个「创建订单」可能造成重复下单。但你也能显式开启：

```tsx
const mutation = useMutation({
  mutationFn: createTask,
  retry: 3, // 失败重试 3 次
})
```

一个有用的默认行为：**如果 mutation 因为设备离线而失败，当设备重新联网时，它们会按原来的顺序自动重试**（离线队列，配合 `persistQueryClient` 可做离线优先应用）。

### 错误处理三处下手

1. **`mutation.error` / `isError`**：在 UI 上展示错误；
2. **`onError` 回调**：做副作用，比如弹全局 toast、上报日志、回滚乐观更新；
3. **`mutate` 的第二个参数里的 `onError`**：组件专属的错误处理。

```tsx
const mutation = useMutation({
  mutationFn: createTask,
  onError: (error) => {
    toast.error(`新增失败：${error.message}`) // 全局提示
  },
})
```

### 并发与顺序：mutation scope

默认情况下，**所有 mutation 都是并行执行的**——即使你多次调用同一个 mutation 的 `mutate`。如果你需要**串行**（一个接一个，避免并发冲突），可以给 mutation 一个 `scope.id`，相同 scope 的 mutation 会排队：

```tsx
const mutation = useMutation({
  mutationFn: updateTask,
  scope: { id: 'task-updates' }, // 同 id 的 mutation 串行执行
})
```

关于**连续调用**的一个坑（官方特别指出）：当你循环调用 `mutate` 并在每次调用里传组件级 `onSuccess`，那个组件级回调**只会为最后一次 mutate 触发一次**（因为 observer 每次 mutate 都会重新订阅）；而 hook 级的 `onSuccess` 会为**每次** mutate 都触发。且因为 `mutationFn` 是异步的，**完成的顺序可能和调用顺序不一致**——这直接关系到第 6 章要讲的「并发 mutation 与最终一致性」。

## 5.10 实战：TaskFlow 的完整增删改

把本章知识合成一套 TaskFlow 的 mutations。注意每个都在 `onSuccess`/`onSettled` 里失效相关缓存：

```tsx
// src/hooks/useTaskMutations.ts
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createTask, updateTask, deleteTask } from '../api/mockApi'

export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] }) // 刷新所有列表
    },
  })
}

export function useUpdateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<{ title: string; status: string }> }) =>
      updateTask(id, patch as any),
    onSuccess: (task) => {
      // 详情可直接写缓存，列表则失效刷新
      queryClient.setQueryData(['task', task.id], task)
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', task.id] })
    },
  })
}

export function useDeleteTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteTask,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.removeQueries({ queryKey: ['task', variables.id] }) // 详情缓存直接移除
    },
  })
}
```

在组件里用起来非常干净：

```tsx
function TaskItem({ task }: { task: Task }) {
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()

  return (
    <li>
      [{task.status}] {task.title}
      <button onClick={() => updateTask.mutate({ id: task.id, patch: { status: 'done' } })}>
        标记完成
      </button>
      <button onClick={() => deleteTask.mutate(task.id)}>删除</button>
      {updateTask.isPending && <small>保存中…</small>}
    </li>
  )
}
```

点「标记完成」，你会看到：按钮旁出现「保存中…」，几百毫秒后列表自动刷新（因为 onSuccess 里 invalidate 了）。到这一步，一个「能用」的增删改查已经成型。但你可能觉得「等接口返回才更新界面」有点卡——这正是下一章**乐观更新**要解决的。

## 本章小结与自检

- [ ] 知道 `useMutation` 不自动执行，要调用 `mutate(variables)` 触发；
- [ ] 说得出 mutation 的四态（idle/pending/error/success）和四个回调（onMutate/onError/onSuccess/onSettled）的执行顺序；
- [ ] 掌握核心模式：**在 onSuccess/onSettled 里 `invalidateQueries` 失效相关缓存**，并记得 `return` 那个 Promise；
- [ ] 分得清 `setQueryData`（直接写缓存）和 `invalidateQueries`（重新拉取）该在什么时候用；
- [ ] 分得清 `mutate`（不抛错）和 `mutateAsync`（返回 Promise，要处理 rejection）；
- [ ] 知道 hook 级回调即使组件卸载也执行、mutate 级回调组件卸载后不执行；
- [ ] 会用 `reset()` 清空 mutation 状态；
- [ ] 理解取消：queryFn 消费 `signal` 才能真正中断，`cancelQueries` 可手动取消；
- [ ] 知道 **mutation 默认不重试**，会用 `scope.id` 让 mutation 串行。

下一章，我们让界面「不等接口」——乐观更新：先改缓存、失败回滚，并正视并发带来的最终一致性风险。

---

> 上一章：[第 4 章 缓存生命周期](./04-cache-lifecycle.md) | 返回目录：[README](./README.md) | 下一章：[第 6 章 乐观更新](./06-optimistic-updates.md)
