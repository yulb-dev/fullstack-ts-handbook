# 第 7 章：进阶查询模式——分页、无限滚动、依赖、预取

> 上一章：[第 6 章 乐观更新](./06-optimistic-updates.md) | 返回目录：[README](./README.md) | 下一章：[第 8 章 性能与调试](./08-performance-and-devtools.md)

前面几章打好了地基，这一章把 TanStack Query 应对真实业务的花样一次性讲齐：**分页、无限滚动、依赖查询、预取、后台刷新、并行查询**。它们全都建立在同一条铁律上，先把它请出来。

## 7.0 贯穿全章的铁律

> **query key 必须包含所有会影响结果的变量。**

分页的 `page`、筛选的 `status`、排序的 `sort`、依赖查询的 `userId`——**只要它变了会导致「应该拿到不同的数据」，它就必须进 key。** 这条规则在第 3 章讲过，本章每个模式都是它的具体应用。记住它，下面的一切都顺理成章。

## 7.1 分页查询（Pagination）

分页在 TanStack Query 里「天生就能用」——**只要把 page 放进 query key**：

```tsx
const [page, setPage] = useState(0)

const { data, isPending } = useQuery({
  queryKey: ['tasks', { page }],        // ← page 进 key
  queryFn: () => fetchTasks({ page, pageSize: 5 }),
})
```

但直接这么写，翻页体验有个毛病：**每翻一页都是一个「全新的 query」，会经历 pending → success，界面在「加载中」和「有数据」之间反复跳变**，一闪一闪很难受。

### placeholderData / keepPreviousData：翻页不闪

解决办法是 `placeholderData`。把它设为 `keepPreviousData`（TanStack Query 导出的一个函数），就能在**新页数据还在请求时，继续显示上一页的数据**，等新数据到了再无缝替换：

```tsx
import { useQuery, keepPreviousData } from '@tanstack/react-query'

function PagedTasks() {
  const [page, setPage] = useState(0)

  const { data, isPending, isError, error, isFetching, isPlaceholderData } = useQuery({
    queryKey: ['tasks', { page }],
    queryFn: () => fetchTasks({ page, pageSize: 5 }),
    placeholderData: keepPreviousData, // ← 关键：保留上一页数据当占位
  })

  if (isPending) return <p>加载中…</p>   // 只有"第一页都没有"时才整页 loading
  if (isError) return <p>错误：{error.message}</p>

  return (
    <div>
      {isFetching && <small>刷新中…</small>}
      <ul>
        {data.items.map((t) => <li key={t.id}>{t.title}</li>)}
      </ul>

      <button onClick={() => setPage((p) => Math.max(p - 1, 0))} disabled={page === 0}>
        上一页
      </button>
      <button
        onClick={() => { if (!isPlaceholderData && data.hasMore) setPage((p) => p + 1) }}
        disabled={isPlaceholderData || !data?.hasMore} // 占位数据期间禁用，防止连点跳过
      >
        下一页
      </button>
      <span>第 {page + 1} 页</span>
    </div>
  )
}
```

设了 `keepPreviousData` 后你会得到几个新能力：

- **翻页时上一页数据仍然可见**（虽然 key 已经变了），新数据到了无缝替换；
- 多出一个 **`isPlaceholderData`** 布尔值，告诉你「当前显示的是不是占位（旧页）数据」——常用来在翻页请求期间禁用按钮，避免用户狂点导致跳页；
- 整页 loading（`isPending`）只在**连第一页都还没有**时出现。

`placeholderData` 也可以是一个固定的初始值或函数（`(previousData) => ...`），但 99% 的分页场景用 `keepPreviousData` 就对了。

## 7.2 无限滚动（Infinite Queries）

「加载更多 / 无限下拉」是另一种分页形态：不是替换当前页，而是**把新页追加到已有数据后面**。TanStack Query 为此提供了专门的 `useInfiniteQuery`。

### 它和 useQuery 有什么不同

- `data` 变成一个对象：`data.pages`（所有已加载页的数组）和 `data.pageParams`（每页用的游标）；
- 多出 `fetchNextPage` / `fetchPreviousPage` 函数；
- 需要 `initialPageParam`（首页游标，**必填**）；
- 需要 `getNextPageParam`（告诉它「下一页的游标是什么」，返回 `undefined`/`null` 表示没有更多了）；
- 多出 `hasNextPage` / `hasPreviousPage` / `isFetchingNextPage` 等状态。

### 完整例子（配合我们的 Mock API）

我们的 `fetchTasks` 返回 `{ items, hasMore, page }`。用「页码」当游标：

```tsx
import { useInfiniteQuery } from '@tanstack/react-query'

function InfiniteTasks() {
  const {
    data,
    error,
    status,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['tasks-infinite'],
    // queryFn 会收到 { pageParam }，用它去请求对应页
    queryFn: ({ pageParam }) => fetchTasks({ page: pageParam, pageSize: 5 }),
    initialPageParam: 0, // 首页游标 = 第 0 页
    // 根据"最后一页"算出"下一页的游标"；返回 undefined 表示到底了
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  })

  if (status === 'pending') return <p>加载中…</p>
  if (status === 'error') return <p>错误：{error.message}</p>

  return (
    <>
      {/* data.pages 是"页"的数组，每页里又有 items */}
      {data.pages.map((group, i) => (
        <div key={i}>
          {group.items.map((task) => <p key={task.id}>{task.title}</p>)}
        </div>
      ))}

      <button
        onClick={() => fetchNextPage()}
        disabled={!hasNextPage || isFetchingNextPage}
      >
        {isFetchingNextPage ? '加载更多中…' : hasNextPage ? '加载更多' : '没有更多了'}
      </button>

      {/* 后台整体刷新（非"加载更多"）时的提示 */}
      <div>{isFetching && !isFetchingNextPage ? '后台刷新中…' : null}</div>
    </>
  )
}
```

把它接到「滚动到底自动加载」，只需在滚动/触底回调里：

```tsx
<List onEndReached={() => hasNextPage && !isFetching && fetchNextPage()} />
```

### 几个必须知道的细节

1. **`getNextPageParam` 决定「有没有下一页」**：它返回非 `undefined`/`null` 的值，`hasNextPage` 就是 `true`；返回 `undefined` 就表示到底了。这是控制「加载更多」按钮的核心。
2. **一个 infinite query 只能有一个进行中的 fetch**：所有页共享一个缓存条目。如果你在后台刷新还没结束时又调 `fetchNextPage`，可能覆盖数据。所以务必检查 `!isFetching`（如上）。
3. **infinite query 重新拉取时，是从第一页开始「顺序」重取所有页**：这是为了保证游标不错乱、不重复不遗漏。也因此，页数太多时重取会慢——用 `maxPages` 限制内存里保留的页数：
   ```tsx
   useInfiniteQuery({ ..., maxPages: 3 }) // 只保留最近 3 页
   ```
4. **双向无限列表**（既能往下也能往上加载）：再加 `getPreviousPageParam` + `fetchPreviousPage` + `hasPreviousPage`。
5. **手动改 infinite 缓存**：用 `setQueryData` 时，必须**同时维护 `pages` 和 `pageParams` 两个数组**的结构一致。
6. **API 不返回游标怎么办**：用 `pageParam` 自己算下一页（`getNextPageParam: (lastPage, allPages, lastPageParam) => lastPageParam + 1`）。

## 7.3 依赖查询（Dependent / Serial Queries）

有时一个查询要**等另一个查询的结果**才能开始：先拿到用户，再用用户 id 去拿他的项目。用 `enabled` 选项控制「什么时候才允许执行」：

```tsx
// 先查用户
const { data: user } = useQuery({
  queryKey: ['user', email],
  queryFn: () => getUserByEmail(email),
})

const userId = user?.id

// 再查该用户的项目：enabled 为 false 时不执行
const { status, fetchStatus, data: projects } = useQuery({
  queryKey: ['projects', userId], // ← userId 进 key（黄金法则）
  queryFn: () => getProjectsByUser(userId!),
  enabled: !!userId, // ← 直到 userId 存在才执行
})
```

`enabled: false` 时，查询会停在 `status: 'pending'` 但 `fetchStatus: 'idle'`（想请求但没在请求）。一旦 `userId` 有值、`enabled` 变 true，它才真正开始 fetch。这也解释了第 3 章为什么强调 `status` 和 `fetchStatus` 要分开——依赖查询就是「pending 但 idle」的典型。

`enabled` 还能用于**条件查询**：比如「弹窗打开时才查数据」「有搜索关键词时才查」。

### 性能提醒：依赖查询就是「请求瀑布」

官方特别警告：**依赖查询本质上是一种请求瀑布（request waterfall），会拖慢性能**。如果两个查询各需 500ms，串行就是 1000ms。能并行就并行。如果后端能提供一个「用 email 直接查 projects」的接口，就该用它来「拍平瀑布」，而不是先查 user 再查 projects。

### 动态并行查询：useQueries

如果你要「基于一组 id，同时发起多个查询」（比如拿到 userIds 后并行查每个人的消息），用 `useQueries`：

```tsx
import { useQueries } from '@tanstack/react-query'

const { data: userIds } = useQuery({
  queryKey: ['users'],
  queryFn: getUsers,
  select: (users) => users.map((u) => u.id), // select 只取 id 列表
})

const usersMessages = useQueries({
  queries: userIds
    ? userIds.map((id) => ({
        queryKey: ['messages', id],
        queryFn: () => getMessagesByUser(id),
      }))
    : [], // userIds 还没到时，传空数组
})
// usersMessages 是一个"查询结果"的数组
```

`useQueries` 适合「数量在运行时才确定的一批并行查询」，它们共享同一个缓存，各自独立管理状态。

## 7.4 预取（Prefetching）：提前把数据放进缓存

**预取**就是「在你真正需要某数据之前，先悄悄把它请求好放进缓存」，等用户到达时数据已经在那儿了，体验飞快。常见触发点：鼠标悬停在链接上、组件即将挂载、路由即将跳转。

### 三种预取姿势

**① 在事件处理器里预取**（比如鼠标 hover 到「查看详情」按钮时，就先把详情拉好）：

```tsx
function TaskRow({ task }: { task: Task }) {
  const queryClient = useQueryClient()

  const prefetch = () => {
    // 悬停时预取详情；用 void + catch 吞掉错误（真正用到时 useQuery 还会再请求兜底）
    void queryClient.prefetchQuery({
      queryKey: ['task', task.id],
      queryFn: () => fetchTask(task.id),
      staleTime: 60_000, // 预取通常要配一个 > 0 的 staleTime，否则马上又过期重取
    })
  }

  return <li onMouseEnter={prefetch}>{task.title}</li>
}
```

**② 在组件里预取**（父组件知道子组件将要某数据，提前拉，用来「拍平瀑布」）：

```tsx
function TaskDetailPage({ id }: { id: number }) {
  const taskQuery = useQuery({ queryKey: ['task', id], queryFn: () => fetchTask(id) })

  // 预取评论：即使评论组件还没渲染，也先把数据拉起来，和详情并行
  useQuery({
    queryKey: ['task-comments', id],
    queryFn: () => fetchComments(id),
    notifyOnChangeProps: [], // 优化：这个查询变化时不触发本组件重渲染
  })

  if (taskQuery.isPending) return <p>加载中…</p>
  return <><TaskHeader task={taskQuery.data} /><Comments id={id} /></>
}
```

**③ 在路由层预取**：进入某路由前，先把该路由需要的数据加载好。TanStack Router、React Router 等都支持在 loader 里调用 `queryClient.prefetchQuery`。这是 SSR/大型应用避免瀑布的主力手段。

### 关于 API 命名的版本提醒

`prefetchQuery`（拉数据、不返回给组件）和 `ensureQueryData`（缓存里有就直接返回、没有才拉）是大家最熟悉、**在所有 v5 版本都稳定可用**的预取 API，本教程以它们为准。

> 最新版本的官方文档引入了一个统一的 `queryClient.query()` / `queryClient.infiniteQuery()` 方法来取代 `prefetchQuery`/`ensureQueryData`，并说这两个旧方法「将在下一个大版本移除」。如果你用的是最新版，会看到官方示例改用 `await queryClient.query({ queryKey, queryFn })`。两者概念一致：**提前把数据灌进缓存**。新手先用稳定的 `prefetchQuery`，读到新文档时知道它对应 `query()` 即可。

### 预取 vs 手动灌数据

如果你**已经同步地有了数据**（不需要请求），就别预取了，直接 `setQueryData` 塞进缓存：

```tsx
queryClient.setQueryData(['task', task.id], task) // 数据已在手，直接写缓存
```

## 7.5 后台刷新（Background Refetching）与 stale-while-revalidate

这不是新 API，而是把第 4 章的机制串起来，理解 TanStack Query 的核心体验哲学：

> **stale-while-revalidate：有缓存就先显示缓存（哪怕过期），同时在后台悄悄拉最新数据，回来后无缝替换。用户几乎从不等白屏。**

它是怎么自然发生的：

```
用户切回任务列表页
   ├─ 缓存里有 ['tasks'] 的旧数据（且已过 staleTime → stale）
   │     → 立刻渲染旧数据（status=success, isFetching=false）
   └─ 同时因为 stale + 触发点（挂载/聚焦）
         → 后台重新请求（isFetching=true）
               → 新数据回来，结构共享判断有变化则替换，界面无缝更新
```

你在第 3、4 章的实验里已经见过它：切走再切回不 loading、标题旁「刷新中…」一闪。这就是后台刷新。要调它的激进程度，就是调第 4 章的 `staleTime` 和 `refetchOnXxx`。

## 7.6 实战：TaskFlow 的分页 + 依赖详情 + 悬停预取

把本章模式组合进项目——一个分页列表，悬停某行预取其详情，点击进入详情后再依赖地加载评论：

```tsx
// 列表（分页 + 预取）
function TaskList() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(0)
  const { data, isPlaceholderData, isFetching } = useQuery({
    queryKey: ['tasks', { page }],
    queryFn: () => fetchTasks({ page, pageSize: 5 }),
    placeholderData: keepPreviousData,
  })

  return (
    <ul>
      {data?.items.map((task) => (
        <li
          key={task.id}
          // 悬停即预取详情，点进去秒开
          onMouseEnter={() =>
            void queryClient.prefetchQuery({
              queryKey: ['task', task.id],
              queryFn: () => fetchTask(task.id),
              staleTime: 60_000,
            })
          }
        >
          <Link to={`/tasks/${task.id}`}>{task.title}</Link>
        </li>
      ))}
      {/* 翻页按钮略，见 7.1 */}
    </ul>
  )
}

// 详情（依赖查询加载评论）
function TaskDetail({ id }: { id: number }) {
  const task = useQuery({ queryKey: ['task', id], queryFn: () => fetchTask(id) })
  const taskId = task.data?.id
  const comments = useQuery({
    queryKey: ['task-comments', taskId],
    queryFn: () => fetchComments(taskId!),
    enabled: !!taskId, // 等详情到了才查评论
  })
  // ...渲染
}
```

开着 Devtools 观察：悬停某行，`['task', id]` 立刻出现在缓存里（预取生效）；点进去时它已有数据，秒开；评论查询在详情到达后才从 idle 转 fetching（依赖查询）。

## 本章小结与自检

- [ ] 牢记铁律：**query key 必须包含所有影响结果的变量**（page/status/sort/userId…）；
- [ ] 分页会用 `placeholderData: keepPreviousData` 消除翻页闪烁，懂 `isPlaceholderData` 的用途；
- [ ] 无限滚动会用 `useInfiniteQuery` 的 `initialPageParam`、`getNextPageParam`、`fetchNextPage`、`hasNextPage`，知道 `data.pages` 结构和「同一时刻只能一个 fetch」；
- [ ] 依赖查询会用 `enabled` 控制执行时机，并知道它本质是请求瀑布、能并行就别串行；
- [ ] 会用 `useQueries` 做运行时数量确定的并行查询；
- [ ] 会在事件处理器 / 组件 / 路由层做预取（`prefetchQuery`，配 `staleTime`），并知道最新版对应 `queryClient.query()`；
- [ ] 能解释 stale-while-revalidate：先显示缓存、后台刷新、无缝替换。

下一章，我们钻到性能和调试层：结构共享、引用稳定性、`select`，以及把 Query Devtools 用到极致。

---

> 上一章：[第 6 章 乐观更新](./06-optimistic-updates.md) | 返回目录：[README](./README.md) | 下一章：[第 8 章 性能与调试](./08-performance-and-devtools.md)
