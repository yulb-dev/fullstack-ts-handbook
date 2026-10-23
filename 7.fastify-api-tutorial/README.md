# Fastify + TypeBox + OpenAPI 从 0 到 1：构建有边界、有契约、可观测的 HTTP API

你会 TypeScript，写过很多调用后端接口的前端代码，但轮到自己写后端时，心里没底：输入怎么校验才算可靠？返回的数据会不会多带了不该带的字段？出错时该返回什么？API 文档怎样才能和代码保持一致？线上出了问题怎么查？

这份教程就是为你准备的。我们从一个空目录开始，一步步构建一个团队任务管理 API——**TaskHub**，最终得到：

- 有清晰**插件边界**的 Fastify 应用：基础设施全局共享，业务模块相互隔离；
- 运行时强制执行的**输入/输出 schema**：类型和校验规则来自同一份 TypeBox 定义；
- 稳定的**错误模型**：统一结构、稳定错误码、只暴露安全信息；
- 带请求 ID 的**结构化日志**：可检索、可关联、不泄密；
- 从代码自动生成、受访问控制的 **API 文档**；
- 覆盖以上全部行为的**集成测试**。

## 先说明版本

本次编写时核对了 npm 与各官方文档：

| 包                               | 使用版本 | 说明                                                                                                                              |
| -------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `fastify`                        | 5.12.7   | npm `latest`；`next` 标签上已有 6.0 alpha，本书不使用                                                                             |
| `typebox`                        | 1.4.2    | TypeBox 1.x，**只发布 ESM**，面向 TypeScript 6.0+。注意它的包名是无作用域的 `typebox`，旧的 `@sinclair/typebox` 是 0.x 长期支持线 |
| `@fastify/type-provider-typebox` | 6.3.0    | 依赖 `typebox@^1`                                                                                                                 |
| `@fastify/swagger`               | 9.9.2    | 支持生成 OpenAPI 3.0 / 3.1 / 3.2                                                                                                  |
| `@fastify/swagger-ui`            | 6.1.2    | Swagger UI 渲染器                                                                                                                 |
| `@scalar/fastify-api-reference`  | 1.75.1   | Scalar 渲染器                                                                                                                     |
| `@fastify/rate-limit`            | 11.2.1   | 限流                                                                                                                              |
| `fastify-plugin`                 | 6.0.1    |                                                                                                                                   |
| `typescript`                     | 7.0.2    |                                                                                                                                   |
| `vitest`                         | 5.0.5    |                                                                                                                                   |

运行环境为 Node.js 24（要求 ≥ 22）。配套工程包含 `package-lock.json`，用 `npm ci` 安装锁定的依赖。

如果你在网上看到 `import { Type } from '@sinclair/typebox'`、`Fastify({ requestIdLogLabel })`、`disableRequestLogging: true` 之类的写法，它们来自旧版本：前者是 TypeBox 0.x，后两者在 Fastify 5.12 中已被标记为废弃，推荐改用 `logController`。本书全部使用当前写法。

## 适合谁，需要先会什么

- 需要会 TypeScript 的基础语法、`async/await`、npm 的基本使用。
- 不需要后端经验，第 1 章从“一次 HTTP 请求由什么组成”讲起。
- 不需要数据库：TaskHub 用内存数据结构模拟数据库，让注意力集中在 HTTP 层。想接入真实数据库，可以在学完后阅读本仓库的 [Drizzle ORM 教程](../9.drizzle-orm-tutorial/README.md)。
- 不需要 Python、Docker。

## 贯穿项目：TaskHub

一个团队任务管理后端：成员可以创建、查看、修改、删除任务，把任务指派给别人；管理员可以管理所有任务。十二条需求（见第 1 章）分别驱动了认证 hook、请求校验、业务规则、可见性与权限、分页契约、乐观并发、限流、响应过滤、请求 ID、API 文档与文档安全。

## 完整章节

| 章节                                                                                | 本章要解决的实际问题                                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [01 HTTP API 的心智模型与项目蓝图](./01-http-api-mental-model.md)                   | 什么是 API 契约；为什么 TS 类型保护不了服务器；各工具的分工；TaskHub 需求与分层       |
| [02 环境搭建与第一个路由](./02-setup-and-first-route.md)                            | 从空目录搭出 ESM + TS + Fastify 项目；实例、路由、request/reply；第一个 `inject` 测试 |
| [03 插件、封装与装饰器](./03-plugins-encapsulation-decorators.md)                   | `register`、封装上下文、`fastify-plugin`、decorator、加载顺序；TaskHub 的插件地图     |
| [04 请求生命周期与 Hook](./04-lifecycle-and-hooks.md)                               | 每个 hook 的职责与顺序（附可运行实验）；认证、规范化、授权、请求 ID 各放在哪个 hook   |
| [05 JSON Schema 与请求校验](./05-json-schema-validation.md)                         | 手写 JSON Schema 校验 params/querystring/headers/body；Fastify Ajv 默认配置的真实影响 |
| [06 TypeBox：一份定义，同时得到类型与 schema](./06-typebox.md)                      | Type、Static、Optional、Union、Literal、Enum、引用；Type Provider；类型与运行时的落差 |
| [07 响应 schema：控制输出形状](./07-response-schema.md)                             | 序列化器的真实行为（附实验）；防止字段泄露；不同受众不同视图                          |
| [08 共享 schema、`$id` 与业务规则的边界](./08-shared-schemas-and-business-rules.md) | `addSchema` 与 `$ref`、封装范围；结构校验 vs 需要查库的业务规则；service 层           |
| [09 统一错误模型](./09-error-model.md)                                              | 状态码选择；稳定错误码目录；`AppError`；全局错误处理器；限流；可安全暴露的信息        |
| [10 API 契约细节](./10-api-contract-details.md)                                     | 方法与状态码；分页排序契约；请求 ID；ETag/If-Match 乐观并发                           |
| [11 用 @fastify/swagger 生成 OpenAPI](./11-openapi-with-fastify-swagger.md)         | 注册顺序；schema 到 OpenAPI 的映射；API 版本；破坏性变更与废弃流程                    |
| [12 Swagger UI 与 Scalar](./12-api-reference-ui.md)                                 | 渲染器二选一；文档的环境开关、访问控制与安全暴露                                      |
| [13 Pino 结构化日志](./13-logging-with-pino.md)                                     | 结构化字段、子 logger、级别策略、白名单序列化器、redact 的规则与局限                  |
| [14 用 `app.inject` 做集成测试](./14-testing-with-inject.md)                        | 可测试的应用工厂；测试插件装配、生命周期、响应形状、错误、日志、契约                  |
| [15 综合实战与逐项验收](./15-capstone-and-acceptance.md)                            | curl 全流程演练；核心概念逐项验收；扩展练习；上线前检查清单                           |

建议按顺序阅读。每章都包含：问题引入、概念讲解、可运行的代码（来自配套工程）、真实运行结果、常见错误、练习与参考答案、本章验收清单和官方文档链接。

## 如何运行配套工程

最终工程位于 [example](./example)。第 2 章介绍了从零搭建的过程，这里是快速入口：

```bash
cd fastify-api-tutorial/example
npm ci
npm run typecheck     # 类型检查
npm test              # 6 个测试文件，57 个测试
npm run dev           # http://127.0.0.1:3000，文档页面在 /docs
```

其他命令：

```bash
npm run openapi:export   # 生成 openapi.json
npm run build && npm start   # 编译后以生产方式运行（生产环境默认不开放文档）
```

> 使用 npm 11 安装时，可能看到 `esbuild` 的 install script 未被允许执行的提示（`npm warn install-scripts`）。本工程在该提示下实测 `tsx`、`vitest` 均正常工作：esbuild 的平台二进制通过可选依赖（如 `@esbuild/darwin-arm64`）安装，不依赖该脚本。

本地种子数据中的测试账号（**只用于本地学习**）：

| 用户  | 角色   | token         |
| ----- | ------ | ------------- |
| Alice | member | `alice-token` |
| Bob   | member | `bob-token`   |
| Carol | admin  | `admin-token` |

可用的环境变量见 [example/.env.example](./example/.env.example)：`PORT`、`HOST`、`LOG_LEVEL`、`DOCS_UI`（`scalar` / `swagger-ui` / `none`）、`DOCS_USERNAME` / `DOCS_PASSWORD`、`CREATE_TASK_RATE_LIMIT`。

## 核心概念逐项验收地图

| 验收项                                                                                     | 教学章节   | 动手成果                                                                  |
| ------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------- |
| Fastify 实例、register、插件封装/作用域、decorator、route、request/reply 与 hook 生命周期  | 02、03、04 | 封装实验；TaskHub 的插件树；`db`/`auth` 插件                              |
| preValidation / preHandler / onRequest / onResponse 等 hook 的职责与执行顺序               | 04         | hook 顺序实验与测试；认证、规范化、授权、请求 ID 的 hook 位置             |
| JSON Schema 校验 params/querystring/headers/body；response schema 控制输出、避免泄露字段   | 05、07     | 四个部位的 schema；Ajv 默认配置实验；序列化实验；字段泄露测试             |
| TypeBox 的 Type、Static、Optional、Union、Literal、引用与可复用 schema；类型与 schema 同源 | 06         | `schemas/*.ts`；`ref()`、`Nullable()`；编译期类型检查演示                 |
| schema `$id`、复用与封装范围；结构校验 vs 需要访问数据库的业务规则                         | 08         | `shared-schemas` 插件；兄弟作用域引用失败实验；`TaskService` 与其单元测试 |
| 统一错误处理：业务、校验、未授权、禁止访问、不存在、冲突、限流、未知错误                   | 09         | 错误码目录、`AppError`、错误处理器；`errors.test.ts`                      |
| HTTP 状态码、分页/排序契约、请求 ID、稳定错误 code、可安全暴露的信息                       | 09、10     | 分页契约与测试；`genReqId`；ETag/If-Match；暴露信息清单                   |
| @fastify/swagger 注册顺序、schema 到 OpenAPI 的映射、API 版本与破坏性变更                  | 11         | 注册顺序实验；映射表与真实输出；导出脚本；破坏性变更判断表                |
| Swagger UI 与 Scalar 二选一；文档环境限制或只暴露安全信息                                  | 12         | 两种渲染器的接入；环境开关；Basic Auth；文档安全清单                      |
| Pino 日志、子 logger、结构化字段、日志级别、敏感字段 redact                                | 13         | `logger.ts`；redact 规则实验；`logging.test.ts`                           |
| `app.inject` 路由集成测试；测试插件装配与请求/响应行为                                     | 14         | 全部 6 个测试文件与测试地图                                               |

第 15 章为每一项提供了验收问题、动手验证方式和参考判断。

## 官方依据与验证范围

内容依据以下官方资料（每章末尾附有具体链接）：

- Fastify 5.12.7 随包文档：Server、Routes、Request、Reply、Plugins、Encapsulation、Decorators、Hooks、Lifecycle、Validation and Serialization、Errors、Logging、Type Providers、Testing Guide；
- TypeBox 1.x 官方文档（Type、Static、Optional、Union、Literal、Enum、Ref、Unsafe、Module、Cyclic、Value）；
- JSON Schema 官方的 Understanding JSON Schema；
- OpenAPI Specification 3.1；
- `@fastify/swagger`、`@fastify/swagger-ui`、`@fastify/type-provider-typebox`、`@fastify/rate-limit`、`fastify-plugin` 的 README；
- Scalar 官方的 Fastify 集成文档。

文中所有标注为“实测”“真实输出”的结果，都在上述版本下实际运行得到。配套工程已通过 TypeScript 7 类型检查和 57 个测试（Vitest）；`npm run build` 后以 `node dist/server.js` 运行、Scalar 页面与 `openapi.json` 返回 200、`SIGINT` 优雅停机均已手工验证。

未做自动化验证的部分：文档页面在浏览器中的实际渲染效果；反向代理与 `trustProxy`；多实例部署下的限流共享存储；真实数据库下的唯一约束与并发行为。教程中涉及这些内容的地方均已注明。

准备好了，就从[第 1 章](./01-http-api-mental-model.md)开始。
