# 第 10 章：Zustand 进阶——多 store 拆分与中间件

> 上一章：[第 9 章 Zustand 基础](./09-zustand-fundamentals.md) | 返回目录：[README](./README.md) | 下一章：[第 11 章 Zustand persist](./11-zustand-persist.md)

随着功能增多，一个 store 会越长越大、越来越难维护。这一章讲 Zustand 的工程化：**怎么拆分 store**（多 store vs slices 模式），以及三个最常用的**中间件**（immer、devtools、subscribeWithSelector）。

## 10.1 拆分策略：两条路，怎么选

Zustand 官方提供了组织大型状态的两种主流思路，先给结论，再展开：

| 策略 | 做法 | 适合场景 |
| --- | --- | --- |
| **多个独立 store** | 按领域建多个 `create()`，各自独立 | 领域之间**几乎没有关联**，可独立演化 |
| **一个 store + slices 模式** | 把逻辑拆成多个「slice 创建函数」，最后合并成一个 store | 领域之间**需要互相读写**（一个 action 要同时改多块状态） |

核心判断标准：**这些状态之间需不需要「在一个 action 里同时改动」？**

- 需要（比如「下单」这个 action 要同时清空购物车、设置订单状态、记录时间）→ 用 **slices 合并成一个 store**，因为一个 store 里的 action 能方便地读写所有 slice；
- 不需要（比如「主题」和「购物车」八竿子打不着）→ 用**多个独立 store**，各自简单。

### 为什么不像 Redux 那样「必须一个大 store」

因为 Zustand 的 store **不需要 Provider**，多个 store 并存零成本——组件想订阅哪个就 `useXxxStore(selector)`。所以「多 store」在 Zustand 里是很自然的选择，不像 Context 那样每个 Provider 都要包一层。

## 10.2 多个独立 store（推荐作为默认）

对 TaskFlow，我们可以把「UI 状态」和「用户偏好」拆成两个互不相关的 store：

```tsx
// src/stores/useUiStore.ts —— 视图控制（第 9 章写过）
export const useUiStore = create<UiState>()((set) => ({ /* filter, viewMode, sidebar... */ }))

// src/stores/usePreferencesStore.ts —— 用户偏好（可持久化，见第 11 章）
interface PreferencesState {
  theme: 'light' | 'dark'
  density: 'comfortable' | 'compact'
  setTheme: (t: 'light' | 'dark') => void
  toggleDensity: () => void
}

export const usePreferencesStore = create<PreferencesState>()((set) => ({
  theme: 'light',
  density: 'comfortable',
  setTheme: (theme) => set({ theme }),
  toggleDensity: () => set((s) => ({ density: s.density === 'compact' ? 'comfortable' : 'compact' })),
}))
```

组件各取所需，互不干扰：

```tsx
const theme = usePreferencesStore((s) => s.theme)   // 只订阅主题
const filter = useUiStore((s) => s.filter)          // 只订阅筛选
```

**优点**：每个 store 职责单一、体积小、好测试、好持久化（第 11 章会给不同 store 配不同的持久化策略）。**这是推荐的默认组织方式。**

## 10.3 slices 模式：拆文件、合成一个 store

当多块状态**需要在一个 action 里协同改动**时，用官方推荐的 **slices 模式**：把每块状态写成独立的「slice 创建函数」，最后用一个 `create` 把它们**展开合并**成一个 store。

### 第一步：把每块状态写成 slice

一个 slice 就是一个普通的「状态创建函数」，签名和传给 `create` 的函数一样（接收 `set`、`get`）：

```tsx
// src/store/slices/fishSlice.ts
import type { StateCreator } from 'zustand'

export interface FishSlice {
  fishes: number
  addFish: () => void
}

export const createFishSlice: StateCreator<FishSlice> = (set) => ({
  fishes: 0,
  addFish: () => set((state) => ({ fishes: state.fishes + 1 })),
})
```

```tsx
// src/store/slices/bearSlice.ts
import type { StateCreator } from 'zustand'

export interface BearSlice {
  bears: number
  addBear: () => void
  eatFish: () => void   // ← 注意：这个 action 要改 fishSlice 的状态！
}

// 泛型第二个参数是"整个合并后 store 的类型"，这样 eatFish 里能访问 fishes
export const createBearSlice: StateCreator<BearSlice & FishSlice, [], [], BearSlice> = (set) => ({
  bears: 0,
  addBear: () => set((state) => ({ bears: state.bears + 1 })),
  eatFish: () => set((state) => ({ fishes: state.fishes - 1 })), // 跨 slice 改状态
})
```

### 第二步：合并成一个 store

```tsx
// src/store/useBoundStore.ts
import { create } from 'zustand'
import { createBearSlice, type BearSlice } from './slices/bearSlice'
import { createFishSlice, type FishSlice } from './slices/fishSlice'

export const useBoundStore = create<BearSlice & FishSlice>()((...a) => ({
  ...createBearSlice(...a), // 展开每个 slice
  ...createFishSlice(...a),
}))
```

`(...a)` 是把 `create` 传给状态创建函数的所有参数（`set`、`get`、`store`）原样转发给每个 slice。合并后，`useBoundStore` 里既有 bear 又有 fish，且 `eatFish` 能改 `fishes`——**这就是「多块状态需要协同」时用 slices 的理由**。

### 跨 slice 调用 action

一个 slice 的 action 可以通过 `get()` 调用另一个 slice 的 action：

```tsx
export const createBearFishSlice: StateCreator<BearSlice & FishSlice, [], [], { addBearAndFish: () => void }> =
  (set, get) => ({
    addBearAndFish: () => {
      get().addBear() // 调 bearSlice 的 action
      get().addFish() // 调 fishSlice 的 action
    },
  })
```

### slices 模式使用注意

- **中间件只在合并处（`create` 那一层）加，不要加在单个 slice 里**（官方明确警告：加在 slice 内部会导致意外问题）。比如要 persist，包在合并后的状态创建函数外面（见 10.4 末尾示例）。
- slice 之间通过泛型声明「我能看到的完整状态类型」来获得跨 slice 的类型提示（如上面 `StateCreator<BearSlice & FishSlice, [], [], BearSlice>` 的写法）。
- 组件消费方式不变：`useBoundStore((s) => s.bears)`，照常细粒度订阅。

## 10.4 中间件（Middleware）

Zustand 的中间件是**包裹状态创建函数**的高阶函数，用来增强 store。用法统一是 `create(middleware((set) => ({...})))`。三个最常用的：

### ① immer：让嵌套更新「可直改」

深层嵌套的不可变更新写起来很痛苦。immer 中间件让你「假装直接改」，它在背后帮你生成不可变的新状态：

```tsx
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

interface LushState {
  lush: { forest: { contains: { a: string } | null } }
  clearForest: () => void
}

const useLushStore = create<LushState>()(
  immer((set) => ({
    lush: { forest: { contains: { a: 'bear' } } },
    clearForest: () =>
      set((state) => {
        state.lush.forest.contains = null // ← 看起来像直接 mutate，其实 immer 帮你不可变更新
      }),
  })),
)
```

需要 `npm install immer`。**规则**：用了 immer，就在 `set` 的函数里「直接改」state（不要 return 新对象）；这是它和原生写法唯一的区别。深层结构多的 store 强烈建议用它。

> 也可以不用中间件，直接在 `set` 里手动调 immer 的 `produce`：`set(produce((state) => { state.x = 1 }))`。中间件版更简洁。

### ② devtools：接入 Redux DevTools 调试

Zustand 能接入浏览器的 **Redux DevTools 扩展**，实现状态变化的时间旅行调试：

```tsx
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

const useBearStore = create(devtools((set) => ({
  bears: 0,
  // 给 set 传第三个参数作为 action 名，DevTools 里就能看到有意义的名字
  addBear: () => set((s) => ({ bears: s.bears + 1 }), false, 'bear/addBear'),
})))
```

- 给 store 起名字，方便区分：`devtools(..., { name: 'BearStore' })`；
- 生产环境可关闭：`devtools(..., { enabled: process.env.NODE_ENV === 'development' })`；
- 不传 action 名时会显示为 `anonymous`（可用 `anonymousActionType` 自定义默认名）。

### ③ subscribeWithSelector：组件外按字段订阅

第 9 章提过，这里正式归入中间件体系。它让 store 的 `subscribe` 支持「只监听某个 selector 结果的变化」：

```tsx
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

const useDogStore = create(subscribeWithSelector(() => ({ paw: true, fur: true })))

// 只在 paw 变化时触发；还能拿旧值、配自定义相等函数、立即触发
const unsub = useDogStore.subscribe(
  (state) => state.paw,
  (paw, prevPaw) => console.log(paw, prevPaw),
  { equalityFn: shallow, fireImmediately: true },
)
```

### 组合多个中间件

中间件可以嵌套组合，顺序从外到内。**注意 TypeScript 写法**：组合时类型标注会复杂些，常见顺序是 `devtools(persist(immer(...)))`：

```tsx
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

const useStore = create<State>()(
  devtools(
    persist(
      immer((set) => ({ /* ... */ })),
      { name: 'my-storage' },
    ),
  ),
)
```

### slices + 中间件：只在合并层加

回到 10.3 的注意事项——给 slices 合并的 store 加 persist：

```tsx
export const useBoundStore = create(
  persist(
    (...a) => ({
      ...createBearSlice(...a),
      ...createFishSlice(...a),
    }),
    { name: 'bound-store' }, // ← 中间件加在合并这一层，不是 slice 内部
  ),
)
```

## 10.5 vanilla store + Context：需要「每实例独立」时

`create` 出来的 store 是**模块级单例**——整个应用共享一份。但有时你需要「每个组件实例有自己独立的 store」（比如一个可复用的、内部有状态的组件被渲染多次，各自状态要隔离），或想做依赖注入。这时用 **vanilla store + React Context**：

```tsx
import { createContext, useContext } from 'react'
import { createStore, useStore } from 'zustand'

// createStore 造一个"纯 store"（不是 hook）
const store = createStore((set) => ({ count: 0, inc: () => set((s) => ({ count: s.count + 1 })) }))

const StoreContext = createContext(store)

// Provider 提供（可能是每次新建的）store 实例
function App() {
  return <StoreContext.Provider value={store}>{/* ... */}</StoreContext.Provider>
}

// 组件里用 useStore + selector 消费 context 里的 store
function Counter() {
  const ctxStore = useContext(StoreContext)
  const count = useStore(ctxStore, (s) => s.count)
  return <span>{count}</span>
}
```

这是官方推荐的「需要 context」场景的标准做法（v4 起）。**绝大多数应用用不到它**——记住「Zustand 默认不需要 Provider，只有需要每实例独立 store 时才用 vanilla + context」即可。

> ⚠️ 用 vanilla store 时注意：修改 `set`/`get` 的中间件（如某些用法）**不会**作用于 `getState`/`setState`，官方有明确说明。

## 10.6 实战：TaskFlow 的 store 组织方案

综合本章，给 TaskFlow 一个清晰的客户端状态组织：

```
src/stores/
├─ useUiStore.ts           # 视图控制：filter / viewMode / sidebar / composer（不持久化，刷新丢失无所谓）
├─ usePreferencesStore.ts  # 用户偏好：theme / density（用 persist 持久化，第 11 章）
└─ useComposerStore.ts     # 新建任务弹窗的表单草稿（可选：独立出来，因为它和列表交互频繁）
```

**决策依据回顾**：

- 这三个 store 领域不同、**几乎不需要在一个 action 里协同改动** → 用**多个独立 store**（10.2），而不是 slices；
- 如果哪天出现「切换视图模式时要同时重置筛选和滚动位置」这种**跨领域协同**的需求，再把相关的两块用 **slices 合并**（10.3）；
- 偏好 store 需要**跨刷新保留** → 给它加 `persist`（下一章）；UI store 不需要 → 不加，保持简单。

**再次强调边界**：这三个 store 里**没有任何一个装服务器数据**（任务列表、任务详情）。那些是 TanStack Query 的领地。Zustand 这里装的全是「用户把界面调成了什么样」——这正是第 1 章的心智模型在代码结构上的体现。

## 本章小结与自检

- [ ] 能说出两种拆分策略（多独立 store vs slices 合并），并知道判断标准是「是否需要在一个 action 里协同改动多块状态」；
- [ ] 知道 Zustand 多 store 零成本（无需 Provider），默认推荐多个独立 store；
- [ ] 会用 slices 模式：把状态拆成 `StateCreator` 函数、用 `(...a)` 展开合并、跨 slice 用 `get()` 调用；
- [ ] 记住「中间件只在合并层加，不加在 slice 内部」；
- [ ] 会用三个常用中间件：`immer`（嵌套可直改）、`devtools`（接 Redux DevTools）、`subscribeWithSelector`（组件外按字段订阅），并知道组合写法与顺序；
- [ ] 知道 vanilla store + Context 用于「每实例独立 store / 依赖注入」，绝大多数应用用不到；
- [ ] 能给一个真实项目设计 store 组织结构，并守住「Zustand 不装服务器数据」的边界。

下一章是 Zustand 的持久化：`persist` 中间件的 `partialize`、`version`/`migrate`，以及一条**安全红线**——持久化存储绝不能放秘密。

---

> 上一章：[第 9 章 Zustand 基础](./09-zustand-fundamentals.md) | 返回目录：[README](./README.md) | 下一章：[第 11 章 Zustand persist](./11-zustand-persist.md)
