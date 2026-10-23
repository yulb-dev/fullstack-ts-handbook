# 第 10 章：按需求加入 GitHub 登录，分清身份、账户与外部权限

[上一章](./09-email-verification-and-password-reset.md) · [目录](./README.md) · [下一章](./11-passwords-rate-limits-and-security-events.md)

邮箱密码已经能走通。产品希望降低首次注册成本，于是加“使用 GitHub 登录”。本章不只加一个按钮，而是理解重定向协议、回调地址、邮箱验证、账户合并和外部 token 的安全边界。

## 10.1 OAuth 原本是授权协议，为什么能用于登录

OAuth 让一个服务在用户同意后访问另一服务的指定资源。OAuth access token 的权限由提供方 scopes 定义，例如读取 GitHub 用户资料。

登录产品时，Better Auth 在受保护的 OAuth 流程完成后取得提供方身份资料，映射为本地 User；OIDC 还专门定义身份认证层。不要把“外部提供方允许读取用户资料”解释成“用户已经能管理 Harbor 的全部任务”。

这里有三层不同结论：

```text
GitHub access token：允许向 GitHub 请求某些数据
Harbor session：证明本次 Harbor 请求的本地用户身份
Harbor membership：决定某 workspace 内的动作权限
```

GitHub 管理员、某个 GitHub organization 成员，也不自动是 Harbor workspace admin。

## 10.2 先配置提供方应用

在 GitHub Developer Settings 创建适合的 OAuth App。配置本地 URL：

```text
Homepage URL:
http://localhost:5173

Authorization callback URL:
http://localhost:4000/api/auth/callback/github
```

生产使用实际公开认证 origin，例如：

```text
https://api.example.com/api/auth/callback/github
```

同 origin 代理部署则为：

```text
https://app.example.com/api/auth/callback/github
```

回调是提供方将授权结果交给 **Better Auth 后端** 的入口，不是 React 页面 `/dashboard`。

拿到真实 Client ID 与 Client Secret，填进后端 `.env`。本文两个变量必须成对存在才启用 provider，不使用 `as string` 把空配置假装成有效值。

不要让生产应用注册 localhost 回调，也不要把生产 secret 给开发浏览器。实际提供方对多个回调的支持不同，通常需要分离开发/生产应用。

## 10.3 可选启用的服务端配置

[auth-options.ts](./example/src/auth-options.ts) 按是否有凭证加入：

```ts
socialProviders: {
  github: {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    requireEmailVerification: true,
  },
}
```

缺少配置时不要向用户展示“已经可以用”的登录方式。配套学习页保留按钮并标记需配置；生产 UI 应按公开能力列表决定展示，而不是泄露 secret 给前端判断。

本教程已有账户表可容纳 GitHub 基本字段；只加内建 provider 通常不新增一组 task 权限表。仍要执行 schema generation/diff 检查，不能凭“通常”免审升级。

GitHub OAuth App 与 GitHub App 不是同一对象。官方要求确保 email 能力：OAuth scope 涉及 `user:email`；GitHub App 需要“Email addresses: Read-only”账户权限。提供方私有邮箱与缺权限会导致 `email_not_found`，不能拿虚构邮箱绕过身份要求。

## 10.4 发起登录与最终页面回调

客户端：

```ts
const result = await authClient.signIn.social({
  provider: "github",
  callbackURL: "http://localhost:5173",
  errorCallbackURL: "http://localhost:5173",
});
if (result.error) {
  // 发起失败，与提供方回调后的错误是不同阶段。
}
```

此处 `callbackURL` 是认证完成后回到产品的地址。把三个地址画出来：

```text
A 页面地址                  http://localhost:5173
B 提供方注册的认证回调      http://localhost:4000/api/auth/callback/github
C 登录成功回到产品的地址    http://localhost:5173
```

A/C 可能相同，但 B 绝不能被省略或混为前端页面。

## 10.5 推演整个协议流

```text
1. 浏览器请求 Better Auth 发起 GitHub 登录。
2. Better Auth 准备 state 及适用的 PKCE 等协议关联数据。
3. 浏览器跳到 GitHub 授权页。
4. 用户同意后，GitHub 把浏览器重定向到后端 callback。
5. Better Auth 验证回调与原始请求的关联。
6. 后端完成 token exchange 并获取身份信息。
7. 建立/识别本地 Account 与 User，按策略建立 Session。
8. 响应 Cookie，浏览器回到受信产品地址。
9. 产品通过 /api/me 与业务 API 获取当前身份与权限。
```

state 防止未关联的回调被当成用户原始意图；PKCE 针对授权码截获/注入场景提供绑定保护；OIDC 的 nonce 等还有对应用途。不要自己手写并替换保留参数。

回调必须保持 query、原有 Cookie 与公开 baseURL 一致。换浏览器打开 callback、代理漏 Cookie、随机改 Host，可能破坏关联。遇到 state mismatch 先查这些证据，不关闭 state 验证。

## 10.6 provider 的邮箱验证与密码验证独立

`emailAndPassword.requireEmailVerification=true` 只约束邮箱密码登录。provider 级 `requireEmailVerification=true` 是单独的 opt-in。

当 provider 返回不可信/未验证邮箱时，当前版本可保存用户/账户，但不签发会话，并按邮件配置发送验证链接。某些 provider 永远不提供可靠 verified 信号，启用后可能阻止每次登录，需要按该 provider 的官方说明评估。

Harbor 还在业务 `requireIdentity` 中检查 `response.user.emailVerified`，使邮箱确认成为业务访问政策，而不只依赖某一种登录方式。

不要把“通过邮箱验证”当成“通过 workspace 邀请”。身份验证到此结束，成员关系检查仍在业务层。

## 10.7 账户合并是安全决策，不是自动去重

假设用户已经用邮箱密码注册 alice@example.com，再用 GitHub 返回同一个邮箱。你是否合并两个登录方式？如果提供方邮箱可由攻击者任意填写，错误合并就可能接管账号。

Better Auth 有账户关联能力，默认行为需要理解 verified 信号与 trustedProviders。本文起步选择：

```ts
account: {
  encryptOAuthTokens: true,
  accountLinking: { enabled: false },
}
```

因此不会静默把同邮箱 GitHub 账号绑定到已有 credential user。同邮箱的已有用户尝试新的 provider 登录可能得到 `account_not_linked`；这不是数据库“坏了”。先用未占用的测试邮箱验证独立 OAuth 新用户流程。

如果产品需要显式关联，可改为：

```ts
accountLinking: {
  enabled: true,
  disableImplicitLinking: true,
}
```

然后在已认证设置页调用 `authClient.linkSocial({ provider: "github" })`。它允许显式关联，仍拒绝未确认的同邮箱隐式绑定。改动前制定重新认证、verified 信号、解除关联、最后一种登录方式保留与审计政策，并添加测试。

不要为了让一个失败测试通过，把所有提供方塞入 trustedProviders 或开启 allowDifferentEmails。它们扩大的是账号绑定信任，不是仅改变界面提示。

## 10.8 外部 token 的存储与最小 scopes

当前选项参考提供 `account.encryptOAuthTokens`，默认 false，本文显式 true。它用于存数据库的 OAuth token 材料，**不是密码哈希选项**。

这不等于数据库或备份已经不需要保护：密钥管理、最小数据库权限、备份加密、日志脱敏仍然必要。已有未加密 OAuth token 的工程切换此项前要看对应版本的迁移兼容规则，不能假设全表旧值被自动重写。

外部 token 不返回给 task API，不进入普通日志。只需要登录时，不申请仓库写权限。以后要读取 GitHub 仓库，按功能请求额外 scope，再单独检查访问资格。

当前账户 API 会要求显式选中本地 account record ID；不要以为只传 `providerId:"github"` 就足以安全选中一个账户。权限与账户选择都必须明确。

## 10.9 OAuth 调通之后还要做哪些负面测试

- 错误 callback URL：在可信名单外应拒绝。
- provider 未配置：不能默默回退成邮箱账号。
- state 丢失/篡改：不应建立会话。
- 用户取消授权：产品显示可恢复错误。
- 没有邮箱权限：不伪造个人地址。
- 同邮箱未关联账户：遵循明确合并政策。
- 新 OAuth user 登录成功，但没有 workspace 成员关系：业务 API 仍拒绝。
- callback 开始后跨版本部署：按升级文档处理旧 state，不能假设旧 pending flow 总是兼容。

本教程本地测试没有真实 GitHub Client Secret，因此不声称已经完成提供方端到端登录。只有配置真实应用并在浏览器走完重定向，才能验收 Cookie、state 与回调环境。

## 10.10 练习与验收

练习：GitHub 返回 profile 中 `role:"admin"`，你把它映射到 Harbor 的 role，是否安全？

参考：不能把外部字段当内部授权事实。用户 additionalFields 的安全字段应 `input:false`；当前版本 mapProfileToUser 也属于输入方向。workspace 成员关系必须来自受控的业务数据与授予流程。

- [ ] 能区分 provider callback 与最终产品 callbackURL。
- [ ] 知道 OAuth scope 不等于 workspace role。
- [ ] 有真实 provider 应用配置，而不是占位凭证。
- [ ] 有明确账户关联政策，不按同邮箱盲目合并。
- [ ] 验证新 OAuth 用户也必须通过业务成员授权。

官方阅读：[GitHub](https://better-auth.com/docs/authentication/github)、[OAuth](https://better-auth.com/docs/concepts/oauth)、[Users & Accounts](https://better-auth.com/docs/concepts/users-accounts)、[Options](https://better-auth.com/docs/reference/options)、[Security](https://better-auth.com/docs/reference/security)。
