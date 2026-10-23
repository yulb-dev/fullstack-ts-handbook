# 第 3 章 · loader 数据加载

> 本章目标：**用 `loader` 把「进入路由前的数据加载」这件事彻底交给路由层**，掌握 `params`、`searchParams`、`redirect`、以及请求取消（`request.signal`）。
> 对应验收项：③（loader）
> 预计用时：60 分钟

---

## 3.1 loader 是什么，何时运行

**loader 是挂在 Route Object 上的一个函数，它在「路由组件被渲染之前」运行，负责为这个页面准备好数据。**

```tsx
createBrowserRouter([
  {
    path: "/",
    loader: async () => {
      return { records: await getSomeRecords() };
    },
    Component: MyRoute,
  },
]);
```

组件里用 `useLoaderData()` 读取：

```tsx
import { useLoaderData } from "react-router";

function MyRoute() {
  const { records } = useLoaderData();
  return <div>{records.length} 条记录</div>;
}
```

💡 **核心心智模型**（务必刻进脑子）：

> 当 `MyRoute` 组件开始渲染时，`records` **一定已经拿到了**。你不需要在组件里写 `useEffect(() => { fetch(...) }, [])`，不需要 `const [loading, setLoading] = useState(true)`，不需要 `if (!data) return <Spinner/>`。**数据加载发生在路由层，组件只负责「拿到数据后怎么画」。**

这解决了传统 SPA 的两大痛点：
1. **瀑布式请求（waterfall）**：传统做法里，父组件挂载→请求→渲染子组件→子组件再请求，是串行的。loader 让**所有路由的数据在渲染前一次性并行拉取**（详见第 5 章）。
2. **状态散落**：加载逻辑集中在 loader，组件更纯粹、更好测试。

### loader 的入参

loader（和后面要讲的 action）接收一个对象参数，最常用的三个字段：

```ts
async function loader({ request, params, context }) {
  // request: 标准的 Web Fetch API Request 对象
  //   - request.url    当前完整 URL
  //   - request.signal 用于取消的 AbortSignal
  //   - request.method / headers / formData() ...
  // params:  动态段解析结果，如 { city: "chicago" }
  // context: 跨 loader/action/middleware 传递的上下文（进阶）
  return { /* 任意可序列化数据 */ };
}
```

> 💡 React Router 拥抱 **Web 标准**：`request` 就是浏览器的 `Request`，返回的数据也建议是可序列化的普通对象。这让你的 loader 逻辑**能在浏览器、Node、边缘运行时、单元测试里一模一样地跑**。

---

## 3.2 用 params 加载「详情类」数据

动态段的值通过 `params` 传给 loader，这是加载「某一条记录」的标准姿势。

先扩展我们的 mock 数据层：

```ts filename=src/api.ts（追加）
export async function getConcert(id: string): Promise<Concert | undefined> {
  await delay(400);
  return concerts.find((c) => c.id === id);
}

export async function getConcertsByCity(city: string): Promise<Concert[]> {
  await delay(300);
  return concerts.filter((c) => c.city === city);
}
```

详情页 loader + 组件：

```tsx filename=src/routes/concerts/detail.tsx
import { useLoaderData } from "react-router";
import type { Concert } from "../../api";

export async function loader({ params }) {
  // params.concertId 来自路由 path "concerts/:city/:concertId"
  const concert = await getConcert(params.concertId);
  return { concert };
}

export default function ConcertDetail() {
  const { concert } = useLoaderData() as { concert: Concert };
  return (
    <article>
      <h1>{concert.title}</h1>
      <p>城市：{concert.city}</p>
      <p>日期：{concert.date}</p>
    </article>
  );
}
```

在路由表里挂上：

```tsx
{
  path: ":city/:concertId",
  Component: ConcertDetail,
  loader: ConcertDetailLoader, // 即上面导出的 loader
}
```

> ⚠️ **loader 里不要再用 `useParams()`**——那是**组件**里的 hook。在 loader/action 里，参数通过函数入参 `params` 获取。记牢这条对应关系：
> - **loader / action**：`function ({ params, request }) { ... }`
> - **组件**：`useParams()`、`useLoaderData()`、`useSearchParams()`

---

## 3.3 用 searchParams 加载「列表 + 查询」数据

`?q=rock&sort=date` 这类**查询参数**是列表页筛选/排序/分页的天然载体。在 loader 里，从 `request.url` 解析：

```tsx filename=src/routes/concerts/city.tsx
import { useLoaderData } from "react-router";

export async function loader({ request, params }) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");      // 可能为 null
  const sort = url.searchParams.get("sort") ?? "date";

  let list = await getConcertsByCity(params.city);

  // 关键词过滤
  if (q) {
    const kw = q.toLowerCase();
    list = list.filter((c) => c.title.toLowerCase().includes(kw));
  }
  // 排序
  list = [...list].sort((a, b) =>
    sort === "title" ? a.title.localeCompare(b.title) : a.date.localeCompare(b.date)
  );

  return { city: params.city, concerts: list, q, sort };
}

export default function ConcertsCity() {
  const { city, concerts } = useLoaderData();
  return (
    <div>
      <h1>{city} 的演唱会（{concerts.length}）</h1>
      <ul>
        {concerts.map((c) => <li key={c.id}>{c.title}</li>)}
      </ul>
    </div>
  );
}
```

💡 **为什么筛选条件要来自 URL，而不是组件 state？**
因为 URL 里的状态是**可分享、可收藏、可前进/后退、刷新后仍在**的。用户把 `/concerts/chicago?q=jazz&sort=title` 发给同事，对方看到的就是同一份筛选结果。第 7 章会教你用 `useSearchParams` 在 UI 里读写这些参数，让它和 loader 形成闭环。

> ⚠️ `searchParams.get()` 返回 `string | null`。务必处理 `null`（用 `?? 默认值` 或判空）。多值参数用 `getAll()`。

---

## 3.4 redirect：在 loader 里重定向

有时进入路由前需要「改道」：未登录跳登录页、旧 URL 跳新 URL、创建成功后跳详情页。用 `redirect()`：

```tsx
import { redirect } from "react-router";

export async function loader({ request }) {
  const user = await getUser(request); // 你的鉴权逻辑
  if (!user) {
    // 返回（或 throw）一个 redirect，路由会导航到新 URL
    return redirect("/login");
  }
  return { userName: user.name };
}
```

- `redirect(url, init?)`：本质是返回一个带 `Location` 头的 Response（默认状态码 302）。你可以 `return redirect(...)` 或 `throw redirect(...)`，效果一致。
- 常配合「保留来源」：`redirect(`/login?from=${encodeURIComponent(url.pathname)}`)`，登录后再跳回。
- 📌 `redirectDocument(url)`：当你要跳到**当前 SPA 之外**的整页 URL（触发浏览器整页加载）时用它。

> 💡 **redirect 与抛错的区别**：`redirect` 是「正常业务改道」（去另一个页面继续）；`throw data(...)` 是「出错，交给错误边界」（第 6 章）。别用 redirect 去处理「资源不存在」——那应该 `throw data("Not Found", { status: 404 })`。

---

## 3.5 请求取消：`request.signal`（重要的进阶点）

想象一个场景：用户快速点击，从 `/concerts/chicago` 切到 `/concerts/trending`，又立刻切回来。**上一个还没完成的 loader 请求应当被取消**，否则：浪费带宽；更糟的是，晚到的旧响应可能覆盖新页面（竞态）。

React Router 用标准的 **`AbortSignal`** 处理这件事：每个 `request` 都带一个 `signal`，当这次导航被「打断」（用户又发起了新导航）时，这个 signal 会被 abort。你只要把 `signal` 透传给 `fetch`：

```tsx
export async function loader({ request, params }) {
  const res = await fetch(`/api/concerts/${params.city}`, {
    signal: request.signal, // ← 关键：把取消信号交给 fetch
  });
  return res.json();
}
```

当导航被打断、signal abort 时，`fetch` 会 reject 一个 `AbortError`。React Router 会自动忽略这种「因取消而产生的错误」，不会把它当作真正的异常渲染到错误边界。

如果你调用的是自己的 API 层，也要把 signal 传下去：

```ts filename=src/api.ts（支持取消的版本）
export async function getConcertsByCity(
  city: string,
  options: { signal?: AbortSignal } = {}
): Promise<Concert[]> {
  await delay(300, options.signal); // delay 也响应取消
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return concerts.filter((c) => c.city === city);
}

// 让 delay 支持中途取消
function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}
```

对应 loader：

```tsx
export async function loader({ request, params }) {
  const list = await getConcertsByCity(params.city, { signal: request.signal });
  return { concerts: list };
}
```

💡 **什么时候需要关心 signal？**
- 你的 loader 直接 `fetch` 远程接口 → **强烈建议**透传 `signal`。
- 你的 loader 只是从本地缓存/内存同步返回 → 可忽略。
- 记住一句话：**「凡是发起真实异步 I/O 的 loader/action，都应把 `request.signal` 传进去。」** 这是专业与业余的分水岭之一。

> ⚠️ 不要把取消错误当成真错误去 catch 后重新抛出。如果确实要 try/catch，记得放行 abort：
> ```ts
> try {
>   return await fetchData({ signal: request.signal });
> } catch (err) {
>   if (request.signal.aborted) throw err; // 交给路由处理，别吞掉
>   throw data("加载失败", { status: 500 });
> }
> ```

---

## 3.6 loader 返回值 & 抛错的完整语义

| 你在 loader 里做什么 | 结果 |
| --- | --- |
| `return { ... }` | 数据存入 loaderData，组件用 `useLoaderData()` 读 |
| `return new Response(...)` | 直接把该 Response 作为数据（少用；可自定义 status/headers） |
| `return redirect(url)` / `throw redirect(url)` | 导航到 url（改道，不算错误） |
| `throw data(msg, { status })` | 交给**最近的错误边界**（第 6 章），如 404/403 |
| `throw new Error(...)` 或代码本身抛异常 | 也交给错误边界，被识别为「意外异常」 |

> 💡 `data(payload, init)` 是 v7+ 推荐的「抛业务错误」方式，用来替代旧的 `throw new Response(...)`。它让错误边界能通过 `isRouteErrorResponse()` 读到 `status` / `statusText` / `data`。第 6 章详细展开。

---

## 3.7 多个 loader：它们如何协作

一棵匹配的路由链上，**每一层都可以有自己的 loader**（父布局 loader、列表 loader、详情 loader）。React Router 会在渲染前**并行**执行这些 loader，然后把各层数据分别存好：

- 组件用 `useLoaderData()` 读**当前这一层**路由的 loader 数据。
- 用 `useRouteLoaderData(routeId)` 读**其它指定路由**的数据。
- 用 `useMatches()` 读整条匹配链（配合 `handle` 做面包屑等）。

```tsx
// 父布局 loader：加载「城市列表」用于侧边栏
// 子路由 loader：加载「某城市的演唱会」
// 两者并行执行，父组件用 useLoaderData 拿城市列表，子组件拿演唱会列表
```

> 并行加载、避免重复请求、`shouldRevalidate` 的完整讨论放在**第 5 章**。这里先建立「每层路由可有 loader、它们并行跑」的印象。

---

## 3.8 动手实践：给 Concert Hub 接上真实 loader

把前面几段拼进第 2 章的路由树，形成完整的数据流：

```tsx filename=src/router.tsx（节选）
import { createBrowserRouter } from "react-router";
import Root from "./routes/root";
import Home, { loader as homeLoader } from "./routes/home";
import ConcertsLayout, { loader as concertsLayoutLoader } from "./routes/concerts/layout";
import ConcertsCity, { loader as cityLoader } from "./routes/concerts/city";
import ConcertDetail, { loader as detailLoader } from "./routes/concerts/detail";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: Home, loader: homeLoader },
      {
        path: "concerts",
        Component: ConcertsLayout,
        loader: concertsLayoutLoader, // 侧边栏城市列表
        children: [
          { path: ":city", Component: ConcertsCity, loader: cityLoader },
          { path: ":city/:concertId", Component: ConcertDetail, loader: detailLoader },
        ],
      },
    ],
  },
]);
```

🧪 **验证请求取消**：把 `getConcertsByCity` 的 `delay` 调到 2000ms，然后在城市之间**快速来回点击**，打开浏览器 Network 面板——你会看到被中断的请求显示为 `canceled`。这就是 `request.signal` 生效的证据。

---

## ✅ 本章验收清单

- [ ] 我能解释「loader 在组件渲染之前运行」，并说出它替代了组件里的 `useEffect` + loading 三件套。
- [ ] 我会在 loader 里用 `params` 读动态段、用 `new URL(request.url).searchParams` 读查询参数。
- [ ] 我分得清「loader 里用入参 `params`」vs「组件里用 `useParams`」。
- [ ] 我会用 `redirect()` 在 loader 里做改道（如未登录跳登录页），并知道它与 `throw data(404)` 的区别。
- [ ] 我理解 `request.signal` 的作用，会把它透传给 `fetch` 做请求取消，并能处理 `AbortError`。
- [ ] 我能说出 loader 返回值/抛错的各种语义（对象 / Response / redirect / data / Error）。

完成后进入 👉 [**第 4 章：action 数据变更**](./04-action-数据变更.md)。

---

## 🔧 常见坑 / 排错

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `useLoaderData()` 返回 undefined | 组件所在路由没配 loader | 给对应 Route Object 加 `loader` |
| loader 里 `useParams` 报错 | 在 loader（普通函数）里用了 hook | loader 用入参 `params`；hook 只能在组件里用 |
| `searchParams.get()` 报 `null.toLowerCase` | 查询参数不存在返回 null | 先判空或给默认值 |
| 快速切换页面时旧数据闪现 | loader 没接 `request.signal`，旧请求晚到 | 透传 signal 让旧请求被取消 |
| 想跳登录页却渲染成错误 | 用了 `throw data(...,401)` 而非 redirect | 业务改道用 `redirect("/login")` |
| 组件里数据总是「慢半拍」 | 误以为 loader 在渲染后跑 | loader 在渲染前跑；数据到位后才渲染组件 |
