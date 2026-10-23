# 第 6 章：TypeBox——一份定义，同时得到类型与 schema

[上一章](./05-json-schema-validation.md) · [目录](./README.md) · [下一章](./07-response-schema.md)

上一章手写的 JSON Schema 能在运行时守住输入，但代码里仍然是这样的：

```ts
app.post(
  "/tasks",
  { schema: { body: createTaskBodyJsonSchema } },
  async (request) => {
    const body = request.body as {
      title: string;
      description?: string | null;
      priority?: "low" | "medium" | "high";
    };
    //                         ^^^ 又手写了一遍类型
  },
);
```

同一个结构写了两遍：一遍 JSON Schema 给 Ajv，一遍 TypeScript 类型给编译器。改了一处忘了另一处，类型和运行时就**悄悄不一致**了——这比没有类型更危险，因为你会信任一个错误的类型。

本章用 **TypeBox** 消除这种重复：写一次，得到 JSON Schema（给 Fastify 校验、序列化、生成文档）和 TypeScript 类型（给编译器）。

## 6.1 TypeBox 是什么

TypeBox 的官方定位是“带静态类型推断的 JSON Schema 构建器”。关键在于：**`Type.*` 函数的返回值就是一个普通的 JSON Schema 对象**。

```ts
import { Type, type Static } from "typebox";

const User = Type.Object({
  id: Type.String({ format: "uuid" }),
  name: Type.String(),
  age: Type.Optional(Type.Integer({ minimum: 0 })),
});

type User = Static<typeof User>;
// type User = { id: string; name: string; age?: number }

console.log(JSON.stringify(User));
// {"type":"object","required":["id","name"],"properties":{"id":{"type":"string","format":"uuid"},
//  "name":{"type":"string"},"age":{"type":"integer","minimum":0}}}
```

- 运行时：`User` 是一个 JSON Schema 对象，可以直接交给 Fastify、Ajv 或任何符合标准的校验器。
- 编译时：`Static<typeof User>` 从这个对象的**类型**中推断出 TypeScript 类型。

两者来自同一行代码，不可能不一致。这就是“类型推断与运行时 schema 同源”。

> TypeBox 1.x 的 schema 对象上还带着 `~kind`、`~optional` 等以 `~` 开头的属性，它们被定义为**不可枚举**，`JSON.stringify` 和 Ajv 都看不到，不会污染输出。你在控制台用 `console.log` 打印时可能会看到它们，不用担心。

## 6.2 常用构造器速查

| TypeBox                                          | 生成的 JSON Schema                                          | `Static` 推断   |
| ------------------------------------------------ | ----------------------------------------------------------- | --------------- |
| `Type.String()`                                  | `{ type: 'string' }`                                        | `string`        |
| `Type.String({ minLength: 1, format: 'email' })` | `{ type: 'string', minLength: 1, format: 'email' }`         | `string`        |
| `Type.Number()` / `Type.Integer()`               | `{ type: 'number' }` / `{ type: 'integer' }`                | `number`        |
| `Type.Boolean()`                                 | `{ type: 'boolean' }`                                       | `boolean`       |
| `Type.Null()`                                    | `{ type: 'null' }`                                          | `null`          |
| `Type.Literal('ok')`                             | `{ type: 'string', const: 'ok' }`                           | `'ok'`          |
| `Type.Enum(['a', 'b'])`                          | `{ enum: ['a', 'b'] }`                                      | `'a' \| 'b'`    |
| `Type.Array(Type.String(), { maxItems: 5 })`     | `{ type: 'array', items: { type: 'string' }, maxItems: 5 }` | `string[]`      |
| `Type.Object({ a: Type.String() })`              | `{ type: 'object', required: ['a'], properties: {...} }`    | `{ a: string }` |
| `Type.Optional(T)`                               | 让该属性不出现在父对象的 `required` 里                      | `a?: T`         |
| `Type.Union([A, B])`                             | `{ anyOf: [A, B] }`                                         | `A \| B`        |
| `Type.Unknown()`                                 | `{}`                                                        | `unknown`       |

所有构造器的**最后一个参数**都是选项对象，里面的内容会原样合并进生成的 schema：约束（`minimum`、`pattern`）、注释（`description`、`examples`）、`default`、`$id`，以及对象专用的 `additionalProperties`、`minProperties` 等。

## 6.3 `Optional`：可选属性

```ts
const T = Type.Object({
  title: Type.String(),
  priority: Type.Optional(Type.Enum(["low", "medium", "high"])),
});
// { type: 'object', required: ['title'], properties: { title: {...}, priority: {...} } }
// Static: { title: string; priority?: 'low' | 'medium' | 'high' }
```

`Type.Optional` 并不会在 `priority` 的 schema 上加什么关键字，它的作用是**让 `priority` 不进入父对象的 `required` 列表**，同时让推断类型变成 `priority?:`。它只在 `Type.Object` 的属性上有意义。

## 6.4 `Union` 与 `Literal`，以及什么时候改用 `Enum`

`Union` 对应 TypeScript 的 `|`，`Literal` 对应字面量类型。直觉上，“状态只能是三个值之一”会这样写：

```ts
const StatusUnion = Type.Union([
  Type.Literal("todo"),
  Type.Literal("doing"),
  Type.Literal("done"),
]);
// Static: 'todo' | 'doing' | 'done'
```

类型推断完全正确。但看看它生成的 schema 和校验错误（真实输出）：

```text
schema: {"anyOf":[{"type":"string","const":"todo"},{"type":"string","const":"doing"},{"type":"string","const":"done"}]}

GET /u?status=nope →
"querystring/status must be equal to constant, querystring/status must be equal to constant,
 querystring/status must be equal to constant, querystring/status must match a schema in anyOf"
```

`anyOf` 需要尝试每个分支，每个失败分支都贡献一条错误。换成 `Type.Enum`：

```ts
const StatusEnum = Type.Enum(["todo", "doing", "done"]);
// Static: 'todo' | 'doing' | 'done'（完全相同）
```

```text
schema: {"enum":["todo","doing","done"]}

GET /e?status=nope → "querystring/status must be equal to one of the allowed values"
```

推断类型一样，schema 更短，错误只有一条，在 OpenAPI 文档里也显示为一个清晰的枚举下拉框。所以 TaskHub 的规则是：

- **纯字符串（或数字）枚举 → `Type.Enum`**：任务状态、优先级、排序字段、用户角色。
- **真正的“几种不同结构之一” → `Type.Union`**：比如“要么是邮箱登录对象，要么是手机号登录对象”。
- **单个固定值 → `Type.Literal`**：比如健康检查的 `{ status: 'ok' }`。

`/healthz` 就用到了 `Literal`：

```ts
response: { 200: Type.Object({ status: Type.Literal('ok') }) }
```

### 可为 null 的字段：不要用 `Union([String, Null])`

第 5 章讲过，在 Fastify 默认的类型转换下，`anyOf: [string, null]` 会把 `null` 变成 `""`。`Type.Union([Type.String(), Type.Null()])` 生成的恰好就是这个 `anyOf`。TaskHub 写了一个小工具函数，生成 type 数组形式：

```ts
// src/schemas/common.ts
/**
 * 可为 null 的字符串：生成 { type: ['string', 'null'], ... }。
 *
 * 为什么不用 Type.Union([Type.String(), Type.Null()])？
 * Fastify 默认开启了 Ajv 的类型转换（coerceTypes），anyOf 会按顺序尝试每个分支，
 * null 在第一个 string 分支里就被转成了 ""。而 type 数组只有在“所有类型都不匹配”时才转换，
 * null 本身匹配 'null'，就会原样保留。
 */
export function Nullable<T extends TString>(
  schema: T,
): TUnsafe<Static<T> | null> {
  return Type.Unsafe<Static<T> | null>({ ...schema, type: ["string", "null"] });
}
```

使用：

```ts
const Description = Nullable(
  Type.String({ maxLength: 2000, description: "描述，可以为 null" }),
);
// schema: { type: ['string', 'null'], maxLength: 2000, description: '...' }
// Static: string | null
```

这里用到了 `Type.Unsafe<T>(schema)`：它的意思是“这个 schema 由我自己负责，请把它的类型当作 `T`”。当 TypeBox 的内置构造器表达不了你想要的 JSON Schema 时，`Unsafe` 是标准的逃生口。代价是类型和 schema 的一致性要由你自己保证——所以要把它封装在少数几个经过测试的工具函数里，而不是散落在各处。

## 6.5 组合与复用：直接 import 常量

TypeBox schema 是普通的 JS 值，最简单的复用方式就是**把它放进一个常量，然后 import**：

```ts
// src/schemas/task.ts
const Title = Type.String({
  minLength: 1,
  maxLength: 120,
  description: "标题，首尾空白会被去掉",
});

export const CreateTaskBodySchema = Type.Object(
  {
    title: Title,
    description: Type.Optional(Description),
    priority: Type.Optional(TaskPrioritySchema),
    assigneeId: Type.Optional(AssigneeId),
  },
  { additionalProperties: false },
);

export const UpdateTaskBodySchema = Type.Object(
  {
    title: Type.Optional(Title), // 同一个 Title 规则，在这里是可选的
    description: Type.Optional(Description),
    status: Type.Optional(TaskStatusSchema),
    priority: Type.Optional(TaskPrioritySchema),
    assigneeId: Type.Optional(AssigneeId),
  },
  { additionalProperties: false, minProperties: 1 },
);
```

`Title` 的规则只定义了一次，创建和修改共享它。以后把上限改成 200，两个接口同时生效。

TypeBox 也提供了类似 TypeScript 工具类型的 `Type.Pick`、`Type.Omit`、`Type.Partial`、`Type.Required`。但要注意一个容易踩的坑——实测：

```ts
const Base = Type.Object(
  { title: Type.String(), secret: Type.String() },
  { additionalProperties: false, $id: "Base" },
);

Type.Omit(Base, ["secret"]);
// {"type":"object","required":["title"],"properties":{"title":{"type":"string"}}}
//                                        ↑ additionalProperties: false 和 $id 都没了

Type.Pick(Base, ["title"], { additionalProperties: false });
// {"type":"object","required":["title"],"properties":{"title":{"type":"string"}},"additionalProperties":false}
```

变换后的对象**不会继承原对象的选项**。如果你依赖 `additionalProperties: false` 来防御批量赋值，用 `Pick`/`Omit`/`Partial` 派生 body schema 时，一定要在最后一个参数里把它重新写上。TaskHub 选择显式地列出 `UpdateTaskBodySchema` 的每个字段：多写几行，但每个请求体允许哪些字段一眼可见。

## 6.6 把 TypeBox 接入 Fastify：Type Provider

Fastify 本身并不认识 TypeBox，它只认 JSON Schema（TypeBox 生成的正好就是）。要让 Fastify **在类型层面**根据 schema 推断 `request.body` 等的类型，需要 **Type Provider**。

### 在应用实例上启用

```ts
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";

const app = Fastify(options).withTypeProvider<TypeBoxTypeProvider>();
```

`withTypeProvider` 不改变任何运行时行为，它只改变 `app` 的 **TypeScript 类型**。注意必须像上面这样链式调用、使用它的返回值；单独调用一句 `app.withTypeProvider<...>()` 而不接住返回值，是不起作用的。

### 在插件里启用

第 3 章说过插件会创建新的作用域，Type Provider 的类型也**不会自动传进插件函数的参数**。官方提供了现成的插件类型：

```ts
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

const taskRoutes: FastifyPluginAsyncTypebox<TaskRoutesOptions> =
  async function (app, options) {
    // 这里的 app 已经带着 TypeBoxTypeProvider
  };
```

TaskHub 的每个路由插件都用 `FastifyPluginAsyncTypebox` 声明。

### 效果

```ts
app.post(
  "/tasks",
  {
    schema: {
      body: CreateTaskBodySchema,
      response: { 201: ref(TaskSchema) },
    },
  },
  async (request, reply) => {
    request.body.title; // string —— 自动推断，没有任何 as
    request.body.priority; // 'low' | 'medium' | 'high' | undefined
    return reply.code(201).send(task); // send 的参数也会按 201 的响应 schema 检查
  },
);
```

写错时编译器会立刻报错。下面是在配套工程里故意写错后，`npm run typecheck` 的真实输出：

```ts
app.post(
  "/x",
  {
    schema: { body: CreateTaskBodySchema, response: { 201: ref(TaskSchema) } },
  },
  async (req, reply) => {
    const n: number = req.body.title;
    return reply.code(201).send({ id: 1 });
  },
);
```

```text
src/__probe.ts:6:11 - error TS2322: Type 'string' is not assignable to type 'number'.
6     const n: number = req.body.title
src/__probe.ts:7:35 - error TS2322: Type 'number' is not assignable to type 'string'.
7     return reply.code(201).send({ id: 1 })
  src/schemas/task.ts:28:3 - The expected type comes from property 'id' which is declared here on type
  '{ id: string; title: string; description: string | null; status: "doing" | "done" | "todo"; ... }'
```

输入和输出两个方向都被类型系统覆盖了。

### 导出 `Static` 类型给其他层用

业务层（service）不依赖 Fastify，但它需要知道“创建任务的输入长什么样”。从 schema 导出类型即可：

```ts
export type CreateTaskBody = Static<typeof CreateTaskBodySchema>

// src/modules/tasks/service.ts
async create (actor: UserRecord, body: CreateTaskBody): Promise<TaskRecord> { /* ... */ }
```

这样，service 的参数类型也和 HTTP 层的运行时规则同源。

## 6.7 类型与运行时之间仍然存在的落差

“同源”不等于“完全等价”。有几处落差必须心里有数。

### 落差一：`default` 只在运行时生效

```ts
export const PageQuery = {
  page: Type.Optional(
    Type.Integer({
      minimum: 1,
      default: DEFAULT_PAGE,
      description: "页码，从 1 开始",
    }),
  ),
  pageSize: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_PAGE_SIZE,
      default: DEFAULT_PAGE_SIZE /* ... */,
    }),
  ),
};
```

运行时 Ajv 会把缺失的 `page` 补成 `1`，但 TypeScript 看到的仍然是 `page?: number`。有两种选择：

- 去掉 `Optional`：类型变成 `page: number`，handler 不用兜底。但这样 OpenAPI 文档会把 `page` 标成**必填**，与“可以不传”的真实契约矛盾。
- 保留 `Optional`，在业务代码里用**同一组常量**兜底：`const page = query.page ?? DEFAULT_PAGE`。

TaskHub 选第二种：**文档的准确性优先**，并用共享常量保证两边的默认值不会漂移。

### 落差二：Ajv 会修改数据

第 5 章的类型转换、移除多余属性都发生在运行时。`Static` 推断的是“校验通过后的形状”，对 `"title": 123 → "123"` 这样的转换毫无感知。类型系统保证不了这些行为符合你的预期，**只有测试能保证**。

### 落差三：`Type.Ref` 推断为 `unknown`

下一节详述。

## 6.8 `$ref` 引用与类型：`ref()` 工具函数

第 8 章会讲用 `$id` 注册共享 schema、用 `$ref` 引用它们，这样 OpenAPI 文档里就能出现命名的 `Task`、`ErrorResponse` 模型。TypeBox 提供了 `Type.Ref`：

```ts
const T = Type.Ref("Task");
// 运行时：{ $ref: 'Task' }
// Static：unknown   ← TypeBox 1.x 官方文档明确如此
```

`Type.Ref('Task')` 只是一个字符串引用，TypeBox 在类型层面不知道 `'Task'` 指向什么，所以推断为 `unknown`。用在响应 schema 上，`reply.send()` 就失去了类型检查。

TaskHub 用 `Type.Unsafe` 把类型“接回来”：

```ts
// src/schemas/common.ts
/**
 * 生成一个指向共享 schema 的 $ref，同时保留 TypeScript 类型。
 *
 * TypeBox 1.x 的 Type.Ref('Task') 在类型层面只能推断为 unknown，
 * 所以这里用 Type.Unsafe 告诉 TypeScript：“这个 $ref 的值就是 Static<T>”。
 * 运行时产物仍然只是 { $ref: 'Task' }，真正的结构由 app.addSchema 注册。
 */
export function ref<T extends TSchema>(schema: T): TUnsafe<Static<T>> {
  const id = (schema as { $id?: unknown }).$id;
  if (typeof id !== "string") {
    throw new Error("只有带 $id 的 schema 才能被引用");
  }
  return Type.Unsafe<Static<T>>(Type.Ref(id));
}
```

用法：

```ts
response: { 200: ref(TaskSchema) }
// 运行时：{ $ref: 'Task' }
// 类型：Static<typeof TaskSchema>，reply.send / return 值都会被检查
```

`ref()` 接收的是 schema 对象本身而不是字符串，所以 id 不会拼错；如果忘了给 schema 设置 `$id`，启动时就会抛错。

> TypeBox 1.x 还提供了 `Type.Module` 和 `Type.Cyclic`，用于在一组定义内部相互引用（包括递归结构），它们会把引用**内联**或打包进 `$defs`。它们解决的是“TypeBox 内部的类型引用”，而我们要的是“Fastify 共享 schema 的 `$ref`”，所以 TaskHub 没有使用。遇到树形结构（如评论的嵌套回复）时再去读官方文档的 Cyclic 一节。

## 6.9 TaskHub 的 schema 文件

`src/schemas/task.ts` 的完整内容如下，后面三章会反复用到它：

```ts
import { Type, type Static } from "typebox";
import {
  IsoDateTime,
  Nullable,
  PageMetaSchema,
  PageQuery,
  ref,
  Uuid,
} from "./common.js";

// ---------- 可复用的字段 ----------

// 纯字符串枚举用 Type.Enum：生成 { enum: [...] }，校验错误和文档都比 Union<Literal> 简洁。
// Static 推断结果同样是 'todo' | 'doing' | 'done'。
export const TaskStatusSchema = Type.Enum(["todo", "doing", "done"], {
  description: "任务状态",
});

export const TaskPrioritySchema = Type.Enum(["low", "medium", "high"], {
  description: "优先级",
});

export type TaskStatus = Static<typeof TaskStatusSchema>;
export type TaskPriority = Static<typeof TaskPrioritySchema>;

const Title = Type.String({
  minLength: 1,
  maxLength: 120,
  description: "标题，首尾空白会被去掉",
});
const Description = Nullable(
  Type.String({ maxLength: 2000, description: "描述，可以为 null" }),
);
const AssigneeId = Nullable(
  Type.String({ format: "uuid", description: "负责人 ID，null 表示未指派" }),
);

// ---------- 对外的 Task 结构（响应） ----------

export const TaskSchema = Type.Object(
  {
    id: Uuid,
    title: Type.String(),
    description: Description,
    status: TaskStatusSchema,
    priority: TaskPrioritySchema,
    ownerId: Uuid,
    assigneeId: AssigneeId,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  },
  {
    $id: "Task",
    description:
      "对外公开的任务。内部字段（如 internalNote）不在此列，序列化时会被丢弃",
  },
);

export type Task = Static<typeof TaskSchema>;

export const TaskListSchema = Type.Object(
  {
    items: Type.Array(ref(TaskSchema)),
    page: ref(PageMetaSchema),
  },
  { $id: "TaskList", description: "一页任务及分页信息" },
);

export type TaskList = Static<typeof TaskListSchema>;

// ---------- 请求 ----------

export const TaskParamsSchema = Type.Object({
  taskId: Uuid,
});

/** headers 的 key 一律写小写：Node.js 收到的请求头名都是小写 */
export const UpdateTaskHeadersSchema = Type.Object({
  "if-match": Type.Optional(
    Type.String({
      pattern: '^"[0-9]+"$',
      description:
        '可选。传入上次读到的 ETag（如 "3"），若任务已被他人修改则返回 412',
    }),
  ),
});

export const CreateTaskBodySchema = Type.Object(
  {
    title: Title,
    description: Type.Optional(Description),
    priority: Type.Optional(TaskPrioritySchema),
    assigneeId: Type.Optional(AssigneeId),
  },
  {
    // 未声明的字段（如 ownerId、status）会被 Fastify 的 Ajv 配置直接移除，
    // 防止客户端“顺手”改到不该改的字段（mass assignment）
    additionalProperties: false,
    examples: [{ title: "整理发布清单", priority: "high" }],
  },
);

export type CreateTaskBody = Static<typeof CreateTaskBodySchema>;

export const UpdateTaskBodySchema = Type.Object(
  {
    title: Type.Optional(Title),
    description: Type.Optional(Description),
    status: Type.Optional(TaskStatusSchema),
    priority: Type.Optional(TaskPrioritySchema),
    assigneeId: Type.Optional(AssigneeId),
  },
  {
    additionalProperties: false,
    minProperties: 1,
    description: "只传需要修改的字段；至少传一个",
  },
);

export type UpdateTaskBody = Static<typeof UpdateTaskBodySchema>;

export const DEFAULT_TASK_SORT = "-createdAt";

export const TaskSortSchema = Type.Enum(
  ["createdAt", "-createdAt", "priority", "-priority", "title", "-title"],
  {
    default: DEFAULT_TASK_SORT,
    description: "排序字段，前缀 - 表示降序；同值时按 id 升序保证稳定",
  },
);

export type TaskSort = Static<typeof TaskSortSchema>;

export const ListTasksQuerySchema = Type.Object(
  {
    ...PageQuery,
    sort: Type.Optional(TaskSortSchema),
    status: Type.Optional(TaskStatusSchema),
    assigneeId: Type.Optional(Uuid),
  },
  { additionalProperties: false },
);

export type ListTasksQuery = Static<typeof ListTasksQuerySchema>;
```

和第 5 章手写的 JSON Schema 对照，你会发现生成物几乎一样；区别是每个 schema 旁边都有一个从它推断出的类型。

## 6.10 TypeBox 的其他能力（了解即可）

- **`Value` 模块**（`import { Value } from 'typebox/value'`）：在 Fastify 之外校验数据，例如 `Value.Check(TaskSchema, data)`。第 14 章的契约测试就用它检查真实响应是否符合文档声明的 schema。
- **`Type.Script`**：用 TypeScript 类型语法的字符串定义 schema，如 ``Type.Script(`{ x: number }`)``。
- **`TypeBoxValidatorCompiler`**：`@fastify/type-provider-typebox` 提供的另一种校验器，用 TypeBox 自己的编译器替代 Ajv。它对 body 不做类型转换，但也不支持 Ajv 的 `useDefaults`、`removeAdditional` 等行为。TaskHub 保持使用 Fastify 默认的 Ajv，以便和 Fastify 文档描述的行为一致。

## 6.11 练习

1. 用 TypeBox 写出第 5 章练习 1 的 `tag` 查询参数，并写出它的 `Static` 类型。
2. 下面的代码有什么问题？

   ```ts
   const UpdateBody = Type.Partial(CreateTaskBodySchema);
   ```

3. 为什么 `ref()` 接收 schema 对象而不是字符串 `'Task'`？
4. 有人把 `page` 改成了 `Type.Integer({ minimum: 1, default: 1 })`（去掉 `Optional`），handler 里的 `?? DEFAULT_PAGE` 就可以删掉了。这样做有什么代价？

**参考答案**

1. ```ts
   tag: Type.Optional(
     Type.Array(Type.String({ minLength: 1, maxLength: 20 }), { maxItems: 5 }),
   );
   // Static: tag?: string[]
   ```
2. `Type.Partial` 生成的对象**丢失了 `additionalProperties: false`**，客户端多传的 `ownerId` 不会再被移除；同时它也无法表达 `status` 只出现在更新接口中这类差异。应显式写出 `UpdateTaskBodySchema`，或至少 `Type.Partial(X, { additionalProperties: false })`。
3. 字符串会拼错且编译器发现不了；传对象可以从它推断出 `Static<T>` 类型，并在运行时检查它确实有 `$id`。
4. `page` 会进入 `required`，OpenAPI 文档和 Scalar/Swagger UI 会把它显示成必填参数，客户端开发者会以为每次都必须传。运行时虽然能工作（Ajv 先补默认值再检查 required），但对外契约被描述错了。

## 本章验收

- [ ] 能用 `Type.Object/String/Integer/Array/Enum/Literal/Union/Optional` 写出 schema，并说出它们生成的 JSON Schema。
- [ ] 能用 `Static<typeof X>` 推断类型，并解释“同源”的含义。
- [ ] 能说明什么时候用 `Enum`、什么时候用 `Union` + `Literal`，以及可为 null 的字段为什么用 type 数组。
- [ ] 能在应用和插件两个层面接入 Type Provider，并让 `request.body`、`reply.send` 都获得类型检查。
- [ ] 能说出 `default`、类型转换、`Type.Ref` 三处类型与运行时的落差，以及 TaskHub 的应对方式。
- [ ] 知道 `Pick/Omit/Partial` 会丢失对象选项。

官方阅读：[TypeBox 文档](https://sinclairzx81.github.io/typebox/)（Type、Static、Optional、Union、Literal、Enum、Ref、Unsafe、Module 各节）、[Fastify Type Providers](https://fastify.dev/docs/latest/Reference/Type-Providers/)、[@fastify/type-provider-typebox](https://github.com/fastify/fastify-type-provider-typebox)。

下一章，[用响应 schema 控制输出](./07-response-schema.md)。
