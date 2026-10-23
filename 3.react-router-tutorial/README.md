# React Router 从 0 到 1 新手教程（Data Mode 实战）

> 目标读者：**会一点 React、想把「路由」这件事彻底搞明白的前端新手**。
> 本教程不是 API 手册，也不是提纲，而是一条可以从头跟到尾的学习路径。
> 学完你会拥有一个清晰的 mental model：**如何把「页面层级 / URL / 加载与提交数据 / 导航状态」组织成一套完整的路由系统。**

本教程基于 **React Router v8（当前稳定版，`react-router` 8.x）**，它是 v7 架构的延续。
如果你在用 v7，本教程 99% 的内容同样适用；差异处会专门标注。

---

## 0. 你会学到什么

一句话概括本教程要解决的问题：

> **把「用户在哪个页面（URL）」、「这个页面需要什么数据（loader）」、「用户改了什么（action）」、「现在正忙不忙（navigation / fetcher 状态）」这四件事，交给路由层统一管理，而不是散落在各个组件的 `useEffect` 里。**

这正是 React Router「Data Mode」的设计哲学。学完后你应该能够：

- 用 `createBrowserRouter` + `RouterProvider` 搭建一个数据驱动的单页应用（SPA）。
- 用**嵌套路由 / layout route / index route** 组织页面层级，用 `<Outlet/>` 渲染子页面。
- 用 **loader** 在「进入路由前」把数据准备好，用 **action** 处理表单提交与数据变更。
- 用 `useNavigation` / `useFetcher` 做出专业的 **pending UI（加载态、提交态、乐观更新）**。
- 用 **errorElement / ErrorBoundary** 优雅区分「404 找不到」「无权限」「意外崩溃」三类错误。
- 用 `Link` / `useNavigate` / `useSearchParams` 把**筛选、排序、分页**这些「可分享的状态」放进 URL。
- 用 **route `lazy`** 做路由级代码拆分，用 **`createRoutesStub`** 给 loader/action/组件写单元测试。

---

## 1. 学习路径（章节地图）

建议**按顺序**阅读，因为后面每一章都建立在前一章的示例之上。
我们会**从零开始，逐章构建同一个应用**——一个叫 **Concert Hub（演唱会信息站）** 的小产品：

| 章节 | 标题 | 你将掌握 | 对应验收项 |
| --- | --- | --- | --- |
| [第 1 章](./chapters/01-模式选型与环境搭建.md) | 模式选型与环境搭建 | Declarative / Data / Framework 三种模式的区别；为什么选 Data Mode；跑起第一个页面 | ① |
| [第 2 章](./chapters/02-路由结构与嵌套.md) | 路由结构与嵌套 | `createBrowserRouter`、`RouterProvider`、嵌套路由、layout route、index route、动态参数、splat | ② |
| [第 3 章](./chapters/03-loader-数据加载.md) | loader 数据加载 | 进入路由前读数据、`params` / `searchParams`、`redirect`、请求取消（`request.signal`） | ③ |
| [第 4 章](./chapters/04-action-数据变更.md) | action 数据变更 | 表单提交、服务端错误映射、`redirect`、提交状态、自动 revalidation | ④ |
| [第 5 章](./chapters/05-导航状态与-PendingUI.md) | 导航状态与 Pending UI | `useNavigation`、`useFetcher`、pending UI、并行加载、避免重复请求 | ⑤ |
| [第 6 章](./chapters/06-错误处理与错误边界.md) | 错误处理与错误边界 | `errorElement` / `ErrorBoundary`、not found、权限拒绝、意外异常的区分 | ⑥ |
| [第 7 章](./chapters/07-导航与-URL-状态.md) | 导航与 URL 状态 | `useNavigate`、`Link`、`NavLink`、`useSearchParams`；把筛选/排序/分页放进 URL | ⑦ |
| [第 8 章](./chapters/08-懒加载与代码拆分.md) | 懒加载与代码拆分 | route `lazy`、动态 `import()`、路由级代码拆分、首屏瘦身 | ⑧-a |
| [第 9 章](./chapters/09-单元测试.md) | 单元测试 | loader/action 直接测试、`createRoutesStub` 组件测试、测试策略 | ⑧-b |
| [第 10 章](./chapters/10-综合实战.md) | 综合实战 | 把前 9 章串成一个完整、可运行、生产级的应用骨架 | 全部 |

> 完整可运行示例工程见 [`example/`](./example) 目录（在第 10 章末尾说明如何运行）。

---

## 2. 环境要求

| 工具 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 20 | React Router v8 / Vite 需要较新的 Node |
| React | ≥ 19.2 | **React Router v8 要求 React 19.2+**（这是硬性 peerDependency） |
| react-router | ^8.5 | 主包，从 `react-router` 导入 |
| Vite | ≥ 6 | 我们用它做开发服务器与打包（你也可以用任意打包器） |
| 编辑器 | VS Code 等 | 需要 TS/JSX 支持 |

> **关于 React 版本的重要提醒**：React Router v8.5 的 `peerDependencies` 要求 `react >= 19.2.7`。
> 如果你的项目还停留在 React 18，有两个选择：
> 1. 升级到 React 19（推荐，长期收益大）；
> 2. 使用 `react-router@7`（`version-7` tag，仍支持 React 18）。v7 与 v8 的 Data Mode 概念**完全一致**，本教程代码几乎无需改动。
>
> 另：老的 `react-router-dom` 包（v7.18 仍发布）已是**兼容层**，新项目请直接从 **`react-router`** 导入；只有个别 DOM 专属 API（如 SSR 的 `RouterProvider`）才从 `react-router/dom` 导入。本教程统一从 `react-router` 导入。

---

## 3. 逐项验收清单（学完请对照打勾）

这份清单直接对应你提出的「核心概念清单」。每学完一章，回到这里勾一次。
每章末尾也有该章专属的更细验收项。

### ① 模式选型
- [ ] 能说清 Declarative / Data / Framework 三种模式**各自提供什么、代价是什么**。
- [ ] 能解释「特性是**递增（additive）**」的含义：Declarative ⊂ Data ⊂ Framework。
- [ ] 能说出**为什么本教程（以及多数中后台/内容型 SPA）选 Data Mode**：既要 loader/action/pending 这些数据能力，又要自己掌控打包、数据层与服务端抽象。

### ② 路由结构
- [ ] 会用 `createBrowserRouter([...])` 定义路由、用 `<RouterProvider router={router} />` 渲染。
- [ ] 理解 **router 对象要在 React 之外创建一次**，不能放进 state。
- [ ] 会用 `children` 做**嵌套路由**，理解父路径会被子路径自动继承。
- [ ] 会用 `<Outlet/>` 渲染子路由；能区分 **layout route（有组件无 path / 有 path 有组件）**、**index route（`index:true`）**、**prefix route（有 path 无组件）**。
- [ ] 会用 **动态参数** `:id`、可选段 `:id?`、**splat** `*`，并在组件里用 `useParams` 读取。

### ③ loader
- [ ] 理解 loader **在路由组件渲染之前**运行，返回的数据用 `useLoaderData()` 读取。
- [ ] 会在 loader 里读 `params` 和 `searchParams`（`new URL(request.url).searchParams`）。
- [ ] 会用 `redirect()` 在 loader/action 里重定向（如未登录跳登录页）。
- [ ] 理解并会用 `request.signal` 做**请求取消**（导航被打断时中断 `fetch`）。

### ④ action
- [ ] 会用 `action` 处理数据变更；用 `<Form method="post">`、`useSubmit`、`fetcher.submit` 触发。
- [ ] 理解 **action 完成后页面上所有 loader 会自动 revalidate**（UI 与数据自动同步）。
- [ ] 会做**服务端错误 → 表单字段错误的映射**（返回 `{ errors }`，用 `useActionData()` 读取）。
- [ ] 会在 action 成功后 `redirect()` 到详情页；会展示**提交中状态**。

### ⑤ 导航状态与 fetcher
- [ ] 会用 `useNavigation()` 读取 `state`（idle/loading/submitting）、`location`、`formData` 等，做全局/局部 pending UI。
- [ ] 会用 `useFetcher()` 做**不改变 URL、不进历史栈**的提交/加载（如列表内联保存、搜索联想）。
- [ ] 理解 **loader 的并行加载**（父子/兄弟 loader 并发执行）。
- [ ] 理解如何**避免重复请求**（revalidation 默认策略、`shouldRevalidate`、fetcher 复用）。

### ⑥ 错误处理
- [ ] 会用 `ErrorBoundary`（数据模式）/ `errorElement` 捕获 loader/action/组件里的错误。
- [ ] 会用 `useRouteError()` + `isRouteErrorResponse()` 拿到错误。
- [ ] 能**区分三类错误**并给出不同 UI：`throw data(...,{status:404})` 的**资源不存在**、`throw data(...,{status:403})` 的**权限拒绝**、`error instanceof Error` 的**意外异常**。
- [ ] 理解「最近的错误边界」原则，会在根部放兜底错误边界。

### ⑦ 导航与 URL 状态
- [ ] 会用 `<Link>` / `<NavLink>`（含 `end`、active/pending 样式）做导航。
- [ ] 会用 `useNavigate()` 做程序化导航，理解它应该「少用」，以及 `replace`/`state` 选项。
- [ ] 会用 `useSearchParams()` 读写查询参数，把**筛选、排序、分页**放进 URL，做到可分享、可前进后退。

### ⑧ 懒加载与测试
- [ ] 会用 route `lazy` + 动态 `import()` 做**路由级代码拆分**，减小首屏体积。
- [ ] 会把 loader/action 当**普通函数**直接单元测试。
- [ ] 会用 `createRoutesStub` 给依赖路由上下文的组件写测试。

---

## 4. 如何使用本教程

1. **先读第 1 章**，把开发环境跑起来（10 分钟）。
2. **逐章跟做**：每章都有「动手实践」小节，代码可直接复制。建议你自己敲一遍。
3. **每章末尾做验收**：完成「本章验收清单」再进入下一章。
4. **卡住了**：每章都有「常见坑 / 排错」小节，先查那里。
5. **最后**：跟着第 10 章把完整应用串起来，对照 `example/` 目录检查。

> 排版约定：
> - 💡 = 概念/心智模型；⚠️ = 常见坑；✅ = 验收点；🧪 = 动手实践；📌 = 与 v7 的差异说明。

---

## 5. 致谢与参考

本教程内容基于 [React Router 官方文档](https://reactrouter.com)（v8），包括 Picking a Mode、Data Mode 系列指南、Route Object、Error Boundaries、Using Fetchers、Pending UI、Navigating、Testing 等章节，并结合教学需要重新组织、扩写与本地化。所有代码示例为教学目的重写，遵循官方 API 语义。

祝你学习顺利 —— 我们第 1 章见。👉 [**开始第 1 章：模式选型与环境搭建**](./chapters/01-模式选型与环境搭建.md)
