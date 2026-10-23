# 第 5 章 · 导航状态与 Pending UI（useNavigation / useFetcher）

> 本章目标：**做出专业的加载/提交体验**——理解 `useNavigation` 的状态机、用 `useFetcher` 做「不跳转」的局部数据交互、理解 loader 的**并行加载**与**如何避免重复请求**。
> 对应验收项：⑤
> 预计用时：75 分钟

这是 Data Mode 最能提升「产品质感」的一章。前四章让功能跑通，这一章让它「用起来舒服」。

---

## 5.1 为什么需要「导航状态」

用户点了链接、提交了表单之后，到数据到位、页面更新之前，有一段**异步等待**。如果这段时间 UI 毫无反应，用户会：以为没点上→再点一次→重复提交；或者以为卡死→刷新页面。

React Router 把这段「正在进行中」的状态暴露成两个 hook：
- **`useNavigation()`**：描述**当前这次「会改变 URL」的导航/提交**的状态。
- **`useFetcher()`**：描述**某个「不改变 URL」的后台数据交互**的状态。

💡 一句话区分：
> **改变 URL 的 → `useNavigation`；不改变 URL 的局部交互 → `useFetcher`。**

---

## 5.2 useNavigation：导航状态机

`useNavigation()` 返回一个 navigation 对象。没有导航进行时，它是 `idle`。

```tsx
import { useNavigation } from "react-router";

function SomeComponent() {
  const navigation = useNavigation();
  navigation.state;      // "idle" | "loading" | "submitting"
  navigation.location;   // 正在前往的目标 location（idle 时为 undefined）
  navigation.formMethod; // 提交时的方法（POST/PUT...）
  navigation.formAction; // 提交到的 action URL
  navigation.formData;   // 提交的 FormData（乐观更新的关键）
  navigation.delta;      // 相对历史栈的移动量（前进/后退时）
}
```

状态机（记住这张图）：

```
        点击链接 / 导航                     loader 完成
 idle ───────────────────────▶ loading ───────────────▶ idle
   │                                                       ▲
   │  提交表单（method=post）        action 完成后 revalidate │
   └──────────────▶ submitting ────────────────────────────┘
```

- **`idle`**：没有进行中的导航。
- **`loading`**：正在加载目标路由的 loader（点击链接、前进后退、`useNavigate`）。
- **`submitting`**：正在提交表单（action 运行中，随后通常进入 revalidation）。

### 全局 pending：顶部进度条 / Spinner

最常见的用法——在根布局放一个全局加载指示器：

```tsx filename=src/routes/root.tsx
import { Outlet, useNavigation } from "react-router";

export default function Root() {
  const navigation = useNavigation();
  const isNavigating = Boolean(navigation.location); // 只要「有目标」就说明在导航

  return (
    <div>
      {isNavigating && <div className="global-spinner" role="status">加载中…</div>}
      <Outlet />
    </div>
  );
}
```

> 💡 `Boolean(navigation.location)` 是判断「是否正在导航」的惯用法：只要有目标 location，就说明还没到位。相比判断 `state !== "idle"`，它对「提交」也友好。

### 局部 pending：让「正在前往的那个链接」转圈

`NavLink` 的 `className` / `style` / `children` 都能是**函数**，接收 `{ isActive, isPending, isTransitioning }`：

```tsx
import { NavLink } from "react-router";

<NavLink to="/concerts/chicago" className={({ isPending }) => (isPending ? "pending" : "")}>
  {({ isPending }) => (
    <span>Chicago {isPending && <Spinner />}</span>
  )}
</NavLink>
```

`NavLink` 还会自动加默认类名，方便纯 CSS 处理：

```css
a.active { color: crimson; font-weight: bold; }
a.pending { animation: pulse 1s infinite; }
```

### 提交 pending：区分「哪个表单在提交」

一个页面可能有多个表单。用 `navigation.formAction` 精确定位：

```tsx
const navigation = useNavigation();
const isSavingThisForm =
  navigation.state === "submitting" && navigation.formAction === "/concerts/chicago/3";
```

---

## 5.3 useFetcher：不跳转的数据交互

有些数据交互**不该改变 URL、不该进历史栈**：
- 列表里每一行的「标为已完成」开关；
- 搜索框的**联想/自动补全**（一边打字一边查）；
- 侧边栏的「加载更多」；
- 局部的小表单（改个昵称、点个赞）。

如果用 `<Form>`，每次提交都会导航、进历史、可能触发整页 revalidation——体验很差。这就是 `useFetcher` 的舞台。

> 💡 **fetcher = 一次「独立的、不导航的」loader/action 调用**，它自带状态机、自带 data、自带 `<Form>` 和 `submit`，还能触发路由数据的 revalidation。

### fetcher 的形状

```tsx
import { useFetcher } from "react-router";

const fetcher = useFetcher();
fetcher.state;      // "idle" | "loading" | "submitting"
fetcher.data;       // loader/action 的返回值
fetcher.formData;   // 正在提交的 FormData（乐观更新用）
fetcher.Form;       // 一个绑定到该 fetcher 的 <Form>
fetcher.submit();   // 命令式提交
fetcher.load(href); // 命令式「只加载」某路由的 loader（GET）
```

### 实战 1：列表内联「标记完成」（乐观更新）

官方推荐的经典例子。要点：**提交后立刻用 `fetcher.formData` 猜出「下一状态」并渲染**，等服务端确认再被真实数据替换——用户几乎感觉不到延迟。

```tsx filename=src/components/task.tsx
import { useFetcher } from "react-router";

export function Task({ task }) {
  const fetcher = useFetcher();

  // 乐观更新：如果 fetcher 正在提交，就用提交中的值当作「已完成状态」
  let isComplete = task.status === "complete";
  if (fetcher.formData) {
    isComplete = fetcher.formData.get("status") === "complete";
  }

  return (
    <div>
      <span>{task.title}</span>
      <fetcher.Form method="post" action={`/tasks/${task.id}`}>
        <button name="status" value={isComplete ? "incomplete" : "complete"}>
          {isComplete ? "标记未完成" : "标记完成"}
        </button>
      </fetcher.Form>
    </div>
  );
}
```

### 实战 2：搜索联想（fetcher.load 调 loader）

combobox：用户打字 → 用 fetcher 去查一个搜索路由的 loader → 渲染 `fetcher.data`，全程不改变当前 URL。

```tsx filename=src/routes/search-users.tsx
// 路由：{ path: "/search-users", Component: ..., loader }
export async function loader({ request }) {
  await delay(300);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  return users.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()));
}
```

```tsx filename=src/components/user-search.tsx
import { useFetcher } from "react-router";

export function UserSearchCombobox() {
  const fetcher = useFetcher();
  return (
    <div>
      <fetcher.Form method="get" action="/search-users">
        <input
          name="q"
          onChange={(e) => fetcher.submit(e.currentTarget.form)} // 边打字边查
        />
      </fetcher.Form>

      {/* 加载态：数据变淡 */}
      {fetcher.data && (
        <ul style={{ opacity: fetcher.state === "idle" ? 1 : 0.4 }}>
          {fetcher.data.map((u) => <li key={u.id}>{u.name}</li>)}
        </ul>
      )}
    </div>
  );
}
```

- `fetcher.Form method="get"` → 调用目标路由的 **loader**（不是 action）。
- `onChange` 里 `fetcher.submit(form)` → 每次输入都发起一次后台查询；旧查询会被自动取消（fetcher 内建竞态处理）。
- `fetcher.data` → loader 的返回值。

### 实战 3：fetcher 的错误/校验反馈

action 返回的数据在 `fetcher.data`，常用于显示局部错误：

```tsx
const fetcher = useFetcher();
// ...
{fetcher.data?.error && <p style={{ color: "red" }}>{fetcher.data.error}</p>}
```

### 全局进度：useFetchers

`useFetchers()` 返回**当前所有正在进行的 fetcher**，适合做一个「只要有任意后台请求就显示顶部细进度条」的全局效果：

```tsx
import { useFetchers } from "react-router";

function GlobalBar() {
  const fetchers = useFetchers();
  const someBusy = fetchers.some((f) => f.state !== "idle");
  return someBusy ? <div className="top-progress" /> : null;
}
```

---

## 5.4 并行加载：loader 是并发的，不是串行的

💡 **重要事实**：当一次导航匹配到一条路由链（父布局 + 子页面 + …），**这些路由的 loader 会并行执行**，而不是父跑完再跑子。React Router 等**所有** loader 都完成后，才一次性渲染新页面。

```tsx
// 访问 /concerts/chicago 时，下面两个 loader 【并行】跑：
{
  path: "concerts",
  Component: ConcertsLayout,
  loader: loadCities,       // ← 并行 A（侧边栏城市）
  children: [
    { path: ":city", Component: ConcertsCity, loader: loadCityConcerts }, // ← 并行 B
  ],
}
```

对比传统 SPA 的「瀑布」：
```
传统：  挂载父组件 → 父请求(300ms) → 渲染子组件 → 子请求(300ms)  = 600ms
Router：父 loader(300ms) ‖ 子 loader(300ms) 同时跑                = 300ms
```

**并行 + 渲染前完成 = 没有中间 loading 闪烁、没有瀑布。** 这是 Data Mode 性能优势的核心。你可以在两个 loader 里各加 `delay`，用 Network 面板验证它们是同时开始的。

> ⚠️ 并行有个前提：loader 之间**不能有数据依赖**。如果子 loader 必须用父 loader 的结果，那就不该拆成两个 loader——要么合并，要么父 loader 把子需要的数据一并返回。

---

## 5.5 避免重复请求

「重复请求」是 SPA 性能杀手。React Router 通过几个机制帮你避免：

### (1) loader 每次导航只跑一次，数据被缓存复用

同一次导航里，一个路由的 loader 只执行一次，结果存进 router 的 data store，页面上多个组件用 `useLoaderData` / `useRouteLoaderData` 读的都是**同一份**，不会各拉一次。

### (2) 默认 revalidation 是「聪明」的

action 后并不是无脑重跑所有 loader。默认策略下，一条路由的 loader 在这些情况才重新校验：
- 它自己的 **params** 变了；
- **URL search params** 有任意变化；
- 有一次 **action 返回了非错误状态**。

也就是说，纯粹「点到另一个不相关的路由再回来」，很多 loader 不会盲目重跑。

### (3) `shouldRevalidate`：精细控制

当默认策略仍不够（例如某个 loader 很重、且几乎不变），用 `shouldRevalidate` 明确告诉路由「这种情况别重跑我」：

```tsx
{
  path: "/heavy-report",
  loader: heavyReportLoader,
  shouldRevalidate: ({ formAction, formMethod, defaultShouldRevalidate }) => {
    // 只有 analytics 相关的提交才不影响我 → 跳过重校验
    if (formMethod === "POST" && formAction?.endsWith("/analytics")) return false;
    return defaultShouldRevalidate; // 其余交给默认策略
  },
}
```

- 它**只影响本路由的 loader**，不影响父/兄弟。
- 一旦定义，就**完全接管**本路由的重校验决策，所以不确定时 `return defaultShouldRevalidate`。

### (4) 单次提交跳过：`defaultShouldRevalidate={false}`

只想「这一次提交别触发重校验」：

```tsx
<Form method="post" action="/log-view" defaultShouldRevalidate={false}>
fetcher.submit(data, { action: "/log-view", method: "post", defaultShouldRevalidate: false });
```

### (5) fetcher 复用，避免组件各自为战

同一个 fetcher 实例的 `load`/`submit` 会**自动取消**上一次的未完成请求（内建竞态处理），所以你连续输入搜索时不会堆积请求，也不会「后发先至」地显示旧结果。

> 💡 **选型口诀**：
> - 页面级、要改 URL、要进历史 → `<Form>` + `useNavigation`
> - 局部、不改 URL、要乐观更新/联想 → `useFetcher`
> - 重且稳定的 loader → 加 `shouldRevalidate`
> - 一次性跳过 → `defaultShouldRevalidate={false}` / `navigate={false}`

---

## 5.6 动手实践：给 Concert Hub 加完整 pending 体验

🧪 目标：
1. 根布局加**全局顶部进度条**（`useNavigation` + `useFetchers`）。
2. 侧边栏城市 `NavLink` 加 **pending 样式**。
3. 详情/列表页加一个**收藏按钮**，用 `fetcher` 提交、带乐观更新，且不跳转。

```tsx filename=src/routes/root.tsx（进度条部分）
import { Outlet, useNavigation, useFetchers } from "react-router";

export default function Root() {
  const navigation = useNavigation();
  const fetchers = useFetchers();
  const busy = Boolean(navigation.location) || fetchers.some((f) => f.state !== "idle");

  return (
    <div>
      <div
        aria-hidden={!busy}
        style={{
          height: 3, background: "crimson", width: busy ? "100%" : 0,
          transition: "width 300ms", opacity: busy ? 1 : 0,
        }}
      />
      {/* header ... */}
      <Outlet />
    </div>
  );
}
```

**验证：**
- 点城市链接：顶部进度条出现，被点的 `NavLink` 有 pending 态，到位后消失。
- 点收藏按钮：按钮立刻变「已收藏」（乐观），URL 不变、历史栈不增，稍后服务端确认后状态稳定。
- 打开 Network：切换城市时，父/子 loader **同时发起**（并行）。

---

## ✅ 本章验收清单

- [ ] 我能画出 `useNavigation` 的三态机（idle / loading / submitting）并说明各自含义。
- [ ] 我会用 `Boolean(navigation.location)` 做全局 pending UI。
- [ ] 我会用 `NavLink` 的函数式 `className/children` 做局部 pending。
- [ ] 我会用 `navigation.formAction` 区分「哪个表单在提交」。
- [ ] 我理解 `useFetcher` 用于「不改变 URL」的交互，会用 `fetcher.Form` / `submit` / `load` / `data` / `formData` / `state`。
- [ ] 我能用 `fetcher.formData` 实现**乐观更新**。
- [ ] 我知道 `useFetchers()` 能拿到所有在途 fetcher（全局进度条）。
- [ ] 我理解 loader **并行加载**，且渲染前完成，能解释它如何消除请求瀑布。
- [ ] 我能说出**避免重复请求**的手段：默认 revalidation 策略、`shouldRevalidate`、`defaultShouldRevalidate`、fetcher 自动取消。

完成后进入 👉 [**第 6 章：错误处理与错误边界**](./06-错误处理与错误边界.md)。

---

## 🔧 常见坑 / 排错

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 全局 spinner 一直不消失 | 把 fetcher 的 pending 也算进了全局导航 | 用 `navigation.location` 判断导航；fetcher 单独用 `useFetchers` |
| 内联开关导致整页刷新/URL 变化 | 用了 `<Form>` 而非 `fetcher.Form` | 局部交互改用 `useFetcher` |
| 搜索联想出现「旧结果覆盖新结果」 | 自己手写 fetch 没处理竞态 | 用 fetcher（内建取消）；或自行透传 `request.signal` |
| 乐观更新闪烁回旧值 | action 后 revalidation 拿到旧数据 | 确认 action 真的写成功；必要时 `shouldRevalidate` 控制 |
| 提交后某个重 loader 每次都跑，很慢 | 默认策略认为需要重校验 | 给该路由加 `shouldRevalidate` 或提交时 `defaultShouldRevalidate={false}` |
| `useFetcher` 数据不更新 | 误用了另一个组件的 fetcher | 每个交互点用**自己的** `useFetcher()` 实例 |
