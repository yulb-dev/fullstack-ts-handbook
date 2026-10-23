# 第 7 章：响应 schema——控制输出形状，防止字段泄露

[上一章](./06-typebox.md) · [目录](./README.md) · [下一章](./08-shared-schemas-and-business-rules.md)

前两章守住了“进来的数据”。本章守住“出去的数据”。

很多数据泄露事故并不是被黑客攻破，而是开发者在 handler 里 `return user`，把数据库里的 `passwordHash`、`email`、内部备注原样发给了客户端。TypeScript 发现不了这种问题，代码审查也很容易漏看。Fastify 的**响应 schema** 是专门针对这类问题的防线。

## 7.1 问题：数据库记录比 API 契约“胖”

TaskHub 的数据层里，记录类型故意比对外的类型多出几个字段：

```ts
// src/data/memory-store.ts
export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** 教程为了简单直接保存明文 token；真实项目应只保存哈希，或改用 JWT / 会话 */
  apiToken: string;
}

export interface TaskRecord extends Task {
  /** 仅供内部运营查看的备注，绝不能出现在 API 响应里 */
  internalNote: string;
  /** 每次更新 +1，用来生成 ETag 做乐观并发控制 */
  version: number;
}
```

这在真实项目里非常常见：表里总会有审计字段、软删除标记、内部状态、外部系统 ID……而 `/v1/me` 的 handler 是这样写的：

```ts
}, async (request) => currentUser(request))   // 返回的是完整 UserRecord，包含 apiToken
```

如果没有响应 schema，客户端就会收到自己（甚至别人）的 `apiToken`。

## 7.2 响应 schema：按状态码声明输出形状

在路由的 `schema.response` 里，**以状态码为键**声明每种响应的结构：

```ts
app.get(
  "/me",
  {
    schema: {
      response: {
        // handler 返回的是完整的 UserRecord（含 email、apiToken），
        // 响应 schema 只允许 id/name/role 通过
        200: ref(PublicUserSchema),
        ...errorResponses(401),
      },
    },
  },
  async (request) => currentUser(request),
);
```

```ts
// src/schemas/user.ts
/** 对外公开的用户信息。注意：这里刻意没有 email 和 apiToken。 */
export const PublicUserSchema = Type.Object(
  {
    id: Uuid,
    name: Type.String(),
    role: UserRoleSchema,
  },
  { $id: "PublicUser", description: "对外公开的用户信息" },
);
```

实际响应：

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "name": "Alice",
  "role": "member"
}
```

`email` 和 `apiToken` 不见了。配套测试把这一点固定下来：

```ts
it("/v1/me 返回的用户信息不包含 email 与 apiToken", async () => {
  const app = await createTestApp();
  const response = await app.inject({
    url: "/v1/me",
    headers: bearer("alice"),
  });
  expect(response.json()).toEqual({
    id: SEED_IDS.alice,
    name: "Alice",
    role: "member",
  });
});
```

任务接口也是同样的道理：`TaskSchema` 里没有 `internalNote` 和 `version`，所以它们永远不会出现在响应里。

## 7.3 序列化器到底做了什么：一组实验

响应 schema 由 **fast-json-stringify** 处理：Fastify 在启动时把它编译成一个专用的序列化函数。它的行为和校验器 Ajv **很不一样**，必须亲手验证。用下面这个 schema 做实验（真实输出）：

```js
const S = {
  type: "object",
  required: ["id", "title"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    count: { type: "integer" },
    at: { type: "string", format: "date-time" },
  },
};
```

| handler 返回                                            | 响应 schema                                 | 结果                                                                      | 说明                                         |
| ------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- |
| `{ id: 'a', title: 't', secret: 's' }`                  | `200: S`                                    | `200 {"id":"a","title":"t"}`                                              | **未声明的字段被丢弃**                       |
| `{ id: 1, title: true, count: '7', at: new Date(...) }` | `200: S`                                    | `200 {"id":"1","title":"true","count":7,"at":"2026-01-01T00:00:00.000Z"}` | **按 schema 转换类型**，Date 转成 ISO 字符串 |
| `{ id: 'a', title: 't', count: 'abc' }`                 | `200: S`                                    | `500 The value "abc" cannot be converted to an integer.`                  | 无法转换时抛错                               |
| `{ id: 'a' }`                                           | `200: S`                                    | `500 "title" is required!`                                                | 缺少 required 字段时抛错                     |
| `reply.code(201).send({ ..., secret: 's' })`            | 只声明了 `200`                              | `201 {"id":"a","title":"t","secret":"s"}`                                 | ⚠️ **没有声明的状态码不经过过滤！**          |
| `{ ..., secret: 's' }`                                  | `200: { ...S, additionalProperties: true }` | `200 {..., "secret":"s"}`                                                 | ⚠️ 显式允许额外属性时不过滤                  |
| `reply.code(201).send({ ..., secret: 's' })`            | `'2xx': S`                                  | `201 {"id":"a","title":"t"}`                                              | `2xx` 覆盖整个范围                           |

从实验中得出四条结论：

1. **序列化是“过滤 + 转换”，不是“校验”**。它不会因为 `title` 是布尔值就拒绝，而是把它转成 `"true"`。只有在完全无法转换或缺少 required 字段时才抛错（结果是 500）。所以响应 schema 能防泄露，但**不能**替代对输出正确性的测试——第 14 章的契约测试会专门处理这一点。
2. **一定要为每个会返回的状态码声明 schema**。实验第五行是最危险的情况：路由只声明了 `200`，但 handler 返回了 `201`，于是对象被 `JSON.stringify` 原样输出，`secret` 泄露了。TaskHub 的创建接口返回 201，所以它声明的是 `201: ref(TaskSchema)`。
3. **响应 schema 里永远不要写 `additionalProperties: true`**（对代表实体的对象而言）。
4. 状态码键可以是具体值（`200`）、范围（`'2xx'`、`'4xx'`）或 `default`。具体值优先于范围。

## 7.4 错误响应也会经过响应 schema

Fastify 文档特别提醒：**路由级的响应 schema 同样作用于错误处理器发出的响应**。如果你给某个路由声明了 `404: ErrorResponse`，那么错误处理器发送的 404 也会按 `ErrorResponse` 过滤。

这是一把双刃剑：

- 好处：错误处理器即使不小心带上了 `stack`，只要 `ErrorResponse` 里没声明它，就会被丢弃。
- 风险：如果错误处理器发出了某个状态码，而路由没有声明它，就走 `JSON.stringify`，原样输出。

TaskHub 的做法是：错误处理器只输出固定的几个字段（第 9 章），**同时**每个路由都用 `errorResponses(...)` 声明了自己可能返回的错误状态码。两道防线，各管一边。

```ts
// src/schemas/common.ts
/**
 * 为路由生成错误响应声明，例如 errorResponses(400, 401, 404)。
 * 每个状态码都用同一个 ErrorResponse 结构，并在文档里列出该状态码对应的错误码。
 * （列出的是整个 API 的错误码目录中该状态码下的所有 code，不一定每个都会在这个路由出现。）
 */
export function errorResponses<const S extends number>(
  ...statusCodes: S[]
): Record<S, typeof ErrorResponseRef> {
  const result = {} as Record<S, typeof ErrorResponseRef>;
  for (const status of statusCodes) {
    const codes = (Object.keys(ErrorCatalog) as ErrorCode[]).filter(
      (code) => ErrorCatalog[code].statusCode === status,
    );
    // description 会成为 OpenAPI 中该响应的说明
    result[status] = Type.Unsafe<ErrorResponse>(
      Type.Ref("ErrorResponse", {
        description: `错误码目录中对应 ${status} 的 code：${codes.join("、") || "见 ErrorResponse"}`,
      }),
    );
  }
  return result;
}
```

它还有一个附带好处：OpenAPI 文档里每个错误状态码都会带上说明，比如“错误码目录中对应 409 的 code：TASK_TITLE_CONFLICT、TASK_ALREADY_DONE”（第 11 章）。

## 7.5 同一份数据，不同受众，不同 schema

响应 schema 是**按路由**声明的，这让“同一条记录对不同调用者展示不同字段”变得很自然：

```ts
// src/modules/users/routes.ts
/** 管理员视角的用户：比 PublicUser 多一个 email，但仍然没有 apiToken */
const AdminUserViewSchema = Type.Object({
  id: Uuid,
  name: Type.String(),
  email: Type.String({ format: "email" }),
  role: UserRoleSchema,
});

app.get(
  "/admin/users/:userId",
  {
    onRequest: app.requireRole("admin"),
    schema: {
      params: Type.Object({ userId: Uuid }),
      response: {
        200: AdminUserViewSchema,
        ...errorResponses(400, 401, 403, 404),
      },
    },
  },
  async (request) => {
    const user = await app.db.users.findById(request.params.userId);
    if (!user) throw new AppError("USER_NOT_FOUND");
    return user;
  },
);
```

两个 handler 返回的都是完整的 `UserRecord`，但普通用户看到 3 个字段，管理员看到 4 个，`apiToken` 对谁都不可见。不同视图的差别**写在 schema 里**，而不是散落在 handler 的 `delete user.xxx` 中。

## 7.6 没有响应体：204

删除成功时返回 `204 No Content`，没有响应体：

```ts
app.delete(
  "/tasks/:taskId",
  {
    preHandler: loadWritableTask,
    schema: {
      params: TaskParamsSchema,
      response: {
        204: Type.Null({ description: "删除成功，无响应体" }),
        ...errorResponses(400, 401, 403, 404),
      },
    },
  },
  async (request, reply) => {
    const task = loadedTask(request);
    await app.taskService.remove(task);
    request.log.info({ taskId: task.id }, "task deleted");
    return reply.code(204).send(null);
  },
);
```

- `Type.Null()` 生成 `{ type: 'null' }`，@fastify/swagger 文档建议空响应这样声明，生成的 OpenAPI 中该响应没有 `content`。
- 因为 204 的响应类型被推断为 `null`，TypeScript 要求 `send(null)`，而不是 `send()`。
- 测试断言 `response.body === ''`：Fastify 对 204 不会发送响应体。

## 7.7 不要把响应 schema 当成唯一防线

响应 schema 是**最后一道**防线，不应该是唯一的一道：

1. **数据层只查需要的列**。真实数据库里，`SELECT *` 再依赖序列化器过滤，意味着敏感数据已经进入了应用内存、可能进入日志（第 13 章）、可能被别的代码路径用到。
2. **敏感字段本来就不该“可被序列化”**。比如密码只存哈希，token 只存哈希。
3. **测试断言响应的完整键集合**，而不只是“某个字段存在”：

   ```ts
   it("响应 schema 会丢弃未声明的字段（internalNote、version 不会泄露）", async () => {
     const app = await createTestApp();
     const response = await app.inject({
       url: `/v1/tasks/${SEED_IDS.aliceTask}`,
       headers: bearer("alice"),
     });

     expect(response.statusCode).toBe(200);
     const body = response.json();
     expect(Object.keys(body).sort()).toEqual([
       "assigneeId",
       "createdAt",
       "description",
       "id",
       "ownerId",
       "priority",
       "status",
       "title",
       "updatedAt",
     ]);
     expect(body).not.toHaveProperty("internalNote");
     expect(response.headers.etag).toBe('"1"');
   });
   ```

   用 `toEqual` 比较完整键列表，以后有人给 `TaskSchema` 加字段时测试会失败，迫使他确认“这个字段真的应该公开吗”。

## 7.8 性能：顺带的收益

Fastify 文档提到，提供响应 schema 能带来可观的吞吐量提升（Routes 文档中的说法是 10%~20%）。原因是 fast-json-stringify 根据 schema 预先生成了专用的拼接代码，不必像 `JSON.stringify` 那样在运行时检查每个值的类型。对 TaskHub 这样的规模这不是重点，但它说明了 Fastify 的设计哲学：**schema 同时服务于正确性、安全性和性能**。

## 7.9 练习

1. 某路由只声明了 `response: { 200: TaskSchema }`。在一次重构中，有人让它在创建资源时返回 `201`。会发生什么？怎样从设计上避免？
2. handler 返回了 `{ ...task, createdAt: new Date() }`，而 `TaskSchema.createdAt` 是 `Type.String({ format: 'date-time' })`。响应会是什么？
3. 产品要求在任务详情里加一个 `ownerName` 字段。需要改哪些地方？如果只改了 handler 没改 schema，会怎样？

**参考答案**

1. `201` 没有被声明，响应会用 `JSON.stringify` 原样输出，`internalNote`、`version` 都会泄露。避免方法：为每个会返回的状态码声明 schema；或用 `'2xx'` 覆盖整个成功范围；并用测试断言响应的完整键集合。
2. 正常输出 ISO 8601 字符串，fast-json-stringify 会把 `Date` 转换成 `date-time` 格式的字符串。
3. 需要改 `TaskSchema`（加 `ownerName: Type.String()`）、service 或数据层（查出名字）、测试中断言的键列表；OpenAPI 文档会自动更新。只改 handler 不改 schema，`ownerName` 会被序列化器丢弃，客户端看不到——这正是响应 schema “只让声明过的字段通过”的体现。

## 本章验收

- [ ] 能为一个路由的每个状态码声明响应 schema，知道 `2xx`、`default` 的用法。
- [ ] 能用实验结果说明序列化器的行为：丢弃未声明字段、类型转换、缺 required 时 500、未声明状态码不过滤。
- [ ] 知道错误响应也会经过路由的响应 schema。
- [ ] 能为不同受众设计不同的响应 schema，避免在 handler 里手工删字段。
- [ ] 能说出响应 schema 之外至少两道防止数据泄露的措施。

官方阅读：[Validation and Serialization：Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/#serialization)、[Errors：What The Default Error Handler Sends](https://fastify.dev/docs/latest/Reference/Errors/)、[fast-json-stringify](https://github.com/fastify/fast-json-stringify)。

下一章，[共享 schema、`$id` 与业务规则的边界](./08-shared-schemas-and-business-rules.md)。
