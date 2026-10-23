# 第 7 章 · 导航与 URL 状态（Link / useNavigate / useSearchParams）

> 本章目标：**用对导航工具，并把「可分享的状态」（筛选、排序、分页）放进 URL**，让页面可收藏、可分享、可前进后退、刷新不丢。
> 对应验收项：⑦
> 预计用时：60 分钟

---

## 7.1 五种导航方式，各用在什么时候

React Router 里「让 URL 变化」的方式有五种。**选错工具是新手最常见的坏味道**，先看这张决策表：

| 工具 | 谁触发 | 用途 | 频率 |
| --- | --- | --- | --- |
| `<Link to>` | 用户点击 | 普通导航链接 | ⭐⭐⭐⭐⭐ 最常用 |
| `<NavLink to>` | 用户点击 | 需要 active/pending 样式的导航（如菜单） | ⭐⭐⭐⭐ |
| `<Form>` | 用户提交表单 | 带数据提交/带查询参数导航 | ⭐⭐⭐ |
| `redirect()` | loader/action 内部 | 业务改道（未登录、创建后跳详情） | ⭐⭐⭐ |
| `useNavigate()` | **代码**（非用户直接点击） | 程序化导航，应**尽量少用** | ⭐ |

💡 **原则**：能用 `<Link>`/`<NavLink>`/`<Form>` 表达的导航，就不要用 `useNavigate`。**`useNavigate` 是为「用户没有在点链接、但你需要导航」的场景保留的**，比如：登录超时自动登出、答题倒计时结束自动交卷。

---

## 7.2 `<Link>` 与 `<NavLink>`

### Link：最基本的导航

```tsx
import { Link } from "react-router";

<Link to="/concerts/chicago">Chicago 演唱会</Link>
```

点击时**不会整页刷新**，React Router 拦截点击、切换路由、跑目标 loader、渲染新页面。它渲染出的是真实的 `<a>`，对无障碍与「右键新标签打开」都友好。

常用属性：
- `to`：目标路径（绝对 `/x` 或相对 `x`，见第 2 章）。
- `replace`：替换当前历史条目（不新增），用于「不该被返回到」的跳转。
- `state`：附带一点**不放进 URL** 的历史状态（见 7.5）。
- `preventScrollReset`：导航时不重置滚动位置。
- `reloadDocument`：放弃 SPA 行为，让浏览器**整页加载**（跳到外部/需要硬刷新时）。

### NavLink：带「当前所在」高亮的导航

菜单里通常需要高亮「当前页」。`NavLink` 会自动判断 active/pending：

```tsx
import { NavLink } from "react-router";

<nav>
  <NavLink to="/" end>首页</NavLink>       {/* end：仅精确匹配 "/" 时 active */}
  <NavLink to="/concerts">全部演唱会</NavLink>
  <NavLink to="/about">关于</NavLink>
</nav>
```

- **`end` 属性很重要**：默认 `NavLink` 是「前缀匹配」，`to="/"` 会匹配所有以 `/` 开头的 URL（等于永远 active）。给根链接加 `end` 表示「只有正好是 `/` 才算 active」。
- 自动加类名 `active` / `pending`，可用纯 CSS  styling。
- `className` / `style` / `children` 都能是**函数**，拿到 `{ isActive, isPending, isTransitioning }`：

```tsx
<NavLink
  to="/concerts"
  className={({ isActive, isPending }) =>
    [isActive ? "font-bold text-crimson" : "", isPending ? "opacity-50" : ""]
      .filter(Boolean).join(" ")
  }
>
  全部演唱会
</NavLink>
```

---

## 7.3 useNavigate：程序化导航（少用）

```tsx
import { useNavigate } from "react-router";

function LogoutButton() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/login")}>登出</button>;
}
```

`navigate(to, options?)`：
- `to`：路径字符串；或数字（`navigate(-1)` 后退一步，`navigate(1)` 前进）。
- `options.replace`：替换历史条目而非新增。
- `options.state`：附带历史状态。
- `options.relative`：相对路由（`"route"`）还是相对路径（`"path"`）。
- `options.preventScrollReset`：不重置滚动。

**正当用法示例**——不活动超时自动登出：

```tsx
export function useLogoutAfterInactivity() {
  const navigate = useNavigate();
  useFakeInactivityHook(() => navigate("/logout"));
}
```

> ⚠️ **别在渲染期间或 `useEffect` 里无脑 navigate**，那会造成「导航风暴」或死循环。如果你发现自己在写 `useEffect(() => navigate(...), [])`，先想想是不是应该用 `<Navigate to="..." replace />` 组件，或干脆用 `redirect()` 放进 loader/action。**能在 loader/action 里 redirect 的，就不要在组件里 navigate。**

### `<Navigate>`：声明式重定向

需要「渲染即重定向」时用组件（例如受保护路由未登录）：

```tsx
import { Navigate } from "react-router";

function RequireAuth({ children }) {
  const isAuthed = useAuth();
  if (!isAuthed) return <Navigate to="/login" replace />;
  return children;
}
```

---

## 7.4 useSearchParams：把状态放进 URL（本章核心）

**筛选、排序、分页、当前标签页……这些「应该能被分享和收藏」的状态，都属于 URL，而不是组件内存。** `useSearchParams` 让你像用 `useState` 一样读写查询参数。

```tsx
import { useSearchParams } from "react-router";

const [searchParams, setSearchParams] = useSearchParams();
```

- `searchParams`：一个 **`URLSearchParams`** 实例（只读语义），用 `.get("q")`、`.getAll("tag")`、`.has("sort")` 读取。
- `setSearchParams(next, options?)`：更新查询参数，**会触发一次导航**（因此相关 loader 会按第 5 章的规则重新校验）。

`next` 可以是：
- 一个对象/数组/`URLSearchParams`：`setSearchParams({ q: "jazz", sort: "date" })`。
- 一个函数（拿 prev 算 next）：`setSearchParams((prev) => { prev.set("page", "2"); return prev; })`。

`options` 与 `navigate` 相同：`{ replace, state, preventScrollReset, relative }`。

> ⚠️ **重要陷阱**：`setSearchParams` 的**函数式写法不支持 React `setState` 的「批处理队列」**。在同一次事件里连续调用多次 `setSearchParams(prev => ...)`，后一次拿到的 `prev` 可能不是前一次的结果，导致更新丢失。**要一次改多个参数，就在一个对象/一次调用里改完**，或复制一份 `URLSearchParams` 改好再一次性 set。

---

## 7.5 实战：把「筛选 + 排序 + 分页」全放进 URL

我们把第 3 章的城市演唱会列表升级成一个**完整的、URL 驱动**的列表页：`/concerts/chicago?q=jazz&sort=date&page=2`。

### 第 1 步：loader 读取这些参数（第 3 章已铺垫）

```tsx filename=src/routes/concerts/city.tsx
export async function loader({ request, params }) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const sort = url.searchParams.get("sort") ?? "date";
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = 2;

  let list = await getConcertsByCity(params.city, { signal: request.signal });
  if (q) list = list.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));
  list = [...list].sort((a, b) =>
    sort === "title" ? a.title.localeCompare(b.title) : a.date.localeCompare(b.date)
  );

  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const paged = list.slice((page - 1) * pageSize, page * pageSize);

  return { city: params.city, concerts: paged, q, sort, page, totalPages };
}
```

### 第 2 步：组件用 useSearchParams 读写（形成闭环）

```tsx filename=src/routes/concerts/city.tsx（组件部分）
import { useLoaderData, useSearchParams, Link } from "react-router";

export default function ConcertsCity() {
  const { city, concerts, page, totalPages } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();

  const q = searchParams.get("q") ?? "";
  const sort = searchParams.get("sort") ?? "date";

  // 通用：基于当前参数生成新参数（一次性改，避免多次 set 丢更新）
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === "" || v == null) next.delete(k); // 空值就从 URL 删掉，保持干净
      else next.set(k, v);
    }
    setSearchParams(next, { replace: true }); // 筛选类操作通常用 replace，别污染历史栈
  };

  return (
    <div>
      <h1>{city} 的演唱会</h1>

      {/* 搜索框：受控于 URL 的 q */}
      <input
        value={q}
        placeholder="搜索标题…"
        onChange={(e) => update({ q: e.target.value, page: "1" })}
      />

      {/* 排序：点一下切换 */}
      <button onClick={() => update({ sort: sort === "date" ? "title" : "date" })}>
        排序：{sort === "date" ? "按日期" : "按标题"}
      </button>

      <ul>
        {concerts.map((c) => (
          <li key={c.id}>
            <Link to={`/concerts/${city}/${c.id}`}>{c.title}</Link>（{c.date}）
          </li>
        ))}
      </ul>

      {/* 分页：也用 URL 表达 */}
      <div>
        <button disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
          上一页
        </button>
        <span> 第 {page} / {totalPages} 页 </span>
        <button disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })}>
          下一页
        </button>
      </div>
    </div>
  );
}
```

**这个设计带来的好处（请亲手体验）：**
1. **可分享**：把当前带 `?q=jazz&sort=title&page=2` 的 URL 发给同事，看到完全一致的结果。
2. **可前进/后退**：浏览器返回键能一步步回退筛选历史。
3. **刷新不丢**：F5 后状态还在（因为它在 URL 里，不在内存）。
4. **数据与 UI 单一真相**：URL → loader → UI，`update()` 改 URL，loader 重新算，UI 自动更新。**组件里几乎没有本地 state**。

> 💡 **`replace: true` 的取舍**：像「输入框每敲一个字」这种高频更新，用 `replace` 避免把每个中间态都塞进历史栈（否则用户要点几十次返回）。而「翻页」「切换到某个明确的筛选结果」这类用户希望「返回能回去」的动作，可以不加 `replace`（新增历史条目）。

### `useNavigate` 的 `state`：不适合放进 URL 的数据

有些数据你**不想暴露在 URL**（比如「从哪来的」这种一次性上下文），可以放进 history state：

```tsx
navigate("/concerts/chicago/3", { state: { from: "search" } });
// 目标页读取：
import { useLocation } from "react-router";
const { state } = useLocation(); // { from: "search" }
```

> ⚠️ history state **不可分享、刷新后仍在但无法通过 URL 复现**。判断标准：**「这个状态换了台设备、用同一个 URL 打开，还应该一样吗？」** 是 → 放 URL；否（只是本次会话的临时上下文）→ 可放 state。

---

## 7.6 `<Form>` 也能驱动 URL（GET 表单）

`<Form method="get">` 会把表单字段序列化成查询参数并导航——非常适合「搜索框」这种语义：

```tsx
import { Form } from "react-router";

<Form action="/concerts/chicago" method="get">
  <input name="q" defaultValue={q} />
  <button type="search">搜索</button>
</Form>
{/* 用户输入 "journey" 提交 → 导航到 /concerts/chicago?q=journey → loader 重新跑 */}
```

这比手动 `update({q})` 更「表单原生」，还能配合第 5 章的 fetcher 做「不跳转的实时联想」。两种风格按需选择：
- **GET `<Form>`**：用户点「搜索」按钮才更新 URL，语义清晰。
- **`useSearchParams` + 受控输入**：边打字边更新 URL（配合 `replace`），更实时。

---

## ✅ 本章验收清单

- [ ] 我能说出五种导航方式，并解释「为什么 `useNavigate` 要少用」。
- [ ] 我会用 `<Link>`，理解 `replace` / `state` / `reloadDocument` 等属性。
- [ ] 我会用 `<NavLink>` 的 `end` 与函数式 `className/children` 做 active/pending 高亮。
- [ ] 我知道未登录用 `<Navigate>` 或 loader 里 `redirect`，而不是组件里乱 `navigate`。
- [ ] 我会用 `useSearchParams` 读写查询参数，并知道「函数式写法不支持批处理队列」这个坑。
- [ ] 我能把**筛选 + 排序 + 分页**完整放进 URL，实现可分享/可前进后退/刷新不丢。
- [ ] 我理解「一次性、不可分享」的上下文才放 `navigate(state)`，其余状态优先放 URL。

完成后进入 👉 [**第 8 章：懒加载与代码拆分**](./08-懒加载与代码拆分.md)。

---

## 🔧 常见坑 / 排错

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 首页链接永远高亮 | `NavLink to="/"` 是前缀匹配 | 加 `end` 属性 |
| 改一个参数把其它参数冲掉了 | `setSearchParams({q})` 只传了部分参数 | 基于 `new URLSearchParams(searchParams)` 复制后再改 |
| 连续两次 `setSearchParams(prev=>...)` 丢一次 | 函数式不支持批处理队列 | 合并成一次调用 |
| 每次输入都新增历史记录，返回要点很多次 | 没用 `replace` | 高频更新用 `setSearchParams(next, { replace: true })` |
| URL 里堆满空参数 `?q=&sort=&page=` | 空值也 set 进去了 | 空值时 `next.delete(k)` |
| 在 `useEffect` 里 navigate 导致死循环 | 渲染期/副作用里无脑导航 | 改用 `<Navigate>`、loader `redirect`，或修正依赖 |
