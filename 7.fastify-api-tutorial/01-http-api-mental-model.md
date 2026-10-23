# 第 1 章：HTTP API 的心智模型与项目蓝图

[目录](./README.md) · [下一章](./02-setup-and-first-route.md)

## 1.1 从你熟悉的 `fetch` 说起

作为前端，你大概写过无数次这样的代码：

```ts
const response = await fetch("/v1/tasks?status=todo&page=1", {
  headers: { Authorization: `Bearer ${token}` },
});
if (!response.ok) {
  const error = await response.json();
  showToast(error.message);
  return;
}
const data = await response.json();
render(data.items);
```

这几行代码背后，前端其实在**默默相信**服务器的很多事情：

1. `status=todo` 是一个合法的筛选值，写成 `status=TODO` 会怎样？
2. 返回的 JSON 一定有 `items`，而且是数组。
3. `response.ok` 为 false 时，body 一定是 JSON，而且一定有 `message`。
4. `items` 里的每一项不会突然多出一个 `passwordHash` 字段。
5. 同一个请求如果失败了，后端能凭某个 ID 查到当时发生了什么。

这些“相信”合起来，就叫 **API 契约（contract）**。这本教程要做的，是站到服务器那一边，把这份契约**明确地写下来，并让程序在运行时强制执行它**。

## 1.2 一次 HTTP 请求由什么组成

把上面那次请求拆开，一个 HTTP 请求有五个可被服务器读取的部分：

```text
GET /v1/tasks/10000000-0000-4000-8000-000000000001?fields=title HTTP/1.1
│   │         │                                    │
│   │         └─ 路径参数（params）                 └─ 查询字符串（querystring）
│   └─ 路径（path）
└─ 方法（method）

Authorization: Bearer alice-token     ← 请求头（headers）
Content-Type: application/json

{"title": "写周报"}                    ← 请求体（body），GET 通常没有
```

服务器的回应同样分三部分：

```text
HTTP/1.1 201 Created                  ← 状态码（status code）
Location: /v1/tasks/7f1c...           ← 响应头（headers）
Content-Type: application/json
x-request-id: 3b9e...

{"id":"7f1c...","title":"写周报",...}   ← 响应体（body）
```

后面你会看到，Fastify 把这些部分原样映射到 `request.params`、`request.query`、`request.headers`、`request.body`，以及 `reply.code()`、`reply.header()`、`reply.send()` 上。**本书所有的校验、文档、测试，都是围绕这几个部分展开的。**

## 1.3 为什么前端的 TypeScript 类型保护不了服务器

你可能会想：前后端都用 TypeScript，给请求体写个 `interface CreateTaskBody` 不就行了吗？

```ts
interface CreateTaskBody {
  title: string;
  priority?: "low" | "medium" | "high";
}
```

问题在于：**TypeScript 类型只在编译时存在，编译后会被完全擦除**。服务器收到的是一串来自网络的字节，发送者可能是：

- 你自己的前端（大概率符合类型）；
- 一个旧版本的 App（字段名可能不同）；
- 一个在 Postman 里手敲请求的同事；
- 一个故意构造恶意数据的攻击者。

服务器拿到的 `request.body` 在运行时可以是 `{ "title": 123 }`、`{ "title": "" }`、`{}`、`null`，甚至是一个 10MB 的字符串。TypeScript 不会在运行时跳出来阻止任何一种。

所以服务器需要**运行时校验**：用一份机器可读的规则描述“合法输入长什么样”，在执行业务代码之前检查。这份规则的标准格式就是 **JSON Schema**。

输出方向也有同样的问题。假设数据库里一行用户数据是：

```ts
{ id: '...', name: 'Alice', email: 'alice@example.com', apiToken: 'secret' }
```

如果 handler 直接 `return user`，`apiToken` 就会原封不动地发给客户端。TypeScript 不会报错——多一个字段并不违反类型。我们需要一份**输出 schema**，在序列化时只允许声明过的字段通过。

## 1.4 本教程的工具，各自负责什么

| 工具                               | 一句话职责                                                            | 运行在哪            |
| ---------------------------------- | --------------------------------------------------------------------- | ------------------- |
| **Fastify**                        | Node.js 的 HTTP 框架：路由、插件、生命周期 hook、错误处理             | 服务端运行时        |
| **JSON Schema**                    | 描述“数据长什么样”的**标准格式**（是一份规范，不是一个库）            | 一份 JSON 数据      |
| **Ajv**                            | Fastify 内置的 JSON Schema **校验器**，把 schema 编译成校验函数       | 服务端运行时        |
| **fast-json-stringify**            | Fastify 内置的**序列化器**，按响应 schema 把对象转成 JSON 字符串      | 服务端运行时        |
| **TypeBox**                        | 用 TypeScript 代码**生成** JSON Schema，并从同一份定义推断出 TS 类型  | 编译时 + 运行时     |
| **@fastify/type-provider-typebox** | 让 Fastify 的路由根据 TypeBox schema 自动推断 `request.body` 等的类型 | 编译时              |
| **OpenAPI**                        | 描述**整个 HTTP API**（路径、参数、响应、认证）的标准格式             | 一份 JSON/YAML 文档 |
| **@fastify/swagger**               | 收集所有路由的 schema，**生成** OpenAPI 文档                          | 服务端运行时        |
| **Swagger UI / Scalar**            | 把 OpenAPI 文档**渲染成网页**，可以浏览和试调接口（二选一）           | 浏览器              |
| **Pino**                           | Fastify 内置的**结构化日志**库，每条日志是一行 JSON                   | 服务端运行时        |
| **light-my-request**               | `app.inject()` 背后的库，不开端口就能模拟 HTTP 请求                   | 测试                |

最重要的一张图，是**一份 schema 被用在四个地方**：

```text
                     ┌──────────────► TypeScript 类型（Static / type provider）  编译时
                     │
TypeBox 定义的 schema ─┼──────────────► Ajv：校验 params / query / headers / body   运行时·输入
  （本质是 JSON Schema）│
                     ├──────────────► fast-json-stringify：过滤与序列化响应       运行时·输出
                     │
                     └──────────────► @fastify/swagger → OpenAPI → Scalar/Swagger UI  文档
```

只要维护这一份定义，类型、校验、输出、文档就**不会互相脱节**。这正是“类型推断与运行时 schema 同源”的含义。

## 1.5 贯穿全书的项目：TaskHub 团队任务 API

我们不按 API 名称罗列功能，而是从一个小而完整的业务出发。TaskHub 是一个团队任务管理后端：

**角色**

- `member`：普通成员，只能管理自己创建的任务；
- `admin`：管理员，可以看到并修改所有人的任务。

**需求**

1. 用户通过 `Authorization: Bearer <token>` 访问 API，没有或错误的 token 返回 401。
2. 成员可以创建任务；标题不能为空、不能超过 120 字；同一个人不能有两个同名任务。
3. 可以把任务指派给另一个用户，但这个用户必须真实存在。
4. 任务列表支持分页、排序和按状态筛选；每页最多 100 条。
5. 成员只能看到自己创建的或被指派给自己的任务；看不到的任务，对他来说就“不存在”。
6. 能看到但不是自己创建的任务，不能修改或删除（403）。
7. 已完成（`done`）的任务只能修改状态，不能改标题等内容。
8. 两个人同时编辑同一个任务时，后提交的人应该被告知“数据已过期”，而不是悄悄覆盖。
9. 创建任务要限流，防止脚本刷数据。
10. 任务有一个“内部备注”字段，只给运营看，**绝不能**出现在 API 响应里。
11. 每个响应都带请求 ID；出错时客户端把请求 ID 报给后端，后端能在日志里找到完整上下文。
12. 有一份自动生成、和代码永远一致的 API 文档；生产环境默认不公开。

这些需求分别会驱动：认证 hook、body 校验、业务规则、`$ref` 引用、分页契约、可见性规则、403/404 的选择、状态冲突 409、乐观并发 412、限流 429、响应 schema 过滤、请求 ID 与结构化日志、OpenAPI 与文档安全。

### 端点一览

| 方法   | 路径                      | 说明                       | 成功状态码 |
| ------ | ------------------------- | -------------------------- | ---------- |
| GET    | `/healthz`                | 存活探针（不在文档中展示） | 200        |
| GET    | `/v1/me`                  | 当前登录用户               | 200        |
| GET    | `/v1/admin/users/:userId` | 管理员查看用户详情         | 200        |
| GET    | `/v1/tasks`               | 分页列出我能看到的任务     | 200        |
| POST   | `/v1/tasks`               | 创建任务                   | 201        |
| GET    | `/v1/tasks/:taskId`       | 查看单个任务               | 200        |
| PATCH  | `/v1/tasks/:taskId`       | 部分修改任务               | 200        |
| DELETE | `/v1/tasks/:taskId`       | 删除任务                   | 204        |

### 最终的项目结构

```text
example/
├── src/
│   ├── app.ts                  # 应用工厂：按顺序装配所有插件（不 listen）
│   ├── server.ts               # 生产入口：读配置、listen、优雅停机
│   ├── config.ts               # 读取并校验环境变量
│   ├── logger.ts               # Pino 配置、redact、请求 ID 生成
│   ├── errors/app-error.ts     # 错误码目录与 AppError
│   ├── schemas/                # TypeBox schema（类型与运行时规则的唯一来源）
│   │   ├── common.ts           #   ref()、Nullable()、错误响应、分页
│   │   ├── task.ts
│   │   └── user.ts
│   ├── plugins/                # 基础设施插件（大多用 fastify-plugin 共享到根作用域）
│   │   ├── error-handler.ts
│   │   ├── request-context.ts
│   │   ├── shared-schemas.ts
│   │   ├── db.ts
│   │   ├── auth.ts
│   │   └── docs.ts
│   ├── modules/                # 业务模块（封装的插件）
│   │   ├── health/routes.ts
│   │   ├── v1.ts               #   /v1 作用域：统一挂认证
│   │   ├── users/routes.ts
│   │   └── tasks/
│   │       ├── routes.ts       #   HTTP 适配：schema、hook、状态码
│   │       └── service.ts      #   业务规则：查库、判断、抛业务错误
│   ├── data/                   # 内存“数据库”与种子数据
│   └── scripts/export-openapi.ts
└── test/                       # 用 app.inject 写的集成测试
```

## 1.6 分层：每一层只回答一类问题

新手写后端最常见的问题，是把所有逻辑都塞进路由 handler。我们用三层来切分职责：

| 层                                   | 回答的问题                                                     | 例子                                                                     | 不应该做的事                               |
| ------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| **路由层**（routes + schema + hook） | 这个 HTTP 请求的**形状**对不对？谁在调用？成功时回什么状态码？ | `title` 是 1~120 字的字符串；未登录返回 401；创建成功返回 201 + Location | 写 SQL、判断“同名任务是否存在”             |
| **业务层**（service）                | 在**当前系统状态下**，这个操作允许吗？                         | 指派人必须存在；同名任务冲突；done 的任务不能改标题                      | 读 `request.headers`、决定 HTTP 状态码细节 |
| **数据层**（store）                  | 怎么把数据存进去、查出来？                                     | 按条件筛选、排序、分页                                                   | 判断用户权限                               |

这里最关键的一条分界线是：

> **结构校验**（schema 能回答的）vs **业务规则**（必须查数据库或依赖当前状态才能回答的）。

“`assigneeId` 必须是 UUID 格式”是结构校验，写在 schema 里，Fastify 在调用 handler 之前就会拒绝。
“`assigneeId` 对应的用户必须存在”是业务规则，必须查库，写在 service 里。第 8 章会专门讲为什么不能把后者塞进 schema。

## 1.7 动手：先在纸上设计

不写代码，先回答下面几个问题。写下你的答案，再对照参考答案。

1. 创建任务成功，应该返回什么状态码？响应里除了任务本身，还应该告诉客户端什么？
2. 客户端请求 `GET /v1/tasks?pageSize=10000`，服务器应该怎么处理？
3. Alice 请求查看 Bob 的私人任务，应该返回 403 还是 404？
4. 请求体是 `{ "title": "写周报", "ownerId": "<Bob 的 ID>" }`，服务器该怎么对待 `ownerId`？
5. “同一个人不能有两个同名任务”应该写进 JSON Schema 吗？

**参考答案**

1. `201 Created`，并在 `Location` 响应头里给出新资源的 URL（如 `/v1/tasks/<id>`），客户端不必自己拼。
2. 两种都合理：拒绝（400）或截断到上限。TaskHub 选择**拒绝并明确告知上限**——契约更清晰，客户端不会误以为自己拿到了全部数据。无论哪种，都不能真的一次查 10000 条。
3. TaskHub 返回 **404**：对 Alice 来说，这个任务不应该存在。返回 403 等于告诉她“这个 ID 有效，只是你没权限”，泄露了资源存在性。而 Bob 指派给 Alice 的任务，她能看到但不能改，这时返回 403 才合适。
4. **忽略它**。任务的所有者应该来自登录身份，而不是客户端自报。schema 里设置 `additionalProperties: false`，Fastify 会把未声明的字段直接移除（第 5 章），这能防御“批量赋值（mass assignment）”漏洞。
5. **不应该**。它依赖数据库中已有的数据，属于业务规则，写在 service 里，返回 409 冲突。

## 本章验收

- [ ] 能说出 HTTP 请求中可被服务器读取的五个部分，以及响应的三个部分。
- [ ] 能解释为什么 TypeScript 类型不能替代运行时校验，也不能阻止响应泄露字段。
- [ ] 能说出 Fastify、JSON Schema、TypeBox、OpenAPI、@fastify/swagger、Swagger UI/Scalar、Pino 各自的职责。
- [ ] 能画出“一份 schema 用在四个地方”的图。
- [ ] 能区分结构校验与需要查数据库的业务规则，并各举一例。

官方阅读：[Fastify Getting Started](https://fastify.dev/docs/latest/Guides/Getting-Started/)、[JSON Schema: What is JSON Schema?](https://json-schema.org/overview/what-is-jsonschema)、[OpenAPI Specification](https://spec.openapis.org/oas/v3.1.1.html)。

接下来，[搭建项目并写出第一个路由](./02-setup-and-first-route.md)。
