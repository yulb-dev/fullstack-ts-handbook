# 第 2 章：环境搭建与第一个路由

[上一章](./01-http-api-mental-model.md) · [目录](./README.md) · [下一章](./03-plugins-encapsulation-decorators.md)

本章从一个空目录开始，最后得到：一个能启动的 Fastify 服务、两个路由、一份能跑的集成测试。你会认识 Fastify 实例、路由、`request` 与 `reply`，并且理解为什么要把“组装应用”和“启动服务”拆成两个文件。

## 2.1 准备环境

需要 Node.js 22 或更高版本（本书用 Node 24 验证）：

```bash
node -v   # v24.x
npm -v    # 11.x
```

不需要 Python，不需要数据库，也不需要 Docker——TaskHub 用内存数据结构模拟数据库，把注意力留给 HTTP 层。

## 2.2 创建项目与安装依赖

```bash
mkdir taskhub && cd taskhub
npm init -y
npm pkg set type=module
```

`"type": "module"` 让 Node 把 `.js` 文件当作 ES Module 处理，这样就可以用 `import`/`export` 和顶层 `await`。TypeBox 1.x 只发布 ESM 版本，所以这一步是必需的。

安装运行时依赖：

```bash
npm i fastify@^5.12.7 fastify-plugin@^6.0.1 \
  typebox@^1.4.2 @fastify/type-provider-typebox@^6.3.0 \
  @fastify/swagger@^9.9.2 @fastify/swagger-ui@^6.1.2 @scalar/fastify-api-reference@^1.75.1 \
  @fastify/rate-limit@^11.2.1
```

安装开发依赖：

```bash
npm i -D typescript@^7.0.2 tsx@^4.23.15 vitest@^5.0.5 @types/node@^24 pino-pretty@^13.2.0
```

| 包                                                      | 用途                                               | 首次出现 |
| ------------------------------------------------------- | -------------------------------------------------- | -------- |
| `fastify`                                               | HTTP 框架本体，内置 Ajv、fast-json-stringify、Pino | 本章     |
| `fastify-plugin`                                        | 让插件“不封装”，把能力共享给父级作用域             | 第 3 章  |
| `typebox` / `@fastify/type-provider-typebox`            | 用 TS 写 schema 并推断类型                         | 第 6 章  |
| `@fastify/rate-limit`                                   | 限流                                               | 第 9 章  |
| `@fastify/swagger`                                      | 生成 OpenAPI                                       | 第 11 章 |
| `@scalar/fastify-api-reference` / `@fastify/swagger-ui` | 文档页面，二选一（配套工程两种都演示）             | 第 12 章 |
| `tsx`                                                   | 直接运行 `.ts` 文件，开发时用                      | 本章     |
| `vitest`                                                | 测试框架                                           | 本章     |
| `pino-pretty`                                           | 开发时把 JSON 日志格式化成易读文本（只用于开发）   | 第 13 章 |

> 版本说明：npm 上 `typebox`（无作用域）是 TypeBox 1.x，旧的 `@sinclair/typebox` 是 0.x 长期支持线。`@fastify/type-provider-typebox@6` 依赖的是 `typebox@1`。不要把两者混装，也不要照着 0.x 时代的博客写 `import { Type } from '@sinclair/typebox'`。TypeBox 1.x 面向 TypeScript 6.0 及以上，本书使用 TypeScript 7。

## 2.3 TypeScript 配置

创建 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

几个和前端项目不同的地方，逐一解释：

- **`module` / `moduleResolution: NodeNext`**：我们写的是要在 Node 上直接运行的代码，不经过 Vite 之类的打包器。NodeNext 要求相对导入**写出 `.js` 扩展名**，例如 `import { buildApp } from './app.js'`——即使源文件是 `app.ts`。这是因为编译后真正存在的是 `app.js`，Node 的 ESM 解析不会帮你补扩展名。刚开始会觉得别扭，习惯就好。
- **`types: ["node"]`**：从 TypeScript 6 开始，`types` 默认不再自动包含所有 `@types/*`，需要显式列出。
- **`verbatimModuleSyntax`**：只用于类型的导入必须写成 `import type`。这样编译器删除类型导入时不会产生歧义。
- **`noEmit`**：日常只做类型检查；真正需要产出 JS 时，用单独的 `tsconfig.build.json`（2.10 节）。

## 2.4 第一个服务：十行代码

创建 `src/server.ts`：

```ts
import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/healthz", async () => {
  return { status: "ok" };
});

await app.listen({ host: "127.0.0.1", port: 3000 });
```

运行：

```bash
npx tsx src/server.ts
```

你会看到一行 JSON 日志：

```json
{
  "level": 30,
  "time": 1792679174546,
  "pid": 6055,
  "hostname": "...",
  "msg": "Server listening at http://127.0.0.1:3000"
}
```

另开一个终端：

```bash
curl -i http://127.0.0.1:3000/healthz
```

```text
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
content-length: 15

{"status":"ok"}
```

服务端窗口里会多出两行日志：`incoming request` 和 `request completed`，后者带着 `responseTime`。这是 Fastify 开启 logger 后**自动**记录的请求日志，每条都带一个 `reqId`（默认是 `req-1`、`req-2` 这样的递增值）。第 13 章会把它们改造成适合生产的样子。

注意 handler 只是 `return` 了一个普通对象，Fastify 自动把它序列化成 JSON，并设置了 `content-type`。

## 2.5 Fastify 实例是什么

`Fastify(options)` 返回的 `app` 就是 **Fastify 实例**。可以把它理解为四样东西的组合：

1. **HTTP 服务器**：`app.listen()` 时才真正监听端口，`app.server` 是底层的 Node `http.Server`。
2. **路由表**：`app.get()`、`app.post()`、`app.route()` 往里面添加路由。
3. **插件容器**：`app.register()` 加载插件，形成一棵“封装上下文”树（第 3 章）。
4. **配置与工具**：logger（`app.log`）、schema 编译器、错误处理器、装饰器等。

构造选项只能在创建时传入。本书后面会用到的有：

| 选项            | 作用                                       | 章节 |
| --------------- | ------------------------------------------ | ---- |
| `logger`        | 开启并配置 Pino 日志                       | 13   |
| `genReqId`      | 自定义请求 ID 生成方式                     | 10   |
| `logController` | 自定义请求日志行为（如请求 ID 的字段名）   | 13   |
| `bodyLimit`     | 请求体大小上限，默认 1 MiB                 | 5    |
| `trustProxy`    | 部署在反向代理后面时，信任 `X-Forwarded-*` | 9    |

## 2.6 路由：声明“哪个方法 + 哪个路径 → 哪个函数”

Fastify 提供两种写法，效果完全相同。

**简写形式**（本书主要使用）：

```ts
app.get(
  "/hello/:name",
  {
    /* 路由选项 */
  },
  async (request, reply) => {
    /* handler */
  },
);
```

**完整形式**：

```ts
app.route({
  method: "GET",
  url: "/hello/:name",
  schema: {
    /* ... */
  },
  handler: async (request, reply) => {
    /* ... */
  },
});
```

路由选项里可以写 `schema`（第 5 章）、路由级 hook（第 4 章）、`config`（自定义配置，第 9 章用它配限流）、`logLevel`（第 13 章）等。

### handler 的两种返回方式

```ts
// 方式一：async 函数 return 值（推荐）
app.get("/a", async () => {
  return { ok: true };
});

// 方式二：调用 reply.send，并 return reply
app.get("/b", async (request, reply) => {
  return reply.code(201).send({ ok: true });
});
```

两条规则：

1. **在 async handler 里，不要既 `return 值` 又 `reply.send()`**。二者都会尝试发送响应，结果是 `FST_ERR_REP_ALREADY_SENT` 之类的错误。
2. 需要设置状态码或响应头时，可以先调用 `reply.code()`/`reply.header()` 再 `return 值`，也可以链式调用后 `return reply.send(...)`。

### `function` 还是箭头函数？

Fastify 把实例绑定为 handler 的 `this`。用 `async function (request, reply) {}` 写时可以访问 `this.log`、`this.db`；用箭头函数则拿不到。本书在插件内部直接用闭包里的 `app` 变量，所以两种写法都可以——只要你清楚这一区别。

### 自动生成的 HEAD 路由

Fastify 默认会为每个 GET 路由生成一个同路径的 HEAD 路由（`exposeHeadRoutes` 默认开启）。用 `app.printRoutes()` 可以看到：

```text
└── /
    └── healthz (GET, HEAD)
```

## 2.7 `request` 与 `reply`：你会天天打交道的两个对象

在 `src/server.ts` 里再加一个路由，把常用属性都摸一遍：

```ts
app.get("/hello/:name", async (request, reply) => {
  const { name } = request.params as { name: string };
  const { lang } = request.query as { lang?: string };

  request.log.info({ name, lang }, "saying hello");
  reply.header("x-tutorial", "taskhub");

  return {
    greeting: lang === "zh" ? `你好，${name}` : `Hello, ${name}`,
    requestId: request.id,
    userAgent: request.headers["user-agent"] ?? null,
  };
});
```

```bash
curl -i 'http://127.0.0.1:3000/hello/Alice?lang=zh'
```

```text
HTTP/1.1 200 OK
x-tutorial: taskhub
content-type: application/json; charset=utf-8

{"greeting":"你好，Alice","requestId":"req-1","userAgent":"curl/8.7.1"}
```

常用属性速查：

| `request`                  | 含义                                         |
| -------------------------- | -------------------------------------------- |
| `request.params`           | 路径参数，如 `{ name: 'Alice' }`             |
| `request.query`            | 查询字符串解析后的对象，值默认都是**字符串** |
| `request.headers`          | 请求头，**键名全部是小写**                   |
| `request.body`             | 解析后的请求体（GET 一般为 `undefined`）     |
| `request.id`               | 本次请求的 ID                                |
| `request.log`              | 绑定了请求 ID 的子 logger                    |
| `request.ip`               | 客户端 IP（在代理后面需要 `trustProxy`）     |
| `request.routeOptions.url` | 匹配到的路由模板，如 `/hello/:name`          |

| `reply`                                              | 含义                         |
| ---------------------------------------------------- | ---------------------------- |
| `reply.code(201)` / `reply.status(201)`              | 设置状态码                   |
| `reply.header(name, value)` / `reply.headers({...})` | 设置响应头                   |
| `reply.send(payload)`                                | 发送响应                     |
| `reply.type('text/plain')`                           | 设置 content-type            |
| `reply.elapsedTime`                                  | 从收到请求到现在经过的毫秒数 |

注意代码里的两处 `as { name: string }`：此刻 Fastify 并不知道 `params` 和 `query` 长什么样，只能用类型断言“骗”过 TypeScript。**这正是本书要消灭的东西**——第 5 章用 JSON Schema 在运行时保证它们的形状，第 6 章用 TypeBox 让类型自动推断出来。

## 2.8 关于 `listen`

```ts
await app.listen({ host: "127.0.0.1", port: 3000 });
```

- `host: '127.0.0.1'` 只接受本机连接，适合本地开发。
- 在 Docker 等容器里运行时要用 `host: '0.0.0.0'`，否则容器外访问不到。
- 端口被占用时 `listen` 会抛错。生产代码应当捕获错误、记录日志并以非 0 退出码结束进程，让进程管理器知道启动失败。

## 2.9 把“组装应用”和“启动服务”拆开

如果所有东西都写在 `server.ts` 里，测试时就必须真的监听一个端口。Fastify 官方测试指南推荐的做法是：**一个文件负责构建应用（不监听），另一个文件负责启动**。

创建 `src/app.ts`：

```ts
import Fastify, { type FastifyServerOptions } from "fastify";

export async function buildApp(options: FastifyServerOptions = {}) {
  const app = Fastify(options);

  app.get("/healthz", async () => {
    return { status: "ok" };
  });

  app.get("/hello/:name", async (request, reply) => {
    const { name } = request.params as { name: string };
    const { lang } = request.query as { lang?: string };
    reply.header("x-tutorial", "taskhub");
    return {
      greeting: lang === "zh" ? `你好，${name}` : `Hello, ${name}`,
      requestId: request.id,
    };
  });

  return app;
}
```

把 `src/server.ts` 改成：

```ts
import { buildApp } from "./app.js";

const app = await buildApp({ logger: true });

try {
  await app.listen({ host: "127.0.0.1", port: 3000 });
} catch (error) {
  app.log.error({ err: error }, "failed to start");
  process.exit(1);
}
```

`buildApp` 是 `async` 的：后面我们会在里面 `await app.register(...)` 依次加载插件。

## 2.10 第一个测试：`app.inject`

`app.inject()` 会构造一个**假的** HTTP 请求，完整走一遍 Fastify 的路由、hook、校验、序列化，然后把响应交给你，**全程不打开任何端口**。它比启动真实服务器快得多，也不会有端口冲突。

创建 `vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

创建 `test/app.test.ts`：

```ts
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("第一个服务", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  afterEach(async () => {
    await app.close();
  });

  it("GET /healthz 返回 200", async () => {
    app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("读取路径参数、查询字符串，并设置响应头", async () => {
    app = await buildApp();
    const response = await app.inject({
      url: "/hello/Alice",
      query: { lang: "zh" },
    });

    expect(response.headers["x-tutorial"]).toBe("taskhub");
    expect(response.json().greeting).toBe("你好，Alice");
  });
});
```

几个要点：

- `inject` 会自动等待所有插件加载完毕（相当于先 `await app.ready()`）。
- `response.json()` 帮你解析 body；`response.body` 是原始字符串。
- 每个测试结束后 `app.close()`，触发 `onClose` 钩子释放资源（后面数据库插件会用到）。

> `/hello/:name` 路由和 `test/app.test.ts` 只用于本章练习。从第 3 章开始，`buildApp` 会改为接收 TaskHub 自己的选项对象并按顺序注册插件，这两个练习文件可以删掉；配套工程里也没有它们，最终的测试组织方式见第 14 章。

## 2.11 package.json 脚本与构建

```bash
npm pkg set scripts.dev="tsx watch src/server.ts"
npm pkg set scripts.build="tsc -p tsconfig.build.json"
npm pkg set scripts.start="node dist/server.js"
npm pkg set scripts.typecheck="tsc --noEmit"
npm pkg set scripts.test="vitest run"
```

创建 `tsconfig.build.json`，只编译 `src`，输出到 `dist`：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist",
    "sourceMap": true
  },
  "include": ["src"]
}
```

日常循环：

```bash
npm run dev        # 改代码自动重启
npm run typecheck  # 类型检查
npm test           # 跑测试
```

部署时：

```bash
npm run build && npm start
```

> 为什么开发用 `tsx`、生产用 `tsc` 编译？`tsx` 只是把类型擦掉直接运行，**不做类型检查**，启动快；生产环境运行编译好的 JS，不需要在服务器上带 TypeScript 工具链。类型检查交给 `npm run typecheck` 和 CI。

## 2.12 常见错误

| 现象                                                        | 原因                    | 解决                      |
| ----------------------------------------------------------- | ----------------------- | ------------------------- |
| `Cannot find module './app'`                                | NodeNext 要求写扩展名   | 写成 `'./app.js'`         |
| `SyntaxError: Cannot use import statement outside a module` | 忘了 `"type": "module"` | `npm pkg set type=module` |
| `ERR_REQUIRE_ESM` / typebox 导入失败                        | TypeBox 1.x 只支持 ESM  | 同上                      |
| 测试结束后进程挂着不退出                                    | 没有 `app.close()`      | 在 `afterEach` 中关闭     |
| 容器里服务起来了但访问不到                                  | `host` 是 `127.0.0.1`   | 容器内用 `0.0.0.0`        |

## 2.13 练习

1. 给 `/hello/:name` 加一个 `excited` 查询参数，为 `true` 时在问候语后加 `!`。用 `curl` 试 `?excited=true` 和 `?excited=yes`，观察 `request.query.excited` 的实际类型。
2. 写一个测试：请求不存在的路径 `/nope`，断言状态码与响应体。记下 Fastify 默认的 404 响应长什么样——第 9 章会把它统一成我们的格式。

**参考答案**

1. 两种情况下 `excited` 都是**字符串**（`'true'`、`'yes'`）。没有 schema 时 Fastify 不知道它应该是布尔值，`excited === true` 永远为假。第 5 章加上 schema 后，`'true'` 会被转换为 `true`，`'yes'` 会被拒绝。
2. 默认 404 响应体是 `{"message":"Route GET:/nope not found","error":"Not Found","statusCode":404}`。它把请求方法和路径回显了出来，结构也和其他错误不完全一样。

## 本章验收

- [ ] 能从空目录搭出 ESM + TypeScript + Fastify 项目，并解释 NodeNext 为什么要写 `.js` 扩展名。
- [ ] 能说出 Fastify 实例的四个角色。
- [ ] 能用简写和完整两种方式声明路由，知道 async handler 不能同时 return 值和 `reply.send`。
- [ ] 能从 `request` 读取 params/query/headers/body/id/log，用 `reply` 设置状态码与响应头。
- [ ] 能解释 `buildApp` 与 `server.ts` 分离的理由，并用 `app.inject` 写出测试。

官方阅读：[Getting Started](https://fastify.dev/docs/latest/Guides/Getting-Started/)、[Server](https://fastify.dev/docs/latest/Reference/Server/)、[Routes](https://fastify.dev/docs/latest/Reference/Routes/)、[Request](https://fastify.dev/docs/latest/Reference/Request/)、[Reply](https://fastify.dev/docs/latest/Reference/Reply/)、[Testing](https://fastify.dev/docs/latest/Guides/Testing/)。

下一章，[用插件给应用划出边界](./03-plugins-encapsulation-decorators.md)。
