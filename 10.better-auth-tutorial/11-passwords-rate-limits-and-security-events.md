# 第 11 章：密码哈希、限流、枚举风险与安全事件

[上一章](./10-oauth-and-account-linking.md) · [目录](./README.md) · [下一章](./12-workspace-rbac-and-ownership.md)

“认证库已经校验密码”不代表认证入口不会被攻击。密码库可能泄露，攻击者可能撞库、猜密码、搜集邮箱、轰炸验证邮件，或者伪造 IP 绕过限流。本章逐层建立防线，同时说明哪些能力不是 Better Auth 自动包办的。

## 11.1 密码为什么必须用专用哈希

加密是可逆的：拿到密钥可以解回原文。密码哈希用于验证输入，不应该需要恢复用户原密码。

普通 SHA256 很快，适合完整性等用途，却会让攻击者在数据库泄露后高速尝试候选密码。密码哈希需要盐与合适成本，让每次猜测有明显代价。

Better Auth 默认使用 **scrypt**，密码哈希保存在 `account.password`。本文保留官方实现，不自行替换。

```text
用户输入密码
  → Better Auth 官方哈希与验证流程
  → credential account.password
```

同一密码的存储值不应因此永远相同；不要去掉盐，不要把 `BETTER_AUTH_SECRET` 当作自己拼的全局密码盐，也不要因单次登录稍慢把成本改成极低。

## 11.2 什么时候考虑 Argon2id

官方支持自定义：

```ts
emailAndPassword: {
  enabled: true,
  password: {
    hash: hashPassword,
    verify: verifyPassword,
  },
}
```

这不是邀请你编写哈希算法。可以使用成熟 Argon2id 实现，但需要兼顾服务器内存、并发、成本参数、旧 scrypt 哈希验证与渐进迁移。

如果已有用户，不能只改 hash 函数却让 verify 不再识别旧格式，导致所有人无法登录。需要按存储格式识别、兼容验证、成功后重新哈希或明确密码重置流程。先测试再升级，不用 `any` 抹掉接口差异。

本教程不要求初学者实现多算法迁移；保留 scrypt 是完整且明确的选择，而不是缺少密码保护。

## 11.3 长度、泄露口令与多因素

本文服务端设置最短 12、最长 128；UI 的 minlength 只改善交互，服务器才是实际规则。

长度限制不是全部强度：常见口令与泄露密码仍有风险。生产可评估官方 Have I Been Pwned 插件与 MFA / Passkey 等。每加一种恢复/登录方式，要连同 schema、邮件、失败路径与威胁模型测试。

管理员与高风险操作尤其需要强认证。短信、邮箱、TOTP、Passkey 的风险不同，不能仅因“有第二个输入框”就认为完全防接管。

**离线破解**与**在线暴力尝试**也不同：scrypt 增加离线猜测成本；在线攻击还要靠限流、风险控制与可靠凭证恢复。

## 11.4 先显式开启 HTTP 限流

官方默认开发环境关闭内置限流；生产有全局与敏感端点默认规则。为了可验证，本文显式配置：

```ts
rateLimit: {
  enabled: true,
  storage: "database",
  window: 60,
  max: 100,
  customRules: {
    "/sign-in/email": { window: 60, max: 5 },
    "/sign-up/email": { window: 60, max: 5 },
    "/request-password-reset": { window: 60, max: 3 },
    "/send-verification-email": { window: 60, max: 3 },
  },
}
```

customRules 的路径不包含 `/api/auth` 前缀。本文数值是教学基线，不是所有产品通用阈值。NAT 下许多用户共享一个 IP，过低会造成误伤；过高又会允许更多尝试，必须根据数据调整。

切换数据库 storage 要重新生成认证 schema，再由 Drizzle 生成/应用迁移。我们的初始迁移已经包含 `rate_limit` 表。

## 11.5 为什么不能在自己的 login wrapper 里绕过它

官方明确：`auth.api` 的服务端调用不受该 HTTP 限流影响。

```ts
// 不要把这类服务端调用误当作完整的受限流 HTTP 入口。
await auth.api.signInEmail({ body: { email, password } });
```

如果你写一条 Fastify `/login` 调用它，再宣称 Better Auth 的限流已生效，可能留下无限密码尝试入口。

Harbor 的浏览器认证走 `auth.handler`。测试生成身份时会使用可信服务器方法以控制 fixture，但限流测试必须真实发送 handler 请求，不能只调用 `auth.api`。

内置认证限流也不限制所有自有 task API。业务创建、导出、邀请与耗时查询仍应有 API 网关或 Fastify 层的限流/配额，不复用“每分钟密码尝试数”代替业务资源保护。

## 11.6 IP 的来源必须可信

限流按 IP 计数，但请求头可伪造。仅把 Better Auth 配成读取 `x-real-ip`，不能保证这个头真由代理填写。

本文桥接覆写：

```ts
headers.delete("x-forwarded-for");
headers.set("x-real-ip", request.ip);
```

默认 Fastify `trustProxy=false`，`request.ip` 来自直接连接，不受来访者填写的 IP 头影响。配套测试连续换伪造 `x-real-ip`，第六次仍应 429。

生产经过代理时，要对 `createApp` 传 **实际可信代理地址**，例如仅本机 Nginx：

```ts
const app = await createApp(db, auth, env, ["127.0.0.1"]);
```

同时源站只能由代理到达，代理覆盖或清洗 forwarded headers。不要使用任意宽范围或简单 `trustProxy:true`，否则直接访问源站的用户可能影响 `request.ip`。

Better Auth 自身也支持 `trustedProxies` 与指定 IP headers，但本教程采用 Fastify 可信连接计算后统一注入的路径。不要同时维护两套不一致的代理信任。

IPv6 地址存在多种表示与大范围地址轮换，官方有限流规范化与 subnet 支持。不要在自制计数器里仅按未规范化的原始字符串判断同一客户端。

## 11.7 内存、数据库与共享原子计数

默认内存计数对多实例不共享，重启会重置。本文数据库 storage 使多个实例可以使用同一存储，但仍需要按负载验证并发计数、连接预算与过期数据维护。

更高吞吐可用受支持的 secondary/custom storage。当前 custom storage 要提供原子 `consume`，不是先 get、再 set 的两步：

```text
错误：10 个并发请求都读到 count=4，都认为允许，最后都写5。
正确：检查与增加在同一原子操作中，共同决定是否放行。
```

不要把教学单进程测试当成分布式严格限流的证明。负载均衡、共享计数、存储故障、代理 IP 都需要真实环境验收。

## 11.8 枚举风险不止在错误文案

默认自动注册登录时，重复邮箱会返回不同错误，便于使用，却可能暴露账号存在性。当前版本在 `requireEmailVerification=true` 或 `autoSignIn=false` 时，注册端点使用相同成功响应并模拟哈希成本降低时序差异。

我们同时启用这两项，并把注册页面提示设计为条件语句，不声称某邮箱一定已创建。

还要检查：

- 登录错误是否区分“没有此邮箱”与“密码错误”。
- 忘记密码是否泄露邮箱存在。
- 是否有另一个“查邮箱是否注册”的公开 API。
- 响应 shape、状态、长度、明显时间差是否仍区分两类用户。
- 后续启用 Admin/2FA 等插件时，synthetic user 是否包含相同结构的额外字段。

前端统一提示不能掩盖后端响应本身差异。第 15 章的测试只检查基本状态与 shape，不是统计时序攻击审计。

## 11.9 暴力尝试、撞库与账号锁定的取舍

IP 限流阻止同一来源大量请求，但分布式攻击者可以更换来源。因此生产还要按风险加入账号维度、设备/行为维度与边缘防护。

不要简单永久锁住“被尝试 5 次”的邮箱：攻击者可以故意锁住所有已知用户，形成拒绝服务。更好的策略可能包含有上限的退避、挑战、异常通知、人工恢复与高风险 MFA，但需要结合产品用户体验和风险政策。

验证码也不是万能解决；仍需要服务端验证、限流、避免直接重放与服务故障策略。邮件发送功能同样要避免被用于批量骚扰。

## 11.10 安全事件应该记录什么

至少识别：登录成功/失败、限流、邮箱验证、密码恢复、会话撤销、账户关联变化、成员授权变化、跨租户拒绝与管理员高风险操作。

一个安全事件可以包含：

```json
{
  "type": "workspace.member.added",
  "actorUserId": "可信会话里的用户ID",
  "workspaceId": "目标workspace",
  "targetUserId": "被添加用户",
  "requestId": "请求关联ID",
  "result": "success"
}
```

不要记录 password、Cookie、session.token、OAuth tokens、重置/验证 token、完整邮件正文。IP/邮箱等个人数据也需要最小化、访问控制和保留期。

失败与成功事件应对应真实执行阶段：操作尚未提交时不要记录“成功”。重要管理员审计可与业务变更写入同一事务的 outbox/audit 表，再异步导出，避免审计服务失败导致悄悄丢记录。

Better Auth 提供 hooks，官方也有基础设施 Audit Logs / Security 能力；它们不是普通 `logger:true` 自动变成完整业务审计。本文只提供脱敏诊断：生产认证日志保留事件级别，详细审计尚需按项目要求实现，不声称已经具有审计平台。

## 11.11 事故发生后的顺序

假设用户报告手机丢失或疑似账号接管：

1. 用合法恢复流程确认身份，不仅相信发来的一封邮件。
2. 撤销受影响会话或全部会话。
3. 完成密码/第二因素/外部账户恢复，按风险处理绑定关系。
4. 在旧 Cookie 上验证业务 API 不能继续访问。
5. 检查异常成员授予、资源变更和日志，保护证据。
6. 若为系统密钥泄露，执行受控密钥轮换与兼容/强制失效策略。

当前版本有 `secrets`/`BETTER_AUTH_SECRETS` 支持版本化密钥轮换。普通计划轮换与“泄露后不能再信任旧 key”不同；保留旧 key 会保留部分验证/解密能力，需要根据事件目标决定。跨版本目的密钥变化也可能让 pending OAuth state 失效，按升级文档处理。

## 11.12 练习与验收

练习：测试直接调用 `auth.api.signInEmail` 六次，仍没429，说明限流失效吗？

参考：不说明。该路径本来不受内置 HTTP 限流；应该在 `auth.handler` HTTP 入口测试，核对实际 IP 和共享 storage。

- [ ] 知道 scrypt 保护离线猜测，限流保护在线尝试。
- [ ] HTTP 登录入口真正经过内置限流。
- [ ] IP 源可信，伪造头无法绕过。
- [ ] 有反枚举策略，不只修改前端错误文字。
- [ ] 会话撤销、安全事件与事故恢复有明确验收。

官方阅读：[Email & Password](https://better-auth.com/docs/authentication/email-password)、[Rate Limit](https://better-auth.com/docs/concepts/rate-limit)、[Security](https://better-auth.com/docs/reference/security)、[Options](https://better-auth.com/docs/reference/options)、[Hooks](https://better-auth.com/docs/concepts/hooks)。
