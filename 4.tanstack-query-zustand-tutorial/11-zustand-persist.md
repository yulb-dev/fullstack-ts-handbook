# 第 11 章：Zustand persist——持久化、版本迁移与安全

> 上一章：[第 10 章 Zustand 进阶](./10-zustand-stores-and-middleware.md) | 返回目录：[README](./README.md) | 下一章：[第 12 章 测试与架构边界](./12-testing-and-boundaries.md)

很多客户端状态需要「刷新页面也别丢」——主题、语言、侧边栏折叠、用户偏好。Zustand 的 **persist 中间件**用一个包裹就能把 store 存进 `localStorage`（或任意 storage）。但持久化这件事，**用错了会埋下数据不一致和安全漏洞**。这一章把它讲透，最后落在一条**安全红线**上。

## 11.1 persist 基础

persist 是包在状态创建函数外面的中间件，第二个参数是配置对象。**唯一必填项是 `name`**（作为在 storage 里的键，必须唯一）：

```tsx
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface PreferencesState {
  theme: 'light' | 'dark'
  density: 'comfortable' | 'compact'
  setTheme: (t: 'light' | 'dark') => void
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: 'light',
      density: 'comfortable',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'taskflow-preferences', // ← storage 里的键，必须唯一
      storage: createJSONStorage(() => localStorage), // ← 可选，默认就是 localStorage
    },
  ),
)
```

现在 `theme` 会被自动存进 localStorage，刷新页面后自动恢复。你几乎不用写任何额外代码——这就是中间件的威力。

## 11.2 storage：存在哪、怎么序列化

### createJSONStorage 与不同存储引擎

`storage` 选项接收一个「返回存储引擎」的函数，用 `createJSONStorage` 包一层来处理 JSON 序列化：

```tsx
storage: createJSONStorage(() => localStorage)   // 持久（关浏览器也在）——默认
storage: createJSONStorage(() => sessionStorage) // 会话级（关标签页就没）
storage: createJSONStorage(() => AsyncStorage)   // React Native
```

选哪个存储引擎，是个**有意的决策**：

- **敏感或只需当前会话的**（如临时的多步表单）→ `sessionStorage`（关标签页即清）；
- **长期用户偏好**（主题、语言）→ `localStorage`；
- **React Native** → `AsyncStorage`（异步，见 11.5）。

### 自定义存储引擎（IndexedDB 等）

只要提供 `getItem` / `setItem` / `removeItem` 三个方法，任何存储都能接（比如 `idb-keyval` 操作 IndexedDB）：

```tsx
import { get, set, del } from 'idb-keyval'
const storage: StateStorage = {
  getItem: async (name) => (await get(name)) ?? null,
  setItem: async (name, value) => { await set(name, value) },
  removeItem: async (name) => { await del(name) },
}
// ...
storage: createJSONStorage(() => storage),
```

## 11.3 partialize：只持久化你需要的字段（关键）

**默认情况下，persist 会尝试存储整个 state。** 这通常不是你想要的——**action（函数）不该被存**（函数无法 JSON 序列化，存了也没意义），一些临时/派生字段也不该存。

`partialize` 让你**挑选哪些字段进 storage**：

```tsx
persist(
  (set) => ({
    theme: 'light',
    density: 'comfortable',
    // 下面这些不该持久化：
    setTheme: (theme) => set({ theme }),          // action，函数存不了
    isHydrating: false,                            // 临时状态
    lastSyncedAt: null,                            // 可能不该跨会话保留
  }),
  {
    name: 'taskflow-preferences',
    partialize: (state) => ({
      // 白名单：只存这两个纯数据字段
      theme: state.theme,
      density: state.density,
    }),
  },
)
```

或用「黑名单」排除法：

```tsx
partialize: (state) =>
  Object.fromEntries(
    Object.entries(state).filter(([key]) => !['setTheme', 'isHydrating'].includes(key)),
  ),
```

**最佳实践**：**永远显式写 `partialize`，用白名单只存纯数据字段。** 理由：

1. action 是函数，本来就不该也无法有意义地持久化；
2. 白名单能防止你**无意中**把不该存的字段（尤其是敏感数据，见 11.7）写进 storage；
3. 让「哪些数据会跨会话保留」变成一目了然的显式声明。

## 11.4 version 与 migrate：应对存储结构的演进

你的 store 结构会随版本迭代变化——字段改名、拆分、类型变了。但用户 localStorage 里存的还是**旧结构**。如果不处理，恢复旧数据会导致 `undefined`、类型错误甚至崩溃。

persist 用 **`version` + `migrate`** 解决这个问题：

- **`version`**（默认 `0`）：给存储结构打版本号。**默认行为**：如果 storage 里存的版本号和代码里的对不上，**存储的值直接被忽略**（当作没有持久化数据）。
- **`migrate`**：一个函数，接收「持久化的旧状态」和「它的版本号」，返回「符合最新版本的状态」。有了它，旧数据不会被丢弃，而是被**转换**成新结构。

### 例子：字段改名

假设 v0 时字段叫 `mode`，v1 改名为 `theme`：

```tsx
persist(
  (set) => ({
    theme: 'light', // v1：新字段名
    setTheme: (theme) => set({ theme }),
  }),
  {
    name: 'taskflow-preferences',
    version: 1, // ← 代码里的当前版本升到 1
    partialize: (state) => ({ theme: state.theme }),
    migrate: (persistedState: any, version) => {
      if (version === 0) {
        // v0 → v1：把旧的 mode 字段搬到新的 theme 字段
        return { ...persistedState, theme: persistedState.mode, mode: undefined }
      }
      return persistedState
    },
  },
)
```

### 多级迁移

如果经历了 v0 → v1 → v2，`migrate` 里按版本号逐级转换（或一次性算到最新）：

```tsx
version: 2,
migrate: (state: any, version) => {
  if (version === 0) {
    state = { ...state, theme: state.mode } // v0 → v1
    delete state.mode
    version = 1
  }
  if (version === 1) {
    state = { ...state, density: state.density ?? 'comfortable' } // v1 → v2：补新字段默认值
    version = 2
  }
  return state
},
```

`migrate` 也可以返回 Promise（异步迁移）。**核心原则**：**每次改动持久化数据的结构，就升 `version` 并写对应的 `migrate`。** 别偷懒不写——否则老用户升级后会看到损坏的界面。

### merge：浅合并的陷阱

persist 恢复数据时，会把「storage 里的状态」和「代码里的初始状态」合并，**默认是浅合并**（`{ ...currentState, ...persistedState }`）。对**嵌套对象**这会出问题：

```
storage 里存的是：  { foo: { bar: 0 } }
代码里初始状态是：  { foo: { bar: 0, baz: 1 } }
浅合并结果：        { foo: { bar: 0 } }   ← baz 被整个 foo 覆盖丢了！
```

如果你持久化了嵌套对象，用自定义 `merge` 做深合并：

```tsx
persist(
  (set) => ({ foo: { bar: 0, baz: 1 } }),
  {
    name: 'x',
    merge: (persistedState, currentState) => deepMerge(currentState, persistedState),
  },
)
```

（`deepMerge` 需要你自己实现或用工具库。）避免这个坑的更简单办法：**尽量别持久化深层嵌套结构**，或用 `partialize` 只存扁平字段。

## 11.5 hydration：恢复过程的时机问题

「hydration（注水）」就是把 storage 里的数据读出来、合并进 store 的过程。它分同步和异步两种，**异步会带来时序陷阱**：

- **同步存储（localStorage）**：hydration 在 store 创建时**同步完成**，首次渲染就能拿到恢复的值；
- **异步存储（AsyncStorage / IndexedDB）**：hydration 在一个微任务里**稍后完成**。这意味着**首次渲染时 store 还是默认值**，恢复的值晚一步才到。

### 异步 hydration 的经典 bug

如果你的应用「一加载就依赖持久化值」（比如根据 `isLoggedIn` 决定显示什么），异步 hydration 会导致：**首次渲染用的是默认值（比如「未登录」），一瞬间后才变成恢复的真值（「已登录」）**——界面闪烁甚至逻辑错误。

### 解决：等 hydration 完成再渲染

用 persist API 的 `hasHydrated` / `onFinishHydration`，或在 store 里放一个 `_hasHydrated` 标志：

```tsx
const useBoundStore = create(
  persist(
    (set) => ({
      // ...
      _hasHydrated: false,
      setHasHydrated: (v: boolean) => set({ _hasHydrated: v }),
    }),
    {
      name: 'x',
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true) // hydration 完成后置真
      },
    },
  ),
)

function App() {
  const hasHydrated = useBoundStore((s) => s._hasHydrated)
  if (!hasHydrated) return <p>加载中…</p> // 等恢复完成再渲染依赖它的界面
  return <RealApp />
}
```

### skipHydration 与手动 rehydrate

有时你想**自己控制**首次 hydration 的时机（典型如 SSR 应用），设 `skipHydration: true`，之后手动调用：

```tsx
persist(() => ({ count: 0 }), { name: 'x', skipHydration: true })

// 组件挂载后手动注水
useEffect(() => { useBoundStore.persist.rehydrate() }, [])
```

### Next.js / SSR 的注意事项

SSR 场景下，服务器渲染的 HTML 和客户端 hydration 后的 HTML 可能不一致（因为服务器上没有 localStorage），导致 React 报「hydration mismatch」错误。官方推荐用一个自定义 hook 延迟到客户端 `useEffect` 里再读持久化值，避免服务端/客户端首屏不一致。SSR 里通常还要配合 `skipHydration`。

## 11.6 persist API 速查

`useStore.persist` 上挂了一组实用方法，可在组件内外使用：

| 方法 | 作用 |
| --- | --- |
| `getOptions()` | 读当前 persist 配置（如 storage 的 name） |
| `setOptions(opts)` | 动态改配置（如换 storage name / 引擎） |
| `clearStorage()` | 清空该 name 下的所有存储数据（**退出登录时用**） |
| `rehydrate()` | 手动触发注水（返回 Promise） |
| `hasHydrated()` | 是否已注水完成（非响应式） |
| `onHydrate(fn)` | 注水开始时触发，返回退订函数 |
| `onFinishHydration(fn)` | 注水结束时触发，返回退订函数 |

「退出登录清空持久化数据」是个常见需求：

```tsx
function logout() {
  usePreferencesStore.persist.clearStorage() // 清掉本地存的偏好/会话数据
  // ... 其它登出逻辑
}
```

## 11.7 🔒 安全红线：持久化存储绝不能放秘密

这是本章最重要的一节，也是你在真实项目里**必须守住**的底线。

### 为什么 localStorage/sessionStorage 不安全

- **任何能跑在你页面里的 JS 都能读 localStorage**——包括第三方脚本、以及一旦发生的 **XSS（跨站脚本）攻击**。攻击者注入一段脚本，就能把 `localStorage` 里的东西悄悄发到他的服务器。
- localStorage **不加密**，就是明文，用户在 DevTools 里一眼就能看全。
- 它会**长期驻留**（localStorage 甚至跨会话），泄露窗口很大。

### 因此，这些东西绝对不能进 persist / localStorage

- ❌ **密码、API key、密钥、私钥**——任何秘密；
- ❌ **access token / refresh token**（放 localStorage 是被 OWASP 明确不推荐的，XSS 一旦得手 token 直接失窃）；
- ❌ **身份证号、银行卡号、健康记录**等敏感 PII（个人身份信息）；
- ❌ 任何「如果用户看到会尴尬、如果被攻击者拿到会有损失」的数据。

### 那认证 token 该放哪？

优先方案（按安全性排序）：

1. **HttpOnly + Secure + SameSite Cookie**：JS 读不到（防 XSS 窃取），由浏览器自动随请求发送。这是存放会话凭证的推荐做法，需要后端配合；
2. **只放内存**（如一个不持久化的 Zustand store 或模块变量）：刷新页面就没了，需要配合静默刷新/重新登录机制；
3. 如果**确实**必须放 localStorage（某些 SPA 架构的历史选择），要清醒地知道风险，并**把 XSS 防护做到极致**（严格 CSP、转义所有用户输入、不引入不可信第三方脚本）。

### 可以放 persist 的是什么

只放**「丢了也无所谓、不敏感、纯属用户便利」的数据**：主题、语言、密度、侧边栏折叠、列表排序偏好、非敏感的界面配置。判断标准很简单：

> **如果这份数据被攻击者看到、或被下一个用这台电脑的人看到，会造成任何伤害吗？会 → 别存 localStorage。**

### partialize 是你的安全护栏

回到 11.3：坚持用 **`partialize` 白名单**，能从源头杜绝「不小心把某个敏感字段连同整个 state 一起存进去」。如果哪天 store 里意外混入了一个 token 字段，白名单能保证它不会被持久化。这是「显式优于隐式」在安全上的体现。

```tsx
// ✅ 白名单：即便 store 里有敏感字段，也只有这些纯偏好被存
partialize: (s) => ({ theme: s.theme, density: s.density }),

// ❌ 黑名单/默认全存：哪天新增了敏感字段忘了排除，就泄露了
```

## 11.8 实战：TaskFlow 的偏好持久化

给 TaskFlow 的偏好 store 配上生产级的 persist：

```tsx
// src/stores/usePreferencesStore.ts
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface PreferencesState {
  theme: 'light' | 'dark'
  density: 'comfortable' | 'compact'
  setTheme: (t: 'light' | 'dark') => void
  toggleDensity: () => void
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: 'light',
      density: 'comfortable',
      setTheme: (theme) => set({ theme }),
      toggleDensity: () =>
        set((s) => ({ density: s.density === 'compact' ? 'comfortable' : 'compact' })),
    }),
    {
      name: 'taskflow-preferences',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // 白名单：只存纯偏好，绝不存任何敏感/临时/函数数据
      partialize: (s) => ({ theme: s.theme, density: s.density }),
      // 结构演进时在此加 migrate
    },
  ),
)
```

而 `useUiStore`（filter、弹窗、草稿）我们**故意不加 persist**——刷新页面回到默认筛选是完全合理的，没必要持久化，还省了 hydration 的复杂度。这个「哪些该存、哪些不该存」的取舍，正是本章要你建立的判断力。

## 本章小结与自检

- [ ] 会用 `persist` + `name` 持久化 store，理解 `createJSONStorage` 与不同存储引擎（localStorage / sessionStorage / AsyncStorage）的选择依据；
- [ ] **坚持用 `partialize` 白名单**只持久化纯数据字段，能说出三个理由（函数存不了、防误存敏感数据、显式声明）；
- [ ] 理解 `version` + `migrate`：改结构就升版本并写迁移，会写单级和多级 migrate；
- [ ] 知道默认浅合并对嵌套对象的陷阱，会用自定义 `merge` 或避免持久化深层结构；
- [ ] 理解同步 vs 异步 hydration 的时序差异，会在依赖持久化值时用 `_hasHydrated` / `hasHydrated` 等待，知道 `skipHydration` 与 SSR/Next.js 注意事项；
- [ ] 会用 persist API（`clearStorage` 用于登出、`rehydrate`、`onFinishHydration` 等）；
- [ ] **牢记安全红线**：localStorage 明文、易受 XSS，**绝不存密码/token/密钥/敏感 PII**；token 优先用 HttpOnly Cookie 或只放内存；判断标准是「被看到会不会造成伤害」。

下一章，我们把两个库的**测试**和**架构边界**讲清楚——尤其是那条铁律：**不要把服务端数据复制一份进 Zustand**。

---

> 上一章：[第 10 章 Zustand 进阶](./10-zustand-stores-and-middleware.md) | 返回目录：[README](./README.md) | 下一章：[第 12 章 测试与架构边界](./12-testing-and-boundaries.md)
