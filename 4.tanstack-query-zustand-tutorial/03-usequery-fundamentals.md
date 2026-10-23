# 第 3 章：TanStack Query 基础——useQuery 深入

> 上一章：[第 2 章 环境搭建](./02-setup-first-request.md) | 返回目录：[README](./README.md) | 下一章：[第 4 章 缓存生命周期](./04-cache-lifecycle.md)

上一章我们跑通了第一个 `useQuery`。这一章把它的每个零件拆开看清楚：`queryFn` 到底能写什么、query key 的结构规则、`status` 和 `fetchStatus` 为什么要分成两个维度、以及错误处理的正确姿势。

`useQuery` 的最小签名是「**一个唯一的 key + 一个返回 Promise 的函数**」：

```tsx
const result = useQuery({
  queryKey: ['tasks'],       // 这份数据的唯一身份证
  queryFn: fetchTasks,       // 怎么拿到这份数据
})
```

`result` 里装着你需要的一切：数据、状态、错误、以及控制刷新的方法。下面逐个讲。

## 3.1 queryFn：任何「返回 Promise」的函数

官方定义：**query function 可以是任何返回 Promise 的函数，这个 Promise 要么 resolve 出数据，要么 throw 一个错误。** 以下写法都合法：

```tsx
useQuery({ queryKey: ['tasks'], queryFn: fetchAllTasks })
useQuery({ queryKey: ['task', id], queryFn: () => fetchTask(id) })
useQuery({
  queryKey: ['task', id],
  queryFn: async () => {
    const data = await fetchTask(id)
    return data
  },
})
// 甚至可以直接从 queryKey 里取参数（见 3.2）
useQuery({ queryKey: ['task', id], queryFn: ({ queryKey }) => fetchTask(queryKey[1]) })
```

它可以用 `fetch`、`axios`、`graphql-request`、甚至一个 `Promise.resolve(假数据)`。TanStack Query **不关心你内部怎么请求**，只关心你最终 resolve 出什么、或 throw 出什么。这带来一个巨大好处：**你的组件代码和「数据从哪来、怎么来」彻底解耦**。

### 三条硬性规则

1. **resolve 的值不能是 `undefined`。** 官方明确规定：resolve 成 `undefined` 会被当作**失败**。如果你想表达「成功，但没有数据」，请 resolve `null`。
   ```tsx
   // ❌ 会被当成失败
   queryFn: () => undefined
   // ✅ 表示"成功但为空"
   queryFn: () => null
   ```
2. **要报错就必须 `throw` 或返回 rejected Promise。** query 是否出错，完全取决于 queryFn 有没有抛出：
   ```tsx
   queryFn: async () => {
     if (somethingWrong) throw new Error('出错了')  // 这样 result.isError 才会是 true
     return data
   }
   ```
3. **`fetch` 默认不会 throw，必须自己检查 `response.ok`。** 这是新手最常踩的坑：`axios`/`graphql-request` 遇到非 2xx 会自动抛错，但原生 `fetch` 只在「网络层彻底失败」时才 reject，HTTP 404/500 **它照样 resolve**！所以用 fetch 时必须手动抛：
   ```tsx
   queryFn: async () => {
     const res = await fetch('/api/tasks')
     if (!res.ok) throw new Error(`请求失败：${res.status}`)  // ← 关键，别忘
     return res.json()
   }
   ```
   > 我们的 Mock API 在函数内部自己 `throw`，所以不受这条影响；但当你换成真实 `fetch` 时，务必补上 `if (!res.ok) throw`。

## 3.2 query key：缓存的身份证，也是 queryFn 的依赖

query key 是 TanStack Query 一切缓存行为的地基。**它必须是一个数组**（顶层），可以简单到只有一个字符串，也可以复杂到嵌套对象，只要满足两点：能被 `JSON.stringify` 序列化、且**唯一地描述这份数据**。

### 简单 key：常量数组

适合列表/索引类、非层级资源：

```tsx
useQuery({ queryKey: ['tasks'], ... })          // 任务列表
useQuery({ queryKey: ['currentUser'], ... })     // 当前用户
```

### 带变量的 key：数组里放参数

当一份数据需要更多信息才能唯一确定时（比如「第 5 个任务」「状态为 done 的任务列表」），把变量放进 key：

```tsx
useQuery({ queryKey: ['task', 5], ... })                    // id 为 5 的任务
useQuery({ queryKey: ['task', 5, { preview: true }], ... }) // 带额外选项
useQuery({ queryKey: ['tasks', { status: 'done' }], ... })  // 已完成的任务列表
```

**约定俗成的组织方式**：第一个元素是「资源名」（复数），后面跟「标识符」，再跟「查询参数对象」。这样失效时（第 4 章）可以用前缀批量匹配。

### key 是「确定性哈希」的——但数组顺序敏感

TanStack Query 会把 key 做**确定性哈希**，所以**对象里键的顺序无所谓**，下面三个 key 被视为**完全相同**：

```tsx
useQuery({ queryKey: ['tasks', { status, page }], ... })
useQuery({ queryKey: ['tasks', { page, status }], ... })              // 键顺序不同 → 相同
useQuery({ queryKey: ['tasks', { page, status, other: undefined }], ... }) // 多个 undefined 键 → 相同
```

但是**数组元素的顺序是敏感的**，下面三个 key **互不相同**：

```tsx
useQuery({ queryKey: ['tasks', status, page], ... })
useQuery({ queryKey: ['tasks', page, status], ... })      // 顺序不同 → 不同！
useQuery({ queryKey: ['tasks', undefined, page, status], ... })
```

> **实践建议**：把「会变的查询参数」统一塞进一个对象里当 key 的最后一个元素（如 `['tasks', { status, page, sort }]`），这样既不受对象键顺序影响，也方便整体失效。

### 黄金法则：queryFn 依赖的每个「会变的变量」，都必须出现在 key 里

这是本章最重要的一句话，也是官方文档反复强调的：

> **如果你的 queryFn 用到了某个变量，就把这个变量放进 query key。**

原因：**query key 是 queryFn 的依赖**。key 变了，TanStack Query 才会认为「这是另一份数据」，从而重新请求、独立缓存。看这个例子：

```tsx
function TaskDetail({ taskId }: { taskId: number }) {
  const result = useQuery({
    queryKey: ['task', taskId],          // ← taskId 进了 key
    queryFn: () => fetchTask(taskId),    // ← queryFn 用到 taskId
  })
  // 当 taskId 从 5 变成 6，key 变了 → 自动重新请求 → 缓存两份独立数据
}
```

如果把 `taskId` 漏在 key 外面：

```tsx
// ❌ 灾难：taskId 变了，但 key 还是 ['task']，不会重新请求，界面还显示旧任务
useQuery({ queryKey: ['task'], queryFn: () => fetchTask(taskId) })
```

这条规则在第 7 章的分页、筛选、依赖查询里会反复用到，请刻进 DNA：**「影响结果的变量」= 「必须进 key 的变量」**。

> TanStack Query 官方还提供了 ESLint 规则 `@tanstack/eslint-plugin-query`（含 `exhaustive-deps`），能自动检查你的 key 是否漏了 queryFn 用到的变量，强烈建议在项目里启用。

### queryFn 能拿到 key：QueryFunctionContext

queryFn 被调用时，会收到一个上下文对象 `QueryFunctionContext`，里面有：

| 字段 | 含义 |
| --- | --- |
| `queryKey` | 当前查询的 key（可从中解构出参数） |
| `client` | 当前的 QueryClient 实例 |
| `signal` | `AbortSignal`，用于取消请求（第 5 章详解） |
| `meta` | 你自定义的附加信息（可选） |
| `pageParam` | 仅无限查询有，当前页的游标（第 7 章） |

所以你可以让 queryFn 直接从 key 里取参数，实现「key 与函数解耦」：

```tsx
function fetchTask({ queryKey }: { queryKey: ['task', number] }) {
  const [, id] = queryKey
  return api.fetchTask(id)
}

useQuery({ queryKey: ['task', 5], queryFn: fetchTask }) // fetchTask 从 key 里读到 5
```

## 3.3 status 与 fetchStatus：两个正交的维度

新手最容易困惑的地方：`useQuery` 返回的 `result` 里，为什么既有 `isPending` 又有 `isFetching`？它俩不是一回事吗？

**不是。** TanStack Query 用两个独立的维度来描述一个查询：

### 维度一：`status`——「关于数据」的状态

一个查询在任意时刻只处于以下三种 `status` 之一：

- `isPending`（`status === 'pending'`）：**还没有任何数据**（首次加载，缓存里没有）；
- `isError`（`status === 'error'`）：**出错了**，`error` 属性里是错误对象；
- `isSuccess`（`status === 'success'`）：**有数据可用**，`data` 属性里就是数据。

记忆口诀：**`status` 回答的是「我手上有没有数据？」**

### 维度二：`fetchStatus`——「关于请求」的状态

- `fetchStatus === 'fetching'`：queryFn **正在执行**（不管是首次还是后台刷新）；
- `fetchStatus === 'paused'`：想请求但被暂停了（比如断网，见网络模式）；
- `fetchStatus === 'idle'`：此刻没有在请求。

记忆口诀：**`fetchStatus` 回答的是「queryFn 现在跑没跑？」**

### 为什么要分两个维度？因为「后台刷新」的存在

关键在于：**一个查询可以「已经有数据」（success），同时又在「后台重新请求」（fetching）。** 这就是 stale-while-revalidate：先把缓存里的旧数据显示出来，同时后台拉新数据。两个维度组合出所有可能：

| 场景 | status | fetchStatus | isPending | isFetching |
| --- | --- | --- | --- | --- |
| 首次加载，无缓存，正在请求 | pending | fetching | ✅ | ✅ |
| 首次加载，无缓存，但断网暂停 | pending | paused | ✅ | ❌ |
| 已有缓存数据，空闲 | success | idle | ❌ | ❌ |
| 已有缓存数据，后台刷新中 | success | fetching | ❌ | ✅ |
| 请求出错 | error | idle | ❌ | ❌ |

所以：

- **`isPending`**：用来决定「要不要显示整页 loading 骨架/转圈」——只在**完全没有数据**时为 true；
- **`isFetching`**：用来决定「要不要显示一个不打断用户的小指示器」（比如标题旁一个转圈、按钮 disabled）——**任何时候只要在请求**就为 true。

把这两者搞混，是「明明有数据却整页闪 loading」这类体验问题的根源。看正确用法：

```tsx
const { data, isPending, isError, error, isFetching } = useQuery({ ... })

if (isPending) return <FullPageSpinner />   // 只有"完全没数据"才整页 loading
if (isError) return <ErrorBox error={error} />

// 有数据就渲染，即使正在后台刷新也不打断用户
return (
  <>
    {isFetching && <SubtleSpinner />}  {/* 角落里的小提示，不遮挡内容 */}
    <TaskList data={data} />
  </>
)
```

## 3.4 标准三态渲染模式

官方推荐的处理顺序：**先判 `isPending`，再判 `isError`，剩下的就是 `isSuccess`**。这样写不仅清晰，TypeScript 还能自动帮你收窄 `data` 的类型（判完前两个后，`data` 不再是 `undefined`）：

```tsx
function TaskList({ status }: { status: TaskStatus }) {
  const { isPending, isError, data, error } = useQuery({
    queryKey: ['tasks', { status }],
    queryFn: () => fetchTasks({ status }),
  })

  if (isPending) return <span>加载中…</span>
  if (isError) return <span>错误：{error.message}</span>

  // 到这里 isSuccess === true，data 一定存在，TS 也不会报错
  return (
    <ul>
      {data.items.map((task) => (
        <li key={task.id}>{task.title}</li>
      ))}
    </ul>
  )
}
```

如果你更喜欢用 `status` 字符串判断也完全可以（`status === 'pending'` / `'error'` / `'success'`），效果等价。

### 别用 `isLoading` 了（v5 变化提醒）

TanStack Query v4 里有个 `isLoading`，v5 里它被重新定义为 `isPending && isFetching`（首次加载且正在请求）。**新代码请直接用 `isPending` 表示「无数据」，用 `isFetching` 表示「正在请求」**，语义更清晰，也不会被旧教程带偏。

## 3.5 错误处理：从「抛出」到「展示」

把 3.1 的规则串起来，错误处理的完整链路是：

```
queryFn 里 throw / reject
      ↓
TanStack Query 捕获，写入 result.error，status 变成 'error'
      ↓（默认还会先自动重试几次，见第 4/8 章）
组件里 if (isError) 渲染错误 UI
```

几个实践要点：

1. **错误类型建议统一。** 默认 `error` 是 `Error` 类型。你可以在 `QueryClient` 里通过泛型统一错误类型（比如后端的 `{ code, message }`），让全应用的 `error` 结构一致；
2. **区分「该重试的」和「不该重试的」错误。** 网络抖动、5xx 值得重试；404、400（参数错误）重试也没用。第 4、8 章讲 `retry` 时可以传一个函数按错误类型决定是否重试；
3. **给用户可操作的错误 UI**，而不是光秃秃一句「出错了」。至少提供「重试」按钮：
   ```tsx
   const { isError, error, refetch } = useQuery({ ... })
   if (isError) {
     return (
       <div>
         <p>加载失败：{error.message}</p>
         <button onClick={() => refetch()}>重试</button>
       </div>
     )
   }
   ```
   `refetch()` 是 `useQuery` 返回的方法，手动重新请求（第 4 章详讲）。

## 3.6 把三章知识合起来：TaskFlow 的任务列表

用本章所学，把第 2 章的 `App.tsx` 升级成一个「按状态筛选」的列表。注意 **status 这个变量同时进了 key 和 queryFn**（黄金法则），并且用了 `isFetching` 做不打断的后台刷新提示：

```tsx
// src/App.tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchTasks, type TaskStatus } from './api/mockApi'

const FILTERS: Array<TaskStatus | 'all'> = ['all', 'todo', 'doing', 'done']

export default function App() {
  // 注意：这个 filter 此刻还只是"组件局部状态"，第 9 章我们会把它挪进 Zustand
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all')

  const { data, isPending, isError, error, isFetching } = useQuery({
    queryKey: ['tasks', { status: filter }], // ← filter 进了 key
    queryFn: () => fetchTasks({ status: filter, page: 0, pageSize: 8 }), // ← 也进了 queryFn
  })

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>TaskFlow {isFetching && <small>（刷新中…）</small>}</h1>

      <nav>
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{ fontWeight: filter === f ? 'bold' : 'normal', marginRight: 8 }}
          >
            {f}
          </button>
        ))}
      </nav>

      {isPending ? (
        <p>加载中…</p>
      ) : isError ? (
        <p style={{ color: 'red' }}>
          出错了：{error.message} <button onClick={() => {}}>重试</button>
        </p>
      ) : (
        <ul>
          {data.items.map((t) => (
            <li key={t.id}>[{t.status}] {t.title}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

试着切换筛选按钮，同时开着 Devtools 观察：每切换一个 filter，就出现一条**新的 query**（key 不同），各自独立缓存。切回之前看过的 filter，会**立刻**显示上次的缓存数据（不再转圈），同时后台刷新。这个「切走再切回不 loading」的现象，就是缓存的功劳——下一章我们把它背后的 `staleTime`/`gcTime` 机制彻底讲清楚。

> 观察点：切换 filter 时，第一次是 `isPending`（整页 loading），但**第二次切回同一个 filter** 时，因为缓存里已有数据，直接是 `isSuccess` + `isFetching`（有内容 + 小转圈）。亲眼看到这个差别，你就真正理解了 `status` 和 `fetchStatus` 为什么要分开。

## 本章小结与自检

- [ ] 知道 queryFn 是「任何返回 Promise 的函数」，且 resolve `undefined` 会被当作失败（要空值请 resolve `null`）；
- [ ] 用 `fetch` 时记得 `if (!res.ok) throw`，否则 HTTP 错误不会触发 `isError`；
- [ ] 能说出 query key 必须是数组、对象键顺序不影响、数组顺序影响；
- [ ] 牢记黄金法则：**queryFn 用到的每个会变变量都必须进 query key**；
- [ ] 分得清 `status`（有没有数据：pending/error/success）和 `fetchStatus`（queryFn 跑没跑：fetching/paused/idle）；
- [ ] 会用 `isPending` 控制整页 loading、用 `isFetching` 控制不打断的小提示；
- [ ] 会写标准的三态渲染，并给出带「重试」按钮的错误 UI。

下一章进入分水岭：缓存的**新鲜度**（staleTime）和**垃圾回收**（gcTime），以及数据什么时候会自动刷新、什么时候需要你手动失效。

---

> 上一章：[第 2 章 环境搭建](./02-setup-first-request.md) | 返回目录：[README](./README.md) | 下一章：[第 4 章 缓存生命周期](./04-cache-lifecycle.md)
