# 第 6 章：会话什么时候失效，续期与撤销究竟改变什么

[上一章](./05-client-and-first-login.md) · [目录](./README.md) · [下一章](./07-cookies-cors-and-deployment.md)

现在能登录，但安全设计刚开始。用户放着浏览器一周不动会怎样？每天使用会无限续期吗？手机丢了，只退出电脑能解决吗？本章用时间线理解 Session 生命周期。

## 6.1 先分清三个时钟

本教程配置：

```ts
session: {
  expiresIn: 60 * 60 * 24 * 7,
  updateAge: 60 * 60 * 24,
  freshAge: 60 * 5,
  cookieCache: { enabled: false },
}
```

所有值都是秒，不是毫秒。

| 参数        | 回答的问题                            | 不代表                          |
| ----------- | ------------------------------------- | ------------------------------- |
| `expiresIn` | 会话创建/续期时，到期时间推到多久以后 | 任何时候都固定从首次登录算 7 天 |
| `updateAge` | 使用会话达到多久后才进行更新          | 每秒执行的后台清理任务          |
| `freshAge`  | 首次建立会话多久内被认为足够新鲜      | 会话普通有效期                  |

前两个对应存储生命周期，第三个对应敏感操作所需的认证新鲜度。

## 6.2 推演一次正常续期

设 Alice 在第 0 天 09:00 登录：

```text
createdAt = 第 0 天 09:00
updatedAt = 第 0 天 09:00
expiresAt = 第 7 天 09:00
```

她在第 0 天 10:00 请求会话，尚未达到一天更新阈值，不需要每次写库。

第 1 天 10:00 再次使用会话，达到 `updateAge`，Better Auth 在正常可写的会话请求路径更新到期时间：

```text
updatedAt = 第 1 天 10:00
expiresAt = 第 8 天 10:00
```

这叫滚动续期。每天使用可能一直保持有效，并非“第 7 天绝对退出”。如果监管或业务需要首次登录后绝对最长时长，要额外制定策略；不要误读 expiresIn。

续期不是 resurrection：真正到期的会话不能通过一次请求重新变有效。用户需要重新认证。

## 6.3 为什么更新数据库还不够

服务端到期时间更新后，浏览器可能还持有旧到期属性。因此会话读取可能返回新的 `Set-Cookie`。

在 Fastify 自有业务接口里，我们使用：

```ts
const { response, headers } = await auth.api.getSession({
  headers: authHeaders(request),
  query: { disableCookieCache: true },
  returnHeaders: true,
});
const cookies = headers.getSetCookie();
if (cookies.length) reply.header("set-cookie", cookies);
```

认证 catch-all 也完整转发响应 Cookie。忽略 headers 可能出现“数据库仍有效、浏览器却不再发 Cookie”的生命周期不一致。

请求中途会话撤销与正在执行的操作之间仍有竞争窗口：本文保证 **下一条验证时** 读取数据库拒绝，不保证已经授权、正在执行中的业务事务被自动取消。极高风险操作要考虑重新认证、事务内状态检查与操作取消策略。

## 6.4 Fresh session 与重新认证

第 1 天 Alice 的会话续期了，但 `createdAt` 仍是第 0 天。`freshAge=5分钟` 时，它已经不新鲜。

这很有意义：一台忘记锁屏的电脑可能还保持普通登录，但修改敏感身份信息不应该仅靠一个长寿命 Cookie。

Better Auth 的部分敏感端点会要求 fresh session；并非你的每条自有 API 都自动套用。业务中的转让 owner、管理高价值密钥、财务动作，需要自己决定是否要求重新登录或 MFA。

不要为了避免一次报错把 `freshAge` 改成 0。官方的 `0` 是 **关闭新鲜度检查**，不是“要求立即新鲜”。

## 6.5 rememberMe 是浏览器保存策略，不是授权开关

客户端可以传：

```ts
await authClient.signIn.email({ email, password, rememberMe: false });
```

它影响浏览器是否以持久 Cookie 记住登录；不把这个 session 变成只读，也不消除服务器 expiresAt。

“关闭浏览器就一定彻底退出”也不要绝对化：现代浏览器可能恢复会话窗口与 session cookies。共享设备的安全说明应要求显式退出，不能只依赖关窗口。

## 6.6 当前退出、指定撤销、其他设备退出

```ts
await authClient.signOut();
```

结束当前登录设备的会话，不等于结束全部设备。

```ts
const result = await authClient.listSessions();
if (result.error) throw new Error("读取设备会话失败");

await authClient.revokeSession({ token: selectedSessionToken });
await authClient.revokeOtherSessions();
await authClient.revokeSessions();
```

分别是指定会话、除当前之外所有会话、全部会话。`selectedSessionToken` 应来自当前用户的会话管理结果，不是自己猜测其他用户 token。

会话列表可能包含敏感 token，设备管理页面只显示必要信息（时间、设备描述），不要把整个对象打印给日志、埋点或第三方客服工具。

从业务角度，手机丢失时可以从电脑撤销手机会话；账号疑似全面泄露时撤销全部会话并完成凭证恢复。只修改 UI 没有作用。

## 6.7 修改密码与重置密码并不是同一条路径

已登录用户知道旧密码：

```ts
await authClient.changePassword({
  currentPassword,
  newPassword,
  revokeOtherSessions: true,
});
```

忘记密码的用户通过邮箱重置，依赖配置：

```ts
emailAndPassword: {
  enabled: true,
  revokeSessionsOnPasswordReset: true,
  // 还需要 sendResetPassword，见第 9 章。
}
```

当前版本默认不会因密码重置撤销所有活跃会话，必须显式开启。否则攻击者已拿到的旧会话可能继续访问，即使密码已经改了。

本教程开启 Drizzle `transaction: true`，且没有 secondary storage，使数据库中的重置 token 消费、会话撤销与密码变更具有一致的事务边界。第 9 章验证重置链接不能重复使用。

## 6.8 Cookie cache：性能换取一个已声明的陈旧窗口

可选配置为：

```ts
session: {
  cookieCache: { enabled: true, maxAge: 60 },
}
```

开启后，除主会话 Cookie 外，还会有 `session_data`，服务器可以在短期内从签名缓存读取会话，减少数据库访问。

签名保证不能篡改，不保证信息是最新。撤销某会话后，另一设备的 Cookie cache 可能直到 maxAge 到期才再次读数据库。管理员改变用户状态也可能面对类似陈旧信息问题。

因此本文默认关闭，受保护接口还传 `disableCookieCache: true`。这不是说缓存不安全，而是我们当前验收要求“撤销后下一条请求拒绝”，先用易证明的实现。

`compact`、`jwt`、`jwe` 是 cache 编码选项：签名格式不等于加密；可读的 JSON 即使不可篡改也不适合塞秘密。cache JWT 与 JWT 插件单独签发的服务 token 也不是同一用途。

练习：假设 cache maxAge 为 5 分钟，12:00 签发，12:01 撤销。另一设备最坏可能到什么时候继续凭缓存有效？参考：到该缓存失效并重新验证的时刻，近似可达 12:05；不能承诺12:01立即退出。

## 6.9 Secondary storage 不是简单加速开关

如果加入 Redis secondary storage，Better Auth 默认会把会话放进 secondary storage，而不是仍然只读数据库。

- `storeSessionInDatabase` 控制是否同时存数据库。
- `preserveSessionInDatabase` 控制撤销后的记录保留语义。
- secondary storage 故障与撤销传播需要额外验收。
- 当前官方接口包含原子 `getAndDelete`、`increment` 等能力，不能复制旧的 get/set-only 实现。

官方提供 Redis storage 包，生产优先用经过支持的实现并验证其版本。不在初学工程中手写一份缺少原子语义的缓存，然后声称撤销一致。

特别是数据库提交成功、secondary storage 清除失败时，官方说明旧会话可能在 secondary storage 中继续有效直到到期。多存储方案要定义故障处置，而不仅是测 Redis 正常响应。

## 6.10 本地到期与撤销实验

在专用学习数据库中，使用测试或受控 SQL 把一个测试 session 的 expiresAt 改到过去。保留浏览器旧 Cookie，再请求 `/api/me`，必须得到 401。

再开启两个独立登录会话，撤销 other sessions，当前会话仍应 200，另一个即使重放旧 Cookie 也应 401。不要仅断言“revoke 函数被调用”。

过期记录何时物理删除与“是否允许访问”不同。安全判断必须看逻辑到期，不等待后台清理表。大量过期数据的维护按官方版本与团队数据保留策略设计，不要清理活跃数据。

## 6.11 本章验收

- [ ] 能画出 expiresIn/updateAge 的滚动时间线。
- [ ] 续期返回的 Cookie 没有在桥接中丢失。
- [ ] 能解释 freshAge 与普通有效期不同。
- [ ] 能验证当前退出、其他设备撤销、全部撤销的区别。
- [ ] 知道 cache / secondary storage 引入的撤销陈旧窗口。

官方阅读：[Session Management](https://better-auth.com/docs/concepts/session-management)、[Cookies](https://better-auth.com/docs/concepts/cookies)、[Email & Password](https://better-auth.com/docs/authentication/email-password)、[Database](https://better-auth.com/docs/concepts/database)。
