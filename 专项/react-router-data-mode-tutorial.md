# React Router 从 0 到 1：用 Data Mode 构建一套真正可维护的路由系统

> 面向有一点 React 基础、但还没有系统学过路由的新手。本文以官方文档中的 Data Mode 为主线，通过一个可逐步扩展的“任务管理”小应用，讲清页面层级、URL、数据读取、表单提交、导航状态、错误边界、代码拆分和测试如何共同工作。
>
> **版本说明**：本文按照 React Router 当前官方文档的 API 风格编写，使用 `react-router` 包、`createBrowserRouter`、`RouterProvider` 和 route object。官方文档当前版本选择器显示 latest 8.5.0，也提供 7.x 文档；如果你的项目使用 React Router v6，导入路径和部分类型/API 名称可能不同，请以项目安装的主版本文档为准。不要把 v6、v7、v8 的示例随意拼在同一个项目里。

## 目录

1. 先选对模式：为什么使用 Data Mode
2. 创建项目并挂载 RouterProvider
3. 页面层级：嵌套、布局、索引和动态参数
4. 准备数据层与 loader
5. 显示 loader 数据，并把筛选、排序、分页放入 URL
6. action：表单、验证错误和 redirect
7. useFetcher、useNavigation 与 pending UI
8. 错误边界、404、权限拒绝与异常
9. Link、useNavigate 与 useSearchParams
10. route lazy 与动态导入
11. loader/action 单元测试
12. 跑通项目与自我验收
---

## 学完之后，你应该能做到什么

你会把路由理解成应用的“组织结构”，而不是一张 URL 对应一个组件的简单映射。具体来说，你将能够：

- 解释 Declarative、Data、Framework 三种模式的区别，并知道为什么本教程选 Data Mode。
- 用 `createBrowserRouter` 和 `RouterProvider` 建立路由树，理解嵌套路由、布局路由、索引路由和动态参数。
- 把读取数据放进 `loader`，把写入动作放进 `action`，处理搜索参数、重定向、取消请求、服务端返回的验证错误。
- 通过 `useNavigation` 和 `useFetcher` 让页面对加载、提交和局部更新作出及时反馈。
- 区分普通 404、资源不存在、未登录、无权限和意外程序错误。
- 用 `Link`、`useNavigate` 和 `useSearchParams` 管理导航及可分享的筛选、排序、分页状态。
- 为路由做动态导入，并用单元测试验证 loader/action 的关键行为。

## 本教程的学习方式

请按顺序阅读并运行代码。项目在前半段先使用内存数据，目的是让你不必先搭建后端就能练习路由流程；刷新浏览器后，内存中的新增和修改会恢复初始值。后半段会给出接入真实 API 的写法。**内存仓库只是教学替身，不是生产数据库。**

---

# 第 1 章：先选对模式——为什么本教程使用 Data Mode

React Router 官方将使用方式分为三种模式。它们不是三套毫不相干的库，而是逐步增加能力、同时把更多架构决策交给 React Router 的三种用法。[官方模式选择指南](https://reactrouter.com/start/modes)

### Declarative Mode：只负责“去哪一个页面”

最常见的入口是 `BrowserRouter`，再在 React 组件树中声明 `<Routes>` 和 `<Route>`：

```jsx
import { BrowserRouter, Routes, Route } from "react-router";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/tasks" element={<TaskList />} />
      </Routes>
    </BrowserRouter>
  );
}
```

它很适合简单站点：匹配 URL、切换组件、使用 `Link` 导航。问题在于，数据读取、表单写入、加载中状态和错误处理通常要由应用自己组织。页面一多，就容易在 `useEffect`、本地 loading state 和手写 `fetch` 之间散落大量逻辑。

### Data Mode：把“路由、数据和提交”放进同一张路由表

Data Mode 将路由配置移出 React 渲染过程，支持 `loader`、`action`、导航/提交 pending 状态和 `useFetcher` 等能力。最基本的结构是：

```jsx
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    loader: rootLoader,
  },
]);

// 在入口文件中：
// createRoot(document.getElementById("root")).render(
//   <RouterProvider router={router} />
// );
```

你可以在路由定义里同时回答四个问题：这个 URL 匹配谁、页面长什么样、渲染前需要什么数据、用户提交时执行什么操作。官方文档指出，匹配到的路由在导航时会运行其 loader，数据通过 `useLoaderData` 进入组件。[Data Loading](https://reactrouter.com/start/data/data-loading) [Actions](https://reactrouter.com/start/data/actions)

### Framework Mode：让框架帮你管理更多工程能力

Framework Mode 在 Data Mode 的基础上增加 Vite 插件、Route Module、类型安全的路由 API、自动代码拆分，以及 SPA/SSR/静态预渲染等集成能力。如果你还没决定工程架构、想要更完整的开箱即用体验，官方也建议认真考虑 Framework Mode。[官方模式选择指南](https://reactrouter.com/start/modes)

### 那为什么这里选 Data Mode？

因为本教程的目标是**学习路由系统的运行机制**，而不是先引入一套完整应用框架。Data Mode 很适合下面的情形：

1. 项目已经有自己的 Vite、构建和 API 方案。
2. 需要 `loader/action/fetcher` 这套数据导航模型，但仍希望控制项目结构和服务端抽象。
3. 想从组件级路由过渡到更明确的路由配置，而暂时不需要 Framework Mode 的整套约定。

这并不意味着 Data Mode 永远更好。如果你要从零开始构建应用，而且想让路由、SSR、部署和类型安全尽可能由框架统一管理，Framework Mode 可能更省心。**选择模式是在“自己控制多少”和“框架替你做多少”之间做取舍。**

本教程会使用 Data Mode 贯穿全篇，但它不会自动给前端代码提供服务器安全性：在浏览器项目里，loader/action 可以在客户端调用 API；真正的身份验证、权限校验和数据写入保护仍必须在后端完成。

---

# 第 2 章：创建项目，先让路由跑起来

确认本机已经安装 Node.js 和 npm。用 Vite 创建 React 项目：

```bash
npm create vite@latest rr-data-lab -- --template react
cd rr-data-lab
npm install
npm install react-router
npm run dev
```

打开终端给出的本地地址，先确认 Vite 默认页面可见。然后把项目整理成下面的结构：

```text
src/
  main.jsx
  router.jsx
  data/
    tasks.js
  routes/
    root.jsx
    pages.jsx
    tasks.jsx
    admin.jsx
```

这不是唯一的目录结构，只是一种便于学习的拆分方式。初期可以把 route object 集中在 `router.jsx`；当某个路由逻辑变复杂时，再把 loader、action 和组件移到独立模块。

## 2.1 入口只创建一次 router

把 `src/main.jsx` 改为：

```jsx
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import { router } from "./router.jsx";

createRoot(document.getElementById("root")).render(
  <RouterProvider router={router} />
);
```

再新建 `src/router.jsx`：

```jsx
import { createBrowserRouter } from "react-router";
import { RootLayout, RootErrorBoundary } from "./routes/root.jsx";
import { HomePage, NotFoundPage } from "./routes/pages.jsx";
import {
  TasksLayout,
  TaskListPage,
  taskListLoader,
  NewTaskPage,
  createTaskAction,
  TaskDetailPage,
  taskDetailLoader,
  toggleTaskAction,
} from "./routes/tasks.jsx";
import {
  AdminPage,
  adminLoader,
  AccessDeniedBoundary,
} from "./routes/admin.jsx";

export const router = createBrowserRouter([
  {
    id: "root",
    path: "/",
    Component: RootLayout,
    ErrorBoundary: RootErrorBoundary,
    children: [
      { index: true, Component: HomePage },
      {
        path: "tasks",
        Component: TasksLayout,
        children: [
          { index: true, loader: taskListLoader, Component: TaskListPage },
          { path: "new", action: createTaskAction, Component: NewTaskPage },
          {
            path: ":taskId",
            loader: taskDetailLoader,
            action: toggleTaskAction,
            Component: TaskDetailPage,
          },
        ],
      },
      {
        path: "admin",
        loader: adminLoader,
        Component: AdminPage,
        ErrorBoundary: AccessDeniedBoundary,
      },
      { path: "*", Component: NotFoundPage },
    ],
  },
]);
```

先不用担心这些 import 暂时还找不到；下一章会逐个建立它们。这里先看两件事：`router` 在 React 树外创建一次，不要在每次组件渲染时重复调用 `createBrowserRouter`；`RouterProvider` 则负责把这套路由状态交给整个应用使用。[RouterProvider 官方 API](https://reactrouter.com/api/data-routers/RouterProvider)

## 2.2 先记住一次导航的大致流程

当用户访问 `/tasks/42` 时，React Router 大体会：

1. 根据 URL 匹配路由树，找出根布局、任务布局和 `:taskId` 页面。
2. 运行需要的数据加载逻辑；匹配路由的 loaders 默认可以并行执行。
3. 等待必要的数据准备好后，渲染各级组件；每一级通过 `<Outlet />` 放入其子页面。
4. 导航过程中暴露 pending 状态；若 loader/action 出错，则交给最近的路由错误边界。

把这个流程记牢，后面 loader、action、pending UI 和错误边界就不再是零散 API，而是同一条链路的不同环节。

---

# 第 3 章：先建页面层级——嵌套路由、布局路由、索引路由和动态参数

假设应用有主页、任务列表、任务详情、创建任务和管理页。理想的 URL 约定如下：

- `/`：主页；使用 index route。
- `/tasks`：任务列表；是 `tasks` 路由下的 index route。
- `/tasks/new`：新建任务；是静态子路径。
- `/tasks/42`：ID 为 42 的任务详情；使用动态参数 `:taskId`。
- `/admin`：管理页；用于演示权限判断。
- `/anything-else`：未匹配路径；由 catch-all `*` 兜底。

## 3.1 嵌套路由不只是缩短 URL

`/tasks/42` 不一定要从头渲染整张页面。它可以保留全站导航，再保留任务模块的标题/二级导航，最后只替换详情区域。路由树表达的正是这种 UI 层级。

在 `src/routes/root.jsx` 中写：

```jsx
import { Link, Outlet, useNavigation } from "react-router";

export function RootLayout() {
  const navigation = useNavigation();
  const isNavigating = navigation.state !== "idle";

  return (
    <div className="app-shell">
      <header>
        <h1>Route Lab</h1>
        <nav aria-label="主导航">
          <Link to="/">主页</Link>{" | "}
          <Link to="/tasks">任务</Link>{" | "}
          <Link to="/admin">管理</Link>
        </nav>
        {isNavigating && (
          <p role="status" aria-live="polite">正在加载目标页面……</p>
        )}
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
```

`Outlet` 是嵌套路由的插槽：父路由负责不会随子路径变化的布局，子路由会在这个位置渲染。忘记写 `Outlet` 是新手最常见的问题之一：URL 匹配了，父组件也出来了，但子页面看不到。

## 3.2 Index route：父路径本身的默认页面

配置 `{ index: true, Component: TaskListPage }` 表示当用户访问 `/tasks` 时，把 `TaskListPage` 渲染到 `TasksLayout` 的 `Outlet` 中。它没有独立 path，也不能拥有子路由。

`src/routes/tasks.jsx` 中先定义布局：

```jsx
import { Link, Outlet } from "react-router";

export function TasksLayout() {
  return (
    <section>
      <h2>任务中心</h2>
      <p>
        <Link to="/tasks">全部任务</Link>{" | "}
        <Link to="/tasks/new">创建任务</Link>
      </p>
      <Outlet />
    </section>
  );
}
```

这里 `/tasks` 的 index route 是 `Outlet` 的默认子页面；访问 `/tasks/new` 时，`NewTaskPage` 则会替换进同一个位置。父级布局并不会因为子路径改变就消失。

## 3.3 Layout route：只创建组件层级，不增加 URL 片段

有些布局不是一个有意义的 URL 层级。例如，营销页面有一套页眉，登录/注册页面共享一个简洁布局。你可以创建不带 `path` 的 route object：

```jsx
const routes = [
  {
    Component: MarketingLayout,
    children: [
      { index: true, Component: MarketingHome },
      { path: "pricing", Component: PricingPage },
    ],
  },
];
```

这个 layout route 增加了 React 渲染层级，但不会额外增加路径片段。`/` 和 `/pricing` 都会渲染进 `MarketingLayout` 的 `Outlet`。注意，layout route 和普通带路径的父路由相似，但前者没有自己的 URL 段。[官方 Routing 指南](https://reactrouter.com/start/data/routing)

## 3.4 动态参数：路径中放资源的身份

路由中的 `:taskId` 是动态段。`/tasks/42` 匹配后，loader/action 中会获得 `params.taskId === "42"`。参数值始终先作为字符串处理，需要数字时要自行校验和转换。

```jsx
{
  path: "tasks/:taskId",
  loader: async ({ params }) => {
    const task = await getTask(params.taskId);
    return { task };
  },
  Component: TaskDetailPage,
}
```

不要将一个资源 ID 塞进 React 本地 state 并忘了同步 URL：像 `/tasks/42` 这样的地址可以被收藏、分享、刷新后再次打开，也方便日志和测试定位问题。

---

# 第 4 章：准备数据层，并理解 loader 为什么比 useEffect 更适合路由数据

在真实应用里，路由数据通常来自后端 API。本教程先创建一个小型内存仓库，让新增和修改动作可以在浏览器导航期间演示。

建立 `src/data/tasks.js`：

```js
const initialTasks = [
  { id: "1", title: "理解路由树", description: "画出父子页面关系", status: "open", createdAt: "2026-01-05T09:00:00Z" },
  { id: "2", title: "编写第一个 loader", description: "在组件渲染前读取数据", status: "done", createdAt: "2026-01-06T09:00:00Z" },
  { id: "3", title: "学习 action", description: "处理表单和重定向", status: "open", createdAt: "2026-01-07T09:00:00Z" },
  { id: "4", title: "让筛选进入 URL", description: "分享链接后仍能复现条件", status: "open", createdAt: "2026-01-08T09:00:00Z" },
  { id: "5", title: "为 loader 编写测试", description: "覆盖参数和缺失数据", status: "done", createdAt: "2026-01-09T09:00:00Z" },
];

let tasks = initialTasks.map((task) => ({ ...task }));
let nextId = 6;

export async function listTasks({ q = "", status = "all", sort = "newest" } = {}) {
  let result = tasks.filter((task) => {
    const matchesQuery = `${task.title} ${task.description}`
      .toLowerCase()
      .includes(q.toLowerCase());
    const matchesStatus = status === "all" || task.status === status;
    return matchesQuery && matchesStatus;
  });

  if (sort === "title") {
    result = result.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  } else if (sort === "oldest") {
    result = result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } else {
    result = result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return result.map((task) => ({ ...task }));
}

export async function getTask(id) {
  const task = tasks.find((item) => item.id === String(id));
  return task ? { ...task } : null;
}

export async function createTask({ title, description }) {
  const task = {
    id: String(nextId++),
    title,
    description,
    status: "open",
    createdAt: new Date().toISOString(),
  };
  tasks = [task, ...tasks];
  return { ...task };
}

export async function toggleTask(id) {
  const index = tasks.findIndex((item) => item.id === String(id));
  if (index === -1) return null;

  tasks[index] = {
    ...tasks[index],
    status: tasks[index].status === "open" ? "done" : "open",
  };
  return { ...tasks[index] };
}
```

## 4.1 loader 的职责：页面要显示之前，先准备好它需要的数据

在 `src/routes/tasks.jsx` 顶部引入数据函数和路由 API：

```jsx
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { useEffect, useState } from "react";
import { createTask, getTask, listTasks, toggleTask } from "../data/tasks.js";
```

然后创建列表 loader：

```jsx
export async function taskListLoader({ request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const rawStatus = url.searchParams.get("status") ?? "all";
  const rawSort = url.searchParams.get("sort") ?? "newest";
  const status = ["all", "open", "done"].includes(rawStatus) ? rawStatus : "all";
  const sort = ["newest", "oldest", "title"].includes(rawSort) ? rawSort : "newest";

  const allTasks = await listTasks({ q, status, sort });
  const pageSize = 2;
  const totalPages = Math.max(1, Math.ceil(allTasks.length / pageSize));
  const parsedPage = Number(url.searchParams.get("page") ?? "1");
  const requestedPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;

  return {
    tasks: allTasks.slice(start, start + pageSize),
    q,
    status,
    sort,
    page,
    totalPages,
    total: allTasks.length,
  };
}
```

路由已经匹配到 `/tasks` 后，`taskListLoader` 会读取当前完整 URL，再把整理好的数据返回。组件只需要 `useLoaderData()`，不用再在 `useEffect` 里发起同一份请求、单独保存 `loading`、处理竞态并决定错误显示在哪里。

## 4.2 搜索参数是 URL 的一部分，loader 可以直接读取

例如访问：

```text
/tasks?q=router&status=open&sort=title&page=2
```

`request.url` 是标准的 Request URL；通过 `new URL(request.url)` 可以读取 pathname 和 search params。不要把 `q`、`status`、`sort` 或 `page` 当作只存在于输入框里的临时值：只要它们会改变用户看到的数据，而且希望可以分享或刷新恢复，就应该考虑放进 URL。

## 4.3 动态详情的 loader

继续在 `tasks.jsx` 中写：

```jsx
export async function taskDetailLoader({ params }) {
  const task = await getTask(params.taskId);
  if (!task) {
    throw data("找不到这条任务记录。", { status: 404 });
  }
  return { task };
}
```

当 `/tasks/999` 没有对应任务时，loader 不应返回一个看似成功但内容为空的对象，而应明确表示这是 404。稍后我们会让错误边界负责呈现这类情况。

## 4.4 真实 API、请求取消与重定向

内存仓库不会发网络请求，因此也不需要取消信号。接入后端时，请把 `request.signal` 传给 `fetch`：

```jsx
export async function taskDetailLoader({ params, request }) {
  const response = await fetch(`/api/tasks/${params.taskId}`, {
    signal: request.signal,
  });

  if (response.status === 404) {
    throw data("找不到这条任务记录。", { status: 404 });
  }
  if (!response.ok) {
    throw new Error(`读取任务失败：${response.status}`);
  }
  return { task: await response.json() };
}
```

`request.signal` 使 React Router 中断已经过时的导航时，底层 `fetch` 也能响应取消。比如用户先点开任务 A，A 还没加载完又点了任务 B，路由会优先处理新的导航，并取消不再需要的客户端请求。[Race Conditions](https://reactrouter.com/explanation/race-conditions)

要理解“取消”的边界：取消浏览器请求并不保证服务器完全没有收到请求，也不能撤销已经发生的数据库写入。对写操作仍要设计幂等性、事务和必要的版本/时间戳校验。

在 loader 中也可以重定向：

```jsx
import { redirect } from "react-router";

export async function protectedLoader({ request }) {
  const user = await getCurrentUser();
  if (!user) {
    const url = new URL(request.url);
    throw redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
  }
  return { user };
}
```

这段是模式示例，`getCurrentUser()` 需要由你的应用实现。若只是根据路由数据决定去哪里，优先从 loader/action 返回或抛出 `redirect()`，通常比在组件中通过 effect 再调用 `useNavigate()` 更直接。[useNavigate 官方 API](https://reactrouter.com/api/hooks/useNavigate)

---

# 第 5 章：让页面显示 loader 数据，并把筛选、排序和分页写回 URL

在 `src/routes/tasks.jsx` 继续实现 `TaskListPage`。这页将同时练习 `useLoaderData`、`useSearchParams` 和 `Link`。

```jsx
export function TaskListPage() {
  const { tasks, q, status, sort, page, totalPages, total } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draftQ, setDraftQ] = useState(q);

  useEffect(() => setDraftQ(q), [q]);

  function updateParam(key, value) {
    const next = new URLSearchParams(searchParams);
    if (value === "" || value == null) next.delete(key);
    else next.set(key, String(value));
    if (key !== "page") next.set("page", "1");
    setSearchParams(next);
  }

  function submitSearch(event) {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    const cleaned = draftQ.trim();
    if (cleaned) next.set("q", cleaned);
    else next.delete("q");
    next.set("page", "1");
    setSearchParams(next);
  }

  return (
    <div>
      <h3>任务列表</h3>
      <form onSubmit={submitSearch}>
        <label>
          搜索任务：
          <input value={draftQ} onChange={(event) => setDraftQ(event.target.value)} />
        </label>
        <button type="submit">搜索</button>
      </form>

      <label>
        状态：
        <select value={status} onChange={(event) => updateParam("status", event.target.value)}>
          <option value="all">全部</option>
          <option value="open">未完成</option>
          <option value="done">已完成</option>
        </select>
      </label>

      <label>
        排序：
        <select value={sort} onChange={(event) => updateParam("sort", event.target.value)}>
          <option value="newest">最新优先</option>
          <option value="oldest">最早优先</option>
          <option value="title">按标题</option>
        </select>
      </label>

      <p>共 {total} 条，当前第 {page} / {totalPages} 页。</p>
      {tasks.length === 0 ? (
        <p>没有找到符合条件的任务，请调整搜索条件。</p>
      ) : (
        <ul>
          {tasks.map((task) => (
            <li key={task.id}>
              <Link to={`/tasks/${task.id}`}>{task.title}</Link>
              {task.status === "done" ? "（已完成）" : "（未完成）"}
            </li>
          ))}
        </ul>
      )}

      <button disabled={page <= 1} onClick={() => updateParam("page", page - 1)}>
        上一页
      </button>{" "}
      <button disabled={page >= totalPages} onClick={() => updateParam("page", page + 1)}>
        下一页
      </button>
    </div>
  );
}
```

运行应用后，访问 `/tasks` 并搜索关键词、切换状态或排序。你会看到地址栏同步变化，例如：

```text
/tasks?q=loader&status=open&sort=title&page=1
```

复制这条 URL 到新标签页，应当能重新得到同一组筛选条件。这就是 URL 作为页面状态来源的价值：可分享、可收藏、可刷新恢复，也能自然支持浏览器前进/后退。

### 为什么有时仍需要本地 state？

搜索框中的 `draftQ` 是用户正在输入、尚未点击“搜索”的草稿；它暂时保存在本地 state 很合理。真正影响查询结果的 `q` 则写入 URL 后再由 loader 读取。一个实用判断方式是：

- **应该进入 URL**：用户希望分享、收藏、刷新恢复或通过前进/后退复现的筛选、排序、分页、标签页。
- **适合本地 state**：尚未提交的表单草稿、弹窗是否打开、鼠标 hover、临时动画状态。
- **适合 loader/action 和后端**：权威业务数据、需要权限验证的数据读取、会影响持久化数据的写操作。

`useSearchParams` 返回当前查询参数和一个更新函数。调用更新函数会触发导航；不要直接修改 `searchParams` 对象却不调用 `setSearchParams`，否则对象值可能变了但 URL 不会同步。官方还提醒，短时间内多次调用 setter 不会像 React state updater 那样自动排队合并，因此多项参数更新时应先构造一个 `URLSearchParams` 再一次提交。[useSearchParams API](https://reactrouter.com/api/hooks/useSearchParams)

---

# 第 6 章：用 action 处理表单提交、验证错误和 redirect

`loader` 负责读取，`action` 负责处理写入。通过 React Router 的 `<Form method="post">` 提交时，路由会调用匹配目标的 action；action 成功后，相关 loader 数据会自动重新验证，让界面反映新数据，而不必每次都手工刷新列表。[Actions 官方指南](https://reactrouter.com/start/data/actions)

## 6.1 创建任务的 action

在 `src/routes/tasks.jsx` 加入：

```jsx
export async function createTaskAction({ request }) {
  const formData = await request.formData();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const errors = {};

  if (!title) errors.title = "请填写任务标题。";
  if (title.length > 80) errors.title = "标题不能超过 80 个字符。";

  if (Object.keys(errors).length > 0) {
    return data({ errors, values: { title, description } }, { status: 400 });
  }

  await createTask({ title, description });
  return redirect("/tasks");
}
```

这里有三种结果：

1. 验证失败：返回带错误字段的 action 数据，保留用户输入，不需要把它当作程序崩溃。
2. 创建成功：`redirect("/tasks")` 让用户回到任务列表。
3. 真正无法预期的失败：例如 API 报 500 或代码抛出异常，交给路由错误边界，而不是伪装成某个字段的验证错误。

`data(..., { status: 400 })` 用来返回带 HTTP 状态信息的 action 数据，方便把验证失败明确表示为客户端请求问题。React Router 的表单验证示例同样使用这种模式。[Form Validation](https://reactrouter.com/how-to/form-validation)

## 6.2 编写表单组件

同一文件中添加：

```jsx
export function NewTaskPage() {
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const errors = actionData?.data?.errors ?? actionData?.errors;
  const values = actionData?.data?.values ?? actionData?.values;

  return (
    <div>
      <h3>创建任务</h3>
      <Form method="post">
        <p>
          <label>
            标题：
            <input name="title" defaultValue={values?.title ?? ""} aria-invalid={Boolean(errors?.title)} />
          </label>
          {errors?.title && <span role="alert">{errors.title}</span>}
        </p>
        <p>
          <label>
            描述：
            <textarea name="description" defaultValue={values?.description ?? ""} />
          </label>
        </p>
        <button disabled={isSubmitting} type="submit">
          {isSubmitting ? "正在保存……" : "创建任务"}
        </button>
      </Form>
    </div>
  );
}
```

注意：`useActionData()` 的具体包装形态会受所用 API 和返回值写法影响。若你的版本将 `data()` 包装在 `.data` 中，就读取 `actionData.data.errors`；若 action 直接返回普通对象，就读取 `actionData.errors`。开发时可以先 `console.log(actionData)` 确认实际结构，之后在项目中统一约定一种返回形态。这个教程在后面的测试章节也会提醒对状态码和数据结构进行验证。

本页面用 `useNavigation` 的 `submitting` 状态禁用按钮，避免用户连续点击。表单提交状态、字段级验证信息和路由级异常是三种不同 UI，不要用同一个全屏错误页处理全部情况。

## 6.3 将真实后端的验证错误映射到表单

在真实项目中，前端 action 往往只是调用 API 的协调层。下面展示典型的适配方式；`/api/tasks` 需要由你的后端实现：

```jsx
export async function createTaskAction({ request }) {
  const formData = await request.formData();
  const response = await fetch("/api/tasks", {
    method: "POST",
    body: formData,
    signal: request.signal,
  });

  if (response.status === 422) {
    const body = await response.json(); // 约定后端返回 { errors: { title: "..." } }
    return data({ errors: body.errors }, { status: 400 });
  }
  if (response.status === 401) {
    const path = new URL(request.url).pathname;
    throw redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  if (response.status === 403) {
    throw data("你没有创建任务的权限。", { status: 403 });
  }
  if (!response.ok) {
    throw new Error(`创建任务失败：${response.status}`);
  }

  return redirect("/tasks");
}
```

后端返回的字段验证问题应映射回表单；401 通常表示当前请求需要登录；403 表示身份已知但没有权限；5xx 或未知异常则应进入错误边界并记录诊断信息。**不要只在前端隐藏按钮就当作完成了权限控制**，任何重要 API 都必须在服务器端验证当前用户和资源权限。

---

# 第 7 章：用 useFetcher 做局部提交；用 useNavigation 做全局 pending UI

理解这两个 API 的关键在于：它们服务于两种不同的交互。

- `useNavigation` 跟踪当前的**页面导航或导航式表单提交**，适合全局进度条、页面切换提示、提交按钮禁用。
- `useFetcher` 跟踪一个**不需要改变 URL 的独立数据交互**，适合局部保存、切换任务状态、自动补全、收藏按钮等。每个 fetcher 有自己的 `state` 和 `data`，可以与其他请求并行工作。[useNavigation](https://reactrouter.com/api/hooks/useNavigation) [useFetcher](https://reactrouter.com/api/hooks/useFetcher)

## 7.1 先实现详情页

```jsx
export function TaskDetailPage() {
  const { task } = useLoaderData();
  const fetcher = useFetcher();
  const isBusy = fetcher.state !== "idle";

  return (
    <article>
      <h3>{task.title}</h3>
      <p>{task.description || "暂无描述"}</p>
      <p>状态：{task.status === "done" ? "已完成" : "未完成"}</p>
      <fetcher.Form method="post">
        <button name="_intent" value="toggle" disabled={isBusy}>
          {isBusy ? "正在更新……" : task.status === "done" ? "重新打开" : "标记完成"}
        </button>
      </fetcher.Form>
      <p><Link to="/tasks">返回列表</Link></p>
    </article>
  );
}

export async function toggleTaskAction({ request, params }) {
  const formData = await request.formData();
  if (formData.get("_intent") !== "toggle") {
    throw data("不支持的任务操作。", { status: 400 });
  }

  const task = await toggleTask(params.taskId);
  if (!task) throw data("找不到这条任务记录。", { status: 404 });
  return { ok: true };
}
```

因为表单是 `<fetcher.Form>`，提交 action 后不会像普通 `<Form>` 一样把浏览器导航到另一个 URL。动作成功后，相关 loader 数据仍会按 React Router 的机制重新验证，详情页会读到更新后的任务状态。

## 7.2 全局 pending UI

前面在 `RootLayout` 已经写过：

```jsx
const navigation = useNavigation();
const isNavigating = navigation.state !== "idle";
```

`navigation.state` 常用的值是 `idle`、`submitting` 和 `loading`。通常页面链接触发的数据加载会进入 `loading`，导航式表单提交会先进入 `submitting`；之后可能进行 loader 重新验证。可以把状态显示在全局页眉，也可以只显示在某个按钮附近。

不要将 `navigation.state` 当成所有数据请求的全局状态：一个 `fetcher` 的请求不一定导致页面导航。对于局部交互，应该读取对应的 `fetcher.state`。

## 7.3 用并行加载提升体验，但不要把 loader 当成串行流水线

React Router 默认会并行执行目标页面匹配到的 loaders，以减少网络瀑布。[Network Concurrency Management](https://reactrouter.com/explanation/concurrency) 这意味着：父路由 loader 和子路由 loader 不应该默认假设“父级数据已经先准备好”。

如果根布局和详情页都要同一个当前用户信息，避免各自无条件请求同一个 `/api/me`。可以考虑：

- 把真正共享的数据放在适当的祖先 loader 中，再通过 `useRouteLoaderData("root")` 读取它；`root` 是前面配置的 route id。
- 把 API 访问封装在 service 层，必要时使用有明确失效策略的缓存/去重层。
- 不要在 loader 已经读取任务后，又在同一组件的 `useEffect` 中重复请求同一份任务数据。
- action 成功后通常已有自动 revalidation，不要紧接着无条件再手动拉一遍相同数据。
- 只有在性能测量表明默认重新验证确实昂贵、并且能证明跳过它不会让页面变旧时，才使用 `shouldRevalidate` 优化。官方将这视为有意识的优化点，而不是默认必写的配置。[Route Object](https://reactrouter.com/start/data/route-object)

### useNavigation 与 useFetcher 如何选择

- **点击链接打开一个新页面**：使用 `Link`，状态用 `useNavigation` 或 `NavLink` 的 pending 状态。
- **创建任务，成功后跳到列表**：使用 `<Form method="post">`、`action` 和 `redirect`。
- **在详情页切换完成状态，URL 不变**：使用 `useFetcher` 与 `fetcher.Form`。
- **搜索条件更新并希望可分享**：使用 `useSearchParams`，由 loader 读取新 URL。
- **定时刷新/局部加载但不切换页面**：可使用 `fetcher.load`，并明确它请求的是哪个 loader。

---

# 第 8 章：错误边界、404、权限拒绝与意外异常

一个稳定的路由系统不只是“能显示正确页面”，还要对不同失败给出正确反馈。先把这四类情况分清：

1. **URL 根本不匹配**：用户访问 `/does-not-exist`，应该显示站点级 Not Found 页面。
2. **URL 匹配了，但资源不存在**：`/tasks/999` 匹配详情路由，却没有对应任务；loader 应抛出 404 数据。
3. **权限问题**：用户没有登录应跳转登录页；已登录但无访问权限应显示 403/拒绝访问页面。
4. **意外异常**：API 500、程序 bug、未预期的异常值；交给错误边界兜底，而不是让整个 React 树白屏。

## 8.1 根错误边界

在 `src/routes/root.jsx` 中，把原来的 import 替换为下面这组完整导入，再添加错误边界组件：

```jsx
import {
  isRouteErrorResponse,
  Link,
  Outlet,
  useNavigation,
  useRouteError,
} from "react-router";

export function RootErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return (
        <main>
          <h1>找不到页面或资源</h1>
          <p>{String(error.data ?? error.statusText ?? "请求的内容不存在。")}</p>
          <Link to="/">返回主页</Link>
        </main>
      );
    }
    if (error.status === 403) {
      return (
        <main>
          <h1>没有访问权限</h1>
          <p>{String(error.data ?? "当前账号不能访问此内容。")}</p>
          <Link to="/">返回主页</Link>
        </main>
      );
    }
    return (
      <main>
        <h1>请求失败（{error.status}）</h1>
        <p>{String(error.data ?? error.statusText ?? "请稍后重试。")}</p>
      </main>
    );
  }

  // 实际项目应在这里接入错误监控；生产界面不要把敏感堆栈直接展示给用户。
  console.error(error);
  return (
    <main>
      <h1>发生了意外错误</h1>
      <p>我们已无法完成这次操作，请稍后重试。</p>
      <Link to="/">返回主页</Link>
    </main>
  );
}
```

根错误边界是最后防线。一个子路由也可以配置自己的错误边界，这样详情页加载失败不会把整站布局都替换掉。当前 route object 写法可以使用 `ErrorBoundary: MyBoundary`；较早的教程里常见 `errorElement: <MyBoundary />`。二者表达的都是路由错误 UI 的位置，但代码形态要与所使用版本保持一致。

React Router 会把 loader、action 以及路由组件执行期间的错误交给最近的错误边界。错误边界适合处理意外异常和无法继续渲染的资源状态；不要把普通表单验证错误通过 throw 强行送进错误边界。[官方 Error Boundaries 指南](https://reactrouter.com/how-to/error-boundary)

## 8.2 未匹配 URL 的 Not Found 页面

建立 `src/routes/pages.jsx`：

```jsx
import { Link } from "react-router";

export function HomePage() {
  return (
    <div>
      <h2>欢迎</h2>
      <p>从任务列表开始学习 Data Mode。</p>
      <Link to="/tasks">打开任务列表</Link>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <section>
      <h2>404：页面不存在</h2>
      <p>这个地址没有对应的页面。</p>
      <Link to="/">返回主页</Link>
    </section>
  );
}
```

根路由的 `children` 中存在 `{ path: "*", Component: NotFoundPage }`，所以任意没被更具体路由匹配的 URL 都会进入此页。这与 `/tasks/999` 不同：后者确实匹配 `:taskId`，只是在 loader 中找不到资源，因此交给错误边界呈现资源级 404。

## 8.3 403 与登录重定向示例

建立 `src/routes/admin.jsx`：

```jsx
import { data, Link, useLoaderData, useRouteError, isRouteErrorResponse } from "react-router";

export async function adminLoader() {
  // 教学示例：模拟一个已登录但没有 admin 角色的用户。
  const user = { id: "demo-user", roles: ["viewer"] };

  // 真实项目通常先从后端会话/API 获取当前用户：
  // if (!user) throw redirect("/login?next=%2Fadmin");
  if (!user.roles.includes("admin")) {
    throw data("当前账号没有管理员权限。", { status: 403 });
  }
  return { message: "管理页面" };
}

export function AdminPage() {
  const { message } = useLoaderData();
  return <h2>{message}</h2>;
}

export function AccessDeniedBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 403) {
    return (
      <section>
        <h2>403：访问被拒绝</h2>
        <p>{String(error.data ?? "你没有访问权限。")}</p>
        <Link to="/">返回主页</Link>
      </section>
    );
  }
  return <h2>管理页面暂时不可用。</h2>;
}
```

访问 `/admin` 会由最靠近的 `AccessDeniedBoundary` 处理 403。记住：这个浏览器端 loader 只用于决定 UI 应如何响应 API 结果，不能保护真实的数据。恶意用户可以绕过前端，因此后端必须对每次受保护的读写请求重新验证会话、角色和资源权限。

## 8.4 错误处理的推荐分工

- 字段格式不对：action 返回验证数据，组件显示在字段附近。
- 用户没登录：loader/action 根据后端认证结果 `redirect` 到登录流程。
- 用户没有权限：以 403 表示，并提供权限提示或申请入口。
- 路由/资源不存在：返回或抛出 404，显示 Not Found。
- 网络断开、API 500、代码 bug：错误边界显示安全且可理解的失败提示，同时把诊断记录送到监控系统。

不要把所有错误都显示成“系统异常”，也不要把详细服务器堆栈展示给终端用户。

---

# 第 9 章：选择合适的导航 API

路由导航常用的三个 API 解决的是不同的问题。

## 9.1 用 Link 表达普通页面跳转

```jsx
import { Link } from "react-router";

<Link to="/tasks">任务列表</Link>
<Link to={`/tasks/${task.id}`}>查看详情</Link>
```

当用户点击一个本来就应该是链接的东西时，优先使用 `Link`。它保留浏览器链接语义，支持在新标签打开、复制链接等常规行为。不要把所有点击都改写成 `onClick={() => navigate(...)}`。

## 9.2 用 useNavigate 表达命令式导航

当导航是某个交互/流程的结果，而不是文档中的普通链接时，使用 `useNavigate`：

```jsx
import { useNavigate } from "react-router";

function CancelButton() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>返回上一页</button>;
}
```

也可以 `navigate("/tasks", { replace: true })` 替换历史记录，或导航到一个明确 URL。不要在没有历史记录保证的流程里盲目使用 `navigate(-1)`，因为用户可能从外部直接打开这个页面；必要时提供明确的 fallback 路径。

如果你是在 loader/action 中依据数据决定下一步，通常优先使用 `redirect()`，不需要先渲染组件再命令式导航。[useNavigate API](https://reactrouter.com/api/hooks/useNavigate)

## 9.3 用 useSearchParams 管理可分享的页面状态

第 5 章已经展示了筛选、排序和分页。再强调几个细节：

- 更新查询参数本身会触发导航，匹配路由的 loader 可能因此重新运行。
- 修改筛选或排序条件时，通常应将分页重置到第 1 页；否则原本第 5 页的结果集变小后可能显示空页面。
- 解析 `page` 这类数字时要验证合法性，解析 `status`、`sort` 这类枚举时要采用白名单，不要信任 URL 输入。
- 对多项参数，应在同一个 `URLSearchParams` 实例上完成所有修改后再一次 `setSearchParams`，避免连续 setter 调用不能按 React state 的方式排队合并的问题。

实践原则：**URL 决定用户当前正在查看哪一组可复现的数据；loader 根据 URL 准备结果；组件负责把参数呈现为控件。**

---

# 第 10 章：route lazy 与动态导入——按路由拆分代码

路由代码拆分不是为了让代码“看起来更高级”，而是避免用户刚打开主页时就下载所有低频页面的 JS。Data Mode 可以在 route object 上使用 `lazy`，按需要动态导入组件和路由逻辑。[Route Object：lazy](https://reactrouter.com/start/data/route-object)

## 10.1 先理解动态导入

普通静态 import 通常会让模块进入初始依赖图：

```jsx
import { ReportsPage } from "./routes/reports.jsx";
```

动态导入则返回一个 Promise，在运行到它时才请求相应模块：

```jsx
const module = await import("./routes/reports.jsx");
```

在 Data Mode 中可用 route `lazy` 将路由组件、loader 和 action 延迟加载。路由匹配所必需的 `path`、`index`、`children` 等结构信息需要保留在初始路由配置中；要延迟加载的是可选的实现模块。

## 10.2 把低频的任务页面拆成模块

例如，将任务页面分别整理为 `tasks-index.jsx`、`new-task.jsx`、`task-detail.jsx` 和 `tasks-layout.jsx`，并确保每个模块导出相应组件和 loader/action。然后在路由表中用 `lazy`：

```jsx
import { createBrowserRouter } from "react-router";
import { RootLayout, RootErrorBoundary } from "./routes/root.jsx";
import { HomePage, NotFoundPage } from "./routes/pages.jsx";

export const router = createBrowserRouter([
  {
    id: "root",
    path: "/",
    Component: RootLayout,
    ErrorBoundary: RootErrorBoundary,
    children: [
      { index: true, Component: HomePage },
      {
        path: "tasks",
        lazy: async () => {
          const module = await import("./routes/tasks-layout.jsx");
          return { Component: module.TasksLayout };
        },
        children: [
          {
            index: true,
            lazy: async () => {
              const module = await import("./routes/tasks-index.jsx");
              return {
                Component: module.TaskListPage,
                loader: module.taskListLoader,
              };
            },
          },
          {
            path: "new",
            lazy: async () => {
              const module = await import("./routes/new-task.jsx");
              return {
                Component: module.NewTaskPage,
                action: module.createTaskAction,
              };
            },
          },
          {
            path: ":taskId",
            lazy: async () => {
              const module = await import("./routes/task-detail.jsx");
              return {
                Component: module.TaskDetailPage,
                loader: module.taskDetailLoader,
                action: module.toggleTaskAction,
              };
            },
          },
        ],
      },
      { path: "*", Component: NotFoundPage },
    ],
  },
]);
```

上面这段是展示 `lazy` 的最终路由配置形态；它要求你真的把导出移动到所列文件中，不能照抄路径却仍将所有页面保留在一个文件里。配置懒加载后，使用生产构建工具查看输出 chunk，确认任务模块没有被其他静态 import 提前拉回初始 bundle。

## 10.3 loader/action 应该一起 lazy 吗？

可以按路由特征设计。页面代码大且低频时，将组件与 route-specific 逻辑放在同一动态模块通常更简单。如果数据加载必须尽早开始、而页面组件体积很大，可以考虑让 loader 保持静态、只懒加载 UI；但这需要实际测量网络瀑布和 bundle 体积，不是所有项目都要优化到这个程度。

还有一个重要区别：Data Mode 的 `route.lazy` 是针对 route object 实现的动态导入；Framework Mode 有自己的 Route Module 和代码拆分约定。不要把 Framework Mode 的 `routes.ts`/文件路由配置直接搬进 Data Mode 项目中。

---

# 第 11 章：给 loader 和 action 写单元测试

测试路由代码时，先拆开两类问题：

- loader/action 函数的业务行为：是否读取了正确的 URL 参数、是否传递正确数据、是否在异常时返回 404/400/redirect。
- React 组件在路由上下文中的显示行为：字段错误有没有出现、按钮是否 disabled、点击后 URL 是否变化。

前者适合直接调用函数并 mock 数据层；后者可以用 `createRoutesStub` 提供路由上下文。官方测试文档指出，`createRoutesStub` 适合隔离测试依赖 router context 的可复用组件；对于整个真实 route module，应该结合真实路由配置和对应测试方式，而不是把所有问题都塞给 stub。[Data Mode Testing](https://reactrouter.com/start/data/testing)

## 11.1 安装测试依赖

```bash
npm install -D vitest
```

在 `package.json` 的 `scripts` 中增加：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest"
  }
}
```

## 11.2 直接测试 loader：URL 参数应该被正确读取

假设 `taskListLoader` 单独放在 `src/routes/tasks-index.jsx`，而且它调用 `listTasks`。创建 `src/routes/tasks-index.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { taskListLoader } from "./tasks-index.jsx";
import { listTasks } from "../data/tasks.js";

vi.mock("../data/tasks.js", () => ({
  listTasks: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe("taskListLoader", () => {
  it("从 URL 读取搜索、状态与排序参数，并计算分页", async () => {
    listTasks.mockResolvedValue([
      { id: "1", title: "loader A" },
      { id: "2", title: "loader B" },
      { id: "3", title: "loader C" },
    ]);

    const request = new Request(
      "http://localhost/tasks?q=loader&status=open&sort=title&page=2"
    );
    const result = await taskListLoader({ request, params: {}, context: null });

    expect(listTasks).toHaveBeenCalledWith({ q: "loader", status: "open", sort: "title" });
    expect(result.page).toBe(2);
    expect(result.tasks).toHaveLength(1);
  });
});
```

这类测试不需要挂载 React。你直接把一个真实 `Request` 传给 loader，就能验证 URL 解析和分页逻辑。注意测试数据要与 pageSize 的设置对应；本教程中的列表 pageSize 为 2。

## 11.3 直接测试 action：验证失败返回字段错误，成功时重定向

假设 `createTaskAction` 位于 `src/routes/new-task.jsx`：

```js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTaskAction } from "./new-task.jsx";
import { createTask } from "../data/tasks.js";

vi.mock("../data/tasks.js", () => ({
  createTask: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

function postRequest(url, values) {
  return new Request(url, {
    method: "POST",
    body: new URLSearchParams(values),
  });
}

describe("createTaskAction", () => {
  it("标题为空时返回 400 和字段错误", async () => {
    const result = await createTaskAction({
      request: postRequest("http://localhost/tasks/new", { title: "", description: "" }),
      params: {},
      context: null,
    });

    expect(result.init?.status).toBe(400);
    expect(result.data.errors.title).toBeTruthy();
    expect(createTask).not.toHaveBeenCalled();
  });

  it("合法提交后重定向到任务列表", async () => {
    createTask.mockResolvedValue({ id: "99", title: "新任务" });

    const result = await createTaskAction({
      request: postRequest("http://localhost/tasks/new", { title: "新任务", description: "测试" }),
      params: {},
      context: null,
    });

    expect(createTask).toHaveBeenCalledWith({ title: "新任务", description: "测试" });
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/tasks");
  });
});
```

测试依赖的核心不是某个特定测试库，而是把 loader/action 写成边界清晰的函数：输入是 `request`、`params` 和业务依赖，输出是数据、重定向或异常。这样可以有针对性地覆盖边界情况。

**版本提示**：`data()` 的返回结构、TypeScript 类型和测试工具的细节可能随着 React Router 主版本变化。若你的断言发现 `result.data` 或 `result.init` 的形状不同，请以当前安装版本中 `data()` 的类型/文档为准；不要为了让测试通过而跳过对返回状态码和业务数据的验证。

## 11.4 组件测试时再加入 createRoutesStub

如果一个可复用组件内部使用 `useLoaderData`、`useActionData` 或 `Link`，脱离路由上下文渲染会报错。此时可使用 `createRoutesStub` 提供最小路由数据和 action 结果；若要验证整张真实路由树上的导航、重定向和错误边界，则应采用更接近真实应用的集成测试。测试工具的职责要清晰：函数测试验证逻辑，组件测试验证 UI，集成测试验证路由组合行为。

---

# 第 12 章：把整个应用跑通，并检查自己是否真的理解了

到这里，主要文件的职责应该如下：

- `main.jsx`：创建 React 根节点，挂载 `RouterProvider`。
- `router.jsx`：声明页面层级、loader/action、错误边界和懒加载边界。
- `data/tasks.js`：提供教学用任务仓库；真实应用中应替换为 API/service 层。
- `routes/root.jsx`：全站布局、导航和全局 pending UI，以及兜底错误边界。
- `routes/tasks.jsx` 或拆分后的任务 route modules：任务列表、详情、新建、loader/action。
- `routes/admin.jsx`：演示权限失败的路由局部错误边界。
- `routes/pages.jsx`：主页和未匹配 URL 的 Not Found 页面。

## 12.1 手工验收流程

按下面的顺序实际点击、刷新并观察地址栏：

1. 访问 `/`，确认全站导航出现，根布局的 `Outlet` 显示主页。
2. 点击“任务”，确认 URL 为 `/tasks`，并显示任务列表。
3. 搜索 `loader`，切换状态和排序，点击下一页；复制 URL 到新标签页，确认筛选条件能恢复。
4. 点击任务标题，确认进入 `/tasks/:taskId`；打开不存在的 ID，确认得到资源 404，而不是空白页。
5. 在 `/tasks/new` 留空标题提交，确认错误出现在字段附近，页面没有跳去错误页。
6. 创建合法任务，确认 action 返回 redirect，最终回到 `/tasks` 并看到新任务。
7. 打开任务详情切换状态，确认按钮显示提交中，URL 不因 fetcher 操作改变，而页面数据会更新。
8. 访问 `/admin`，确认出现 403 专属提示；访问 `/not-a-route`，确认出现普通 Not Found 页面。
9. 接入真实 API 时，确认 loader/action 将 `request.signal` 传递给 fetch，并验证 API 401/403/404/422/500 的处理分工。
10. 运行单元测试；生产构建后检查 route lazy 是否生成预期 chunk。

## 12.2 新手最常踩的坑

**路由命中了但子页面空白**：检查父组件有没有渲染 `<Outlet />`。

**把 `Component` 写成 `element` 却混用 route object 示例**：Data Mode route object 可以使用 `Component`；旧版教程常见 JSX element 写法，按当前版本统一。

**loader 里依赖父 loader 已经完成**：匹配到的 loaders 默认并行，不应假设父子加载串行。把共享逻辑提到 service/cache，或从祖先 route data 读取已加载的数据。

**在组件 `useEffect` 和 loader 里请求同一数据**：这通常会造成重复请求、重复 loading 状态和竞态；路由页面的首屏数据优先统一交给 loader。

**用 `useNavigate` 代替所有链接**：普通页面入口应优先用 `Link`；在 action/loader 中依据结果跳转应优先用 `redirect`。

**认为 useFetcher 会自动切换到目标页**：它的设计目标之一就是在不导航的情况下调用 loader/action；UI 状态由那个 fetcher 自己跟踪。

**把表单验证问题扔给错误边界**：字段错误通常应返回 action data；错误边界用来处理无法正常完成路由渲染的异常。

**只靠前端 loader 检查权限**：浏览器端代码不能替代服务端授权。API 层必须再次验证身份和权限。

**担心一次 action 后必须自己刷新页面**：成功 action 后 React Router 会自动重新验证相关 loader；先确认默认机制是否已完成工作，再决定是否需要手动处理。

## 12.3 学习完成标准

如果你能不用背诵 API，而是解释下面这条完整链路，就真正入门了：

> URL 匹配路由树 → loader 按 params/search params 读取数据 → 组件从 `useLoaderData` 展示内容 → 用户用 Link 或表单导航 → action 校验并提交数据 → 返回字段错误或 redirect → React Router 重新验证相关 loader → `useNavigation`/`useFetcher` 提供 pending UI → 出错时由最近的错误边界兜底。

这条链路就是一套路由系统的骨架。后续无论接真实 REST API、GraphQL、缓存，还是增加更多业务页面，都可以沿用同样的组织原则。

---

# 官方文档索引

建议把下列页面作为后续查阅的第一入口。学习时先理解上面的场景，再回官方文档核对边界和选项，不要只按 API 名称背参数。

**1.** [Picking a Mode：选择 Declarative / Data / Framework Mode](https://reactrouter.com/start/modes)

**2.** [Data Mode Routing：嵌套路由、布局路由、索引路由、动态参数](https://reactrouter.com/start/data/routing)

**3.** [Data Loading：loader 和 useLoaderData](https://reactrouter.com/start/data/data-loading)

**4.** [Actions：action、Form、useSubmit、fetcher](https://reactrouter.com/start/data/actions)

**5.** [Route Object：loader/action、shouldRevalidate、lazy](https://reactrouter.com/start/data/route-object)

**6.** [RouterProvider API](https://reactrouter.com/api/data-routers/RouterProvider)

**7.** [useNavigation API](https://reactrouter.com/api/hooks/useNavigation)

**8.** [useFetcher API](https://reactrouter.com/api/hooks/useFetcher)

**9.** [useSearchParams API](https://reactrouter.com/api/hooks/useSearchParams)

**10.** [useNavigate API](https://reactrouter.com/api/hooks/useNavigate)

**11.** [Pending UI](https://reactrouter.com/start/data/pending-ui)

**12.** [Error Boundaries](https://reactrouter.com/how-to/error-boundary)

**13.** [Form Validation](https://reactrouter.com/how-to/form-validation)

**14.** [Race Conditions](https://reactrouter.com/explanation/race-conditions)

**15.** [Network Concurrency Management](https://reactrouter.com/explanation/concurrency)

**16.** [Data Mode Testing](https://reactrouter.com/start/data/testing)

官方文档会随主版本持续更新。实际开发时，优先选择与 `package.json` 中安装版本一致的文档版本，并通过最小测试确认重要 API 的返回结构和行为。
