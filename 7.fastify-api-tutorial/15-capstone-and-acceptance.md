# 第 15 章：综合实战与逐项验收

[上一章](./14-testing-with-inject.md) · [目录](./README.md)

本章分三部分：先用 `curl` 把 TaskHub 完整走一遍，把前面十四章的内容串起来；然后按本书开头的“核心概念清单”逐项验收，每一项都有问题、动手验证方式和判断标准；最后是几个扩展练习和上线前检查清单。

## 15.1 运行配套工程

```bash
cd fastify-api-tutorial/example
npm ci
npm run typecheck
npm test
```

预期：类型检查无输出，6 个测试文件、57 个测试全部通过。

启动开发服务器：

```bash
npm run dev
```

默认监听 `http://127.0.0.1:3000`，日志经 pino-pretty 格式化，文档页面在 `http://127.0.0.1:3000/docs`（Scalar）。种子数据中有三个用户：

| 用户  | 角色   | token         | ID                                     |
| ----- | ------ | ------------- | -------------------------------------- |
| Alice | member | `alice-token` | `00000000-0000-4000-8000-000000000001` |
| Bob   | member | `bob-token`   | `00000000-0000-4000-8000-000000000002` |
| Carol | admin  | `admin-token` | `00000000-0000-4000-8000-000000000003` |

Alice 有一个任务 `10000000-0000-4000-8000-000000000001`，Bob 有一个任务 `10000000-0000-4000-8000-000000000002`。

## 15.2 用 curl 走一遍完整流程

下面的输出来自真实运行（为便于阅读，`requestId` 用 `…` 省略，并只保留关键响应头）。服务器以 `CREATE_TASK_RATE_LIMIT=5` 启动，以便快速触发限流。

```bash
B=http://127.0.0.1:3000
A='authorization: Bearer alice-token'
```

**1. 我是谁**——响应 schema 过滤掉了 `email` 与 `apiToken`（第 7 章）：

```bash
curl -s $B/v1/me -H "$A"
```

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "name": "Alice",
  "role": "member"
}
```

**2. 列出我的任务**——默认分页参数由 Ajv 补齐，每个响应都带 `x-request-id`（第 5、10 章）：

```bash
curl -s -i $B/v1/tasks -H "$A"
```

```text
HTTP/1.1 200 OK
x-request-id: d128ebfa-…
{"items":[{"id":"10000000-…-000000000001","title":"准备周会材料","description":null,"status":"todo","priority":"medium",
"ownerId":"00000000-…-000000000001","assigneeId":null,"createdAt":"2026-01-05T09:00:00.000Z","updatedAt":"2026-01-05T09:00:00.000Z"}],
"page":{"page":1,"pageSize":20,"total":1,"totalPages":1}}
```

Bob 的任务不在列表里（可见性规则），`internalNote` 也不在（响应 schema）。

**3. 创建任务**——标题首尾空白被 `preValidation` 去掉；`ownerId` 被移除，所有者来自登录身份；返回 201 + Location（第 4、5、10 章）：

```bash
curl -s -i -X POST $B/v1/tasks -H "$A" -H 'content-type: application/json' \
  -d '{"title":"  发布 v1.2  ","priority":"high","ownerId":"00000000-0000-4000-8000-000000000002"}'
```

```text
HTTP/1.1 201 Created
location: /v1/tasks/773d84d9-8952-49fc-9c4e-04ed6fd1bc2d
{"id":"773d84d9-…","title":"发布 v1.2","description":null,"status":"todo","priority":"high",
"ownerId":"00000000-…-000000000001","assigneeId":null,"createdAt":"…","updatedAt":"…"}
```

**4. 读取并拿到 ETag**（第 10 章）：

```bash
curl -s -i $B/v1/tasks/$ID -H "$A"
```

```text
HTTP/1.1 200 OK
etag: "1"
```

**5. 带 If-Match 修改**——版本匹配，修改成功，ETag 变为 `"2"`：

```bash
curl -s -i -X PATCH $B/v1/tasks/$ID -H "$A" -H 'if-match: "1"' \
  -H 'content-type: application/json' -d '{"status":"doing"}'
```

```text
HTTP/1.1 200 OK
etag: "2"
{"id":"773d84d9-…","title":"发布 v1.2",…,"status":"doing",…}
```

**6. 用过期的版本再改一次**——412：

```bash
curl -s -X PATCH $B/v1/tasks/$ID -H "$A" -H 'if-match: "1"' \
  -H 'content-type: application/json' -d '{"priority":"low"}'
```

```json
{
  "statusCode": 412,
  "code": "PRECONDITION_FAILED",
  "message": "资源已被修改，请重新获取后再提交",
  "requestId": "…"
}
```

**7. 同名任务**——业务规则，409（第 8 章）：

```json
{
  "statusCode": 409,
  "code": "TASK_TITLE_CONFLICT",
  "message": "你已经有一个同名任务",
  "requestId": "…"
}
```

**8. 结构错误**——请求 `{"title":"","priority":"urgent"}`，两个字段都不合法，但只报告了第一个（`allErrors: false`，第 5 章）：

```json
{
  "statusCode": 400,
  "code": "VALIDATION_FAILED",
  "message": "请求参数不符合接口约定",
  "requestId": "…",
  "details": [
    {
      "location": "body",
      "field": "/title",
      "rule": "minLength",
      "message": "must NOT have fewer than 1 characters"
    }
  ]
}
```

**9. 超过分页上限**：

```bash
curl -s "$B/v1/tasks?pageSize=500" -H "$A"
```

```json
{"statusCode":400,"code":"VALIDATION_FAILED",…,"details":[{"location":"querystring","field":"/pageSize","rule":"maximum","message":"must be <= 100"}]}
```

**10. 删除**——204，没有响应体：

```text
HTTP/1.1 204 No Content
```

**11. 访问 Bob 的任务**——对 Alice 不可见，所以是 404 而不是 403（第 9 章）：

```json
{
  "statusCode": 404,
  "code": "TASK_NOT_FOUND",
  "message": "任务不存在",
  "requestId": "…"
}
```

**12. 访问管理员接口**——身份已知但权限不够，403：

```json
{
  "statusCode": 403,
  "code": "FORBIDDEN",
  "message": "没有执行该操作的权限",
  "requestId": "…"
}
```

**13. 不带 token**——401，带 `WWW-Authenticate`：

```text
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer
{"statusCode":401,"code":"UNAUTHORIZED","message":"缺少或无效的身份凭证","requestId":"…"}
```

**14. 连续创建，触发限流**：

```text
201 201 429 429
HTTP/1.1 429 Too Many Requests
retry-after: 60
{"statusCode":429,"code":"RATE_LIMITED","message":"请求过于频繁，请稍后再试","requestId":"…"}
```

为什么第三次就被限流了，而不是第五次？因为前面第 3、7、8 步的三次 POST 也被计入了——限流 hook 运行在 `onRequest` 阶段，**在校验和业务逻辑之前**，失败的请求同样消耗额度。这正是限流的意义：它保护的是服务器资源，而不是“成功创建的次数”。

在另一个终端观察服务器日志，你会看到每条日志都带着 `requestId` 和 `userId`；4xx 是 `INFO request rejected`，没有 error 级别的日志。

## 15.3 核心概念逐项验收

每一项都请先**不看参考判断**，自己回答问题、动手验证，再对照。

### ① Fastify 实例、register、插件封装/作用域、decorator、route、request/reply 与 hook 生命周期

**问题**

1. Fastify 实例扮演哪四个角色？
2. 为什么 `db` 插件用 `fastify-plugin` 包装，而 `tasks` 路由插件不用？
3. `decorateRequest('user', {})` 为什么会启动失败？
4. 在 `/v1` 插件里 `addHook('onRequest', app.authenticate)`，为什么 `/healthz` 不受影响？

**动手验证**：运行第 3 章的封装实验；运行 `test/plugins.test.ts`。

**参考判断**

1. HTTP 服务器、路由表、插件容器、配置与工具的载体（第 2 章）。
2. `db` 是全应用都要用的基础设施，必须对兄弟插件可见；`tasks` 是业务模块，它的 `taskService`、`request.task` 应当被封装，而且路由插件需要 `prefix` 生效（第 3 章）。
3. 引用类型的默认值会被所有请求共享，造成数据串号；Fastify 抛出 `FST_ERR_DEC_REFERENCE_TYPE`。应以 `null` 声明，在 hook 中赋值（第 3 章）。
4. hook 遵守封装规则：`/healthz` 注册在 `/v1` 的兄弟作用域里（第 3、4 章）。

### ② preValidation / preHandler / onRequest / onResponse 等 hook 的职责与执行顺序

**问题**

1. 写出一个合法请求依次经过的 hook，以及校验失败时的路径。
2. 认证为什么放在 `onRequest`？授权（能否修改某个任务）为什么放在 `preHandler`？
3. 标题去空白为什么必须放在 `preValidation`？
4. `x-request-id` 响应头为什么写在 `onSend` 里？`onResponse` 适合做什么？

**动手验证**：运行“hook 执行顺序”两个测试；运行“认证放在 onRequest”测试。

**参考判断**

1. `onRequest → preParsing → preValidation → preHandler →（路由级 preHandler）→ handler → preSerialization → onSend → onResponse`；校验失败：`onRequest → preParsing → preValidation → onError → onSend → onResponse`（第 4 章）。
2. 身份识别不需要 body，越早拒绝越省资源，未登录的请求连 body 都不解析；授权需要合法的 `taskId` 并查库，必须在校验之后（第 4 章）。
3. 规范化必须发生在校验之前，否则 `"   "` 已通过 `minLength` 校验（第 4 章）。
4. `onSend` 对所有响应（包括错误响应）都执行；`onResponse` 在响应发出后运行，适合指标、慢请求日志（第 4、10 章）。

### ③ JSON Schema 校验 params/querystring/headers/body；用 response schema 控制输出形状并避免意外泄露字段

**问题**

1. Fastify 按什么顺序校验四个部分？
2. 说出 Fastify Ajv 的四个默认配置各自对数据做了什么。
3. 为什么 headers schema 不应设置 `additionalProperties: false`？
4. 只声明了 `200` 响应 schema 的路由返回了 201，会发生什么？

**动手验证**：`curl` 第 3、8、9 步；运行 `tasks.test.ts` 中“响应 schema 会丢弃未声明的字段”；运行第 7 章的序列化实验。

**参考判断**

1. params → body → querystring → headers，第一个失败即停止（第 5 章）。
2. `coerceTypes: 'array'` 转换类型（含 body）；`useDefaults` 补默认值；`removeAdditional` 在 `additionalProperties: false` 时移除多余字段；`allErrors: false` 只报第一个错误（第 5 章）。
3. 每个请求都带大量通用请求头，会被移除或导致校验失败（第 5 章）。
4. 未声明的状态码不经过序列化过滤，对象被原样 `JSON.stringify`，内部字段全部泄露（第 7 章）。

### ④ TypeBox 的 Type、Static、Optional、Union、Literal、引用与可复用 schema；类型推断与运行时 schema 同源

**问题**

1. `Type.Optional` 改变了生成的 JSON Schema 的哪一部分？
2. 状态枚举为什么用 `Type.Enum` 而不是 `Union` + `Literal`？什么时候用 `Literal`？
3. 可为 null 的字段为什么不用 `Type.Union([Type.String(), Type.Null()])`？
4. `Type.Ref('Task')` 的 `Static` 是什么？TaskHub 怎样解决？
5. 举出三处“类型与运行时”的落差。

**动手验证**：在任意路由里故意写错 `request.body` 的用法或 `reply.send` 的参数，运行 `npm run typecheck`。

**参考判断**

1. 让属性不进入父对象的 `required`，推断类型变成 `?:`（第 6 章）。
2. `Enum` 生成 `{ enum }`，错误信息只有一条、文档更清晰；`Union<Literal>` 生成 `anyOf` + `const`，错误冗长。单个固定值（如 `status: 'ok'`）用 `Literal`；真正的多结构联合用 `Union`（第 6 章）。
3. 在 Fastify 默认的类型转换下，`anyOf` 的 string 分支会把 `null` 转成 `""`；TaskHub 用 `Nullable()` 生成 type 数组（第 5、6 章）。
4. `unknown`；用 `ref()` 工具函数（`Type.Unsafe<Static<T>>(Type.Ref(id))`）把类型接回来（第 6 章）。
5. `default` 只在运行时生效；Ajv 的类型转换与字段移除；`Type.Ref` 推断为 `unknown`；另外 `Pick/Omit/Partial` 会丢失对象选项（第 6 章）。

### ⑤ schema `$id`、复用与封装范围；区分结构校验和需要访问数据库的业务规则

**问题**

1. JS 常量复用与 `$id` + `$ref` 复用分别适合什么？
2. 在插件 A 里 `addSchema`、在兄弟插件 B 里引用，会发生什么？
3. 判断以下规则的归属：`title` 最长 120 字；指派人必须存在；同一个人不能有同名任务；PATCH 至少传一个字段；已完成的任务不能改标题。
4. 为什么不能用 Ajv 的 `$async` 在校验阶段查库？

**动手验证**：运行第 8 章的封装实验；运行 `task-service.test.ts`。

**参考判断**

1. 字段级小规则用常量（内联）；对外有名字的实体与通用结构用 `$id`（在 OpenAPI 中成为命名模型）（第 8 章）。
2. 启动失败：`FST_ERR_SCH_VALIDATION_BUILD ... can't resolve reference`（第 8 章）。
3. 结构：120 字、至少一个字段；业务：指派人存在、同名冲突、已完成不能改标题（第 8 章）。
4. 校验发生在授权之前，任何人都能触发数据库查询，存在拒绝服务风险（Fastify 文档警告）；而且错误只能是 400，无法表达 409/422 等语义（第 5、8 章）。

### ⑥ 统一错误处理：业务错误、校验错误、未授权、禁止访问、资源不存在、冲突、限流和未知错误

**问题**

1. 这八类错误分别从哪里产生，错误处理器如何识别？
2. 错误处理器为什么必须用 `fp` 注册？
3. 为什么 4xx 的框架错误也不透传原始 `message`？
4. `setErrorHandler` 处理不到哪些情况？TaskHub 怎么处理 404 路由？

**动手验证**：`curl` 第 6~14 步；运行 `errors.test.ts`。

**参考判断**

1. 见第 9 章 9.6 节的表格：`AppError`（业务、401、403、404、409、412、422）、`error.validation`（校验）、`statusCode === 429`（限流）、`FST_ERR_*`（框架）、其他（未知，500）。
2. 错误处理器是封装的，不用 `fp` 只对插件自己的空作用域生效（第 9 章）。
3. Fastify 文档提醒：状态码低于 500 并不保证 message 可以安全公开（第 9 章）。
4. 未匹配的路由、`onResponse` 中的错误、流式响应中的错误；404 路由由 `setNotFoundHandler` 抛出 `AppError('ROUTE_NOT_FOUND')`，再进入统一的错误处理器（第 9 章）。

### ⑦ HTTP 状态码、分页/排序契约、请求 ID、稳定错误 code 与可安全暴露的信息

**问题**

1. 401/403、403/404、400/422、409/412 各怎么选？
2. 分页契约要写明哪些内容？为什么排序要有第二排序键、排序字段要有白名单？
3. 请求 ID 是怎么生成、传播、出现在哪些地方的？为什么不直接用 `requestIdHeader`？
4. 错误码 `code` 的演进规则是什么？
5. 列出五样不能出现在错误响应里的信息。

**动手验证**：`curl` 第 2、9、11、12、13 步；运行“分页与排序契约”和“请求 ID”测试。

**参考判断**

1. 见第 9 章 9.2 节。
2. 参数、默认值、上限、响应结构、排序稳定性、排序白名单；没有第二排序键时相同值的顺序不确定，翻页会重复或遗漏；白名单防止注入与按内部字段排序（第 10 章）。
3. `genReqId` 沿用合法的上游 `x-request-id` 或生成 UUID；出现在响应头、错误响应体、每条日志中。`requestIdHeader` 不校验内容，调用方可以写入任意值（第 10 章）。
4. 发布后只增不改，改名/删除/改语义都是破坏性变更（第 9 章）。
5. 例如：stack、原始异常消息、SQL/表名、内网地址、schemaPath、用户是否存在的区别提示（第 9 章）。

### ⑧ @fastify/swagger 的注册顺序、schema 到 OpenAPI 的映射、API 版本与破坏性变更

**问题**

1. `@fastify/swagger` 为什么必须在路由之前注册？注册晚了会怎样？
2. params、querystring、headers、body、response、`$id` 共享 schema 分别映射到 OpenAPI 的什么位置？
3. URL 中的 `/v1` 与 `info.version` 有什么区别？
4. 判断：新增可选查询参数；请求字段 `maxLength` 从 120 改为 50；响应新增字段；响应枚举新增值；删除错误码。

**动手验证**：`npm run openapi:export`，打开 `openapi.json`；运行 `openapi.test.ts`。

**参考判断**

1. 它通过 `onRoute` 钩子收集路由；晚于路由注册时这些路由不会出现在文档里，且不会报错（第 11 章）。
2. `parameters`（in: path/query/header）、`requestBody`、`responses`、`components.schemas` + `$ref`（第 11 章）。
3. `/v1` 是 API 主版本，只有破坏性变更才升级；`info.version` 是文档版本，兼容的新增也会变化（第 11 章）。
4. 兼容；破坏性；通常兼容（客户端须忽略未知字段）；可能破坏（穷举处理的客户端）；破坏性（第 11 章）。

### ⑨ Swagger UI 与 Scalar 都是 API reference 前端，选择其一即可；文档环境应限制或只暴露安全信息

**问题**

1. @fastify/swagger 与 Scalar/Swagger UI 的分工是什么？为什么不需要同时挂两个？
2. TaskHub 在生产环境的默认文档策略是什么？需要开放时怎么保护？
3. 列出四样不应出现在 API 文档里的东西。
4. 为什么在生产文档页面上“试一试”是危险的？

**动手验证**：`npm run dev` 打开 `/docs`；`DOCS_UI=swagger-ui npm run dev` 对比；设置 `DOCS_USERNAME`/`DOCS_PASSWORD` 后再访问；运行“API Reference 页面”测试。

**参考判断**

1. 前者生成 OpenAPI 文档，后两者渲染同一份文档，功能重叠（第 12 章）。
2. 生产默认 `DOCS_UI=none`，只注册生成器不挂页面；开放时用 `hooks`/`uiHooks` 加 Basic Auth（HTTPS 下），或放到 SSO 之后（第 12 章）。
3. 内部接口、内部字段、内网地址、真实/示例 token、真实用户数据（第 12 章）。
4. 页面会用你填写的 token 向真实服务器发送真实请求，可能修改生产数据（第 12 章）。

### ⑩ Fastify 内置 Pino 日志、子 logger、结构化字段、日志级别、敏感字段 redact

**问题**

1. 为什么请求处理中要用 `request.log` 而不是 `app.log`？
2. `request.log.info({ taskId }, 'task created')` 比模板字符串好在哪里？
3. TaskHub 的日志里 `userId` 是怎么出现的？
4. `*.apiToken` 能隐藏哪些位置的 `apiToken`，不能隐藏哪些？
5. 为什么 4xx 记为 info？

**动手验证**：运行第 13 章的 redact 实验；运行 `logging.test.ts`。

**参考判断**

1. `request.log` 绑定了 `requestId`，日志才能关联到请求（第 13 章）。
2. 消息固定可检索计数，数据成为可过滤聚合的字段（第 13 章）。
3. 认证成功后 `request.log = request.log.child({ userId })`（第 4、13 章）。
4. 只能隐藏第二层（如 `user.apiToken`）；顶层、更深层、数组元素中的、以及消息字符串里的都不能（第 13 章）。
5. 4xx 是客户端造成的正常现象，记为 error 会淹没真正的故障告警（第 9、13 章）。

### ⑪ 通过 `app.inject` 进行路由集成测试；测试插件装配和请求/响应行为

**问题**

1. `inject` 测试覆盖了什么，跳过了什么？
2. 为什么每个测试都创建一个新实例，并在 `afterEach` 中关闭？
3. 怎样测试“未知错误不会泄露”？
4. 举出三个“负面断言”的例子。
5. 哪些行为必须用 inject 以外的方式验证？

**动手验证**：`npm test`；按第 14 章练习自己补两个测试。

**参考判断**

1. 覆盖完整的 Fastify 处理流程（路由、hook、校验、序列化、错误处理），只跳过 TCP 网络层（第 14 章）。
2. 内存数据与限流状态挂在实例上，新实例保证测试独立；`close()` 触发 `onClose` 并避免进程挂起（第 14 章）。
3. 在 `ready` 之前给测试实例追加一个抛错的路由，断言响应只有通用信息、日志里有完整错误（第 9、14 章）。
4. 响应键集合完全相等；`not.toHaveProperty('internalNote')`；响应体不包含内网地址；日志不包含 token（第 14 章）。
5. 真实监听与网络配置、反向代理与真实 IP、真实数据库的约束与并发、文档页面在浏览器中的渲染（第 14 章）。

## 15.4 扩展练习

这些练习没有配套答案代码，用来检验你能否独立运用本书内容。每个都请先写测试。

1. **游标分页**：新增 `GET /v1/tasks/feed?limit=20&cursor=...`，按 `-createdAt` 排序，返回 `{ items, nextCursor }`。要求：`cursor` 是不透明的字符串，格式错误返回 400；翻页期间插入新任务不会导致重复。
2. **幂等创建**：`POST /v1/tasks` 支持可选的 `Idempotency-Key` 请求头（headers schema 限制长度与字符集）。同一用户、同一 key 在 24 小时内重复请求，返回第一次的结果（同样的状态码与 body），不重复创建。
3. **引入 `/v2`**：v2 中把 `assigneeId` 改为 `assignees: string[]`（多人负责）。v1 保持不变并标记 `deprecated`、加上 `Sunset` 响应头。用 `@fastify/swagger` 的 `decorator` 选项生成两份文档。
4. **换上真实数据库**：用本仓库 `drizzle-orm-tutorial` 中的方法，把 `memory-store.ts` 换成 Postgres 实现，保持方法签名不变。把“同名任务”改为由唯一约束保证，并把数据库的唯一冲突错误转换成 `AppError('TASK_TITLE_CONFLICT', { cause })`。路由、service、大部分测试应当不需要修改。
5. **Problem Details**：把错误响应改为 RFC 9457 格式（`application/problem+json`），`code` 映射到 `type`。注意这是一次破坏性变更——它应该出现在哪个 API 版本里？

## 15.5 上线前检查清单

**输入与输出**

- [ ] 每个路由都有 params/querystring/headers/body 中需要的 schema，body 对象设置了 `additionalProperties: false`
- [ ] 每个会返回的状态码都声明了响应 schema（包括 201、204 和错误状态码）
- [ ] 列表接口有分页上限、稳定排序、排序白名单
- [ ] 可为 null 的字段在类型转换下行为正确（有测试）

**错误**

- [ ] 全局错误处理器与 not-found 处理器已用 `fp` 注册
- [ ] 未知错误只返回通用信息，日志记录完整错误
- [ ] 错误码目录已评审，变更遵守兼容规则

**安全**

- [ ] 认证在 `onRequest`，授权在校验之后
- [ ] 看不到的资源返回 404
- [ ] 限流已配置，多实例时使用共享存储；`trustProxy` 与实际代理链一致
- [ ] 请求 ID 只在可信网关后沿用外部值，并校验格式

**文档**

- [ ] @fastify/swagger 在所有路由之前注册
- [ ] 生产环境文档默认关闭，或受访问控制保护（HTTPS）
- [ ] 文档中没有内部路由、内部字段、内网地址、真实凭证
- [ ] CI 导出 `openapi.json` 并检查破坏性变更

**日志**

- [ ] 生产环境输出 JSON 到 stdout，级别可通过环境变量调整
- [ ] `req` 序列化器为白名单，redact 覆盖已知敏感路径
- [ ] 4xx 为 info，5xx 为 error，健康检查不产生 info 日志

**测试与运维**

- [ ] `npm run typecheck` 与 `npm test` 在 CI 中运行
- [ ] 测试覆盖插件装配、错误模型、响应字段（含负面断言）、日志
- [ ] 收到 SIGTERM 时优雅停机，`onClose` 释放资源

## 15.6 下一步

- 认证：[@fastify/jwt](https://github.com/fastify/fastify-jwt)、[@fastify/session](https://github.com/fastify/session)
- 安全响应头与 CORS：[@fastify/helmet](https://github.com/fastify/fastify-helmet)、[@fastify/cors](https://github.com/fastify/fastify-cors)
- 自动加载插件与路由：[@fastify/autoload](https://github.com/fastify/fastify-autoload)
- 可观测性：Fastify 的 [diagnostics channel hooks](https://fastify.dev/docs/latest/Reference/Hooks/#diagnostics-channel-hooks) 与 OpenTelemetry
- 数据层：本仓库的 [Drizzle ORM 教程](../drizzle-orm-tutorial/README.md)

回到[目录](./README.md)。
