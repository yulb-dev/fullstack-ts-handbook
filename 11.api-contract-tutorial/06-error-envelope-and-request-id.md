# 第 6 章：统一错误 envelope 与 requestId

> 本章目标：设计一种所有接口共用的错误结构；把 Fastify/Ajv 的校验错误翻译成「表单字段路径」；让每个请求都有一个贯穿前端、网关、服务端日志的 requestId；划清「什么进响应、什么只进日志」的边界；最后在客户端把各种错误（包括不符合契约的错误）规整成一种类型。
>
> 对应核心概念：**④ 统一错误 envelope、requestId、验证错误字段映射。**
> 对应通过标准：**错误可被 UI 解释，同时服务器端日志保留排查所需上下文，不泄露内部细节。**

---

## 6.1 没有统一错误结构时的样子

先看看「各写各的」会得到什么。同一个项目里，不同接口、不同中间件、不同框架层返回的错误可能是：

```json
{ "statusCode": 400, "code": "FST_ERR_VALIDATION", "error": "Bad Request", "message": "body/title must NOT have fewer than 1 characters" }
{ "ok": false, "errors": [{ "path": ["title"], "message": "已存在" }] }
{ "message": "Forbidden" }
"Internal Server Error"
<html><body><h1>502 Bad Gateway</h1></body></html>
```

前端的错误处理代码会变成这样：

```ts
const msg =
  json?.error?.message ??
  json?.message ??
  json?.errors?.[0]?.message ??
  "请求失败";
```

更糟糕的是，第一条把内部的校验信息（`body/title must NOT have...`）直接展示给了用户，而 500 的那条什么排查线索都没给。

---

## 6.2 设计错误 envelope

我们的目标：

1. **UI 能解释**：有机器可读的错误码，有可以直接展示的中文说明，有字段级错误；
2. **能排查**：每个错误都带 requestId，用户截图或复制给客服，开发者能在日志里精确找到这次请求；
3. **不泄露**：响应里绝不出现堆栈、SQL、内部 IP、第三方服务的原始报错。

**`apps/api/src/contract/common.ts`**（错误部分）：

```ts
export const ErrorCode = Type.Enum(
  [
    "VALIDATION_FAILED", // 400 契约校验失败（有 fields）
    "BAD_REQUEST", // 400/413/415 协议层错误：JSON 语法错、媒体类型不对、体积过大
    "UNAUTHENTICATED", // 401
    "FORBIDDEN", // 403 权限不足
    "CSRF_REJECTED", // 403 来源或 CSRF token 不对（第 8 章）
    "NOT_FOUND", // 404
    "CONFLICT", // 409 业务冲突（通常有 fields）
    "IDEMPOTENCY_KEY_REUSED", // 422 幂等键被用于不同请求（第 11 章）
    "PRECONDITION_FAILED", // 412 版本冲突（第 11 章）
    "PRECONDITION_REQUIRED", // 428 缺少 If-Match
    "RATE_LIMITED", // 429
    "INTERNAL", // 500
  ],
  {
    $id: "ErrorCode",
    description: "机器可读错误码。客户端遇到未知值时必须按 message 兜底展示",
  },
);

export const FieldError = Type.Object(
  {
    in: Type.Enum(["body", "query", "params", "headers"]),
    path: Type.String({
      description:
        "点号路径，例如 title、tags.0；与 React Hook Form 的字段名一致",
    }),
    rule: Type.String({
      description: "失败的规则，例如 minLength、required、format、unique",
    }),
    message: Type.String(),
  },
  { $id: "FieldError", additionalProperties: false },
);

export const ErrorResponse = Type.Object(
  {
    error: Type.Object(
      {
        code: ref(ErrorCode),
        message: Type.String({
          description: "可直接展示给用户的说明，不含内部细节",
        }),
        requestId: Type.String({
          description: "与响应头 X-Request-Id 相同，用于排查",
        }),
        fields: Type.Optional(Type.Array(ref(FieldError))),
      },
      { additionalProperties: false },
    ),
  },
  { $id: "ErrorResponse", additionalProperties: false },
);
```

一个典型的校验错误响应：

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "提交的数据有误，请检查标出的字段",
    "requestId": "web-3f1c9a7e-8b2d-4c55-9f0e-1a2b3c4d5e6f",
    "fields": [
      {
        "in": "body",
        "path": "title",
        "rule": "minLength",
        "message": "至少 1 个字符"
      }
    ]
  }
}
```

### 每个字段为什么这样设计

| 字段                | 设计理由                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| 外层 `error` 包一层 | 成功响应是资源本身（`Task`），错误响应是 `{ error }`。两者形状完全不同，前端不会把错误误当成数据              |
| `code`（枚举）      | UI 逻辑按 `code` 分支，而不是解析 `message` 字符串。枚举进契约，前端有类型提示                                |
| `message`           | 已经是「人话」。前端可以直接展示，也可以按 `code` 用自己的文案                                                |
| `requestId`         | 排查用。和响应头 `X-Request-Id` 相同，即使响应体丢失也能从头里拿到                                            |
| `fields[].in`       | 区分错误发生在 body 还是 query/headers/params。只有 `body` 的错误应该回填到表单                               |
| `fields[].path`     | **点号路径**（`title`、`tags.0.name`），与 React Hook Form 的字段名写法一致，前端可以直接 `setError(path, …)` |
| `fields[].rule`     | 失败的规则名。前端想自定义文案时，可以按 `rule` 映射（`minLength` → 「太短了」）                              |

### 和 RFC 9457（Problem Details）的关系

HTTP 有一个错误格式标准 RFC 9457（取代了 RFC 7807），格式是 `application/problem+json`：

```json
{
  "type": "https://example.com/probs/out-of-credit",
  "title": "余额不足",
  "status": 403,
  "detail": "...",
  "instance": "/account/12345"
}
```

它允许扩展字段，所以你完全可以把我们的 `code`、`requestId`、`fields` 作为扩展成员放进 Problem Details。本教程选择更简单的自定义结构，原因是：教学上更直观；生成的前端类型更简单（openapi-fetch 对 `application/json` 的支持最直接）。**选哪个格式不重要，重要的是全项目只有一种，并且写进契约。** 如果你的组织已有规范（比如网关统一使用 Problem Details），就遵循它。

---

## 6.3 把 Ajv 错误翻译成字段路径

Fastify 校验失败时，抛出的错误对象带两个关键属性：

- `error.validationContext`：`"body"`、`"querystring"`、`"params"` 或 `"headers"`；
- `error.validation`：Ajv 错误数组，每一项形如：

```js
{ instancePath: "/title", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" }
{ instancePath: "",       keyword: "required",  params: { missingProperty: "title" }, message: "must have required property 'title'" }
{ instancePath: "",       keyword: "additionalProperties", params: { additionalProperty: "status" }, message: "must NOT have additional properties" }
```

两个需要处理的细节：

1. `instancePath` 是 **JSON Pointer**（`/tags/0/name`），要转成点号路径（`tags.0.name`）。JSON Pointer 里的 `~1` 表示 `/`，`~0` 表示 `~`，要还原；
2. `required` 和 `additionalProperties` 的 `instancePath` 指向**父对象**（空字符串表示根），真正的字段名在 `params` 里。如果不处理，「缺少 title」会被报告在路径 `""` 上，前端无法定位。

**`apps/api/src/plugins/errors.ts`**（前半部分）：

```ts
import type {
  FastifyError,
  FastifyInstance,
  FastifySchemaValidationError,
} from "fastify";
import fp from "fastify-plugin";
import type { ErrorResponse, FieldError } from "../contract/common";
import { AppError } from "../domain/errors";

const LOCATION: Record<string, FieldError["in"]> = {
  body: "body",
  querystring: "query",
  params: "params",
  headers: "headers",
};

/** JSON Pointer（/tags/0/name）→ 点号路径（tags.0.name），与 React Hook Form 字段名对齐 */
function pointerToPath(pointer: string): string[] {
  if (!pointer) return [];
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** Ajv 的英文 message 面向开发者；这里给出面向用户的中文兜底文案 */
function humanMessage(v: FastifySchemaValidationError): string {
  const p = v.params as Record<string, unknown>;
  switch (v.keyword) {
    case "required":
      return "必填";
    case "minLength":
      return `至少 ${p.limit} 个字符`;
    case "maxLength":
      return `最多 ${p.limit} 个字符`;
    case "minimum":
      return `不能小于 ${p.limit}`;
    case "maximum":
      return `不能大于 ${p.limit}`;
    case "format":
      return `格式不正确（应为 ${p.format}）`;
    case "enum":
      return "取值不在允许范围内";
    case "type":
      return `类型不正确（应为 ${p.type}）`;
    case "additionalProperties":
      return "不允许提交该字段";
    case "pattern":
      return "格式不正确";
    default:
      return v.message ?? "不合法";
  }
}

export function toFieldErrors(error: FastifyError): FieldError[] {
  const where = LOCATION[error.validationContext ?? "body"] ?? "body";
  return (error.validation ?? []).map((v) => {
    const segments = pointerToPath(v.instancePath);
    const p = v.params as Record<string, unknown>;
    // required / additionalProperties 的 instancePath 指向父对象，字段名在 params 里
    if (v.keyword === "required" && typeof p.missingProperty === "string") {
      segments.push(p.missingProperty);
    }
    if (
      v.keyword === "additionalProperties" &&
      typeof p.additionalProperty === "string"
    ) {
      segments.push(p.additionalProperty);
    }
    return {
      in: where,
      path: segments.join("."),
      rule: v.keyword,
      message: humanMessage(v),
    };
  });
}
```

> 注意 `humanMessage` 没有把 Ajv 的 `params.pattern`（正则表达式本身）展示给用户。正则是实现细节，用户看不懂，还可能暴露校验逻辑。

---

## 6.4 统一错误出口：`setErrorHandler`

所有错误——校验失败、业务异常、框架错误、未知 bug——都经过同一个处理器，输出同一种结构。

先定义业务层抛出的「可预期错误」，**`apps/api/src/domain/errors.ts`**：

```ts
import type { ErrorCode, FieldError } from "../contract/common";

/**
 * 业务层抛出的「可预期错误」。
 * - statusCode / code / message 会进入统一错误 envelope 返回给客户端；
 * - message 必须是可以给用户看的话，不放 SQL、堆栈、内部 ID；
 * - 排查用的细节放在 logContext，只进日志，不进响应。
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly options: {
      fields?: FieldError[];
      logContext?: Record<string, unknown>;
      headers?: Record<string, string>;
    } = {},
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthenticated = () =>
  new AppError(401, "UNAUTHENTICATED", "请先登录");
export const forbidden = (message = "你没有执行该操作的权限") =>
  new AppError(403, "FORBIDDEN", message);
export const notFound = (resource: string) =>
  new AppError(404, "NOT_FOUND", `${resource}不存在或你无权访问`);
export const fieldConflict = (path: string, message: string) =>
  new AppError(409, "CONFLICT", message, {
    fields: [{ in: "body", path, rule: "unique", message }],
  });
```

`AppError` 把一个错误拆成两半：**`message` / `fields` 给用户**，**`logContext` 给开发者**。例如版本冲突时（第 11 章）：

```ts
throw new AppError(
  412,
  "PRECONDITION_FAILED",
  "任务已被其他人修改，请查看最新内容后再保存",
  {
    headers: { etag: `"${task.version}"` },
    logContext: { expectedVersion, currentVersion: task.version }, // 只进日志
  },
);
```

然后是错误处理器（**`apps/api/src/plugins/errors.ts`** 后半部分）：

```ts
function envelope(
  requestId: string,
  code: ErrorResponse["error"]["code"],
  message: string,
  fields?: FieldError[],
): ErrorResponse {
  return { error: { code, message, requestId, ...(fields ? { fields } : {}) } };
}

/**
 * 统一错误出口：任何错误都变成同一种 envelope。
 * 响应里只放「用户能理解、调用方能处理」的信息；排查细节只进日志。
 */
export const errorHandlerPlugin = fp(async function errorHandler(
  app: FastifyInstance,
) {
  app.setErrorHandler<FastifyError | AppError>((error, request, reply) => {
    const requestId = request.id;

    // ① 契约校验失败（Fastify + Ajv 按 route schema 自动校验）
    if ("validation" in error && error.validation) {
      const fields = toFieldErrors(error);
      request.log.info({ fields }, "request validation failed");
      return reply
        .code(400)
        .send(
          envelope(
            requestId,
            "VALIDATION_FAILED",
            "提交的数据有误，请检查标出的字段",
            fields,
          ),
        );
    }

    // ② 业务层主动抛出的可预期错误
    if (error instanceof AppError) {
      const level = error.statusCode >= 500 ? "error" : "info";
      request.log[level](
        { code: error.code, ...error.options.logContext },
        error.message,
      );
      if (error.options.headers) reply.headers(error.options.headers);
      return reply
        .code(error.statusCode)
        .send(
          envelope(requestId, error.code, error.message, error.options.fields),
        );
    }

    // ③ Fastify 自身的 4xx：JSON 语法错误、媒体类型不支持、请求体过大……
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      request.log.info({ err: error }, "client error");
      const code = status === 429 ? "RATE_LIMITED" : "BAD_REQUEST";
      const message =
        status === 429 ? "请求太频繁，请稍后再试" : "请求格式不正确";
      return reply.code(status).send(envelope(requestId, code, message));
    }

    // ④ 其余都是 bug 或基础设施故障：完整错误进日志，响应只给 requestId
    request.log.error({ err: error }, "unhandled error");
    return reply
      .code(500)
      .send(envelope(requestId, "INTERNAL", "服务器开小差了，请稍后重试"));
  });

  app.setNotFoundHandler((request, reply) => {
    return reply
      .code(404)
      .send(envelope(request.id, "NOT_FOUND", "接口不存在"));
  });
});
```

四个分支的顺序是有讲究的：

| 分支         | 典型来源                                                            | 日志级别                      | 响应                       |
| ------------ | ------------------------------------------------------------------- | ----------------------------- | -------------------------- |
| ① 校验错误   | Ajv                                                                 | `info`                        | 400 + 字段错误             |
| ② `AppError` | 业务代码主动抛出                                                    | 4xx 用 `info`，5xx 用 `error` | 对应状态码 + 业务文案      |
| ③ 框架 4xx   | JSON 语法错误（400）、Content-Type 不支持（415）、请求体过大（413） | `info`                        | 原状态码 + 通用文案        |
| ④ 其他一切   | 未捕获异常、数据库连接断开、代码 bug                                | **`error`**                   | 500 + 通用文案 + requestId |

**日志级别是有意义的**：4xx 是「客户端的问题」，记 `info` 方便统计但不触发告警；5xx 是「我们的问题」，记 `error`，应该触发告警、被人看到。如果把所有 4xx 都记成 `error`，告警会被淹没，真正的故障反而没人注意。

**分支 ③ 的文案为什么不直接用 `error.message`？** Fastify 的内置错误信息通常是安全的（如 `Unsupported Media Type: text/plain`），但它们是英文的、面向开发者的，而且将来升级 Fastify 时措辞可能变化。统一用我们自己的文案更可控。

> `setNotFoundHandler` 同样重要：一个拼错的 URL 也应该返回统一 envelope，而不是 Fastify 默认的 `{"message":"Route GET:/api/v1/nope not found",...}`。

---

## 6.5 requestId：一根贯穿全链路的线

用户报告「我点了创建，提示服务器出错了」。没有 requestId 时，你只能按时间范围翻日志，在成百上千条请求里猜是哪一条。有了 requestId，一次搜索就能精确定位。

### 生成与采纳

**`apps/api/src/plugins/request-id.ts`**：

```ts
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

// 只接受「看起来像 ID」的外部 requestId，防止日志注入与超长头
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * 生成本次请求的 requestId：
 * - 上游（网关 / 前端）已经带了合法的 X-Request-Id，就沿用，便于全链路串联；
 * - 否则由服务端生成 UUID。
 */
export function genReqId(req: IncomingMessage): string {
  const incoming = req.headers["x-request-id"];
  if (typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming)) {
    return incoming;
  }
  return randomUUID();
}
```

为什么要采纳上游的 ID？一个请求可能经过：浏览器 → CDN → 负载均衡 → 网关 → Fastify。如果每一层都自己生成 ID，你就得在四份日志里分别找。约定「上游有就沿用」，整条链路共享同一个 ID。

为什么要校验格式？`X-Request-Id` 是**客户端可控的**。如果原样写进日志，攻击者可以发送 `X-Request-Id: abc\n{"level":50,"msg":"fake alert"}` 来伪造日志行，或者发一个 1 MB 的头撑爆日志存储。只接受「8~64 位字母数字和 `._-`」的值，其余一律重新生成。

> Fastify 5 也有一个 `requestIdHeader` 选项可以直接读取请求头，但它**不做任何校验**就使用头的值。所以我们关掉它（Fastify 5 默认就是关闭的），改用自定义的 `genReqId`。

### 注册到 Fastify

```ts
const app = Fastify({
  genReqId,
  // 日志里的请求标识字段叫 requestId，与错误 envelope 里的字段同名，方便检索
  logController: new LogController({ requestIdLogLabel: "requestId" }),
  // ……
});

// 每个响应都带上 X-Request-Id，前端报错时可以展示给用户 / 上报
app.addHook("onSend", async (request, reply) => {
  reply.header("x-request-id", request.id);
});
```

> Fastify 5.12 起，顶层的 `requestIdLogLabel` 选项已被标记为弃用（启动时会打印 `FSTDEP024` 警告），推荐通过 `LogController` 配置。

现在每一条日志都自动带上 `requestId` 字段：

```json
{"level":30,"time":1792680000000,"requestId":"web-3f1c9a7e-…","req":{"method":"POST","url":"/api/v1/projects/…/tasks"},"msg":"incoming request"}
{"level":30,"time":1792680000012,"requestId":"web-3f1c9a7e-…","fields":[{"in":"body","path":"title",…}],"msg":"request validation failed"}
{"level":30,"time":1792680000013,"requestId":"web-3f1c9a7e-…","res":{"statusCode":400},"responseTime":13.2,"msg":"request completed"}
```

### 前端也生成 requestId

第 4 章的 api-client 中间件会给每个请求加上 `x-request-id: web-<uuid>`。好处是：**即使请求根本没到达服务器**（断网、被代理拦截、超时），前端的错误上报里也有一个 ID，可以和网关日志对照。服务端看到这个合法的 ID 就会沿用它。

---

## 6.6 响应与日志的边界

这是「错误可被 UI 解释，同时服务器端日志保留排查所需上下文，不泄露内部细节」的核心。我们用一个测试把它钉死（**`apps/api/test/errors.test.ts`**）：

```ts
beforeAll(async () => {
  ctx = await createTestApp();
  // 测试专用路由：模拟一个带敏感信息的意外异常（buildApp 后、ready 前仍可加路由）
  ctx.app.get("/boom", async () => {
    throw new Error("connect ECONNREFUSED 10.0.3.7:5432 password=hunter2");
  });
});

it("500：响应只给通用文案和 requestId；完整错误进日志，且能用 requestId 检索", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/boom" });
  expect(res.statusCode).toBe(500);
  const body = res.json();
  expect(body).toEqual({
    error: {
      code: "INTERNAL",
      message: "服务器开小差了，请稍后重试",
      requestId: res.headers["x-request-id"],
    },
  });
  expect(res.body).not.toContain("ECONNREFUSED");
  expect(res.body).not.toContain("hunter2");

  const entry = ctx.logs.find(
    (l) => l.requestId === body.error.requestId && l.msg === "unhandled error",
  );
  expect(entry).toBeDefined();
  expect(JSON.stringify(entry)).toContain("ECONNREFUSED");
});
```

测试同时断言了两件事：**响应里没有**内部信息，**日志里有**完整错误并且能用 requestId 检索到。测试用的日志收集器（`test/helpers.ts`）把 pino 的输出写进一个数组：

```ts
export function memoryLogger() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const line of String(chunk).split("\n").filter(Boolean))
        lines.push(JSON.parse(line));
      cb();
    },
  });
  return { lines, logger: { level: "info", stream } };
}
```

### 什么能进响应，什么只能进日志

| 信息                                 | 响应                           | 日志               |
| ------------------------------------ | ------------------------------ | ------------------ |
| 错误码、用户可读说明、requestId      | ✅                             | ✅                 |
| 哪个字段错了、违反了什么规则         | ✅                             | ✅                 |
| 堆栈、异常类名                       | ❌                             | ✅                 |
| SQL 语句、约束名、数据库错误码       | ❌                             | ✅                 |
| 内部服务地址、第三方原始报错         | ❌                             | ✅                 |
| 期望版本 / 当前版本等排查数据        | ❌（通过 ETag 头给出必要信息） | ✅（`logContext`） |
| Cookie、CSRF token、密码、完整请求体 | ❌                             | ❌                 |

最后一行同样重要：**日志也不是垃圾桶**。Fastify 默认的请求序列化器只记录 `method`、`url`、`host`、`remoteAddress` 等少量字段，不记录请求头和请求体。我们又加了一层 `redact` 兜底，防止有人手写日志时带出敏感值：

```ts
logger: {
  level: opts.config.logLevel,
  // 默认的 req 序列化器不输出请求头；这里兜底，防止手写日志时带出敏感值
  redact: ["req.headers.cookie", "req.headers['x-csrf-token']", "headers.cookie"],
},
```

> **一个需要注意的地方**：数据库错误（`DrizzleQueryError`）的 `message` 里包含完整 SQL 和**参数值**。比如插入失败时，日志里会出现用户提交的标题、描述。如果你的业务字段包含个人敏感信息（手机号、身份证），就要考虑在记录前脱敏，或者只记录错误码和约束名。

---

## 6.7 客户端：把一切错误规整成两种类型

服务端承诺了统一 envelope，但客户端**不能假设**每个错误响应都符合契约：

- 网关（Nginx、负载均衡）返回的 502/504 是 HTML；
- 新版服务端可能返回旧版前端不认识的错误码；
- 请求可能根本没拿到响应（断网）。

**`packages/api-client/src/errors.ts`**：

```ts
import type { components } from "./generated/openapi";

export type ErrorCode = components["schemas"]["ErrorCode"];
export type FieldError = components["schemas"]["FieldError"];
type ErrorResponse = components["schemas"]["ErrorResponse"];

/**
 * 客户端「认识」的错误码清单。
 * `satisfies Record<ErrorCode, true>` 要求它与契约里的枚举一一对应：
 * 服务端新增或删除错误码 → 重新生成类型 → 这里编译失败，提醒你更新 UI 映射。
 */
const KNOWN_CODES = {
  VALIDATION_FAILED: true,
  BAD_REQUEST: true,
  UNAUTHENTICATED: true,
  FORBIDDEN: true,
  CSRF_REJECTED: true,
  NOT_FOUND: true,
  CONFLICT: true,
  IDEMPOTENCY_KEY_REUSED: true,
  PRECONDITION_FAILED: true,
  PRECONDITION_REQUIRED: true,
  RATE_LIMITED: true,
  INTERNAL: true,
} satisfies Record<ErrorCode, true>;

/** 服务端返回了 HTTP 错误（4xx/5xx） */
export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    readonly status: number,
    /** 不认识的码（新版服务端 / 网关返回的 HTML）一律是 UNKNOWN，UI 按 status 兜底 */
    readonly code: ErrorCode | "UNKNOWN",
    message: string,
    readonly requestId: string | null,
    readonly fields: FieldError[] = [],
    /** 429 / 503 的 Retry-After，换算成毫秒 */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

/** 请求根本没拿到 HTTP 响应：断网、DNS 失败、连接被重置、被 CORS 拦截…… */
export class NetworkError extends Error {
  override readonly name = "NetworkError";
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isErrorResponse(body: unknown): body is ErrorResponse {
  if (typeof body !== "object" || body === null || !("error" in body))
    return false;
  const e = (body as { error: unknown }).error;
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { code?: unknown }).code === "string" &&
    typeof (e as { message?: unknown }).message === "string"
  );
}

export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

const FALLBACK_MESSAGE: Record<number, string> = {
  502: "服务暂时不可用，请稍后重试",
  503: "服务暂时不可用，请稍后重试",
  504: "服务器响应超时，请稍后重试",
};

/** 把任意错误响应规整成 ApiError；不信任响应体一定符合契约 */
export function toApiError(body: unknown, response: Response): ApiError {
  const headerRequestId = response.headers.get("x-request-id");
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
  if (isErrorResponse(body)) {
    const { code, message, requestId, fields } = body.error;
    return new ApiError(
      response.status,
      code in KNOWN_CODES ? code : "UNKNOWN",
      message,
      requestId ?? headerRequestId,
      Array.isArray(fields) ? fields : [],
      retryAfterMs,
    );
  }
  return new ApiError(
    response.status,
    "UNKNOWN",
    FALLBACK_MESSAGE[response.status] ?? `请求失败（HTTP ${response.status}）`,
    headerRequestId,
    [],
    retryAfterMs,
  );
}
```

几个设计要点：

1. **运行时检查形状**（`isErrorResponse`），而不是直接 `as ErrorResponse`。类型断言只骗得了编译器，骗不了网关返回的 HTML；
2. **未知错误码降级为 `UNKNOWN`**，而不是崩溃。服务端先上线新错误码、前端后上线，是完全正常的发布顺序（第 12 章的「向前兼容」）；
3. **`KNOWN_CODES` 用 `satisfies` 与契约绑定**，和第 5 章的枚举闸是同一个技巧。契约增删错误码时，这里编译失败，提醒你去更新 UI 映射；
4. **requestId 两处兜底**：优先用响应体里的，没有就用响应头的。网关的 502 页面虽然不是 JSON，但网关通常也会转发或生成 `X-Request-Id`；
5. **只有两种错误类型**：`ApiError`（拿到了 HTTP 响应）和 `NetworkError`（没拿到）。再加上原生的 `AbortError`（主动取消），UI 层只需要处理这三种情况。

这些行为都有测试（`packages/api-client/test/client.test.ts`）：

```ts
it("不认识的错误码 → UNKNOWN（新服务端 + 旧前端不会崩）", async () => {
  const { api } = clientWith(() =>
    json(409, {
      error: { code: "SOME_FUTURE_CODE", message: "新冲突", requestId: "r" },
    }),
  );
  const err = (await unwrap(api.GET("/api/v1/projects")).catch(
    (e) => e,
  )) as ApiError;
  expect(err.code).toBe("UNKNOWN");
  expect(err.message).toBe("新冲突");
});

it("网关返回 HTML 502 → UNKNOWN + 友好文案 + 响应头里的 requestId", async () => {
  const { api } = clientWith(
    () =>
      new Response("<html>Bad Gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html", "x-request-id": "gw-9" },
      }),
  );
  const err = (await unwrap(api.GET("/api/v1/projects")).catch(
    (e) => e,
  )) as ApiError;
  expect(err).toMatchObject({
    status: 502,
    code: "UNKNOWN",
    requestId: "gw-9",
  });
  expect(err.message).toBe("服务暂时不可用，请稍后重试");
});
```

---

## 6.8 字段错误 → React Hook Form

服务端的 `fields[].path` 和 RHF 的字段名都是点号路径，所以映射几乎是直接的。**`apps/web/src/lib/errors.ts`**（节选）：

```ts
/**
 * 把服务端的字段错误回填到 React Hook Form。
 * 只认「body 里、且表单确实有这个字段」的错误；其余的（例如 headers.idempotency-key）
 * 对用户没有意义，汇总到 root 让表单顶部展示。
 * 返回值：是否至少回填了一个字段。
 */
export function applyServerFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  formFields: readonly FieldPath<T>[],
): boolean {
  if (!(error instanceof ApiError) || error.fields.length === 0) return false;
  let applied = false;
  const leftovers: string[] = [];
  for (const field of error.fields) {
    const name = field.path as FieldPath<T>;
    if (field.in === "body" && formFields.includes(name)) {
      setError(
        name,
        { type: `server.${field.rule}`, message: field.message },
        { shouldFocus: !applied },
      );
      applied = true;
    } else {
      leftovers.push(`${field.path}：${field.message}`);
    }
  }
  if (leftovers.length > 0) {
    setError("root.server", { type: "server", message: leftovers.join("；") });
  }
  return applied;
}
```

和《可访问设计系统与复杂表单实战》第 8 章的 `applyServerErrors` 相比，这里多了两个保护：

1. **白名单 `formFields`**：只回填表单里真实存在的字段。如果服务端返回 `path: "createdBy"`（表单没有这个字段），`setError("createdBy")` 会在 RHF 里创建一个没人展示的错误，用户看不到任何提示。我们把它汇总到 `root.server`，至少让用户知道发生了什么；
2. **只认 `in === "body"`**：`headers.idempotency-key` 这种错误是代码 bug，不是用户能修的，同样汇总到 root；
3. `shouldFocus: !applied`：第一个出错的字段自动获得焦点，键盘和读屏用户能立刻定位。

`type: "server.minLength"` 让你在需要时区分「客户端校验错误」和「服务端校验错误」（例如服务端错误在用户修改字段后才清除）。

---

## 6.9 常见坑

| 现象                                                    | 原因                                                    | 解决                                                               |
| ------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| 校验错误变成 500 + `FST_ERR_FAILED_ERROR_SERIALIZATION` | 契约声明了 `400: ErrorResponse`，但错误没经过统一处理器 | 注册 `setErrorHandler`，且用 `fastify-plugin` 包裹使其作用于根实例 |
| 「缺少 title」的错误 path 是空字符串                    | 没有处理 `required` 的 `missingProperty`                | 6.3 节                                                             |
| 响应里出现 SQL 或堆栈                                   | 兜底分支用了 `error.message`                            | 500 只返回固定文案 + requestId                                     |
| 日志里找不到某次请求                                    | 前后端各自生成 ID / 没有返回 ID                         | 采纳上游合法 ID；`onSend` 写回响应头                               |
| 日志被伪造的 requestId 污染                             | 原样信任 `X-Request-Id`                                 | 格式白名单                                                         |
| 告警被 4xx 淹没                                         | 所有错误都记 `error` 级别                               | 4xx 记 `info`，5xx 记 `error`                                      |
| 前端遇到新错误码白屏                                    | 直接把 `code` 当成穷尽的联合类型使用                    | 未知码降级为 `UNKNOWN`；`switch` 要有 `default`                    |
| 服务端字段错误没显示                                    | path 与表单字段名不一致 / 表单没有该字段                | 点号路径；白名单 + 汇总到 root                                     |

---

## 6.10 本章验收清单

- [ ] 能说出错误 envelope 每个字段的设计理由，以及它与 RFC 9457 的关系；
- [ ] 错误码是契约里的枚举，`ErrorResponse` 在每个接口的每个错误状态码上声明；
- [ ] Ajv 错误被正确翻译成点号路径（包括 `required` 和 `additionalProperties`）；
- [ ] 统一错误处理器的四个分支，以及各自的日志级别；
- [ ] requestId：采纳上游合法值、拒绝不安全值、写回响应头、出现在每条日志和每个错误里；
- [ ] 有测试证明：500 响应不含内部细节，日志里有完整错误且可按 requestId 检索；
- [ ] 客户端把一切错误规整为 `ApiError` / `NetworkError` / `AbortError`，未知错误码和非 JSON 响应不会导致崩溃；
- [ ] 服务端字段错误能回填到 RHF 对应字段，无法回填的错误汇总到表单顶部。

---

上一章：[← 第 5 章：Zod 与 TypeBox：两道校验，各守一边](./05-two-validation-layers.md) ｜ 下一章：[第 7 章：取消请求与网络重试 →](./07-cancellation-and-retry.md)
