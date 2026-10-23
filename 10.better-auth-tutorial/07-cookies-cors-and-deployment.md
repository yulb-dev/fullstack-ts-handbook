# 第 7 章：Cookie、CORS 与部署地址一起设计

[上一章](./06-session-lifecycle-and-revocation.md) · [目录](./README.md) · [下一章](./08-csrf-and-business-api.md)

很多“登录成功却立即退出”的问题不是密码验证错误，而是 Cookie 没有被浏览器存下或发出。本章不靠反复改参数碰运气，而是从浏览器的规则推导部署配置。

## 7.1 Origin 和 Site 不是同一个词

Origin 由协议、主机、端口组成：

```text
http://localhost:5173 与 http://localhost:4000：不同 origin
https://app.example.com 与 https://api.example.com：不同 origin
```

Site 主要基于 scheme 和可注册域名判断（schemeful same-site），端口不决定 site：

```text
https://app.example.com 与 https://api.example.com：通常 same-site
https://app.example.com 与 https://api.other.net：cross-site
http://app.example.com 与 https://api.example.com：scheme 不同，不应视为同站部署
```

CORS 关心 origin；SameSite Cookie 关心 site。不同 origin 的请求可能仍然是 same-site，不能因为“跨域”就一律把 SameSite 改 None。

## 7.2 逐个理解 Cookie 属性

| 属性                  | 作用                                     | 它不能解决的事               |
| --------------------- | ---------------------------------------- | ---------------------------- |
| `HttpOnly`            | 阻止页面 JS 直接读取该 Cookie            | XSS 仍可代用户发请求         |
| `Secure`              | 只在安全传输场景发送                     | 不等于 Cookie 值一定加密     |
| `SameSite=Lax`        | 限制大部分跨站携带，允许部分顶层安全导航 | 同站恶意子域、所有 CSRF 风险 |
| `Domain`              | 扩大 Cookie 匹配主机范围                 | 不能共享到无关域名           |
| `Path`                | 限制请求路径匹配                         | 不是可靠的权限隔离墙         |
| `Max-Age` / `Expires` | 浏览器保存期限                           | 不覆盖服务器撤销与到期判断   |

本文业务 API 不只在 `/api/auth` 下，因此保持 `Path=/`。如果只把会话 Cookie 限制到 `/api/auth`，它不会发到 `/api/workspaces`，业务接口便无法识别身份。

主 `session_token` 是不透明、签名的标识；不要把“Secure”理解成“内部所有 Cookie payload 都加密”。官方 cookie cache 有可读的签名格式，也有加密格式。

## 7.3 起步配置：本地双端口

```ts
trustedOrigins: ["http://localhost:5173"],
advanced: {
  useSecureCookies: false, // 本地 HTTP，仅限开发。
  defaultCookieAttributes: {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  },
}
```

生产必须 HTTPS 并使用 Secure Cookie，配套工程按环境切换并在 env 校验中拒绝生产 HTTP。

localhost Cookie 不按端口隔离。这是为什么本机不同端口的两个实验项目可能互相干扰；必要时使用不同 cookiePrefix 或隔离浏览器 profile。不要给 localhost 随意配置生产父域 Domain。

## 7.4 推荐的生产起点：同 origin 代理

部署结构：

```text
浏览器访问 https://app.example.com
页面             → 前端静态文件
/api/auth/*      → 同 origin 的反向代理 → Fastify
/api/workspaces* → 同 origin 的反向代理 → Fastify
```

此时配置：

```dotenv
BETTER_AUTH_URL=https://app.example.com
WEB_ORIGIN=https://app.example.com
NODE_ENV=production
MAIL_MODE=resend
```

客户端使用相对 `/api/...`，Better Auth client 可以按同 origin 配置。配套前端的 `API` 常量需要改为公开 origin 或同 origin 方案，不能把 localhost 地址带进发布包。

一个 Nginx 配置片段，用于理解代理应保留什么：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host app.example.com;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
}
```

没有在 `proxy_pass` 后加路径重写，保留原 `/api/...` 路径。代理应传递请求 Cookie 与每条响应 Set-Cookie，不把登录或个人响应缓存，也不改写错误的公共 URL 来“修复”配置。

这个片段不是完整生产 Nginx 配置：TLS、静态文件、访问日志脱敏、速率与网络限制还需配置。Fastify origin 服务不能被外界绕过代理直接访问。

## 7.5 同站不同子域：app 与 api

部署结构：

```text
页面：https://app.example.com
API：https://api.example.com
```

保持：

```text
Better Auth baseURL = https://api.example.com
trustedOrigins      = https://app.example.com
Fastify CORS origin = https://app.example.com
CORS credentials    = true
浏览器 fetch         = credentials: include
Cookie Secure       = true
Cookie SameSite     = Lax
```

**仅由页面向 api.example.com 发请求时，API 的 host-only Cookie 通常就够了。** Cookie 会发送到 API 主机，页面 JS 不需要读取它。不同子域 same-site 不意味着一定要把 Domain 扩到根域。

只有多个受控子域上的服务确实需要同一 Cookie 时，再评估：

```ts
advanced: {
  crossSubDomainCookies: { enabled: true, domain: "example.com" },
}
```

同时精确列出可信 origins。Domain 的扩大不是 CORS 的替代方案：Cookie 范围、跨 origin 读响应资格、认证 trusted origins 仍是三组规则。

把 Domain 放到 example.com 后，相关 Cookie 会匹配所有子域。一个废弃子域被接管、用户自定义内容子域存在 XSS，都可能扩大风险。不能选择“只共享给两个兄弟域”的任意列表；Domain 匹配有其规则。不可信内容优先放到不同可注册域名。

## 7.6 真正跨站：不要把 None 当万能修复

部署结构：

```text
页面：https://my-app.net
API：https://auth-service.org
```

浏览器把 API Cookie 当第三方 Cookie。`SameSite=None; Secure` 在允许第三方 Cookie 的场景中是必要条件之一，但不是充分条件。

Safari ITP、用户隐私设置以及浏览器第三方 Cookie 策略可能直接阻止保存或发送。`credentials: include`、正确 CORS、trustedOrigins 全部配好，也可能仍失败。

Better Auth 官方推荐使用同 origin 反向代理或共同父域部署。本文的自有业务 CSRF 策略还明确拒绝 `Sec-Fetch-Site: cross-site`，因此不支持直接跨站业务请求。改成跨站不是只改一个 Cookie 属性，而是改变威胁模型与浏览器兼容方案。

不要通过关闭 CSRF/origin checks、强迫用户关闭隐私保护或把 token 随便塞 localStorage 来“解决”。先改部署拓扑，再验证完整协议。

## 7.7 trustedOrigins 不是“所有可访问的服务器”

Better Auth 默认信任配置的 base URL；`trustedOrigins` 用于明确扩展可信页面/回调来源。

生产尽量使用精确 HTTPS origins。不要保留 localhost 或使用 `https://*.example.com`，除非你确认所有匹配子域都可信且持续管理。

尤其不能写：

```ts
trustedOrigins: async (request) => [request!.headers.get("origin")!];
```

这相当于攻击者说自己可信，你就相信。动态白名单应该来自你的受控域名注册数据，并有严格验证与生命周期管理。

## 7.8 HTTPS 代理与 Cookie 前缀

Fastify 内部可能监听 HTTP，但用户经过 HTTPS 代理访问。静态 `baseURL` 应使用 **公开 HTTPS origin**，生产显式 `useSecureCookies: true`。

Better Auth 的 Cookie 名称可能带安全前缀，因此不要在业务代码里硬编码某个 Cookie 名然后自己读它。交给 `getSession` 即可。改变 cookiePrefix 或域名后，旧 Cookie 可能仍存在，要制定清理/重新登录策略。

不要为省配置开启 `trustedProxyHeaders: true` 后又让用户直接连接源站。Host/Proto 被伪造时，邮件与回调可能指向攻击者控制的地址。本文单一公开域名使用静态 baseURL，不依赖来访请求推断。

## 7.9 用四步法排查“登录后 401”

1. **服务器有没有发 Set-Cookie？** 没发则检查认证结果与 handler 响应转发。
2. **浏览器有没有存？** 没存则读 DevTools 拒绝原因：Secure、SameSite、Domain、第三方限制等。
3. **下一条请求有没有带？** 没带则检查请求目标、credentials、Path、过期与 site。
4. **带了为什么拒绝？** 检查签名密钥、数据库到期/撤销、连接数据库、多个实例配置。

另检查 CORS：预检失败时实际请求可能根本没发；CORS 读响应失败与服务器返回 401 不是同一情况。

每次只改有证据的一层。不要一次把 Domain、None、CORS、trustedOrigins 全放宽，然后仅因浏览器终于显示用户名就宣布安全。

## 7.10 练习与验收

练习：你只有 app.example.com 页面与 api.example.com API，为什么不必为了 JS 调 API 就设置根域 Cookie？

参考：凭据需要发送给 API 主机，页面不需要读 Cookie。host-only 缩小范围；SameSite 与 credentials 控制实际发送，CORS 控制读取响应。

- [ ] 能区分 origin 与 site，理解双端口本地开发。
- [ ] 能逐项解释 HttpOnly、Secure、SameSite、Domain、Path。
- [ ] 会为三类部署拓扑选择配置，不把 None 当通用答案。
- [ ] 知道同站恶意子域与第三方 Cookie 限制的风险。
- [ ] 能按“发出 → 保存 → 发送 → 验证”定位登录故障。

官方阅读：[Cookies](https://better-auth.com/docs/concepts/cookies)、[Fastify Integration](https://better-auth.com/docs/integrations/fastify)、[Security](https://better-auth.com/docs/reference/security)。浏览器规则补充：[MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)、[MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)。
