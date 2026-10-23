# 第 13 章：Pino 结构化日志——可检索、可关联、不泄密

[上一章](./12-api-reference-ui.md) · [目录](./README.md) · [下一章](./14-testing-with-inject.md)

前几章已经零散地用到了日志：认证后给日志加 `userId`、错误处理器按状态码选择日志级别、慢请求告警。本章系统地讲清楚 Fastify 内置的 **Pino** 日志：它输出什么、怎样组织字段、怎样避免把密码写进日志，以及怎样在测试里检查日志。

## 13.1 为什么是“结构化”日志

前端开发时你可能习惯了：

```ts
console.log(`用户 ${userId} 更新了任务 ${taskId}，修改了 ${fields.join(",")}`);
```

这对人眼友好，但对机器很不友好。线上一天可能产生几百万行日志，你需要回答这样的问题：

- “请求 `3b9e…` 都发生了什么？”
- “过去一小时，`TASK_TITLE_CONFLICT` 出现了多少次？”
- “用户 `0001` 今天修改过哪些任务？”

在纯文本里回答这些问题只能靠正则表达式，又慢又容易出错。**结构化日志**把每条日志写成一行 JSON：

```json
{
  "level": 30,
  "time": 1792679175344,
  "requestId": "3b9e…",
  "userId": "0001",
  "taskId": "1000…",
  "changedFields": ["priority"],
  "msg": "task updated"
}
```

日志平台（ELK、Loki、各云厂商的日志服务）能直接按字段检索、聚合、告警：`requestId:"3b9e…"`、`msg:"task updated" AND userId:"0001"`。

## 13.2 Fastify 中的 Pino

Fastify 内置了 Pino。日志**默认关闭**，在创建实例时用 `logger` 选项开启：

```ts
const app = Fastify({ logger: true }); // 默认级别 info
const app = Fastify({ logger: { level: "debug" } }); // 传 Pino 的配置对象
```

日志一旦在创建时关闭，运行时就无法再打开（Fastify 会用一个空实现替代）。

### 日志级别

| 级别    | 数值 | 用途                                               |
| ------- | ---- | -------------------------------------------------- |
| `trace` | 10   | 极细粒度的调试信息                                 |
| `debug` | 20   | 开发调试                                           |
| `info`  | 30   | 正常的业务事件：请求完成、任务创建                 |
| `warn`  | 40   | 值得注意但不影响服务：慢请求、重试、使用了废弃接口 |
| `error` | 50   | 需要处理的错误：未预期的异常、依赖故障             |
| `fatal` | 60   | 进程即将退出                                       |

设置 `level: 'info'` 表示只输出数值 ≥ 30 的日志。JSON 里的 `level` 字段就是这个数值。

### 默认的请求日志

开启 logger 后，Fastify 会为每个请求自动输出两条日志（真实输出，已省略 `time`、`pid`、`hostname`）：

```json
{"level":30,"requestId":"b3a6…","req":{"method":"GET","url":"/v1/tasks","host":"127.0.0.1:3999","remoteAddress":"127.0.0.1","userAgent":"curl/8.7.1"},"msg":"incoming request"}
{"level":30,"requestId":"b3a6…","res":{"statusCode":200},"responseTime":6.33,"msg":"request completed"}
```

`requestId`（Fastify 默认叫 `reqId`，13.6 节改名）把这两条与该请求的所有其他日志关联起来；`responseTime` 是毫秒数。

## 13.3 `app.log` 与 `request.log`

```ts
app.log.info("database connections closed"); // 与具体请求无关
request.log.info({ taskId: task.id }, "task created"); // 属于某个请求
```

`request.log` 是一个**子 logger**（child logger），它已经绑定了 `requestId`，所以写出的每条日志都自动带上这个字段。**在请求处理过程中，始终用 `request.log`**，否则这条日志就无法关联到请求。

## 13.4 结构化字段的写法

Pino 的调用约定是：**第一个参数放数据对象，第二个参数放消息**。

```ts
// ✅ 推荐：消息是固定文本，变化的数据放在字段里
request.log.info({ taskId: task.id }, "task created");

// ❌ 不推荐：数据拼进了消息
request.log.info(`task ${task.id} created`);
```

为什么？固定的消息可以精确检索和计数（`msg:"task created"`），变化的数据成为可以过滤、聚合的字段。消息里拼接了 ID，就再也没法统计“今天创建了多少任务”。

几条实用约定：

- **消息用简短、固定的英文短语**（`task created`、`request rejected`、`slow request`）：便于检索，与日志平台的各种工具兼容。
- **字段名全项目统一**：一处叫 `taskId`，另一处就别叫 `task_id` 或 `tid`。
- **错误放在 `err` 字段**：`request.log.error({ err: error }, 'unhandled error')`。Pino 的默认 `err` 序列化器会把错误对象展开成 `type`、`message`、`stack`。直接把 Error 作为第一个参数也会被放进 `err`。

## 13.5 子 logger：把上下文“绑定”进去

一个请求处理的过程中，有些字段在后面的每条日志里都需要，比如当前用户、当前操作的任务。用 `child()` 创建子 logger，把它们绑定进去：

```ts
// src/plugins/auth.ts —— 认证成功后
request.user = user;
// 之后本请求的所有日志都自动带上 userId
request.log = request.log.child({ userId: user.id });
```

```ts
// src/modules/tasks/routes.ts —— PATCH handler 里
const task = loadedTask(request);
// 子 logger：这条请求后续的日志都带上 taskId，而不必每次手写
const log = request.log.child({ taskId: task.id });

const ifMatch = request.headers["if-match"];
if (ifMatch !== undefined && ifMatch !== etagOf(task)) {
  log.info({ ifMatch, current: etagOf(task) }, "stale update rejected");
  throw new AppError("PRECONDITION_FAILED");
}

const updated = await app.taskService.update(task, request.body);
log.info({ changedFields: Object.keys(request.body) }, "task updated");
```

真实输出（配套测试断言了这些字段）：

```json
{
  "level": 30,
  "requestId": "…",
  "userId": "00000000-0000-4000-8000-000000000001",
  "taskId": "10000000-0000-4000-8000-000000000001",
  "changedFields": ["priority"],
  "msg": "task updated"
}
```

`requestId` 来自 Fastify 创建的请求级 logger，`userId` 来自认证 hook 绑定的子 logger，`taskId` 来自 handler 里的子 logger，`changedFields` 是这条日志自己的字段——四层上下文自然叠加。

两点说明：

- **为什么在 auth 里替换 `request.log`？** 之后的 hook、handler、错误处理器都用 `request.log`，替换后它们写出的日志都会带 `userId`，包括第 9 章错误处理器写的 `request rejected`。
- **性能**：Fastify 文档指出，子 logger 的绑定字段在创建时就被 Pino 预先序列化，比每次写日志时传入同样的字段更高效。如果需要在**每个请求创建时**就附加字段（例如从请求头读取追踪上下文），可以用 Fastify 的 `childLoggerFactory` 选项或 `setChildLoggerFactory`。

## 13.6 TaskHub 的日志配置：`src/logger.ts`

```ts
/** Pino 只需要一个带 write 方法的对象作为输出目标 */
export interface LogDestination {
  write(line: string): void;
}

export interface LoggingOptions {
  /** false 表示完全关闭日志（单元测试常用） */
  enabled: boolean;
  level?: string;
  /** 开发环境用 pino-pretty 输出人类可读格式；生产保持 JSON 一行一条 */
  pretty?: boolean;
  /** 测试时可以传入一个内存 stream 收集日志 */
  stream?: LogDestination;
}

/**
 * 需要在日志中隐藏的字段。
 * Pino 的 redact 路径是精确路径：'*.apiToken' 只匹配第二层（如 user.apiToken），
 * 顶层的 apiToken、更深的字段、数组元素里的字段都要单独写。
 */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "user.email",
  "password",
  "apiToken",
  "*.password",
  "*.apiToken",
];

export function buildLoggerOptions(
  options: LoggingOptions,
): FastifyServerOptions["logger"] {
  if (!options.enabled) return false;

  return {
    level: options.level ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
    serializers: {
      // 白名单式的 req 序列化：只记录排查需要的字段，比“全量记录再 redact”更安全
      req(request) {
        return {
          method: request.method,
          url: request.url,
          host: request.host,
          remoteAddress: request.ip,
          userAgent: request.headers["user-agent"],
        };
      },
    },
    ...(options.stream ? { stream: options.stream } : {}),
    ...(options.pretty && !options.stream
      ? {
          transport: {
            target: "pino-pretty",
            options: { translateTime: "HH:MM:ss Z", ignore: "pid,hostname" },
          },
        }
      : {}),
  };
}

/** 与错误响应里的 requestId 字段同名，方便日志与响应对照 */
export const logController = new LogController({
  requestIdLogLabel: "requestId",
});
```

```ts
// src/app.ts
const app = Fastify({
  logger: buildLoggerOptions(options.logging ?? { enabled: false }),
  logController,
  genReqId,
});
```

```ts
// src/server.ts
const app = await buildApp({
  logging: {
    enabled: true,
    level: config.logLevel,
    pretty: config.env === "development",
  },
  // ...
});
```

下面逐项解释。

### 序列化器：用白名单决定记录什么

Pino 的**序列化器**（serializers）决定特定字段如何被转换成日志内容。Fastify 默认为 `req`、`res`、`err` 提供了序列化器。TaskHub 覆盖了 `req`，**只挑选**排查需要的五个字段，而没有记录全部请求头。

这是一种**白名单**策略：默认什么都不记，明确需要才加。Fastify 文档在示例中特意警告：记录完整的请求/响应头**可能暴露认证信息、违反隐私法规**，应使用 redact 处理。白名单比事后 redact 更安全，因为你不需要预先知道所有可能的敏感头名（例如某个第三方客户端发送的 `x-api-key`）。

另外注意 Fastify 文档提到的两点：`req` 序列化器在创建请求 logger 时就执行了，此时**还没有解析 body**，所以不能在这里记录请求体；序列化器**绝不能抛错**，否则可能导致进程退出。

### redact：最后一道过滤

即使序列化器是白名单，业务代码仍然可能把敏感对象写进日志——比如某人为了调试写了 `request.log.info({ user }, 'debug')`，而 `user` 里有 `apiToken`。**redact** 在 Pino 写出日志前，把指定路径的值替换成 `[Redacted]`。

Redact 的路径匹配规则必须亲手验证。下面是在 `redact: ['*.apiToken', 'note']` 配置下的真实输出：

```ts
app.log.info(
  {
    user: { apiToken: "a", deep: { apiToken: "b" } },
    apiToken: "top",
    note: "token=abc",
  },
  "msg with token=xyz",
);
app.log.info({ list: [{ apiToken: "c" }] }, "array");
```

```json
{"level":30,"user":{"apiToken":"[Redacted]","deep":{"apiToken":"b"}},"apiToken":"top","note":"[Redacted]","msg":"msg with token=xyz"}
{"level":30,"list":[{"apiToken":"c"}],"msg":"array"}
```

| 路径                            | 是否被 `*.apiToken` 隐藏            |
| ------------------------------- | ----------------------------------- |
| `user.apiToken`（第二层）       | ✅                                  |
| `apiToken`（顶层）              | ❌ 需要单独写 `apiToken`            |
| `user.deep.apiToken`（第三层）  | ❌ 需要写 `*.*.apiToken` 或具体路径 |
| `list[0].apiToken`（数组元素）  | ❌ 需要写 `list[*].apiToken`        |
| 消息文本 `msg` 中的 `token=xyz` | ❌ redact **从不检查字符串内容**    |

这就是 TaskHub 的 `REDACT_PATHS` 同时写了 `apiToken` 和 `*.apiToken` 的原因。结论很明确：**redact 是安全网，不是防线**。真正的防线是：不把敏感对象传给 logger、不把敏感值拼进消息、用白名单序列化器。

配套测试验证了 redact 配置确实生效：

```ts
it("redact：即使有人把带敏感字段的对象写进日志，也会被替换", async () => {
  const logs = createLogCollector();
  const app = await createTestApp({
    logging: { enabled: true, stream: logs.stream },
  });
  app.get("/debug-user", async (request) => {
    const user = await app.db.users.findById(SEED_IDS.alice);
    request.log.info({ user, headers: request.headers }, "debug dump");
    return { ok: true };
  });

  await app.inject({
    url: "/debug-user",
    headers: { authorization: "Bearer secret-value" },
  });
  const dump = logs.lines.find((line) => line.msg === "debug dump") as {
    user: Record<string, unknown>;
    headers: Record<string, unknown>;
  };
  expect(dump.user).toMatchObject({
    name: "Alice",
    apiToken: "[Redacted]",
    email: "[Redacted]",
  });
  expect(dump.headers.authorization).toBe("[Redacted]");
});
```

### LogController：请求 ID 字段改名

Fastify 默认把请求 ID 记为 `reqId`。TaskHub 的错误响应里叫 `requestId`，日志里也用同一个名字，排查时不用在两个名字之间切换。

在 Fastify 5.12 中，旧的顶层选项 `requestIdLogLabel` 和 `disableRequestLogging` 已被标记为废弃（文档说明将在 Fastify 6 中移除），推荐改用 `logController` 选项：

```ts
export const logController = new LogController({
  requestIdLogLabel: "requestId",
});
```

`LogController` 还允许按条件关闭请求日志（`disableRequestLogging: (req) => req.url === '/healthz'`），或者继承它并重写 `incomingRequest`、`requestCompleted` 等方法来定制 Fastify 自动输出的请求日志。

### 开发环境与生产环境

- **开发**：用 `pino-pretty` 把 JSON 转换成彩色、多行的可读格式（第 2 章 `npm run dev` 看到的就是它）。它通过 Pino 的 `transport` 机制运行在单独的工作线程里。`pino-pretty` 只装在 devDependencies，Fastify 文档也明确它不应用于生产。
- **生产**：直接输出 JSON 到标准输出（stdout），**不要**在应用里写日志文件、做日志轮转。容器平台和日志采集器（Fluent Bit、Vector 等）负责收集 stdout，这是十二要素应用的通行做法。
- **测试**：默认关闭（`enabled: false`）；需要断言日志时，传入一个内存 `stream`（13.9 节）。

## 13.7 日志级别的使用策略

| 场景                         | 级别                      | TaskHub 中的位置                                                |
| ---------------------------- | ------------------------- | --------------------------------------------------------------- |
| 请求进入/完成                | info                      | Fastify 自动输出                                                |
| 业务事件（创建、修改、删除） | info                      | 任务路由                                                        |
| 客户端错误（4xx）            | info                      | 错误处理器 `request rejected`，只记 `code` 和 `statusCode`      |
| 慢请求、并发冲突被拒绝       | warn / info               | `request-context` 插件（warn）、`stale update rejected`（info） |
| 未预期的错误（5xx）          | error                     | 错误处理器 `unhandled error`，记录完整 `err`                    |
| 健康检查                     | 路由级 `logLevel: 'warn'` | `/healthz`：不产生 info 级请求日志                              |
| 文档页面的静态资源           | 插件 `logLevel: 'warn'`   | `docs` 插件                                                     |

几条原则：

- **4xx 不是 error**。客户端传错参数、没登录、访问不存在的资源都是正常的业务现象。把它们记成 error，告警会被淹没，真正的故障反而没人看。
- **5xx 一定要有完整的错误信息**，因为客户端只拿到了“服务器内部错误”和一个 `requestId`，日志是唯一的线索。
- **路由级 `logLevel`** 可以降低高频、低价值路由的日志量。健康检查每几秒一次，记录它们只会制造噪音。
- **全局级别用环境变量控制**（`LOG_LEVEL`），线上排查问题时可以临时调到 `debug`。

## 13.8 什么该记，什么不该记

| 该记                                        | 不该记                                                 |
| ------------------------------------------- | ------------------------------------------------------ |
| 请求 ID、用户 ID、资源 ID                   | 密码、token、API Key、Cookie、会话 ID                  |
| 方法、路由模板、状态码、耗时                | 完整请求头、完整请求体                                 |
| 错误码、错误类型、stack（服务端错误）       | 身份证号、手机号、邮箱等个人信息（除非确有必要且合规） |
| 业务事件与关键字段的变化（`changedFields`） | 字段的具体内容（如任务描述全文）                       |
| 外部依赖的调用结果与耗时                    | 第三方返回的完整响应                                   |

TaskHub 记录的是 `changedFields: ['priority']`（改了哪些字段），而不是改成了什么值——足够排查问题，又不会把用户内容复制进日志系统。

## 13.9 在测试中断言日志

日志也是系统行为的一部分：错误处理器有没有记录 5xx、redact 有没有生效、请求 ID 是否一致。把一个收集器作为 Pino 的输出目标传进去：

```ts
// test/helpers.ts
/** 收集 Pino 输出的 JSON 行，用来断言日志内容 */
export function createLogCollector() {
  const lines: Record<string, unknown>[] = [];
  return {
    lines,
    stream: {
      write(line: string) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  };
}
```

```ts
it("每条请求日志都带 requestId；请求完成日志带状态码与耗时", async () => {
  const logs = createLogCollector();
  const app = await createTestApp({
    logging: { enabled: true, stream: logs.stream },
  });
  const response = await app.inject({
    url: "/v1/me",
    headers: bearer("alice"),
  });
  const requestId = response.headers["x-request-id"];

  const mine = logs.lines.filter((line) => line.requestId === requestId);
  expect(mine.map((line) => line.msg)).toEqual([
    "incoming request",
    "request completed",
  ]);

  const completed = mine[1];
  expect(completed).toMatchObject({ level: 30, res: { statusCode: 200 } });
  expect(typeof completed?.responseTime).toBe("number");
});
```

`test/logging.test.ts` 中还有：白名单序列化器不会记录 token、子 logger 附加 `userId`/`taskId`、4xx 记为 info、`/healthz` 不产生 info 日志、全局级别 `warn` 时没有 info 日志、慢请求 warn、关闭时执行 `onClose` 等测试。

## 13.10 练习

1. 下面这行日志有哪些问题？请改写。

   ```ts
   request.log.error(
     `用户 ${user.email} 登录失败，密码 ${body.password} 不正确`,
   );
   ```

2. 某个第三方 SDK 抛出的错误对象带有 `config.headers.Authorization` 字段（包含 token）。在错误处理器中 `request.log.error({ err: error })` 时，这个 token 会被记录吗？怎样防止？
3. 为什么错误处理器里 4xx 只记录 `code` 和 `statusCode`，不记录完整的 `err`？
4. 如何让 TaskHub 在生产环境中临时输出 debug 级别的日志？

**参考答案**

1. 问题：把邮箱和密码拼进了消息（redact 管不到字符串内容）；登录失败是客户端问题，不应是 error 级别；消息不固定，无法统计。改写：`request.log.info({ userId: user.id, reason: 'invalid_password' }, 'login failed')`——不记录密码，用 ID 代替邮箱，用固定消息和结构化字段。
2. 会。Pino 默认的 `err` 序列化器会展开错误对象的可枚举属性。防止方法：在 redact 中加入对应路径（如 `err.config.headers.Authorization`）；更稳妥的是在调用 SDK 的地方捕获错误，包装成只含必要信息的新错误（通过 `cause` 保留原错误时同样要注意这个问题），或者为 `err` 配置自定义序列化器，只挑选 `type`、`message`、`stack` 等字段。
3. 4xx 是预期内的、由客户端造成的情况，`stack` 没有排查价值，只会大量增加日志体积；`code` 已经足以说明发生了什么。5xx 才需要完整的错误对象。
4. 设置环境变量 `LOG_LEVEL=debug` 并重启（`server.ts` 把它传给 `buildLoggerOptions`）。生产环境要注意 debug 日志量和可能包含的更多细节，排查完应及时恢复。

## 本章验收

- [ ] 能解释结构化日志的价值，说出 Pino 的六个级别及其数值。
- [ ] 能区分 `app.log` 与 `request.log`，并按“数据对象 + 固定消息”的方式写日志。
- [ ] 能用子 logger 把 `userId`、`taskId` 等上下文绑定到后续日志中。
- [ ] 能配置白名单式的 `req` 序列化器，解释为什么它比全量记录更安全。
- [ ] 能配置 redact，并用实验说明它的路径匹配规则和局限。
- [ ] 能用 `LogController` 修改请求 ID 字段名，并为不同场景选择合适的日志级别。
- [ ] 能在测试中收集并断言日志。

官方阅读：[Fastify Logging](https://fastify.dev/docs/latest/Reference/Logging/)、[Server：logger / logController / childLoggerFactory](https://fastify.dev/docs/latest/Reference/Server/#logger)、[Pino 文档](https://getpino.io/)、[Pino：Redaction](https://getpino.io/#/docs/redaction)。

下一章，[用 `app.inject` 为整个应用写集成测试](./14-testing-with-inject.md)。
