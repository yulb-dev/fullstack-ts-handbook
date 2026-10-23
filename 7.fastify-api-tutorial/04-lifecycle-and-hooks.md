# 第 4 章：请求生命周期与 Hook

[上一章](./03-plugins-encapsulation-decorators.md) · [目录](./README.md) · [下一章](./05-json-schema-validation.md)

一个请求进入 Fastify 之后，并不是“直接调用 handler”。它会依次经过路由匹配、身份检查、请求体解析、校验、业务处理、序列化、发送……每个阶段之间，Fastify 都留了一个**钩子（hook）**，让你插入自己的代码。

本章目标：说清楚每个 hook **在什么时候运行、能拿到什么、适合做什么**，并用一个能跑的实验验证执行顺序。最后把 TaskHub 的认证、授权、输入规范化、请求 ID 回写都放到正确的 hook 上。

## 4.1 生命周期全景

下面这张图来自 Fastify 官方文档（翻译了标注）。右边是正常流程，左边是“这一步抛错时”的结果：

```text
请求进入
  │
  └─▶ 路由匹配
        │
        └─▶ 创建请求级 logger
             │
   4xx/5xx ◀─┴─▶ onRequest            ← 此时还没有解析 body
                  │
        4xx/5xx ◀─┴─▶ preParsing     ← 可以替换原始请求流
                        │
              4xx/5xx ◀─┴─▶ 解析 body（Content-Type Parser）
                             │
                   4xx/5xx ◀─┴─▶ preValidation   ← body 已解析，但还没校验
                                  │
                            400 ◀─┴─▶ schema 校验
                                        │
                              4xx/5xx ◀─┴─▶ preHandler   ← 输入已经合法
                                              │
                                    4xx/5xx ◀─┴─▶ handler（你的业务代码）
                                                    │
                                                    └─▶ reply
                                                          │
                                                4xx/5xx ◀─┴─▶ preSerialization  ← 拿到的是 JS 对象
                                                                │
                                                                └─▶ onSend       ← 拿到的是序列化后的字符串
                                                                      │
                                                            4xx/5xx ◀─┴─▶ 发出响应
                                                                            │
                                                                            └─▶ onResponse  ← 响应已发出
```

任何一步抛出错误（或 `throw`、或传给 `done(err)`），Fastify 都会跳过后续的正常步骤，转去执行 `onError` hook 和错误处理器（第 9 章），然后仍然会走 `onSend` 和 `onResponse`。

## 4.2 每个 hook 的职责

| Hook               | 触发时机                         | `request.body`                       | 适合做                                                                   | 不适合做                                         |
| ------------------ | -------------------------------- | ------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------ |
| `onRequest`        | 路由匹配后第一个                 | **永远是 `undefined`**               | 认证（谁在调用）、限流、拒绝明显不该处理的请求                           | 依赖 body 的逻辑                                 |
| `preParsing`       | 解析 body 之前                   | `undefined`，但能拿到原始 payload 流 | 解压、解密、统计原始字节                                                 | 一般业务逻辑（极少用到）                         |
| `preValidation`    | body 已解析、**未校验**          | 已解析，但形状不可信                 | 在校验前**规范化**输入（去空白、兼容旧字段名）、需要原始 body 的签名校验 | 查数据库、信任 body 的形状                       |
| `preHandler`       | 校验通过之后，handler 之前       | 已校验，形状可信                     | **授权**（能不能操作这个资源）、按参数加载资源                           | 重复做 schema 能做的事                           |
| `preSerialization` | handler 返回对象之后、序列化之前 | —                                    | 统一包装响应对象                                                         | payload 是字符串/Buffer/流/null 时**不会被调用** |
| `onSend`           | 序列化之后、发送之前             | —                                    | 设置响应头、修改最终字符串（压缩等）                                     | 改变响应结构（此时已经是字符串）                 |
| `onResponse`       | 响应已经发给客户端               | —                                    | 指标统计、访问日志、慢请求告警                                           | 再发送任何数据                                   |
| `onError`          | 发生错误时，错误处理器之前       | —                                    | 额外的错误日志、加响应头                                                 | 修改错误或发送响应（会抛异常）                   |
| `onTimeout`        | 连接超时（`connectionTimeout`）  | —                                    | 监控                                                                     | 发送数据（socket 已挂断）                        |
| `onRequestAbort`   | 客户端提前断开                   | —                                    | 取消下游工作、记录                                                       | 发送数据                                         |

把它浓缩成三句话：

1. **`onRequest` 回答“你是谁”**——此时最便宜，body 还没读，拒绝一个请求几乎零成本。
2. **`preHandler` 回答“你能不能做这件事”**——此时参数已经通过校验，`taskId` 一定是合法 UUID，可以放心查库。
3. **`onSend` / `onResponse` 处理“发出去之后”的事**——写响应头、记指标。

## 4.3 动手实验：亲眼看到执行顺序

下面的代码给每个 hook 都挂上记录函数，然后发两次请求：一次合法，一次校验失败。它就是配套工程 `test/plugins.test.ts` 中的测试：

```ts
import Fastify from "fastify";

async function buildProbe() {
  const calls: string[] = [];
  const app = Fastify();

  app.addHook("onRequest", async () => {
    calls.push("onRequest");
  });
  app.addHook("preParsing", async (_request, _reply, payload) => {
    calls.push("preParsing");
    return payload;
  });
  app.addHook("preValidation", async () => {
    calls.push("preValidation");
  });
  app.addHook("preHandler", async () => {
    calls.push("preHandler");
  });
  app.addHook("preSerialization", async (_request, _reply, payload) => {
    calls.push("preSerialization");
    return payload;
  });
  app.addHook("onError", async () => {
    calls.push("onError");
  });
  app.addHook("onSend", async (_request, _reply, payload) => {
    calls.push("onSend");
    return payload;
  });
  app.addHook("onResponse", async () => {
    calls.push("onResponse");
  });

  app.post(
    "/probe",
    {
      // 路由级 hook 总是排在同类共享 hook 之后
      preHandler: async () => {
        calls.push("route preHandler");
      },
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
      },
    },
    async () => {
      calls.push("handler");
      return { ok: true };
    },
  );

  await app.ready();
  return { app, calls };
}
```

注意 `preParsing`、`preSerialization`、`onSend` 这三个 hook 多一个 `payload` 参数，async 写法里**必须 `return payload`**（或返回替换后的值），否则后续拿到的是 `undefined`。

**合法请求** `POST /probe {"name":"x"}` 的记录：

```text
onRequest → preParsing → preValidation → preHandler → route preHandler → handler
→ preSerialization → onSend → onResponse
```

**校验失败** `POST /probe {"other":1}` 的记录：

```text
onRequest → preParsing → preValidation → onError → onSend → onResponse
```

从第二个结果可以读出很多信息：

- 校验失败后，`preHandler` 和 handler **都不会执行**——所以 handler 里永远不用担心拿到非法输入。
- `onError` 被调用了，它在错误处理器之前执行。
- `preSerialization` **没有**执行：错误响应不走这个 hook。如果你想用 `preSerialization` 给所有响应包一层 `{ data: ... }`，要记得错误响应不会被包装。
- `onSend` 和 `onResponse` **仍然执行**——所以在 `onSend` 里写的 `x-request-id` 响应头，错误响应也会带上；在 `onResponse` 里做的统计，也覆盖错误请求。

> 测试里在断言前调用了 `await app.close()`。原因是 `onResponse` 在响应**发出之后**才执行，`inject` 返回时它可能还没跑完；`close()` 会等待所有进行中的请求完全结束。

## 4.4 共享 hook 与路由级 hook

hook 有两种挂法：

```ts
// 1. 共享 hook：作用于当前作用域（及其子作用域）的所有路由
app.addHook("preHandler", async (request) => {
  /* ... */
});

// 2. 路由级 hook：只作用于这一个路由，写在路由选项里
app.get(
  "/x",
  {
    preHandler: async (request) => {
      /* ... */
    },
    // 也可以是数组：preHandler: [hookA, hookB]
  },
  handler,
);
```

规则：

- 共享 hook **遵守封装规则**（第 3 章）：在 `/v1` 插件里 `addHook`，只影响 `/v1` 下的路由。唯一的例外是 `onClose`。
- 同一类 hook，**路由级的总是在共享的之后**执行（实验里 `route preHandler` 排在 `preHandler` 之后）。
- 同一作用域内的多个共享 hook 按注册顺序执行；父作用域的先于子作用域的。
- **hook 只对“注册之后”添加的路由生效**吗？不是。Fastify 在 `ready` 时才为每个路由组装 hook 链，同一作用域内先加路由再 `addHook` 也会生效。但为了可读性，习惯上先挂 hook 再定义路由。

## 4.5 在 hook 里拒绝请求、提前响应

最常见的是**抛错**，让错误处理器统一生成响应：

```ts
app.addHook("onRequest", async (request) => {
  if (!request.headers.authorization) {
    throw new AppError("UNAUTHORIZED"); // 后续 hook 和 handler 都不会执行
  }
});
```

也可以直接发送响应（例如返回缓存命中的结果）。在 async hook 里这样做时，**必须 `return reply`**，否则 Fastify 会以为 hook 正常结束，继续往下执行，最终报“响应已发送”的错误：

```ts
app.addHook("preHandler", async (request, reply) => {
  const cached = cache.get(request.url);
  if (cached) {
    return reply.send(cached); // return reply 是必须的
  }
});
```

另外两条规则：

- 同一个 hook **不要混用** `done` 回调和 async/Promise，否则 hook 链会被执行两次。本书统一用 async 写法。
- 在 hook 里修改 `request`，要用**事先 `decorateRequest` 过的属性**（第 3 章），不要随手添加新属性。

## 4.6 应用级 hook

除了请求级 hook，还有一组围绕**应用本身**的 hook：

| Hook         | 时机                                   | 典型用途                                                                                                         |
| ------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `onRoute`    | 每注册一个路由时（同步）               | 插件用它收集或修改路由配置。**@fastify/swagger 用它收集路由生成文档，@fastify/rate-limit 用它给路由加限流 hook** |
| `onRegister` | 每创建一个新的封装作用域时             | 插件初始化作用域级状态                                                                                           |
| `onReady`    | `ready()` 时、开始监听之前             | 预热缓存、检查依赖                                                                                               |
| `onListen`   | 开始监听后                             | 通知、打印地址（`inject`/`ready` 不会触发）                                                                      |
| `preClose`   | `close()` 开始时，仍在处理进行中的请求 | 主动关闭 WebSocket/SSE 等长连接                                                                                  |
| `onClose`    | 所有请求处理完、连接已释放之后         | **释放资源**：关闭数据库连接池、消息队列                                                                         |

`onClose` 的执行顺序是**子插件先于父插件**——数据库插件的清理先于根上的清理，正好符合“先关依赖方，再关被依赖方”的直觉。TaskHub 的 `db` 插件就在 `onClose` 里“关闭连接”。

`onRoute` 值得多看一眼：它解释了为什么 **@fastify/swagger 必须在业务路由之前注册**——它是靠这个 hook “看到”路由的，注册它之前就已经存在的路由，它的 hook 不会被调用（第 11 章有实验）。

## 4.7 TaskHub 中每个 hook 放在哪里

现在把 TaskHub 需要的横切逻辑一一放进生命周期：

| 需求                       | Hook                                  | 作用域       | 位置                                    |
| -------------------------- | ------------------------------------- | ------------ | --------------------------------------- |
| 识别调用者（Bearer token） | `onRequest`                           | `/v1` 作用域 | `v1.ts` 挂 `app.authenticate`           |
| 只有管理员能访问           | `onRequest`（路由级）                 | 单个路由     | `users/routes.ts`                       |
| 创建任务限流               | `onRequest`（路由级，由插件自动添加） | 单个路由     | `tasks/routes.ts` 的 `config.rateLimit` |
| 校验前去掉标题首尾空白     | `preValidation`（路由级）             | POST/PATCH   | `tasks/routes.ts`                       |
| 加载任务、检查能否修改     | `preHandler`（路由级）                | PATCH/DELETE | `tasks/routes.ts`                       |
| 响应头写回请求 ID          | `onSend`                              | 根（`fp`）   | `plugins/request-context.ts`            |
| 记录慢请求                 | `onResponse`                          | 根（`fp`）   | `plugins/request-context.ts`            |
| 关闭数据库                 | `onClose`                             | 根（`fp`）   | `plugins/db.ts`                         |

### 认证插件：`src/plugins/auth.ts`

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { UserRecord } from "../data/memory-store.js";
import { AppError } from "../errors/app-error.js";
import type { UserRole } from "../schemas/user.js";

type AuthHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module "fastify" {
  interface FastifyInstance {
    /** 校验 Bearer token 并把用户放到 request.user 上；失败抛出 401 */
    authenticate: AuthHook;
    /** 生成一个检查角色的 hook；角色不符抛出 403 */
    requireRole: (role: UserRole) => AuthHook;
  }
  interface FastifyRequest {
    /** 未经过 authenticate 的路由上永远是 null */
    user: UserRecord | null;
  }
}

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

/** 在需要登录的 handler 里取当前用户；拿不到说明路由忘了挂 authenticate */
export function currentUser(request: FastifyRequest): UserRecord {
  if (!request.user) throw new AppError("UNAUTHORIZED");
  return request.user;
}

export default fp(
  async function authPlugin(app) {
    // 先用 null 声明形状，每个请求再赋值；不要用对象做默认值，否则所有请求会共享同一个引用
    app.decorateRequest("user", null);

    app.decorate(
      "authenticate",
      async function authenticate(request: FastifyRequest) {
        const match = BEARER_PATTERN.exec(request.headers.authorization ?? "");
        const token = match?.[1];
        if (!token) {
          throw new AppError("UNAUTHORIZED", {
            headers: { "www-authenticate": "Bearer" },
          });
        }

        const user = await app.db.users.findByToken(token);
        if (!user) {
          // 响应体与“没带 token”完全相同，不透露更多信息；
          // 只有 WWW-Authenticate 按 RFC 6750 标出 invalid_token，提示客户端重新获取凭证
          throw new AppError("UNAUTHORIZED", {
            headers: { "www-authenticate": 'Bearer error="invalid_token"' },
          });
        }

        request.user = user;
        // 之后本请求的所有日志都自动带上 userId
        request.log = request.log.child({ userId: user.id });
      },
    );

    app.decorate("requireRole", function requireRole(role: UserRole): AuthHook {
      return async function checkRole(request: FastifyRequest) {
        if (currentUser(request).role !== role) throw new AppError("FORBIDDEN");
      };
    });
  },
  { name: "auth", fastify: "5.x", dependencies: ["db"] },
);
```

设计要点：

- 插件本身**只提供**认证函数，**不挂** hook。哪里需要认证，由使用方决定（`v1.ts` 里一行 `addHook`）。这样 `/healthz`、`/docs` 不会被误伤。
- `AppError` 是第 9 章的统一错误类型；这里只需知道抛出它就会得到对应状态码和统一格式的响应。
- `request.log = request.log.child(...)` 让后续日志自动带 `userId`，第 13 章详述。

> 本书用固定 token 查表来模拟认证，目的是把注意力放在“认证放在哪个 hook”上。真实项目通常用 JWT（`@fastify/jwt`）或会话（`@fastify/session`），并且数据库里只存 token 的哈希。无论用哪种，**放在 `onRequest` 这个位置**的原则不变。

**为什么认证用 `onRequest`，不用 `preHandler`？** 配套测试里有一个直接的证据：

```ts
it("认证放在 onRequest：未登录请求在解析 body 之前就被拒绝", async () => {
  const app = await createTestApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/tasks",
    headers: { "content-type": "application/json" },
    payload: "{broken json",
  });
  // 如果先解析 body，这里会是 400 INVALID_JSON
  expect(response.statusCode).toBe(401);
});
```

未登录的请求连 body 都不会被读取和解析。如果有人用匿名请求发送大量 1MB 的垃圾 JSON，服务器在第一步就拒绝，不浪费 CPU 去解析。

### 角色检查：路由级 `onRequest`

```ts
app.get(
  "/admin/users/:userId",
  {
    // 路由级 onRequest 在作用域级 onRequest（authenticate）之后执行，此时 request.user 已就绪
    onRequest: app.requireRole("admin"),
    schema: {
      /* ... */
    },
  },
  async (request) => {
    /* ... */
  },
);
```

这里利用了 4.4 节的规则：路由级 hook 排在同类共享 hook 之后。`/v1` 作用域的 `authenticate` 先跑，`requireRole` 后跑，所以它能拿到 `request.user`。

### 输入规范化：`preValidation`

```ts
/**
 * preValidation：在 schema 校验之前规范化原始输入。
 * 去掉首尾空白后再校验，"   " 这样的标题就会因为 minLength 被拒绝。
 * 这里只做纯计算，不访问数据库。
 */
async function trimBodyStrings(request: FastifyRequest): Promise<void> {
  const body = request.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) return;
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string")
      (body as Record<string, unknown>)[key] = value.trim();
  }
}
```

为什么必须在**校验之前**？如果在 handler 里再 trim，`"   "` 早已通过了 `minLength: 1` 的校验，trim 之后变成空字符串存进数据库。放在 `preValidation`，校验看到的就是规范化后的值。

注意函数开头的防御：在 `preValidation` 阶段 body **还没有被校验**，它可能是 `null`、数组、字符串，代码不能假设它是对象。

### 授权与资源加载：`preHandler`

```ts
// tasks/routes.ts（插件内部）
app.decorateRequest("task", null);

/**
 * preHandler：此时参数已经通过校验（taskId 一定是 UUID），可以放心查库。
 * 统一处理“任务是否存在 / 是否有权修改”，handler 只关心更新本身。
 */
async function loadWritableTask(request: FastifyRequest): Promise<void> {
  const actor = currentUser(request);
  // params 已经被 TaskParamsSchema 校验过；这个 hook 被多个路由复用，所以在这里显式标注类型
  const { taskId } = request.params as { taskId: string };
  const task = await app.taskService.getVisible(actor, taskId);
  app.taskService.assertCanWrite(actor, task);
  request.task = task;
}

app.patch(
  "/tasks/:taskId",
  {
    preValidation: trimBodyStrings,
    preHandler: loadWritableTask,
    schema: {
      /* params / headers / body / response */
    },
  },
  async (request, reply) => {
    const task = loadedTask(request); // 取出 preHandler 放好的任务
    // ...
  },
);
```

PATCH 和 DELETE 共享同一套“存在吗、能改吗”的检查，放进一个 `preHandler` 复用。handler 只剩下真正的更新逻辑。`request.task` 是在任务插件内部 `decorateRequest` 的，只在任务模块里存在。

> 也有团队偏好把所有授权判断都写在 service 里、不用 `preHandler`。两种都可以，关键是**授权在校验之后、业务之前**发生。TaskHub 的做法是：判断规则本身（`getVisible`、`assertCanWrite`）写在 service 里便于单独测试，`preHandler` 只负责“在正确的时机调用它”。

### 横切关注点：`src/plugins/request-context.ts`

```ts
import fp from "fastify-plugin";

export interface RequestContextOptions {
  /** 超过这个耗时（毫秒）的请求记一条 warn 日志 */
  slowRequestMs?: number;
}

/**
 * 请求级的横切关注点：
 *  - onSend：把请求 ID 回写到响应头，客户端报错时可以带上它；
 *  - onResponse：响应已经发出后做统计，这里记录慢请求。
 * 这两个 hook 对所有路由生效，所以用 fastify-plugin 注册到根作用域。
 */
export default fp<RequestContextOptions>(
  async function requestContextPlugin(app, options) {
    const slowRequestMs = options.slowRequestMs ?? 1000;

    app.addHook("onSend", async (request, reply, payload) => {
      reply.header("x-request-id", request.id);
      return payload;
    });

    app.addHook("onResponse", async (request, reply) => {
      if (reply.elapsedTime > slowRequestMs) {
        request.log.warn(
          {
            route: request.routeOptions.url,
            statusCode: reply.statusCode,
            elapsedMs: Math.round(reply.elapsedTime),
          },
          "slow request",
        );
      }
    });
  },
  { name: "request-context", fastify: "5.x" },
);
```

为什么写响应头用 `onSend` 而不是 `onRequest`？因为 `onSend` 对**所有**发出的响应都会执行——包括校验失败、404、500 等错误响应（4.3 节的实验已经证明）。用 `request.routeOptions.url`（路由模板 `/v1/tasks/:taskId`）而不是 `request.url`（具体路径），是为了让同一个接口的慢请求能聚合统计。

## 4.8 常见错误

| 现象                                                | 原因                                    | 解决                                      |
| --------------------------------------------------- | --------------------------------------- | ----------------------------------------- |
| 在 `onRequest` 里读 `request.body` 得到 `undefined` | 此时还没解析 body                       | 改到 `preValidation`/`preHandler`         |
| `onSend` 后客户端收到空响应                         | async 的 `onSend` 忘了 `return payload` | 返回 payload                              |
| hook 里 `reply.send()` 之后报“响应已发送”           | async hook 发完响应没 `return reply`    | `return reply.send(...)`                  |
| 认证 hook 加在插件里，但路由没被保护                | 插件被封装，hook 只作用于插件内部       | 在需要保护的作用域里 `addHook`，或用 `fp` |
| 想在 `onResponse` 里改状态码                        | 响应已经发出                            | 在 `onSend` 或更早处理                    |
| 在 `onError` 里 `reply.send` 抛异常                 | `onError` 不允许发送响应                | 在错误处理器里处理（第 9 章）             |

## 4.9 练习

1. 给 4.3 的探针再加一个路由级 `onRequest`，预测它在 `calls` 中的位置，再运行验证。
2. 如果在 `onRequest` 里抛出错误，`calls` 会是什么？
3. TaskHub 想记录每个请求的“请求体字节数”，应该放在哪个 hook？
4. 有人建议“把 `trimBodyStrings` 改成在 handler 里调用，更直观”。用一个具体输入说明为什么不行。

**参考答案**

1. 在 `onRequest` 之后、`preParsing` 之前：路由级 hook 排在同类共享 hook 之后，但仍属于 `onRequest` 阶段。
2. `['onRequest', 'onError', 'onSend', 'onResponse']`：后面的解析、校验、handler 全部跳过。
3. `preParsing`（能接触原始流）或 `onResponse`（读取 `request.headers['content-length']` 做统计）。如果只是统计，后者更简单，也不影响请求处理。
4. 输入 `{ "title": "   " }`：校验时标题长度为 3，满足 `minLength: 1`，通过；handler 里 trim 之后变成空字符串写入数据库，违反了“标题不能为空”的契约。

## 本章验收

- [ ] 能按顺序说出 `onRequest`、`preParsing`、`preValidation`、`preHandler`、`preSerialization`、`onSend`、`onResponse`，以及校验失败时的路径。
- [ ] 能说出每个 hook 中 `request.body` 的状态，并据此决定认证、规范化、授权各放在哪里。
- [ ] 能解释共享 hook 与路由级 hook 的先后关系，以及 hook 的作用域。
- [ ] 能在 async hook 中正确地抛错、提前响应（`return reply`）、返回 payload。
- [ ] 能说出 `onRoute`、`onClose` 的用途，并解释它们与 @fastify/swagger、数据库插件的关系。

官方阅读：[Lifecycle](https://fastify.dev/docs/latest/Reference/Lifecycle/)、[Hooks](https://fastify.dev/docs/latest/Reference/Hooks/)、[Routes：路由级 hook](https://fastify.dev/docs/latest/Reference/Routes/#routes-options)。

下一章，[用 JSON Schema 在运行时守住输入](./05-json-schema-validation.md)。
