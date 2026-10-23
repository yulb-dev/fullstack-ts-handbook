# 第 8 章：共享 schema、`$id` 与业务规则的边界

[上一章](./07-response-schema.md) · [目录](./README.md) · [下一章](./09-error-model.md)

本章回答两个问题：

1. 同一个 `Task` 结构被五个路由用到，怎样复用它，又让 API 文档里出现一个命名的 `Task` 模型？——用 `$id` 注册共享 schema，用 `$ref` 引用。
2. “标题 1~120 字”和“同一个人不能有两个同名任务”看上去都是“校验”，为什么一个写在 schema 里，另一个写在 service 里？——结构校验与业务规则的边界。

## 8.1 两种复用方式

第 6 章已经用过第一种：**在 JS 层面复用**，把 schema 放进常量再 import。

```ts
const Title = Type.String({ minLength: 1, maxLength: 120 });
// CreateTaskBodySchema 和 UpdateTaskBodySchema 都用到了 Title
```

它在运行时的效果是**内联**：两个路由的 schema 里各自有一份完整的 `{ type: 'string', minLength: 1, maxLength: 120 }`。对 Ajv 和序列化器来说没有任何问题，但生成 OpenAPI 文档时，每个用到它的地方都会展开成一段匿名结构。

第二种是**在 JSON Schema 层面复用**：给 schema 一个 `$id`，注册到 Fastify，别处用 `{ $ref: '<id>' }` 引用。

```ts
export const TaskSchema = Type.Object({ /* ... */ }, { $id: 'Task' })

app.addSchema(TaskSchema)                       // 注册
response: { 200: { $ref: 'Task' } }             // 引用（TaskHub 用 ref(TaskSchema) 生成它）
```

在 OpenAPI 文档里，它会变成 `components.schemas.Task`，所有引用处显示为 `#/components/schemas/Task`。Scalar 和 Swagger UI 会把它渲染成一个可点击的“模型”。

|            | JS 常量复用                       | `$id` + `$ref` 复用                                           |
| ---------- | --------------------------------- | ------------------------------------------------------------- |
| 写法       | `import { Title }`                | `addSchema` + `ref(TaskSchema)`                               |
| 运行时     | 内联展开                          | Fastify 在编译时解析引用                                      |
| OpenAPI 中 | 匿名、重复展开                    | 命名模型，集中定义                                            |
| 适合       | 字段级的小规则（`Title`、`Uuid`） | 对外有名字的实体与结构（`Task`、`ErrorResponse`、`PageMeta`） |

TaskHub 两种都用：字段级规则用常量，领域实体和通用响应结构用 `$id`。

## 8.2 `$id` 与 `addSchema`

在 JSON Schema 规范里，`$id` 是一个 URI，用来**标识**这份 schema，`$ref` 用这个 URI 来指向它。Fastify 接受完整的 URI（如 `http://example.com/task.json`），也接受简单的名字（如 `Task`）。下面几种写法在 Fastify 中都可用：

```ts
{
  $ref: "Task";
} // 引用 $id 为 Task 的共享 schema
{
  $ref: "Task#";
} // 同上，显式指向根
{
  $ref: "Common#/properties/id";
} // 引用共享 schema 内部的一部分（JSON Pointer）
{
  $ref: "#/definitions/address";
} // 引用当前 schema 内部的 definitions
```

`addSchema` 的几条规则（均为实测）：

- schema 必须有 `$id`，否则抛 `FST_ERR_SCH_MISSING_ID`。
- 同一作用域重复注册同一个 `$id`，抛 `FST_ERR_SCH_ALREADY_PRESENT`。
- 注册的 schema 同时提供给**校验器（Ajv）**和**序列化器（fast-json-stringify）**使用——这是 Fastify 让两者共享的唯一渠道。
- `app.getSchemas()` 返回当前作用域可见的全部共享 schema，`app.getSchema('Task')` 返回单个。

## 8.3 共享 schema 也遵守封装规则

第 3 章的封装规则对 `addSchema` 同样成立。下面这段代码在子插件 A 里注册 schema，在兄弟插件 B 里引用：

```ts
const app = Fastify();
app.register(async (a) => {
  a.addSchema({
    $id: "Thing",
    type: "object",
    properties: { x: { type: "string" } },
  });
});
app.register(async (b) => {
  b.post("/t", { schema: { body: { $ref: "Thing#" } } }, async () => "ok");
});
await app.ready();
```

实际结果：**启动失败**。

```text
FST_ERR_SCH_VALIDATION_BUILD Failed building the validation schema for POST: /t,
due to error can't resolve reference Thing# from id #
```

好消息是它在**启动时**就失败了，不会带病上线。解决方法和装饰器一样：把共享 schema 注册在根作用域，并且**在路由之前**注册。TaskHub 专门写了一个插件：

```ts
// src/plugins/shared-schemas.ts
import fp from "fastify-plugin";
import {
  ErrorDetailSchema,
  ErrorResponseSchema,
  PageMetaSchema,
} from "../schemas/common.js";
import { TaskListSchema, TaskSchema } from "../schemas/task.js";
import { PublicUserSchema } from "../schemas/user.js";

/**
 * 注册所有带 $id 的共享 schema。
 *
 * addSchema 是“封装”的：在子插件里注册的 schema，父级和兄弟插件里的路由引用不到，
 * 启动时会报 FST_ERR_SCH_VALIDATION_BUILD（can't resolve reference）。
 * 这里用 fastify-plugin 把它们注册到根实例上，所有路由都可以 { $ref: 'Task' }，
 * @fastify/swagger 也会把它们放进 components.schemas。
 */
export default fp(
  async function sharedSchemasPlugin(app) {
    for (const schema of [
      ErrorDetailSchema,
      ErrorResponseSchema,
      PageMetaSchema,
      PublicUserSchema,
      TaskSchema,
      TaskListSchema,
    ]) {
      app.addSchema(schema);
    }
  },
  { name: "shared-schemas", fastify: "5.x" },
);
```

在 `buildApp` 里，它排在所有路由之前。

### 什么时候反而应该“封装”共享 schema？

如果一个大型应用有多个团队各自维护模块，模块 A 内部的 `Draft` 结构不应被模块 B 依赖，那就在 A 的插件里 `addSchema`，让封装规则帮你守住边界。但要注意，`$id` 在整个应用（以及生成的 OpenAPI 文档）里最好保持唯一——@fastify/swagger 源码中的注释也提到，不同作用域里同名的 `$id` 在合并文档时后者会覆盖前者。

## 8.4 共享 schema 之间的引用

共享 schema 自己也可以引用其他共享 schema：

```ts
export const TaskListSchema = Type.Object(
  {
    items: Type.Array(ref(TaskSchema)), // → { $ref: 'Task' }
    page: ref(PageMetaSchema), // → { $ref: 'PageMeta' }
  },
  { $id: "TaskList", description: "一页任务及分页信息" },
);

export const ErrorResponseSchema = Type.Object(
  {
    /* ... */
    details: Type.Optional(Type.Array(ref(ErrorDetailSchema))), // → { $ref: 'ErrorDetail' }
  },
  { $id: "ErrorResponse", description: "所有非 2xx 响应的统一结构" },
);
```

所以注册时要把被引用的 `Task`、`PageMeta`、`ErrorDetail` 也一并注册。漏注册任何一个，启动时都会得到 `can't resolve reference` 错误。

回顾第 6 章的 `ref()`：它在运行时生成 `{ $ref: 'Task' }`，在类型层面保留 `Static<typeof TaskSchema>`。于是 `TaskList` 的推断类型是 `{ items: Task[], page: PageMeta }`，handler 返回值、service 的返回类型都能被正确检查。

## 8.5 结构校验 vs 业务规则

现在进入本章的第二个主题。看 TaskHub 创建任务时的全部规则：

| 规则                               | 需要知道什么才能判断 | 属于 | 在哪里实现       | 失败时                    |
| ---------------------------------- | -------------------- | ---- | ---------------- | ------------------------- |
| body 是对象                        | 只看这一个请求       | 结构 | schema           | 400 `VALIDATION_FAILED`   |
| `title` 是 1~120 字的字符串        | 只看这一个请求       | 结构 | schema           | 400                       |
| `priority` 是 low/medium/high 之一 | 只看这一个请求       | 结构 | schema           | 400                       |
| `assigneeId` 是 UUID 或 null       | 只看这一个请求       | 结构 | schema           | 400                       |
| `assigneeId` 对应的用户存在        | 用户表               | 业务 | service          | 422 `ASSIGNEE_NOT_FOUND`  |
| 同一个人没有同名任务               | 任务表               | 业务 | service          | 409 `TASK_TITLE_CONFLICT` |
| 调用者已登录                       | 会话/凭证存储        | 认证 | `onRequest` hook | 401                       |

判断标准很简单：**只看这一个请求本身就能回答的，是结构校验；需要查数据库、需要知道系统当前状态的，是业务规则。**

### 为什么业务规则不能写进 schema？

Ajv 支持自定义关键字，甚至支持 `$async` 异步校验，理论上可以写出“查数据库确认用户存在”的 schema。不要这样做：

1. **安全**：Fastify 文档明确警告，在校验阶段访问数据库可能导致拒绝服务攻击。校验发生在授权之前，任何能发请求的人都能触发这些查询。
2. **错误语义**：schema 失败一律是 400。但“指派人不存在”和“标题重复”是不同性质的问题，客户端需要区分（第 9 章）。
3. **状态会变**：校验时用户存在，写入时可能已被删除。业务规则需要和写操作放在一起考虑（理想情况下在同一个数据库事务里），而校验阶段做不到。
4. **可测试性与复用**：放在 service 里的规则不依赖 HTTP，可以直接单元测试，也能被消息队列消费者、命令行脚本等其他入口复用。

反过来，**结构校验也不要写在 service 里**。如果 service 里出现 `if (typeof body.title !== 'string')`，说明 schema 没写好。schema 校验在 handler 之前执行、在启动时编译、自动进入 API 文档——这些好处在 service 里都没有。

### 一个灰色地带：只依赖“当前对象”的状态规则

“已完成的任务只能修改状态”需要先加载任务、看它的当前 `status`，所以它也是业务规则（返回 409 `TASK_ALREADY_DONE`）。而“PATCH 至少要传一个字段”只看请求本身，所以是结构规则（`minProperties: 1`）。

## 8.6 业务层：`src/modules/tasks/service.ts`

```ts
import type {
  Store,
  TaskPatch,
  TaskRecord,
  UserRecord,
} from "../../data/memory-store.js";
import { AppError } from "../../errors/app-error.js";
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  type PageMeta,
} from "../../schemas/common.js";
import {
  DEFAULT_TASK_SORT,
  type CreateTaskBody,
  type ListTasksQuery,
  type UpdateTaskBody,
} from "../../schemas/task.js";

/**
 * 业务规则层。
 * schema 只能回答“数据长得对不对”（结构校验）；
 * 这里回答“数据在当前系统状态下是否允许”（业务规则），这类判断往往需要查数据库。
 * 它不依赖 Fastify 的 request/reply，可以单独测试，也可以被别的入口（队列、CLI）复用。
 */
export function createTaskService(db: Store) {
  function canRead(actor: UserRecord, task: TaskRecord): boolean {
    return (
      actor.role === "admin" ||
      task.ownerId === actor.id ||
      task.assigneeId === actor.id
    );
  }

  async function assertAssigneeExists(
    assigneeId: string | null | undefined,
  ): Promise<void> {
    if (!assigneeId) return;
    if (!(await db.users.findById(assigneeId))) {
      throw new AppError("ASSIGNEE_NOT_FOUND", {
        details: [
          {
            location: "body",
            field: "/assigneeId",
            rule: "exists",
            message: "用户不存在",
          },
        ],
      });
    }
  }

  async function assertTitleAvailable(
    ownerId: string,
    title: string,
    exceptTaskId?: string,
  ): Promise<void> {
    const existing = await db.tasks.findByOwnerAndTitle(ownerId, title);
    if (existing && existing.id !== exceptTaskId)
      throw new AppError("TASK_TITLE_CONFLICT");
  }

  return {
    async list(
      actor: UserRecord,
      query: ListTasksQuery,
    ): Promise<{ items: TaskRecord[]; page: PageMeta }> {
      // 运行时 Ajv 已经按 schema 的 default 补齐了这些值，这里的兜底只是为了让类型完整
      const page = query.page ?? DEFAULT_PAGE;
      const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
      const { items, total } = await db.tasks.list({
        ...(actor.role === "admin" ? {} : { visibleTo: actor.id }),
        ...(query.status ? { status: query.status } : {}),
        ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
        sort: query.sort ?? DEFAULT_TASK_SORT,
        page,
        pageSize,
      });
      return {
        items,
        page: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      };
    },

    /** 看不到的任务一律当作不存在（404），不用 403 暴露“这个 ID 存在” */
    async getVisible(actor: UserRecord, taskId: string): Promise<TaskRecord> {
      const task = await db.tasks.findById(taskId);
      if (!task || !canRead(actor, task)) throw new AppError("TASK_NOT_FOUND");
      return task;
    },

    /** 能看到但不是负责人/管理员：明确告诉调用方“没权限”（403） */
    assertCanWrite(actor: UserRecord, task: TaskRecord): void {
      if (actor.role !== "admin" && task.ownerId !== actor.id)
        throw new AppError("FORBIDDEN");
    },

    async create(actor: UserRecord, body: CreateTaskBody): Promise<TaskRecord> {
      await assertAssigneeExists(body.assigneeId);
      await assertTitleAvailable(actor.id, body.title);
      return db.tasks.insert({
        title: body.title,
        description: body.description ?? null,
        status: "todo",
        priority: body.priority ?? "medium",
        ownerId: actor.id,
        assigneeId: body.assigneeId ?? null,
        internalNote: "",
      });
    },

    async update(task: TaskRecord, patch: UpdateTaskBody): Promise<TaskRecord> {
      const changingOtherThanStatus = Object.keys(patch).some(
        (key) => key !== "status",
      );
      if (task.status === "done" && changingOtherThanStatus)
        throw new AppError("TASK_ALREADY_DONE");

      if (patch.title !== undefined)
        await assertTitleAvailable(task.ownerId, patch.title, task.id);
      await assertAssigneeExists(patch.assigneeId);

      const changes: TaskPatch = {};
      if (patch.title !== undefined) changes.title = patch.title;
      if (patch.description !== undefined)
        changes.description = patch.description;
      if (patch.status !== undefined) changes.status = patch.status;
      if (patch.priority !== undefined) changes.priority = patch.priority;
      if (patch.assigneeId !== undefined) changes.assigneeId = patch.assigneeId;
      // { ownerId: 'x' } 这样的请求能通过 minProperties，但未知字段随后被 Ajv 移除，
      // 最终没有任何可改的字段：原样返回，不产生新版本
      if (Object.keys(changes).length === 0) return task;
      return db.tasks.update(task.id, changes);
    },

    async remove(task: TaskRecord): Promise<void> {
      await db.tasks.delete(task.id);
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
```

几个设计要点：

- **service 的输入类型来自 schema**（`CreateTaskBody`、`UpdateTaskBody` 都是 `Static<...>`），所以它可以信任输入的形状，只关心业务含义。
- **service 抛出 `AppError`，而不是返回 HTTP 状态码**。`AppError('ASSIGNEE_NOT_FOUND')` 表达的是业务事实，状态码映射集中在错误目录里（第 9 章）。
- **`ASSIGNEE_NOT_FOUND` 也带了 `details`**，格式与 schema 校验错误一致（`location`/`field`/`rule`/`message`）。前端表单可以用同一套逻辑，把两类错误都高亮到 `assigneeId` 输入框上。
- **`create` 显式地挑选字段**，而不是 `{ ...body, ownerId }`。即使 schema 里哪天漏了 `additionalProperties: false`，`ownerId`、`status` 也只能来自服务端。这是对第 5 章“移除多余属性”的又一层防御。

### 单独测试业务规则

因为 service 不依赖 Fastify，可以直接 new 一个内存数据库来测试（`test/task-service.test.ts`）：

```ts
it("同一个人不能创建同名任务，不同的人可以", async () => {
  const { service, alice, bob } = setup();
  await expect(
    service.create(alice, { title: "准备周会材料" }),
  ).rejects.toMatchObject({ code: "TASK_TITLE_CONFLICT" });
  await expect(
    service.create(bob, { title: "准备周会材料" }),
  ).resolves.toMatchObject({ ownerId: bob.id });
});
```

HTTP 层的测试（`test/tasks.test.ts`）再验证同一规则对外表现为 409 和统一的错误结构。两层测试各管一件事。

## 8.7 “先查再写”的并发问题

`assertTitleAvailable` 先查询是否存在同名任务，没有再插入。在内存实现里这是安全的（单线程、两步之间没有 `await` 让出给另一个请求修改数据）。但在真实数据库上，两个并发请求可能**同时**查到“不存在”，然后都插入成功。

真正可靠的做法是把唯一性交给数据库：

1. 在表上建唯一约束，如 `UNIQUE (owner_id, title)`；
2. 插入时如果违反约束，数据库返回特定错误（Postgres 的错误码是 `23505`）；
3. 数据层捕获这个错误，转换成 `AppError('TASK_TITLE_CONFLICT')`。

service 里的“先查”仍然有价值——它能在大多数情况下给出友好的错误，但**最终防线是数据库约束**。同样的道理适用于库存、余额等所有“检查后修改”的业务规则。

## 8.8 练习

1. 产品新增规则：“一个成员最多同时有 50 个未完成的任务”。它是结构校验还是业务规则？应该在哪里实现、返回什么状态码？
2. 新增规则：“截止日期 `dueDate` 必须是 `YYYY-MM-DD` 格式”。同上。
3. 新增规则：“截止日期不能早于今天”。同上。
4. 有人把 `addSchema(TaskSchema)` 挪到了任务路由插件内部。`/v1/tasks` 的路由还能工作吗？`/v1/me` 的路由需要引用 `Task` 吗？如果以后用户模块需要返回“我的任务”，会发生什么？

**参考答案**

1. 业务规则：需要查询当前未完成任务数量。在 service 的 `create` 中实现，返回 409（与当前资源状态冲突）或 422（请求语义上无法处理），团队选定一个并写进错误目录，例如 `TASK_QUOTA_EXCEEDED`。
2. 结构校验：`Type.String({ format: 'date' })`，失败返回 400。
3. 依赖“今天”这个服务端时间，严格说不只看请求本身。常见做法是在 service 里检查（返回 422），因为客户端时区、服务端时钟都会影响结果，放在 schema 里也很难表达。
4. 任务路由仍然可以工作（它们在同一个作用域里）。`/v1/me` 不需要 `Task`。但以后用户模块一旦引用 `Task`，就会在启动时得到 `can't resolve reference` 错误，因为用户模块是任务模块的兄弟作用域，看不到它注册的 schema。对外公开的实体 schema 应当注册在根作用域。

## 本章验收

- [ ] 能说出 JS 常量复用与 `$id`/`$ref` 复用的区别，以及各自适合的场景。
- [ ] 能用 `addSchema` 注册共享 schema，用 `$ref` 引用，并知道缺少 `$id`、重复 `$id` 的报错。
- [ ] 能解释 `addSchema` 的封装范围，复现“兄弟作用域引用失败”的启动错误，并给出解决方案。
- [ ] 能对任意一条规则判断它属于结构校验还是业务规则，并说出放错位置的后果。
- [ ] 能解释“先查再写”在并发下的问题，以及数据库约束作为最终防线的做法。

官方阅读：[Validation and Serialization：Adding a shared schema](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/#adding-a-shared-schema)、[JSON Schema：Structuring a complex schema](https://json-schema.org/understanding-json-schema/structuring)、[TypeBox：Ref](https://sinclairzx81.github.io/typebox/#/docs/type/ref)。

下一章，[建立统一、稳定、安全的错误模型](./09-error-model.md)。
