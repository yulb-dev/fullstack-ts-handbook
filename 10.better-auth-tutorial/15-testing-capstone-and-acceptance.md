# 第 15 章：通过失败测试与完整实战，证明认证和授权确实一起工作

[上一章](./14-migrations-and-upgrades.md) · [目录](./README.md)

如果你只测“正确密码返回200”，别人很容易在没有 Cookie、会话过期、只读角色、错误 workspaceId 的情况下绕过系统。本章从真实迁移与认证流程建立测试，最后完成两个租户、多种角色的协作实战。

## 15.1 不只 mock 一个“已登录用户”

这样的 mock 只能测一小部分业务逻辑：

```ts
getSession.mockResolvedValue({ user: { id: "alice" } });
```

它不知道密码哈希、Cookie 签名、数据库到期、handler 转发、撤销或 schema 是否正确。mock 可用于孤立纯权限函数，但不能替代认证接入测试。

本文测试使用：

```text
生产同一份迁移
  → PGlite 的 Postgres SQL 语义
  → 同一个 Drizzle adapter / Better Auth 配置
  → 实际注册、邮箱验证与登录
  → Fastify inject 的 HTTP 请求
  → 数据库结果和权限断言
```

不手写另一个与生产不同的 CREATE TABLE，不插入“看起来像session”的假记录代替正常登录。

## 15.2 为什么选 PGlite，以及它没证明什么

PGlite 是基于 Postgres 的嵌入式数据库，方便本地跑迁移与 SQL，不要求 Docker。

它能帮助发现表/列缺失、FK/CHECK、请求处理、授权和事务结果问题。但是：

- 没有证明真实 `pg` TCP/TLS 连接配置。
- 没有证明多进程与多连接的锁竞争、分布式严格限流。
- Fastify inject 不是浏览器，不执行 SameSite、第三方 Cookie 或 CORS 读响应限制。
- 测试邮件收集器不是邮件服务，不证明真实投递。
- 未配置真实 GitHub 应用，不证明提供方端到端 OAuth。

验证范围必须诚实标注；默认跳过或根本没有运行的外部验收，不算通过。

## 15.3 从零添加测试依赖

```bash
npm install -D --save-exact @electric-sql/pglite@0.5.11 vitest@5.0.5
```

使用 [vitest.config.ts](./example/vitest.config.ts)，设置合理 test/hook timeout，关闭文件并行以简化教学共享 fixture。`tsconfig` 的 lib 使用 ES2023，支持测试里用到的 `findLast`；运行环境仍为 Node 24。

配套工程：

```bash
npm run typecheck
npm test
npm run db:check
```

类型检查、运行行为和迁移历史检查是三种证据，不互相替代。

## 15.4 建立测试数据库与可替换交付

[test/security.test.ts](./example/test/security.test.ts) 的核心：

```ts
const client = new PGlite();
const db = drizzle(client, { schema });
const mails: Mail[] = [];
const auth = createAuth(db, testEnv, async (mail) => {
  mails.push(mail);
});

await migrate(db, { migrationsFolder: "./drizzle" });
const app = await createApp(db, auth, testEnv);
```

测试 secret 每次随机生成，不把真实密钥带进测试。测试不读取运行时 `DATABASE_URL`，避免误连业务库。

`createAuth`、`createApp` 与运行工程共用；只替换数据库驱动和邮件交付。最终配置显式开启 origin/CSRF，开发/测试也显式开启限流。

结束时 `app.close()`、`client.close()`；不能留下句柄导致测试挂住，再把超时无限增大。

## 15.5 用实际认证流程生成一个身份

测试 helper 顺序：

1. 通过 `auth.api.signUpEmail` 注册唯一测试邮箱。
2. 收集该邮箱的验证邮件。
3. 用 `auth.handler(new Request(mail.text))` 访问实际验证链接。
4. 通过 `auth.api.signInEmail({ ..., asResponse:true })` 登录。
5. 提取每条 `Set-Cookie` 的 cookie-pair，作为后续 HTTP 请求 Cookie。

服务器 helper 不受 HTTP 限流，适合构造受控 fixture；另有真实 handler 登录与限流测试，验证外部入口。

测试里读取 Cookie header 是服务端动作，不能据此认为浏览器 JS 也能读取 HttpOnly Cookie。测试 token 只在内存中，不打印、不交给外部服务。

## 15.6 测试未登录与过期 session

未登录测试给合法 Origin/JSON headers，再不带 Cookie 请求受保护 API：

```ts
expect((await request("", "GET", "/api/me")).statusCode).toBe(401);
expect((await request("", "PATCH", taskURL, { done: true })).statusCode).toBe(
  401,
);
```

不是只测 `/api/me`；每条业务请求都应该自己验证会话。

过期测试先正常登录，再把那个 session 到期时间改到过去：

```ts
await db
  .update(session)
  .set({ expiresAt: new Date(Date.now() - 60_000) })
  .where(eq(session.token, login.token));

expect((await request(login.cookie, "GET", "/api/me")).statusCode).toBe(401);
```

Cookie 仍然存在，服务器仍拒绝，证明系统不是只检测 Cookie 字符串存在。

还测试伪造 Cookie、正常退出后重放旧 Cookie、撤销其他设备。失败时不通过手工清客户端数据绕过验证。

## 15.7 测试非成员、只读角色与 ownership

fixture 创建 owner、editor、viewer、admin、outsider，并在 red workspace 按规则授予角色。

断言：

```text
outsider 读/改 red task      → 404
viewer 读 red tasks          → 200
viewer 新建/修改/删除         → 403
editor 修改自己创建的 task   → 200
editor 修改 owner 的 task    → 403
admin 修改 red 他人的 task   → 200
```

对拒绝写入，再查数据库 task.done，确认没变化。对拒绝创建，确认没有额外行。不要只测 canEditTask 函数，不经过 SQL scope。

角色更新/移除测试用数据库受控 fixture 模拟管理员变更；本文没有开放移除成员 HTTP API。移除 editor 关系后，旧 session 的 `/api/me` 仍200，但 red task 请求404，这证明身份与租户授权独立。

## 15.8 跨 workspace 管理员测试最容易漏

Bob 在 red 是 admin，在 blue 是 owner。两边都合法，不代表可以把参数混用：

```text
PATCH /api/workspaces/red/tasks/blue-task
```

必须404，blue-task 不变化。

Alice 是 red owner，却不是 blue 成员：

```text
PATCH /api/workspaces/blue/tasks/blue-task
```

也必须404。这个测试证明 `role` 有 scope，而不是一个到处通用的全局标志。

再传 body `role:"admin"`、`createdBy:alice`，应被输入白名单拒绝，不发生归属变化。

## 15.9 安全机制的测试也要走对入口

已实现的测试包括：

- 恶意/缺失 Origin 与 cross-site 的自有写请求被拒绝。
- 非 JSON 业务写请求被拒绝，没有创建 workspace。
- Better Auth 恶意 Origin 与外部 callbackURL 拒绝。
- CORS 预检响应允许精确可信页面和 credentials。
- 同一连接 IP 连续失败登录触发429，轮换伪造 IP header 无效。
- 注册重复邮箱与新邮箱返回相同基本状态与外层 shape。
- credential password 不为明文，同样密码产生不同带盐存储值。
- 达到 updateAge 后数据库续期，并通过 /api/me 返回更新 Cookie。
- 密码重置后旧密码、旧 session、已用 reset token 全部失效。

这些是集成证明，不是渗透测试报告。统计时序、分布式限流、存储故障、所有 OAuth callbacks、所有插件组合仍需额外测试。

## 15.10 在真实 Postgres 再做一层验收

本地/CI 创建独立 Postgres 测试库，应用 **同一份 SQL 迁移**，用 node-postgres Drizzle 实例替换 PGlite driver，仍调用同一个 createAuth/createApp/Service。

需要隔离每个测试的用户、workspace 与速率计数，或使用临时 schema/数据库。不要把 production DATABASE_URL 当测试默认值，也不要编写启动时清空所有表的通用脚本。

重点增加：

1. 并发修改 task 与移除成员的事务锁语义。
2. 多实例共享限流、伪造代理头与直接访问源站。
3. 数据库故障时认证/授权失败关闭。
4. 密码重置事务中途失败后，token/密码/会话状态一致。
5. 真实迁移从已有旧数据升级，而不仅从空库建表。

本文附带的是已运行的 PGlite 测试，不假装存在一套已经在真实 Postgres 云环境运行的验证。

## 15.11 最终动手实战：两个租户、五种身份

按以下顺序在学习环境完成，不需要先实现漂亮 UI：

1. Alice 注册、验证、登录，创建 red；记录返回 workspace ID 和 Alice user ID。
2. Bob 注册、验证、登录，创建 blue；在 blue 创建任务。
3. Alice 把 Bob 的已有 user ID 添加到 red，role 为 admin。
4. Carol 加入 red 为 viewer；Dave 加入 red 为 editor；Eve 不加入 red。
5. Dave 在 red 创建任务；Dave 可以改自己的，不可改 Alice 的。
6. Carol 能读 red，不可写；Eve 不能读写。
7. Bob 能改 red 的任务，但不能把 blue task ID 填进 red URL 访问。
8. Alice 的 red owner 身份不能访问 blue。
9. 用独立浏览器会话登录同一用户，撤销其他会话并重放旧凭证。
10. 执行密码恢复，确认旧会话与旧密码都无效。

配套页面提供用户 ID、workspace 创建、已有成员添加、任务列表/完成切换/删除等控件。切换用户时清理私有展示，多个身份最好用独立 browser profiles 或无痕会话，避免共享 localhost Cookie 混淆。

页面显示403并不算故障：当用户无权时，它正是你设计的行为。

## 15.12 核心概念逐项验收

| 能力                               | 你必须完成的解释/动手证明                            | 章节       |
| ---------------------------------- | ---------------------------------------------------- | ---------- |
| Authentication 与 Authorization    | 登录用户跨 workspace 仍被拒绝                        | 01、12、15 |
| Better Auth 实例与 Fastify handler | 标准 Request/Response、headers、Cookie 完整转发      | 02、04     |
| 数据适配与核心模型                 | 区分 user/account/session/verification，生成真实 SQL | 03         |
| Cookie session 生命周期            | 解释到期、续期、新鲜度、指定/其他/全部撤销           | 06         |
| trusted origins 与安全 Cookie      | 精确来源与 HttpOnly/Secure/SameSite/Domain/Path      | 07、08     |
| CORS/credentials 与部署约束        | 推导双端口、同站子域、真正跨站的配置                 | 05、07     |
| CSRF 与框架推荐配置                | 认证端点保留框架防护，业务写 API 单独拒绝攻击        | 08         |
| 邮箱密码、验证、恢复、OAuth        | 按需启用并完成真实交付/回调配置                      | 05、09、10 |
| 哈希、限流、枚举、暴力防护         | 实际哈希与 HTTP429、共享/IP/反枚举边界               | 11、15     |
| 每请求会话与业务关系               | 同一有效 session 在成员移除后失去单租户权限          | 04、12、15 |
| RBAC、ownership、最小权限          | viewer、editor own、admin tenant、未知角色拒绝       | 12、13     |
| 认证与 Drizzle schema 边界         | 一条迁移链、候选 diff、历史/升级检查                 | 03、14     |
| 安全测试                           | 未登录、到期、非成员、只读、跨租户、管理员           | 15         |

“知道选项名称”不是验收通过。至少能解释机制，并用一个正面和一个负面场景证明。

## 15.13 上线前仍需完成的实际清单

- [ ] 公开 HTTPS 地址、可信 origin、Cookie 范围、前端 API 地址正确。
- [ ] 浏览器验证登录/刷新/续期/退出、Chrome/Safari 与目标隐私策略。
- [ ] 真实邮件发件域、提供方 key、投递/退信、重发与队列故障策略。
- [ ] 若启用 OAuth，真实 provider 回调、state、取消授权、账户关联政策。
- [ ] 生产迁移、旧数据、运行角色最小权限、TLS 与备份恢复演练。
- [ ] 代理信任边界和源站网络限制、多实例限流与业务 API 配额。
- [ ] 管理员 MFA/重新认证、权限变更、完整脱敏审计与事件响应。
- [ ] cache/secondary storage 若启用，撤销延迟与故障传播可接受。

这些是目标环境的验收工作，不能仅靠本文本地测试自动打勾。

## 15.14 最后的练习

在学习分支故意去掉 task SQL 的 workspace 条件，运行跨 workspace 测试；再把 canEditTask 改成“只要不是viewer就允许”，运行未知角色测试。观察测试如何发现漏洞，完成后恢复正确实现。

最后不用看代码，向同事解释一次请求：Cookie 从哪里来，服务器怎样验证它，为什么 user.id 不是 body 输入，怎样确认 task 属于目标 workspace，角色和 ownership 怎样一起决定动作，以及为什么 CORS 不能代替这些判断。

能讲清这条链，并且代码里的负面测试确实失败关闭，你才完成了从0到1，而不只是做出了一个登录页面。

官方阅读：[API](https://better-auth.com/docs/concepts/api)、[Session Management](https://better-auth.com/docs/concepts/session-management)、[Security](https://better-auth.com/docs/reference/security)、[Test Utils](https://better-auth.com/docs/plugins/test-utils)。本文主要直接使用公开 API 构造真实流程，没有默认启用 Test Utils 的放宽策略。
