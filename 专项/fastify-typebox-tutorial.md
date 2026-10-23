# 从 0 到 1 构建可靠的 Fastify HTTP API

**适用对象：** 会一点 JavaScript/TypeScript，希望第一次把一个 HTTP API 做得可维护、可测试、可上线的开发者。  
**贯穿示例：** 一个简单的 Tasks API。  
**技术组合：** Fastify 5、TypeBox、JSON Schema、`@fastify/swagger`、Scalar、Pino、`app.inject()`。  
**代码风格：** TypeScript + ESM；示例以当前 Fastify 5 与官方 TypeBox Type Provider 文档为基准。

---

## 开始之前：这套技术分别解决什么问题

假设你准备写一个创建任务的接口。客户端会发送 JSON，服务器要确认数据结构正确、判断任务标题是否重复、写入数据、返回结果、记录日志，并让前端工程师能在 API 文档中知道应该传什么、会得到什么。

只用一个路由也能把这些事情都塞进去，但项目很快就会出现几个问题：路由里重复写校验；TypeScript 类型和运行时规则不一致；某个数据库字段被意外返回给客户端；不同接口报错格式各不相同；插件偷偷影响别的路由；线上发生问题却找不到对应请求；API 文档又与代码脱节。

这套技术组合的价值，是把这些责任拆成可以组合、可以测试的层：

- **Fastify** 负责 HTTP 请求路由、插件装配、请求生命周期、hook、错误处理与日志基础设施。
- **JSON Schema** 描述 JSON 数据允许具有什么结构、字段、类型与约束。它不是业务逻辑，而是对数据形状的契约。
- **TypeBox** 用 TypeScript 代码构造 JSON Schema，同时从同一份 schema 推断静态类型。这样能减少“编译器以为可用、运行时却没校验”的双重定义。
- **Fastify Type Provider** 把 TypeBox schema 与路由处理器的 TypeScript 类型连接起来，让 `request.body`、`request.query` 和 `request.params` 可以自动推断。
- **`@fastify/swagger`** 从路由 schema 生成 OpenAPI 描述文件。OpenAPI 是 API 的机器可读契约，不是 UI。
- **Scalar** 把 OpenAPI 文档呈现为可浏览的 API reference。Swagger UI 也是同类前端，选一个即可。
- **Pino** 提供结构化日志；Fastify 会为请求提供带请求上下文的 logger。
- **`app.inject()`** 在不启动真实 TCP 端口的前提下模拟 HTTP 请求，适合测试路由装配、校验、响应与错误契约。

整条数据链路可以理解成：

```text
客户端请求
   │
   ▼
Fastify 路由匹配与 hook
   │
   ▼
TypeBox schema ──► JSON Schema 运行时校验
   │                       │
   │                       └──不通过──► 统一错误响应
   ▼
preHandler / 认证授权 / 业务服务
   │
   ▼
Repository / 数据库 / 外部服务
   │
   ▼
响应对象 ──► response schema 序列化边界
   │
   ├──► Pino 结构化日志 + request ID
   └──► @fastify/swagger 生成 OpenAPI ──► Scalar API reference
```

请记住一个贯穿全篇的原则：**schema 描述可验证的数据契约，服务层执行业务规则，插件负责边界，错误处理器负责稳定对外表达，日志负责内部诊断，OpenAPI 负责把同一份契约交给调用方。**

## 目录

- 开始之前：这套技术分别解决什么问题
- 第 0 章：创建项目，并理解一次请求发生了什么
- 第 1 章：认识 Fastify 的插件、作用域与装配顺序
- 第 2 章：跟着一次请求走完 Fastify 生命周期
- 第 3 章：JSON Schema 与 TypeBox：把类型变成运行时契约
- 第 4 章：response schema 是输出边界，不只是文档
- 第 5 章：把业务逻辑从路由中移出，并约定分页和排序
- 第 6 章：设计统一错误模型
- 第 7 章：用 Pino 做结构化日志，而不是 `console.log`
- 第 8 章：从 route schema 生成 OpenAPI，并发布 API Reference
- 第 9 章：用 `app.inject()` 写集成测试
- 第 10 章：启动项目、理解结果，并按顺序扩展
- 最终验收：你是否真正完成了“从 0 到 1”
- 官方资料与继续阅读

---

## 第 0 章：创建项目，并理解一次请求发生了什么

### 0.1 准备环境

请使用受支持的 Node.js LTS 版本。本文代码使用 ESM 和 TypeScript；Fastify 5、TypeBox 以及 Fastify Type Provider 的兼容版本需要搭配使用。当前官方 Type Provider 文档采用 `typebox` 这个包名，而较早文章中经常出现 `@sinclair/typebox`。阅读旧教程时不要把两套包名和版本混用。

新建目录并初始化：

```bash
mkdir fastify-typebox-learning-api
cd fastify-typebox-learning-api
npm init -y
npm install fastify typebox @fastify/type-provider-typebox @fastify/swagger @scalar/fastify-api-reference @fastify/rate-limit
npm install -D typescript tsx @types/node
```

`@fastify/rate-limit` 在后文用于演示统一限流错误。若你的项目暂时不需要限流，可以先不装它；其他部分不依赖该插件。

将 `package.json` 中的 `type` 设置为 `module`，并增加脚本：

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/src/server.js",
    "test": "tsx --test test/*.test.ts"
  }
}
```

创建基础 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
```

本文配套项目压缩包包含完整的 `package.json`、TypeScript 配置、所有源码与集成测试。建议先按本章理解项目，再打开代码包跟着执行。

### 0.2 建立最小 Fastify 实例

Fastify 实例是应用的装配中心。它注册插件与路由，配置 logger、错误处理器和 schema，并最终监听网络端口。先不要急着添加数据库或文档，理解最小闭环：

```ts
// src/server.ts 的最小概念示例
import Fastify from 'fastify'

const app = Fastify({ logger: true })
app.get('/health', async () => ({ status: 'ok' }))

try {
  await app.listen({ port: 3000, host: '127.0.0.1' })
} catch (error) {
  app.log.error({ err: error }, 'server failed to start')
  process.exitCode = 1
}
```

这段代码创建实例、注册路由并启动服务器。`app.get()` 是快捷写法；当路由有 schema、hook 或复杂选项时，`app.route()` 或 `app.get(path, options, handler)` 会更清楚。启动之后访问 `http://127.0.0.1:3000/health`，你会收到 `{"status":"ok"}`。

### 0.3 `request`、`reply` 与 handler

Fastify 的 handler 通常接收 `(request, reply)`：

- `request` 描述这次传入请求，例如 `request.params`、`request.query`、`request.headers`、`request.body`、`request.id`、`request.log`。
- `reply` 用来控制响应，例如设置状态码、header、cookie，然后发送响应。
- async handler 可以直接 `return` 一个值，Fastify 会把它作为响应主体；需要显式控制状态码时，用 `reply.code(201).send(data)`。

初学时尽量选一种响应风格，不要在同一个 handler 里一会儿 `return data`，一会儿调用 `reply.send()`，最后又继续执行。没有特殊控制时 return 数据；需要指定响应状态或 header 时显式操作 reply。

```ts
app.post('/tasks', async (request, reply) => {
  const created = { id: 'task-1', title: 'Learn Fastify' }
  return reply.code(201).send(created)
})
```

在正式项目中，`created` 不应是 handler 临时拼凑出来的任意对象，而应该从经过输入校验、业务服务处理之后的数据得到，并使用 response schema 定义它允许输出的字段。

## 第 1 章：认识 Fastify 的插件、作用域与装配顺序

### 1.1 一切从 `register()` 开始

Fastify 的主要扩展单元是 plugin。一个 plugin 可以注册路由、添加 hook、注册 schema、添加 decorator，也可以注册其他 plugin。`register()` 接受 plugin 以及该 plugin 的配置选项：

```ts
app.register(async function healthPlugin(instance) {
  instance.get('/health', async () => ({ status: 'ok' }))
})
```

这段代码不仅仅是把一段函数执行掉。Fastify 会为普通注册的 plugin 建立封装上下文（encapsulation context）。上下文决定哪些 decorator、hook、schema 和路由对哪些地方可见。

把应用想象成一棵树：根实例是父节点，`register()` 创建子上下文，子上下文可以访问父上下文提供的能力；父上下文不会自动看到子上下文里新加的能力，兄弟 plugin 也不会自动互相看到对方私有的能力。这就是插件边界能成立的原因。

```ts
app.decorate('appName', 'learning-api')

app.register(async function tasksPlugin(tasks) {
  // tasks 可以访问父上下文中的 appName。
  tasks.get('/tasks', async function () {
    return { appName: tasks.appName }
  })
})

app.register(async function adminPlugin(admin) {
  // admin 也可以访问父上下文的 appName。
  // 但 tasksPlugin 内部新建的私有 decorator 不会自动暴露给这里。
})
```

对业务代码而言，这意味着你可以把一个模块的路由、hook 和仅模块需要的工具封装起来，而不会意外改变全应用的行为。

### 1.2 按职责划分项目

```text
src/
  app.ts                     # 装配中心：创建 Fastify、插件、全局策略
  server.ts                  # 只负责启动和关闭 HTTP 服务
  errors/
    app-error.ts             # 可对外暴露的业务错误类型
  modules/
    tasks/
      schemas.ts             # tasks 模块的请求和响应 schema
      repository.ts          # 数据访问接口与示例实现
      service.ts             # 业务规则
      routes.ts              # HTTP 路由、schema、handler
```

这不是唯一正确的目录结构，也不是要求每个小项目都拆成十几个文件。重要的是按变化原因分层：HTTP 契约与 handler 变化时，不应被数据库细节拖累；数据库换实现时，路由不应该知道换到了哪种存储；文档应该从路由契约生成，而不是在另一个文件里手写一份平行定义。

配套项目用内存 Repository 是为了让示例能不依赖数据库运行。它的目标是演示依赖边界，而不是建议生产环境把业务数据存放在进程内存里。真实项目可以把 Repository 替换成 PostgreSQL、MySQL 或其他持久化实现。

### 1.3 Decorator 是什么

Decorator 是把一个能力挂到 Fastify 实例、request 或 reply 上，以便在正确作用域内复用。它不是 TypeScript 装饰器语法，而是 Fastify 提供的 `decorate()`、`decorateRequest()`、`decorateReply()` API。

实例级 decorator 适合服务、配置或者连接池：

```ts
app.decorate('taskService', taskService)
```

request decorator 适合每个请求独有的状态，例如验证后的用户身份：

```ts
app.decorateRequest('user', null)
app.addHook('onRequest', async (request) => {
  // 这里只示意赋值位置。生产环境必须验证身份，不能信任客户端自报的 userId。
  request.user = null
})
```

TypeScript 不会仅因为运行时调用了 `decorate()` 就自动知道属性的类型。正式项目通常还要使用 TypeScript module augmentation 声明属性类型，例如扩展 `FastifyInstance` 或 `FastifyRequest`；声明应与 decorator 的注册位置保持一致。

不要把共享可变对象当作 request decorator 的默认值：多个请求可能共享同一个对象引用。通常先用 `null` 或 `undefined` 占位，再为当前请求设置自己的对象。

配套代码用 plugin options 将 `TaskService` 显式传入 `taskRoutes`，不需要为这个小例子全局扩展 Fastify 类型。这也是依赖注入的一种简单形式，依赖来源一目了然。

### 1.4 `fastify-plugin` 不应该包住一切

生态中的 `fastify-plugin` 可以改变普通 plugin 的封装行为，让某些 decorator 或能力暴露到父上下文。它在实现应用级工具插件时有用，但也会弱化原本的隔离边界。

初学建议先用普通 `register()` 形成模块边界；当确实需要让一个插件提供的 decorator 被父上下文或其他同级路由使用时，再查清楚封装要求，谨慎使用 `fastify-plugin`。不要为了“能访问到”而给所有插件都包它，否则作用域设计会变得不清楚。

### 1.5 注册顺序是程序语义的一部分

有些插件必须先于路由装配。例如 `@fastify/swagger` 的动态模式需要在路由注册前挂接路由发现逻辑；如果先注册业务路由，再注册 Swagger 插件，已经注册的路由可能不会进入生成的 OpenAPI 文档。

本项目采用以下顺序：先创建根实例并启用 logger 与全局 hook；再设置错误处理；注册 `@fastify/swagger`；注册限流等应用级插件；注册业务路由 plugin；最后注册 Scalar API reference 前端。实际顺序应服从插件自身文档，并且要用 `app.ready()` 或 `app.inject()` 测试最终装配后的行为，而不是假定调用了 `register()` 就代表插件已经准备完毕。

## 第 2 章：跟着一次请求走完 Fastify 生命周期

### 2.1 生命周期全景

```text
收到请求
  ↓
路由匹配 / 创建请求 logger
  ↓
onRequest
  ↓
preParsing
  ↓
解析请求体（例如 JSON）
  ↓
preValidation
  ↓
JSON Schema 校验
  ↓
preHandler
  ↓
handler（你的路由逻辑）
  ↓
preSerialization（对可序列化对象）
  ↓
onSend
  ↓
发送响应
  ↓
onResponse
```

错误可能在多个阶段出现。比如 JSON 语法解析失败会在调用 handler 之前发生；schema 校验失败也会在 `preHandler` 之前结束请求；handler 或业务服务抛错则进入错误处理流程。生命周期中某一步如果以错误响应结束，请求通常不会继续走后续正常阶段。

### 2.2 `onRequest`：最早执行的请求 hook

`onRequest` 适合做不依赖 body 解析结果的请求级工作，比如设置响应 header、添加跟踪信息、在解析大请求体前做初步拒绝、记录入口指标。此时不要假设 `request.body` 已经可用。

配套项目在 `onRequest` 中返回一个 `x-request-id` 响应头：

```ts
app.addHook('onRequest', async (request, reply) => {
  reply.header('x-request-id', request.id)
})
```

request ID 对排障非常有用：响应里有它，日志里也能按它查到对应的请求。生产环境中，如果要采纳来自反向代理的请求 ID，应限定可信上游、校验长度与字符集；不要无条件信任任意客户端提交的同名 header。配套项目直接由服务器生成 UUID，避免客户端随意伪造追踪标识。

### 2.3 `preValidation`：在 schema 校验之前

`preValidation` 位于请求数据解析之后、校验之前。只有当你需要在 schema 校验前对已解析的数据做有限转换，才考虑在这里处理，例如某些旧客户端传来了历史字段，需要在迁移期转换为新字段。

```ts
app.addHook('preValidation', async (request) => {
  // 只在转换规则明确且有测试时修改已经解析的数据。
  // request.body 的实际类型取决于当前路由的 schema。
})
```

不要把复杂业务逻辑或数据库查询放在这里。schema 校验的意义是尽早拒绝形状不合法的数据；数据库访问放在验证通过之后更容易理解，也能避免用昂贵的外部查询处理大量无效请求。Fastify 官方文档特别提醒不要把访问数据库的异步逻辑混进初始 schema 验证器。

### 2.4 `preHandler`：请求已经通过 schema 校验

`preHandler` 在请求校验之后、handler 之前执行，适合需要访问已验证的 `params`、`querystring` 或 `body` 的工作，例如权限检查、资源前置检查、为 handler 准备本次请求上下文。

- **认证（authentication）**：确认请求者是谁，例如验证 session 或 bearer token。
- **授权（authorization）**：确认已识别的请求者能否执行当前操作。

认证与授权常在这里实现，或根据安全要求选择更早的 `onRequest`。认证/授权需要真实、可靠的身份基础设施，下面只是示意业务边界：

```ts
async function requireAuthenticated(request: { user?: unknown }) {
  if (!request.user) {
    throw new AppError(401, 'UNAUTHENTICATED', '请先登录')
  }
}

async function requireAdmin(user: { role: string }) {
  if (user.role !== 'admin') {
    throw new AppError(403, 'FORBIDDEN', '没有执行此操作的权限')
  }
}
```

`401` 表示请求缺少有效认证；`403` 表示已识别请求者但不允许操作。不要反过来使用，也不要在错误响应里透露 token 为什么无效、用户是否存在等不必要细节。将 hook 注册在模块 plugin 内，可以让它只对该模块的路由生效。

### 2.5 `preSerialization`、`onSend`、`onResponse` 和 `onError`

- `preSerialization` 在返回的对象进入响应序列化之前运行，适合在确有统一包装需求时调整对象。它不是每种响应主体都会经过的钩子，例如字符串、Buffer 或流要特别留意。
- `onSend` 在响应发送之前接触序列化后的 payload，可以做受控的响应转换。不要在这里偷偷修改 API 语义，也要评估压缩、流式响应等情况。
- `onResponse` 在响应已经发送之后运行，适合记录耗时、状态码和指标；此时再改响应内容已经来不及。
- `onError` 在请求处理过程发生错误时运行，可用于观察错误，但统一错误 JSON 的形状仍应由错误处理策略负责。

配套项目的 `onResponse` 记录 method、路由模板与状态码：

```ts
app.addHook('onResponse', async (request, reply) => {
  request.log.info({
    method: request.method,
    route: request.routeOptions.url,
    statusCode: reply.statusCode
  }, 'request completed')
})
```

这个日志不记录 body、token 或完整 query string。通常路由模板 `/v1/tasks/:id` 比实际 URL 更适合作为日志字段，因为它不会让高基数 ID 把日志系统的分组维度撑爆。

### 2.6 使用 hook 的三个规则

第一，Fastify 的异步 hook 可以使用 `async` 返回 Promise，也可以使用 callback 的 `done` 形式；不要在同一个 hook 中混合两套控制流。第二，hook 越靠前，可用的请求数据越少；不要在 `onRequest` 读取尚未解析的 body。第三，hook 也受 encapsulation 影响，检查它到底是应用级、模块级还是单条路由级，避免把某个模块的认证或日志策略扩散到无关路由。

## 第 3 章：JSON Schema 与 TypeBox：把类型变成运行时契约

### 3.1 TypeScript 类型本身不会验证 HTTP 输入

下面这个 TypeScript 类型只对代码编译器有意义：

```ts
type CreateTaskInput = {
  title: string
  description?: string
}
```

请求从网络到达服务器时，是不可信的字节。客户端可以发送 `{ "title": 123 }`，也可以发送缺失的 `title`，甚至附加 `isAdmin: true`。TypeScript 类型擦除后不会自动对 JSON 做运行时检查。因此还需要一份可在运行时使用的 schema。

JSON Schema 用 JSON 风格描述允许的数据结构。一个普通对象 schema 的常见要素包括：

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string", "minLength": 1, "maxLength": 120 },
    "description": { "type": "string", "maxLength": 1000 }
  },
  "required": ["title"],
  "additionalProperties": false
}
```

`properties` 描述字段，`required` 列出必填字段，`additionalProperties: false` 表示不允许 schema 没有声明的额外字段。仅仅把字段写在 `properties` 中，并不代表它自动必填；必填与否由 `required` 决定。TypeBox 会根据 `Type.Optional()` 自动区分可选字段和必填字段。

在 Fastify 中，常用的输入位置是 `params`、`querystring`、`headers` 与 `body`。它们解决不同问题：路径参数识别资源，查询参数控制筛选/分页，headers 携带协议元数据或认证信息，body 携带需要创建或修改的数据。

### 3.2 TypeBox：同一份定义，同时生成 schema 与静态类型

本文使用当前官方 Fastify Type Provider 示例中的 `typebox` 包。最核心的模式是：

```ts
import Type from 'typebox'

const CreateTaskBodySchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 120 }),
  description: Type.Optional(Type.String({ maxLength: 1000 }))
}, { additionalProperties: false })

type CreateTaskBody = Type.Static<typeof CreateTaskBodySchema>
```

`CreateTaskBodySchema` 是运行时对象，可交给 Fastify/Ajv 校验；`Type.Static` 则根据同一个 schema 计算 TypeScript 类型。`CreateTaskBody` 会有必填的 `title: string` 和可选的 `description?: string`。

这种模式减少了两处定义之间的漂移，但也要理解边界：Type Provider 能推断编译期类型，不代表 TypeScript 类型本身在运行时执行。真正的请求校验仍由 Fastify 的 validator 根据 schema 运行。服务层从数据库拿回的数据、定时任务传来的对象、内部函数调用也不会因为引用了 TypeBox 类型就自动通过运行时校验。

### 3.3 本教程会用到的 TypeBox 组合

**`Type.Object()`** 创建对象 schema。第二个参数可以带 `additionalProperties: false`、描述等 JSON Schema 元信息。

```ts
const TaskSchema = Type.Object({
  id: Type.String(),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  status: Type.Union([Type.Literal('open'), Type.Literal('done')]),
  createdAt: Type.String({ format: 'date-time' })
}, { additionalProperties: false })
```

**`Type.Optional()`** 表示字段允许缺席：

```ts
const ProfileSchema = Type.Object({
  displayName: Type.String(),
  bio: Type.Optional(Type.String())
})
```

`bio` 可以不出现，但若出现仍必须是字符串。它不等于“允许 null”。如果业务契约需要明确允许 `null`，应把 `Type.Null()` 纳入 union：`Type.Union([Type.String(), Type.Null()])`。`undefined`、缺席和 `null` 是三个不同概念，API 契约应明确选择。

**`Type.Union()` 与 `Type.Literal()`** 表示封闭的选项集合：

```ts
const StatusSchema = Type.Union([
  Type.Literal('open'),
  Type.Literal('done')
])
```

于是 `status: 'deleted'` 会被拒绝。类似地，分页排序字段最好用 union 列出允许值，而不是允许客户端传任意字符串。

**数组、嵌套对象与可复用字段**可以直接组合：

```ts
const UserSchema = Type.Object({
  name: Type.String(),
  contacts: Type.Array(Type.Object({
    kind: Type.Union([Type.Literal('email'), Type.Literal('phone')]),
    value: Type.String()
  }))
})
```

**引用 `$id`、`Type.Ref()` 和 Fastify `addSchema()`** 可用于跨路由复用 schema。示意：

```ts
import Type from 'typebox'
import Fastify from 'fastify'

const AddressSchema = Type.Object({
  city: Type.String(),
  street: Type.String()
}, {
  $id: 'https://example.com/schemas/address.json',
  additionalProperties: false
})

const UserSchema = Type.Object({
  name: Type.String(),
  address: Type.Ref(AddressSchema)
})

const app = Fastify()
app.addSchema(AddressSchema)
app.post('/users', {
  schema: { body: UserSchema }
}, async () => ({ accepted: true }))
```

引用 schema 时，需要保证目标 schema 已在当前可见的封装范围内注册，且 `$id` 唯一、引用地址能正确解析。`addSchema()` 也受到 Fastify 的 encapsulation 影响：在一个子 plugin 注册的共享 schema，不会自动成为根实例或其他兄弟 plugin 的共享 schema。小项目只需复用 TypeBox 常量也可以；当多个模块都要通过 `$ref` 共享复杂 schema 时，再有计划地注册公共 schema。

### 3.4 给所有输入位置加 schema

路径参数：

```ts
const TaskParamsSchema = Type.Object({
  id: Type.String({ minLength: 1 })
}, { additionalProperties: false })
```

查询字符串：

```ts
const ListTasksQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  sortBy: Type.Optional(Type.Union([
    Type.Literal('createdAt'),
    Type.Literal('title')
  ])),
  sortOrder: Type.Optional(Type.Union([
    Type.Literal('asc'),
    Type.Literal('desc')
  ]))
}, { additionalProperties: false })
```

查询字符串在 HTTP 上通常是文本，例如 `?limit=20`。Fastify 默认的 Ajv 配置会对部分输入进行类型强制转换，所以这里的 `limit` 可以被转换为整数。配套示例显式关闭 `removeAdditional`，这样未声明的字段会按 `additionalProperties: false` 被拒绝，而不是被悄悄删除。不要随手关闭所有 coercion 后，又期待原始字符串自动成为数字；验证行为是 validator 配置与 schema 共同决定的，应该用真实请求测试。

header schema：

```ts
const RequestHeadersSchema = Type.Object({
  'x-client-version': Type.Optional(Type.String({ maxLength: 40 }))
}, { additionalProperties: true })
```

headers 与 body 有一个区别：HTTP headers 天生可能包含很多标准字段，且 Fastify 的 `request.headers` 是原始请求 headers 的视图，校验器不会凭空给你一份经过净化的完整 header 对象。若需要一个严格 allow-list 的业务输入，应把需要使用的已校验字段单独提取出来，别把原始 `request.headers` 当作已清洗后的权威对象。

body schema：

```ts
const CreateTaskBodySchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 120 }),
  description: Type.Optional(Type.String({ maxLength: 1000 }))
}, { additionalProperties: false })
```

`additionalProperties: false` 是契约选择，不是所有 API 都必须采取的唯一策略；但创建、更新、权限相关输入通常应该谨慎拒绝意外字段，避免调用方误以为某个字段生效，也避免未来字段扩展引出歧义。

### 3.5 让 Type Provider 推断 handler 输入

创建 Fastify 实例时使用：

```ts
import Fastify from 'fastify'
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'

const app = Fastify().withTypeProvider<TypeBoxTypeProvider>()
```

路由上声明 schema 后，handler 能从 schema 推断输入：

```ts
app.post('/tasks', {
  schema: { body: CreateTaskBodySchema }
}, async (request, reply) => {
  const title = request.body.title // string
  const description = request.body.description // string | undefined
  return reply.code(201).send({ title, description })
})
```

注意 `.withTypeProvider<TypeBoxTypeProvider>()` 应该在创建实例后使用，并把其返回的实例赋给变量。以下常见写法不会把 provider 类型“回写”到旧变量：

```ts
const app = Fastify()
app.withTypeProvider<TypeBoxTypeProvider>() // 返回值没有接住
```

跨文件使用 plugin 时，可以使用 `@fastify/type-provider-typebox` 提供的 `FastifyPluginAsyncTypebox` 等类型，让插件内的路由仍然能推断 schema，不必把整个应用强制写成一个文件。

### 3.6 区分结构校验与业务规则

这一区分会直接影响安全性与可维护性：

| 要回答的问题 | 放在哪里 | 例子 |
|---|---|---|
| 字段是不是字符串？是否缺少必填字段？ | JSON Schema 校验 | `title` 必须是 1 到 120 个字符 |
| `limit` 是否在 1 到 100 之间？ | JSON Schema 校验 | `minimum` / `maximum` |
| 传入的排序字段是否允许？ | JSON Schema 校验 | `sortBy` 只能是 `title` 或 `createdAt` |
| 标题是否已经被某个任务占用？ | Service + Repository/数据库 | 查询已有记录、处理唯一性冲突 |
| 当前用户能否编辑任务？ | 授权逻辑与业务层 | 校验用户权限或租户归属 |
| 调用外部支付系统是否成功？ | Service / 领域逻辑 | 外部 API 调用与补偿策略 |

JSON Schema 应能快速判定数据的结构。不要把访问数据库的异步查询写成初始 validator 的一部分；这会模糊数据校验和业务规则的界限，也可能让大量廉价的无效请求触发昂贵查询。

### 3.7 `$id`、`$ref` 与版本边界

`$id` 用来识别一个 schema，`$ref` 用来引用已有 schema。它们让大型 API 不必在每条路由重复定义同样的对象。实践里常见的误区是：

1. 在一个插件里 `addSchema()`，却希望其他独立插件能自动查到它。
2. 给多个 schema 使用相同 `$id`，导致引用指向含糊或重复注册报错。
3. 假设 OpenAPI 的 `components.schemas` 与 Fastify 内部 schema registry 完全是同一个机制。它们相关，但用途和注册时机不同。
4. 把 JSON Schema 任意 draft 的关键词都塞到默认 validator 中。Fastify 的官方示例主要以 Draft 7 为基础；如果要使用某个新 draft 的专有行为，应确认 validator 与生成器都支持，不要只因为 OpenAPI 声明为 3.1 就假定所有运行时行为都会改变。

做 schema 共享前先问自己：多个路由是否真的要引用同一个运行时 schema？如果只是 TypeBox 常量复用，直接 import 常量往往更直观；如果要 `$ref`、跨模块描述复用和文档组件化，再定义稳定的 `$id` 并在正确作用域内注册。

## 第 4 章：response schema 是输出边界，不只是文档

### 4.1 为什么必须约束输出

假设数据库记录长这样：

```ts
const databaseRow = {
  id: 'task-1',
  title: 'Read the docs',
  status: 'open',
  createdAt: '2026-01-01T10:00:00.000Z',
  ownerId: 'internal-user-42',
  passwordResetToken: 'secret-value'
}
```

如果 handler 直接把 `databaseRow` 返回给客户端，新增一个内部字段就可能意外成为 API 的公开字段。这类问题并不罕见，因为 TypeScript 类型不会在运行时自动删除额外属性。

为路由声明 response schema：

```ts
app.get('/tasks/:id', {
  schema: {
    params: TaskParamsSchema,
    response: {
      200: TaskSchema,
      404: ErrorResponseSchema
    }
  }
}, async (request) => service.get(request.params.id))
```

Fastify 会利用响应 schema 编译序列化函数；响应按照声明的公开结构序列化，未声明的内部字段不会被正常输出。与此同时，OpenAPI 生成器也能使用它描述成功响应。这让同一份定义同时承担运行时输出序列化与文档契约的角色。

但是不要把它理解成“任何错误返回都一定会自动被 schema 修复”。response schema 主要控制序列化形状；它不替代业务逻辑，也不保证 handler 一定构造了语义正确的数据。对于每条路由，都应声明实际使用的状态码和对应响应形状，并用集成测试验证。

### 4.2 成功与错误响应都应显式定义

项目中统一的错误 envelope 如下：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数不符合要求",
    "requestId": "由服务器生成的请求 ID",
    "details": [
      { "field": "title", "reason": "must NOT have fewer than 1 characters" }
    ]
  }
}
```

`details` 可以省略。它只包含定位错误所需的字段名和安全描述，不回显被拒绝的原始值，也不暴露内部 SQL、token 或 stack trace。

成功响应与错误响应应该有明确边界，不要为了所有响应都能返回 200，就在 body 里塞一个 `success: false`。HTTP 状态码、稳定错误 code 和安全可读的 message 各司其职：状态码反映 HTTP 层面的结果；code 是稳定的机器接口；message 用于安全地帮助开发者理解问题，适合本地化但不应该被客户端程序拿来分支判断。

## 第 5 章：把业务逻辑从路由中移出，并约定分页和排序

### 5.1 Handler 只做 HTTP 适配

好维护的路由 handler 通常很薄：读取已经通过 schema 校验的参数；调用 service；用 HTTP 状态码表达结果；返回公开 DTO，由 response schema 控制输出形状。

标题重复、资源不存在、状态转移是否合法等业务规则应该留在 service 层。数据存储、查询与持久化细节应该封装在 repository。这样路由测试可以关注 HTTP 契约，业务规则可以单独测试，数据库可以被替换。

本项目的 `TaskService.create()` 展示两个业务规则：空白标题虽然是字符串，但 `"   "` 仍不应当被接受；标题重复时返回 `409 Conflict`。第一条涉及规范化后的语义规则，第二条要查询已有记录，所以都不适合仅靠 JSON Schema 完成。

真实数据库中，唯一性不能只靠“先查一遍有没有，再插入”。两个并发请求可能同时查到不存在，然后都插入成功。生产实现必须在数据库层建立唯一约束，并将唯一约束冲突转换为稳定的 `TASK_TITLE_CONFLICT` 错误。示例中的 in-memory adapter 只是为了便于学习。

### 5.2 先把分页契约说清楚

配套 API 使用简单的 offset 分页：

```http
GET /v1/tasks?limit=20&offset=0
```

响应包括：

```json
{
  "items": [],
  "total": 0,
  "limit": 20,
  "offset": 0
}
```

契约约定：

- `limit` 默认 20，最小 1，最大 100。
- `offset` 默认 0，必须是非负整数。
- `total` 表示匹配筛选条件的总条数，而不是当前页数组长度。
- `items` 只包含当前页的数据。
- 排序参数只允许有限字段和方向，例如 `sortBy=createdAt|title`、`sortOrder=asc|desc`。

不要直接把用户传来的 `sortBy` 拼进 SQL。即使做了 schema 校验，也应该在 Repository 中将每个允许值显式映射到安全的数据库列名。排序必须有稳定的平局规则，否则相同 `createdAt` 的记录顺序可能漂移。配套的内存实现会在主排序相同时用 ID 作为第二排序条件。

offset 分页易学、适合小表和管理接口；在高频新增且数据量很大的列表中，页码后移时可能出现重复或遗漏，且深 offset 性能不佳。那时可改为 cursor/keyset 分页，并把 cursor 的格式、有效期、排序方向和错误行为一起写进契约。

### 5.3 版本路径与破坏性变更

示例使用 `/v1/tasks`，OpenAPI 的 `info.version` 设为 `1.0.0`。两者用途不同：路径上的 `v1` 是客户端选择 API 代际的地址约定；`info.version` 是这份 API 描述的版本。不要认为修改 `info.version` 就自动完成了路径版本管理。

一般来说，删除字段、改变字段意义、把可选字段变成必填、改变成功状态码、改变错误 code、收紧输入约束，都可能破坏现有客户端。新增可选字段通常更容易兼容，但依赖严格反序列化的客户端仍可能受影响。API 变更应该配合版本策略、弃用时间表、契约测试与发布说明，而不是仅修改 schema 后直接部署。

## 第 6 章：设计统一错误模型

### 6.1 为什么不要把原始异常直接返回给客户端

原始异常可能包含数据库表名、内部路径、SQL 片段、外部服务响应、调试信息甚至凭证。将 `error.message` 直接返回会把内部实现细节变成公共接口。相反，应把“内部诊断”与“对外表达”分成两个通道：内部日志保留必要上下文；客户端只收到稳定 code、安全 message、request ID 和必要的字段定位信息。

本文采用两类错误：

- **`AppError`**：明确知道可以安全暴露的业务错误，比如任务不存在、标题冲突、未认证或权限不足。
- **未知错误**：意外异常、编程 bug、数据库不可用等。它们统一映射为 `500 INTERNAL_ERROR`，真实异常对象写入服务端日志，不向客户端泄露 stack trace。

配套项目中 `AppError` 带有 `statusCode`、`code` 和 `publicMessage`。业务服务抛出它；全局 `setErrorHandler()` 负责把它转为固定 envelope。

### 6.2 推荐的状态码与稳定 code

| HTTP 状态码 | 推荐 code 示例 | 适用场景 | 对客户端的信息 |
|---|---|---|---|
| `400 Bad Request` | `VALIDATION_ERROR` | JSON 结构、必填字段、query/path 参数不符合 schema | 哪个字段不符合要求 |
| `401 Unauthorized` | `UNAUTHENTICATED` | 缺少或无效身份认证 | 需要认证；不要透露敏感验证细节 |
| `403 Forbidden` | `FORBIDDEN` | 身份已知但无权操作 | 当前操作不允许 |
| `404 Not Found` | `TASK_NOT_FOUND` / `NOT_FOUND` | 具体资源不存在，或路由不存在 | 资源不存在；需要时避免用户枚举信息泄露 |
| `409 Conflict` | `TASK_TITLE_CONFLICT` | 唯一性冲突、版本冲突、状态冲突 | 当前状态与操作冲突 |
| `422 Unprocessable Content` | `TASK_TITLE_INVALID` | 结构正确，但语义规则不成立 | 数据通过结构检查，但违反业务规则 |
| `429 Too Many Requests` | `RATE_LIMITED` | 触发速率限制 | 可以稍后重试，配合 `Retry-After` |
| `500 Internal Server Error` | `INTERNAL_ERROR` | 未预期的服务器错误 | 通用失败信息与 request ID |

并不存在一套适用于所有团队的唯一 code 命名法，但一旦发布，就应把它视作客户端契约的一部分。不要今天用 `NOT_FOUND`，明天改成 `NOT_EXISTS`，后天再把判断转移到 message 上。

### 6.3 业务错误、校验错误与未知错误的处理顺序

全局错误处理的推荐顺序是：

1. 如果是 Fastify 的 schema 校验错误，映射为 `400 VALIDATION_ERROR`，提取安全的 field/reason。
2. 如果是 `AppError`，使用其声明的 HTTP 状态码与公共 code/message。
3. 如果是限流错误，映射为 `429 RATE_LIMITED`；配置 rate-limit 插件自己的响应 builder，避免它绕过全局错误处理时返回另一种结构。
4. 对明确的客户端错误状态，映射为受控的通用 code，不把框架内部 message 直接返回。
5. 其余错误写入带 `err` 字段的服务器日志，并向客户端返回 `500 INTERNAL_ERROR`。

另一个必须处理的路径是未匹配的 URL。Fastify 有独立的 `setNotFoundHandler()`，所以不要只写 `setErrorHandler()` 然后以为所有 404 一定会经过它。业务中的“任务 ID 不存在”和“客户端请求了不存在的 route”可以有不同 code，但都应该保持同一 envelope。

### 6.4 限流错误如何进入统一契约

`@fastify/rate-limit` 可以对请求限流，并返回 HTTP 429。它的默认响应形状与本文的统一 envelope 不同，因此配套项目用 `errorResponseBuilder` 返回：

```ts
errorResponseBuilder: (request) => ({
  error: {
    code: 'RATE_LIMITED',
    message: '请求过于频繁，请稍后重试',
    requestId: request.id
  }
})
```

客户端应遵守 `Retry-After`（如果服务端提供），而不是不间断重试。生产环境部署在反向代理后时，还应确认 Fastify 的 IP 获取设置与可信代理配置，否则限流可能按错误的来源地址计数。分布式实例通常还需要共享存储（例如 Redis），不能误以为每个进程各自内存中的计数器就是全局限流。

### 6.5 错误模型也要写进 response schema

每条路由在 `schema.response` 中声明会返回的状态码和错误 schema。例如创建任务：

```ts
response: {
  201: TaskSchema,
  400: ErrorResponseSchema,
  409: ErrorResponseSchema,
  422: ErrorResponseSchema,
  429: ErrorResponseSchema,
  500: ErrorResponseSchema
}
```

这不表示每条路由必须重复所有错误状态码。可以通过项目约定和 helper 降低重复，但不要靠模糊的 `default: { type: 'object' }` 把错误契约隐藏起来。文档应准确告诉调用方在预期错误下会得到什么结构。

## 第 7 章：用 Pino 做结构化日志，而不是 `console.log`

### 7.1 开启 Fastify 内置 logger

Fastify 默认不启用日志。创建实例时传入 `logger: true` 或 logger 配置就会启用其基于 Pino 的日志设施。示例使用：

```ts
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'req.body.password',
        'req.body.token'
      ],
      censor: '[REDACTED]'
    }
  }
})
```

结构化日志最重要的特点是把事件上下文作为对象传入：

```ts
request.log.info({ taskId: task.id, status: task.status }, 'task created')
request.log.warn({ errorCode: 'TASK_TITLE_CONFLICT' }, 'business conflict')
request.log.error({ err: error }, 'unhandled request error')
```

日志系统能可靠地按字段筛选、聚合和关联事件。相比拼接成一个大字符串，结构化字段有利于分析，也让 message 保持简短稳定。

### 7.2 请求 logger、子 logger 与日志级别

Fastify 会为请求提供 `request.log`，通常优先使用它，因为它已经带有该请求的上下文，适合记录 `request.id`、路由、用户或租户等经过批准的字段。应用级 logger `app.log` 适合启动、关闭、配置错误等不属于单一请求的事件。Pino 的 child logger 则可以固定附加模块上下文：

```ts
const taskLog = app.log.child({ component: 'tasks' })
taskLog.info({ action: 'startup-check' }, 'tasks module initialized')
```

常见级别从低到高为 `trace`、`debug`、`info`、`warn`、`error`、`fatal`，并可设置 `silent`。本地排查可以把 `LOG_LEVEL=debug`，生产一般选择 `info` 或按服务量调整。级别过滤能降低噪声，但它不是敏感信息保护机制；无论哪个级别，都不应随意打印凭证。

### 7.3 Redact 的作用与边界

`redact` 能在指定字段路径上遮蔽敏感值，例如 `Authorization`、cookie、API key 和密码字段。它应该是防止误打日志的第二道防线，不是鼓励把所有 request body 都记录下来。

最佳实践是：默认只记录有诊断价值的白名单字段；只有在特定事件确有必要时才记录 body 的局部内容；密码、token、session、Cookie、支付信息、个人数据都要从日志设计中排除或做合适的脱敏；外部输入要限制长度，防止恶意大字段污染日志。

还要理解 redact 的限制：只匹配配置的路径。假设你在 `req.body.auth.accessToken` 里新增了一种凭证，却没有更新 redact 路径，原有规则不一定会自动保护它。因此要建立敏感字段清单，并把日志配置纳入安全评审。

### 7.4 不把内部异常和客户端响应混为一谈

对于未知错误，日志里记录 `{ err: error }` 可以包含调试需要的信息；对客户端仍然返回 `500 INTERNAL_ERROR` 和 request ID。排查时用 request ID 将两者关联起来。这比把 stack trace 直接放进 HTTP body 更安全，也更有利于以后迁移错误格式而不影响客户端。

在开发环境若喜欢彩色、可读的日志，可以安装 `pino-pretty` 并配置 logger transport。不要将 pretty transport 当作生产日志格式的必选项；生产中一般更适合保留结构化 JSON，让采集系统解析字段。

## 第 8 章：从 route schema 生成 OpenAPI，并发布 API Reference

到这里，接口已经能在运行时校验输入、约束输出、规范错误并记录日志。下一步是让这些契约成为机器可读的 API 描述。这样前端开发者、测试工程师或外部调用方不必通过猜测和阅读源代码来理解 API。

### 8.1 先区分 JSON Schema、OpenAPI 和文档 UI

这三个名字经常一起出现，但职责不同：

- **JSON Schema** 描述一个 JSON 值必须满足的形状和约束，例如 `title` 是字符串、`limit` 是 1 到 100 的整数。
- **OpenAPI** 描述整个 HTTP API：路径、方法、参数、请求体、响应状态码、认证方式、标签和 schema 等。它既能驱动文档，也能用于生成客户端和契约检查。
- **Swagger UI / Scalar** 是把 OpenAPI 文档呈现为可浏览 API reference 的前端。它们本身不是输入校验器，也不会替代服务端鉴权。

在本项目中，TypeBox schema 是路由契约的来源；`@fastify/swagger` 根据已注册路由及其 schema 生成 OpenAPI；本教程选择 Scalar 呈现文档。实际接口请求仍由 Fastify 的 validator 和 handler 处理。

### 8.2 为什么 `@fastify/swagger` 必须先注册

对于动态生成模式，Swagger 插件会观察后续注册的路由并收集 route schema。假如先注册 `/v1/tasks`，之后才注册 `@fastify/swagger`，先前的路由就可能不会按预期出现在动态生成的文档里。

本项目的装配顺序因此是：先创建 app 并安装全局错误处理和 hooks，再注册 Swagger，再注册限流插件和业务路由，最后注册 API reference UI。最关键的顺序关系是：**Swagger 在业务路由之前**。

```ts
app.register(swagger, {
  openapi: {
    openapi: '3.1.0',
    info: { title: 'Tasks API', version: '1.0.0' }
  }
})

app.register(taskRoutes, { service })
```

这是一个需要用测试防守的架构约定，而不是代码风格偏好。本项目的集成测试会等待 `app.ready()`，再断言 `app.swagger().paths` 中存在任务接口。

### 8.3 给路由写足够的文档元数据

一个 schema 不仅要能校验，还应该使 API reference 对读者有帮助。以创建任务的路由为例：

```ts
app.post('/v1/tasks', {
  schema: {
    tags: ['Tasks'],
    summary: '创建任务',
    description: '创建一个新任务；任务状态初始为 open。',
    body: CreateTaskBodySchema,
    response: {
      201: TaskSchema,
      400: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
      500: ErrorResponseSchema
    }
  }
}, handler)
```

这里的 `tags` 用于分组，`summary` 提供一句话摘要，`description` 解释重要语义。每个重要响应都应尽量明确列出状态码和 schema。真实项目还应根据接口补齐 `security`、Header、示例和分页说明。不要为了“文档显示完整”而编造实际并不存在的行为。

`@fastify/swagger` 将 Fastify 路由 schema 转为 OpenAPI，但两套 schema 系统并非逐字等价：Fastify 运行时 validator 使用的 JSON Schema 方言/配置，应与 OpenAPI 输出方言分开理解。OpenAPI 3.1 与 JSON Schema 的对齐度较高，但它不代表自动改变了 Fastify 的运行时校验器配置。某些 schema 关键字、引用方式或插件扩展在运行时和文档端的支持范围可能不同，升级时要同时运行集成测试并检查生成的 OpenAPI。

### 8.4 schema `$id` 与 OpenAPI schema 复用

在路由里直接嵌入 schema 是很直观的起点。当多个路由引用同一份 `TaskSchema` 或 `ErrorResponseSchema` 时，可以为共享 schema 分配 `$id`，在适当的 Fastify 封装范围内通过 `addSchema()` 注册，再使用 `$ref` 引用。这样可以避免生成的文档中重复定义大量相似对象，也减少某次字段修改只改了部分接口的风险。

`$id` 应当稳定且唯一；把它视作 schema 的标识符，而不是人类可读的标题。`$ref` 目标必须在当前 schema 图及允许的注册范围中可解析。Fastify 的 schema 注册也受插件封装边界影响，因此不要假设在某个子插件内 `addSchema()` 的对象会自动成为其他任意兄弟插件都可见的全局 schema。先决定共享 schema 的归属边界，再安排注册顺序。

遇到 `$ref` 解析失败时，按以下顺序排查：确认 `$id` 是否精确匹配；确认引用是否写错；确认 schema 是否在使用它的路由之前注册；确认注册 schema 的插件范围是否覆盖该路由；最后检查当前 `@fastify/swagger`、Fastify 和 TypeBox 版本支持的 schema 结构。

### 8.5 Scalar：本教程选择的 API reference 前端

本项目使用 Scalar。在开发环境中访问 `http://localhost:3000/reference`。注册方式如下：

```ts
app.register(import('@scalar/fastify-api-reference'), {
  routePrefix: '/reference',
  configuration: {
    title: 'Tasks API',
    layout: 'modern',
    telemetry: false
  }
})
```

当 `@fastify/swagger` 已安装并配置时，Scalar 的 Fastify 集成可以发现相应的 OpenAPI 文档端点。具体生成的 JSON URL 和界面行为应以当前依赖版本为准，可以在浏览器开发者工具、Fastify route list 和集成测试中核实。`telemetry: false` 用来关闭 Scalar 的遥测配置；它不等于保护了 API 文档。

为什么这套教程选 Scalar？它提供官方 Fastify 集成，注册简单，适合快速给 schema 驱动的 API 提供现代 reference 界面。选择不是说 Swagger UI 不好；两者都是 API reference 前端，通常不需要为了“支持 OpenAPI”同时部署两份 UI。团队若已标准化 Swagger UI，就沿用 Swagger UI；核心是稳定维护 OpenAPI 契约，而不是选哪款皮肤。

### 8.6 如果团队要用 Swagger UI

可把 Scalar 注册段替换为 Swagger UI 的 Fastify 插件，例如与当前 Fastify 主版本兼容的 `@fastify/swagger-ui`。安装前请查它的兼容表，注册时配置 `routePrefix`，并确认 Swagger 在业务路由之前注册。不要同时挂载两个 UI 来“互相兜底”，除非你确实有两个不同用户群或明确的维护需求。

### 8.7 文档环境与安全边界

开发环境开放 `/reference` 对团队协作非常有用，但生产环境是否公开是安全决策，不是 UI 的默认值能替你决定的。本项目默认在 `NODE_ENV=production` 时禁用文档，这是一道保守的默认防线。也可以在受控内网或受认证保护的运维入口开放文档，但要同时保护 UI 和 OpenAPI JSON 端点。**只隐藏 UI 页面而让 schema JSON 仍可匿名读取，并不等于文档受保护。**

API schema 本身不要放入真实密钥、内部主机名、数据库字段、堆栈信息或内部运行手册。例子只用虚构数据；生产文档只公开面向调用方的契约。文档并不等同于“可公开的数据”，尤其在包含内部管理接口时。

### 8.8 API 版本与破坏性变更

本项目使用路径版本 `/v1/tasks`，新手阶段它让不同版本的契约可见且易于测试。对外 API 一旦被客户端依赖，下面这些变化通常应被视为破坏性变更，谨慎放入现有版本：删除字段或路由、把可选字段改为必填、缩窄接受值范围、改变字段语义、改动错误 code 或错误响应结构、改变分页默认值并令既有调用得到不同结果。添加可选响应字段在技术上经常是兼容的，但仍可能打破对额外字段敏感的客户端或签名校验机制，因此应依团队契约策略评估。

维护 API 的重点不只是给 URL 加 `/v1`。每次变更应更新 schema、测试和 OpenAPI，再比较前后契约，并在发布说明中声明迁移方式。可以把“生成 OpenAPI 文件并纳入 CI”当成后续作业；即便还没有契约 diff 工具，也应最少把关键路径、输入 schema、状态码和稳定错误 code 写入自动化测试。

## 第 9 章：用 `app.inject()` 写集成测试

手工用浏览器或 curl 检查一次成功请求很有价值，但不足以保护 API 契约。集成测试需要证明整套插件已经正确装配、路由能工作、schema 会拒绝坏输入、错误 envelope 稳定、输出 schema 不泄露字段，以及 OpenAPI 真的包含已注册路由。

### 9.1 `inject()` 到底测试了什么

Fastify 的 `app.inject()` 会模拟 HTTP 请求，并确保应用插件在请求被处理之前完成相应的启动流程。它不要求真实监听 TCP 端口，所以适合快速、可重复地测试路由、hooks、序列化、错误处理和插件组合。

这不是完整的端到端部署测试：它不会替你验证反向代理、TLS、DNS、容器入口、负载均衡器或真实网络时延。可以把 `inject()` 理解成 HTTP 应用内部的集成测试工具；在有需要时，另加少量通过真实端口发送请求的部署烟雾测试。

### 9.2 一份测试的基本结构

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'

test('GET /v1/tasks returns an empty page', async (t) => {
  const app = buildApp({ enableDocs: false })
  t.after(async () => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/v1/tasks'
  })

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    items: [], total: 0, limit: 20, offset: 0
  })
})
```

`buildApp()` 提供一个新的应用实例；每个测试都用自己独立的实例，可以减少测试之间的共享状态；`t.after()` 负责关闭实例；`response.json()` 解析 JSON body。测试框架使用 Node.js 自带的 `node:test` 与 `node:assert/strict`，因此不需要再引入额外测试框架才能开始学习。

### 9.3 不只测 200：覆盖契约边界

本项目的测试文件已经覆盖几类常见行为：

1. `app.ready()` 后，`app.swagger().paths` 有 `/v1/tasks` 和 `/v1/tasks/{id}`，证明路由插件装配和 OpenAPI 注册顺序正确。
2. `GET /v1/tasks?limit=0` 应触发 schema 校验，并返回统一的 `VALIDATION_ERROR` envelope，而不是框架的默认错误格式。
3. `POST` 创建后返回 `201`；随后 `GET` 能取回刚创建的资源。
4. 创建重复标题返回 `409 TASK_TITLE_CONFLICT`。
5. 未知 URL 返回统一的 `404 NOT_FOUND`。
6. 不在请求 schema 里的额外字段会被拒绝，防止客户端悄悄把无定义数据混入命令。
7. 用一个故意返回 `internalSecret` 的替身 repository 验证响应 schema 会把未声明字段从 HTTP 响应中排除。

这里的第 7 条特别重要：不要只测试正常的 repository 永远“恰好返回正确对象”。如果内部模型未来增加 `passwordHash`、`billingNotes` 或 `internalSecret`，响应 schema 应该继续限制对外形状。这是可以直接自动化验证的安全性质。

### 9.4 替换依赖以测试装配

`buildApp({ repository })` 接受 repository 接口，这使测试能传入真实的内存实现或一个刻意定制的替身。对于常见 API，测试不必每次都启动数据库；可以通过替身让“查不到资源”“发生冲突”“依赖抛出未知异常”等分支可重复出现。

等将来接入 PostgreSQL 或其他数据库时，可以为 repository 实现单独增加集成测试；HTTP 路由的绝大多数契约测试仍可使用快速替身。注意测试替身必须遵循相同接口和可观察语义，不要为让测试通过而模拟出生产环境不可能产生的行为。

### 9.5 `app.ready()`、`app.close()` 与异步错误

如果测试读取 `app.swagger()` 或检查所有插件已装配，应先 `await app.ready()`。每个创建的 app 最后都要关闭，以运行关闭 hooks、释放定时器或资源，避免测试进程不退出。测试本身是异步的，所以要 `await app.inject()`；否则断言可能在请求结束前就完成。

当未来插件启动需要数据库连接时，`app.ready()` 也能帮助测试尽早暴露装配和启动错误。生产入口与测试入口应共享 `buildApp()`，但不要让导入模块时就自动 `listen()`；这样测试可以构造 app 而不意外启动真实服务器。

## 第 10 章：启动项目、理解结果，并按顺序扩展

前面的章节已给出各模块代码，配套下载包包含同一份示例项目。它刻意先使用内存 repository，让你先学会 HTTP 边界和 Fastify 装配，再接入真正数据库。

### 10.1 目录结构复盘

```text
fastify-typebox-learning-api/
├── package.json
├── tsconfig.json
├── src/
│   ├── app.ts                    # 组装 Fastify、错误模型、日志、文档
│   ├── server.ts                 # 进程入口：listen 与启动错误
│   ├── errors/
│   │   └── app-error.ts          # 可安全暴露的应用错误类型
│   └── modules/tasks/
│       ├── schemas.ts            # TypeBox schema 与静态类型
│       ├── repository.ts         # 数据访问接口与内存实现
│       ├── service.ts            # 业务规则
│       └── routes.ts             # HTTP 路由与 schema
└── test/
    └── app.test.ts               # inject 集成测试
```

这棵树不是唯一正确答案，也不应该一开始就拆成几十个文件。它的关键在于边界：`routes.ts` 处理 HTTP；`schemas.ts` 定义输入输出契约；`service.ts` 承担业务规则；`repository.ts` 负责数据存取；`app.ts` 统一装配全局能力；`server.ts` 才真正监听端口。后续可以按团队需要再拆出 authentication、configuration、observability 等模块。

### 10.2 安装、构建和测试

先安装 Node.js 当前受支持的 LTS 版本，然后在解压后的项目目录执行：

```bash
npm install
npm test
npm run build
npm run dev
```

在开发服务启动后，检查以下请求：

```bash
# 列出任务
curl -i 'http://localhost:3000/v1/tasks?limit=10&offset=0'

# 创建任务
curl -i -X POST 'http://localhost:3000/v1/tasks' \
  -H 'content-type: application/json' \
  -d '{"title":"学习 Fastify","description":"完成第一个契约驱动的 API"}'

# 参数不符合 schema：limit 必须至少为 1
curl -i 'http://localhost:3000/v1/tasks?limit=0'

# 查看 Scalar reference（开发环境）
# 浏览器打开 http://localhost:3000/reference
```

响应中应能看到 `x-request-id` header；错误响应中也应包含同一请求的 `requestId` 字段。由于本项目用内存存储，停止并重启服务后任务会消失。这是教学项目刻意保留的简化，不是生产持久化方案。

### 10.3 常见故障怎样定位

**文档缺少路由。** 检查 `@fastify/swagger` 是否注册得太晚；路由是否提供 `schema`；等待应用 `ready()` 后再读取 swagger spec；查看插件版本兼容表。

**`$ref` 无法解析。** 核实 `$id` 和 `$ref` 的大小写、路径和注册顺序，并检查 `addSchema()` 所在插件作用域是否覆盖使用方。不要为了“让它工作”就复制多份不一致的 schema。

**查询参数看起来是字符串。** URL querystring 中的值天然来自文本。Fastify 的标准校验配置通常会将 schema 声明的数字等类型进行转换，但仍应依赖 schema 和 Type Provider 声明，不要在 handler 到处写无约束的 `Number(request.query.limit)`。若修改 AJV 的 coercion、removeAdditional 等配置，要用测试确定行为。

**测试里插件还没注册完成。** 在需要完整路由列表的断言前 `await app.ready()`；确认测试等待所有 inject Promise；用 `t.after(() => app.close())` 释放实例。

**错误变成 500。** 区分 schema validation 错误、`AppError`、已知 Fastify 客户端错误与真正未知异常。不要为了省事把所有 error 都判成 400；未知错误必须记录日志并保留 `500` 语义，同时不给客户端暴露 stack trace。

**敏感字段出现在 JSON 响应。** 检查对应 route 是否定义 `response` schema，成功状态码是否匹配，schema 是否真的限制了属性；然后给这个字段加一个会故意返回额外属性的集成测试。响应 schema 应用于每个可能输出敏感资源的路由，而不是只给一个列表路由加上。

**依赖安装/类型检查失败。** 查看 TypeBox、`@fastify/type-provider-typebox` 与 Fastify 的版本兼容关系。旧教程经常使用 `@sinclair/typebox`，而当前官方资料示例使用 `typebox` 包名；两套代码不能仅凭 import 名称机械混搭。升级依赖后重新执行测试和构建，并核对官方 changelog。

### 10.4 从学习项目走向生产前的顺序

不要在第一天就把所有基础设施都塞进来。推荐顺序是：先把请求 schema、响应 schema、错误 envelope、request ID 和路由测试做到稳定；再引入正式认证与权限检查；接入数据库事务和迁移；增加配置校验、健康检查和优雅关机；完善限流策略、CORS 和安全 header；然后建立 OpenAPI 契约 diff、日志采集、指标、追踪和部署烟雾测试。

有几项生产要求需要进一步认真设计：

- **认证与授权不是一回事。** 401 表示调用方尚未通过认证；403 表示已识别的调用方没有权限。不要只根据用户是否存在来判断访问一个资源是否被允许。
- **资源不存在和越权不可见需要策略。** 有些 API 返回 404 避免泄露资源存在性；另一些使用 403。策略需在 API 中一致，并经安全评审。
- **限流需要考虑主体和基础设施。** 单实例内存限流在多副本部署下未必是全局限流；应根据 IP、用户、租户或 API key 等维度，决定是否使用共享存储；反向代理后也要正确处理可信代理配置。
- **分页要设上限。** 即使调用者请求 `limit=1000000`，schema 也应拒绝或限制，防止大查询；排序字段应使用白名单映射为数据库列名，不能将用户原始字符串直接拼接进 SQL。
- **日志不是数据库。** 避免记录完整请求体、认证材料和不必要的个人数据；限制高基数字段；对未知异常保留足够诊断上下文并保护访问权限。
- **契约与持久化模型不必完全相同。** API DTO 不该自动暴露数据库实体的每个列。响应 schema 是有意设计的外部边界，业务模型和存储模型可以比它丰富。

## 最终验收：你是否真正完成了“从 0 到 1”

读完教程并运行项目之后，请逐项亲手检查，而不是只确认代码能启动：

- [ ] 能解释 Fastify instance、`register()`、plugin scope、decorator、route、request/reply 的职责。
- [ ] 能说出 `onRequest`、`preValidation`、`preHandler`、handler、`onResponse` 在请求过程中的位置，并知道 response 已发送后不能再改 body。
- [ ] 给 `params`、`querystring`、`headers`、`body` 都定义了实际 schema，并能看到不合法输入被拒绝。
- [ ] 使用 TypeBox 的 `Type`、`Static`、`Optional`、`Union`、`Literal` 和 `$ref` 形成可复用契约，理解编译期静态类型不能替代运行时校验。
- [ ] 能说明 `$id` 的唯一性、`$ref` 的解析条件和 `addSchema()` 的插件封装范围。
- [ ] 将纯结构问题留给 schema，将查数据库和业务状态判断放进 service 层。
- [ ] 成功、未找到、参数错误、冲突、未授权、禁止访问、限流和未知错误都映射到明确的状态码及稳定的 error code。
- [ ] 每个错误均包含 request ID，并且客户端看不到 stack trace 或数据库错误原文。
- [ ] 成功输出使用 response schema，且测试证实未声明的内部字段不会泄露。
- [ ] 分页和排序有边界、默认值与白名单，不会直接把用户输入当成 SQL 列名。
- [ ] `@fastify/swagger` 在路由之前注册，`app.swagger()` 中出现预期 OpenAPI 路径。
- [ ] 只部署选择好的一个 API reference 前端，并明确生产环境的 UI 与 OpenAPI JSON 端点如何保护。
- [ ] Pino 日志为结构化 JSON，带请求上下文，设置日志级别和 redact，同时明白 redact 并非万能。
- [ ] 使用 `app.inject()` 覆盖插件装配、有效请求、错误请求、错误契约与响应字段过滤。
- [ ] 能明确指出示例的局限：内存仓储不持久化，生产环境还需认证、授权、持久层与部署级测试。

如果以上每项都能通过测试或亲手演示，你不仅是“用 Fastify 写出一条路由”，而是已经建立了一套可继续演进的 HTTP API 基础。

## 官方资料与继续阅读

以下链接优先指向官方项目文档或官方仓库。教程将它们用作实现与概念核对依据；由于软件持续演进，读者遇到版本差异时，应优先查看自己所安装主版本对应的文档和兼容表。

### Fastify

- [Getting Started](https://fastify.dev/docs/latest/Guides/Getting-Started/)：安装、创建实例、运行服务器。
- [Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/)：插件封装、父子作用域和可见性。
- [Lifecycle](https://fastify.dev/docs/latest/Reference/Lifecycle/)：一次请求的生命周期顺序。
- [Hooks](https://fastify.dev/docs/latest/Reference/Hooks/)：hook 的使用方式与限制。
- [Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)：AJV、输入 schema 和输出序列化。
- [Decorators](https://fastify.dev/docs/latest/Reference/Decorators/)：如何扩展实例、request 和 reply。
- [Logging](https://fastify.dev/docs/latest/Reference/Logging/)：Pino logger、日志选项与脱敏。
- [Type Providers](https://fastify.dev/docs/latest/Reference/Type-Providers/)：让 TypeScript 类型与 schema 配合。
- [Testing](https://fastify.dev/docs/latest/Guides/Testing/)：使用 `inject()` 测试 HTTP 路由。

### TypeBox 与 JSON Schema

- [TypeBox 官方仓库](https://github.com/sinclairzx81/typebox)：运行时 schema 和 TypeScript 静态类型。
- [Fastify TypeBox Type Provider](https://github.com/fastify/fastify-type-provider-typebox)：Fastify 官方团队维护的类型提供器集成。
- [JSON Schema: Getting started](https://json-schema.org/learn/getting-started-step-by-step)：类型、属性、必需字段等基础。
- [JSON Schema: Structuring](https://json-schema.org/understanding-json-schema/structuring)：schema 标识、模块化与 `$ref`。

### OpenAPI 与 API reference

- [OpenAPI Specification](https://spec.openapis.org/oas/)：OpenAPI 的规范定义和版本信息。
- [@fastify/swagger 官方仓库](https://github.com/fastify/fastify-swagger)：Fastify route schema 到 OpenAPI 的生成配置。
- [Swagger UI 官方文档](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/)：Swagger UI 配置参考。
- [Scalar Fastify 集成](https://scalar.com/products/api-references/integrations/fastify)：在 Fastify 上挂载 Scalar API reference。
- [Scalar 配置](https://scalar.com/products/api-references/configuration)：主题、布局与 reference 设置。

### 限流

- [@fastify/rate-limit 官方仓库](https://github.com/fastify/fastify-rate-limit)：版本兼容、`429` 响应与限流策略。

