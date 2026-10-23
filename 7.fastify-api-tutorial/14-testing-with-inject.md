# 第 14 章：用 `app.inject` 做集成测试

[上一章](./13-logging-with-pino.md) · [目录](./README.md) · [下一章](./15-capstone-and-acceptance.md)

前面每一章都引用了配套工程里的测试。本章把测试本身作为主题：怎样组织测试基础设施、测什么、怎样测插件装配与生命周期、怎样测“不该发生的事”（比如字段泄露），以及哪些地方需要别的测试手段。

## 14.1 为什么以 `inject` 为主

后端测试大致有三层：

| 层次                   | 测试对象                                                  | TaskHub 中的例子         | 速度 |
| ---------------------- | --------------------------------------------------------- | ------------------------ | ---- |
| 单元测试               | 不依赖框架的纯逻辑                                        | `TaskService` 的业务规则 | 最快 |
| **集成测试（inject）** | 整个 Fastify 应用：插件装配、hook、校验、序列化、错误处理 | 绝大多数测试             | 快   |
| 端到端测试             | 真实监听端口、真实数据库、真实网络                        | 部署前的冒烟测试         | 慢   |

`app.inject()`（底层是 light-my-request）构造一个**模拟的** HTTP 请求，让它完整地走一遍 Fastify 的路由、hook、Ajv 校验、handler、fast-json-stringify 序列化、错误处理器，然后返回响应。它测试的是**真实的插件组合**，唯一省掉的是 TCP 网络层。

对于本书关心的东西——schema 有没有生效、错误格式对不对、响应有没有泄露字段、hook 有没有挂在正确的作用域——`inject` 测试正好覆盖，而且每个测试只需要几毫秒。TaskHub 的 57 个测试在两秒内全部跑完。

## 14.2 `inject` 的用法

```ts
const response = await app.inject({
  method: "POST", // 默认 GET
  url: "/v1/tasks",
  query: { page: "2" }, // 也可以直接写在 url 里
  headers: { authorization: "Bearer alice-token" },
  payload: { title: "写周报" }, // 对象会被序列化为 JSON，并自动设置 content-type
});

response.statusCode; // 201
response.headers.location; // '/v1/tasks/…'，头名是小写
response.body; // 原始字符串
response.json(); // 解析后的对象
```

需要发送非法 JSON 或其他 Content-Type 时，把 `payload` 写成字符串，并手动设置 `content-type`：

```ts
await app.inject({
  method: "POST",
  url: "/v1/tasks",
  headers: { ...bearer("alice"), "content-type": "application/json" },
  payload: '{"title": ',
});
```

也有链式写法：`await app.inject().get('/v1/me').headers({ ... }).query({ ... })`。

`inject` 会自动等待所有插件加载完成（相当于先调用 `ready()`）。

## 14.3 让应用“可测试”的设计

第 2 章把 `buildApp` 和 `server.ts` 拆开，是可测试性的第一步。TaskHub 的 `buildApp` 还接受一组专门为测试准备的选项：

```ts
export interface BuildAppOptions {
  logging?: LoggingOptions; // 默认关闭；测试日志时传入内存 stream
  seed?: SeedData; // 默认使用种子数据；可传入定制数据
  docs?: DocsPluginOptions; // 默认 { ui: 'none' }
  createTaskRateLimit?: number; // 默认 20；测试限流时调小
  slowRequestMs?: number; // 默认 1000；测试慢请求日志时设为 0
}
```

原则是：**凡是会让测试变慢、变得不确定、或者难以观察的东西，都做成可注入的选项**。生产入口 `server.ts` 从环境变量读取配置后传入；测试直接传入需要的值。

测试辅助函数集中在 `test/helpers.ts`：

```ts
import { afterEach } from "vitest";
import { buildApp, type App, type BuildAppOptions } from "../src/app.js";
import { SEED_TOKENS } from "../src/data/seed.js";

const openApps: App[] = [];

/**
 * 每个测试拿到一个全新的应用实例（全新的内存数据），互不干扰。
 * 测试结束后统一 close，触发 onClose 钩子释放资源。
 */
export async function createTestApp(
  options: BuildAppOptions = {},
): Promise<App> {
  const app = await buildApp(options);
  openApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

export function bearer(user: keyof typeof SEED_TOKENS): {
  authorization: string;
} {
  return { authorization: `Bearer ${SEED_TOKENS[user]}` };
}
```

三个要点：

1. **每个测试一个新实例**。内存数据库、限流计数器都挂在实例上，新实例意味着全新状态，测试之间不会互相影响，可以任意顺序运行。
2. **统一在 `afterEach` 中关闭**。忘记 `close()` 会让测试进程挂住不退出，也不会执行 `onClose` 钩子。
3. **`bearer('alice')` 这样的小工具**让测试读起来像需求描述，而不是一堆 HTTP 细节。

## 14.4 测试插件装配

插件装配出错时，现象往往很隐蔽（某个 hook 没生效、某个装饰器在另一个模块里是 `undefined`）。直接对装配结果写断言：

```ts
it("fastify-plugin 包装的装饰器对根实例可见，普通 register 的不可见", async () => {
  const app = await createTestApp();
  await app.ready();

  // db / auth 用 fastify-plugin 包装：根实例和所有子作用域都能用
  expect(app.hasDecorator("db")).toBe(true);
  expect(app.hasDecorator("authenticate")).toBe(true);
  expect(app.hasRequestDecorator("user")).toBe(true);

  // tasks 路由插件是普通 register：它的装饰器被封装在自己的作用域里
  expect(app.hasDecorator("taskService")).toBe(false);
  expect(app.hasRequestDecorator("task")).toBe(false);
});
```

还记得第 3 章说的吗：`taskService` 的 TypeScript 声明是全局的，但运行时只在任务模块里存在。**这个测试守住的正是类型系统表达不了的约束**——如果有人把任务模块改成了 `fp` 包装，测试会立刻失败。

插件依赖是否在启动时被检查：

```ts
it("声明了依赖的插件，缺少依赖时启动失败（而不是运行到一半才报错）", async () => {
  const app = Fastify();
  app.register(authPlugin); // auth 依赖 db，但这里没有注册 db
  await expect(app.ready()).rejects.toThrow(/db/);
});
```

hook 的作用域是否正确：

```ts
it("/v1 下的路由都经过 authenticate，/healthz 不受影响（hook 的作用域）", async () => {
  const app = await createTestApp();
  expect((await app.inject({ url: "/healthz" })).statusCode).toBe(200);
  expect((await app.inject({ url: "/v1/tasks" })).statusCode).toBe(401);
});

it("认证放在 onRequest：未登录请求在解析 body 之前就被拒绝", async () => {
  // POST 一个坏 JSON 且不带 token：得到 401 而不是 400，证明认证发生在解析之前
});
```

## 14.5 测试生命周期

第 4 章的 hook 顺序实验本身就是测试（`test/plugins.test.ts`）。它用一个独立的 Fastify 实例，不依赖 TaskHub 的任何代码，专门**记录并固定 Fastify 的行为**：

```ts
it("校验失败：跳过 preHandler 和 handler，进入 onError，但 onSend/onResponse 仍会执行", async () => {
  const { app, calls } = await buildProbe();
  const response = await app.inject({
    method: "POST",
    url: "/probe",
    payload: { other: 1 },
  });
  expect(response.statusCode).toBe(400);
  await app.close();
  expect(calls).toEqual([
    "onRequest",
    "preParsing",
    "preValidation",
    "onError",
    "onSend",
    "onResponse",
  ]);
});
```

这类“学习测试”（learning test）的价值在于：TaskHub 的设计依赖这些行为（比如 `x-request-id` 头写在 `onSend` 里，依赖错误响应也会经过 `onSend`）。升级 Fastify 时如果行为变了，这里会第一个报警。

注意 `await app.close()`：`onResponse` 在响应发出**之后**执行，`inject` 返回时它可能还没跑完。`close()` 会等待进行中的请求完全结束。

## 14.6 测试请求与响应行为

### 断言状态码、关键响应头和完整形状

```ts
it("创建任务：返回 201、Location 头，且忽略客户端擅自传入的 ownerId/status", async () => {
  const app = await createTestApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/tasks",
    headers: bearer("alice"),
    payload: {
      title: "  写周报  ",
      priority: "high",
      ownerId: SEED_IDS.bob,
      status: "done",
    },
  });

  expect(response.statusCode).toBe(201);
  const task = response.json();
  expect(response.headers.location).toBe(`/v1/tasks/${task.id}`);
  expect(task).toMatchObject({
    title: "写周报", // preValidation 去掉了首尾空白
    priority: "high",
    status: "todo", // 客户端传的 status 被 additionalProperties: false 移除
    ownerId: SEED_IDS.alice, // ownerId 来自登录用户，而不是请求体
  });
});
```

这一个测试同时覆盖了：preValidation 规范化、批量赋值防御、身份来源、201 + Location。

### 测“不该出现的东西”

最容易被忽略的测试是**负面断言**：

```ts
expect(Object.keys(body).sort()).toEqual([
  /* 允许出现的字段，一个不多 */
]);
expect(body).not.toHaveProperty("internalNote");
expect(response.body).not.toContain("ECONNREFUSED");
expect(JSON.stringify(logs.lines)).not.toContain("alice-token");
```

“响应里有 `title`”很容易测，也很容易写对；“响应里**没有**内部字段”“错误里**没有**内网地址”“日志里**没有** token”才是真正保护你的测试。

### 测运行时行为（类型系统看不到的）

第 6 章说过，Ajv 的类型转换、默认值、移除额外属性都发生在运行时，TypeScript 对此一无所知。这些都要靠测试：

```ts
it("querystring 中的数字字符串会被转换成整数，翻页时不重复不遗漏", async () => {
  /* ... */
});
it("可为 null 的字段：null 保持为 null，不会被类型转换成空字符串", async () => {
  /* ... */
});
it("PATCH 只带未知字段：字段被移除后没有实际修改，版本号不变", async () => {
  /* ... */
});
```

第二个测试是一个**回归测试**：TaskHub 开发过程中确实出现过 `null` 被转换成 `""` 的问题（第 5 章），修复后加上这个测试，防止有人以后又改回 `Type.Union([String, Null])`。

## 14.7 测试错误模型

把第 9 章的每一类错误都至少测一次，并且**断言完整结构**而不只是状态码：

```ts
it("所有错误都有相同的结构：statusCode / code / message / requestId", async () => {
  const app = await createTestApp();
  const response = await app.inject({
    url: "/v1/tasks/not-a-uuid",
    headers: bearer("alice"),
  });

  expect(response.statusCode).toBe(400);
  const body = response.json();
  expect(body).toEqual({
    statusCode: 400,
    code: "VALIDATION_FAILED",
    message: "请求参数不符合接口约定",
    requestId: response.headers["x-request-id"],
    details: [
      {
        location: "params",
        field: "/taskId",
        rule: "format",
        message: 'must match format "uuid"',
      },
    ],
  });
});
```

`test/errors.test.ts` 覆盖了：params/body/headers 校验失败、非法 JSON、不支持的 Content-Type、401（含 `WWW-Authenticate`）、403、404（资源与路由）、409、412、422、429（含 `Retry-After`、按用户计数）、500（不泄露、日志完整）。

### 为测试临时添加路由

怎样测试“未知错误”？TaskHub 里没有会抛未知错误的路由。`buildApp` 返回的实例还没有 `ready`，可以在测试里**追加路由**：

```ts
const app = await createTestApp({
  logging: { enabled: true, stream: logs.stream },
});
app.get("/boom", async () => {
  throw new Error("connect ECONNREFUSED 10.0.0.12:5432");
});
const response = await app.inject({ url: "/boom" });
```

这个路由注册在根作用域，所以它享有和真实路由一样的错误处理器、`onSend` hook。注意必须在第一次 `inject`（或 `ready`）**之前**添加；实例启动之后再添加路由会抛出 `AVV_ERR_ROOT_PLG_BOOTED Root plugin has already booted`。

## 14.8 契约测试：文档与实现一致

`test/openapi.test.ts` 分两部分。

第一部分检查**文档本身**：版本、`paths` 的集合（`/healthz` 被隐藏）、`components.schemas` 的集合、`$ref` 是否正确、parameters 的映射、`Task` 中没有内部字段、文档页面的访问控制。

第二部分检查**真实响应是否符合文档声明的 schema**。第 7 章说过，序列化器只做过滤和转换，不做完整校验，所以 handler 返回了不合规的数据时，响应仍可能“看起来正常”。用 TypeBox 的 `Value.Check` 再校验一遍：

```ts
it("契约测试：真实响应能通过文档里声明的 schema 校验", async () => {
  // 响应序列化只“过滤/转换”，不做完整校验；这里用 TypeBox 再校验一遍输出
  const app = await createTestApp();
  const single = await app.inject({
    url: `/v1/tasks/${SEED_IDS.aliceTask}`,
    headers: { authorization: "Bearer alice-token" },
  });
  expect(Value.Check(TaskSchema, single.json())).toBe(true);

  const error = await app.inject({
    url: "/v1/tasks/oops",
    headers: { authorization: "Bearer alice-token" },
  });
  // ErrorResponse 通过 $ref 引用了 ErrorDetail，校验时要把被引用的 schema 作为上下文传入
  expect(
    Value.Check(
      { ErrorDetail: ErrorDetailSchema },
      ErrorResponseSchema,
      error.json(),
    ),
  ).toBe(true);
});
```

这里校验用的 `TaskSchema` 和生成文档、配置序列化的是**同一个对象**——又一次体现了“同源”的好处。

## 14.9 不经过 HTTP 测试业务规则

业务规则在 service 里，不依赖 Fastify，直接测试即可（`test/task-service.test.ts`）：

```ts
it("done 状态的任务只能改 status", async () => {
  const { service, alice } = setup();
  const task = await service.getVisible(alice, SEED_IDS.aliceTask);
  const done = await service.update(task, { status: "done" });

  await expect(service.update(done, { title: "新标题" })).rejects.toMatchObject(
    { code: "TASK_ALREADY_DONE" },
  );
  await expect(
    service.update(done, { status: "doing" }),
  ).resolves.toMatchObject({ status: "doing" });
});
```

分工：service 测试覆盖规则的各种组合（快、细）；inject 测试确认每条规则在 HTTP 层表现为正确的状态码和错误码（少量、端到端）。

## 14.10 测试地图

| 文件                        | 覆盖内容                                                                                        | 对应章节   |
| --------------------------- | ----------------------------------------------------------------------------------------------- | ---------- |
| `test/plugins.test.ts`      | 装饰器可见性、fastify-plugin 差异、依赖检查、hook 作用域、认证先于解析、hook 执行顺序           | 3、4       |
| `test/tasks.test.ts`        | CRUD、响应过滤、null 处理、可见性与权限、业务规则的 HTTP 表现、ETag/If-Match、204、分页排序契约 | 6~8、10    |
| `test/task-service.test.ts` | 业务规则（不经过 HTTP）                                                                         | 8          |
| `test/errors.test.ts`       | 统一错误结构、各类错误、限流、未知错误不泄露、请求 ID                                           | 9、10      |
| `test/openapi.test.ts`      | OpenAPI 结构与映射、文档页面与访问控制、响应契约校验                                            | 11、12、14 |
| `test/logging.test.ts`      | 请求日志、白名单序列化、子 logger、redact、级别、慢请求、onClose                                | 13         |

运行：

```bash
npm test
```

```text
 ✓ test/task-service.test.ts (5 tests)
 ✓ test/plugins.test.ts (7 tests)
 ✓ test/logging.test.ts (9 tests)
 ✓ test/errors.test.ts (12 tests)
 ✓ test/tasks.test.ts (14 tests)
 ✓ test/openapi.test.ts (10 tests)

 Test Files  6 passed (6)
      Tests  57 passed (57)
```

## 14.11 `inject` 覆盖不到的地方

`inject` 不经过真实网络，所以下面这些需要其他手段验证：

- **真实的 `listen` 行为**：端口、`host` 绑定、keep-alive、超时设置。Fastify 测试指南给出了先 `await app.listen({ port: 0 })`、再用 `fetch` 访问 `app.server.address().port` 的写法，需要时可以写少量这样的测试。
- **反向代理相关**：`trustProxy`、`X-Forwarded-*`、真实客户端 IP。`inject` 可以通过 `remoteAddress` 选项模拟来源地址，但代理链本身要在部署环境验证。
- **真实数据库的语义**：唯一约束、事务、并发（第 8、10 章提到的“先查再写”问题）。内存实现测不出竞态，需要连接真实数据库的测试。
- **文档页面在浏览器中的渲染**：测试只验证了 HTML 返回 200，页面是否能正常显示，需要在浏览器里看一眼。

本书配套工程只包含 `inject` 与单元测试，这些部分没有自动化验证。

> 本书用 Vitest，是因为前端开发者通常已经熟悉它。Fastify 官方测试指南的示例使用 Node.js 内置的 `node:test`，`inject` 的用法完全相同，两者可以互换。

## 14.12 练习

1. 为“管理员可以删除任何人的任务，普通成员不能删除别人的任务”写两个 inject 测试。
2. 写一个测试，证明 `GET /v1/tasks?foo=bar` 中的未知参数被忽略而不是报错。
3. 有人把 `createTestApp` 改成了在 `beforeAll` 中创建一个实例、所有测试共用。会出现什么问题？
4. 为什么测试限流时要传 `createTaskRateLimit: 2`，而不是循环发 21 次请求？

**参考答案**

1. ```ts
   it("管理员可以删除任何人的任务", async () => {
     const app = await createTestApp();
     const response = await app.inject({
       method: "DELETE",
       url: `/v1/tasks/${SEED_IDS.bobTask}`,
       headers: bearer("admin"),
     });
     expect(response.statusCode).toBe(204);
   });

   it("普通成员不能删除看不到的任务（404）", async () => {
     const app = await createTestApp();
     const response = await app.inject({
       method: "DELETE",
       url: `/v1/tasks/${SEED_IDS.bobTask}`,
       headers: bearer("alice"),
     });
     expect(response.statusCode).toBe(404);
     expect(response.json().code).toBe("TASK_NOT_FOUND");
   });
   ```

   注意第二个断言的是 404 而不是 403：Bob 的任务对 Alice 不可见。如果要测 403，先把任务指派给 Alice（参考 `tasks.test.ts` 中的可见性测试）。

2. ```ts
   it("未知查询参数被移除，不影响结果", async () => {
     const app = await createTestApp();
     const response = await app.inject({
       url: "/v1/tasks?foo=bar",
       headers: bearer("alice"),
     });
     expect(response.statusCode).toBe(200);
     expect(response.json().page.total).toBe(1);
   });
   ```
3. 测试之间共享内存数据和限流计数：一个测试创建/删除的任务会影响另一个测试的断言，结果依赖执行顺序；限流测试可能让后续的创建请求莫名其妙地得到 429。
4. 测试应当快速且意图清晰。把阈值做成可注入的选项，测试只需要 3 次请求就能覆盖“未超限/超限”两种情况，读者一眼能看出测试在验证什么。

## 本章验收

- [ ] 能用 `inject` 发送各种请求（含非法 JSON、自定义头），并读取状态码、响应头和响应体。
- [ ] 能设计可测试的应用工厂，并写出每个测试独立实例、统一关闭的测试辅助函数。
- [ ] 能测试插件装配（装饰器可见性、依赖检查、hook 作用域）和生命周期顺序。
- [ ] 能写出断言完整形状的响应测试，以及“不该出现”的负面断言。
- [ ] 能测试错误模型、日志和 OpenAPI 契约，并用 `Value.Check` 校验真实响应。
- [ ] 能说出 `inject` 测试覆盖不到的部分。

官方阅读：[Fastify Testing Guide](https://fastify.dev/docs/latest/Guides/Testing/)、[light-my-request](https://github.com/fastify/light-my-request)、[Vitest](https://vitest.dev/)、[TypeBox：Value](https://sinclairzx81.github.io/typebox/#/docs/value/overview)。

下一章，[综合实战与逐项验收](./15-capstone-and-acceptance.md)。
