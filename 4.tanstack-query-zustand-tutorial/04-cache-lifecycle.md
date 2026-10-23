# 第 4 章：缓存生命周期——新鲜度、回收与失效

> 上一章：[第 3 章 useQuery 深入](./03-usequery-fundamentals.md) | 返回目录：[README](./README.md) | 下一章：[第 5 章 useMutation](./05-mutations.md)

这一章是学习 TanStack Query 的**分水岭**。理解了缓存的生命周期，你就理解了它「为什么有时候自动刷新、有时候不刷新、有时候秒出数据、有时候转圈」的全部行为。学完这章，你再看 Devtools 里那些颜色（green/gray/yellow/blue），会觉得一切都理所当然。

官方文档有一节专门叫 **Important Defaults（重要默认值）**，开篇就说：TanStack Query 开箱即用的默认配置「激进但合理」，但**这些默认值常常让新手措手不及**。本章先把默认值讲清楚，再讲怎么改。

## 4.1 一份缓存数据的一生

先建立全景图。一条 query（由 query key 唯一标识）从生到死，经历这些阶段：

```
[首次请求] data === undefined, status = 'pending'
     │  queryFn 成功
     ▼
[fresh 新鲜]  有数据，且在 staleTime 内 → 不会自动重新请求
     │  过了 staleTime（默认 0，即立刻）
     ▼
[stale 过期]  有数据，但"可能不是最新的" → 遇到触发点会后台刷新
     │  所有 useQuery 订阅者都卸载了
     ▼
[inactive 不活跃]  没有组件在用了，但缓存还留着（防止你马上又用到）
     │  过了 gcTime（默认 5 分钟）还没人用
     ▼
[被垃圾回收]  缓存删除，回到最开始的 undefined
```

三个关键时间/状态概念，本章逐个击破：**staleTime（新鲜度）**、**gcTime（垃圾回收）**、**active/inactive（活跃与否）**。

## 4.2 staleTime：数据多久算「过期」

### 核心定义

- **fresh（新鲜）**：数据在 `staleTime` 时间窗口内。**新鲜的查询不会自动重新请求**——直接用缓存，连后台刷新都不做。
- **stale（过期）**：超过了 `staleTime`。过期的数据**仍然会立刻显示**（用户体验好），但会在合适的时机**后台重新请求**，拿到新数据后无缝替换。

**默认 `staleTime` 是 `0`**——意味着**数据一到手就算过期**。这就是官方说的「默认把缓存数据当作 stale」。很多新手困惑「为什么我明明缓存了，切回来还是要刷新一次」，答案就是：`staleTime: 0` 下数据永远是 stale 的，所以切回来会触发一次后台刷新（但因为缓存里有数据，你看到的是「秒出旧数据 + 后台悄悄更新」，而不是整页 loading）。

### 怎么设置

`staleTime` 可以全局设（在 `QueryClient` 的 `defaultOptions` 里），也可以单条 query 设（会覆盖全局）：

```tsx
useQuery({
  queryKey: ['tasks'],
  queryFn: fetchTasks,
  staleTime: 60 * 1000, // 这条数据 60 秒内都算新鲜，期间任何触发点都不会重新请求
})
```

几个常用取值和它们的含义：

| staleTime | 含义 | 典型场景 |
| --- | --- | --- |
| `0`（默认） | 数据永远算过期，遇触发点就后台刷新 | 频繁变动的数据（聊天、看板） |
| `30 * 1000` | 30 秒内新鲜 | 一般业务列表 |
| `5 * 60 * 1000` | 5 分钟新鲜 | 变动少的数据 |
| `Infinity` | 永不因「过期」而自动刷新，但仍可被 `invalidateQueries` 手动失效 | 基本不变、但偶尔要手动更新的字典数据 |
| `'static'`（较新） | 比 Infinity 更严格：**连手动 invalidate 都不生效**，`refetchOnXxx: 'always'` 也被挡 | 运行期绝不可能变的数据：登录时拉取的权限、启动时的特性开关、静态字典表 |

> `'static'` 和 `Infinity` 都能阻止「基于过期」的刷新，区别是：`invalidateQueries()` 能让 `staleTime: Infinity` 的查询失效并重新拉取，但对 `'static'` **无效**。选 `Infinity` 当你还想保留手动失效的能力；选 `'static'` 当你确定这数据在应用运行期绝对不会变。

### staleTime 该设多少？

一个务实的原则：**设成「这份数据在你看来多久之内不太可能变」。** 与其纠结精确值，不如记住：

- 设得**越长**，重复请求越少、体验越快，但数据「不够新」的时间越长；
- 设得**越短（或 0）**，数据越新，但请求越多；
- 官方明确推荐：**通过设置 `staleTime` 来避免过度重复请求**，这是首选手段（而不是去关各种 `refetchOnXxx`）。

## 4.3 gcTime：无人使用的缓存多久被回收

### 核心定义

`gcTime`（garbage collection time，垃圾回收时间）控制的是：**一条 query 在「没有任何组件订阅」（inactive）之后，缓存在内存里还能保留多久，超时就被删除。**

- **默认 `gcTime` 是 5 分钟**（`1000 * 60 * 5`）。
- 只要还有**至少一个** `useQuery` 在用它（active），就**永远不会**被回收——计时器只在「变成 inactive」后才开始跑。

### staleTime vs gcTime：最常被混淆的一对

务必分清这两个「时间」：

| | staleTime | gcTime |
| --- | --- | --- |
| 管的是什么 | 数据「新不新鲜」，要不要**重新请求** | 缓存「留不留着」，要不要**从内存删除** |
| 触发计时 | 数据成功获取后开始算 | 最后一个订阅者卸载（变 inactive）后开始算 |
| 到期后果 | 数据变 stale，遇触发点后台刷新（数据还在） | 缓存被删除，下次用要重新从 pending 开始 |
| 默认值 | `0` | `5 分钟` |
| 通常关系 | 一般 `gcTime ≥ staleTime` | 默认 gcTime 远大于 staleTime |

一句话记忆：**staleTime 决定「要不要去问服务器要新的」，gcTime 决定「旧数据要不要从内存里扔掉」。** 两者独立，但通常让 gcTime 比 staleTime 大（默认就是这样），这样数据过期后还能作为「秒出的旧内容」留一会儿。

### 为什么 gcTime 存在？

设想没有 gcTime：你浏览了 1000 个任务详情页，缓存里就永久堆着 1000 条数据，内存无限膨胀。gcTime 让「你大概率不会马上再看」的数据自动清理，同时又给「你可能马上会切回来」的数据留了 5 分钟缓冲——这正是「切走再切回不 loading」体验的来源。

## 4.4 active / inactive：有没有人在用

- **active（活跃）**：至少有一个挂载着的 `useQuery`/`useInfiniteQuery`/observer 在订阅它。活跃查询**不会被垃圾回收**。
- **inactive（不活跃）**：没有任何订阅者了。inactive 查询**仍留在缓存里**（万你马上又用到），并开始 gcTime 倒计时。

在 Devtools 里，inactive 查询显示为**灰色**。你可以直观看到：切走一个页面，它的 query 变灰（inactive）；5 分钟内切回来，秒出数据并重新变活跃；超过 5 分钟才回来，缓存已回收，重新走 pending。

## 4.5 什么时候会「自动刷新」？

这是理解默认行为的关键。官方文档明确列出：**stale（过期）的查询会在以下时机自动后台刷新**：

1. **新的查询实例挂载时**（`refetchOnMount`）——比如你切回一个用了这条 query 的页面；
2. **浏览器窗口重新获得焦点时**（`refetchOnWindowFocus`）——默认开启！你切到别的标签页再切回来，就会刷新；
3. **网络重新连接时**（`refetchOnReconnect`）——断网又恢复。

这三个都可以单独配置，取值有 `true`（stale 时才刷新，默认）、`false`（关闭）、`'always'`（无论新鲜与否都刷新）：

```tsx
useQuery({
  queryKey: ['tasks'],
  queryFn: fetchTasks,
  refetchOnMount: true,          // 默认
  refetchOnWindowFocus: true,    // 默认：窗口聚焦刷新
  refetchOnReconnect: true,      // 默认：重连刷新
})
```

> 「窗口聚焦就刷新」是 TanStack Query 最有争议也最有用的默认值。它的哲学是：用户切回你的应用时，**应该看到最新数据**。如果你觉得某些数据不需要这么激进，优先调大 `staleTime`（而不是关掉 `refetchOnWindowFocus`）——因为数据只要还 fresh，聚焦也不会触发刷新。

### 定时轮询：refetchInterval

如果你要「每隔 N 秒自动刷新」（比如实时看板），用 `refetchInterval`，它独立于 staleTime：

```tsx
useQuery({
  queryKey: ['tasks'],
  queryFn: fetchTasks,
  refetchInterval: 10 * 1000, // 每 10 秒刷新一次
  // refetchIntervalInBackground: true, // 标签页在后台时也继续轮询（默认 false）
})
```

`refetchInterval` 也可以是一个函数，根据上一次数据动态决定下次间隔（返回 `false` 停止轮询）：

```tsx
refetchInterval: (query) => (query.state.data?.isDone ? false : 2000) // 完成后停止轮询
```

## 4.6 主动刷新与主动失效

自动刷新之外，你还能**主动**控制。两者的区别要分清：

### refetch：重新执行这一条查询

`useQuery` 返回值里有 `refetch()`，手动触发重新请求（不管 stale 与否）：

```tsx
const { refetch, isFetching } = useQuery({ queryKey: ['tasks'], queryFn: fetchTasks })

<button onClick={() => refetch()} disabled={isFetching}>
  刷新
</button>
```

`refetch()` 返回 Promise，还能带选项：`refetch({ cancelRefetch: false })`（默认会取消正在进行的上一次请求）。

### invalidateQueries：标记为过期（并可能刷新）

当你**确切知道**某份数据因为用户的操作已经过时了（比如刚新增了一个任务），不该傻等 staleTime，而要立刻让它失效。这就是 `queryClient.invalidateQueries`。

```tsx
import { useQueryClient } from '@tanstack/react-query'

const queryClient = useQueryClient()
queryClient.invalidateQueries({ queryKey: ['tasks'] })
```

**当一条 query 被 invalidate，会发生两件事：**

1. **它被标记为 stale**（这个 stale 会**覆盖** 你设的任何 staleTime）；
2. **如果它当前正被某些 `useQuery` 渲染着（active），会立刻后台重新请求。** 如果只是 inactive，则只标记为 stale，等下次有人用它时再刷新。

> 注意：TanStack Query 官方特意说明，它不像「规范化缓存（normalized cache）」的库那样去猜哪些数据要更新，而是主张**精准失效 + 后台重新拉取 + 原子化更新**。也就是说，**invalidate 通常意味着「重新请求一次拿最新数据」**，而不是「本地拼凑新数据」。这让心智模型简单可靠。

## 4.7 invalidateQueries 的匹配规则：前缀、精确、谓词

`invalidateQueries`（以及 `removeQueries` 等）支持灵活匹配，这是组织 query key（第 3 章）的回报所在。

### 前缀匹配（默认）

传一个 query key，会失效**所有以它为前缀**的查询：

```tsx
// 会失效 ['tasks']、['tasks', { status: 'done' }]、['tasks', { page: 2 }] …所有 tasks 开头的
queryClient.invalidateQueries({ queryKey: ['tasks'] })
```

这就是为什么我们建议 key 用 `['资源名', 参数对象]` 组织——**新增/删除/修改任何任务后，一句 `invalidateQueries({ queryKey: ['tasks'] })` 就能把所有相关的列表、分页、筛选缓存全部刷新。**

### 更精确的匹配

传更具体的 key，只失效匹配的：

```tsx
// 只失效"status 为 done 的任务列表"，不影响 ['tasks'] 全部列表
queryClient.invalidateQueries({ queryKey: ['tasks', { status: 'done' }] })
```

### exact：只失效完全相等的 key

如果你想**只**失效 `['tasks']` 本身，不要它的所有子 key：

```tsx
queryClient.invalidateQueries({ queryKey: ['tasks'], exact: true })
// ['tasks'] 被失效；['tasks', { status: 'done' }] 不受影响
```

### predicate：用函数精细筛选

传一个断言函数，拿到每个 Query 实例自己判断：

```tsx
queryClient.invalidateQueries({
  predicate: (query) =>
    query.queryKey[0] === 'tasks' && (query.queryKey[1] as any)?.version >= 10,
})
```

### 其它常用选项

- `type: 'active' | 'inactive' | 'all'`（默认 `'all'`）：只失效活跃/不活跃的查询；
- `refetchType`：控制失效后是否立即重新拉取；
- 返回 Promise：`await queryClient.invalidateQueries(...)` 可以等所有触发的刷新完成（在 mutation 里很有用，第 5 章）。

## 4.8 全局默认配置：一次设好，处处生效

大部分默认行为可以在 `QueryClient` 的 `defaultOptions` 里统一调整，避免每条 query 都写一遍：

```ts
// src/queryClient.ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,      // 全局：30 秒内新鲜
      gcTime: 10 * 60 * 1000,    // 全局：不活跃缓存保留 10 分钟
      retry: 2,                  // 全局：失败重试 2 次
      refetchOnWindowFocus: false, // 全局：关掉窗口聚焦刷新
    },
    mutations: {
      // mutation 的默认值（第 5 章）
    },
  },
})
```

**优先级**：单条 query/mutation 上的选项 > `defaultOptions` > 库内置默认值。所以全局设 `retry: 2`，但某条 query 写 `retry: 5`，那条就是 5。

> ⚠️ 关于测试：把 `retry` 设小（或 false）在生产代码里要谨慎，但在**测试环境**里几乎必须——否则一个失败的查询会重试 3 次、每次指数退避，测试会等到超时。第 12 章会讲怎么给测试单独建一个「retry: false」的 client。

## 4.9 失败重试的默认行为（先了解，第 8 章深入）

官方默认值：**查询失败会「静默重试 3 次」，采用指数退避延迟（exponential backoff），之后才把错误暴露给 UI。**

「静默」意味着：重试期间 `status` 还是 `pending`（首次）或维持上一次的状态，用户看到的是「一直在 loading」，直到 3 次都失败才显示错误。这解释了「为什么接口明明 500 了，界面还转了好几秒圈才报错」——它在偷偷重试。

`retry` 可以设为数字、布尔、或函数：

```tsx
useQuery({
  queryKey: ['task', id],
  queryFn: () => fetchTask(id),
  retry: 3,                    // 固定重试 3 次
  // retry: false,             // 完全不重试
  // retry: (failureCount, error) => error.status !== 404 && failureCount < 3, // 404 不重试
})
```

第 8 章会把重试、退避、网络模式一起收进「默认行为总结」。

## 4.10 实战：给 TaskFlow 配上合理的缓存策略

回到我们的项目。任务列表是「会被 mutation 改动」的数据，策略应该是：**适中的 staleTime + mutation 后主动 invalidate**。任务详情则是「点开就看、变动少」，可以给更长 staleTime。

```ts
// src/queryClient.ts（TaskFlow 的推荐配置）
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,       // 30 秒内切来切去不重复请求
      gcTime: 5 * 60 * 1000,      // 保留默认 5 分钟回收
      retry: 1,                   // 学习期重试 1 次即可
      refetchOnWindowFocus: true, // 保留：切回应用看到最新任务
    },
  },
})
```

```tsx
// 列表查询
const tasksQuery = useQuery({
  queryKey: ['tasks', { status: filter, page }],
  queryFn: () => fetchTasks({ status: filter, page, pageSize: 8 }),
})

// 详情查询：变动更少，给更长 staleTime
const taskQuery = useQuery({
  queryKey: ['task', taskId],
  queryFn: () => fetchTask(taskId),
  staleTime: 5 * 60 * 1000, // 5 分钟
})
```

开着 Devtools 做这几个实验，把本章知识变成肌肉记忆：

1. **观察 fresh → stale**：把某条 query 的 `staleTime` 设成 10 秒，在 Devtools 里看它的颜色从绿（fresh）在 10 秒后变黄（stale）；
2. **观察 inactive → 回收**：切走页面，看 query 变灰（inactive）；把 gcTime 改成 5 秒，等 5 秒后它从 Devtools 里消失；
3. **观察窗口聚焦刷新**：stale 状态下切到别的标签页再切回，看它自动 fetching；
4. **观察 invalidate**：在控制台执行 `queryClient.invalidateQueries({ queryKey: ['tasks'] })`，看所有 tasks 相关 query 一起刷新。

## 本章小结与自检

- [ ] 能画出一条缓存数据的一生：pending → fresh → stale → inactive → 回收；
- [ ] 分得清 **staleTime**（要不要重新请求）和 **gcTime**（要不要从内存删除），知道默认分别是 `0` 和 `5 分钟`；
- [ ] 知道 stale 查询的三个自动刷新触发点：挂载、窗口聚焦、网络重连；
- [ ] 会用 `refetchInterval` 做定时轮询；
- [ ] 分得清 `refetch()`（重跑这一条）和 `invalidateQueries()`（标记过期 + 可能刷新，可前缀批量匹配）；
- [ ] 知道 invalidate 的两件事：标记 stale（覆盖 staleTime）+ active 时后台刷新；
- [ ] 会用 `exact` 和 `predicate` 做精确失效，理解「key 组织得好，失效就轻松」；
- [ ] 知道查询默认失败**静默重试 3 次 + 指数退避**，会用 `defaultOptions` 全局配置。

下一章，我们学「改数据」：`useMutation` 的生命周期，以及为什么改完数据要 `invalidateQueries`。

---

> 上一章：[第 3 章 useQuery 深入](./03-usequery-fundamentals.md) | 返回目录：[README](./README.md) | 下一章：[第 5 章 useMutation](./05-mutations.md)
