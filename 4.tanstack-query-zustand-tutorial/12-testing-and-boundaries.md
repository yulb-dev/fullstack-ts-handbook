# 第 12 章：测试与架构边界

> 上一章：[第 11 章 Zustand persist](./11-zustand-persist.md) | 返回目录：[README](./README.md) | 下一章：[第 13 章 综合实战与逐项验收](./13-capstone-project.md)

两个库都学完了，这一章做两件收官的事：一是**怎么测**（TanStack Query 和 Zustand 各有必须遵守的隔离规则），二是把散落在各章的**架构边界**钉死——尤其是那条最重要的铁律：**不要把服务端数据复制一份进 Zustand**。

## 12.1 测试 TanStack Query：每个测试隔离一个 QueryClient

TanStack Query 的一切围绕 `QueryClient`（缓存大脑）。测试时的头号原则来自官方文档：

> **为每个测试创建一个全新的 `QueryClient`，确保测试之间完全隔离，互不影响。**

原因很简单：`QueryClient` 持有缓存。如果多个测试共享同一个 client，前一个测试往缓存里写的数据会「泄漏」到后一个测试，导致诡异的、依赖执行顺序的失败。

### 标准做法：用 wrapper 提供全新 client

测试自定义 hook 用 React Testing Library 的 `renderHook`，并通过 `wrapper` 提供 `QueryClientProvider`：

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export function useCustomHook() {
  return useQuery({ queryKey: ['customHook'], queryFn: () => 'Hello' })
}

// ✅ 每次调用 createWrapper 都 new 一个 QueryClient → 测试隔离
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false, // ← 关键：关掉重试，否则测错误场景会等到超时
      },
    },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

test('返回 Hello', async () => {
  const { result } = renderHook(() => useCustomHook(), { wrapper: createWrapper() })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(result.current.data).toEqual('Hello')
})
```

### 三个必须知道的测试配置

1. **`retry: false`（或调小）**：库默认失败重试 3 次 + 指数退避。测「查询失败」的场景时，如果不关重试，测试会**卡到超时**才失败。官方明确指出这一点。注意：**只有当你的 `useQuery` 没有显式设 retry 时，这个默认值才生效**（显式设的优先级更高）。

2. **每个测试独立 client**：如上，用工厂函数 `createWrapper()`，**不要**在模块顶层建一个共享的 client 给所有测试用。如果你确实想复用 wrapper，官方要求「确保每个测试前清空 client，且测试不并行」。最省心的还是每个测试 new 一个。

3. **Jest 用户设 `gcTime: Infinity`**：如果你用 Jest，官方建议把 `gcTime` 设成 `Infinity`，以避免「Jest did not exit one second after the test run completed」的报错（因为有定时器还在跑）。这是服务端上的默认行为，只在你**显式设过 gcTime** 时才需要特意改：
   ```tsx
   const queryClient = new QueryClient({
     defaultOptions: { queries: { retry: false, gcTime: Infinity } },
   })
   ```

### 测试网络调用：mock 掉接口

TanStack Query 的核心是缓存网络请求，所以你要能 mock 网络。两种方式：

- **nock**（拦截 HTTP）：
  ```tsx
  const scope = nock('http://example.com').get('/api/data').reply(200, { answer: 42 })
  const { result } = renderHook(() => useFetchData(), { wrapper: createWrapper() })
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(result.current.data).toEqual({ answer: 42 })
  scope.done()
  ```
- **MSW（Mock Service Worker）**：官方和社区更推荐，因为它在网络层拦截，**你的应用代码完全不用改**，测试更接近真实。Zustand 官方文档也推荐用 MSW。

### 测试无限滚动

测 `useInfiniteQuery` 的要点是「mock 按页返回不同数据 + await 每一页断言」：

```tsx
const scope = nock('http://example.com').persist().get('/api/data').query(true)
  .reply(200, (uri) => {
    const { page } = Object.fromEntries(new URL(`http://example.com${uri}`).searchParams)
    return generateMockedResponse(Number(page))
  })

const { result } = renderHook(() => useInfiniteCustomHook(), { wrapper: createWrapper() })
await waitFor(() => expect(result.current.isSuccess).toBe(true))
expect(result.current.data.pages).toStrictEqual([generateMockedResponse(1)])

result.current.fetchNextPage()
await waitFor(() =>
  expect(result.current.data.pages).toStrictEqual([
    generateMockedResponse(1),
    generateMockedResponse(2),
  ]),
)
```

### 测组件而非只测 hook

更推荐用 React Testing Library **渲染真实组件**、模拟用户交互、断言界面——这样测的是「用户看到的行为」，而不是实现细节：

```tsx
render(<TaskList />, { wrapper: createWrapper() })
expect(await screen.findByText('任务 #1')).toBeInTheDocument()
```

## 12.2 测试 Zustand：每个测试后重置 store

Zustand 的 store 是**模块级单例**——测试之间同样会互相污染（前一个测试改了 store，后一个测试读到脏数据）。官方给的解法是：**在每个测试后把 store 重置回初始状态。**

### 核心：用 getInitialState + setState 重置

官方推荐的通用 mock（放在 `__mocks__/zustand.ts`，Jest/Vitest 通用思路）：拦截 `create`，为每个 store 记录它的初始状态，并在 `afterEach` 里把所有 store 重置回去：

```ts
// __mocks__/zustand.ts（简化示意，完整版见 Zustand 官方 testing 文档）
import { act } from '@testing-library/react'
import * as ZustandExportedTypes from 'zustand'
export * from 'zustand'

const { create: actualCreate } = await vi.importActual<typeof ZustandExportedTypes>('zustand')

// 收集所有 store 的 reset 函数
export const storeResetFns = new Set<() => void>()

const createUncurried = <T>(stateCreator: ZustandExportedTypes.StateCreator<T>) => {
  const store = actualCreate(stateCreator)
  const initialState = store.getInitialState() // ← v5 提供的 getInitialState
  storeResetFns.add(() => store.setState(initialState, true)) // true = 整体替换
  return store
}

export const create = (<T>(sc: ZustandExportedTypes.StateCreator<T>) =>
  typeof sc === 'function' ? createUncurried(sc) : createUncurried) as typeof ZustandExportedTypes.create

// 每个测试后重置所有 store
afterEach(() => {
  act(() => { storeResetFns.forEach((resetFn) => resetFn()) })
})
```

关键机制：

- **`getInitialState()`**：Zustand v5 的 store 上就有这个方法，返回创建时的初始状态；
- **`setState(initialState, true)`**：第二个参数 `true` 表示**整体替换**（而非合并），彻底回到初始态；
- **`afterEach` 里 `act()` 包裹**：确保 React 感知到状态变化，避免 act 警告。

> Vitest 用户注意：官方文档特别提醒 `__mocks__` 目录的位置要和你配置的 `root` 对应（比如 root 改成 `./src`，mock 就要放 `./src/__mocks__`）。Jest 和 Vitest 在 ESM/CJS 上也有细微差异（`vi.importActual` vs `jest.requireActual`），照抄对应版本的官方示例即可。

### 手动重置（不想用全局 mock 时）

如果你只有一两个 store，也可以直接手动重置：

```ts
const initialUiState = useUiStore.getState() // 在测试文件顶部先存一份

beforeEach(() => {
  useUiStore.setState(initialUiState, true) // 每个测试前重置
})
```

或者干脆给 store 加一个 `reset` action（对测试和「恢复默认设置」功能都有用）：

```tsx
const useUiStore = create<UiState & { reset: () => void }>()((set) => {
  const initial = { filter: 'all', viewMode: 'list', /* ... */ }
  return { ...initial, /* actions... */, reset: () => set(initial) }
})
```

### 测试时直接读写 store

因为 store 是单例、且有 `getState`/`setState`，测试里可以**不渲染组件**直接操作和断言：

```ts
test('inc 增加计数', () => {
  expect(useCounterStore.getState().count).toBe(1)
  useCounterStore.getState().inc()
  expect(useCounterStore.getState().count).toBe(2)
})
```

组件测试则配合 RTL + userEvent（官方推荐），网络用 MSW mock。

## 12.3 架构边界：数据到底该放哪（本章灵魂）

现在把第 1 章的心智模型 + 前 11 章的工具，落成一套**可执行的边界规则**。

### 铁律一：绝不把服务端数据复制进 Zustand

这是全书最重要的一条规则，值得单独强调。反面教材：

```tsx
// ❌ 灾难反模式：把 TanStack Query 拿到的服务器数据"抄一份"进 Zustand
const useTaskStore = create((set) => ({
  tasks: [], // ← 服务器数据的副本！
}))

function TaskList() {
  const { data } = useQuery({ queryKey: ['tasks'], queryFn: fetchTasks })
  const setTasks = useTaskStore((s) => s.setTasks)
  useEffect(() => { setTasks(data.items) }, [data]) // ← 手动同步，噩梦开始
  // ...
}
```

为什么这是灾难：

1. **两份真相**：数据同时存在于 Query 缓存和 Zustand store。哪个对？什么时候同步？一旦某处只改了一份，界面就矛盾；
2. **手动同步地狱**：你得写 `useEffect` 把 data 抄进 store，还要处理 stale、竞态、mutation 后的更新——把 TanStack Query 帮你做掉的事又手动做一遍，还做得更差；
3. **失去 TanStack Query 的一切好处**：缓存、去重、失效、结构共享、后台刷新……全都用不上了，因为你绕过了它的数据；
4. **难以调试**：Devtools 里看到的缓存和 Zustand 里的副本对不上。

**正确做法**：服务器数据**只活在 TanStack Query 的缓存里**，组件直接从 `useQuery` 读。需要「派生」就在渲染时算（或用 `select`），**不要复制进另一个 store**。

```tsx
// ✅ 正确：服务器数据只从 useQuery 读，Zustand 只放 UI 状态
function TaskList() {
  const filter = useUiStore((s) => s.filter)         // UI 状态：从 Zustand
  const { data } = useQuery({                        // 服务器数据：从 Query
    queryKey: ['tasks', { status: filter }],
    queryFn: () => fetchTasks({ status: filter }),
  })
  return <ul>{data?.items.map((t) => <li key={t.id}>{t.title}</li>)}</ul>
}
```

### 铁律二：用「真相来源」判断归属

遇到一块数据，问自己：**它的「真相」在哪？**

| 数据 | 真相来源 | 归属 | 工具 |
| --- | --- | --- | --- |
| 任务列表、任务详情、评论 | 服务器 | 服务端状态 | TanStack Query |
| 当前筛选、排序、视图模式 | 用户的 UI 操作 | 客户端状态 | Zustand（或局部 useState） |
| 主题、语言、密度偏好 | 用户偏好（要持久化） | 客户端状态 | Zustand + persist |
| 弹窗开关、表单草稿 | 临时 UI | 客户端状态 | Zustand 或局部 useState |
| 登录 token | 服务器签发 | **敏感凭证** | HttpOnly Cookie / 内存（**不进 localStorage**，见第 11 章） |
| 「已完成任务数」 | 从任务列表算出 | 派生值 | 渲染时用 `select`/`useMemo` 算，**不单独存** |

### 铁律三：派生值不落地存储

第 9 章讲过：能从已有状态算出来的值（计数、过滤结果、格式化文本），**在读取时算**，不要作为独立状态存起来手动同步。这在 TanStack Query 里用 `select`，在 Zustand 里用 selector 计算或 `useMemo`。「存派生值」= 「制造第二份真相」= 迟早不一致。

### 铁律四：两者协作的正确姿势——通过 query key 连接

Zustand 和 TanStack Query 不是各自为战，而是**通过 query key 这个接口协作**。记住这个黄金模式，它贯穿全书：

```
用户操作 UI（Zustand 更新客户端状态，如 filter='done'）
        │
        ▼
组件订阅 Zustand 拿到 filter
        │
        ▼
把 filter 放进 query key → useQuery({ queryKey: ['tasks', {status: filter}] })
        │
        ▼
TanStack Query 检测到 key 变了 → 自动获取/缓存对应的服务器数据
        │
        ▼
用户点「新增」→ useMutation → onSuccess 里 invalidateQueries(['tasks'])
        │
        ▼
TanStack Query 重新拉取 → 界面更新（Zustand 全程不碰服务器数据）
```

一句话：**Zustand 管「用户想看什么」，TanStack Query 管「按这个意图去拿并缓存服务器数据」。它们通过 query key 对话，各自不越界。**

### 常见反模式清单（对照自查）

- [ ] 把 useQuery 的 data 用 useEffect 抄进 Zustand/Redux；
- [ ] 在 Zustand 里写异步 action 去 fetch 服务器数据（手搓残缺版 Query）；
- [ ] 把「已完成数量」这类派生值单独存成一个 state 字段；
- [ ] 把 token/密码存进 persist / localStorage；
- [ ] 测试时多个用例共享同一个 QueryClient / 不重置 Zustand store；
- [ ] queryFn 用到的变量忘了放进 query key（导致数据不刷新）；
- [ ] mutation 成功后忘了 invalidateQueries（导致界面不更新）。

如果你能在 code review 里一眼认出这些，说明这套心智模型已经内化了。

## 12.4 测试策略小结

| 对象 | 隔离手段 | 关键配置 |
| --- | --- | --- |
| TanStack Query hook/组件 | 每个测试 `new QueryClient()` 作为 wrapper | `retry: false`；Jest 加 `gcTime: Infinity` |
| 网络请求 | nock 或 MSW（推荐 MSW，代码零改动） | 按 URL/page mock 响应 |
| Zustand store | `afterEach` 里 `setState(getInitialState(), true)` | 官方 `__mocks__/zustand.ts` 全局重置 |
| 组件行为 | React Testing Library + userEvent | 测「用户看到的」，不测实现细节 |

## 本章小结与自检

- [ ] 知道测 TanStack Query 的头号原则是**每个测试新建一个 QueryClient**（用 wrapper 工厂），并能解释为什么（缓存会跨测试泄漏）；
- [ ] 记住测试要 `retry: false`，Jest 下加 `gcTime: Infinity`；
- [ ] 会用 nock/MSW mock 网络，会测无限滚动的分页；
- [ ] 知道测 Zustand 要**每个测试后重置 store**（`setState(getInitialState(), true)`），了解官方 mock 方案；
- [ ] **能把「不要把服务端数据复制进 Zustand」的原因讲清楚**（两份真相、手动同步地狱、失去 Query 所有好处）；
- [ ] 会用「真相来源」判断数据归属，记住「Zustand 管用户想看什么、Query 管拿数据，通过 query key 协作」的黄金模式；
- [ ] 能认出常见反模式清单里的每一条。

最后一章，我们把 TanStack Query 和 Zustand 组合成一个完整的 TaskFlow 应用，并对全书做一次逐项验收。

---

> 上一章：[第 11 章 Zustand persist](./11-zustand-persist.md) | 返回目录：[README](./README.md) | 下一章：[第 13 章 综合实战与逐项验收](./13-capstone-project.md)
