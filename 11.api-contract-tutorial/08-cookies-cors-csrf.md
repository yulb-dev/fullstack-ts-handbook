# 第 8 章：Cookie、CORS、预检、CSRF 与代理

> 本章目标：搞清楚浏览器在「带凭据的 API 请求」上的全部规则——会话 Cookie 该设哪些属性、`credentials` 是什么、什么时候会触发 CORS 和预检请求、CSRF 是怎么发生的以及怎么多层防御；最后给出开发期和生产期的代理/部署方案。
>
> 对应核心概念：**⑤ 认证 cookie、credentials、CSRF/CORS、浏览器预检请求与代理配置。**

这是全书概念最密集的一章。很多「本地好好的，上线就不行」的问题都出在这里。我们先建立几个基础概念，再逐一落地。

---

## 8.1 两个基础概念：源（origin）与站点（site）

**源（origin）= 协议 + 主机 + 端口**，三者完全相同才是「同源」：

| A                         | B                               | 同源？         |
| ------------------------- | ------------------------------- | -------------- |
| `https://app.example.com` | `https://app.example.com/tasks` | ✅（路径不算） |
| `https://app.example.com` | `http://app.example.com`        | ❌ 协议不同    |
| `https://app.example.com` | `https://api.example.com`       | ❌ 主机不同    |
| `http://localhost:5173`   | `http://localhost:3000`         | ❌ 端口不同    |

**站点（site）≈ 协议 + 可注册域名**（「example.com」这一级，由公共后缀列表决定）：

| A                         | B                         | 同站？                |
| ------------------------- | ------------------------- | --------------------- |
| `https://app.example.com` | `https://api.example.com` | ✅ 都是 `example.com` |
| `https://app.example.com` | `https://evil.com`        | ❌                    |
| `http://localhost:5173`   | `http://localhost:3000`   | ✅（端口不影响站点）  |

记住这两个概念，因为**CORS 看的是「源」，Cookie 的 SameSite 看的是「站点」**。很多困惑就来自把它们混为一谈。

---

## 8.2 会话 Cookie：每个属性都有理由

登录成功后，服务端下发会话 Cookie（**`apps/api/src/routes/auth.ts`** 节选）：

```ts
const token = newToken(); // 32 字节随机数，base64url
const csrfToken = newToken();
await db.insert(sessions).values({
  tokenHash: hashToken(token), // 数据库只存 SHA-256，泄库也拿不到可用的 token
  userId: user.id,
  csrfToken,
  expiresAt: new Date(Date.now() + config.sessionTtlMs),
});

reply.setCookie(SESSION_COOKIE, token, {
  httpOnly: true, // JS 读不到，XSS 偷不走会话
  secure: config.cookieSecure, // 生产必须 true：只走 HTTPS
  sameSite: "lax", // 跨站子请求不带 Cookie，CSRF 第一道防线
  path: "/",
  maxAge: Math.floor(config.sessionTtlMs / 1000),
});
return { user, csrfToken };
```

真实的响应头（通过 Vite 代理实测）：

```
set-cookie: sid=hCZLLuvPYesH21s4LywvZIED4iGjELCKz7W_UHbKbFs; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax
```

| 属性           | 作用                                                                                  | 不设会怎样                                              |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `HttpOnly`     | `document.cookie` 读不到                                                              | 任何一个 XSS 漏洞都能把会话 token 发给攻击者            |
| `Secure`       | 只在 HTTPS 请求中发送                                                                 | 公共 Wi-Fi 下明文传输，可被窃听                         |
| `SameSite=Lax` | 跨站的子请求（`<img>`、`fetch`、表单 POST）不带 Cookie；跨站的**顶层 GET 导航**仍然带 | 默认行为因浏览器而异；设为 `None` 则所有跨站请求都带    |
| `Path=/`       | 整个站点都发送                                                                        | 默认是当前路径，可能导致某些接口拿不到 Cookie           |
| `Max-Age`      | 过期时间                                                                              | 变成「会话 Cookie」，关浏览器就失效（有时反而是想要的） |

### 为什么不把 token 放 localStorage？

很多教程用 `localStorage` 存 JWT，再在请求头里加 `Authorization: Bearer …`。它的问题是：**任何能执行 JS 的攻击（XSS、被投毒的 npm 包）都能读走 token**，攻击者拿到后可以在自己的机器上长期使用。HttpOnly Cookie 让 JS 完全接触不到会话凭据——XSS 仍然可以在当前页面里冒充用户发请求，但偷不走凭据，用户登出或会话过期后攻击就结束了。

代价是：Cookie 会被浏览器**自动**附带，这引出了 CSRF 问题（8.5 节）。

### 进一步加固：`__Host-` 前缀

生产环境可以把 Cookie 名改成 `__Host-sid`。浏览器会强制要求带这个前缀的 Cookie 必须 `Secure`、`Path=/`、不能设置 `Domain`——这样同站的其他子域名（比如被攻破的 `blog.example.com`）无法覆盖或注入这个 Cookie。本教程为了让 `http://localhost` 开发环境开箱即用，使用了普通名字 `sid`；上线时建议开启。

### 服务端读取会话

**`apps/api/src/plugins/auth.ts`**（会话部分）：

```ts
export const SESSION_COOKIE = "sid";

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

async function loadSession(db: Db, token: string): Promise<AuthContext | null> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({
      csrfToken: sessions.csrfToken,
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return null;
  const { csrfToken, ...user } = row;
  return { user, csrfToken, tokenHash };
}

/** 路由里调用：拿到当前用户，否则 401 */
export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthenticated();
  return request.auth;
}
```

> 本教程的登录是「教学用免密登录」，只校验邮箱存在。真实项目请接入密码（argon2/bcrypt）、OAuth 或 Passkey，并对登录接口限流。会话的设计（随机 token、只存哈希、HttpOnly Cookie）则可以原样沿用。

---

## 8.3 `credentials`：浏览器什么时候带 Cookie

`fetch` 的 `credentials` 选项决定是否携带 Cookie（以及 HTTP 认证信息）：

| 值                          | 同源请求 | 跨源请求                   |
| --------------------------- | -------- | -------------------------- |
| `"omit"`                    | 不带     | 不带                       |
| `"same-origin"`（**默认**） | 带       | 不带                       |
| `"include"`                 | 带       | 带（还需服务端 CORS 允许） |

我们的 api-client 设置为 `credentials: "include"`：

```ts
const client = createClient<paths>({
  baseUrl: options.baseUrl ?? "",
  // 同源时浏览器默认就会带 Cookie；跨源部署必须 include，且服务端要配 CORS credentials
  credentials: "include",
});
```

同源部署时 `"include"` 和默认值效果一样；跨源部署时它是必需的。统一设成 `"include"`，切换部署方式时前端代码不用改。

注意：**`credentials: "include"` 只是「愿意带」**。Cookie 最终是否被发送，还要看 Cookie 自己的 `SameSite`、`Secure`、`Domain` 属性，以及浏览器的第三方 Cookie 策略。

---

## 8.4 CORS 与预检请求

### CORS 到底在保护什么

浏览器的**同源策略**规定：一个源的页面，默认**不能读取**另一个源的响应。CORS（跨源资源共享）是服务端用响应头「放行」特定源的机制。

一个极其常见的误解：**「CORS 能防止别的网站调用我的 API」——错。** CORS 限制的是「**读取响应**」，而不是「**发送请求**」。一个恶意网站完全可以让用户的浏览器向你的 API 发一个 POST 表单请求（并且可能带上用户的 Cookie），CORS 只是让恶意页面看不到响应内容而已。如果这个 POST 会修改数据，伤害已经造成了——这就是 CSRF（8.5 节）。

### 简单请求与预检请求

浏览器把跨源请求分成两类：

**简单请求**（不预检，直接发送）需要同时满足：

- 方法是 `GET`、`HEAD` 或 `POST`；
- 只有「CORS 安全列表」里的请求头（`Accept`、`Accept-Language`、`Content-Language`、受限的 `Content-Type` 等）；
- `Content-Type` 只能是 `text/plain`、`multipart/form-data`、`application/x-www-form-urlencoded` 之一。

**其余都要先预检**：浏览器先发一个 `OPTIONS` 请求问服务器「我能不能发这样的请求？」，得到许可后才发真正的请求。

看看我们的「创建任务」：

```
POST /api/v1/projects/…/tasks
Content-Type: application/json   ← 不在简单列表里
X-CSRF-Token: …                  ← 自定义头
Idempotency-Key: …               ← 自定义头
X-Request-Id: …                  ← 自定义头
```

四个理由都会触发预检。`PATCH` 方法本身也会触发。所以**跨源部署时，我们的每一个写请求都会先有一个 OPTIONS**。

### 预检的完整对话

```
① 浏览器 → 服务器（预检）
OPTIONS /api/v1/projects/…/tasks
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type,idempotency-key,x-csrf-token,x-request-id

② 服务器 → 浏览器（许可）
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com      ← 必须是精确的源，不能是 *
Access-Control-Allow-Credentials: true                    ← 允许带 Cookie
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE
Access-Control-Allow-Headers: Content-Type, X-CSRF-Token, Idempotency-Key, If-Match, X-Request-Id
Access-Control-Max-Age: 600                               ← 10 分钟内同类请求不用再预检
Vary: Origin

③ 浏览器 → 服务器（真正的请求）
POST /api/v1/projects/…/tasks
Origin: https://app.example.com
Cookie: sid=…
…

④ 服务器 → 浏览器
HTTP/1.1 201 Created
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Access-Control-Expose-Headers: X-Request-Id, ETag, Location, …   ← 允许 JS 读取的响应头
```

三条硬性规则：

1. **带凭据时，`Access-Control-Allow-Origin` 不能是 `*`**，必须回显精确的源；
2. **必须有 `Access-Control-Allow-Credentials: true`**，否则浏览器丢弃响应；
3. **非安全列表的响应头，JS 默认读不到**。我们的前端需要读 `X-Request-Id`（错误上报）、`ETag`（并发控制）、`Retry-After`（重试）等，必须在 `Access-Control-Expose-Headers` 里列出。

### Fastify 里的 CORS 配置

**`apps/api/src/app.ts`**：

```ts
// 只有前后端「跨源」部署时才需要 CORS；同源代理部署时 webOrigins 为空即可
if (opts.config.webOrigins.length > 0) {
  await app.register(cors, {
    origin: opts.config.webOrigins, // 白名单数组，@fastify/cors 会精确回显匹配的源
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: [
      "Content-Type",
      "X-CSRF-Token",
      "Idempotency-Key",
      "If-Match",
      "X-Request-Id",
    ],
    exposedHeaders: [
      "X-Request-Id",
      "ETag",
      "Location",
      "Retry-After",
      "Idempotent-Replayed",
      "Deprecation",
      "Sunset",
      "Link",
    ],
    maxAge: 600,
  });
}
```

注意 `allowedHeaders` 和 `exposedHeaders` 都是**契约的一部分**：契约里新增了一个请求头或响应头，这里也要跟着改。这是 OpenAPI 描述不到、需要人工维护的少数地方之一，所以我们用测试把它固定下来（**`apps/api/test/api.test.ts`**）：

```ts
it("预检请求：白名单 Origin 得到精确回显 + allow-credentials", async () => {
  const res = await ctx.app.inject({
    method: "OPTIONS",
    url: `/api/v1/projects/${ctx.projectId}/tasks`,
    headers: {
      origin: WEB_ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers":
        "content-type,idempotency-key,x-csrf-token",
    },
  });
  expect(res.statusCode).toBe(204);
  expect(res.headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
  expect(res.headers["access-control-allow-credentials"]).toBe("true");
  expect(String(res.headers["access-control-allow-headers"])).toContain(
    "Idempotency-Key",
  );
});

it("预检请求：非白名单 Origin 拿不到 CORS 头", async () => {
  const res = await ctx.app.inject({
    method: "OPTIONS",
    url: `/api/v1/projects/${ctx.projectId}/tasks`,
    headers: {
      origin: "https://evil.example",
      "access-control-request-method": "POST",
    },
  });
  expect(res.headers["access-control-allow-origin"]).toBeUndefined();
});
```

> **千万不要**写 `origin: true`（回显任何请求的 Origin）配合 `credentials: true`。这等于告诉浏览器「任何网站都可以带着用户的 Cookie 读我的 API 响应」——包括用户的个人信息和 CSRF token。

---

## 8.5 CSRF：跨站请求伪造

### 攻击是怎么发生的

用户登录了 TaskFlow，然后在另一个标签页打开了一个恶意网站。恶意网站里有这样一段代码：

```html
<form
  action="https://app.example.com/api/v1/projects/xxx/tasks"
  method="POST"
  enctype="text/plain"
>
  <input name='{"title":"pwned","x":"' value='"}' />
</form>
<script>
  document.forms[0].submit();
</script>
```

浏览器会向 TaskFlow 发送这个 POST。如果会话 Cookie 被自动带上，服务端看到的就是「已登录用户的合法请求」。恶意网站读不到响应（同源策略），但**任务已经被创建了**。

> 在我们的 API 上，这个特定的表单还会被契约拦下：Fastify 内置了 `text/plain` 解析器，请求体会被解析成**字符串**，而 body schema 要求对象，结果是 400（`rule: "type"`）。但**不要把安全建立在「碰巧格式不对」上**：将来有人为了兼容某个客户端加上表单解析，或者某个写接口只用 path/query 参数，这道「隐形防线」就消失了。CSRF 防护必须是显式的。

### 多层防御

我们叠加了三层，任何一层都能独立挡住上面的攻击。

**第 1 层：`SameSite=Lax` Cookie。** 来自其他站点的 POST 请求不会携带 Cookie，服务端看到的是「未登录」，直接 401。

但它不是万能的：

- `SameSite` 看的是**站点**而不是源。`https://evil.example.com` 和 `https://app.example.com` 是同站的，如果某个子域名被攻破（或者是用户可以托管内容的子域名），SameSite 防不住；
- 有副作用的 GET 请求（不该存在，但旧代码里常有）在 Lax 下仍会带 Cookie；
- 旧浏览器或特殊配置下可能不生效。

**第 2 层：校验 `Origin` 头。** 浏览器在跨源请求和所有 POST 请求上都会带 `Origin`，而且**网页 JS 无法伪造它**。服务端只接受白名单或同源的 Origin。

**第 3 层：同步令牌（synchronizer token）+ 自定义请求头。** 会话创建时生成一个随机 `csrfToken`，存在服务端会话里，并通过 `GET /auth/session` 的响应体告诉前端。前端把它放进 `X-CSRF-Token` 请求头。

为什么这一层有效？

- 恶意网站**读不到**你的 API 响应（同源策略 + CORS 白名单），所以拿不到 `csrfToken`；
- 恶意网站**发不出**带自定义头的跨源请求而不触发预检，而预检会被 CORS 白名单拒绝；
- 普通 HTML 表单根本无法设置自定义请求头。

### 实现

**`apps/api/src/plugins/auth.ts`**（CSRF 部分）：

```ts
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * 认证 + CSRF 防护
 * 1. 读 HttpOnly 会话 Cookie → request.auth
 * 2. 写请求校验 Origin：只接受白名单或同源
 * 3. 已登录的写请求必须带 X-CSRF-Token，且与会话绑定的 token 一致
 */
export const authPlugin = fp(async function auth(
  app: FastifyInstance,
  opts: { db: Db; webOrigins: string[] },
) {
  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.auth = token ? await loadSession(opts.db, token) : null;

    if (!UNSAFE_METHODS.has(request.method)) return;

    const origin = request.headers.origin;
    if (origin) {
      const sameOrigin = origin === `${request.protocol}://${request.host}`;
      if (!sameOrigin && !opts.webOrigins.includes(origin)) {
        throw new AppError(403, "CSRF_REJECTED", "请求来源不被信任", {
          logContext: { origin },
        });
      }
    }

    if (request.auth) {
      const header = request.headers["x-csrf-token"];
      if (
        typeof header !== "string" ||
        !safeEqual(header, request.auth.csrfToken)
      ) {
        throw new AppError(403, "CSRF_REJECTED", "页面已过期，请刷新后重试", {
          logContext: { reason: header ? "mismatch" : "missing" },
        });
      }
    }
  });
});
```

几个细节：

- **只检查写方法**。GET/HEAD/OPTIONS 不应该有副作用（这是 HTTP 语义，也是我们的约定），所以不需要 CSRF 防护；
- **Origin 缺失时放行到第 3 层**。非浏览器客户端（curl、服务端调用）可能不带 Origin，它们没有 CSRF 问题（不会自动携带受害者的 Cookie）。但已登录的写请求仍然必须有正确的 CSRF token；
- **只在已登录时检查 token**。未登录的写请求（只有登录接口）没有会话可比对；登录接口的 CSRF（「登录 CSRF」，诱导用户登录到攻击者的账户）靠 Origin 校验和 SameSite 防御；
- **`timingSafeEqual`**：普通的 `===` 在第一个不同字符处就返回，理论上可以通过测量响应时间逐字符猜出 token。常量时间比较消除了这种侧信道；
- **错误码是 `CSRF_REJECTED`，不是 `FORBIDDEN`**。前端据此显示「页面已过期，请刷新」，而不是「你没有权限」——对用户来说，最常见的原因是会话换了但页面没刷新。

前端通过 api-client 中间件自动加上 token（第 4 章），业务代码完全无感：

```ts
onRequest({ request }) {
  if (UNSAFE_METHODS.has(request.method)) {
    const token = options.getCsrfToken();
    if (token) request.headers.set("x-csrf-token", token);
  }
  return request;
},
```

token 存在内存里（`apps/web/src/lib/api.ts` 的 `csrf` 对象），登录成功或读取会话时写入。它不是需要保密到「不能被 JS 读到」的东西——它的安全性来自「其他站点读不到」。

### 测试

```ts
it("已登录的写请求缺少 X-CSRF-Token → 403 CSRF_REJECTED", async () => {
  const res = await ctx.app.inject({
    method: "POST",
    url: `/api/v1/projects/${ctx.projectId}/tasks`,
    cookies: alice.cookies,
    headers: { "idempotency-key": randomUUID() },
    payload: { title: "csrf" },
  });
  expect(res.statusCode).toBe(403);
  expect(res.json().error.code).toBe("CSRF_REJECTED");
});

it("来自不受信任 Origin 的写请求 → 403", async () => {
  const res = await createTask(
    alice,
    { title: "evil" },
    { headers: { origin: "https://evil.example" } },
  );
  expect(res.statusCode).toBe(403);
  expect(res.json().error.code).toBe("CSRF_REJECTED");
});

it("会话 Cookie 是 HttpOnly + SameSite=Lax", () => {
  expect(alice.setCookie.httpOnly).toBe(true);
  expect(alice.setCookie.sameSite).toBe("Lax");
});
```

> 社区也有现成插件 `@fastify/csrf-protection`，实现的是「双提交 Cookie」或基于会话的令牌。原理与本节相同。自己实现的好处是每一行都看得懂，并且能和我们的会话表、错误 envelope 无缝结合。

### 在契约里声明

CSRF 头在 OpenAPI 里是一个安全方案（第 3 章）：

```ts
csrfHeader: {
  type: "apiKey",
  in: "header",
  name: "X-CSRF-Token",
  description: "写请求必须携带，值来自 GET /api/v1/auth/session 的 csrfToken",
},
```

写接口声明 `security: [{ cookieAuth: [], csrfHeader: [] }]`。这样任何读文档的人（包括移动端同学）都知道写请求需要这个头。

---

## 8.6 开发期：Vite 代理让一切变成同源

开发时前端在 `localhost:5173`，API 在 `localhost:3000`——**跨源**。如果直接请求，就要配 CORS、处理预检、调试 Cookie。

更简单的做法是让 Vite 开发服务器代理 `/api`：

```ts
// apps/web/vite.config.ts
server: {
  port: 5173,
  proxy: {
    "/api": { target: "http://127.0.0.1:3000" },
  },
},
```

```
浏览器 ──▶ http://localhost:5173/api/v1/... ──(Vite 转发)──▶ http://127.0.0.1:3000/api/v1/...
          同源！没有 CORS、没有预检
```

浏览器眼里只有一个源 `localhost:5173`。前端的 `baseUrl` 留空，请求 `/api/v1/...` 这种相对路径即可。

### 为什么 `changeOrigin` 要保持 `false`

很多 Vite 代理配置会写 `changeOrigin: true`，它会把转发请求的 `Host` 头改成目标地址（`127.0.0.1:3000`）。在我们的项目里这会出问题：

```
浏览器发出：Origin: http://localhost:5173    Host: localhost:5173
changeOrigin: true 后：Origin: http://localhost:5173    Host: 127.0.0.1:3000
服务端判断：http://localhost:5173 ≠ http://127.0.0.1:3000 → 不是同源 → 不在白名单 → 403 CSRF_REJECTED
```

保持默认的 `false`，`Host` 仍是 `localhost:5173`，服务端的 Origin 校验认为是同源请求，放行。这样 `.env` 里的 `WEB_ORIGINS` 留空即可——**开发环境根本不需要 CORS**。

编写本教程时，用 curl 模拟浏览器经过 Vite 代理完成了整个流程（登录 → 读项目 → 缺 CSRF 被拒 → 正常创建 → 幂等重放 → 恶意 Origin 被拒），结果全部符合预期：

```
--- login
HTTP/1.1 200 OK
set-cookie: sid=…; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax
--- create no csrf
{"error":{"code":"CSRF_REJECTED","message":"页面已过期，请刷新后重试","requestId":"…"}}
--- create ok
{"id":"5340db84-…","title":"端到端","status":"todo","dueDate":"2026-10-30","version":1,…} [201]
--- replay
HTTP/1.1 201 Created
idempotent-replayed: true
--- evil origin
{"error":{"code":"CSRF_REJECTED","message":"请求来源不被信任","requestId":"…"}}
```

> 代理目标写 `127.0.0.1` 而不是 `localhost`：新版 Node.js 可能把 `localhost` 解析为 IPv6 的 `::1`，而服务只监听了 IPv4，结果是 `ECONNREFUSED ::1:3000`。

---

## 8.7 生产期：三种部署方式

### 方式 A（推荐）：同源反向代理

前端静态文件和 API 挂在同一个域名下，由反向代理分流：

```
https://app.example.com/          → 静态文件（apps/web/dist）
https://app.example.com/api/*     → Fastify（127.0.0.1:3000）
```

Nginx 配置示例：

```nginx
server {
  listen 443 ssl;
  server_name app.example.com;

  root /srv/taskflow/web/dist;
  location / {
    try_files $uri /index.html;          # SPA 路由回退
  }

  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;                       # 保留原始 Host，Origin 校验才能判定同源
    proxy_set_header X-Forwarded-Proto $scheme;        # 告诉 Fastify 原始协议是 https
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

服务端配置：

```bash
WEB_ORIGINS=            # 同源，不需要 CORS
COOKIE_SECURE=true
TRUST_PROXY=true        # 信任代理传来的 X-Forwarded-* 头
```

**为什么要 `TRUST_PROXY=true`？** TLS 在 Nginx 终结，Nginx 到 Fastify 是普通 HTTP。不信任代理时，Fastify 看到的 `request.protocol` 是 `http`，于是：

```
Origin: https://app.example.com
Fastify 计算的自身源：http://app.example.com   ← 协议不对
→ 判定为跨源 → 403
```

开启 `trustProxy` 后，Fastify 从 `X-Forwarded-Proto` 读取协议，判定为同源。反过来，**如果 Fastify 直接暴露在公网，绝不能开启 `trustProxy`**——客户端可以伪造 `X-Forwarded-*` 头。

这种方式的优点：没有 CORS、没有预检（少一次往返）、Cookie 是第一方的，不受第三方 Cookie 限制影响。

### 方式 B：同站不同源

```
https://app.example.com  → 前端
https://api.example.com  → API
```

这是跨源但**同站**。需要：

- 服务端 `WEB_ORIGINS=https://app.example.com`（开启 CORS + credentials）；
- 前端构建时设置 `VITE_API_BASE_URL=https://api.example.com`；
- Cookie 设在 `api.example.com` 上（默认行为），`SameSite=Lax` 仍然有效，因为两者同站。

代价：每个写请求多一次预检（`maxAge` 能缓解）。

### 方式 C：完全不同的站点（不推荐）

```
https://taskflow-web.vercel.app  → 前端
https://taskflow-api.fly.dev     → API
```

API 的 Cookie 对前端来说是**第三方 Cookie**。要让它被发送，必须 `SameSite=None; Secure`——这放弃了第 1 层 CSRF 防护；而且主流浏览器正在持续收紧第三方 Cookie（Safari 早已默认阻止），这种部署随时可能失效。

如果必须这样部署，考虑：给两者配置同一个父域名的自定义域名（变成方式 B），或者在前端所在的平台上部署一个 BFF（Backend for Frontend）做同源转发（变成方式 A）。

|                    | A 同源代理 | B 同站跨源 | C 跨站       |
| ------------------ | ---------- | ---------- | ------------ |
| CORS               | 不需要     | 需要       | 需要         |
| 预检               | 无         | 写请求都有 | 写请求都有   |
| SameSite=Lax 有效  | ✅         | ✅         | ❌ 必须 None |
| 第三方 Cookie 限制 | 不受影响   | 不受影响   | **受影响**   |
| 推荐度             | ⭐⭐⭐     | ⭐⭐       | ⭐           |

---

## 8.8 排查清单：「Cookie 带不过去」怎么办

按顺序检查，打开浏览器开发者工具的 Network 和 Application 面板：

1. **登录响应里有 `Set-Cookie` 吗？** 没有 → 服务端问题；
2. **Cookie 被浏览器存下了吗？**（Application → Cookies）没有 → 看 Network 里 `Set-Cookie` 旁边的黄色警告：常见原因是 `Secure` Cookie 通过 HTTP 下发、`SameSite=None` 没有 `Secure`、`Domain` 不匹配；
3. **后续请求带上 Cookie 了吗？** 没有 → 检查 `credentials`（跨源必须 `include`）、`SameSite`（跨站请求在 Lax 下不带）、`Path`；
4. **跨源时有没有预检失败？** Network 里看 OPTIONS 请求：`Access-Control-Allow-Origin` 是否精确匹配、是否有 `Allow-Credentials: true`、`Allow-Headers` 是否包含你用的所有自定义头；
5. **响应到了但 JS 拿不到某个头？** → `Access-Control-Expose-Headers`；
6. **403 CSRF_REJECTED？** → 看服务端日志里的 `logContext`：`origin` 是什么、`reason` 是 `missing` 还是 `mismatch`；在代理后面时检查 `trustProxy` 和 `Host` 头。

---

## 8.9 常见坑

| 现象                                                                                                                                           | 原因                                                               | 解决                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| 浏览器报 `The value of the 'Access-Control-Allow-Origin' header must not be the wildcard '*' when the request's credentials mode is 'include'` | 带凭据却用了 `*`                                                   | 白名单精确回显                                     |
| 预检失败：`Request header field x-csrf-token is not allowed`                                                                                   | `allowedHeaders` 漏了                                              | 补上，并加测试                                     |
| 前端读 `response.headers.get("etag")` 是 `null`                                                                                                | 跨源响应头没暴露                                                   | `exposedHeaders`                                   |
| 开发环境所有写请求 403                                                                                                                         | Vite 代理开了 `changeOrigin: true`                                 | 保持 `false`                                       |
| 生产环境所有写请求 403                                                                                                                         | 在代理后面没开 `trustProxy` / 代理没传 `Host`                      | `TRUST_PROXY=true` + `proxy_set_header Host $host` |
| 本地 http 下 Cookie 存不进去                                                                                                                   | `Secure` Cookie 不能通过 HTTP 设置（`localhost` 在部分浏览器例外） | 开发环境 `COOKIE_SECURE=false`                     |
| 以为配了 CORS 就防住了 CSRF                                                                                                                    | CORS 只限制读，不限制发                                            | SameSite + Origin + CSRF token                     |
| `origin: true` + `credentials: true`                                                                                                           | 任何站点都能带 Cookie 读你的 API                                   | 永远用白名单                                       |

---

## 8.10 本章验收清单

- [ ] 能区分「源」与「站点」，并说出 CORS 和 SameSite 分别看哪一个；
- [ ] 能解释会话 Cookie 每个属性（HttpOnly、Secure、SameSite、Path、Max-Age）的作用，以及为什么不用 localStorage 存 token；
- [ ] 能说出 `credentials` 三个取值的区别；
- [ ] 能判断一个请求是否会触发预检，并写出预检的请求/响应头；
- [ ] 知道带凭据的 CORS 三条硬性规则，以及 `exposedHeaders` 的作用；
- [ ] 能解释「CORS 防不住 CSRF」，并实现 SameSite + Origin 校验 + CSRF token 三层防护；
- [ ] 开发期用 Vite 代理实现同源，知道为什么 `changeOrigin` 要保持 `false`；
- [ ] 能比较三种生产部署方式，知道同源反向代理下为什么需要 `trustProxy`。

---

上一章：[← 第 7 章：取消请求与网络重试](./07-cancellation-and-retry.md) ｜ 下一章：[第 9 章：创建任务（上）：服务端链路 →](./09-create-task-backend.md)
