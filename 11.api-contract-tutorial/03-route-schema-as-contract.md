# 第 3 章：Fastify route schema 就是契约

> 本章目标：用 TypeBox 写出 TaskFlow 的接口契约，让同一份 schema 同时完成**运行时校验**、**handler 类型推导**和 **OpenAPI 文档生成**；文档要包含请求、响应、状态码、安全方案和分页。
>
> 对应核心概念：**① 以 Fastify route schema / OpenAPI 作为 API 结构的权威描述。**

---

## 3.1 先认识 TypeBox：会说 TypeScript 的 JSON Schema

JSON Schema 是描述 JSON 数据形状的标准格式。手写它很啰嗦，而且和 TypeScript 类型是两套东西：

```json
{
  "type": "object",
  "required": ["title"],
  "properties": {
    "title": { "type": "string", "minLength": 1, "maxLength": 120 }
  },
  "additionalProperties": false
}
```

TypeBox 让你用类似 Zod 的写法构建 JSON Schema，**构建结果本身就是一个普通的 JSON Schema 对象**，同时还能推导出 TypeScript 类型：

```ts
import Type, { type Static } from "typebox";

const CreateTaskBody = Type.Object(
  { title: Type.String({ minLength: 1, maxLength: 120 }) },
  { additionalProperties: false },
);

console.log(JSON.stringify(CreateTaskBody));
// {"type":"object","required":["title"],"properties":{"title":{"type":"string","minLength":1,"maxLength":120}},"additionalProperties":false}

type CreateTaskBody = Static<typeof CreateTaskBody>;
// { title: string }
```

这一点和 Zod 有本质区别：

|               | Zod                                | TypeBox                                       |
| ------------- | ---------------------------------- | --------------------------------------------- |
| schema 是什么 | Zod 自己的类实例                   | **标准 JSON Schema 对象**                     |
| 运行时校验    | `schema.parse()`                   | 任何 JSON Schema 校验器（Fastify 内置的 Ajv） |
| 生成 OpenAPI  | 需要转换（`z.toJSONSchema`）       | 不需要转换，**本身就是**                      |
| 擅长          | 表单、复杂变换（transform/refine） | HTTP 契约、跨语言共享                         |

Fastify 的校验和序列化都建立在 JSON Schema 上，所以 TypeBox 是它最自然的搭档。

### 常用构造器速查

```ts
Type.String({ minLength: 1, maxLength: 120 }); // string
Type.String({ format: "uuid" }); // string，Ajv 校验 UUID 格式
Type.String({ format: "date-time" }); // string，ISO 8601 时间点
Type.String({ format: "date" }); // string，YYYY-MM-DD
Type.Integer({ minimum: 1, maximum: 100 }); // number（整数）
Type.Enum(["low", "medium", "high"]); // "low" | "medium" | "high"
Type.Union([Type.String(), Type.Null()]); // string | null       —— 可为空
Type.Optional(Type.String()); // 属性可省略 → title?: string
Type.Array(Type.String()); // string[]
```

**「可省略」和「可为空」是两回事**，契约里要分清：

```ts
Type.Object({
  a: Type.Optional(Type.String()), // a?: string          → 可以不传
  b: Type.Union([Type.String(), Type.Null()]), // b: string | null    → 必须传，可以是 null
  c: Type.Optional(Type.Union([Type.String(), Type.Null()])), // c?: string | null → 都可以
});
```

在 TaskFlow 里：创建任务时 `description` 可以不传（用默认值），也可以显式传 `null`；而**响应**里的 `description` 永远存在，值可能是 `null`。第 12 章会把这条规则整理成规范。

---

## 3.2 Fastify + Type Provider：schema 推导出 handler 类型

先看一个最小例子，体会「同一份 schema 做三件事」：

```ts
import Fastify from "fastify";
import { type TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Type from "typebox";

const app = Fastify().withTypeProvider<TypeBoxTypeProvider>();

app.post(
  "/tasks",
  {
    schema: {
      body: Type.Object(
        { title: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
      response: {
        201: Type.Object({ id: Type.String(), title: Type.String() }),
      },
    },
  },
  async (request, reply) => {
    request.body.title; // ✅ 类型是 string —— 来自 body schema
    request.body.foo; // ❌ 编译错误：属性 foo 不存在
    return reply.code(201).send({ id: 1, title: "x" });
    //                             ^ ❌ 编译错误：number 不能赋给 string —— 来自 response[201]
  },
);
```

1. **运行时校验**：请求进来时，Fastify 用 Ajv 按 `body` schema 校验；`{ title: "" }` 会被拒绝，handler 根本不会执行；
2. **类型推导**：`withTypeProvider<TypeBoxTypeProvider>()` 让 `request.body` 自动获得 `{ title: string }` 类型，`reply.code(201).send()` 的参数也受 `response[201]` 约束；
3. **文档生成**：注册 `@fastify/swagger` 后，这份 schema 会出现在 OpenAPI 里（3.6 节）。

> ⚠️ `withTypeProvider` 必须**链式调用在实例上**并使用返回值。写成 `const app = Fastify(); app.withTypeProvider<...>()` 是无效的，类型推导不会生效。
>
> 在插件（路由文件）里，用 `FastifyPluginAsyncTypebox` 标注插件函数即可，插件内部的 `app` 已经带了类型提供者。

### route schema 的组成部分

| 字段                                                                           | 对应 HTTP              | OpenAPI 中的位置        | 本项目的例子                          |
| ------------------------------------------------------------------------------ | ---------------------- | ----------------------- | ------------------------------------- |
| `params`                                                                       | 路径参数 `/:projectId` | `parameters[in=path]`   | `{ projectId: uuid }`                 |
| `querystring`                                                                  | `?limit=&cursor=`      | `parameters[in=query]`  | 分页参数                              |
| `headers`                                                                      | 请求头                 | `parameters[in=header]` | `Idempotency-Key`、`If-Match`         |
| `body`                                                                         | 请求体                 | `requestBody`           | `CreateTaskBody`                      |
| `response`                                                                     | 各状态码的响应体       | `responses`             | `201: Task`，`4xx/500: ErrorResponse` |
| `operationId` / `tags` / `summary` / `description` / `security` / `deprecated` | —                      | 同名字段                | 文档与代码生成用                      |

> `headers` schema 里的属性名要写**小写**（`"idempotency-key"`），因为 Node.js 会把所有请求头名转成小写。

---

## 3.3 契约 DTO 与数据库表刻意分开

第 2 章的 `tasks` 表和接下来的 `Task` 契约很像，但我们**不会**用数据库 schema 去生成 API schema（也不会反过来）。原因：

| 关注点       | 数据库行                                                | API 契约                                                |
| ------------ | ------------------------------------------------------- | ------------------------------------------------------- |
| 时间         | `Date` 对象                                             | ISO 8601 字符串                                         |
| 字段集合     | 包含内部字段（将来可能有 `deletedAt`、`internalNotes`） | 只包含对外承诺的字段                                    |
| 变化节奏     | 随存储优化而变                                          | 必须向后兼容地演进（第 12 章）                          |
| 输入 vs 输出 | 一张表                                                  | `CreateTaskBody`、`UpdateTaskBody`、`Task` 三个不同形状 |

把两者绑定在一起，意味着「加一个数据库列」就可能「意外修改对外接口」。分开维护，再用一个显式的映射函数 `toTaskDto()`（第 9 章）连接，任何对外暴露的变化都必须有人有意识地写出来。

**`apps/api/src/contract/tasks.ts`**：

```ts
import Type, { type Static } from "typebox";
import {
  CalendarDate,
  CursorPage,
  DateTime,
  Id,
  PageLimit,
  ref,
} from "./common";

// 契约里的 schema 只描述「线上传输的形状」，与数据库表结构刻意分开

export const TaskStatus = Type.Enum(["todo", "doing", "done"], {
  $id: "TaskStatus",
  description: "任务状态。新增取值属于契约变更，客户端需对未知值兜底",
});
export const TaskPriority = Type.Enum(["low", "medium", "high"], {
  $id: "TaskPriority",
});

// pattern "\S"：至少包含一个非空白字符。否则 "   " 能通过 minLength，服务端 trim 后变成 ""，
// 再撞上数据库 CHECK 约束，用户得到的就是 500 而不是 400（第 5 章）
const Title = Type.String({ minLength: 1, maxLength: 120, pattern: "\\S" });
const Description = Type.String({ maxLength: 2000 });

export const Task = Type.Object(
  {
    id: Id,
    projectId: Id,
    title: Title,
    description: Type.Union([Description, Type.Null()]),
    status: ref(TaskStatus),
    priority: ref(TaskPriority),
    dueDate: Type.Union([CalendarDate, Type.Null()]),
    createdBy: Id,
    version: Type.Integer({
      minimum: 1,
      description: "乐观并发版本号，更新时通过 If-Match 带回",
    }),
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { $id: "Task", additionalProperties: false },
);
export type Task = Static<typeof Task>;

export const CreateTaskBody = Type.Object(
  {
    title: Title,
    description: Type.Optional(Type.Union([Description, Type.Null()])),
    priority: Type.Optional(ref(TaskPriority)),
    dueDate: Type.Optional(Type.Union([CalendarDate, Type.Null()])),
  },
  {
    $id: "CreateTaskBody",
    additionalProperties: false,
    description:
      "status / createdBy / version 由服务端决定，客户端传了会被拒绝",
  },
);
export type CreateTaskBody = Static<typeof CreateTaskBody>;

export const UpdateTaskBody = Type.Object(
  {
    title: Type.Optional(Title),
    description: Type.Optional(Type.Union([Description, Type.Null()])),
    status: Type.Optional(ref(TaskStatus)),
    priority: Type.Optional(ref(TaskPriority)),
    dueDate: Type.Optional(Type.Union([CalendarDate, Type.Null()])),
  },
  { $id: "UpdateTaskBody", additionalProperties: false, minProperties: 1 },
);
export type UpdateTaskBody = Static<typeof UpdateTaskBody>;

export const TaskPage = CursorPage(ref(Task), "TaskPage");
export type TaskPage = Static<typeof TaskPage>;

// 查询参数不设 additionalProperties: false：多余参数（如防缓存的 ?_=123）直接忽略即可
export const ListTasksQuery = Type.Object({
  limit: Type.Optional(PageLimit),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  status: Type.Optional(ref(TaskStatus)),
});

export const ProjectParams = Type.Object({ projectId: Id });
export const TaskParams = Type.Object({ taskId: Id });

export const IdempotencyHeaders = Type.Object({
  "idempotency-key": Type.String({
    format: "uuid",
    description: "同一次「创建意图」的唯一键；网络重试时必须复用同一个值",
  }),
});

// 声明为可选：缺失时由 handler 返回 428，而不是笼统的 400（第 11 章）
export const IfMatchHeaders = Type.Object({
  "if-match": Type.Optional(
    Type.String({
      pattern: '^"[0-9]+"$',
      description: '资源版本，格式为带引号的整数，例如 "3"。更新时必须提供',
    }),
  ),
});

export const taskSchemas = [
  TaskStatus,
  TaskPriority,
  Task,
  CreateTaskBody,
  UpdateTaskBody,
  TaskPage,
];
```

注意三个「输入/输出不对称」的设计：

1. `CreateTaskBody` **没有** `status`、`createdBy`、`version`。新任务一定是 `todo`，创建者一定是当前登录用户，版本一定从 1 开始——这些由服务端决定。加上 `additionalProperties: false`，客户端偷偷传这些字段会得到 400，而不是被采纳（第 5 章的绕过测试会验证）；
2. `UpdateTaskBody` 所有字段都可选（PATCH 语义），但 `minProperties: 1` 拒绝空对象；
3. `Task`（响应）所有字段都必填，可空的字段用 `| null` 表达。前端拿到任务时不需要写一堆 `task.description ?? undefined` 的防御代码。

---

## 3.4 共享 schema：`$id`、`addSchema` 与 `ref()`

`Task` 会出现在很多地方：创建的响应、读取的响应、更新的响应、分页列表的 `items`。如果每次都内联整个对象，OpenAPI 里会出现十几份一模一样的定义，生成的前端类型也会是匿名的结构，而不是一个叫 `Task` 的类型。

我们希望 OpenAPI 长这样：

```json
"responses": {
  "201": {
    "content": {
      "application/json": { "schema": { "$ref": "#/components/schemas/Task" } }
    }
  }
}
```

做法分三步：

**① 给共享 schema 一个 `$id`**（上面的 `{ $id: "Task" }`）。

**② 用 `app.addSchema()` 注册到 Fastify。** 注册后，任何 schema 里的 `{ "$ref": "Task" }` 都能被 Ajv 解析，`@fastify/swagger` 也会把它们放进 `components.schemas`。

**③ 在路由里引用，而不是内联。** 这里有一个类型层面的小麻烦：TypeBox 的 `Type.Ref("Task")` 只是生成 `{ $ref: "Task" }`，它并不知道 `"Task"` 对应什么类型，推导出来是 `unknown`，handler 就失去了类型。

所以我们写一个小工具 `ref()`：**运行时输出 `$ref`，编译期保留原 schema 的静态类型**。

**`apps/api/src/contract/common.ts`**（节选）：

```ts
import Type, { type Static, type TSchema, type TSchemaOptions } from "typebox";

/**
 * 把一个带 $id 的共享 schema 变成 `{ $ref: "<id>" }`，同时保留它的 TS 类型。
 * - 运行时：Fastify 用 addSchema 注册过的同名 schema 解析 $ref；
 * - OpenAPI：@fastify/swagger 把它输出为 `#/components/schemas/<id>`；
 * - 编译期：Type.Unsafe 让 handler 依然拿到精确的 Static 类型。
 */
export function ref<T extends TSchema>(schema: T, options?: TSchemaOptions) {
  const id = (schema as { $id?: unknown }).$id;
  if (typeof id !== "string") {
    throw new Error("ref() 只能用于带 $id 的共享 schema");
  }
  return Type.Unsafe<Static<T>>(Type.Ref(id, options));
}
```

`Type.Unsafe<T>(schema)` 的含义是「这个 JSON Schema 的静态类型是 T，相信我」。它是 TypeBox 留给我们的逃生舱。因为我们把「`$id` → schema」的对应关系封装在 `ref()` 里，并且 `$id` 和 schema 来自同一个对象，所以这里的「相信我」是安全的。

> **为什么 `ref()` 在运行时检查 `$id`，而不是在类型里约束？** TypeBox 1.x 的 `TSchemaOptions` 不会把 `$id` 保留到返回类型上，所以 `T extends { $id: string }` 这样的约束会让所有调用都报错。运行时检查能在应用启动时立刻抛错，效果一样。

所有共享 schema 集中在一个清单里注册（**`apps/api/src/contract/index.ts`**）：

```ts
import { ErrorCode, ErrorResponse, FieldError } from "./common";
import { authSchemas } from "./auth";
import { projectSchemas } from "./projects";
import { taskSchemas } from "./tasks";

/** 所有带 $id 的共享 schema：注册顺序要求被引用者在前 */
export const sharedSchemas = [
  ErrorCode,
  FieldError,
  ErrorResponse,
  ...authSchemas,
  ...projectSchemas,
  ...taskSchemas,
];
```

### 标量约定也写进契约

`common.ts` 里还定义了全项目统一的标量：

```ts
/** 资源 ID：对外一律 UUID 字符串，不暴露自增序号 */
export const Id = Type.String({ format: "uuid" });

/** 时间点：UTC ISO 8601，例如 2026-10-22T08:30:00.000Z */
export const DateTime = Type.String({
  format: "date-time",
  description: "UTC 时间点，ISO 8601 格式，带 Z 后缀",
  examples: ["2026-10-22T08:30:00.000Z"],
});

/** 日历日期：没有时区，例如截止日 2026-10-30 */
export const CalendarDate = Type.String({
  format: "date",
  description: "日历日期 YYYY-MM-DD，不含时区",
  examples: ["2026-10-30"],
});
```

`description` 和 `examples` 会原样进入 OpenAPI 和生成的前端类型注释。**写给人看的约定，也应该放在机器能传递的地方。**

---

## 3.5 错误响应与分页也是契约

### 每个状态码都要声明

一个接口「可能返回什么」，不只是成功的那一个。`common.ts` 定义了统一错误结构（第 6 章详细设计），并提供一个辅助函数批量声明：

```ts
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

/** 为一组状态码批量声明「返回统一错误 envelope」 */
export function errorResponses<const Codes extends readonly number[]>(
  ...codes: Codes
) {
  const descriptions: Record<number, string> = {
    400: "请求格式或字段校验失败",
    401: "未登录或会话已过期",
    403: "已登录但无权执行该操作",
    404: "资源不存在或对当前用户不可见",
    409: "与现有数据冲突",
    412: "If-Match 版本不匹配，资源已被修改",
    422: "幂等键被用于不同的请求内容",
    428: "缺少必需的前置条件请求头",
    429: "请求过于频繁",
    500: "服务器内部错误",
  };
  const errorRef = (code: number) =>
    ref(ErrorResponse, { description: descriptions[code] ?? "错误" });
  return Object.fromEntries(codes.map((code) => [code, errorRef(code)])) as {
    [K in Codes[number]]: ReturnType<typeof errorRef>;
  };
}
```

路由里就可以写：

```ts
response: {
  201: ref(Task, { description: "已创建（或幂等重放）" }),
  ...errorResponses(400, 401, 403, 404, 409, 422, 500),
},
```

`ref()` 的第二个参数 `description` 会成为 OpenAPI 里该响应的说明文字。

### 分页结构

```ts
/** 游标分页：items + nextCursor；nextCursor 为 null 表示没有下一页 */
export function CursorPage<T extends TSchema>(item: T, id: string) {
  return Type.Object(
    {
      items: Type.Array(item),
      nextCursor: Type.Union([Type.String(), Type.Null()], {
        description: "不透明游标。原样传回 ?cursor=，不要解析或拼接",
      }),
    },
    { $id: id, additionalProperties: false },
  );
}

export const PageLimit = Type.Integer({
  minimum: 1,
  maximum: 100,
  default: 20,
  description: "每页条数，默认 20，最大 100",
});
```

`limit` 的上限 100 是契约的一部分：客户端传 `limit=100000` 会直接得到 400，而不是把数据库拖垮。为什么用游标而不是页码，第 12 章再讲。

---

## 3.6 生成 OpenAPI：`@fastify/swagger`

**`apps/api/src/plugins/openapi.ts`**：

```ts
import swagger from "@fastify/swagger";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { sharedSchemas } from "../contract";

export const API_VERSION = "1.3.0";

/**
 * OpenAPI 文档由 route schema 自动生成（code-first），本插件只补充「全局」信息：
 * 版本、服务器、标签、安全方案，以及把共享 schema 输出到 components.schemas。
 */
export const openapiPlugin = fp(async function openapi(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "TaskFlow API",
        version: API_VERSION,
        description:
          "TaskFlow 的 HTTP 契约。所有错误都返回 ErrorResponse；所有时间点都是 UTC ISO 8601。",
      },
      servers: [
        { url: "/", description: "与 Web 同源（经 Vite 代理或反向代理）" },
      ],
      tags: [
        { name: "auth", description: "会话与身份" },
        { name: "projects", description: "项目" },
        { name: "tasks", description: "任务" },
      ],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "sid",
            description:
              "登录后由服务端下发的 HttpOnly 会话 Cookie，浏览器自动携带",
          },
          csrfHeader: {
            type: "apiKey",
            in: "header",
            name: "X-CSRF-Token",
            description:
              "写请求必须携带，值来自 GET /api/v1/auth/session 的 csrfToken",
          },
        },
      },
      // 默认：需要登录。个别公开接口在路由里用 security: [] 覆盖
      security: [{ cookieAuth: [] }],
    },
    // 共享 schema 在 components 里使用自己的 $id 作名字，而不是 def-0、def-1
    refResolver: {
      buildLocalReference(json, _baseUri, _fragment, i) {
        return typeof json.$id === "string" ? json.$id : `def-${i}`;
      },
    },
  });

  for (const schema of sharedSchemas) app.addSchema(schema);
});
```

逐项解释：

**为什么是 OpenAPI 3.1 而不是 3.0？** 3.1 的数据模型与 JSON Schema 2020-12 完全对齐。TypeBox 表达「可为空」的方式是 `anyOf: [{ type: "string" }, { type: "null" }]`，这在 3.1 里是合法的，在 3.0 里却不是（3.0 只认 `nullable: true`）。用 3.1，TypeBox 的输出可以原样进入文档，不需要任何转换。

**`info.version` 是什么版本？** 它是**契约文档的版本**，不是 URL 里的 `/v1`。我们约定：新增接口或可选字段时升 minor（1.2 → 1.3），修文档升 patch；URL 的 `/v1` 只有在不兼容变更时才会变成 `/v2`。第 12 章详细讨论。

**安全方案（securitySchemes）**：我们声明了两种「凭据」：

- `cookieAuth`：会话 Cookie，所有需要登录的接口都要；
- `csrfHeader`：写请求额外需要的 `X-CSRF-Token` 头。

全局 `security: [{ cookieAuth: [] }]` 表示「默认需要登录」；登录接口在路由里写 `security: []` 表示公开；写接口写 `security: [{ cookieAuth: [], csrfHeader: [] }]`（同一个对象里的两项是「并且」关系）。

> 安全方案只是**描述**，不会替你执行任何检查。真正的认证与 CSRF 校验在第 8 章的 `authPlugin` 里。文档与实现的一致性靠测试保证（3.9 节）。

**`refResolver.buildLocalReference`**：默认情况下，`addSchema` 注册的 schema 在 `components.schemas` 里会被命名为 `def-0`、`def-1`……生成的前端类型也会是 `components["schemas"]["def-7"]`，完全不可读。这个函数让它们使用自己的 `$id` 作为名字。

**`operationId`**：每个路由都要写一个唯一、稳定的 `operationId`（如 `createTask`）。它是代码生成器、文档、网关识别一个操作的「主键」。改名等同于破坏性变更。

---

## 3.7 组装应用：`buildApp()`

**`apps/api/src/app.ts`**（节选，CORS/认证部分在第 8 章讲）：

```ts
import Fastify, { LogController, type FastifyServerOptions } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
// ……其他导入

export interface BuildAppOptions {
  db: Db;
  config: AppConfig;
  logger?: FastifyServerOptions["logger"];
  trustProxy?: boolean;
}

/** 只「组装」应用，不 listen：测试、导出 OpenAPI、启动服务都复用它 */
export async function buildApp(opts: BuildAppOptions) {
  const app = Fastify({
    logger: opts.logger ?? { level: opts.config.logLevel /* …… */ },
    genReqId, // 第 6 章
    logController: new LogController({ requestIdLogLabel: "requestId" }),
    trustProxy: opts.trustProxy ?? false, // 第 8 章
    ajv: {
      customOptions: {
        // 遇到契约外的字段直接 400，而不是悄悄删掉（第 5 章）
        removeAdditional: false,
      },
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.decorate("db", opts.db);
  app.decorate("config", opts.config);

  await app.register(errorHandlerPlugin); // 第 6 章：统一错误出口
  await app.register(openapiPlugin); // 本章
  // ……cookie、cors、auth（第 8 章）

  await app.register(
    async (v1) => {
      await v1.register(authRoutes);
      await v1.register(projectRoutes);
      await v1.register(taskRoutes);
    },
    { prefix: "/api/v1" },
  );

  if (opts.config.exposeDocs) {
    // /docs 交互式文档，/docs/openapi.json 原始契约
    await app.register(scalar, { routePrefix: "/docs" });
  }
  return app;
}
```

### Fastify 默认的 Ajv 配置

Fastify 内置的 Ajv 默认选项是（来自 `@fastify/ajv-compiler`）：

```js
{
  coerceTypes: "array",     // "20" → 20，单个值 → 数组（查询参数都是字符串，需要它）
  useDefaults: true,        // 把 schema 里的 default 填进请求
  removeAdditional: true,   // ⚠️ 删除 additionalProperties: false 时的多余字段
  allErrors: false,         // 只报第一个错误；源码注释明确说 true 有 DoS 风险
}
```

我们只改了一项：`removeAdditional: false`。默认行为下，客户端传了 `{ title: "x", status: "done" }`，Fastify 会**悄悄删掉** `status` 然后放行——安全上没问题（字段被丢弃了），但调用方完全不知道自己传错了，契约的「严格性」也就无从验证。改为 `false` 后，多余字段直接得到 400 和明确的字段错误。

`coerceTypes` 保留：查询参数天然是字符串，`?limit=20` 需要被转换成数字 20 才能通过 `Type.Integer` 校验。代价是请求体里的 `"title": 123` 也会被转成 `"123"`——对本项目可以接受。如果你的业务要求请求体严格不做类型转换，可以通过 `setValidatorCompiler` 为 `body` 和 `querystring` 使用不同的 Ajv 实例（Fastify 官方文档 Validation-and-Serialization 有示例）。

`allErrors` 保留默认的 `false`：只报第一个字段错误。前端 Zod 已经能一次性提示所有字段错误了，服务端作为信任边界，「拒绝」比「详尽」更重要。

---

## 3.8 完整的任务路由

**`apps/api/src/routes/tasks.ts`**：

```ts
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { errorResponses, ref } from "../contract/common";
import {
  CreateTaskBody,
  IdempotencyHeaders,
  IfMatchHeaders,
  ListTasksQuery,
  ProjectParams,
  Task,
  TaskPage,
  TaskParams,
  UpdateTaskBody,
} from "../contract/tasks";
import { requireAuth } from "../plugins/auth";
import {
  createTask,
  getTask,
  listTasks,
  updateTask,
} from "../services/task-service";

const writeSecurity = [{ cookieAuth: [], csrfHeader: [] }];

export const taskRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app;

  app.get(
    "/projects/:projectId/tasks",
    {
      schema: {
        operationId: "listTasks",
        tags: ["tasks"],
        summary: "分页列出项目任务（按创建时间倒序）",
        params: ProjectParams,
        querystring: ListTasksQuery,
        response: { 200: ref(TaskPage), ...errorResponses(400, 401, 404, 500) },
      },
    },
    async (request) => {
      const { user } = requireAuth(request);
      return listTasks(db, user.id, request.params.projectId, request.query);
    },
  );

  app.post(
    "/projects/:projectId/tasks",
    {
      schema: {
        operationId: "createTask",
        tags: ["tasks"],
        summary: "创建任务",
        description:
          "必须携带 Idempotency-Key。同一个键 + 相同请求体会重放第一次的结果（响应头 Idempotent-Replayed: true）；同一个键 + 不同请求体返回 422。",
        security: writeSecurity,
        params: ProjectParams,
        headers: IdempotencyHeaders,
        body: ref(CreateTaskBody),
        response: {
          201: ref(Task, { description: "已创建（或幂等重放）" }),
          ...errorResponses(400, 401, 403, 404, 409, 422, 500),
        },
      },
    },
    async (request, reply) => {
      const { user } = requireAuth(request);
      const { task, replayed } = await createTask(
        db,
        user.id,
        request.params.projectId, // string —— 来自 params schema
        request.body, // CreateTaskBody —— 来自 body schema
        request.headers["idempotency-key"], // string —— 来自 headers schema
      );
      if (replayed) reply.header("idempotent-replayed", "true");
      return reply
        .code(201)
        .header("location", `/api/v1/tasks/${task.id}`)
        .header("etag", `"${task.version}"`)
        .send(task); // 必须符合 Task —— 来自 response[201]
    },
  );

  // GET /tasks/:taskId 与 PATCH /tasks/:taskId 结构类似，见第 11 章
};
```

路由文件里**没有一行校验代码**，也没有手写任何类型。参数格式、必填、长度、枚举、额外字段……全部由 schema 声明；handler 只负责「调用业务、组装响应」。

---

## 3.9 导出 OpenAPI 文件

我们需要一个**不连数据库、不监听端口**就能拿到 OpenAPI 的方法，这样 CI 才能在没有任何外部依赖的情况下检查契约。

**`apps/api/src/scripts/export-openapi.ts`**：

```ts
/**
 * 把 route schema 生成的 OpenAPI 文档写到磁盘（不连数据库、不监听端口）。
 * 用法：tsx src/scripts/export-openapi.ts <输出路径>
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { buildApp } from "../app";
import { loadConfig } from "../config";

const out = process.argv[2];
if (!out) throw new Error("用法：export-openapi.ts <输出路径>");

// 导出契约只需要「注册路由」，handler 不会执行；给一个内存库占位即可
const client = new PGlite();
const app = await buildApp({
  db: drizzle({ client }),
  // 契约不应随环境变化：固定使用一份与环境无关的配置
  config: { ...loadConfig({}), exposeDocs: false },
  logger: false,
});
await app.ready();

// 固定 2 空格缩进 + 末尾换行，保证同一份契约每次输出字节完全一致
const json = `${JSON.stringify(app.swagger(), null, 2)}\n`;
await writeFile(resolve(out), json);
await app.close();
await client.close();
console.log(`OpenAPI written to ${resolve(out)}`);
```

两个细节决定了第 4 章的漂移检查能否工作：

1. **`loadConfig({})`**：传入空环境变量。如果导出结果依赖 `.env`（例如根据环境决定是否出现某个接口），那么开发者本地导出的文件和 CI 导出的文件会不同，漂移检查就会误报；
2. **确定性输出**：同样的代码必须产生**逐字节相同**的文件。`JSON.stringify` 保留对象插入顺序，路由注册顺序固定，所以输出是稳定的。

运行：

```bash
pnpm --filter @taskflow/api openapi:export
# OpenAPI written to .../packages/api-client/openapi.json
```

看一眼生成的 `createTask`（节选）：

```json
"/api/v1/projects/{projectId}/tasks": {
  "post": {
    "operationId": "createTask",
    "summary": "创建任务",
    "tags": ["tasks"],
    "requestBody": {
      "required": true,
      "content": { "application/json": { "schema": { "$ref": "#/components/schemas/CreateTaskBody" } } }
    },
    "parameters": [
      { "schema": { "type": "string", "format": "uuid" }, "in": "path", "name": "projectId", "required": true },
      { "schema": { "type": "string", "format": "uuid" }, "in": "header", "name": "idempotency-key",
        "required": true, "description": "同一次「创建意图」的唯一键；网络重试时必须复用同一个值" }
    ],
    "security": [{ "cookieAuth": [], "csrfHeader": [] }],
    "responses": {
      "201": { "description": "已创建（或幂等重放）",
               "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Task" } } } },
      "400": { "description": "请求格式或字段校验失败",
               "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } } } },
      "...": "401 / 403 / 404 / 409 / 422 / 500 同理"
    }
  }
}
```

对照本章开头的要求逐项检查——**请求**（path、header、body）、**响应**（`$ref Task`）、**状态码**（201 + 7 种错误）、**安全方案**（cookieAuth + csrfHeader）、**分页**（`listTasks` 的 `limit`/`cursor` 参数与 `TaskPage` 响应）——全部来自代码，没有一个字是手写的文档。

启动服务后，访问 `http://localhost:3000/docs` 可以看到 Scalar 渲染的交互式文档。

---

## 3.10 Fastify 序列化的三个陷阱

`response` schema 在 Fastify 里的主要作用是**加速序列化**（用 fast-json-stringify 生成专用的序列化函数），而不是校验。这带来三个新手很容易踩的坑。

### 陷阱 1：响应 schema 不会校验你的数据

```ts
// response: { 201: ref(Task) }，Task.status 是 "todo" | "doing" | "done"
return reply.code(201).send({ ...task, status: "bad" } as any);
```

这个响应会**原样发出** `"status": "bad"`。fast-json-stringify 只关心「怎么把字符串写出去」，不检查枚举、格式、长度。

防线有两道：

1. **类型**：不写 `as any`，`send()` 的参数类型就受 response schema 约束，`"bad"` 在编译期就会报错；
2. **契约测试**：在测试里用**独立的校验器**和**导出的 openapi.json** 校验真实响应。

**`apps/api/test/contract.ts`**：

```ts
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";

/**
 * 用「已发布的 openapi.json」校验真实响应 —— 契约测试。
 * Fastify 的响应 schema 只负责序列化，不会拒绝错误的数据（例如非法枚举值），
 * 所以必须在测试里用独立校验器再检查一次。
 */
const doc = JSON.parse(
  readFileSync(
    new URL("../../../packages/api-client/openapi.json", import.meta.url),
    "utf8",
  ),
);

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(doc, "openapi.json");

export function assertMatchesSchema(name: string, value: unknown) {
  const validate = ajv.getSchema(`openapi.json#/components/schemas/${name}`);
  if (!validate) throw new Error(`契约里没有 schema：${name}`);
  if (!validate(value)) {
    throw new Error(
      `响应不符合契约 ${name}：${JSON.stringify(validate.errors, null, 2)}`,
    );
  }
}
```

为什么用 `Ajv2020`？因为 OpenAPI 3.1 对应 JSON Schema 2020-12。整个 OpenAPI 文档作为一个 schema 加进去，然后用 JSON Pointer（`#/components/schemas/Task`）引用其中的组件，`$ref` 会被自动解析。

测试里这样用：

```ts
const res = await createTask(alice, {
  title: "  写发布说明  ",
  priority: "high",
  dueDate: "2026-10-30",
});
expect(res.statusCode).toBe(201);
const task = res.json();
assertMatchesSchema("Task", task); // 真实响应 vs 已发布契约
```

### 陷阱 2：响应 schema 是白名单

fast-json-stringify 只输出 schema 里声明过的属性。如果 handler 返回了一个多余字段（比如数据库行里的 `internalNotes`），它会被**静默丢弃**。

这是一个很好的安全兜底——即使忘了写 DTO 映射，内部字段也不会泄露。但它也会制造困惑：「我明明返回了这个字段，前端怎么拿不到？」——答案是你没有把它写进契约。**想对外暴露一个字段，就必须先改契约。** 这正是我们想要的约束。

不过，不要**只依赖**这个白名单。第 9 章的 `toTaskDto()` 显式列出每个字段，这样代码审查时一眼就能看到对外暴露了什么。

### 陷阱 3：错误响应也要符合 schema

我们在 `response` 里声明了 `400: ErrorResponse`。如果一个错误没有经过统一的错误处理器，Fastify 会尝试用 `ErrorResponse` 的序列化函数去序列化它的默认错误对象 `{ statusCode, code, error, message }`——结构不匹配，序列化失败，最终返回一个莫名其妙的 500：

```json
{
  "statusCode": 500,
  "code": "FST_ERR_FAILED_ERROR_SERIALIZATION",
  "message": "Failed to serialize an error. Error: \"code\" is required!. Original error: body/title must NOT have fewer than 1 characters"
}
```

这是在编写本教程时真实遇到的报错：一个本该是 400 的校验错误，变成了 500，而且把内部信息（`body/title must NOT...`）带了出去。**一旦在契约里声明了错误响应，就必须保证所有错误都被转换成这个结构**——这就是第 6 章统一错误处理器的意义。

---

## 3.11 用测试守护文档本身

除了校验响应，我们还可以对 OpenAPI 文档做一些「元规则」检查（**`apps/api/test/api.test.ts`** 节选）：

```ts
describe("OpenAPI 文档本身", () => {
  it("声明了安全方案，且每个操作都有唯一 operationId 和统一错误响应", () => {
    expect(Object.keys(openapiDoc.components.securitySchemes)).toEqual([
      "cookieAuth",
      "csrfHeader",
    ]);
    const ids = new Set<string>();
    for (const [path, ops] of Object.entries(openapiDoc.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        expect(op.operationId, `${method} ${path}`).toBeTruthy();
        expect(ids.has(op.operationId!)).toBe(false);
        ids.add(op.operationId!);
        expect(Object.keys(op.responses), `${method} ${path}`).toContain("500");
      }
    }
  });
});
```

谁新增接口忘了写 `operationId` 或错误响应，这个测试就会失败。把团队约定写成测试，比写在 Wiki 里可靠得多。

---

## 3.12 本章练习

1. **观察类型推导**：在 `createTask` 路由的 handler 里写 `request.body.status`，看 TypeScript 报什么错；再把 `CreateTaskBody` 加上 `status` 字段，错误是否消失？（做完记得改回来。）
2. **观察 Ajv 行为**：把 `buildApp` 里的 `removeAdditional: false` 删掉，用测试或 `curl` 提交 `{ "title": "x", "status": "done" }`，对比前后响应的区别。
3. **体验陷阱 1**：在某个 handler 里用 `as any` 返回一个非法枚举值，确认请求成功、契约测试失败。
4. **体验陷阱 3**：暂时注释掉 `errorHandlerPlugin` 的注册，提交一个空标题，观察 `FST_ERR_FAILED_ERROR_SERIALIZATION`。
5. **阅读文档**：启动 `dev:memory`，打开 `/docs`，找到 `listTasks` 的分页参数和 `TaskPage` 结构。

---

## 3.13 本章验收清单

- [ ] 能解释 TypeBox 与 Zod 的本质区别（TypeBox 的产物就是 JSON Schema）；
- [ ] 能说出 route schema 的 6 个部分（params、querystring、headers、body、response、元信息）及其在 OpenAPI 中的位置；
- [ ] 能区分「可省略」与「可为空」，并在契约里正确表达；
- [ ] 理解契约 DTO 与数据库表为什么要分开；
- [ ] 会用 `$id` + `addSchema` + `ref()` 声明共享 schema，并解释 `Type.Unsafe` 的作用；
- [ ] 生成的 OpenAPI 3.1 文档包含**请求、响应、状态码、安全方案和分页**；
- [ ] 能在不连接数据库的情况下导出确定性的 `openapi.json`；
- [ ] 知道 Fastify 响应 schema 「不校验、是白名单、错误也要匹配」三个陷阱，并会用契约测试兜底。

---

上一章：[← 第 2 章：从零搭建 monorepo](./02-monorepo-setup.md) ｜ 下一章：[第 4 章：从 OpenAPI 生成客户端，并让 CI 守住它 →](./04-codegen-and-ci.md)
