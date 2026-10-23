# 第 9 章：统一错误模型——稳定的错误码与可安全暴露的信息

[上一章](./08-shared-schemas-and-business-rules.md) · [目录](./README.md) · [下一章](./10-api-contract-details.md)

到目前为止，TaskHub 里已经出现了很多种“失败”：schema 校验失败、没登录、没权限、任务不存在、标题冲突、请求体不是合法 JSON……如果每种失败的响应格式都不一样，前端就得为每个接口写一套解析逻辑。

本章建立一个**统一的错误模型**：所有非 2xx 响应都有相同的结构、稳定的错误码，只暴露可以安全公开的信息，并且能通过请求 ID 关联到服务端日志。

## 9.1 从调用方的角度看错误

回想第 1 章开头的前端代码。一个好的错误模型应该让前端能写出这样**通用**的处理逻辑：

```ts
async function callApi<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (response.ok)
    return response.status === 204 ? (undefined as T) : response.json();

  const error = (await response.json()) as {
    statusCode: number;
    code: string;
    message: string;
    requestId: string;
    details?: {
      location: string;
      field: string;
      rule: string;
      message: string;
    }[];
  };

  switch (error.code) {
    case "UNAUTHORIZED":
      redirectToLogin();
      break;
    case "VALIDATION_FAILED":
    case "ASSIGNEE_NOT_FOUND":
      highlightFields(error.details ?? []);
      break;
    case "PRECONDITION_FAILED":
      askToReload();
      break;
    case "RATE_LIMITED":
      showToast("操作太频繁了，稍后再试");
      break;
    default:
      showToast(`出错了（编号 ${error.requestId}）`);
  }
  throw error;
}
```

这段代码依赖服务端做出四个承诺：

1. 所有错误响应的 body 都是同一个结构的 JSON；
2. `code` 是**稳定**的，可以拿来写 `switch`；
3. 字段级错误有统一的 `details` 格式；
4. 每个错误都带 `requestId`，用户反馈问题时可以提供。

## 9.2 HTTP 状态码速成

状态码是错误模型的第一层信息：网关、缓存、监控、浏览器都只看状态码。

| 状态码                         | 含义                                    | TaskHub 中的场景                   |
| ------------------------------ | --------------------------------------- | ---------------------------------- |
| **200** OK                     | 成功并返回内容                          | 查询、修改成功                     |
| **201** Created                | 创建了新资源，`Location` 头给出地址     | 创建任务                           |
| **204** No Content             | 成功，没有响应体                        | 删除任务                           |
| **400** Bad Request            | 请求本身有问题（形状、语法）            | schema 校验失败、非法 JSON         |
| **401** Unauthorized           | **身份**未知：没带凭证或凭证无效        | 没有/错误的 Bearer token           |
| **403** Forbidden              | 身份已知，但**没有权限**                | 成员访问管理员接口；修改别人的任务 |
| **404** Not Found              | 资源不存在（或对你不可见）              | 任务不存在；路由不存在             |
| **409** Conflict               | 与资源**当前状态**冲突                  | 同名任务；已完成任务改标题         |
| **412** Precondition Failed    | 请求带的前提条件（如 `If-Match`）不成立 | 编辑时数据已被别人修改             |
| **413** Content Too Large      | 请求体过大                              | 超过 `bodyLimit`                   |
| **415** Unsupported Media Type | 不支持的 Content-Type                   | 发送 XML                           |
| **422** Unprocessable Content  | 格式正确，但语义上无法处理              | 指派给不存在的用户                 |
| **429** Too Many Requests      | 超过限流                                | 一分钟内创建任务过多               |
| **500** Internal Server Error  | 服务端的 bug 或未预期的故障             | 数据库连接失败等                   |
| **503** Service Unavailable    | 暂时无法服务                            | 关闭中、过载                       |

几组容易混淆的选择：

- **401 vs 403**：401 说“我不知道你是谁”，客户端应该去登录；403 说“我知道你是谁，但你不能这么做”，重新登录也没用。
- **403 vs 404**：如果让调用者知道“这个资源存在”本身就是信息泄露，用 404。TaskHub 对**看不到**的任务返回 404，对**看得到但不能改**的任务返回 403。
- **400 vs 422**：400 用于请求“不像话”（结构错误）；422 用于结构没问题，但内容引用了不存在的东西、或语义上不成立。不少 API 只用 400，这也可以，关键是**团队约定一致**。
- **409 vs 412**：409 是业务状态冲突（无论客户端怎么想都不行）；412 是客户端声明的前提（“我基于版本 3 修改”）已经不成立，重新获取后再提交就可能成功。

## 9.3 设计错误响应的结构

TaskHub 的错误响应：

```json
{
  "statusCode": 400,
  "code": "VALIDATION_FAILED",
  "message": "请求参数不符合接口约定",
  "requestId": "3b9e2f0c-8a51-4f1e-9d7c-0e2a4c7b1d55",
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

| 字段         | 给谁看                                   | 稳定性                       |
| ------------ | ---------------------------------------- | ---------------------------- |
| `statusCode` | 只拿到 body 的调用方（如日志、消息队列） | 与 HTTP 状态码相同           |
| `code`       | **客户端程序**，用来做分支判断           | **稳定契约**：发布后只增不改 |
| `message`    | 人（开发者、用户）                       | 可以润色，**不要**拿来做判断 |
| `requestId`  | 排查问题的人                             | 每次请求不同                 |
| `details`    | 表单逐字段提示                           | 只在字段级错误时出现         |

为什么既有 `statusCode` 又有 `code`？状态码只有几十个，而业务错误有成百上千种。409 可能是“同名任务”，也可能是“已完成不能修改”，前端需要不同的提示和处理方式。`code` 提供了比状态码更细的、机器可读的区分。

> 业界还有一个标准格式 **RFC 9457 Problem Details**（`Content-Type: application/problem+json`，字段为 `type`、`title`、`status`、`detail`、`instance`）。如果你的组织已经采用它，可以把本章的 `code` 映射到 `type`、`requestId` 映射到 `instance` 或扩展字段。TaskHub 用了更简单的自定义结构，原理完全相同：**结构统一、标识稳定、信息安全**。

这份结构用 TypeBox 定义为共享 schema `ErrorResponse`（见第 7、8 章），既约束了序列化输出，也出现在 OpenAPI 文档中。

## 9.4 错误码目录：`src/errors/app-error.ts`

把所有错误码集中在一个地方：

```ts
/**
 * 稳定错误码目录。
 * code 是给客户端程序判断用的契约：一旦发布，只能新增，不能改名或改语义。
 * message 是给人看的默认说明，可以润色，但不能包含内部细节。
 */
export const ErrorCatalog = {
  VALIDATION_FAILED: { statusCode: 400, message: "请求参数不符合接口约定" },
  INVALID_JSON: { statusCode: 400, message: "请求体不是合法的 JSON" },
  BAD_REQUEST: { statusCode: 400, message: "请求无法被处理" },
  UNAUTHORIZED: { statusCode: 401, message: "缺少或无效的身份凭证" },
  FORBIDDEN: { statusCode: 403, message: "没有执行该操作的权限" },
  ROUTE_NOT_FOUND: { statusCode: 404, message: "接口不存在" },
  TASK_NOT_FOUND: { statusCode: 404, message: "任务不存在" },
  USER_NOT_FOUND: { statusCode: 404, message: "用户不存在" },
  TASK_TITLE_CONFLICT: { statusCode: 409, message: "你已经有一个同名任务" },
  TASK_ALREADY_DONE: { statusCode: 409, message: "已完成的任务只能修改状态" },
  PRECONDITION_FAILED: {
    statusCode: 412,
    message: "资源已被修改，请重新获取后再提交",
  },
  PAYLOAD_TOO_LARGE: { statusCode: 413, message: "请求体过大" },
  UNSUPPORTED_MEDIA_TYPE: { statusCode: 415, message: "不支持的 Content-Type" },
  ASSIGNEE_NOT_FOUND: { statusCode: 422, message: "指派的用户不存在" },
  RATE_LIMITED: { statusCode: 429, message: "请求过于频繁，请稍后再试" },
  INTERNAL_ERROR: { statusCode: 500, message: "服务器内部错误" },
} as const satisfies Record<string, { statusCode: number; message: string }>;

export type ErrorCode = keyof typeof ErrorCatalog;
```

`as const satisfies ...` 这个组合同时做到两件事：`satisfies` 检查每一项都有 `statusCode` 和 `message`；`as const` 保留精确的键名，让 `ErrorCode` 成为 `'VALIDATION_FAILED' | 'INVALID_JSON' | ...` 的联合类型。于是 `new AppError('TASK_NOT_FOUD')` 这样的拼写错误会在编译时被发现。

集中目录带来的好处：

- **状态码映射只有一处**：service 抛 `TASK_TITLE_CONFLICT`，不需要知道它是 409；
- **文档可以自动生成**：第 7 章的 `errorResponses()` 就是从这个目录里查出每个状态码对应哪些 code；
- **评审有抓手**：新增错误码就是改这个文件，评审者能一眼看到对外契约的变化。

错误码的演进规则和 API 字段一样（第 11 章会再讲）：**新增是兼容的；改名、删除、改变含义都是破坏性变更**。客户端代码里写着 `case 'TASK_TITLE_CONFLICT'`，你把它改成 `TITLE_DUPLICATED`，客户端的逻辑就会静默失效。

## 9.5 `AppError`：预期内的错误

```ts
interface AppErrorOptions {
  /** 覆盖默认 message；只放可以安全给客户端看的内容 */
  message?: string;
  details?: ErrorDetail[];
  /** 需要附带在响应上的头，例如 Retry-After、WWW-Authenticate */
  headers?: Record<string, string>;
  /** 原始错误，只进日志，不进响应 */
  cause?: unknown;
}

/**
 * 应用主动抛出的“预期内错误”。
 * 只要是 AppError，错误处理器就可以放心把 code 和 message 返回给客户端。
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: ErrorDetail[] | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? ErrorCatalog[code].message, {
      cause: options.cause,
    });
    this.name = "AppError";
    this.code = code;
    this.statusCode = ErrorCatalog[code].statusCode;
    this.details = options.details;
    this.headers = options.headers;
  }
}
```

`AppError` 的核心语义是：**“这个错误是我有意抛出的，它的 message 可以安全地给客户端看。”** 错误处理器据此区分“可以透传的错误”和“必须隐藏的错误”。

`cause` 用来保留底层原因。比如数据层捕获到数据库唯一约束冲突时：

```ts
throw new AppError("TASK_TITLE_CONFLICT", { cause: dbError });
```

客户端只看到“你已经有一个同名任务”，而日志里能看到完整的数据库错误。

## 9.6 八类错误从哪里来，到哪里去

| 类别       | 产生位置                        | 识别方式                         | 对外 `code`                          | 状态码      |
| ---------- | ------------------------------- | -------------------------------- | ------------------------------------ | ----------- |
| 业务错误   | service                         | `instanceof AppError`            | `TASK_TITLE_CONFLICT` 等             | 409/422 等  |
| 校验错误   | Fastify（Ajv）                  | `error.validation` 存在          | `VALIDATION_FAILED`                  | 400         |
| 未授权     | `authenticate` hook             | `AppError`                       | `UNAUTHORIZED`                       | 401         |
| 禁止访问   | `requireRole`、`assertCanWrite` | `AppError`                       | `FORBIDDEN`                          | 403         |
| 资源不存在 | service；或没有匹配的路由       | `AppError`；`setNotFoundHandler` | `TASK_NOT_FOUND` / `ROUTE_NOT_FOUND` | 404         |
| 冲突       | service、PATCH handler          | `AppError`                       | `TASK_*` / `PRECONDITION_FAILED`     | 409/412     |
| 限流       | @fastify/rate-limit             | `error.statusCode === 429`       | `RATE_LIMITED`                       | 429         |
| 框架层错误 | Fastify 解析 body 等            | `error.code` 以 `FST_ERR_` 开头  | `INVALID_JSON` 等                    | 400/413/415 |
| 未知错误   | 任何地方的 bug、依赖故障        | 以上都不是                       | `INTERNAL_ERROR`                     | 500         |

所有错误最终都汇集到**一个**错误处理器里，由它负责翻译成统一格式。

## 9.7 `setErrorHandler` 的工作方式

在写错误处理器之前，先理解 Fastify 文档描述的几条规则：

1. **它是封装的**。在某个插件里 `setErrorHandler`，只对那个作用域生效；要全局生效，必须用 `fp` 包装或直接在根实例上调用。
2. **会被调用的情况**：handler 抛错、hook 抛错、schema 校验失败、请求体解析失败、插件（如限流）抛错。
3. **不会被调用的情况**：没有匹配的路由（由 `setNotFoundHandler` 处理）、`onResponse` hook 里的错误（响应已经发出）、流式响应过程中的错误。
4. 如果错误的 `statusCode` 小于 400，Fastify 会先把它改成 500 再交给你。
5. 在错误处理器里再抛错，会交给**父作用域**的错误处理器。抛出的必须是 `Error` 实例，抛字符串之类的值会直接落到 Fastify 默认的错误处理器。
6. **路由的响应 schema 仍然作用于错误处理器发出的响应**（第 7 章）。
7. 自定义错误处理器时，Fastify 不再自动从错误对象上读取状态码和响应头，需要你自己设置。
8. 同一作用域重复调用 `setErrorHandler` 会覆盖之前的（`allowErrorHandlerOverride` 默认为 `true`，Fastify 文档说明下一个大版本将默认改为 `false`）。保持“一个作用域只设置一次”。

还有一个相关的 hook：`onError`。它在错误处理器**之前**执行，适合做额外的记录，但**不能修改错误或发送响应**。

### 先看看默认行为有多危险

Fastify 文档里有一个例子：数据库驱动抛出的错误，默认错误处理器会把 `message` 原样返回：

```json
{
  "statusCode": 500,
  "code": "ER_BAD_FIELD_ERROR",
  "error": "Internal Server Error",
  "message": "Unknown column 'username' in 'field list'"
}
```

表名、列名、SQL 片段直接暴露给了外部。文档明确说明：**Fastify 不区分开发和生产环境，如果不希望意外错误被客户端看到，你必须自己处理**。

## 9.8 TaskHub 的错误处理器：`src/plugins/error-handler.ts`

```ts
import type { FastifyError, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import {
  AppError,
  ErrorCatalog,
  type ErrorCode,
  type ErrorDetail,
} from "../errors/app-error.js";
import type { ErrorResponse } from "../schemas/common.js";

interface NormalizedError {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
  headers?: Record<string, string>;
}

/** Fastify 自身产生的、可以安全映射成稳定错误码的错误 */
const FRAMEWORK_ERRORS: Record<string, ErrorCode> = {
  FST_ERR_CTP_INVALID_JSON_BODY: "INVALID_JSON",
  FST_ERR_CTP_EMPTY_JSON_BODY: "INVALID_JSON",
  FST_ERR_CTP_BODY_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  FST_ERR_CTP_INVALID_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
};

function fromCatalog(code: ErrorCode): NormalizedError {
  return { code, ...ErrorCatalog[code] };
}

/** 把 Ajv 的错误对象转换成对外的 details；不暴露 schemaPath 等内部结构 */
function toValidationDetails(error: FastifyError): ErrorDetail[] {
  const location = error.validationContext ?? "request";
  return (error.validation ?? []).map((issue) => {
    const missing =
      issue.keyword === "required"
        ? (issue.params as { missingProperty?: string }).missingProperty
        : undefined;
    return {
      location,
      field: missing ? `${issue.instancePath}/${missing}` : issue.instancePath,
      rule: issue.keyword,
      message: issue.message ?? "invalid value",
    };
  });
}

/**
 * 错误归一化：任何错误进来，都变成 { statusCode, code, message, details? }。
 * 关键原则：只有“我们明确认识的错误”才把信息返回给客户端，其余一律当作 500 并隐藏细节。
 */
export function normalizeError(error: FastifyError | Error): NormalizedError {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      ...(error.headers ? { headers: error.headers } : {}),
    };
  }

  const fastifyError = error as FastifyError;
  if (fastifyError.validation) {
    return {
      ...fromCatalog("VALIDATION_FAILED"),
      details: toValidationDetails(fastifyError),
    };
  }

  if (fastifyError.statusCode === 429) return fromCatalog("RATE_LIMITED");

  const mapped = fastifyError.code
    ? FRAMEWORK_ERRORS[fastifyError.code]
    : undefined;
  if (mapped) return fromCatalog(mapped);

  const status = fastifyError.statusCode;
  if (status !== undefined && status >= 400 && status < 500) {
    // 其他框架层 4xx：保留状态码，但不透传 message，避免泄露实现细节
    return { ...fromCatalog("BAD_REQUEST"), statusCode: status };
  }

  return fromCatalog("INTERNAL_ERROR");
}

export function buildErrorResponse(
  normalized: NormalizedError,
  request: FastifyRequest,
): ErrorResponse {
  return {
    statusCode: normalized.statusCode,
    code: normalized.code,
    message: normalized.message,
    requestId: request.id,
    ...(normalized.details ? { details: normalized.details } : {}),
  };
}

/**
 * 全局错误处理插件。必须用 fastify-plugin 包装，
 * 否则 setErrorHandler 只对这个插件自己的（空）作用域生效。
 */
export default fp(
  async function errorHandlerPlugin(app) {
    app.setErrorHandler(function (error: FastifyError, request, reply) {
      const normalized = normalizeError(error);

      if (normalized.statusCode >= 500) {
        // 完整错误（含 stack、cause）只进日志
        request.log.error({ err: error }, "unhandled error");
      } else {
        // 4xx 是调用方的问题，用 info 记录错误码即可，避免告警噪音
        request.log.info(
          { code: normalized.code, statusCode: normalized.statusCode },
          "request rejected",
        );
      }

      if (normalized.headers) reply.headers(normalized.headers);
      return reply
        .code(normalized.statusCode)
        .send(buildErrorResponse(normalized, request));
    });

    // 没有匹配到任何路由时，也返回同样结构的错误
    app.setNotFoundHandler(function () {
      throw new AppError("ROUTE_NOT_FOUND");
    });
  },
  { name: "error-handler", fastify: "5.x" },
);
```

逐段说明。

### 归一化是一个**白名单**

`normalizeError` 的分支顺序就是信任程度：

1. `AppError`：我们自己抛的，完全信任，透传 `code`、`message`、`details`、`headers`。
2. 校验错误：结构由 Fastify 保证，转换成 `details`，但**只挑选**安全的字段（不含 `schemaPath`）。
3. 限流、已知的框架错误：映射成目录里的固定文案，**不使用**原始 `message`。
4. 其他 4xx：保留状态码，换成通用文案。
5. 其他一切：500，通用文案。

注意第 3、4 步：即使是 4xx 的框架错误，我们也不透传原始 message。Fastify 文档提醒过：**状态码低于 500 本身并不能保证 message 可以安全公开**。

### 归一化是纯函数

`normalizeError` 和 `buildErrorResponse` 不依赖 Fastify 实例，被单独导出，方便单元测试，也方便其他入口（比如 WebSocket）复用同一套映射。

### 日志级别按责任方区分

4xx 是调用方的问题（参数错、没权限），用 `info` 级别、只记录错误码；5xx 是服务端的问题，用 `error` 级别、记录完整的错误对象（含 stack 和 `cause`）。如果把 404、401 也记成 `error`，告警系统会被正常的客户端错误淹没，真正的故障反而被忽略。第 13 章还会继续讨论。

### `setNotFoundHandler`

没有匹配到路由的请求不会进入错误处理器，而是进入 not-found 处理器。TaskHub 在里面直接抛 `AppError`——not-found 处理器被当作普通 handler 对待，抛出的错误会进入上面的错误处理器，于是 404 也是统一格式。对比默认的 `{"message":"Route GET:/nope not found",...}`，我们也不再回显请求路径。

## 9.9 限流：429 与 @fastify/rate-limit

限流本身是一个插件，它产生的错误也纳入统一模型。

```ts
// src/app.ts
// global: false —— 只有在路由 config.rateLimit 中声明的路由才限流
await app.register(rateLimit, { global: false });
```

```ts
// src/modules/tasks/routes.ts
app.post(
  "/tasks",
  {
    preValidation: trimBodyStrings,
    config: {
      rateLimit: {
        max: options.createTaskRateLimit,
        timeWindow: "1 minute",
        // 已登录接口按用户限流，比按 IP 更公平（同一出口 IP 后面可能有很多人）
        keyGenerator: (request) => request.user?.id ?? request.ip,
      },
    },
    schema: {
      /* ... */
    },
  },
  handler,
);
```

工作原理：@fastify/rate-limit 通过 `onRoute` 钩子，给声明了 `config.rateLimit` 的路由追加一个**路由级 `onRequest` hook**。根据第 4 章的规则，路由级 hook 在作用域级 hook（`authenticate`）之后执行，所以 `keyGenerator` 里能拿到 `request.user`，实现“按用户限流”。

超过限制时，插件会设置响应头并抛出 `statusCode: 429` 的错误：

```text
HTTP/1.1 429 Too Many Requests
x-ratelimit-limit: 2
x-ratelimit-remaining: 0
x-ratelimit-reset: 60
retry-after: 60

{"statusCode":429,"code":"RATE_LIMITED","message":"请求过于频繁，请稍后再试","requestId":"..."}
```

插件设置的响应头（尤其是 `retry-after`）被保留了下来，body 则由我们的错误处理器统一生成。

几点注意：

- 插件也提供 `errorResponseBuilder` 选项来定制 429 的 body；既然已经有统一的错误处理器，TaskHub 选择在错误处理器里映射，保证格式只在一处定义。
- 默认使用**进程内存**存储计数。多实例部署时，每个实例各算各的，需要配置 Redis 等共享存储。
- 默认的 key 是客户端 IP。部署在反向代理后面时，要正确配置 Fastify 的 `trustProxy`，否则所有请求的 IP 都是代理的 IP；而且 Fastify 文档提醒，`X-Forwarded-*` 头在未受信任的代理链中可以被伪造。
- 插件的 `ban` 选项会在多次触发后改为返回 403。TaskHub 没有开启它；如果开启，需要在 `normalizeError` 中为它补一个专门的错误码。

## 9.10 测试未知错误不会泄露

```ts
it("未知错误：响应只说“服务器内部错误”，细节只进日志", async () => {
  const logs = createLogCollector();
  const app = await createTestApp({
    logging: { enabled: true, stream: logs.stream },
  });
  app.get("/boom", async () => {
    throw new Error("connect ECONNREFUSED 10.0.0.12:5432");
  });

  const response = await app.inject({ url: "/boom" });
  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: "服务器内部错误",
    requestId: response.headers["x-request-id"],
  });
  expect(response.body).not.toContain("ECONNREFUSED");

  const errorLog = logs.lines.find((line) => line.msg === "unhandled error");
  expect(errorLog).toMatchObject({
    level: 50,
    requestId: response.headers["x-request-id"],
  });
  expect((errorLog?.err as { message: string }).message).toContain(
    "ECONNREFUSED",
  );
});
```

这个测试同时验证了三件事：客户端看不到内网地址；响应里的 `requestId` 与响应头一致；用这个 `requestId` 能在日志里找到包含真实原因的那一条。**“对外隐藏，对内完整”**——这就是请求 ID 的价值（第 10、13 章）。

## 9.11 什么信息可以暴露

| 可以暴露                       | 不要暴露                                         |
| ------------------------------ | ------------------------------------------------ |
| 稳定的错误码                   | 异常的 `stack`                                   |
| 预先写好的、面向用户的提示     | 原始异常 `message`（尤其来自数据库、第三方 SDK） |
| 校验失败的字段路径、违反的规则 | schema 内部路径（`schemaPath`）、内部字段名      |
| 请求 ID                        | 内网 IP、主机名、文件路径、SQL                   |
| 限流的 `Retry-After`           | 用户是否存在（登录失败时统一说“账号或密码错误”） |
| `WWW-Authenticate` 头          | 资源是否存在（对无权查看者用 404）               |

最后一行值得多想一下：**错误本身也会泄露信息**。“token 格式错误”和“token 不存在”如果给出不同提示，攻击者就能区分；“任务不存在”和“没有权限”如果给出不同状态码，攻击者就能探测别人的资源 ID。TaskHub 在这两处都做了统一。

## 9.12 练习

1. 业务方要求：用户被管理员禁用后，调用任何接口都返回一个能让前端显示“账号已被禁用”的错误。设计它的 `code` 和状态码，说明在哪里抛出。
2. 下面的错误处理器有什么问题？

   ```ts
   app.register(async (instance) => {
     instance.setErrorHandler((error, request, reply) => {
       reply.code(error.statusCode ?? 500).send({ message: error.message });
     });
   });
   ```

3. 某路由的 handler 里写了 `throw { code: 'X', statusCode: 400 }`（抛的是普通对象）。会发生什么？
4. 产品想把 `TASK_TITLE_CONFLICT` 改名为 `DUPLICATE_TITLE`，因为“更好理解”。你会怎么回应？

**参考答案**

1. 例如 `ACCOUNT_DISABLED`，状态码 403（身份已知，但不允许访问）。加入 `ErrorCatalog`，在 `authenticate` 中查到用户被禁用时抛出 `AppError('ACCOUNT_DISABLED')`。不建议用 401，因为重新登录并不能解决问题。
2. 三个问题：（1）没有用 `fp`，只对这个空插件生效，全局错误仍然走默认处理器；（2）直接透传 `error.message`，会泄露内部信息；（3）响应结构缺少 `code` 和 `requestId`，与统一模型不一致。
3. 实测：在 TaskHub 中，错误处理器收到这个普通对象，它不是 `AppError`、没有 `validation`，但 `statusCode` 是 400，于是被归一化成 `400 BAD_REQUEST` 和通用文案——它想表达的 `X` 被丢弃了，客户端无法区分；而且普通对象没有 stack，排查困难。如果是没有自定义错误处理器的 Fastify，实测会把这个对象**原样**序列化返回。报错时始终抛 `Error` 的子类（如 `AppError`）。顺带一提，抛字符串 `throw 'oops'` 在 TaskHub 中会被当作 500 处理。
4. `code` 是已发布的契约，客户端可能已经在 `switch` 里依赖它。改名是破坏性变更。可行做法是：保持 `code` 不变，改进 `message` 文案；如果确实要换，就新增新码、两者并存一段时间并在文档中标记旧码废弃，在新的 API 主版本中再移除。

## 本章验收

- [ ] 能为常见场景选择正确的状态码，并解释 401/403、403/404、400/422、409/412 的区别。
- [ ] 能设计包含 `statusCode`、`code`、`message`、`requestId`、`details` 的错误响应，并解释每个字段的受众与稳定性。
- [ ] 能维护一个错误码目录，并说出错误码演进的兼容规则。
- [ ] 能写出全局错误处理器：用 `fp` 注册、按白名单归一化、区分日志级别、处理 not-found。
- [ ] 能配置 @fastify/rate-limit 的路由级限流，解释它的 hook 位置、响应头、存储与代理问题。
- [ ] 能列出可以与不可以出现在错误响应中的信息，并用测试证明未知错误不会泄露。

官方阅读：[Errors](https://fastify.dev/docs/latest/Reference/Errors/)、[Server：setErrorHandler / setNotFoundHandler](https://fastify.dev/docs/latest/Reference/Server/#seterrorhandler)、[Hooks：onError](https://fastify.dev/docs/latest/Reference/Hooks/#onerror)、[@fastify/rate-limit](https://github.com/fastify/fastify-rate-limit)、[RFC 9110：状态码](https://www.rfc-editor.org/rfc/rfc9110#name-status-codes)、[RFC 9457：Problem Details](https://www.rfc-editor.org/rfc/rfc9457)。

下一章，[分页排序、请求 ID 与其他契约细节](./10-api-contract-details.md)。
