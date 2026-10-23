# 第 8 章：CSRF 的攻击链，以及自有业务 API 的防线

[上一章](./07-cookies-cors-and-deployment.md) · [目录](./README.md) · [下一章](./09-email-verification-and-password-reset.md)

“Cookie 自动发送”让登录方便，也带来一个问题：攻击者能不能诱导浏览器替用户发送请求？本章把 CSRF 与 CORS、XSS、授权区分开，再给 Harbor 的写 API 加明确防护。

## 8.1 从一条攻击请求开始理解

Alice 已登录 Harbor，随后打开攻击者的页面。攻击页面尝试提交一个请求，让服务器修改 Alice 的任务。

攻击者不一定需要读 Cookie。只要浏览器在该请求场景下自动带上 Cookie，而服务器接受变更，就可能替 Alice 执行动作。

这叫 Cross-Site Request Forgery：伪造的是用户授权的请求意图，不是凭证本身。攻击者可能读不到响应，但数据已经改变。

与另外两种问题区分：

- **XSS**：攻击代码在可信页面 origin 内执行，可直接使用同源能力；CSRF 防护不能消除它。
- **IDOR / 越权**：来访者有自己的有效登录，却访问别人的资源；需业务资源/租户授权。
- **会话盗取**：攻击者已获得可用凭证，可以像持有人一样发请求；需撤销、凭证恢复与事件处理。

不同问题的措施不能互相替代。

## 8.2 为什么仅配 CORS 不够

浏览器的 CORS 决定网页能否读跨 origin 响应，并对一些请求做预检。部分“简单请求”不需要预检就能发出。

例如传统表单能提交 URL-encoded body。攻击者不需要拿到 JSON 响应，只要让服务器执行变更。

因此，不允许 evil.example 读取响应不等于服务器没有执行来自它的请求。我们要检查的是 **写请求被服务端拒绝，且数据没有改变**，不是控制台出现了 CORS error。

JSON Content-Type 常会触发预检，能构成一层防护，但它也不是授权：非浏览器客户端能自填 headers，持有被盗 Cookie 的攻击者不受网页 CORS 的约束。

## 8.3 Better Auth 推荐的组合

当前官方安全文档描述了多层保护：

1. 状态变更通常使用非简单请求，例如 JSON。
2. 检查 Origin / Referer 是否可信。
3. 默认 SameSite=Lax Cookie。
4. 在初次登录/注册表单等场景使用 Fetch Metadata。
5. OAuth 等 GET 回调使用协议 state、nonce、PKCE 等额外关联验证。

一些协议或渐进增强端点确实接受表单编码，因此不能简化成“Better Auth 所有 POST 都只能 JSON”。本教程自己的 Fastify 桥接只实现 JSON 客户端和 GET 回调，未来启用新编码要专门测试。

初次登录 CSRF 也值得理解：攻击者可能让受害者登录到攻击者的账号，使受害者往那个账号填写数据。此时尚无 Cookie，仍要检查请求来源和跨站导航证据，不能说“没登录就没有 CSRF”。

## 8.4 不要通过关闭检查修复地址错误

本文保留并显式开启：

```ts
advanced: {
  disableOriginCheck: false,
  disableCSRFCheck: false,
}
```

官方文档区分：`disableCSRFCheck` 会关闭 CSRF 保护；`disableOriginCheck` 会关闭回调 URL 等验证，兼容行为还可能影响 CSRF。不要靠关闭它们解决 trustedOrigins 拼错或代理配置问题。

对回调参数也不能简单检查“字符串以 https://example.com 开头”：`https://example.com.evil.net` 不是你的域名。让 Better Auth 按推荐规则验证，业务自有跳转也使用解析后的 URL 与精确白名单。

## 8.5 安全测试里的一个真实陷阱

本教程运行 Better Auth 1.7.12 的测试时发现：默认测试环境会把 origin check 置为跳过。原因可在安装包 `context/create-context` 中看到类似逻辑：未显式设置 `disableOriginCheck` 时，`isTest()` 会选择跳过。

结果是：用 Vitest 发送恶意 Origin，期待 403，却可能得到 200；你也可能因此错误判断框架没有防护。

我们在 **最终认证配置** 中显式设置两个 false，不仅测试专门改配置。然后真实 HTTP 测试可以验证恶意 Origin 与非法 callbackURL 确实 403。

测试默认便捷行为不能当成生产安全语义。类似地，内置限流开发默认关闭，我们也显式开启。发现测试与真实安全设置不同，应找机制证据，而不是把预期改成 200。

## 8.6 Better Auth 防护不会自动套到 task API

认证 catch-all 进入 Better Auth handler，能使用它的安全链。自有 `/api/workspaces/.../tasks` 不会经过那条 handler。

在自有路由中调用 `auth.api.getSession` 只解决身份验证；它并不等价于让该 task mutation 自动获得认证端点的 CSRF 检查。

因此 Harbor 为业务写请求建立自己的策略：

```text
仅支持受控浏览器客户端
可信 Origin 必须精确等于 WEB_ORIGIN
拒绝 Fetch Metadata 明示的 cross-site
写请求必须 Content-Type: application/json
GET/HEAD 不承担业务写操作
每条请求仍验证会话、成员、角色与资源归属
```

这个策略明确支持同 origin 或同站双 origin，不支持直接跨站架构，也不支持不带 Origin 的 Cookie-based 原生客户端。以后新增客户端要设计独立协议，不是放开当前规则。

## 8.7 用 Fastify hook 实现

在 [app.ts](./example/src/app.ts) 中：

```ts
app.addHook("preHandler", async (request) => {
  const path = request.url.split("?")[0]!;
  if (
    path.startsWith("/api/auth/") ||
    ["GET", "HEAD", "OPTIONS"].includes(request.method)
  )
    return;

  if (request.headers.origin !== env.WEB_ORIGIN) {
    throw new HttpError(403, "UNTRUSTED_ORIGIN");
  }
  if (request.headers["sec-fetch-site"] === "cross-site") {
    throw new HttpError(403, "CROSS_SITE_REQUEST");
  }
  const contentType = request.headers["content-type"]
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(415, "JSON_REQUIRED");
  }
});
```

为什么跳过 auth 路径？让 Better Auth 执行它自身针对不同协议的防护，不在外围硬套业务写策略破坏 OAuth/邮箱回调。

为什么 GET 跳过？我们保证 GET 业务接口只读。不能因此新增 `GET /delete-task`，那会完全绕过这里的写防护。认证 GET 回调的协议变更则由 Better Auth 自己保护。

为什么缺失 Origin 也拒绝？这个业务 API 定义为浏览器 Cookie 客户端入口，默认拒绝比推断不明请求可信更清楚。若需要原生客户端、服务器间调用或某种 `Origin: null` 行为，要单独制定可验证策略，不能把“不知道”当成安全。

`Sec-Fetch-Site` 在旧客户端可能缺失，所以仍有精确 Origin + JSON 防线；同站恶意兄弟子域的请求即使标为 same-site，也会因 Origin 不匹配被拒绝。

## 8.8 让 DELETE 也使用同一策略

本文 DELETE 客户端发送：

```ts
await fetch(taskURL, {
  method: "DELETE",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
```

看起来 body 不提供业务数据，却让接口遵守明确的 JSON 写协议。不是所有 API 都必须这样设计；这是本教程刻意选择的一致规则。

不要在一个接口拒绝缺 Origin，另一个“为方便调试”允许缺 Origin，而没有声明边界。浏览器与非浏览器协议混用，是认证系统里常见的漏洞来源。

## 8.9 准备三种失败测试

在独立测试环境、保留有效学习账号 Cookie，发：

1. `Origin: https://evil.example` + 合法 JSON。
2. 缺失 Origin + 合法 JSON。
3. 正确 Origin + `Sec-Fetch-Site: cross-site`。

都应 403。再用正确 Origin + JSON + same-site 访问，才应进入身份与业务授权。

顺序会影响状态码：非法来源可能在身份验证前 403，不能要求所有无 Cookie 请求必定 401。未登录验收要给合法协议 headers，再验证会话拒绝。

同时检查数据库：任务 done 没改、成员没新增。拒绝测试的价值在于没有副作用，不只状态码漂亮。

## 8.10 它与 CSRF token 的关系

不是所有 Cookie 应用都可以只用本文策略。例如必须接受传统表单的自有业务入口、复杂嵌入/跨站客户端，需要按框架和威胁模型采用 synchronizer token、正确签名绑定的 double-submit 等成熟方案。

不要凭空生成一个随机请求头后就叫它 CSRF token：它需要绑定和验证规则。Better Auth 自己的认证端点应优先保留官方推荐配置，而不是另造一套覆盖它的 token 协议。

也不要误以为 CSRF token 可以给 task 决定成员角色。CSRF 验证请求意图来源；Authorization 验证动作权限，它们仍是两层。

## 8.11 练习与验收

练习：Alice 是 red 的 viewer，从可信页面发合法 JSON 修改自己的 task。CSRF 检查应通过吗？授权应通过吗？

参考：请求来源合法，CSRF 层可通过；viewer 无写权限，业务层仍必须 403。反过来，owner 从恶意 origin 发请求，也不能因身份有权就绕过来源防护。

- [ ] 能解释攻击者不读取响应也能造成 CSRF 副作用。
- [ ] 知道 CORS、SameSite、Origin 与授权的不同职责。
- [ ] 自有写 API 具备独立、明确的 CSRF 策略。
- [ ] 未通过关闭检查修复地址问题。
- [ ] 安全测试使用实际开启的 origin/CSRF 配置。

官方阅读：[Security](https://better-auth.com/docs/reference/security)、[Cookies](https://better-auth.com/docs/concepts/cookies)、[Fastify Integration](https://better-auth.com/docs/integrations/fastify)。补充：[MDN CSRF](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/CSRF)。本章业务 hook 是 Harbor 选定威胁模型下的实现，不是 Better Auth 自动安装的全局中间件。
