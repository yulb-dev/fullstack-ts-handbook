# 第 4 章：把认证 handler 接进 Fastify，保留请求和响应的安全语义

[上一章](./03-models-adapter-and-first-migration.md) · [目录](./README.md) · [下一章](./05-client-and-first-login.md)

数据库准备好后，网页还是不能登录。Better Auth 的实例需要一个 HTTP 入口。Fastify 使用自己的 Request/Reply 对象，而 Better Auth handler 接收标准 Web `Request`，返回标准 `Response`。本章把两个世界接起来。

## 4.1 先理解路径，而不是先写自己的登录接口

默认认证路径形如：

```text
POST /api/auth/sign-up/email
POST /api/auth/sign-in/email
GET  /api/auth/get-session
POST /api/auth/sign-out
```

`/api/auth` 是 `basePath`，后面的路径由 Better Auth 管理。Fastify 只建立 catch-all，把认证请求交过去。

不需要再写一个自己的 `/login`：它解析邮箱、调用 `auth.api.signInEmail`、只返回 JSON，却忘了 Cookie、限流和原有安全链。`auth.api` 是可信服务端调用入口，并不是完整 HTTP handler 的等价物；第 11 章会验证服务端调用不受内置 HTTP 限流保护。

## 4.2 先注册精确的 CORS

```ts
await app.register(cors, {
  origin: env.WEB_ORIGIN,
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  exposedHeaders: ["X-Retry-After"],
});
```

先注册插件再挂认证与业务路由。这里允许 5173 的页面向 4000 的 API 发带 Cookie 请求。

每项都有具体作用：

- `origin` 控制浏览器允许哪个页面读取跨 origin 响应。
- `credentials: true` 允许 credential 模式的响应。
- `allowedHeaders` 告诉浏览器预检时可使用 JSON Content-Type。
- `exposedHeaders` 让页面能读取限流返回的 `X-Retry-After`。
- `OPTIONS` 预检由 CORS 插件处理，不转给 Better Auth 当成登录请求。

不要设置 `origin: "*"` 配合 credentials；也不要无条件反射来访 Origin。CORS 本身不是业务 CSRF 防线，第 8 章会补齐。

## 4.3 把 Node headers 转成标准 Headers

官方提供：

```ts
import { fromNodeHeaders } from "better-auth/node";
const headers = fromNodeHeaders(request.headers);
```

它处理 Node headers 的类型，不是验证 Cookie 的函数。转换后仍须交给 Better Auth 进行会话验证。

最终工程还有三步规范化：

```ts
function authHeaders(request: FastifyRequest) {
  const headers = fromNodeHeaders(request.headers);
  headers.delete("x-forwarded-for");
  headers.set("x-real-ip", request.ip);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  return headers;
}
```

删除 body 长度相关头，是因为 Fastify 已把 JSON 解析为对象，我们会重新 `JSON.stringify`，字节长度可能改变。不要带着旧长度构造另一份 body。

IP 头的处理将在第 11 章展开：Better Auth 只读取本服务根据连接或受信代理算出的 IP，不相信来访者自行填写的 `x-real-ip`。

## 4.4 完成 handler 桥接

下面是 [app.ts](./example/src/app.ts) 的关键实现：

```ts
app.route({
  method: ["GET", "POST"],
  url: "/api/auth/*",
  handler: async (request, reply) => {
    const url = new URL(request.url, env.BETTER_AUTH_URL);
    if (url.origin !== env.BETTER_AUTH_URL) {
      throw new HttpError(400, "INVALID_URL");
    }
    const response = await auth.handler(
      new Request(url, {
        method: request.method,
        headers: authHeaders(request),
        ...(request.method === "POST" && request.body !== undefined
          ? { body: JSON.stringify(request.body) }
          : {}),
      }),
    );
    reply.code(response.status);
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header("set-cookie", cookies);
    reply.header("Cache-Control", "no-store");
    return reply.send(response.body ? await response.text() : null);
  },
});
```

为什么 URL 使用配置的公开 origin？官方最小示例用 `request.headers.host` 组装 URL，便于展示；本文固定单一公开地址，避免让不可信 Host 改写验证邮件、回调与重定向的基础 URL。公开地址在 HTTPS 代理后也可能不同于进程内监听地址。

为什么保留 query？邮箱验证、OAuth 回调与重置流程会带参数，不能只转发 pathname。

为什么不是把 `response` 当普通对象 `reply.send(response)`？标准 Response 不是你的业务 JSON，里面的 status、headers、body 都有独立含义。认证响应统一设置 `Cache-Control: no-store`，避免会话等用户专属响应被共享 HTTP 缓存；代理/CDN 也要显式排除认证路径。

这个桥接实现支持本文客户端发送的 JSON，以及 GET 回调。它不是通用 body 透传器：不支持把 URL-encoded 表单、multipart 或流式 body 任意 stringify。若未来启用依赖这些编码的协议/插件，需要按官方集成与该协议保留原始编码，并加集成测试，不能仅安装 body parser 就认为桥接完成。

## 4.5 多条 Set-Cookie 必须分别发送

认证响应可能要设置会话 Cookie、清理状态 Cookie，或分片大型 cookie data。HTTP 允许多条 `Set-Cookie`。

不能把它们拼成一个逗号分隔的字符串。Cookie 属性中的 `Expires` 自身就含逗号，简单拆分会破坏格式。

Node 24 的标准 Headers 支持 `getSetCookie()`，我们把数组交给 Fastify：

```ts
reply.header("set-cookie", response.headers.getSetCookie());
```

这比用一般 `forEach` 当作所有响应头都相同更可靠。最后的安全测试会验证登录和退出响应确实保留 Cookie。

前端 JavaScript 不能通过 `response.headers.get("Set-Cookie")` 读取它，这是浏览器限制；浏览器负责保存 Cookie。服务端能读取并转发两者不矛盾。

## 4.6 第一个受保护接口：/api/me

现在用公开服务端 API 验证每条请求：

```ts
const { response, headers } = await auth.api.getSession({
  headers: authHeaders(request),
  query: { disableCookieCache: true },
  returnHeaders: true,
});
const cookies = headers.getSetCookie();
if (cookies.length) reply.header("set-cookie", cookies);
reply.header("Cache-Control", "no-store");
if (!response) throw new HttpError(401, "UNAUTHENTICATED");
if (!response.user.emailVerified)
  throw new HttpError(403, "EMAIL_NOT_VERIFIED");
```

把这段提取为 `requireIdentity`。返回的主体来自已验证会话，不能来自 `request.body.userId`。

为什么取返回 headers？读取会话可能发生续期并返回新 Cookie，只拿 data 会漏掉更新。为什么 `no-store`？用户专属响应不应被 CDN 或共享 HTTP 缓存给另一个用户复用。

`/api/me` 只返回：

```ts
const current = await requireIdentity(req, reply);
return { id: current.id, name: current.name, email: current.email };
```

不把原始 session token 当作普通“个人资料”返回。Better Auth 自身的会话管理 API 有其约定，但自有 API 应使用最小投影。

从零跟做时，现在按完整链接创建 [services.ts](./example/src/services.ts) 与 [app.ts](./example/src/app.ts)。第 3 章已提前准备全部业务表，因此不会遇到缺失导出；Service 里的授权规则将在第 12 章逐步推演。此处先只操作 `/api/me` 与认证路径，不必现在理解每条 task SQL。

`HttpError` 也在 services.ts 中定义：它保存 HTTP status 和稳定 code；app 的错误 handler 使用它返回脱敏错误。建立完整源码是为了随章都能运行，不等于可以省略后续的授权学习和负面测试。

## 4.7 错误边界：失败要拒绝，不要回退成匿名管理员

区分几类结果：

| 情况                           | HTTP 行为            |
| ------------------------------ | -------------------- |
| 没有有效会话                   | 401                  |
| 会话有效但邮箱未验证或角色无权 | 403                  |
| 资源不存在或不向非成员泄露     | 404                  |
| 输入不合法                     | 400                  |
| 请求过于频繁                   | Better Auth 返回 429 |
| 数据库故障、未知异常           | 脱敏 500，不授权     |

数据库故障不能被 catch 后替换成一个“方便调试”的用户。也不要把所有错误都改成 401：这样会掩盖系统故障，并误导用户反复登录。

最终错误 handler 对已知业务错误进行映射；未知异常不把 SQL、连接字符串、邮件 token 或堆栈直接返回给浏览器。

## 4.8 启动与停止

[src/server.ts](./example/src/server.ts) 的关键链：

```ts
const app = await createApp(db, auth, env);
app.addHook("onClose", async () => {
  await pool.end();
});
await app.listen({ host: "127.0.0.1", port: 4000 });
```

配套工程：

```bash
npm run dev
```

从零项目则在 `package.json` 添加 `"dev": "tsx watch src/server.ts"`，并按链接创建完整停止逻辑。

此时访问 `/api/me` 应得到 401；不是 200，也不是数据库缺表 500。数据库表已存在却报错，应检查最终 adapter 是否拿到了正确 schema、数据库 URL 是否指向你刚迁移的那个库。

## 4.9 练习：找出三处破坏

1. 登录成功只返回 `await response.json()`，不转发 headers。
2. URL 用固定 `/api/auth`，把 `request.url` 的后半段与 query 丢掉。
3. `/api/me` 只检查请求里有没有 `cookie` 头。

参考：第一处浏览器拿不到完整 Set-Cookie；第二处所有端点/回调错路；第三处攻击者随便填 Cookie 就通过，没有验证签名、到期或撤销。

## 4.10 本章验收

- [ ] 认证请求交给 `auth.handler`，不是自制密码验证。
- [ ] Query、status、body、Location 与多条 Set-Cookie 没有丢失。
- [ ] 每条受保护请求通过 `auth.api.getSession` 验证。
- [ ] 个人响应不共享缓存、不泄露 session token。
- [ ] 明白 JSON 桥接的编码支持边界。

官方阅读：[Fastify Integration](https://better-auth.com/docs/integrations/fastify)、[API](https://better-auth.com/docs/concepts/api)、[Session Management](https://better-auth.com/docs/concepts/session-management)。固定 origin、IP 规范化、日志脱敏及多 Cookie 转发是基于官方 handler 组合做的工程加固。
