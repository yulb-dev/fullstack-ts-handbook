# API 合约与端到端数据流整合：从 0 到 1 把前后端「钉」在同一份契约上

你已经会写 React 表单，也会用 Fastify 写接口、用 Drizzle 操作 Postgres。但前后端一联调，问题就来了：

- 后端把 `dueAt` 改成了 `dueDate`，前端还在读 `task.dueAt`，页面上一片 `undefined`，**直到用户反馈才发现**；
- 前端手写了一份 `interface Task`，后端也有一份，三个月后两份已经对不上，谁也说不清哪份是对的；
- 表单里填得好好的，提交后服务端返回一个 `400`，页面只弹出「请求失败」，用户不知道哪里错了；
- 线上报了个 `500`，用户截图里什么都没有，你在几百万行日志里找不到这一次请求；
- 弱网下用户连点两次「创建」，数据库里多了两条一模一样的任务；
- 本地好好的，部署到不同域名后，Cookie 带不过去、预检请求失败、CSRF 校验报错……

这些问题有一个共同的根源：**前后端之间没有一份稳定、可验证的契约**，所有约定都靠口头、文档和人的记忆。

这份教程带你从零搭建一个前后端分离的任务管理应用 **TaskFlow**，把这条链路完整地打通：

```
React Hook Form → Zod → TanStack Query mutation → 生成的 API 客户端
      → Fastify route schema → 认证 / CSRF → 授权 → Drizzle → Postgres
      → 统一响应 / 统一错误 envelope → 回到 UI
```

并且让它**可验证**：契约一变，编译器或 CI 立刻告诉你哪里要跟着改。

---

## 学完之后你将能够

1. 把 **Fastify route schema（TypeBox）** 作为 API 结构的唯一权威来源，自动生成包含**请求、响应、状态码、安全方案、分页**的 OpenAPI 3.1 文档；
2. 从 OpenAPI **生成前端类型与请求封装**，让 `apps/web` 完全不依赖服务端实现文件；并让 CI 检查生成结果是否过期；
3. 分清 **前端 Zod（表单体验）** 与 **后端 TypeBox（信任边界）** 的职责，让两者独立演进又不悄悄分叉；
4. 设计**统一错误 envelope**、贯穿前后端的 **requestId**、**字段级错误映射**、**请求取消**与**网络重试策略**；
5. 正确配置 **认证 Cookie、`credentials`、CORS、浏览器预检、CSRF 防护和开发/生产代理**；
6. 根据业务判断哪些动作需要 **幂等键（Idempotency-Key）**，用 **版本号 + If-Match** 处理普通更新的并发冲突；
7. 制定 **API 版本兼容与弃用策略**、**分页响应契约**、**日期/时区与枚举的序列化规范**；
8. 独立完成一条「创建任务」完整链路，并把 **400 字段错误、401、403、404、409、500** 映射到合适的 UI。

---

## 版本说明（2026 年 10 月核对）

本教程所有代码都在配套工程 [`example/`](./example) 中通过了类型检查与自动化测试。版本锁定如下：

| 组件                                        | 版本                                                         | 说明                                                            |
| ------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| Node.js                                     | 24                                                           | 运行时                                                          |
| pnpm                                        | 12                                                           | monorepo 包管理；默认不运行依赖安装脚本，需要显式 `allowBuilds` |
| TypeScript                                  | 7.0（`apps/*`） / 5.9（仅 `packages/api-client` 的代码生成） | 原因见第 2 章                                                   |
| Fastify                                     | 5.12                                                         | 服务端框架                                                      |
| TypeBox                                     | 1.4（包名 `typebox`，不是旧的 `@sinclair/typebox`）          | JSON Schema 构建器，ESM-only                                    |
| @fastify/type-provider-typebox              | 6.3                                                          | 让 route schema 推导出 handler 类型                             |
| @fastify/swagger                            | 9.9                                                          | 从 route schema 生成 OpenAPI 3.1                                |
| Drizzle ORM / drizzle-kit                   | 1.0.0-rc.4                                                   | 与本系列《Drizzle ORM 从 0 到 1》相同的 RC 版本                 |
| openapi-typescript / openapi-fetch          | 7.13 / 0.17                                                  | 从 OpenAPI 生成类型 + 类型安全的 fetch 封装                     |
| React / TanStack Query                      | 19.3 / 5.104                                                 | 前端                                                            |
| React Hook Form / @hookform/resolvers / Zod | 7.90 / 6.0 / 4.6                                             | 表单                                                            |
| Vite / Vitest                               | 8.3 / 5.0                                                    | 构建与测试                                                      |

> **两个容易踩的版本坑**
>
> 1. TypeBox 1.x 的包名是 `typebox`，导入写法是 `import Type from "typebox"`。网上大量教程仍是 0.x 的 `import { Type } from "@sinclair/typebox"`，两者不要混用。
> 2. TypeScript 7 是用 Go 重写的原生编译器，**不再提供旧的 JS 编译器 API**；而 `openapi-typescript@7` 依赖这套 API（peer `typescript@^5`）。所以我们把代码生成器隔离在 `packages/api-client` 里，单独锁定 TypeScript 5.9。第 2 章会详细解释。

---

## 适合谁

- 会 React + TypeScript，用过（或读过本系列的）React Hook Form、Zod、TanStack Query；
- 写过一点 Node.js 接口，知道 HTTP 方法、状态码、JSON 是什么；
- 不要求你精通 Fastify 或 Drizzle——用到的部分会边用边讲，深入内容请参考本系列对应教程。

如果你是「只写过前端」的同学，请放心：本教程里服务端的每一行代码都会解释**它为什么要这样写**，以及**它保护了前端什么**。

---

## 贯穿项目：TaskFlow

TaskFlow 是一个最小但「五脏俱全」的团队任务管理应用：

- 用户登录后看到自己参与的项目；
- 项目成员分三种角色：`owner`（负责人）、`editor`（编辑）、`viewer`（只读）；
- 有写权限的成员可以**创建任务**、推进任务状态；
- 任务列表**分页**加载，可按状态筛选；
- 同一个项目里，**未完成任务的标题不能重复**（为了演示 409 冲突）；
- 网络抖动导致的重复提交**不能产生重复任务**；
- 两个人同时修改同一个任务，**后保存的人要被告知冲突**，而不是悄悄覆盖。

仓库结构（第 2 章从零搭建）：

```
example/
├── apps/
│   ├── api/                 Fastify + TypeBox + Drizzle：契约的源头
│   └── web/                 React + RHF + Zod + TanStack Query：只依赖 api-client
├── packages/
│   └── api-client/          openapi.json + 生成的类型 + 请求封装：前后端唯一的连接点
├── scripts/
│   ├── check-contract.mjs   契约漂移检查
│   └── check-boundaries.mjs 依赖边界检查
└── .github/workflows/ci.yml
```

---

## 章节目录

| 章节     | 标题                                                                        | 你将掌握                                                                 | 对应核心概念  |
| -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------- |
| 第 1 章  | [为什么需要 API 契约](./01-why-contracts.md)                                | 类型漂移的成因、几种对齐方案的取舍、端到端数据流全景                     | 总目标        |
| 第 2 章  | [从零搭建 monorepo](./02-monorepo-setup.md)                                 | pnpm workspace、三个包的职责与依赖方向、数据库与迁移、边界检查           | ②             |
| 第 3 章  | [Fastify route schema 就是契约](./03-route-schema-as-contract.md)           | TypeBox、route schema 各部分、共享 schema、OpenAPI 3.1 生成、安全方案    | ①             |
| 第 4 章  | [从 OpenAPI 生成客户端，并让 CI 守住它](./04-codegen-and-ci.md)             | openapi-typescript、openapi-fetch、漂移检查、OpenAPI lint、breaking 检测 | ② · 练习 1    |
| 第 5 章  | [Zod 与 TypeBox：两道校验，各守一边](./05-two-validation-layers.md)         | 表单体验校验 vs 信任边界校验、防漂移三道闸、绕过测试                     | ③             |
| 第 6 章  | [统一错误 envelope 与 requestId](./06-error-envelope-and-request-id.md)     | 错误结构设计、Ajv 错误 → 字段路径、日志与响应的边界、客户端错误规整      | ④             |
| 第 7 章  | [取消请求与网络重试](./07-cancellation-and-retry.md)                        | AbortSignal 全链路、超时、哪些错误能重试、退避与 Retry-After             | ④             |
| 第 8 章  | [Cookie、CORS、预检、CSRF 与代理](./08-cookies-cors-csrf.md)                | 会话 Cookie 属性、`credentials`、同源代理与跨源部署、CSRF 多层防护       | ⑤             |
| 第 9 章  | [创建任务（上）：服务端链路](./09-create-task-backend.md)                   | 数据模型、授权策略、Service、DTO 映射、冲突处理                          | ③ ⑥ · 练习 2  |
| 第 10 章 | [创建任务（下）：前端链路与错误 UI](./10-create-task-frontend.md)           | RHF + Zod + mutation、状态码 → UI 矩阵、组件测试                         | ④ · 练习 2、3 |
| 第 11 章 | [幂等键与并发更新](./11-idempotency-and-concurrency.md)                     | 何时需要幂等键、服务端算法、键的生命周期、版本号 + If-Match              | ⑥             |
| 第 12 章 | [版本、弃用、分页与序列化规范](./12-versioning-pagination-serialization.md) | 兼容性规则、弃用流程、游标分页、日期/时区、枚举、数字与 null             | ⑦             |
| 第 13 章 | [综合实战与逐项验收](./13-capstone-and-acceptance.md)                       | 一次完整的契约变更演练、通过标准逐条验证                                 | 全部          |

## 学习路线建议

```
第 1 章（建立心智模型）★ 先想清楚「契约」到底是什么
   └─> 第 2 章（搭骨架）
         └─> 第 3 章（服务端写契约）★ 全书的地基
               └─> 第 4 章（前端吃契约 + CI 守契约）★ 练习 1
                     └─> 第 5 章（两层校验分工）
                           ├─> 第 6 章（错误 envelope）
                           ├─> 第 7 章（取消与重试）
                           └─> 第 8 章（Cookie / CORS / CSRF）
                                 └─> 第 9、10 章（创建任务全链路）★ 练习 2、3
                                       └─> 第 11 章（幂等与并发）
                                             └─> 第 12 章（演进规范）
                                                   └─> 第 13 章（综合验收）
```

- 每章都有**可运行的代码**、**常见错误**和**本章验收清单**；
- 代码片段与 `example/` 中的文件一一对应，章节里会标注文件路径；
- 第 3、4、6、11 章是「契约可验证」的核心，值得反复读。

---

## 逐项验收清单（总表）

学完每章回来打勾。第 13 章会给出每一项对应的**证据**（文件、测试或命令）。

### ① 契约的权威来源

- [ ] Fastify route schema / OpenAPI 是 API 结构的唯一权威描述；
- [ ] OpenAPI 文档包含请求（path/query/header/body）、响应、状态码、安全方案和分页结构。

### ② 生成客户端

- [ ] 从 OpenAPI 生成客户端类型与请求封装；
- [ ] `apps/web` 不直接依赖任何服务端实现文件，且有自动检查；
- [ ] 运行生成脚本后，CI 能检查生成结果是否过期。

### ③ 两层校验

- [ ] 能说清前端 Zod（表单 UX）与后端 TypeBox（信任边界）各自负责什么；
- [ ] 绕过前端直接请求，不能破坏服务端数据正确性与权限。

### ④ 错误与网络

- [ ] 所有错误都是统一 envelope，带 requestId；
- [ ] 验证错误能映射到具体表单字段；
- [ ] 请求可以取消；网络重试只针对可恢复错误，并遵守 Retry-After。

### ⑤ 认证与浏览器安全

- [ ] 会话 Cookie 属性正确，`credentials` 配置正确；
- [ ] 理解并能配置 CORS 与预检；有 CSRF 防护；开发与生产的代理方案清晰。

### ⑥ 幂等与并发

- [ ] 能按业务判断哪些动作需要幂等键，并正确实现；
- [ ] 普通更新有并发控制（版本号 + If-Match）。

### ⑦ 演进规范

- [ ] 有 API 版本兼容与弃用策略，CI 能检测破坏性变更；
- [ ] 分页响应契约、日期/时区、枚举的序列化规范明确并落地。

### 必须完成的动手练习

- [ ] 练习 1：修改 OpenAPI 后运行客户端类型生成脚本，并让 CI 检查生成结果是否过期（第 4 章）；
- [ ] 练习 2：实现完整「创建任务」链路：React Hook Form → Zod → Query mutation → Fastify schema → AuthZ → Drizzle → Postgres（第 9、10 章）；
- [ ] 练习 3：把 400 字段错误、401、403、404、409、500 映射到合适的 UI（第 10 章）。

### 通过标准

- [ ] 前端代码不复制维护第二套 API 响应类型；契约变更会在编译或 CI 中暴露；
- [ ] 任何客户端校验绕过都不能破坏服务器端的数据正确性与权限；
- [ ] 错误可被 UI 解释，同时服务器端日志保留排查所需上下文，不泄露内部细节。

---

## 如何使用配套工程

```bash
cd example
pnpm install
pnpm typecheck        # 三个包的类型检查
pnpm test             # API 契约测试 + 客户端测试 + 前端组件测试
pnpm contract:check   # 契约漂移检查
pnpm boundaries:check # 依赖边界检查

# 不装 Docker 也能把整个应用跑起来（内存版 Postgres）
pnpm --filter @taskflow/api dev:memory
pnpm dev:web          # 另开终端，打开 http://localhost:5173
```

## 与本系列其他教程的关系

- 《可访问设计系统与复杂表单实战》讲透了 React Hook Form 与 Zod，本教程直接使用，并会在第 5 章解释一个**重要的转变**：那本书里前后端共用同一份 Zod schema，而在这里我们让前后端校验**各自独立**，原因与取舍会讲清楚；
- 《TanStack Query + Zustand》讲透了缓存、mutation 与重试，本教程聚焦「它和 API 契约怎么接」；
- 《Drizzle ORM 从 0 到 1》讲透了建模、事务与幂等下单，本教程第 9、11 章在 HTTP 层复用这些思想。

## 官方资源

- Fastify 校验与序列化：<https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/>
- Fastify Type Providers：<https://fastify.dev/docs/latest/Reference/Type-Providers/>
- TypeBox：<https://sinclairzx81.github.io/typebox/>
- @fastify/swagger：<https://github.com/fastify/fastify-swagger>
- OpenAPI 3.1 规范：<https://spec.openapis.org/oas/v3.1.1>
- openapi-typescript / openapi-fetch：<https://openapi-ts.dev/>
- MDN CORS：<https://developer.mozilla.org/docs/Web/HTTP/Guides/CORS>
- OWASP CSRF 防护速查表：<https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html>
- Idempotency-Key 头草案：<https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/>
