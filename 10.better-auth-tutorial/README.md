# Better Auth 从 0 到 1：把认证安全地接进 Fastify 与 Postgres

你会写前端，却可能不确定：登录成功以后服务器怎样认出下一条请求？Cookie 是不是 token？为什么登录用户仍不能访问某个 workspace？CORS 配好是否就没有 CSRF？

这份教程从这些问题开始，以 **Harbor 多 workspace 协作工具** 贯穿：建立 TypeScript 服务、生成认证表、接入 Fastify handler、完成注册/邮箱验证/登录/退出与密码恢复，接着实现当前成员关系、角色、任务归属和跨租户隔离，最后用失败测试证明安全边界。

它不是按选项逐条罗列的手册。15 个章节都有场景、推演、代码、动手步骤、练习与参考判断。正文遇到的关键代码同时提供完整源码链接，避免你为了拼 imports 和 helper 猜出另一套实现。

核心目标：**认证确认身份，会话延续并终止身份状态，授权决定某个主体是否能对特定租户的资源执行特定动作。**

## 版本与官方依据

核对时 Better Auth 官方稳定文档为 **1.7.x**，npm 上 `better-auth`、`auth` CLI 与 `@better-auth/drizzle-adapter` 为 **1.7.12**，本教程锁定这组三个版本。

使用 Node 24、Fastify 5.12.7、Postgres（本地建议17）、Drizzle ORM 0.45.4 / Kit 0.31.11、TypeScript 5.9.3。其余依赖见 [package.json](./example/package.json)，安装结果有 [package-lock.json](./example/package-lock.json)。

本教程使用 Better Auth 默认 Drizzle Relations v1 adapter，不把工作区另一份 Drizzle 教程的 1.0 RC / Relations v2 写法混入。官方也提供 v2 adapter，第14章解释迁移边界。

已经阅读并据此组织的主要官方页面：

- [安装](https://better-auth.com/docs/installation)、[基础使用](https://better-auth.com/docs/basic-usage)、[Fastify 集成](https://better-auth.com/docs/integrations/fastify)。
- [Postgres](https://better-auth.com/docs/adapters/postgresql)、[Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)、[数据库模型](https://better-auth.com/docs/concepts/database)、[CLI](https://better-auth.com/docs/concepts/cli)。
- [会话](https://better-auth.com/docs/concepts/session-management)、[Cookies](https://better-auth.com/docs/concepts/cookies)、[安全](https://better-auth.com/docs/reference/security)、[限流](https://better-auth.com/docs/concepts/rate-limit)。
- [邮箱密码](https://better-auth.com/docs/authentication/email-password)、[邮件](https://better-auth.com/docs/concepts/email)、[OAuth](https://better-auth.com/docs/concepts/oauth)、[GitHub](https://better-auth.com/docs/authentication/github)、[用户与账户](https://better-auth.com/docs/concepts/users-accounts)。
- [服务端 API](https://better-auth.com/docs/concepts/api)、[Organization](https://better-auth.com/docs/plugins/organization)、[Admin](https://better-auth.com/docs/plugins/admin)、[选项](https://better-auth.com/docs/reference/options)、[1.7 升级](https://better-auth.com/docs/guides/1-7-upgrade-guide)。

每章末尾还提供相关具体来源。Harbor 权限矩阵、业务 Service、部署与测试组织是基于这些机制的工程教学，不冒称 Better Auth 自动替你完成所有业务安全。

## 适合谁

需要会 JavaScript/TypeScript、Promise、async/await 和基本 HTTP 请求。熟悉 React 有帮助，但不用先掌握所有后端框架，也不需要 Python。

建议先了解 Postgres 表、主外键与事务；如果还不熟悉，可结合工作区 [Drizzle 教程](../drizzle-orm-tutorial/README.md) 的 SQL/建模章节阅读，但保持两套工程的版本隔离。

前端采用最小 Vite + TypeScript 页面，不把表单库、路由或 UI 样式变成认证学习的前置门槛；第5章给出 React useSession 用法。

## 章节与学习成果

| 章节                                                                          | 学完实际能做什么                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [01 认证、会话与授权](./01-authentication-session-authorization.md)           | 分清身份、状态延续、资源权限与信任边界                       |
| [02 环境与第一个实例](./02-setup-and-first-instance.md)                       | 从空目录搭建、锁版本、配置地址和随机密钥                     |
| [03 模型、适配与第一份迁移](./03-models-adapter-and-first-migration.md)       | 读懂user/account/session/verification，生成并应用认证表      |
| [04 Fastify handler 与请求边界](./04-fastify-handler-and-request-boundary.md) | 正确转换Request/Response，保留多Cookie与续期，逐请求验证身份 |
| [05 客户端与第一次完整登录](./05-client-and-first-login.md)                   | 注册、验证、登录、刷新、退出与前端缓存处理                   |
| [06 会话生命周期与撤销](./06-session-lifecycle-and-revocation.md)             | 推演到期/续期/新鲜度，撤销设备，理解缓存陈旧窗口             |
| [07 Cookie、CORS 与部署](./07-cookies-cors-and-deployment.md)                 | 配双端口、同站子域/同origin代理，解释跨站限制                |
| [08 CSRF 与自有业务 API](./08-csrf-and-business-api.md)                       | 保留框架保护，为task写请求建立独立来源策略                   |
| [09 邮件验证与密码恢复](./09-email-verification-and-password-reset.md)        | 实际交付配置、完整回调、一次性重置与旧会话失效               |
| [10 OAuth 与账户关联](./10-oauth-and-account-linking.md)                      | 配GitHub应用、区分两种callback、制定绑定与token政策          |
| [11 密码、限流与安全事件](./11-passwords-rate-limits-and-security-events.md)  | 防在线尝试/枚举，核对可信IP、共享计数和事件恢复              |
| [12 Workspace RBAC 与ownership](./12-workspace-rbac-and-ownership.md)         | 当前成员、最小权限、资源scope、默认拒绝与事务                |
| [13 Organization / Admin边界](./13-organization-and-admin-boundaries.md)      | 选择单一成员事实源，区分租户管理员与平台管理员               |
| [14 迁移与升级](./14-migrations-and-upgrades.md)                              | 分清认证/业务schema，审查候选diff、旧数据与发布顺序          |
| [15 测试、综合实战与逐项验收](./15-testing-capstone-and-acceptance.md)        | 多用户/双租户闭环，用正面与负面测试证明每项能力              |

建议按顺序学。第3章会提前准备完整业务表，第4章准备完整源码，使你每阶段都有可运行基准；第12章再逐步拆解业务授权。不要因为已经能运行就跳过授权与失败测试。

第13章的插件路线是可选替换/扩展，未默认启用；主线自有 memberships 已完整实现租户与角色规则。

## 先运行测试，不要求 Postgres 或 Docker

```bash
cd better-auth-tutorial/example
npm ci
npm run typecheck
npm test
```

测试使用 PGlite，自动应用同一份迁移，生成随机测试密钥，收集测试邮件，不读取生产数据库配置、不发送真实邮件。

检查 Kit 迁移历史需配置一个 DATABASE_URL；该检查不连接数据库：

```bash
DATABASE_URL=postgresql://localhost/harbor npm run db:check
```

## 运行完整本地应用

第2、3章解释每一步。快速入口：

1. 建立独立学习 Postgres（已有实例可直接建库）：

```bash
docker run --name harbor-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=harbor -p 127.0.0.1:5432:5432 -d postgres:17
```

2. 根据 [.env.example](./example/.env.example) 创建 `.env`，填 `DATABASE_URL`、`BETTER_AUTH_URL=http://localhost:4000`、`WEB_ORIGIN=http://localhost:5173`。执行 `openssl rand -base64 32`，把你自己的随机输出填写为 secret。

3. 执行已提供的迁移并检查本地认证模型：

```bash
npm run db:migrate
npm run auth:check
npm run dev
```

4. 第二个终端运行 `npm run web`，在浏览器打开 **http://localhost:5173**。本地 `MAIL_MODE=local` 时，在 API 终端找验证/重置链接，注册后先验证再登录。

配套工程已包含生成的认证 schema 与初始 SQL，不需要首次再跑 auth:generate。自己从空目录学习时按第3章执行生成链；升级时按第14章先生成候选文件审查，不盲目覆盖。

只使用教学账号与独立数据库。示例会注册用户、写workspace/task和会话，不用于连接生产数据。

## 核心验收地图

- Authentication / Authorization 不同，已登录不代表workspace/task有权：01、12、15。
- 实例、adapter、核心模型与Fastify handler：02—04。
- Cookie-based session，到期/续期/撤销、trusted origins与安全属性：06—08。
- CORS/credentials，跨子域/跨站，CSRF与框架推荐配置：05、07、08。
- 邮箱密码、验证、重置、OAuth按需启用，真实邮件和回调：05、09、10。
- 哈希、限流、枚举、暴力防护、安全事件：11、15。
- 每条API验证会话，业务层验证当前成员、租户与资源：04、12。
- RBAC / ownership、组织关系、最小权限、默认拒绝：12、13。
- Better Auth与自有Drizzle schema边界、升级迁移检查：03、14。
- 未登录、过期、非成员、只读、跨workspace与管理员测试：15。

第15章提供逐项表格和动手证明，不以“知道一个配置名”代替验收。

## 已验证与尚需验证

已通过 **TypeScript检查、20项PGlite/HTTP安全测试、Drizzle迁移历史检查、Better Auth本地schema检查、前端构建**。认证schema与SQL迁移由实际锁定版本CLI生成。

尚未进行真实Postgres TCP/TLS/多连接并发验证、浏览器Cookie兼容验收、真实Resend投递与GitHub OAuth端到端测试。生产还需要代理/源站限制、业务API限流、可靠邮件队列、完整审计、MFA与恢复演练等，章节中明确区分了这些边界。

本文不声称一个学习示例已经获得“生产绝对安全”认证。你应能解释每条边界，并在自己的真实部署环境完成对应验收。

从 [第1章](./01-authentication-session-authorization.md) 开始。
