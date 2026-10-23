# 第 8 章：性能与调试——结构共享、引用稳定性与 Devtools

> 上一章：[第 7 章 进阶查询模式](./07-advanced-query-patterns.md) | 返回目录：[README](./README.md) | 下一章：[第 9 章 Zustand 基础](./09-zustand-fundamentals.md)

这一章讲 TanStack Query「默默为你做的性能优化」，以及怎么用它把应用调得又快又稳。核心是三件事：**结构共享**（让数据引用尽量不变）、**tracked properties**（只在你真正用到的属性变化时才重渲染）、**select**（只订阅你要的那部分数据）。最后把 Query Devtools 和「默认重试/刷新行为」做个总结，作为服务端状态部分的收官。

## 8.1 结构共享（Structural Sharing）

### 它解决什么问题

每次从网络拿到数据，`JSON.parse` 都会产生一个**全新的对象引用**——哪怕内容和上次一模一样。在 React 里，「引用变了」往往意味着「触发重渲染、useMemo/useCallback 失效、子组件白白重渲染」。

**结构共享**就是 TanStack Query 的对策：重新拉取后，它会拿新旧数据做**结构比对**：

- 如果**整份数据没变**，就**保留旧的引用**（`data` 引用不变）；
- 如果**只有部分变了**，就**保留没变的部分的引用，只替换变了的部分**。

举例：一个有 100 个任务的列表，后台刷新后只有 1 个任务的标题变了。结构共享会让**另外 99 个任务对象保持原引用**，只有那 1 个是新的。于是「渲染单个任务行」的组件里，99 个不会因为 `React.memo` 的 props 引用没变而跳过重渲染——**性能大增，且完全自动、零配置**。

官方文档说得很直白：99.9% 的情况你不需要关掉它，它零成本地让你的应用更快。

### 前提与关闭方式

- **只对 JSON 兼容的数据生效**：结构共享靠比对 JSON 结构。如果 queryFn 返回的是 `Date`、`Map`、`class 实例`等非纯 JSON 值，会被当作「总是变了」（无法结构共享）。
- **关闭**：全局或单条设 `structuralSharing: false`（比如超大响应体、比对本身成了瓶颈时）。
- **自定义**：给它传一个函数 `(oldData, newData) => ...`，自己决定如何保留引用（处理非 JSON 值时可用）。

```tsx
useQuery({
  queryKey: ['tasks'],
  queryFn: fetchTasks,
  // structuralSharing: false, // 关闭（一般不需要）
})
```

## 8.2 数据引用稳定性（Referential Stability）

一个必须知道的细节，关系到你会不会被「莫名其妙的重渲染」困扰：

- **`useQuery` 返回的顶层结果对象，每次渲染都是新引用**（不稳定）；
- **但它里面的 `data` 属性，会尽可能保持稳定**（靠结构共享）。

所以：

```tsx
// ❌ 别这么干：result 每次都是新对象，拿它当 useEffect 依赖会无限触发
const result = useQuery({ ... })
useEffect(() => { ... }, [result])

// ✅ 依赖 result.data（引用稳定），或依赖你真正关心的字段
const { data } = useQuery({ ... })
useEffect(() => { ... }, [data])
```

这条规则和 React 的 `useMemo`/`useCallback` 配合时尤其重要：**因为 `data` 引用稳定，`useMemo(() => transform(data), [data])` 才能在数据没变时正确跳过计算**。这正是结构共享的价值兑现点。

## 8.3 tracked properties：只为你「真正用到」的属性重渲染

TanStack Query 用 `Proxy` 追踪你在组件里**实际访问了哪些返回属性**，只有这些属性变化时才触发重渲染。

举例：`isFetching` 变化很频繁（每次后台刷新都 true→false）。如果你的组件根本没用到 `isFetching`，那么它变化时**你的组件不会重渲染**——即使别的组件用了它。

```tsx
// 这个组件只用了 data 和 isPending，没用 isFetching。
// 那么后台刷新导致的 isFetching 变化，不会让这个组件重渲染。
const { data, isPending } = useQuery({ queryKey: ['tasks'], queryFn: fetchTasks })
```

### 一个会「意外关掉这个优化」的坑：rest 解构

tracked properties 靠「访问属性」来追踪。如果你用**对象 rest 解构**，等于访问了所有属性，优化就失效了：

```tsx
// ❌ ...rest 访问了所有属性 → 任何属性变化都会重渲染，优化失效
const { data, ...rest } = useQuery({ ... })

// ✅ 只解构你真正用的
const { data, isPending, isError } = useQuery({ ... })
```

TanStack Query 提供了 ESLint 规则 `no-rest-destructuring` 来防范这个坑，建议在项目里开启。

### 手动控制：notifyOnChangeProps

默认是自动追踪（`notifyOnChangeProps` 默认自动）。你可以手动指定只监听某些属性，或关掉这个优化：

```tsx
useQuery({ queryKey: ['tasks'], queryFn: fetchTasks, notifyOnChangeProps: ['data'] }) // 只监听 data
useQuery({ queryKey: ['tasks'], queryFn: fetchTasks, notifyOnChangeProps: 'all' })     // 关闭优化，任何属性变化都重渲染
```

第 7 章「在组件里预取」时用到的 `notifyOnChangeProps: []`（谁都不监听），就是让那个预取查询**完全不触发本组件重渲染**——它只负责把数据灌进缓存。

## 8.4 select：只订阅你需要的那部分数据

有时你不需要整份数据，只关心从中派生的一个小值。`select` 让你**在缓存数据之上做一次转换**，并且**组件只订阅转换后的结果**——转换结果没变，就不重渲染。

```tsx
// 只关心"任务总数"，而不是整个列表
const { data: count } = useQuery({
  queryKey: ['tasks'],
  queryFn: fetchTasks,
  select: (page) => page.total, // 只取 total
})
// 只有 total 变了，这个组件才重渲染；列表里某条任务标题变了，不会触发它重渲染
```

### select 的关键特性与注意

1. **select 不会改变缓存本身**：缓存里存的还是完整数据，`select` 只是「这个组件订阅的视图」。多个组件可以对同一个 query 用不同的 select。
2. **select 的重新计算有记忆化**：只有当「select 函数引用变了」或「data 变了」时才重跑。所以**内联的箭头函数每次渲染都是新引用，会导致 select 每次重跑**——用 `useCallback` 包裹或提取成稳定引用：
   ```tsx
   // ❌ 内联函数每次渲染都是新引用
   useQuery({ queryKey: ['tasks'], queryFn: fetchTasks, select: (d) => d.total })

   // ✅ 提取成稳定引用
   const selectTotal = (d: TaskPage) => d.total
   useQuery({ queryKey: ['tasks'], queryFn: fetchTasks, select: selectTotal })

   // ✅ 或用 useCallback
   const selectTotal = useCallback((d: TaskPage) => d.total, [])
   ```
3. **别在 select 里抛错**：select 作用于「已成功缓存的数据」，不是处理错误的地方。错误处理的源头是 queryFn。select 里返回错误会导致 `data` 是 undefined 而 `isSuccess` 还是 true，很反直觉。

### select 的经典用法：封装成自定义 hook

```tsx
// 一个 useTodos 基础 hook，接受 select
export const useTasks = <T,>(select?: (data: TaskPage) => T) =>
  useQuery({ queryKey: ['tasks'], queryFn: fetchTasks, select })

// 派生出各种"只订阅部分数据"的 hook
const selectDoneCount = (d: TaskPage) => d.items.filter((t) => t.status === 'done').length
export const useDoneTaskCount = () => useTasks(selectDoneCount)
```

`useDoneTaskCount` 的组件，只在「已完成数量」变化时才重渲染——即使列表其它方面变了也不受影响。这就是 select + 引用稳定带来的精细控制。

## 8.5 Query Devtools 用到位

第 2 章我们装了 Devtools，这里把它的能力补全。它是调试服务端状态的**第一工具**。

### 面板能告诉你什么

- **每条 query 的实时状态**：颜色区分 fresh（绿）/ fetching（蓝）/ stale（黄）/ inactive（灰）；
- **query key、data 快照、observers 数量、最近更新时间**；
- **手动操作**：Refetch / Invalidate / Remove，用来验证你的失效逻辑；
- **v5 起还能观察 mutations**（不只是 queries）——你能看到每个 mutation 的状态和它触发的失效。

### 两种模式 + 生产环境懒加载

```tsx
// 浮动模式（最常用）：屏幕角落可开合
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
<ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />

// 内嵌模式：把面板嵌进你自己的调试页
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools'
<ReactQueryDevtoolsPanel onClose={...} style={{ height: '100%' }} />
```

默认情况下，Devtools **只在开发环境打包**（`NODE_ENV === 'development'`），生产构建自动剔除。若你想在生产环境也能按需打开，可以用 `React.lazy` 懒加载生产版：

```tsx
const ReactQueryDevtoolsProduction = React.lazy(() =>
  import('@tanstack/react-query-devtools/production').then((d) => ({
    default: d.ReactQueryDevtools,
  })),
)
// 之后调用 window.toggleDevtools() 才下载并显示
```

此外，Chrome / Firefox / Edge 都有第三方的 **TanStack Query 浏览器扩展**，能直接在浏览器 DevTools 里调试，功能和框架内 devtools 包一致。

### 用 Devtools 验证本章知识

- 观察结构共享：后台刷新一个几乎没变的列表，看 data 是否「引用没变」（配合 React Devtools 的 highlight 看重渲染）；
- 观察 tracked properties：一个用了 `isFetching` 的组件 vs 没用的组件，后台刷新时谁重渲染；
- 观察 invalidate：点面板里的 Invalidate，看哪些 query 一起变 stale 并刷新。

## 8.6 默认重试 / 刷新行为总结（服务端状态收官）

把散落在第 4 章和本章的「默认值」集中成一张速查表，这是你排查「为什么它自动刷新了 / 为什么它重试了 / 为什么它没请求」的依据：

### 查询（queries）默认值

| 行为 | 默认值 | 怎么改 |
| --- | --- | --- |
| 数据新鲜度 | `staleTime: 0`（到手即过期） | 单条或全局设更大值 |
| 缓存回收 | `gcTime: 5 分钟`（inactive 后） | 改 gcTime |
| 挂载时刷新 | `refetchOnMount: true`（stale 才刷） | `false` / `'always'` |
| 窗口聚焦刷新 | `refetchOnWindowFocus: true`（stale 才刷） | `false` / `'always'` |
| 网络重连刷新 | `refetchOnReconnect: true`（stale 才刷） | `false` / `'always'` |
| 失败重试 | `retry: 3` 次，**指数退避** | 数字 / 布尔 / 函数 |
| 结构共享 | 开启 | `structuralSharing: false` |
| 属性追踪 | 自动 tracked properties | `notifyOnChangeProps` |

### 变更（mutations）默认值

| 行为 | 默认值 | 说明 |
| --- | --- | --- |
| 失败重试 | `retry: 0`（不重试） | 避免重复提交；离线失败会在重连后按序重试 |
| 并发 | 默认全部并行 | 用 `scope.id` 可让同 scope 串行 |

### 「指数退避」是什么意思

失败后不是立刻重试，而是**等待时间逐次翻倍**（约 1s、2s、4s…，有上限）。这避免「服务器刚挂就被疯狂重试打死」。默认最多重试 3 次，全失败后才把 error 暴露给 UI——这就是第 4 章说的「接口 500 了界面还转几秒圈才报错」。

### 网络模式（network mode）

TanStack Query 默认感知在线/离线状态：离线时查询会 `paused`（`fetchStatus === 'paused'`），联网后自动恢复。可用 `onlineManager` 自定义（比如 React Native 里对接 NetInfo）。这解释了为什么有时 `status` 是 pending 但 `fetchStatus` 是 paused——它想请求，但没网。

## 8.7 常见性能陷阱清单

把本章变成一份 checklist，做性能优化时对照排查：

- [ ] 有没有在 `useEffect`/`useMemo` 里依赖了整个 `useQuery` 结果对象（应依赖 `data`）？
- [ ] 有没有对 `useQuery` 结果做 rest 解构（`...rest`），关掉了 tracked properties 优化？
- [ ] 高频变化的查询（大列表），组件是否用了 `select` 只订阅需要的字段？
- [ ] `select` 是不是内联函数导致每次重跑？（提取或用 useCallback）
- [ ] `staleTime` 是不是全 0，导致每次挂载/聚焦都请求？（给稳定数据设合理 staleTime）
- [ ] 有没有对「几乎不变的数据」用了过短的 gcTime，导致频繁重新请求？
- [ ] 大列表项组件有没有用 `React.memo`？（配合结构共享才能发挥威力）
- [ ] 依赖查询是否形成了不必要的请求瀑布？（能并行就并行 / 预取）

## 本章小结与自检

- [ ] 能解释结构共享：重新拉取后尽量保留未变部分的引用，只对 JSON 兼容数据生效，可关闭或自定义；
- [ ] 知道 `useQuery` 顶层结果对象引用不稳定，但 `data` 尽量稳定——依赖要挂在 `data` 上；
- [ ] 理解 tracked properties：只为「真正用到的属性」重渲染，且 **rest 解构会关掉这个优化**；
- [ ] 会用 `select` 只订阅部分数据，并知道要用稳定引用（useCallback / 提取）避免每次重跑，且不在 select 里抛错；
- [ ] 会用 Query Devtools 观察查询/mutation 状态、手动 refetch/invalidate，知道它默认只在开发环境打包；
- [ ] 记住默认值：查询 `staleTime: 0`、`gcTime: 5min`、`retry: 3`（指数退避）、窗口聚焦刷新开启；mutation 默认不重试；
- [ ] 能解释「指数退避」和「网络模式（离线 paused）」。

服务端状态部分到此通关。接下来我们转向**客户端状态**——从第 9 章开始学 Zustand，管那些「同步的、本地的、UI 控制」的状态。

---

> 上一章：[第 7 章 进阶查询模式](./07-advanced-query-patterns.md) | 返回目录：[README](./README.md) | 下一章：[第 9 章 Zustand 基础](./09-zustand-fundamentals.md)
