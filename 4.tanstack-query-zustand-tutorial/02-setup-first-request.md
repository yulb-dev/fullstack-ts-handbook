# 第 2 章：环境搭建——跑通第一个请求

> 上一章：[第 1 章 两种状态](./01-two-kinds-of-state.md) | 返回目录：[README](./README.md) | 下一章：[第 3 章 useQuery 深入](./03-usequery-fundamentals.md)

本章目标：亲手搭一个 React + TypeScript 项目，装好 TanStack Query、Zustand 和 Devtools，写一个**带网络延迟的 Mock API**（贯穿全书），并跑通第一个 `useQuery`。你会立刻看到它和手写 `useEffect + fetch` 的差别。

## 2.1 先理解我们要搭什么

一个学习服务端状态管理的项目，**最忌讳「请求瞬间返回、永不失败」**——那样你根本体会不到 loading、缓存、重试的意义。所以我们要故意造一个「像真网络一样」的假后端：有延迟、会分页、偶尔能出错。

整体结构预览：

```
taskflow/
├─ src/
│  ├─ api/
│  │  └─ mockApi.ts        # 内存假后端（延迟、分页、增删改查）
│  ├─ main.tsx             # 入口：挂载 QueryClientProvider
│  ├─ queryClient.ts       # 全局唯一的 QueryClient 实例
│  └─ App.tsx              # 第一个 useQuery 页面
├─ index.html
└─ vite.config.ts
```

## 2.2 创建项目并安装依赖

用 Vite 创建 React + TypeScript 项目（官方推荐、启动最快）：

```bash
npm create vite@latest taskflow -- --template react-ts
cd taskflow
npm install
```

安装本教程的三个核心依赖：

```bash
# TanStack Query 核心 + Zustand
npm install @tanstack/react-query zustand

# Devtools：强烈建议装，学习期它是你的"透视眼"（只在开发环境打包）
npm install -D @tanstack/react-query-devtools
```

> 版本说明：`@tanstack/react-query` 是 v5，要求 **React 18 及以上**（它用了 React 18 的 `useSyncExternalStore`）。Vite 的 `react-ts` 模板默认就是 React 18/19，直接可用。`zustand` 是 v5。

装完可以先跑起来确认环境 OK：

```bash
npm run dev
```

## 2.3 写 Mock API：一个「像真网络」的假后端

新建 `src/api/mockApi.ts`。它用内存数组当「数据库」，每个操作都包一层 `setTimeout` 模拟网络延迟，并提供列表（分页 + 筛选）、详情、创建、更新、删除、以及「任务的评论」（用于第 7 章的依赖查询）。

```ts
// src/api/mockApi.ts

export type TaskStatus = 'todo' | 'doing' | 'done'

export interface Task {
  id: number
  title: string
  status: TaskStatus
  createdAt: number
}

export interface Comment {
  id: number
  taskId: number
  text: string
}

// —— 内存"数据库" ——
let tasks: Task[] = Array.from({ length: 23 }, (_, i) => ({
  id: i + 1,
  title: `任务 #${i + 1}`,
  status: (['todo', 'doing', 'done'] as const)[i % 3],
  createdAt: Date.now() - i * 1000,
}))

const comments: Comment[] = [
  { id: 1, taskId: 1, text: '这个任务优先级最高' },
  { id: 2, taskId: 1, text: '已和后端对齐接口' },
  { id: 3, taskId: 2, text: '等待设计稿' },
]

let nextId = tasks.length + 1

// 模拟网络延迟：300~900ms 之间随机，让 loading 态肉眼可见
const latency = () => 300 + Math.random() * 600
function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), latency()))
}

// 模拟"服务器偶尔抽风"，用来演示错误态与重试
function maybeFail(rate = 0) {
  if (Math.random() < rate) throw new Error('模拟的网络错误 (500)')
}

export interface ListParams {
  status?: TaskStatus | 'all'
  page?: number
  pageSize?: number
}

export interface TaskPage {
  items: Task[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

// 列表：支持按状态筛选 + 分页
export async function fetchTasks(params: ListParams = {}): Promise<TaskPage> {
  const { status = 'all', page = 0, pageSize = 5 } = params
  maybeFail(0) // 默认不失败，需要演示错误时改这里或调用 fetchTasksFlaky
  const filtered = status === 'all' ? tasks : tasks.filter((t) => t.status === status)
  const start = page * pageSize
  const items = filtered.slice(start, start + pageSize)
  return delay({
    items,
    total: filtered.length,
    page,
    pageSize,
    hasMore: start + pageSize < filtered.length,
  })
}

// 一个"会随机失败"的列表接口，专门用来演示 error / retry（第 3、8 章）
export async function fetchTasksFlaky(params: ListParams = {}): Promise<TaskPage> {
  maybeFail(0.5) // 50% 概率失败
  return fetchTasks(params)
}

// 详情
export async function fetchTask(id: number): Promise<Task> {
  const task = tasks.find((t) => t.id === id)
  if (!task) throw new Error(`任务 ${id} 不存在 (404)`)
  return delay(task)
}

// 某任务的评论（依赖 taskId，用于第 7 章依赖查询）
export async function fetchComments(taskId: number): Promise<Comment[]> {
  return delay(comments.filter((c) => c.taskId === taskId))
}

// 创建
export async function createTask(input: { title: string; status?: TaskStatus }): Promise<Task> {
  const task: Task = {
    id: nextId++,
    title: input.title,
    status: input.status ?? 'todo',
    createdAt: Date.now(),
  }
  tasks = [task, ...tasks]
  return delay(task)
}

// 更新
export async function updateTask(id: number, patch: Partial<Omit<Task, 'id'>>): Promise<Task> {
  const idx = tasks.findIndex((t) => t.id === id)
  if (idx === -1) throw new Error(`任务 ${id} 不存在 (404)`)
  tasks[idx] = { ...tasks[idx], ...patch }
  return delay(tasks[idx])
}

// 删除
export async function deleteTask(id: number): Promise<{ id: number }> {
  tasks = tasks.filter((t) => t.id !== id)
  return delay({ id })
}
```

**为什么值得花篇幅写这个假后端？** 因为它把「服务端状态的四大特征」（第 1 章）变成了你能亲眼看到的现象：有延迟（异步）、会失败（错误态）、数据在内存里可被 mutation 改变（共享所有权）、列表会分页（性能）。后面每一章都会复用它。

> 真实项目里，把这一层换成 `fetch('/api/...')` 或 axios 调用即可，**上层组件代码几乎不用改**——这正是 TanStack Query 的价值：它不关心你的 `queryFn` 内部怎么请求。

## 2.4 创建全局唯一的 QueryClient

`QueryClient` 是 TanStack Query 的**大脑**：它持有整个应用的查询缓存，负责去重、失效、垃圾回收。官方约定：**一个应用通常只创建一个 `QueryClient` 实例**（在模块作用域里创建，而不是在组件里，否则每次渲染都会新建缓存）。

新建 `src/queryClient.ts`：

```ts
// src/queryClient.ts
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 学习期把默认行为显式写出来，方便理解（第 4、8 章详解）
      staleTime: 0,          // 数据一拿到就算"过期"，便于观察自动刷新
      gcTime: 5 * 60 * 1000, // 无人使用的查询缓存保留 5 分钟后回收（默认值）
      retry: 1,              // 失败重试 1 次（默认是 3 次，学习期调小更直观）
      refetchOnWindowFocus: true, // 窗口重新聚焦时刷新过期查询（默认开启）
    },
  },
})
```

> ⚠️ 新手最常见的坑：把 `new QueryClient()` 写在组件函数体里。这样每次组件渲染都会生成一个**全新的、空的**缓存，等于缓存完全失效。**必须在模块顶层创建一次。** 第 12 章会讲到唯一的例外——测试里要为每个测试单独建 client。

## 2.5 用 QueryClientProvider 把 client 注入应用

`QueryClientProvider` 是一个 React Context Provider，把 `QueryClient` 传给组件树里所有的 `useQuery` / `useMutation`。在入口 `src/main.tsx` 里包裹整个应用：

```tsx
// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { queryClient } from './queryClient'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      {/* 放在最靠内的位置，initialIsOpen 让面板默认展开，学习期更方便 */}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>,
)
```

要点：

- **只要用了 `useQuery`，它的组件就必须是 `QueryClientProvider` 的后代**，否则报错 `No QueryClient set`；
- `ReactQueryDevtools` 默认只在 `NODE_ENV === 'development'` 时打包，生产构建会自动剔除，不用担心体积；
- 关于 Zustand：**它不需要 Provider**。这是 Zustand 相对 Redux/Context 的一大优势，第 9 章会体现。

## 2.6 第一个 useQuery：见证奇迹

现在写 `src/App.tsx`，用 `useQuery` 拉取任务列表。先感受一下**最简形态**：

```tsx
// src/App.tsx
import { useQuery } from '@tanstack/react-query'
import { fetchTasks } from './api/mockApi'

export default function App() {
  const { data, isPending, isError, error, isFetching } = useQuery({
    // queryKey：这份缓存的"唯一身份证"，数组形式
    queryKey: ['tasks'],
    // queryFn：返回 Promise 的函数，resolve 数据或 reject 错误
    queryFn: () => fetchTasks({ status: 'all', page: 0, pageSize: 5 }),
  })

  // 三态渲染：先判 pending，再判 error，最后才是 success
  if (isPending) return <p>加载中…</p>
  if (isError) return <p style={{ color: 'red' }}>出错了：{error.message}</p>

  // 到这里 TypeScript 知道 data 一定有值
  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>
        TaskFlow 任务看板{' '}
        {isFetching && <small style={{ color: '#888' }}>（后台刷新中…）</small>}
      </h1>
      <p>共 {data.total} 个任务，当前显示第 {data.page + 1} 页：</p>
      <ul>
        {data.items.map((task) => (
          <li key={task.id}>
            [{task.status}] {task.title}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

跑起来 `npm run dev`，你会看到：先显示「加载中…」，几百毫秒后出现任务列表。**这和你手写 `useEffect + fetch` 的区别在哪？** 现在还不明显，但请注意这几个「白送」的能力，接下来几章会逐一展开：

1. **`isPending` / `isError` / `isFetching` 这些状态是自动维护的**，你不用写任何 `setIsLoading(true/false)`；
2. **缓存已经生效**：如果你把这个组件卸载再重新挂载（比如在两个页面间来回切），第二次会**立刻**显示上次的数据（不再转圈），同时后台悄悄刷新——这就是「stale-while-revalidate」，第 4 章细讲；
3. **请求去重**：如果两个组件用**相同的 queryKey** 同时请求，只会真正发一次网络请求；
4. **失败会自动重试**（我们在 client 里配了 `retry: 1`）。

### 对比：如果用手写 useEffect 实现同样的效果

```tsx
// ❌ 手写版本：光是"能用"就要这么多代码，还没有缓存/去重/重试/后台刷新
function App() {
  const [data, setData] = useState(null)
  const [isPending, setIsPending] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false // 还得自己处理竞态：组件卸载后不要 setState
    setIsPending(true)
    fetchTasks({ status: 'all', page: 0, pageSize: 5 })
      .then((res) => { if (!cancelled) { setData(res); setIsPending(false) } })
      .catch((e) => { if (!cancelled) { setError(e); setIsPending(false) } })
    return () => { cancelled = true }
  }, []) // 依赖变了要重新请求？缓存？去重？窗口聚焦刷新？全得自己写……

  // ...三态渲染
}
```

TanStack Query 把上面这一整坨（以及你没写出来的缓存、去重、竞态、重试、失效）压缩成了**声明式的两行**：`queryKey` + `queryFn`。这就是它被称为「缺失的数据请求库」的原因。

## 2.7 认识 Devtools：你的透视眼

打开页面右下角的 TanStack 图标（我们设了 `initialIsOpen={false}`，点一下展开），你会看到一个面板，列出当前所有查询。每一行是一个 query，点进去能看到：

- **query key**：这条缓存的身份证；
- **状态**：fresh / fetching / stale / inactive（第 4 章你会对这些词了如指掌）；
- **data**：当前缓存的数据快照；
- ** observers 数量**：有多少个 `useQuery` 在订阅它；
- 手动触发按钮：**Refetch / Invalidate / Remove**，用来实验缓存行为。

面板顶部的状态用颜色区分（绿色=fresh 新鲜，灰色=inactive 无订阅者，黄色=stale 过期，蓝色=fetching 正在拉取）。**强烈建议整个学习期都开着 Devtools**，它能把第 4 章抽象的「缓存生命周期」变成肉眼可见的动画。

Devtools 还有两种模式：

- **Floating Mode**（浮动，本章用的 `<ReactQueryDevtools />`）：屏幕角落一个可开合的浮层，最常用；
- **Embedded Mode**（内嵌，`<ReactQueryDevtoolsPanel />`）：把面板嵌进你自己的布局，适合做调试页。

## 2.8 常见新手问题排查

| 症状 | 原因 | 解决 |
| --- | --- | --- |
| `No QueryClient set, use QueryClientProvider to set one` | 组件不在 `QueryClientProvider` 内，或 provider 没包对 | 检查 2.5，确保 `App` 是 provider 的后代 |
| 每次都重新 loading，缓存好像没用 | `QueryClient` 被创建在了组件里，每次渲染都新建 | 移到模块顶层（见 2.4 的警告） |
| Devtools 图标不出现 | 没装 devtools 包，或没在 provider 内渲染 | 确认 `npm i -D @tanstack/react-query-devtools` 且组件在 provider 内 |
| `data` 报「可能为 undefined」 | 没先判 `isPending`/`isError` 就访问 `data` | 按 2.6 的三态顺序渲染，TS 会自动收窄类型 |
| 改了 queryFn 里的参数但没重新请求 | queryKey 没变（key 是缓存身份证） | 把影响结果的变量放进 queryKey（第 3 章重点） |

## 练习

1. 把 `App.tsx` 里的 `queryFn` 换成 `fetchTasksFlaky`（50% 概率失败），刷新几次，观察 `isError` 分支和 Devtools 里的重试行为；
2. 把 `queryClient.ts` 里的 `retry` 改成 `3`，再用 flaky 接口，观察它失败后重试的节奏；
3. 在 App 里加一个按钮 `onClick={() => queryClient.invalidateQueries({ queryKey: ['tasks'] })}`（记得 `import { queryClient }`），点它看看 Devtools 里这条 query 的状态变化——这是第 4 章「失效」的预习；
4. 打开 Devtools，手动点某条 query 的 **Refetch**，观察 `isFetching` 变 true、标题旁「后台刷新中…」闪现。

## 本章小结与自检

- [ ] 能用 Vite 搭好 React + TS 项目，装好 `@tanstack/react-query`、`zustand`、devtools；
- [ ] 理解 `QueryClient` 是全局缓存大脑，**必须在模块顶层创建唯一实例**；
- [ ] 能用 `QueryClientProvider` 包裹应用，并知道「用了 useQuery 的组件必须是它的后代」；
- [ ] 跑通了第一个 `useQuery`，会写 `isPending → isError → success` 的三态渲染；
- [ ] 能说出 useQuery 相比手写 useEffect 白送的四件事（自动状态、缓存、去重、重试）；
- [ ] 会打开并使用 Query Devtools 观察查询状态。

下一章，我们把 `useQuery` 拆开揉碎：`queryFn` 到底能写什么、query key 的结构规则、以及 `status` 和 `fetchStatus` 为什么要分成两个维度。

---

> 上一章：[第 1 章 两种状态](./01-two-kinds-of-state.md) | 返回目录：[README](./README.md) | 下一章：[第 3 章 useQuery 深入](./03-usequery-fundamentals.md)
