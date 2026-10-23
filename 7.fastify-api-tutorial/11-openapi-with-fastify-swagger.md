# 第 11 章：用 @fastify/swagger 生成 OpenAPI，并管理 API 版本

[上一章](./10-api-contract-details.md) · [目录](./README.md) · [下一章](./12-api-reference-ui.md)

到目前为止，TaskHub 的每个路由都有完整的 schema：参数、请求体、每个状态码的响应。这些信息已经足以描述整个 API。本章用 **@fastify/swagger** 把它们汇总成一份标准的 **OpenAPI** 文档，然后讨论 API 的版本与破坏性变更。

## 11.1 OpenAPI 是什么

JSON Schema 描述“一个 JSON 值长什么样”；**OpenAPI 描述“一整个 HTTP API 长什么样”**：有哪些路径、每个路径支持哪些方法、接受什么参数、返回什么、怎么认证。它本身也是一份 JSON（或 YAML）文档：

```yaml
openapi: 3.1.0 # OpenAPI 规范的版本
info:
  title: TaskHub API
  version: 1.1.0 # 这份 API 文档自己的版本
servers:
  - url: /
paths:
  /v1/tasks/{taskId}:
    get:
      operationId: getTask
      tags: [tasks]
      parameters:
        - {
            in: path,
            name: taskId,
            required: true,
            schema: { type: string, format: uuid },
          }
      responses:
        "200":
          description: 对外公开的任务...
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Task" }
components:
  schemas:
    Task: { type: object, properties: { ... } }
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
security:
  - bearerAuth: []
```

有了这份文档，很多工具就能工作：

- **文档网站**：Scalar、Swagger UI 把它渲染成可交互的页面（第 12 章）；
- **客户端代码生成**：为前端生成类型安全的请求函数；
- **契约检查**：比较两个版本的文档，自动发现破坏性变更（本章 11.7）；
- **Mock 服务、API 网关配置**等。

### 版本说明

- **Swagger 2.0**：OpenAPI 的前身，`@fastify/swagger` 仍然支持（用 `swagger` 选项），新项目不要用。
- **OpenAPI 3.0**：Schema Object 是 JSON Schema 的一个“方言”，不支持 `type: 'null'`，要用 `nullable: true`。
- **OpenAPI 3.1**：Schema Object 与 **JSON Schema 2020-12** 对齐，`type: ['string', 'null']`、`const` 都可以直接使用。
- **OpenAPI 3.2**：最新版本，`@fastify/swagger` 已支持生成。

TaskHub 选择 **3.1.0**：TypeBox 生成的就是标准 JSON Schema，3.1 能原样表达，不需要转换；同时 Scalar、Swagger UI 等主流工具对 3.1 的支持已经成熟。如果你的下游工具链只支持 3.0，`@fastify/swagger` 在生成 3.0 文档时会自动把 `type: 'null'`、type 数组等转换成 `nullable` 写法。

## 11.2 注册：一定要在路由之前

`@fastify/swagger` 的工作方式是：注册时添加一个 `onRoute` 钩子（第 4 章），**之后**每注册一个路由，就把它的配置记下来；`app.ready()` 之后调用 `app.swagger()` 时，把记下的路由转换成 OpenAPI 文档。

这意味着**注册顺序至关重要**。实验：

```ts
const app = Fastify();
app.get("/before", async () => "x");
await app.register(import("@fastify/swagger"), {
  openapi: { info: { title: "t", version: "1" } },
});
app.get("/after", async () => "y");
await app.ready();
console.log(Object.keys(app.swagger().paths));
```

```text
[ '/after' ]
```

`/before` 没有出现在文档里——它注册时 `onRoute` 钩子还不存在。插件的 README 也明确写了：必须在任何路由之前注册。这就是 TaskHub 的 `buildApp` 中，`docsPlugin` 排在所有业务路由之前的原因。

另一个要求：`app.swagger()` 必须在 `ready()` 之后调用，否则抛出 `.swagger() must be called after .ready()`。

## 11.3 TaskHub 的文档插件：`src/plugins/docs.ts`（生成部分）

```ts
/**
 * OpenAPI 文档自身的版本号（info.version）。
 * 它和 URL 里的 /v1 不是一回事：/v1 是“主版本”，只有破坏性变更才升到 /v2；
 * info.version 记录这份契约的每次发布，兼容的新增也会让它变化。
 */
export const API_DOC_VERSION = "1.1.0";

export default fp<DocsPluginOptions>(
  async function docsPlugin(app, options) {
    await app.register(swagger, {
      openapi: {
        openapi: "3.1.0",
        info: {
          title: "TaskHub API",
          version: API_DOC_VERSION,
          description:
            "团队任务管理 API。所有 /v1 接口都需要 `Authorization: Bearer <token>`。",
        },
        // 只写相对路径，不在文档里暴露内网主机名
        servers: [{ url: "/" }],
        tags: [
          { name: "tasks", description: "任务的增删改查" },
          { name: "users", description: "当前用户与用户管理" },
        ],
        components: {
          securitySchemes: {
            // 文档会被很多人看到：只描述认证方式，不写任何真实或示例 token
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              description: "在 Authorization 请求头中携带 Bearer token",
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
      // 让带 $id 的共享 schema 以原名出现在 components.schemas 中，而不是 def-0、def-1
      refResolver: {
        buildLocalReference(json, _baseUri, _fragment, i) {
          return typeof json.$id === "string" ? json.$id : `def-${i}`;
        },
      },
    });

    // ……下半部分注册 Scalar 或 Swagger UI，见第 12 章
  },
  { name: "docs", fastify: "5.x" },
);
```

逐项说明：

- **`openapi.openapi`**：生成的规范版本。`@fastify/swagger` 默认是 3.0.3，这里显式设为 3.1.0。
- **`info.version`**：见 11.6 节。
- **`servers`**：文档页面“试调”请求发往哪里。写相对路径 `/`，表示“当前打开文档的这台服务器”，避免把内网地址写进文档（第 12 章）。
- **`tags`**：分组。路由 schema 里的 `tags: ['tasks']` 会把操作归入对应分组。
- **`components.securitySchemes` + 顶层 `security`**：声明“所有接口默认需要 Bearer token”。单个路由可以用 `schema.security: []` 覆盖为“无需认证”。
- **`refResolver.buildLocalReference`**：`@fastify/swagger` 默认会把共享 schema 重命名为 `def-0`、`def-1`……（插件 README 说明了这一点）。这里改为直接使用 `$id`，于是文档里出现的是 `Task`、`ErrorResponse` 这样有意义的名字。

插件用 `fp` 包装，`@fastify/swagger` 的 `onRoute` 钩子因此挂在根作用域上，能看到所有作用域里的路由。

## 11.4 路由 schema 如何映射到 OpenAPI

这是本章的核心。左边是你写的路由选项，右边是生成的 OpenAPI 内容：

| 路由选项                                                  | OpenAPI 中的位置                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| URL `/tasks/:taskId`（加上前缀）                          | `paths['/v1/tasks/{taskId}']`，`:param` 变成 `{param}`                        |
| HTTP 方法                                                 | 该路径下的 `get`/`post`/... 操作                                              |
| `schema.params` 的每个属性                                | `parameters` 中 `in: path`、`required: true` 的一项                           |
| `schema.querystring` 的每个属性                           | `parameters` 中 `in: query` 的一项，`required` 取决于是否在 `required` 列表中 |
| `schema.headers` 的每个属性                               | `parameters` 中 `in: header` 的一项                                           |
| `schema.body`                                             | `requestBody.content['application/json'].schema`                              |
| `schema.response[状态码]`                                 | `responses[状态码]`，`description` 取自 schema 的 `description`               |
| 响应 schema 是 `Type.Null()`                              | 该响应没有 `content`                                                          |
| `schema.tags` / `summary` / `description` / `operationId` | 操作的同名字段                                                                |
| `schema.security`                                         | 操作级别的安全要求（覆盖全局）                                                |
| `schema.deprecated: true`                                 | 操作标记为已废弃                                                              |
| `schema.hide: true`                                       | 该路由不出现在文档中                                                          |
| 带 `$id` 的共享 schema + `$ref`                           | `components.schemas.<id>` + `{ $ref: '#/components/schemas/<id>' }`           |
| schema 里的 `description`、`examples`、`default`          | 原样保留，文档页面会展示                                                      |

用 `npm run openapi:export` 导出 TaskHub 的文档，看几个真实片段。

**PATCH /v1/tasks/{taskId} 的参数**——params 与 headers 被合并进了 `parameters`：

```json
"parameters": [
  {
    "schema": { "type": "string", "format": "uuid" },
    "in": "path", "name": "taskId", "required": true,
    "description": "UUID 格式的资源 ID"
  },
  {
    "schema": { "type": "string", "pattern": "^\"[0-9]+\"$" },
    "in": "header", "name": "if-match", "required": false,
    "description": "可选。传入上次读到的 ETag（如 \"3\"），若任务已被他人修改则返回 412"
  }
]
```

**GET /v1/tasks 的查询参数**——`Type.Optional` 的字段都是 `required: false`，`default` 和上限都进入了文档：

```json
{
  "schema": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20 },
  "in": "query",
  "name": "pageSize",
  "required": false,
  "description": "每页条数，最大 100"
}
```

这正是第 6 章坚持保留 `Optional` 的原因：如果去掉它，这里会变成 `required: true`。

**POST /v1/tasks 的响应**——`errorResponses()` 生成的说明列出了错误码：

```json
"201": {
  "description": "对外公开的任务。内部字段（如 internalNote）不在此列，序列化时会被丢弃",
  "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Task" } } }
},
"409": {
  "description": "错误码目录中对应 409 的 code：TASK_TITLE_CONFLICT、TASK_ALREADY_DONE",
  "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } }
}
```

**DELETE 的 204**——没有 `content`：

```json
"204": { "description": "删除成功，无响应体" }
```

**可为 null 的字段**——3.1 中原样保留 type 数组：

```json
"description": { "type": ["null", "string"], "maxLength": 2000, "description": "描述，可以为 null" }
```

**`components.schemas`** 中有 `ErrorDetail`、`ErrorResponse`、`PageMeta`、`PublicUser`、`Task`、`TaskList` 六个模型，`Task` 里没有 `internalNote`——文档和真实响应一样，不会泄露内部字段。

配套测试 `test/openapi.test.ts` 把这些映射关系都固定了下来，例如：

```ts
it("params / querystring / headers 被映射成 OpenAPI parameters", async () => {
  const doc = await getDocument();
  const list = doc.paths["/v1/tasks"]?.get?.parameters ?? [];
  expect(list.map((p) => `${p.in}:${p.name}:${p.required}`)).toEqual([
    "query:page:false",
    "query:pageSize:false",
    "query:sort:false",
    "query:status:false",
    "query:assigneeId:false",
  ]);
  const patch = doc.paths["/v1/tasks/{taskId}"]?.patch?.parameters ?? [];
  expect(patch.map((p) => `${p.in}:${p.name}:${p.required}`)).toEqual([
    "path:taskId:true",
    "header:if-match:false",
  ]);
});
```

### 让文档好用的几个字段

- **`operationId`**：操作的唯一名字（如 `listTasks`、`createTask`）。客户端代码生成器用它做函数名。不写的话，生成器只能根据路径拼出难看的名字。在整个文档里必须唯一。
- **`summary`**：一句话说明，显示在文档的导航列表里。
- **`description`**：较长的说明，支持 Markdown。TaskHub 在 `GET /tasks/:taskId` 的 description 里说明了 `ETag` 的用途。
- **schema 级的 `description`、`examples`**：显示在字段旁边。

这些字段在 TypeScript 中能直接写在 `schema` 里，是因为 `@fastify/swagger` 扩展了 Fastify 的 `FastifySchema` 类型。

## 11.5 隐藏路由与多份文档

不是所有路由都应该出现在对外文档里：

- 健康检查、内部运维接口：在 schema 上写 `hide: true`（TaskHub 的 `/healthz` 就是这样），或者给路由打上 `X-HIDDEN` 标签。
- 也可以在注册时传入 `transform` 函数，按 URL 或路由配置统一决定隐藏哪些路由、甚至改写 URL。

`@fastify/swagger` 还支持注册多次、生成多份文档：用 `decorator` 选项给每个实例起不同的装饰器名（如 `app.publicSwagger()`、`app.internalSwagger()`），配合各自的 `transform` 隐藏不同的路由。这在“同一个服务同时提供对外 API 和内部管理 API”时很有用。

`Scalar` 和 `Swagger UI` 自己注册的页面路由会被它们标记为隐藏，不会出现在 `paths` 里（配套测试验证了这一点）。

## 11.6 两个“版本号”不是一回事

TaskHub 里有两个版本号，经常被混淆：

|                | 是什么                           | 什么时候变                           | 例子              |
| -------------- | -------------------------------- | ------------------------------------ | ----------------- |
| URL 中的 `/v1` | API 的**主版本**，是契约的一部分 | 只有**破坏性变更**时才升到 `/v2`     | `/v1/tasks`       |
| `info.version` | **这份文档**的版本               | 每次契约发布都可以变，包括兼容的新增 | `1.0.0` → `1.1.0` |

OpenAPI 规范对 `info.version` 的定义是“OpenAPI 文档的版本”，与 OpenAPI 规范自身的版本（`openapi: 3.1.0`）、也与你如何给 URL 分版本都无关。TaskHub 的约定是：`info.version` 用语义化版本，**主版本号与 URL 前缀保持一致**（`1.x.y` 对应 `/v1`），次版本号在新增功能时递增（比如加了 `If-Match` 支持后从 1.0.0 变为 1.1.0），修订号用于纯文档修正。

### 为什么用 URL 前缀表示主版本

常见的方式有三种：URL 前缀（`/v1/...`）、请求头（`Accept: application/vnd.taskhub.v1+json` 或自定义头）、查询参数（`?version=1`）。Fastify 还内置了基于 `Accept-Version` 头的路由约束（`constraints: { version: '1.x' }`）。

TaskHub 选 URL 前缀，因为它最直观：在浏览器、日志、监控里一眼可见；缓存与网关配置最简单；在 Fastify 里只需要 `register(v1Routes, { prefix: '/v1' })`。

## 11.7 什么是破坏性变更

**破坏性变更（breaking change）** 是指：已经按旧契约正确编写的客户端，在新版本上会出错或行为改变。判断时要始终站在**已有客户端**的角度。

| 变更                                           | 是否破坏性 | 原因                                               |
| ---------------------------------------------- | ---------- | -------------------------------------------------- |
| 新增一个接口                                   | 否         | 老客户端不会调用它                                 |
| 请求中新增一个**可选**参数/字段                | 否         | 老客户端不传，服务端用默认行为                     |
| 请求中新增一个**必填**参数/字段                | **是**     | 老客户端不传，会得到 400                           |
| 放宽请求约束（`maxLength` 120 → 200）          | 否         | 老客户端的请求仍然合法                             |
| 收紧请求约束（`maxLength` 120 → 50）           | **是**     | 老客户端的合法请求变成 400                         |
| 响应中新增字段                                 | 通常否     | 前提是客户端忽略未知字段（应在文档中声明这一约定） |
| 响应中删除字段、改名、改类型                   | **是**     | 客户端读不到或读错                                 |
| 响应中可空字段原来从不为 null，现在可能为 null | **是**     | 客户端可能没有处理 null                            |
| 响应枚举新增一个值（如新状态 `blocked`）       | **可能是** | 用穷举 `switch` 处理状态的客户端会遇到未知值       |
| 请求枚举新增一个值                             | 否         | 老客户端不会发送它                                 |
| 改变状态码（如 200 改为 201）                  | **是**     | 客户端可能只认 200                                 |
| 改变或删除错误码 `code`                        | **是**     | 客户端的错误分支失效（第 9 章）                    |
| 新增错误码                                     | 通常否     | 客户端应对未知 code 走默认分支                     |
| 改变默认值（`pageSize` 20 → 50）               | **可能是** | 依赖默认行为的客户端看到不同结果                   |
| 改变认证方式                                   | **是**     | 所有请求失败                                       |

两条有用的设计原则：

1. **客户端要宽容**：忽略不认识的字段、对不认识的枚举值和错误码有兜底处理。把这一点写进 API 文档，服务端才有空间做兼容的演进。
2. **服务端要严格**：请求中的约束一开始就定紧一些（放宽是兼容的，收紧不是）。这也是 TaskHub 一开始就给 `pageSize`、`title` 都设了上限的原因之一。

### 废弃：给客户端留出迁移时间

需要移除某个东西时，不要直接删，而是先**废弃**：

```ts
app.get(
  "/old",
  {
    schema: {
      deprecated: true, // 整个操作废弃
      querystring: Type.Object({
        q: Type.Optional(
          Type.String({ deprecated: true, description: "请改用 term" }),
        ), // 某个参数废弃
      }),
    },
  },
  handler,
);
```

实测生成的 OpenAPI 中，操作上出现 `"deprecated": true`；参数的 `deprecated` 则保留在该参数的 `schema` 里（OpenAPI 3.1 的 Schema Object 支持 JSON Schema 的 `deprecated` 注解）。Scalar 和 Swagger UI 都会把废弃的操作显示为删除线或特殊标记。

还可以在运行时通过响应头通知客户端，例如 `Deprecation` 头（RFC 9745）与 `Sunset` 头（RFC 8594，标明预计下线时间），用一个 `onSend` hook 给被废弃的路由统一加上。

### 推出 `/v2` 的方式

如果必须做破坏性变更：

1. 新建 `v2Routes` 插件，用 `register(v2Routes, { prefix: '/v2' })` 注册。v1 和 v2 共享同一个 service 层，只在 HTTP 层（schema、路由）上有差异。
2. 两个版本并行运行一段时间，在 v1 上标记 `deprecated` 并加上 `Sunset` 头。
3. 可以用两次注册 `@fastify/swagger`（不同的 `decorator` 名 + `transform` 按前缀隐藏路由）生成两份独立文档。
4. 监控 v1 的调用量，降到可接受水平后再下线。

### 在 CI 中自动发现破坏性变更

靠人眼审查很难发现所有破坏性变更。TaskHub 提供了一个导出脚本：

```ts
// src/scripts/export-openapi.ts
import { writeFile } from "node:fs/promises";
import { buildApp } from "../app.js";

/**
 * 把当前代码生成的 OpenAPI 文档写到 openapi.json。
 * 在 CI 里和上一个发布版本的文件做 diff，就能在合并前发现破坏性变更。
 */
const app = await buildApp();
await app.ready();
const document = app.swagger();
await writeFile("openapi.json", JSON.stringify(document, null, 2) + "\n");
await app.close();
console.log(
  `openapi.json written: ${Object.keys(document.paths ?? {}).length} paths`,
);
```

```bash
npm run openapi:export
# openapi.json written: 4 paths
```

建议的工作流：

1. 每次发布时，把当时的 `openapi.json` 作为制品保存（或提交到仓库）。
2. 每个合并请求在 CI 中导出新的 `openapi.json`，和主分支的版本比较。
3. 用专门的 OpenAPI 差异检查工具（例如开源的 oasdiff）报告破坏性变更；出现破坏性变更时要求显式确认，并检查 `info.version` 是否按约定更新。

因为文档是**从代码生成**的，这个检查比较的就是真实的契约，而不是一份可能过时的手写文档。

## 11.8 练习

1. 给 `GET /v1/tasks` 新增一个可选的 `q` 参数做标题搜索。这是破坏性变更吗？`info.version` 应该怎么变？
2. 产品要求任务新增一个状态 `blocked`。分析它对请求、响应分别意味着什么，怎样发布最安全？
3. 有人把 `docsPlugin` 的注册挪到了 `v1Routes` 之后。启动会报错吗？文档会怎样？用哪个测试能发现？
4. 为什么 `servers` 写 `[{ url: '/' }]`，而不是 `[{ url: 'http://10.0.3.17:3000' }]`？

**参考答案**

1. 不是破坏性变更（新增可选参数）。`info.version` 从 1.1.0 升到 1.2.0。
2. 请求方向（PATCH 可以设置 `blocked`）是兼容的新增；响应方向（列表/详情可能返回 `blocked`）对穷举处理状态的客户端是潜在的破坏性变更。较安全的发布方式：提前在文档中声明“客户端须容忍未知的状态值”；先上线只读兼容（客户端版本先支持显示 `blocked`），再开放设置；必要时让新状态只在 `/v2` 中出现。
3. 不会报错，但文档的 `paths` 是空的（业务路由注册时 `onRoute` 钩子还不存在）。`test/openapi.test.ts` 中“只包含对外的 /v1 路由”的测试会失败。
4. 写死的地址会把内网信息暴露在文档里；换环境时还得改代码。相对路径 `/` 让文档页面的“试调”请求发往当前打开文档的那台服务器。

## 本章验收

- [ ] 能说出 OpenAPI 文档的主要组成部分，以及 3.0 与 3.1 在 null 处理上的差别。
- [ ] 能正确注册 `@fastify/swagger`，解释为什么必须在路由之前注册，并复现顺序错误的后果。
- [ ] 能说出路由 schema 的各个部分分别映射到 OpenAPI 的什么位置。
- [ ] 能用 `refResolver` 让共享 schema 以原名进入 `components.schemas`，并会写 `operationId`、`tags`、`security`、`hide`。
- [ ] 能区分 URL 主版本与 `info.version`，并判断一个变更是否是破坏性变更。
- [ ] 能描述废弃流程，以及在 CI 中自动检查破坏性变更的方法。

官方阅读：[@fastify/swagger README](https://github.com/fastify/fastify-swagger)、[OpenAPI Specification 3.1.1](https://spec.openapis.org/oas/v3.1.1.html)、[Fastify Routes：Constraints / Version](https://fastify.dev/docs/latest/Reference/Routes/#constraints)。

下一章，[用 Scalar 或 Swagger UI 展示文档，并控制暴露范围](./12-api-reference-ui.md)。
