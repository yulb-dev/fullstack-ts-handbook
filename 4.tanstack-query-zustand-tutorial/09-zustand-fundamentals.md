# 第 9 章：Zustand 基础——store / action / selector

> 上一章：[第 8 章 性能与调试](./08-performance-and-devtools.md) | 返回目录：[README](./README.md) | 下一章：[第 10 章 Zustand 进阶](./10-zustand-stores-and-middleware.md)

从这一章开始，我们转向**客户端状态**。回顾第 1 章：客户端状态是「同步的、本地的、只属于当前用户的 UI 状态」——筛选条件、主题、侧边栏、弹窗开关、表单草稿。它的诉求很朴素：**跨组件读写、改动时精准重渲染、必要时持久化**。

Zustand（德语「状态」，读作 "tsu-shtand"）就是为这个诉求而生的：一个**小巧、快速、无 Provider、基于 hook** 的状态管理库。官方对它的定位是「bearbones（极简骨架）的状态管理方案，基于简化的 flux 原则，API 舒适、不啰嗦、不强加观点」。

## 9.1 为什么是 Zustand，而不是 Redux / Context

Zustand 官方直接给出了对比理由，很能说明它的取舍：

**相比 Redux**：

- 简单、不强加观点（没有 action type、reducer、dispatch 那一套仪式）；
- 以 hook 作为消费状态的主要方式；
- **不需要用 Provider 包裹应用**；
- 能「瞬态地」通知组件（不触发重渲染，见 9.6）。

**相比 React Context**：

- 样板代码更少；
- **只在真正变化的部分重渲染组件**（Context 一变，所有消费者都重渲染，这是 Context 的性能痛点）；
- 集中式、基于 action 的状态管理。

它还专门处理了 React 生态里几个著名的难题（zombie child、并发渲染撕裂 tearing、混合渲染器的 context 丢失），所以你不用担心这些边角。

**一句话**：Zustand = 「全局可访问的、精准的、无 Provider 的 useState」。

## 9.2 创建你的第一个 store

Zustand 的 store **本身就是一个 hook**。用 `create` 创建，传入一个函数，返回「状态 + 修改状态的方法（action）」：

```tsx
import { create } from 'zustand'

interface BearState {
  bears: number
  increase: (by: number) => void
  removeAllBears: () => void
}

const useBearStore = create<BearState>()((set) => ({
  // 状态
  bears: 0,
  // action：通过 set 修改状态
  increase: (by) => set((state) => ({ bears: state.bears + by })),
  removeAllBears: () => set({ bears: 0 }),
}))
```

> TypeScript 用户注意：写法是 `create<State>()(...)`（多一对括号，这叫 curried/柯里化写法），不是 `create<State>(...)`。这是 Zustand 的 TS 约定，照抄即可。

然后在**任何组件**里用它——**不需要任何 Provider**：

```tsx
function BearCounter() {
  const bears = useBearStore((state) => state.bears) // ← 传入 selector
  return <h1>{bears} 只熊在这附近</h1>
}

function Controls() {
  const increase = useBearStore((state) => state.increase)
  return <button onClick={() => increase(1)}>加一只</button>
}
```

`BearCounter` 和 `Controls` 相隔多远都无所谓，它们共享同一个 store，中间不用层层传 props、不用包 Context。**这就是 Zustand 最爽的地方。**

## 9.3 set 与 get：不可变更新与状态合并

### set：默认「浅合并」

`set` 用来更新状态，它接收一个「部分状态对象」或「返回部分状态的函数」。关键：**`set` 默认做的是浅合并（merge），不是替换**。

```tsx
// store 有 { bears: 0, fish: 0 }
set({ bears: 1 })
// 结果：{ bears: 1, fish: 0 } —— fish 保留了，不是被清空
```

这等价于 `setState({ ...旧状态, ...你给的 })`。所以你更新时**只需给出变化的字段**，很省心。

### 函数式更新：基于当前状态计算

当新值依赖旧值时，传函数：

```tsx
increase: (by) => set((state) => ({ bears: state.bears + by }))
```

### 不可变（immutable）是铁律

和 React 一样，**绝不能直接改状态对象**。下面这样是错的：

```tsx
// ❌ 错误：直接 mutate，Zustand 检测不到变化，不会重渲染
increase: () => set((state) => { state.bears += 1; return state })

// ✅ 正确：返回新对象
increase: () => set((state) => ({ bears: state.bears + 1 }))
```

深层嵌套对象的不可变更新写起来很烦（要一层层展开 `{ ...state, a: { ...state.a, b: ... } }`）。这时用 **immer 中间件**能让你「假装直接改」——第 10 章详讲。

### get：在 action 里读当前状态

`create` 的函数还能拿到第二个参数 `get`，用来在 action 里读取最新状态（不订阅、不触发渲染）：

```tsx
const useSoundStore = create((set, get) => ({
  sound: 'grunt',
  play: () => {
    const sound = get().sound // 读当前状态
    console.log('播放', sound)
  },
}))
```

### 替换而非合并（小心用）

`set` 的第二个参数传 `true` 时，会**整体替换**状态（不合并）：

```tsx
deleteEverything: () => set({}, true) // 清空整个 store（连 action 都没了，慎用！）
```

这个能力很强也很危险——一不小心把 action 也冲掉。绝大多数时候用默认的合并就好。

## 9.4 selector：细粒度订阅（Zustand 的性能灵魂）

这是 Zustand 相对 Context 的核心优势，务必吃透。

`useStore(selector)` 里的 selector 决定「**这个组件订阅 store 的哪一部分**」。当 store 变化时，Zustand 会用 selector 重新计算，然后**用严格相等（`old === new`，即 `Object.is`）比较结果**：

- **结果没变（`===`）→ 组件不重渲染**；
- **结果变了 → 组件重渲染**。

```tsx
// BearCounter 只订阅 bears
const bears = useBearStore((state) => state.bears)
// 当 store 里别的字段（比如 fish）变化时，bears 的 selector 结果没变 → BearCounter 不重渲染
```

这就是**细粒度订阅**：每个组件只为自己真正关心的那部分状态的重渲染买单。相比之下，Context 里 value 一变，**所有** `useContext` 的组件全部重渲染，无论它们关不关心那个变化。

### 一次取多个字段：v5 的大坑与 useShallow

新手常这么写，想一次拿多个字段：

```tsx
// ❌ 危险：每次返回一个新对象 { bears, fish }，Object.is 永远不相等 → 每次 store 变化都重渲染
const { bears, fish } = useBearStore((state) => ({ bears: state.bears, fish: state.fish }))
```

问题在于：selector 返回了一个**新对象字面量**，即使 `bears` 和 `fish` 的值没变，`{...} === {...}` 永远是 `false`，于是**任何** store 变化都会让这个组件重渲染——细粒度订阅的优势荡然无存。

> **v5 重要变化**：Zustand v4 时代，很多人靠给 selector 传第二个参数 `shallow` 来解决（`useStore(selector, shallow)`）。**v5 移除了这个默认行为**——现在 `useStore(selector)` 只接受一个 selector，自定义相等函数要用 `createWithEqualityFn`。官方推荐的正确做法是 **`useShallow`**：

```tsx
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

// ✅ 用 useShallow 包裹：做"浅比较"，只要各字段值没变就不重渲染
const { bears, fish } = useBearStore(
  useShallow((state) => ({ bears: state.bears, fish: state.fish })),
)

// 数组形式也可以
const [bears, fish] = useBearStore(useShallow((state) => [state.bears, state.fish]))

// 取对象的所有 key（key 的顺序/数量没变就不重渲染）
const names = useBearStore(useShallow((state) => Object.keys(state)))
```

`useShallow` 的作用：把「严格相等」放宽成「**浅相等**」——逐字段比较对象/数组的一层。这样返回新对象也没关系，只要**内容**没变就不重渲染。

**记住这条 v5 铁律**：**只要 selector 返回的是新建的对象或数组，就用 `useShallow` 包起来。** 返回单个原始值（数字、字符串、布尔）或单个 action（函数引用稳定）时，不需要 useShallow。

### action 的引用是稳定的

你可能担心「每次取 action 会不会也触发重渲染」。不会：`set` 定义的 action 函数在 store 创建时就固定了，引用稳定，所以：

```tsx
// ✅ 取单个 action，引用稳定，不会导致多余重渲染
const increase = useBearStore((state) => state.increase)
```

## 9.5 派生状态（Derived State）

「派生状态」指**从已有状态计算出来的值**，比如「已完成任务数」是从「任务数组」算出来的。处理派生状态有个黄金原则：

> **不要存储能算出来的值。** 派生值应该在读取时计算，而不是作为独立状态存起来手动同步——后者是「两份真相」的另一种形式，极易不一致。

Zustand 里计算派生值有两种主流方式：

### 方式一：在 selector 里计算（推荐用于简单派生）

```tsx
const useTaskStore = create((set) => ({
  tasks: [] as Task[],
  // ...
}))

// 直接在 selector 里算"已完成数量"
const doneCount = useTaskStore((state) => state.tasks.filter((t) => t.status === 'done').length)
```

⚠️ **但要注意**：如果 selector 返回的是**新数组/新对象**（如 `filter` 的结果），就会遇到 9.4 的问题——每次 store 变化都重渲染。所以：

- 派生结果是**原始值**（数字、布尔、字符串）：直接在 selector 里算，没问题（如上例的 `.length`）；
- 派生结果是**数组/对象**：要么用 `useShallow`，要么放到组件外用 `useMemo`。

### 方式二：取出源数据，在组件里用 useMemo 计算（推荐用于复杂/昂贵派生）

```tsx
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'

function DoneList() {
  // 只订阅 tasks（用 useShallow 保证数组内容没变就不重渲染）
  const tasks = useTaskStore(useShallow((state) => state.tasks))

  // 在组件里用 useMemo 做派生，只在 tasks 变时重算
  const doneTasks = useMemo(() => tasks.filter((t) => t.status === 'done'), [tasks])

  return <ul>{doneTasks.map((t) => <li key={t.id}>{t.title}</li>)}</ul>
}
```

两种方式怎么选：

| 派生结果 | 计算成本 | 推荐做法 |
| --- | --- | --- |
| 原始值（count、boolean） | 低 | selector 里直接算 |
| 数组/对象 | 低 | selector + `useShallow` |
| 数组/对象 | 高 | 取源数据 + 组件内 `useMemo` |

无论哪种，核心都是**不额外存储派生值**，让它永远和源数据保持一致。

## 9.6 在组件之外读写状态：getState / setState / subscribe

有时你需要在**非 React 环境**（工具函数、事件总线、定时器）里访问 store。Zustand 的 hook 上挂了几个实用方法：

```tsx
const useDogStore = create(() => ({ paw: true, snout: true }))

// 读取当前状态（非响应式，不会触发渲染）
const paw = useDogStore.getState().paw

// 直接更新状态（会触发订阅者）
useDogStore.setState({ paw: false })

// 订阅所有变化（每次变化同步触发）
const unsub = useDogStore.subscribe((state) => console.log(state))
unsub() // 取消订阅
```

> ⚠️ 官方警告：`getState`/`setState` 这种「在 React 外部访问」的技巧**不推荐用于 React Server Components**（如 Next.js 13+ 的 app 目录），可能导致意外 bug 和用户数据隐私问题。在纯客户端场景用没问题。

### subscribeWithSelector：只订阅某个字段的变化

基础的 `subscribe` 会在**任何**状态变化时触发。如果你只想监听某个字段，用 `subscribeWithSelector` 中间件（第 10 章会归类讲中间件）：

```tsx
import { subscribeWithSelector } from 'zustand/middleware'

const useDogStore = create(subscribeWithSelector(() => ({ paw: true })))

// 只在 paw 变化时触发
const unsub = useDogStore.subscribe((state) => state.paw, (paw, prevPaw) => {
  console.log('paw 从', prevPaw, '变成', paw)
})
```

## 9.7 瞬态更新（Transient Updates）：不触发重渲染地响应变化

对于**高频变化**的状态（比如鼠标坐标、拖拽位置），每次都触发 React 重渲染代价太大。Zustand 允许你用 `subscribe` 在**不经过 React 渲染**的情况下响应变化，直接操作 DOM 或 ref：

```tsx
const useScratchStore = create((set) => ({ scratches: 0 }))

const Component = () => {
  const scratchRef = useRef(useScratchStore.getState().scratches)
  // 挂载时订阅、卸载时自动退订，把变化写进 ref（不触发渲染）
  useEffect(
    () => useScratchStore.subscribe((state) => (scratchRef.current = state.scratches)),
    [],
  )
  // ... 需要时读 scratchRef.current
}
```

官方说这在「允许你直接改视图」的场景下能带来**巨大的性能提升**。这是 Zustand 相对其它方案的一个独特能力，普通业务用得少，但知道它存在很有用。

## 9.8 异步 action：Zustand 不关心

Zustand 对异步没有任何特殊处理——**你在 action 里写 async，等结果回来再 `set` 就行**：

```tsx
const useFishStore = create((set) => ({
  fishies: {},
  fetch: async (pond: string) => {
    const response = await fetch(pond)
    set({ fishies: await response.json() }) // 数据回来后 set
  },
}))
```

> 🚨 **但是——打住！** 看到这里你可能想：「那我用 Zustand 的异步 action 去请求服务器数据不就行了，还要 TanStack Query 干嘛？」**这正是第 1 章反复警告的反模式。** 用上面这种写法，你得自己处理 loading、error、缓存、去重、重试、失效、竞态……等于手搓一个残缺版 TanStack Query。**Zustand 的异步 action 适合「客户端状态相关的异步」**（比如「异步地把主题偏好写进 IndexedDB」），**不适合当作服务端数据的获取层**。第 12 章会把这条边界钉死。

## 9.9 实战：TaskFlow 的 UI store

把本章所学落地。TaskFlow 的 UI 状态（第 1 章列过）交给 Zustand——注意这里**只有 UI 状态，没有任何服务器数据**：

```tsx
// src/stores/useUiStore.ts
import { create } from 'zustand'
import type { TaskStatus } from '../api/mockApi'

type ViewMode = 'list' | 'board'

interface UiState {
  // —— 状态 ——
  filter: TaskStatus | 'all'   // 当前筛选（客户端状态！不是筛选后的数据）
  viewMode: ViewMode           // 列表 or 看板
  sidebarCollapsed: boolean    // 侧边栏是否折叠
  isComposerOpen: boolean      // 新建任务弹窗是否打开
  draftTitle: string           // 新建任务的表单草稿

  // —— actions ——
  setFilter: (f: TaskStatus | 'all') => void
  setViewMode: (m: ViewMode) => void
  toggleSidebar: () => void
  openComposer: () => void
  closeComposer: () => void
  setDraftTitle: (t: string) => void
}

export const useUiStore = create<UiState>()((set) => ({
  filter: 'all',
  viewMode: 'list',
  sidebarCollapsed: false,
  isComposerOpen: false,
  draftTitle: '',

  setFilter: (filter) => set({ filter }),
  setViewMode: (viewMode) => set({ viewMode }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  openComposer: () => set({ isComposerOpen: true }),
  closeComposer: () => set({ isComposerOpen: false, draftTitle: '' }), // 关闭时清空草稿
  setDraftTitle: (draftTitle) => set({ draftTitle }),
}))
```

在组件里**细粒度订阅**：

```tsx
// 筛选栏：只订阅 filter 和 setFilter
function FilterBar() {
  const filter = useUiStore((s) => s.filter)
  const setFilter = useUiStore((s) => s.setFilter)
  return (
    <nav>
      {(['all', 'todo', 'doing', 'done'] as const).map((f) => (
        <button key={f} onClick={() => setFilter(f)}
                style={{ fontWeight: filter === f ? 'bold' : 'normal' }}>
          {f}
        </button>
      ))}
    </nav>
  )
}

// 侧边栏：只订阅 sidebarCollapsed 和 toggleSidebar —— filter 变化时它不会重渲染
function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggle = useUiStore((s) => s.toggleSidebar)
  return <aside style={{ width: collapsed ? 48 : 200 }} onClick={toggle}>…</aside>
}
```

**关键协作点**：这个 `filter` 是**客户端状态**（用户选了什么），它在 Zustand 里。而「按 filter 查出来的任务列表」是**服务端状态**，用 TanStack Query，并把 filter 放进 query key：

```tsx
function TaskList() {
  const filter = useUiStore((s) => s.filter) // ← 从 Zustand 读 UI 状态
  const { data, isPending } = useQuery({
    queryKey: ['tasks', { status: filter }], // ← filter 进了 query key
    queryFn: () => fetchTasks({ status: filter }),
  })
  // ...渲染 data
}
```

看到没？**两个库在这里优雅协作**：Zustand 提供「用户的选择」，TanStack Query 用这个选择去「获取并缓存对应的服务器数据」。它们各管各的，通过 query key 这个接口连接。这就是第 1 章说的「分工而非竞争」的活教材。

## 本章小结与自检

- [ ] 知道 Zustand 是「无 Provider、基于 hook、细粒度订阅」的客户端状态库，能说出它相比 Redux / Context 的优势；
- [ ] 会用 `create<State>()((set, get) => ({...}))` 建 store，理解 `set` 默认浅合并、`get` 读当前状态；
- [ ] 牢记不可变更新，知道深层嵌套可用 immer（下一章）；
- [ ] **吃透 selector 细粒度订阅**：只为 selector 结果的变化重渲染，默认严格相等（Object.is）；
- [ ] 记住 **v5 铁律**：selector 返回新对象/数组时用 `useShallow` 包裹，否则每次都重渲染；知道 v5 移除了旧的 `shallow` 第二参数写法；
- [ ] 理解派生状态黄金原则「不存储能算出来的值」，会按「结果类型 + 计算成本」选 selector 内计算或 useMemo；
- [ ] 会用 `getState`/`setState`/`subscribe` 在组件外访问，知道 RSC 下的警告；
- [ ] 知道 Zustand 的异步 action **不应用于服务端数据获取**（那是 TanStack Query 的活）。

下一章讲 Zustand 的工程化：store 变大后怎么拆分（slices 模式）、多个 store 的策略，以及 immer / devtools 等中间件。

---

> 上一章：[第 8 章 性能与调试](./08-performance-and-devtools.md) | 返回目录：[README](./README.md) | 下一章：[第 10 章 Zustand 进阶](./10-zustand-stores-and-middleware.md)
