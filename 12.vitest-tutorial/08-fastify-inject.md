# 第 8 章：Fastify app.inject——不监听端口测完整个 HTTP 边界

> 路线图要求：「Fastify app.inject：无须监听外部端口也能覆盖请求/响应与插件行为」。这一章把 TaskDesk Lite 的 API 层完整测掉：鉴权 hook、校验错误、越权、状态机、并发竞态、requestId——19 个测试，全部来自 [example/test/integration/api-in-memory.test.ts](./example/test/integration/api-in-memory.test.ts)。

## 8.1 inject 是什么，为什么它比 supertest 干净

Fastify 内置 `app.inject()`：把一个 HTTP 请求**直接注入**到应用的路由管线里，不创建 TCP 服务器、不占用端口、不走真实网络。返回的响应对象有 `statusCode`、`headers`、`json()`——和真 HTTP 响应同构。

```ts
const res = await app.inject({
  method: "POST",
  url: "/tasks",
  headers: { "x-user-id": "u1", "x-user-role": "member" },
  payload: { title: "写 Vitest 教程" },
});

expect(res.statusCode).toBe(201);
expect(res.json().task.title).toBe("写 Vitest 教程");
```

对比「起真服务器 + HTTP 客户端」的方案，inject 的优势：

- **无端口冲突**：测试文件可以并行跑，谁也不抢 3000 端口；
- **无网络层噪音**：不用等 listen/close，不用处理 ECONNREFUSED；
- **管线完整**：路由匹配、生命周期 hook（onRequest/preHandler）、序列化、错误处理全部真实执行——这正是「集成」要验证的部分。

inject 测不到的只剩真实 TCP/HTTP 层（keep-alive、TLS、代理行为），那些留给阶段 13 的 Playwright 与部署环境验证。

## 8.2 前提：app factory——构建与监听分离

inject 的前提是「能拿到一个未监听的 app 实例」。这要求生产代码把**构建 app** 和**启动监听**拆开（[example/src/api/app.ts](./example/src/api/app.ts) 与 [server.ts](./example/src/api/server.ts)）：

```ts
// app.ts —— 纯构建，测试与生产共用
export function buildApp(options: { service: TaskService; logger?: boolean }): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  registerContext(app);        // 鉴权 hook（见 8.4）
  app.setErrorHandler(...);    // 统一错误映射（见 8.5）
  registerRoutes(app, options.service);
  return app;
}

// server.ts —— 只有这里 listen，测试永远不执行这个文件
const app = buildApp({ service, logger: true });
await app.listen({ port: 3000, host: "127.0.0.1" });
```

注意 `buildApp` 接收 `service` 参数：**依赖注入贯穿到了 app 层**。测试传入「接内存仓储的 service」（快、可控），本地开发传入「接 PGlite 的 service」（第 9 章），生产传入「接真 Postgres 的 service」——同一个 `buildApp`，三种组装。如果你的 Fastify 项目目前是「模块顶层直接构建并 listen」，第一步重构就是抽出 factory。

## 8.3 测试骨架：每个测试一个全新 app

```ts
let app: FastifyInstance;

beforeEach(() => {
  app = buildApp({
    service: createTaskService({
      repo: createInMemoryTaskRepository(), // 每个测试全新数据（第 7 章原则）
      notifier: createNotificationCollector(),
      clock: () => FIXED_NOW, // 固定时钟（第 5 章原则）
    }),
  });
});

afterEach(async () => {
  await app.close(); // 必须关闭：释放 hook/装饰器资源，否则测试进程可能挂住
});
```

`app.close()` 放在 `afterEach` 而不是文件末尾，理由和数据库连接一样：**忘关的 app 是「测试跑完进程不退」的头号原因**。这一档测试用内存仓储（不碰数据库），每个 app 构建只要几毫秒，「每测试新建」毫无压力。

## 8.4 鉴权 hook 的测试：401 也是一等公民

TaskDesk Lite 的教学版「认证」是两个 hook（[example/src/api/context.ts](./example/src/api/context.ts)）：`onRequest` 生成/透传 requestId，`preHandler` 从 `x-user-id` / `x-user-role` 头解析出 `Actor` 挂到 request 上。测试要覆盖的不是「hook 执行了」，而是**边界行为**：

```ts
it("缺少 x-user-id → 401 + 统一错误 envelope + requestId", async () => {
  const res = await app.inject({ method: "GET", url: "/tasks" });

  expect(res.statusCode).toBe(401);
  const body = res.json();
  expect(body.error.code).toBe("UNAUTHORIZED");
  expect(body.error.message).toContain("x-user-id");
  expect(body.requestId).toEqual(expect.any(String));
  expect(res.headers["x-request-id"]).toBe(body.requestId); // 头与体同源
});

it("非法角色 → 401", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/tasks",
    headers: { "x-user-id": "u1", "x-user-role": "admin" }, // 白名单只有 member/manager
  });
  expect(res.statusCode).toBe(401);
});
```

`x-request-id` 响应头直接复用 Fastify 内置的 `request.id`（默认 `req-1`、`req-2`…递增；生产可用 `genReqRequestId` 换成 UUID）。这里有一个我们真实踩过、值得你记住的坑：最初版本在 `onRequest` 里自己 `randomUUID()` 存到 `request.requestId`，错误处理器里却用了 `request.id`——**响应头和错误体里的 requestId 不同源**，测试 `expect(res.headers["x-request-id"]).toBe(body.requestId)` 立刻抓住。日志关联字段必须单一来源，这条测试从此成为它的守卫。

## 8.5 错误模型的测试：每条错误路径一个状态码

统一错误 envelope 是 API 契约的一部分（[example/src/api/app.ts](./example/src/api/app.ts) 的 `setErrorHandler`）：

```ts
app.setErrorHandler((error, request, reply) => {
  const requestId = request.id;
  if (error instanceof UnauthorizedError) {
    return reply
      .status(401)
      .send(buildErrorBody(error.code, error.message, requestId));
  }
  if (error instanceof ZodError) {
    // schema 校验失败
    const first = error.issues[0];
    const path = first?.path.join(".") || "(root)";
    return reply
      .status(400)
      .send(
        buildErrorBody(
          "VALIDATION_ERROR",
          `${path}: ${first?.message ?? "格式错误"}`,
          requestId,
        ),
      );
  }
  if (error instanceof TaskDeskError) {
    // 业务错误按 code 映射
    const status =
      error.code === "PERMISSION_DENIED"
        ? 403
        : error.code === "TASK_NOT_FOUND"
          ? 404
          : error.code === "TASK_CONFLICT"
            ? 409
            : 422; // 非法迁移 / 过期截止日
    return reply
      .status(status)
      .send(buildErrorBody(error.code, error.message, requestId));
  }
  request.log.error(error);
  return reply
    .status(500)
    .send(buildErrorBody("INTERNAL", "服务器内部错误", requestId));
});
```

对应的测试矩阵（路线图练习 3 的主体）：

| 场景       | 请求                                          | 期望                                                                      |
| ---------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| 校验失败   | `POST /tasks` body `{ title: "   " }`         | 400，`error.code = VALIDATION_ERROR`，message 以 `title: ` 开头           |
| 过期截止日 | `dueDate: "2026-03-09"`（clock 固定在 03-10） | 422，`PAST_DUE_DATE`                                                      |
| 重名       | 创建两次同名任务                              | 409，`TASK_CONFLICT`                                                      |
| 越权       | member B 迁移 member A 的任务                 | 403，`PERMISSION_DENIED`，且任务状态不变                                  |
| 非法迁移   | `todo → done`                                 | 422，`INVALID_TRANSITION`，message 精确等于 `"不允许从 todo 迁移到 done"` |
| 不存在     | 迁移 `task_missing`                           | 404，`TASK_NOT_FOUND`                                                     |
| 未知状态名 | `{ to: "deleted" }`                           | 400（枚举白名单在路由层拦下）                                             |
| 未知路由   | `GET /nope`                                   | 404（不误报 500）                                                         |

两个测试细节值得展开：

**越权测试必须双断言**——不仅 403，还要再查一次确认状态没变：

```ts
const res = await app.inject({
  method: "POST",
  url: `/tasks/${id}/transition`,
  headers: otherMember,
  payload: { to: "archived" },
});
expect(res.statusCode).toBe(403);

const after = await app.inject({
  method: "GET",
  url: "/tasks",
  headers: manager,
});
expect(after.json().items[0].status).toBe("todo"); // 越权操作没有产生副作用
```

**未知错误不能泄漏内部细节**：兜底分支只返回 `"服务器内部错误"` + requestId，堆栈进日志不进响应。想测这条，注入一个 `repo.findById` 会抛 `Error("连接超时")` 的坏 service，断言响应体里不出现「连接超时」字样。

## 8.6 并发竞态：inject 也能测

`app.inject` 返回 Promise，多个请求可以 `Promise.all` 并发注入。配套工程用它验证「先查后插」的查重逻辑在竞态下由唯一约束兜底：

```ts
it("并发重名提交：恰好一个 201、一个 409", async () => {
  const responses = await Promise.all([
    app.inject({
      method: "POST",
      url: "/tasks",
      headers: member,
      payload: { title: "秒杀" },
    }),
    app.inject({
      method: "POST",
      url: "/tasks",
      headers: otherMember,
      payload: { title: "秒杀" },
    }),
  ]);
  const statuses = responses.map((r) => r.statusCode).sort();
  expect(statuses).toEqual([201, 409]);
});
```

这一档跑在内存仓储上（它的 `insert` 模拟了唯一约束，见 [example/src/services/in-memory-task-repository.ts](./example/src/services/in-memory-task-repository.ts)），证明的是 **service/API 层对约束冲突的处理正确**；真实数据库的约束行为在第 9 章再验一次。两层各测各的，这正是 mock 边界的分工。

## 8.7 分页与查询参数的边界

GET /tasks 的查询参数走第 4 章的 `parsePagination`，API 层测试重点是**字符串形态的参数与错误映射**：

```ts
it("非法分页参数 → 400", async () => {
  for (const url of [
    "/tasks?page=0",
    "/tasks?pageSize=101",
    "/tasks?page=abc",
  ]) {
    const res = await app.inject({ method: "GET", url, headers: member });
    expect(res.statusCode, url).toBe(400); // 第二个参数是失败时的标注信息
    expect(res.json().error.code, url).toBe("VALIDATION_ERROR");
  }
});
```

`expect(value, message)` 的第二个参数会在断言失败时打印，循环里定位是哪一轮失败全靠它。查询串里的参数永远是字符串——`page=0` 与 `page=abc` 的 ZodError 消息不同（min 违规 vs 类型违规），但都映射 400，这类「多输入同出口」的用循环参数化最省。

## 8.8 路线图练习 3：为 Fastify API 写完整边界测试

> 路线要求：「为 Fastify API 测试验证错误、响应 schema、鉴权和统一错误处理。」

示范已覆盖大部分，你来补齐最后几块：

1. **响应形状契约**：为 `POST /tasks` 成功响应写一个「全字段」断言（`toEqual` 而非 `toMatchObject`），钉住响应 schema——将来任何人往响应里加字段，这条测试会强制他更新契约与文档。
2. **内部错误不泄漏**：按 8.5 的思路注入坏 repo，断言 500 响应体不含内部错误消息、但 `x-request-id` 存在。
3. **manager 的完整旅程**：manager 创建任务 → 迁移 in_progress → done → 用 `GET /tasks?status=done` 验证过滤，一条链四个断言点（这是少数值得「多次 Act」的旅程测试）。
4. **requestId 递增语义**：同一个 app 实例连续三次请求，断言 `req-1`、`req-2`、`req-3` 的顺序（并思考：为什么两个 app 实例之间 requestId 会「撞号」？这对日志系统意味着什么？）。

## 练习参考思路

1. 全字段断言要处理随机 ID 与时间：`expect(res.json()).toEqual({ task: { id: expect.stringMatching(/^task_/), title: "...", status: "todo", dueDate: null, ownerId: "u1", assigneeId: null, createdAt: FIXED_NOW.toISOString() } })`。注意 JSON 序列化后 Date 变 ISO 字符串——这也是契约的一部分。
2. 坏 service：`createTaskService({ repo: { ...createInMemoryTaskRepository(), findById: async () => { throw new Error("连接超时"); } }, notifier })`，然后 `GET /tasks` 触发 `findPage`（也要弄坏）或 transition 触发 `findById`；断言 `expect(res.json().error.message).toBe("服务器内部错误")`。
3. 链式旅程的每一步都断言状态码 + 关键字段，最后一步用列表过滤验证「done 的只有这一个」。
4. Fastify 默认 requestId 计数器是**实例级**的，新 app 从 req-1 重新计数。多实例部署时日志聚合必须带上实例标识（或换 `genReqRequestId` 生成 UUID）——测试帮你把这个事实变成了显式知识。

## 本章来源

- Vitest 官方文档：[Examples](https://vitest.dev/guide/)（官方 fastify 示例使用 app.inject 模式）
- Fastify 官方文档：[inject](https://fastify.dev/docs/latest/Reference/Decorators/#inject)（light-my-request 注入机制）、[Lifecycle](https://fastify.dev/docs/latest/Reference/Lifecycle/)（onRequest/preHandler 执行顺序）、[Error Handling](https://fastify.dev/docs/latest/Reference/Error-Handling/)（setErrorHandler、request.id 与 genReqRequestId）、[Testing](https://fastify.dev/docs/latest/Guides/Testing/)（官方推荐的 inject 测试模式）
- requestId 同源踩坑为配套工程实测记录

下一章：[09 数据库集成测试](./09-database-integration.md) —— 用 PGlite 验证 mock 永远测不到的真实 SQL 语义。
