# TanStack Query + Zustand 新手教程：从 0 到 1 分清「服务端状态」与「客户端状态」

> 基于 **TanStack Query v5**（`@tanstack/react-query`，当前最新主版本，示例对应 5.104 左右）与 **Zustand v5**（示例对应 5.0.x）编写。
> 本教程全程以 React + TypeScript 为例。两个库的**核心 API 在 v5 与更早版本差异很大**（比如 TanStack Query v4 → v5 把 `cacheTime` 改名为 `gcTime`、`isLoading` 拆成 `isPending`/`isFetching`；Zustand v4 → v5 移除了默认的浅比较、必须显式用 `useShallow`），网上大量旧教程会把你带偏，务必以本教程和对应版本的官方文档为准。

## 这份教程到底解决什么问题

新手在写 React 应用时，最常被一个模糊的问题折磨：**「这个数据该放哪？」**

- 从后端接口拿到的任务列表，该放 `useState`？放 Redux？放 Context？
- 侧边栏是否展开、当前选中的筛选项、主题深浅色，又该放哪？
- 为什么我明明缓存了数据，页面切走再回来还是要转圈 loading？
- 为什么点了「删除」要等接口返回才更新界面，体验这么卡？

这些问题的根源是同一个：**你把两种本质不同的东西，当成了「一种状态」来管理。**

- **服务端状态（Server State）**：数据的「真相」在远端服务器上，你手里只是它的一份**可能过期的缓存副本**。它需要异步获取、会被别人改动、要考虑缓存/失效/重试/乐观更新。→ 交给 **TanStack Query**。
- **客户端状态（Client State / UI State）**：数据的「真相」就在你自己的浏览器里，同步、即时、只属于当前用户。比如「筛选条件」「主题」「弹窗开关」「表单草稿」。→ 交给 **Zustand**。

这份教程的目标，就是让你**分别**掌握这两类状态的正确工具，并且能清楚地解释：**为什么绝不能把它们混成一种状态来管。**

## 这份教程适合谁

- 会 React 基础（组件、`useState`、`useEffect`、props），写过一点数据请求的前端新手；
- 受够了手写 `useEffect + fetch + loading + error` 样板代码，想系统学会服务端状态缓存；
- 用过或听过 Redux / Context，觉得「全局状态」很笨重，想找一个轻量的客户端状态方案；
- 目标是：**建立正确的状态分层心智模型，能用 TanStack Query 管好异步数据、用 Zustand 管好 UI 状态，并知道它们的边界在哪。**

## 学完之后你将能够

1. 清楚区分服务端状态与客户端状态，并解释为什么不能混用一套方案；
2. 用 TanStack Query 的 `QueryClient` / `useQuery` / `queryFn` / `query key` 获取并缓存数据，正确处理 loading / error / success 三态；
3. 理解缓存新鲜度 `staleTime`、垃圾回收 `gcTime`、失效 `invalidateQueries`、主动 refetch 与默认自动刷新（窗口聚焦、重连、挂载）之间的关系；
4. 用 `useMutation` 完成增删改，掌握 mutation 生命周期，在成功后失效相关 query，并处理取消请求、重试与错误；
5. 实现乐观更新：先改缓存、失败回滚，并理解并发 mutation 带来的最终一致性风险；
6. 掌握分页、无限滚动、依赖查询、预取、后台刷新等进阶模式，牢记「query key 必须包含所有影响结果的变量」；
7. 理解结构共享、数据引用稳定性，会用 Query Devtools 调试，知道默认的重试与刷新行为；
8. 用 Zustand 的 store / action / selector 管理 UI 状态，做细粒度订阅、派生状态（derived state），并合理拆分多个 store；
9. 用 Zustand 的 `persist` 中间件持久化状态，掌握 `partialize`、`version` 与 `migrate`，并牢记「持久化存储不应保存秘密」；
10. 会写隔离良好的测试（每个测试独立的 `QueryClient`），并守住架构底线：**绝不把服务端数据复制一份塞进 Zustand**。

## 章节目录

| 章节 | 标题 | 内容概要 |
| --- | --- | --- |
| 第 1 章 | [两种状态：先建立正确的心智模型](./01-two-kinds-of-state.md) | 服务端状态 vs 客户端状态、为什么不能混、工具选型、状态分层 |
| 第 2 章 | [环境搭建：跑通第一个请求](./02-setup-first-request.md) | Vite + React + TS、安装两个库、QueryClient 与 Provider、Mock API、Devtools |
| 第 3 章 | [TanStack Query 基础：useQuery 深入](./03-usequery-fundamentals.md) | queryFn、query key 结构、status/fetchStatus、三态渲染、错误处理 |
| 第 4 章 | [缓存生命周期：新鲜度、回收与失效](./04-cache-lifecycle.md) | staleTime、gcTime、active/inactive、自动刷新触发点、invalidateQueries、refetch |
| 第 5 章 | [修改数据：useMutation 与失效联动](./05-mutations.md) | mutation 生命周期、mutate/mutateAsync、成功后失效、取消请求、重试、错误处理 |
| 第 6 章 | [乐观更新：先改缓存、失败回滚](./06-optimistic-updates.md) | 两种乐观更新、onMutate 快照、回滚、并发 mutation 与最终一致性风险 |
| 第 7 章 | [进阶查询模式](./07-advanced-query-patterns.md) | 分页、无限滚动、依赖查询、预取、后台刷新、useQueries 并行 |
| 第 8 章 | [性能与调试](./08-performance-and-devtools.md) | 结构共享、引用稳定性、select、tracked properties、Query Devtools、默认重试/刷新 |
| 第 9 章 | [Zustand 基础：store / action / selector](./09-zustand-fundamentals.md) | create、set/get、细粒度订阅、useShallow、derived state、组件外访问 |
| 第 10 章 | [Zustand 进阶：多 store 拆分与中间件](./10-zustand-stores-and-middleware.md) | slices 模式、store 拆分策略、immer、devtools、subscribeWithSelector |
| 第 11 章 | [Zustand persist：持久化、版本迁移与安全](./11-zustand-persist.md) | persist、storage、partialize、version/migrate、hydration、不存秘密 |
| 第 12 章 | [测试与架构边界](./12-testing-and-boundaries.md) | 每个测试隔离 QueryClient、mock 网络、Zustand 测试、服务端数据不进 Zustand |
| 第 13 章 | [综合实战：TaskFlow 与逐项验收](./13-capstone-project.md) | 把两者组合成完整应用、状态归属决策、逐项验收清单 |

## 学习路线建议

```
第 1 章（建立"两种状态"的心智模型）★ 全书的灵魂，务必先读
   └─> 第 2 章（搭环境，跑通第一个请求）
         └─> 第 3 章（useQuery 基础）
               └─> 第 4 章（缓存生命周期）★ 理解 staleTime/gcTime 是分水岭
                     └─> 第 5 章（useMutation 改数据）
                           └─> 第 6 章（乐观更新）
                                 └─> 第 7 章（分页/无限滚动/依赖/预取）
                                       └─> 第 8 章（性能与 Devtools）
─── 到这里，服务端状态（TanStack Query）已通关 ───
第 9 章（Zustand 基础）
   └─> 第 10 章（多 store 拆分与中间件）
         └─> 第 11 章（persist 持久化）★ 安全红线在这里
─── 到这里，客户端状态（Zustand）已通关 ───
第 12 章（测试与架构边界）★ 把两者"划清界限"的落地规则
   └─> 第 13 章（综合实战 + 逐项验收）
```

- **每章都包含可运行的代码示例、易错点提醒和练习**，强烈建议一边读一边在编辑器里敲；
- 第 4、6、11、12 章是最容易踩坑、也最能体现「功力」的四章，值得反复读；
- 如果你只想先解决「数据放哪」的困惑，读完第 1 章 + 第 12 章的架构边界部分，就能获得 80% 的判断力。

## 贯穿全书的实战项目：TaskFlow 任务看板

从第 2 章开始，我们会围绕一个迷你项目「**TaskFlow 任务看板**」逐步演进。它是一个前后端分离的任务管理页：

- **服务端状态**（TanStack Query 负责）：任务列表（可分页、可按状态筛选）、单个任务详情、任务的评论（依赖任务）、创建/编辑/删除任务；
- **客户端状态**（Zustand 负责）：当前的筛选条件与视图模式、主题深浅色、侧边栏折叠状态、新建任务弹窗的开关与表单草稿。

我们不需要真实后端——第 2 章会写一个带**人工延迟**的内存 Mock API，让你在本地就能完整体验「网络请求的不确定性」，这正是服务端状态管理的意义所在。到第 13 章，它会长成一个能同时体现两类状态、并清晰划界的完整作品。

## 官方资源

- TanStack Query 官方文档：<https://tanstack.com/query/latest>（React 版路径 `/docs/framework/react/...`，注意左上角版本选 **v5**）
- TanStack Query 安装指南：<https://tanstack.com/query/latest/docs/framework/react/installation>
- TkDodo 博客（TanStack Query 维护者，强烈推荐）：<https://tkdodo.eu/blog/>，尤其是 *Practical React Query*、*React Query as a State Manager*、*Thinking in React Query*
- Zustand 官方文档：<https://zustand.docs.pmnd.rs/>
- Zustand 在线 Demo：<https://zustand-demo.pmnd.rs/>
- React Testing Library：<https://testing-library.com/docs/react-testing-library/intro>

## 一句话总览

> **TanStack Query 让你不再手动管理「异步数据的缓存与同步」，Zustand 让你优雅地管理「同步的 UI 状态」。它们不是竞争关系，而是分工关系——真正的功力，在于知道每块数据该交给谁。**

---

> 准备好了吗？从 [第 1 章 两种状态：先建立正确的心智模型](./01-two-kinds-of-state.md) 开始。
