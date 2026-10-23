# 第 9 章：邮箱验证与重置密码，必须真正走完邮件和回调

[上一章](./08-csrf-and-business-api.md) · [目录](./README.md) · [下一章](./10-oauth-and-account-linking.md)

“配置 `requireEmailVerification: true`”不是“用户能够完成验证”。你还要把邮件送到用户手上、让链接指向正确公开地址、提供回到产品的页面，并处理失败。本章把身份恢复的完整链路做出来。

## 9.1 邮箱验证证明什么

验证邮箱主要证明用户在验证时能够访问那个邮箱。它不是政府身份认证，也不是 workspace 邀请，更不是获得管理员角色。

为什么 Harbor 要求验证？如果账号与邮件恢复能力关联，未经验证的邮箱不能被随意当作稳定联系与恢复地址。验证也帮助减少垃圾注册，但单靠它不能阻止所有滥用。

我们选定：注册发送验证邮件，未验证密码登录拒绝；验证后仍需要主动登录。不使用“邮箱后缀相同就自动加入公司 workspace”。

## 9.2 完整服务端配置

[auth-options.ts](./example/src/auth-options.ts) 中：

```ts
emailAndPassword: {
  enabled: true,
  autoSignIn: false,
  requireEmailVerification: true,
  minPasswordLength: 12,
  maxPasswordLength: 128,
  revokeSessionsOnPasswordReset: true,
  sendResetPassword: async ({ user, url }) => {
    dispatchMail(send, {
      to: user.email,
      subject: "重置 Harbor 密码",
      text: url,
    });
  },
},
emailVerification: {
  sendOnSignUp: true,
  sendOnSignIn: true,
  autoSignInAfterVerification: false,
  expiresIn: 60 * 60,
  sendVerificationEmail: async ({ user, url }) => {
    dispatchMail(send, {
      to: user.email,
      subject: "验证 Harbor 邮箱",
      text: url,
    });
  },
},
```

本文用 Better Auth 提供的 `url`，不自造 token 协议。它已经携带相应流程需要的信息。

`sendOnSignUp` 与 `sendOnSignIn` 控制何时触发发送；不是每条普通 API 都发邮件。连续发送还要限流，避免把验证功能变成骚扰邮件工具。

官方不同登录方式的验证设置有边界：邮箱密码的 `requireEmailVerification` 不会自动限制全部 OAuth 登录。第 10 章使用 provider 级设置并在业务身份入口再次检查 emailVerified。

## 9.3 本地交付与真实交付分开

[mail.ts](./example/src/mail.ts) 提供两种实现。

本地模式：

```ts
if (env.MAIL_MODE === "local") {
  if (env.NODE_ENV === "production") throw new Error("禁止在生产打印认证邮件");
  return async (message) => {
    console.info("[仅限本地的邮件预览]", message);
  };
}
```

这是明确的开发工具，打印的链接含敏感流程凭证。只在本地测试账号使用，不将终端输出上传到公共日志。

真实模式使用 Resend HTTP API：

```ts
const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${env.RESEND_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ from: env.MAIL_FROM, ...message }),
  signal: AbortSignal.timeout(10_000),
});
if (!response.ok) throw new Error(`邮件服务拒绝交付：${response.status}`);
```

不需要为了说明认证流程强制使用特定邮件平台，换供应商只替换这个交付边界。本文选择一个官方邮件页面列出的提供方，使接口真实、可配置，不用虚构 `sendEmail()` 假装完成。

## 9.4 切换到真实邮件前要完成的操作

1. 在所选提供方创建账号与受限 API key。
2. 验证你控制的发件域名，按平台要求配置 DNS，例如 SPF/DKIM；按业务策略配置 DMARC。
3. 设置允许发送的真实 From，不使用未经授权的品牌地址。
4. 配置 `MAIL_MODE=resend`、`RESEND_API_KEY`、`MAIL_FROM`。
5. 在预发布环境把 `BETTER_AUTH_URL` 与 `WEB_ORIGIN` 改为可访问的 HTTPS 地址。
6. 用真实测试邮箱从注册开始，确认收到链接、打开、验证、返回页面、登录。
7. 检查投递失败、退信与投诉事件，设置告警与重发策略。

API 200 通常只说明提供方接受了请求，不证明已进入用户收件箱。域名、垃圾邮件、退信、延迟、用户输错地址都可能影响最后交付。

本教程不会帮你创建供应商账号或发送真实邮件；代码入口是真实的，但实际账号配置与投递需要你在目标环境完成。

## 9.5 为什么官方示例不 await 邮件发送

存在邮箱时等待 SMTP/提供方，不存在时立即返回，可能暴露不同耗时。官方建议避免在认证响应中等待邮件网络交付，并在 Serverless 使用 `waitUntil` 等确保任务被运行。

教学实现：

```ts
export function dispatchMail(send: Mailer, message: Mail): void {
  void send(message).catch(() => {
    console.error("认证邮件交付失败；不记录正文或 token");
  });
}
```

它捕获了 Promise 失败，但 **不是可靠队列**：进程崩溃、滚动重启或 Serverless 提前冻结，都可能丢失发送。

生产可以使用持久化队列与 worker：认证回调快速提交邮件任务，worker 做有限重试与退信处理。入队本身也可能失败，不应悄悄吞掉；要有告警、用户可请求重发、避免无限重试。队列内容含认证链接，应加访问控制、加密/保留期管理，不能把 token 当普通追踪字段。

认证数据库事务与外部邮件服务不是一个数据库事务。不要假设“注册回滚就一定撤回了已经发送的邮件”。按提交边界、任务幂等和可恢复流程设计。

## 9.6 忘记密码的第一步：只请求恢复邮件

```ts
const result = await authClient.requestPasswordReset({
  email,
  redirectTo: "http://localhost:5173",
});
```

页面无论邮箱是否存在，都显示相同产品提示，例如“如果账号存在且支持密码登录，将收到重置邮件”。不要自建 `/email-exists` 让用户先查账号存在性，那会破坏反枚举目标。

客户端提供的 `redirectTo` 是重置表单页面。Better Auth 生成的邮件链接先进入认证服务处理，再跳转到这个页面，带上 token 或错误参数。回调地址必须通过 trustedOrigins 验证。

链接 URL 不应该来自 HTTP Host 的任意值，也不要让攻击者自由传入外部恢复页。本文静态公开 baseURL 与精确可信页面一起控制两段地址。

## 9.7 第二步：真正提交新密码

用户打开邮件后，页面读取 token：

```ts
const token = new URL(window.location.href).searchParams.get("token");
if (!token) throw new Error("请打开邮件中的有效重置链接");

const result = await authClient.resetPassword({ token, newPassword });
if (result.error) throw new Error("链接已失效或密码不符合要求");

history.replaceState(null, "", location.pathname);
```

token 是短期恢复凭证，不需要已有 session。拿到 token 的人可能修改密码，所以要像临时密钥一样对待。

重置页需要：

- 不加载不必要的第三方分析与脚本。
- 设置合适 Referrer-Policy，本文页面使用 `no-referrer`。
- 不把完整 URL/token 写到日志或埋点。
- 成功后清理地址栏 token，清理私有 UI 数据并要求重新登录。
- 失败时不自行改数据库、不绕过到期检查。

注意 token **可能在 URL 路径里，不只 query**。只过滤 query 的 access logger 不足够；配套 API 把认证路径整体掩码，生产代理与前端日志也要同步处理。

## 9.8 密码重置的原子边界

本文配置 `revokeSessionsOnPasswordReset: true` 与 Drizzle adapter `transaction: true`，没有 secondary storage。

在数据库持久化的重置流程中，消费恢复 token、撤销会话、保存新密码在同一事务中。若事务失败，不能留下一半恢复状态。官方也说明新密码校验应在消费 token 前完成，以免不合格密码浪费链接。

两类额外情况需要谨慎：

1. 未启用 adapter 事务：token 可能已消费、会话已撤销，后续密码更新却失败。
2. 使用 secondary storage：数据库提交后清理缓存失败，旧会话可能仍在缓存中有效到到期。

`onPasswordReset` 是后续副作用回调；它报错时密码变更可能已经生效。不要因为 HTTP 出错就断定旧密码仍有效，必须检查实际状态。

## 9.9 可运行的恢复验收

本地使用两个会话 A、B：

1. A、B 都能请求 `/api/me`。
2. 请求重置邮件并打开完整链接。
3. 提交新密码成功。
4. 旧密码不能再登录，新密码可以登录。
5. A、B 的旧 Cookie 即使重放也得到 401。
6. 用同一个恢复 token 再提交，必须失败。
7. 对无效、过期 token，不能更新密码。

配套测试自动检查其中密码重置、旧密码、旧会话与已用 token 的拒绝。真正的到期等待、邮件提供方与浏览器重定向还需要目标环境验收，不能把测试收集器里的邮件当真实收件证明。

## 9.10 练习与验收

练习：用户收到了验证邮件，但是链接指向 `http://localhost:4000`，为什么不能在发邮件函数里只把 localhost 替换掉？

参考：根因是公开 baseURL 配错，它也影响 OAuth 与其他回调。字符串替换不修复签名、trustedOrigins、路径、Cookie 与部署边界，应该修正配置并重新生成有效邮件流程。

- [ ] 真实发送函数与本地预览明确隔离。
- [ ] 理解验证邮箱不是授权加入 workspace。
- [ ] 完成重置的“请求 → 邮件 → 回调页面 → 新密码提交”。
- [ ] 密码重置会撤销旧会话，并验证旧 token 不可复用。
- [ ] 明白后台 Promise 不等于持久化邮件队列。

官方阅读：[Email](https://better-auth.com/docs/concepts/email)、[Email & Password](https://better-auth.com/docs/authentication/email-password)、[API](https://better-auth.com/docs/concepts/api)、[Security](https://better-auth.com/docs/reference/security)。邮件平台依据：[Resend Send Email](https://resend.com/docs/api-reference/emails/send-email)。
