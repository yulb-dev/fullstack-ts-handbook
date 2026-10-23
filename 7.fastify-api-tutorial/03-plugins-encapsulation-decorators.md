# 第 3 章：插件、封装与装饰器——给应用划出边界

[上一章](./02-setup-and-first-route.md) · [目录](./README.md) · [下一章](./04-lifecycle-and-hooks.md)

上一章所有路由都写在 `buildApp` 里。功能一多，这个函数会变成几千行：数据库连接、认证、错误处理、十几个模块的路由全混在一起，谁依赖谁说不清楚，改一处担心影响全部。

Fastify 用**插件（plugin）**来解决这个问题。本章你会理解 Fastify 最核心、也最容易让新手困惑的设计：**封装上下文（encapsulation context）**。

## 3.1 我们需要哪几种边界

先站在 TaskHub 的角度想想：

| 能力                            | 谁需要用                    | 应该在哪里可见                    |
| ------------------------------- | --------------------------- | --------------------------------- |
| 数据库访问 `db`                 | 认证、所有业务模块          | 全局                              |
| 统一错误处理                    | 所有路由                    | 全局                              |
| 认证函数 `authenticate`         | `/v1` 下的业务路由          | 全局可用，但只在 `/v1` 下**挂上** |
| 任务业务服务 `taskService`      | 只有任务路由                | 只在任务模块里                    |
| “当前操作的任务” `request.task` | 只有任务路由的 PATCH/DELETE | 只在任务模块里                    |

有的东西要全局共享，有的东西要“关在模块里”，防止别的模块无意间依赖它。Fastify 的插件系统同时支持这两种需求。

## 3.2 插件就是一个函数

一个插件是一个接收 `(instance, options)` 的 async 函数，用 `app.register()` 加载：

```ts
import type { FastifyPluginAsync } from "fastify";

interface GreetingOptions {
  greeting: string;
}

const greetingPlugin: FastifyPluginAsync<GreetingOptions> = async function (
  app,
  options,
) {
  app.get("/greet", async () => ({ message: options.greeting }));
};

await app.register(greetingPlugin, { greeting: "你好", prefix: "/v1" });
// 注册出的路由是 GET /v1/greet
```

- `options` 会原样传给插件函数。
- 有三个选项由 Fastify 自己消费：`prefix`（路由前缀）、`logLevel`、`logSerializers`。
- 插件也可以写成回调风格 `(app, opts, done) => { ...; done() }`，但**不要在 async 函数里再调用 `done`**，两种风格不能混用。本书统一用 async。

`register` 是**插件的唯一入口**。你后面用到的所有生态包——`@fastify/swagger`、`@fastify/rate-limit`、Scalar——本质上都是插件，都通过 `register` 加载。

## 3.3 封装上下文：一个能运行的实验

把下面代码保存为 `src/playground/encapsulation.ts` 并运行（`npx tsx src/playground/encapsulation.ts`）：

```ts
import Fastify from "fastify";
import fp from "fastify-plugin";

const app = Fastify();

// 根作用域的装饰器：所有后代都能用
app.decorate("appName", "TaskHub");

// 用 fastify-plugin 包装：装饰器“提升”到注册它的那一层（这里是根）
app.register(
  fp(async function sharedTools(instance) {
    instance.decorate("sharedTool", "everyone can use me");
  }),
);

// 普通插件 A：一个新的封装作用域
app.register(async function moduleA(a) {
  a.decorate("secretOfA", "only A and its children");

  a.get("/a", async () => ({
    appName: a.getDecorator<string>("appName"),
    sharedTool: a.hasDecorator("sharedTool"),
    secretOfA: a.hasDecorator("secretOfA"),
    secretOfB: a.hasDecorator("secretOfB"),
  }));

  // A 的子插件：继承 A 和根的一切
  a.register(async function childOfA(child) {
    child.get("/a/child", async () => ({
      secretOfA: child.hasDecorator("secretOfA"),
    }));
  });
});

// 普通插件 B：A 的兄弟，互相看不见
app.register(async function moduleB(b) {
  b.decorate("secretOfB", "only B");
  b.get("/b", async () => ({
    secretOfA: b.hasDecorator("secretOfA"),
    secretOfB: b.hasDecorator("secretOfB"),
  }));
});

await app.ready();

console.log("root sees:", {
  sharedTool: app.hasDecorator("sharedTool"),
  secretOfA: app.hasDecorator("secretOfA"),
  secretOfB: app.hasDecorator("secretOfB"),
});
for (const url of ["/a", "/a/child", "/b"]) {
  console.log(url, (await app.inject(url)).body);
}
console.log(app.printPlugins());
```

实际输出：

```text
root sees: { sharedTool: true, secretOfA: false, secretOfB: false }
/a {"appName":"TaskHub","sharedTool":true,"secretOfA":true,"secretOfB":false}
/a/child {"secretOfA":true}
/b {"secretOfA":false,"secretOfB":true}
root 3 ms
├── bound _after 2 ms
├── sharedTools-auto-0 0 ms
├─┬ moduleA 1 ms
│ ├── bound _after 0 ms
│ ├── bound _after 0 ms
│ └─┬ childOfA 0 ms
│   ├── bound _after 0 ms
│   └── bound _after 0 ms
└─┬ moduleB 0 ms
  ├── bound _after 0 ms
  └── bound _after 0 ms
```

把结果画成一棵树：

```text
root（appName, sharedTool）
├── moduleA（secretOfA）
│   └── childOfA          ← 能看到 secretOfA、appName、sharedTool
└── moduleB（secretOfB）  ← 看不到 secretOfA
```

三条规则就能解释全部结果：

1. **子作用域继承父作用域**的一切：装饰器、hook、共享 schema、错误处理器。
2. **父作用域看不到子作用域**新增的东西。
3. **兄弟作用域互相隔离**。

这条规则不仅适用于装饰器，也适用于 **hook**（第 4 章）、**`addSchema` 注册的共享 schema**（第 8 章）、**`setErrorHandler`**（第 9 章）。这就是为什么后面我们能做到“`/v1` 下的路由都要认证，而 `/healthz` 不需要”——只要把认证 hook 加在 `/v1` 那个作用域里。

> `printPlugins()` 里那些 `bound _after` 是 Fastify 内部用来排队的条目，可以忽略。`sharedTools-auto-0` 是因为 `fp` 包装的插件没有设置 `name`，Fastify 自动起了个名字——这也说明给插件命名的价值，第 3.4 节会讲。

## 3.4 `fastify-plugin`：有意识地打破封装

`register` 默认创建新作用域。可是数据库连接、认证函数这类**基础设施**恰恰需要被所有人看到。`fastify-plugin`（下文简称 `fp`）的作用，是告诉 Fastify：“这个插件**不要**创建新作用域，它添加的东西直接留在注册它的那一层。”

```ts
import fp from "fastify-plugin";

export default fp(
  async function dbPlugin(app, options) {
    app.decorate("db", createMemoryStore(options.seed));
  },
  {
    name: "db", // 插件名：出现在 printPlugins 中，也供其他插件声明依赖
    fastify: "5.x", // 支持的 Fastify 版本；不匹配时启动报错
  },
);
```

`fp` 的第二个参数是元数据：

| 字段           | 作用                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| `name`         | 插件名。重复注册同名插件时 Fastify 会发现；其他插件可以在 `dependencies` 里引用它                    |
| `fastify`      | 支持的 Fastify 版本范围                                                                              |
| `dependencies` | 依赖的插件名列表。缺少依赖时，**启动阶段**就报错，而不是等到请求进来才 `undefined is not a function` |
| `decorators`   | 依赖的装饰器，如 `{ fastify: ['db'], request: ['user'] }`                                            |
| `encapsulate`  | 设为 `true` 时仍然保持封装，只用 `fp` 来做名字和依赖检查                                             |

**什么时候用 `fp`，什么时候不用？** 一个简单的判断：

| 插件的性质                                                     | 用 `fp`？ | TaskHub 中的例子                                                           |
| -------------------------------------------------------------- | --------- | -------------------------------------------------------------------------- |
| 给全应用提供能力（装饰器、全局 hook、错误处理器、共享 schema） | ✅ 用     | `db`、`auth`、`error-handler`、`request-context`、`shared-schemas`、`docs` |
| 一组业务路由，以及只属于它们的工具                             | ❌ 不用   | `health`、`v1`、`users`、`tasks`                                           |

> 注意：用 `fp` 包装的插件，`register` 时传的 `prefix` **不生效**（Fastify 文档明确说明，这些框架级选项在 `fp` 插件上会被忽略）。路由插件不要用 `fp`。

## 3.5 装饰器：给实例、request、reply 挂东西

装饰器（decorator）用来扩展 Fastify 的三个核心对象：

```ts
app.decorate("db", store); // app.db
app.decorateRequest("user", null); // request.user
app.decorateReply("sendCsv", function (rows) {
  /* this 是 reply */
});
```

### 为什么不直接 `request.user = ...`？

你当然可以在 hook 里直接给 `request` 加属性。但 Fastify 文档解释过：先用 `decorateRequest` 声明属性，V8 引擎在创建 request 对象时就知道它的“形状”，后续访问更快；中途给对象加新属性会让引擎放弃这些优化。另外，声明过的属性一目了然，`hasRequestDecorator('user')` 也能检查到。

### 引用类型的陷阱

```ts
app.decorateRequest("user", {});
// FST_ERR_DEC_REFERENCE_TYPE The decorator 'user' of type 'object' is a reference type.
// Use the { getter, setter } interface instead.
```

为什么禁止？如果默认值是一个对象，**所有请求会共享同一个对象**。请求 A 往里写了 Alice 的信息，请求 B 读到的就是 Alice——这是严重的安全漏洞。Fastify 直接在启动时拒绝这种写法。

正确做法：**用 `null` 声明形状，在每个请求的 hook 里赋新值**：

```ts
app.decorateRequest("user", null);

app.addHook("onRequest", async (request) => {
  request.user = await findUser(request); // 每个请求一个新值
});
```

实例装饰器（`app.decorate`）没有这个限制，因为实例本来就是全局唯一的，比如 `app.decorate('db', { ... })` 是允许的。

### 同名装饰器

同一个作用域里重复 `decorate('x')` 会抛 `FST_ERR_DEC_ALREADY_PRESENT`。但在**子作用域**里可以声明同名装饰器，覆盖父级的值，且只在子作用域内生效。

### 在 TypeScript 中声明装饰器的类型

`app.decorate('db', store)` 运行时没问题，但 TypeScript 不知道 `app.db` 的存在。用**模块声明合并（declaration merging）**告诉它：

```ts
declare module "fastify" {
  interface FastifyInstance {
    db: Store;
  }
  interface FastifyRequest {
    user: UserRecord | null;
  }
}
```

要特别注意：**TypeScript 的声明是全局的，而 Fastify 的装饰器是有作用域的**。TaskHub 在任务模块里声明了 `FastifyInstance.taskService`，于是在**任何**文件里写 `app.taskService` 都能通过类型检查——但运行时只有任务模块里才真的有它。这是一个类型系统表达不了的约束，需要靠代码组织和测试来守住（第 14 章有专门的测试）。

### `getDecorator` 与 `hasDecorator`

```ts
app.hasDecorator("db"); // boolean
app.hasRequestDecorator("user");
const db = app.getDecorator<Store>("db"); // 不存在时抛 FST_ERR_DEC_UNDECLARED
```

`getDecorator` 适合在插件**加载时**就取出依赖：如果缺失，启动直接失败，而不是等到第一个请求。

## 3.6 加载顺序：`register` 不是立即执行的

做一个小实验：

```ts
import Fastify from "fastify";
import fp from "fastify-plugin";

const app = Fastify();
app.register(
  fp(async (instance) => {
    instance.decorate("db", { name: "memory" });
  }),
);
console.log("紧跟在 register 之后：", app.hasDecorator("db"));
await app.after();
console.log("await app.after() 之后：", app.hasDecorator("db"));
```

输出：

```text
紧跟在 register 之后： false
await app.after() 之后： true
```

`register` 只是把插件**放进队列**，Fastify（底层的 avvio 库）会按注册顺序、深度优先地加载它们。插件真正执行的时机是：

- `await app.register(plugin)`：等这个插件（及其子插件）加载完；
- `await app.after()`：等之前注册的插件加载完；
- `await app.ready()`、`app.listen()`、`app.inject()`：等**全部**插件加载完。

所以 TaskHub 的 `buildApp` 里每一行都写成 `await app.register(...)`，读起来就是严格的先后顺序。

还有两个和加载有关的机制：

- **插件超时**：一个插件 10 秒（`pluginTimeout` 默认值）还没加载完，启动失败。数据库连不上时，你会看到这个错误而不是无限等待。
- **依赖检查**：`fp` 声明了 `dependencies: ['db']` 的插件，如果 `db` 没有先注册，`ready()` 会直接失败。第 14 章用测试验证了这一点。

## 3.7 TaskHub 的插件地图

现在可以看懂最终的 `src/app.ts` 了（部分插件会在后面章节逐个实现，这里先理解它们的位置）：

```ts
export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: buildLoggerOptions(options.logging ?? { enabled: false }),
    logController,
    genReqId,
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(errorHandlerPlugin);
  await app.register(requestContextPlugin, {
    slowRequestMs: options.slowRequestMs ?? 1000,
  });
  await app.register(sharedSchemasPlugin);
  await app.register(dbPlugin, { seed: options.seed ?? createSeedData() });
  await app.register(authPlugin);
  // global: false —— 只有在路由 config.rateLimit 中声明的路由才限流
  await app.register(rateLimit, { global: false });

  await app.register(docsPlugin, options.docs ?? { ui: "none" });

  await app.register(healthRoutes);
  await app.register(v1Routes, {
    prefix: "/v1",
    createTaskRateLimit: options.createTaskRateLimit ?? 20,
  });

  return app;
}
```

对应的作用域树：

```text
root
├── error-handler      (fp)  setErrorHandler / setNotFoundHandler        → 第 9 章
├── request-context    (fp)  onSend 写 x-request-id，onResponse 记慢请求   → 第 4、10 章
├── shared-schemas     (fp)  addSchema(Task, ErrorResponse, ...)          → 第 8 章
├── db                 (fp)  decorate('db')                               → 本章
├── auth               (fp)  decorateRequest('user'), decorate('authenticate', 'requireRole') → 第 4 章
├── @fastify/rate-limit      onRoute 给声明了 config.rateLimit 的路由挂 hook → 第 9 章
├── docs               (fp)  @fastify/swagger + Scalar/Swagger UI          → 第 11、12 章
├── health                   GET /healthz（无认证）
└── v1  prefix=/v1           addHook('onRequest', authenticate)
    ├── users                GET /v1/me, GET /v1/admin/users/:userId
    └── tasks                decorate('taskService'), decorateRequest('task')
                             GET/POST /v1/tasks, GET/PATCH/DELETE /v1/tasks/:taskId
```

顺序不是随便排的：

1. **错误处理器最先**：之后任何插件、路由出错，都走统一格式。
2. **共享 schema 在路由之前**：路由编译 schema 时要能解析 `$ref`。
3. **`db` 在 `auth` 之前**：`auth` 声明了 `dependencies: ['db']`。
4. **`docs`（@fastify/swagger）在所有业务路由之前**：它靠 `onRoute` 钩子收集路由，之前注册的路由它看不到（第 11 章有实验）。
5. **业务路由最后**。

### 数据插件：`src/plugins/db.ts`

```ts
import fp from "fastify-plugin";
import {
  createMemoryStore,
  type SeedData,
  type Store,
} from "../data/memory-store.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Store;
  }
}

export interface DbPluginOptions {
  seed: SeedData;
}

/**
 * 数据访问插件：把“数据库”挂到实例上。
 * 用 fastify-plugin 包装，是因为 db 必须对兄弟插件（auth、tasks 路由）可见。
 */
export default fp<DbPluginOptions>(
  async function dbPlugin(app, options) {
    app.decorate("db", createMemoryStore(options.seed));

    app.addHook("onClose", async (instance) => {
      // 真实数据库在这里关闭连接池；onClose 在所有请求处理完之后才执行
      instance.log.info("database connections closed");
    });
  },
  { name: "db", fastify: "5.x" },
);
```

`createMemoryStore` 在 `src/data/memory-store.ts` 里，用 `Map` 模拟了一张用户表和一张任务表，提供 `users.findById`、`users.findByToken`、`tasks.list/findById/findByOwnerAndTitle/insert/update/delete` 这些异步方法。它刻意保留了数据库风格的接口——换成 Postgres 时，只要实现相同签名即可，路由和业务层不用改。

`TaskRecord` 比对外的 `Task` 多两个字段：`internalNote`（运营备注，绝不能出现在响应里）和 `version`（乐观并发用的版本号）。第 7 章会用它们演示响应 schema 如何防止字段泄露。

### 健康检查：`src/modules/health/routes.ts`

```ts
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";

/**
 * 给负载均衡/容器编排用的存活探针。
 * - 不在 /v1 下：它不是业务契约，不随 API 版本变化；
 * - hide: true：不出现在对外 API 文档里；
 * - logLevel: 'warn'：探针每几秒一次，不记 info 级请求日志，避免刷屏。
 */
const healthRoutes: FastifyPluginAsyncTypebox = async function (app) {
  app.get(
    "/healthz",
    {
      logLevel: "warn",
      schema: {
        hide: true,
        response: { 200: Type.Object({ status: Type.Literal("ok") }) },
      },
    },
    async () => ({ status: "ok" as const }),
  );
};

export default healthRoutes;
```

（`FastifyPluginAsyncTypebox`、`Type.Object` 在第 6 章解释，`hide` 在第 11 章，`logLevel` 在第 13 章。）

### `/v1` 作用域：`src/modules/v1.ts`

```ts
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import taskRoutes from "./tasks/routes.js";
import userRoutes from "./users/routes.js";

export interface V1Options {
  createTaskRateLimit: number;
}

/**
 * /v1 版本的全部业务路由。
 * 这个插件没有用 fastify-plugin 包装，所以下面 addHook 的 authenticate
 * 只作用于 /v1 下的路由；/healthz、/docs 不受影响。
 */
const v1Routes: FastifyPluginAsyncTypebox<V1Options> = async function (
  app,
  options,
) {
  app.addHook("onRequest", app.authenticate);

  await app.register(userRoutes);
  await app.register(taskRoutes, {
    createTaskRateLimit: options.createTaskRateLimit,
  });
};

export default v1Routes;
```

这里是封装最有价值的地方：一行 `addHook` 就保证了 `/v1` 下**每一个**路由都必须认证，以后新增模块也不会忘；而 `/healthz` 在兄弟作用域，完全不受影响。

任务模块内部还用到了 `app.prefix`：在 `/v1` 作用域里它的值是 `'/v1'`，创建任务时用它拼 `Location` 头，避免把版本号写死在业务代码里。

## 3.8 常见错误

| 现象                                                        | 原因                                        | 解决                           |
| ----------------------------------------------------------- | ------------------------------------------- | ------------------------------ |
| 在插件里 `setErrorHandler`，别的路由出错时没生效            | 插件没用 `fp`，错误处理器被封装在空作用域里 | 用 `fp` 包装                   |
| 在插件里 `decorate('db')`，兄弟插件 `app.db` 是 `undefined` | 同上                                        | 用 `fp` 包装                   |
| `register(routes, { prefix: '/v1' })` 前缀不生效            | 路由插件被 `fp` 包装了                      | 路由插件不要用 `fp`            |
| `app.register(db); app.db.xxx()` 报 undefined               | `register` 只是排队                         | `await app.register(db)`       |
| `decorateRequest('user', {})` 启动报错                      | 引用类型会被所有请求共享                    | 用 `null`，在 hook 里赋值      |
| handler 里 `this.db` 是 undefined                           | 用了箭头函数                                | 用 `function` 或闭包里的 `app` |

## 3.9 练习

1. 在 3.3 的实验里，给 `moduleB` 也加一个 `childOfB`，它能看到 `secretOfA` 吗？能看到 `sharedTool` 吗？
2. 如果把 `sharedTools` 的 `fp` 去掉，`/a` 的输出会怎样变化？
3. 判断下面每个插件是否应该用 `fp`：（a）连接 Redis 并 `decorate('redis')`；（b）`/v1/reports` 下的五个报表路由；（c）给所有响应加 `x-powered-by` 头的 `onSend` hook；（d）只给报表模块用的 `decorate('reportCache')`。

**参考答案**

1. 看不到 `secretOfA`（它属于 A 的子树）；能看到 `sharedTool`（它在根上）。
2. `sharedTool` 变为 `false`：去掉 `fp` 后，`sharedTools` 自己成了一个封装作用域，它的装饰器只对它自己及其子孙可见。
3. （a）用，所有模块都要访问 Redis；（b）不用，它们是业务路由，需要 `prefix`；（c）用，否则 hook 只作用于这个插件内部（而它内部没有路由）；（d）不用，在报表模块内部 `decorate`，让它被封装起来。

## 本章验收

- [ ] 能写出一个带 options 的插件，并用 `register` 加 `prefix` 加载。
- [ ] 能用三条规则（子继承父、父看不到子、兄弟隔离）解释封装实验的每一行输出。
- [ ] 能判断一个插件该不该用 `fastify-plugin`，并说出 `name`、`dependencies` 的作用。
- [ ] 能正确使用 `decorate`/`decorateRequest`/`decorateReply`，解释引用类型陷阱，并为装饰器写 TS 声明。
- [ ] 知道 `register` 是排队执行的，能解释 TaskHub `buildApp` 中插件的注册顺序。

官方阅读：[Plugins](https://fastify.dev/docs/latest/Reference/Plugins/)、[Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/)、[Decorators](https://fastify.dev/docs/latest/Reference/Decorators/)、[Plugins Guide](https://fastify.dev/docs/latest/Guides/Plugins-Guide/)、[fastify-plugin](https://github.com/fastify/fastify-plugin)。

下一章，[看清一个请求在 Fastify 里经历的每个阶段](./04-lifecycle-and-hooks.md)。
