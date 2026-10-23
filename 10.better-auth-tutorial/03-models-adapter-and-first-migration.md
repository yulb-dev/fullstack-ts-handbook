# 第 3 章：读懂用户、账户、会话，然后生成真正的数据库表

[上一章](./02-setup-and-first-instance.md) · [目录](./README.md) · [下一章](./04-fastify-handler-and-request-boundary.md)

“数据库里有 users 表”不是“认证数据库已准备好”。Better Auth 需要保存不同种类的数据，本章先理解模型，再用官方 CLI 生成 Drizzle schema，最后把它迁移到 Postgres。

## 3.1 User：人，不是密码

生成的 `user` 表包含稳定 ID、name、email、emailVerified、image、创建与更新时间。

```ts
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  // 还有头像与时间字段，以实际生成文件为准。
});
```

TypeScript 属性 `emailVerified` 与物理列 `email_verified` 是不同层次的名称。Drizzle 把两者映射起来；业务代码不用因此改写成 `user.email_verified`。

密码不在 `user` 表。不要自己给它加一个 `plainPassword`，也不要为了“快速注册”直接 INSERT 一个用户再跳过 Better Auth 流程。

## 3.2 Account：这个用户用哪种方式登录

同一个用户可以用邮箱密码，也可以关联 GitHub。Account 是登录方式与用户的联系。

| 字段             | 用途                                               |
| ---------------- | -------------------------------------------------- |
| `id`             | Better Auth 本地账户行的 ID                        |
| `userId`         | 所属 User                                          |
| `providerId`     | 登录提供方，如 `credential`、`github`              |
| `accountId`      | 提供方侧身份标识；credential 使用关联用户的稳定 ID |
| `password`       | credential 密码哈希；不是明文密码                  |
| `accessToken` 等 | 按提供方流程需要保存的 OAuth token 材料            |

外部身份由 `(providerId, accountId)` 这对键识别，不能仅按 `accountId` 跨提供方合并。`account.id` 与 `account.accountId` 也不能混用：当前版本的某些账户 API 参数名虽然叫 `accountId`，实际要求本地账户行 `id`，调用前读对应 API 文档。

账户表包含敏感材料。不要在“用户详情”接口里 `select * from account` 后直接返回浏览器。OAuth token 是访问外部服务的凭证，也不是 Harbor 的 workspace 权限凭证。

## 3.3 Session：记住一次登录，并允许结束它

会话表主要包含：

```text
id          会话行 ID
user_id     关联用户
token       会话 token，不要写进普通日志
expires_at  到期时间
created_at  创建时间
updated_at  上次更新
ip_address  风险分析的辅助信息
user_agent  设备描述的辅助信息
```

浏览器主 Cookie 包含经过签名的会话标识；服务器通过 Better Auth 验证它，再读取会话。不能只拿请求里的 Cookie 值直接查询数据库后就认为可信，更不能只检查字符串存在。

`ipAddress` 和 `userAgent` 不构成可靠身份：它们会改变或被伪造。可以辅助显示设备与发现异常，但不应该不加评估地把“IP 变了”当成必然盗号。

## 3.4 Verification：短期流程数据

`verification` 表保存 `identifier`、`value`、到期时间及时间字段，供短期验证流程使用。不同功能可能采用不同 token 存储或签名机制，不能推断所有邮箱验证链接都必须以明文 token 行出现在这张表中。

初学时按官方生成结果维护它，不自行删改内部值，不写自制“验证 token=用户邮箱”协议。我们后面通过公开 API 验证邮件与重置流程。

本教程还用数据库存限流计数，因此有第五张 `rate_limit` 表。它是配置驱动的额外表，不是 workspace 成员表。

## 3.5 Adapter 做什么，不做什么

Better Auth 用统一模型表达“创建一个 session”；adapter 把这个操作翻译到具体数据库工具。

```text
Better Auth 内部模型
  → @better-auth/drizzle-adapter
  → Drizzle 查询
  → pg 连接池
  → Postgres
```

配置的 `provider` 是 `"pg"`，不是 Drizzle Kit 的 `dialect: "postgresql"`。这些字符串处于不同 API 中，不能仅因为含义类似就互换。

最终实例的核心为：

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import * as authSchema from "./db/auth-schema.js";

return betterAuth({
  ...authOptions(env, send),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
    transaction: true,
  }),
});
```

`schema` 传入完整认证表导出，包含生成的 relations。`transaction: true` 很重要：Drizzle adapter 的认证事务不是因为用了 Postgres 就自动开启。重置密码时消费 token、撤销会话、修改密码需要这项能力共同提交。

adapter 不会自动为自有 task 加 workspace 检查。模型正确、SQL 能执行，与业务授权正确是两件事。

## 3.6 为什么需要一个 CLI 生成入口

从零项目还没有 `auth-schema.ts`。如果 `auth.ts` 必须 import 它，CLI 要加载 `auth.ts` 才能生成它，就产生了先有鸡还是先有蛋的问题。

本教程用 [auth-schema.config.ts](./example/src/auth-schema.config.ts) 解决：它复用认证配置，但创建不带已有 schema 的 Drizzle 实例，专用于 CLI 生成。

```ts
const env = readEnv(process.env);
const pool = new Pool({ connectionString: env.DATABASE_URL });
export const auth = betterAuth({
  ...authOptions(env, async () => {}),
  database: drizzleAdapter(drizzle(pool), {
    provider: "pg",
    transaction: true,
  }),
});
```

这个实例不接收用户流量。空邮件函数只存在于 schema 生成入口，不是运行时邮件配置。

从零跟做时，现在创建 [auth-options.ts](./example/src/auth-options.ts)、[mail.ts](./example/src/mail.ts) 与该 CLI 入口的完整文件。先保留最终配置，其中邮件与安全选项会在后续章节逐项拆解；不要在阅读到第 9 章前对真实用户开放服务。

## 3.7 第一次生成 schema

在你的项目根目录、已配置 `.env` 后执行：

```bash
npx auth@1.7.12 generate --config ./src/auth-schema.config.ts --output ./src/db/auth-schema.ts --yes
```

配套工程对应：

```bash
npm run auth:generate
```

命令产生 [auth-schema.ts](./example/src/db/auth-schema.ts)。它包含五张认证/限流表及 Relations v1 定义。**generate 生成 TypeScript 模型，不等于已经在数据库建表。**

首次在这个无已有 schema 的生成入口执行时，1.7.12 会打印 `Drizzle schema mismatch / Missing tables`，随后提示 `Schema was generated successfully`。这表示生成入口没有运行时表对象；并不是已经连接到数据库检查出真实缺表。不要通过关闭校验来掩盖最终运行实例的 schema 错误。

如果你使用配套工程，文件已经存在，可先跳过重新生成。后续升级时不要无审查覆盖它，第 14 章会做 diff。

## 3.8 建立本地 Postgres

已有专用 Postgres 可以直接建学习数据库；不要用生产库。

没有时，可在安装 Docker 后运行：

```bash
docker run --name harbor-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=harbor -p 127.0.0.1:5432:5432 -d postgres:17
```

这是本地教学配置：密码示例只用于绑定本机的数据库，不作为生产口令。容器名冲突时检查是否已有容器；不要为跟教程而删除已有业务数据。

稍后重开已存在容器可用 `docker start harbor-pg`。如果 5432 已被占用，可以选择另一个本地端口，并同步改 `DATABASE_URL`。

## 3.9 业务 schema 与统一迁移入口

认证 schema 单独放，业务表另写 [app-schema.ts](./example/src/db/app-schema.ts)。实际跟做时，**现在就按链接创建完整 app-schema.ts**，让后面完整 app/Service 的导入依赖就绪；成员与任务规则会在第 12 章逐行拆解。本章先理解其中最简单的 workspace：

```ts
export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
```

按本章链接建立完整文件时，三张业务表与认证表一起进入初始迁移，和配套工程一致。你也可以独立实验逐步增加表，因而产生多份迁移；这是正常的，但复制完整 Service 前必须先补齐全部业务表。

创建 `src/db/schema.ts`：

```ts
export * from "./auth-schema.js";
export * from "./app-schema.js";
```

创建 `drizzle.config.ts`：

```ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";
if (!process.env.DATABASE_URL) throw new Error("需要 DATABASE_URL");
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL },
});
```

现在执行：

```bash
npx drizzle-kit generate
```

打开 `drizzle/*.sql`，确认包含 `user`、`account`、`session`、`verification`、`rate_limit`；若加入了业务表，也会一起出现。确认数据库目标正确、没有意外 DROP 后再执行：

```bash
npx drizzle-kit migrate
```

命令分工必须记牢：

```text
auth generate         Better Auth 配置 → Drizzle 认证 schema
drizzle-kit generate  全部 Drizzle schema → 版本化 SQL 迁移
drizzle-kit migrate   版本化 SQL → 真正的数据库结构
```

本项目不要运行 `auth migrate`：它只适用于内建 Kysely adapter 的直接迁移，不用于 Drizzle adapter。也不要用 `push` 绕过你刚建立的版本化历史。

## 3.10 连上最终运行实例

先创建 [types.ts](./example/src/db/types.ts)：

```ts
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema.js";
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
```

它让后续工厂与 Service 接受 Postgres 数据库/事务能力，测试可传 PGlite 实例，不用 any 强转。然后按完整链接创建 [client.ts](./example/src/db/client.ts)、[auth-factory.ts](./example/src/auth-factory.ts)、[auth.ts](./example/src/auth.ts)。核心连接是：

```ts
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
const db = drizzle(pool, { schema });
const auth = createAuth(db, env, createMailer(env));
```

不要在每条请求中 `new Pool()`。连接池是进程资源，应用关闭时要 `pool.end()`。生产连接要求 TLS、连接预算与权限隔离，不能通过 `rejectUnauthorized: false` 随意跳过证书校验。

运行 `npm run typecheck` 检查类型；配置好 `.env` 后 `npm run auth:check` 检查运行时认证 schema。注意：Drizzle schema check 检查本地 schema 对象，**不证明数据库迁移已应用**。下一章通过真实请求继续验证。

## 3.11 练习与验收

练习：把生成 schema 中 session 的 userId 引用画出来，再画 task 的 createdBy 引用。两者为何不能用邮箱？

参考：稳定身份 ID 不随邮箱改变；session 与 task 有不同生命周期。账户删除、任务保留与转交策略必须单独设计。

- [ ] 能说出 User、Account、Session、Verification 的区别。
- [ ] 知道密码哈希属于 credential account，不是 user 明文列。
- [ ] 分清 adapter、连接池和 ORM 的职责。
- [ ] 真正审阅并应用过一份 SQL 迁移。
- [ ] 知道 generate、schema check、migrate 分别证明什么。

官方阅读：[Database](https://better-auth.com/docs/concepts/database)、[Drizzle Adapter](https://better-auth.com/docs/adapters/drizzle)、[CLI](https://better-auth.com/docs/concepts/cli)、[PostgreSQL](https://better-auth.com/docs/adapters/postgresql)。
