# 从 0 到 1：Better Auth + Fastify + PostgreSQL 安全认证实战教程

> 适用读者：会一点 JavaScript/TypeScript，知道 HTTP API 和数据库是什么，但还没有独立搭建过完整认证系统的人。
>
> 学习目标：不只是“让登录接口返回成功”，而是理解身份认证、会话、业务授权各自的责任，并搭出一个具有 workspace/task 场景的后端，知道如何验证它没有把用户 A 的权限泄露给用户 B。
>
> 版本说明：本文按撰写时 Better Auth 官方安装文档标示的稳定版 **1.7.12** 以及当前官方 Fastify、Database、Session、Security 文档组织。Better Auth 迭代较快；升级依赖时，务必重新阅读文末官方文档、重新生成 schema 并检查迁移差异，不要假设多年以前的博客代码仍然适用。

## 阅读路线

- [第 1 章：安全模型](#第-1-章先建立正确的安全模型)
- [第 2 章：创建项目与 PostgreSQL](#第-2-章创建项目和-postgresql)
- [第 3 章：Better Auth 数据模型](#第-3-章理解-better-auth-的数据库模型)
- [第 4 章：Drizzle 连接与 schema 生成](#第-4-章连接-drizzle-与生成-better-auth-schema)
- [第 5 章：workspace/task 业务 schema](#第-5-章建立-workspace成员和-task-的业务-schema)
- [第 6 章：migration 生命周期](#第-6-章迁移数据库不要让-schema-和数据库漂移)
- [第 7 章：认证和 session 配置](#第-7-章把认证方式安全默认值和生命周期配起来)
- [第 8 章：邮件与 OAuth](#第-8-章邮箱验证重置密码和-oauth-不是只写一个开关)
- [第 9 章：Fastify handler](#第-9-章将认证接入-fastify)
- [第 10 章：CORS、Cookie 与 CSRF](#第-10-章corscookiecredentials-与-csrf)
- [第 11 章：每条 API 验证 session](#第-11-章每条受保护-api-都验证会话)
- [第 12 章：RBAC、ownership 与租户边界](#第-12-章在业务层执行-rbac-与-ownership-检查)
- [第 13 章：安全运营和速率限制](#第-13-章速率限制枚举暴力破解与安全事件)
- [第 14 章：安全测试](#第-14-章逐项测试用行为验收而不是能登录就算好了)
- [第 15 章：排错](#第-15-章常见失败原因与排查顺序)
- [第 16 章：上线前验收清单](#第-16-章上线前检查清单完成后逐项打勾)

---

## 第 1 章：先建立正确的安全模型

假设我们正在开发一个团队任务系统：用户登录后可以进入 workspace，查看任务、创建任务、修改自己的任务；workspace 管理员可以管理本 workspace 的所有任务和成员。

这个系统至少有三种不同的问题。

1. **认证（Authentication）：你是谁？** 用户通过邮箱密码或 OAuth 登录。服务器验证登录凭据，并确认本次请求带有有效会话。
2. **会话（Session）：你上次登录建立的身份凭据现在还有效吗？** 服务端通过 Cookie 找到会话，判断是否过期、是否撤销，再确定当前用户是谁。
3. **授权（Authorization）：你可以对这个具体资源做什么？** 即使用户已登录，也必须检查他是否是 workspace 成员、角色是否允许该动作、是否拥有要编辑的 task。

三者不能互相替代。假设 Bob 登录成功，浏览器也持有有效会话；这只能说明请求来自 Bob 的登录会话，**不代表 Bob 有权读取 Alice 的 workspace**。类似地，前端不显示“删除”按钮并不等于后端禁止删除，因为攻击者可以直接发 HTTP 请求。

一个受保护请求的正确顺序通常是：

1. 读取 Cookie，并由 Better Auth 验证 session。
2. 没有有效 session 就返回 `401 Unauthorized`。
3. 查询目标 workspace/task 是否存在，以及当前用户是否属于相应租户。
4. 根据资源归属和角色决定是否允许操作。
5. 未授权时返回 `403 Forbidden`，或在不希望泄露资源存在性时返回 `404 Not Found`。
6. 只查询/修改当前授权范围内的数据。

本教程采用以下教学策略：Better Auth 管用户身份、密码、会话、验证令牌及登录流程；我们自己的 Drizzle schema 管 `workspace`、`workspace_member` 和 `task` 业务数据。成员关系和任务权限在业务层明确检查，不把“拿到了 session”误认为“可以访问全部业务表”。

官方概念入口：
- [Better Auth Installation](https://better-auth.com/docs/installation)
- [Database Concepts](https://better-auth.com/docs/concepts/database)
- [Session Management](https://better-auth.com/docs/concepts/session-management)
- [Security](https://better-auth.com/docs/reference/security)

## 第 2 章：创建项目和 PostgreSQL

### 2.1 环境和目录

建议使用受支持的现代 Node.js LTS 版本（本文示例使用 Node.js 20+），并使用 TypeScript 与 ES modules。创建项目：

```bash
mkdir workspace-auth-demo
cd workspace-auth-demo
npm init -y
npm install better-auth fastify @fastify/cors drizzle-orm pg dotenv resend
npm install -D typescript tsx drizzle-kit @types/node @types/pg
```

在 `package.json` 中设置模块类型和开发命令：

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  }
}
```

上面是需要合并进你现有 `package.json` 的字段，不要用它覆盖 npm 已生成的全部依赖信息。建议的目录如下：

```text
workspace-auth-demo/
  src/
    auth.ts
    server.ts
    email.ts
    db/
      client.ts
      auth-schema.ts       # 由 Better Auth CLI 生成，文件名可以按你的选择调整
      app-schema.ts        # 自己维护的业务表
  drizzle/                 # Drizzle 生成的 SQL migration
  drizzle.config.ts
  .env
  .gitignore
```

### 2.2 启动开发用 PostgreSQL

如果本机已经有 PostgreSQL，可以直接使用。也可以用 Docker 启动一个仅用于本地开发的实例：

```bash
docker run --name workspace-auth-pg \
  -e POSTGRES_USER=app_user \
  -e POSTGRES_PASSWORD=local_dev_only_change_me \
  -e POSTGRES_DB=workspace_auth \
  -p 5432:5432 -d postgres:16
```

生产环境不要沿用示例口令；数据库不要暴露给公网；给应用创建权限受限的数据库用户，备份中也要保护身份信息和会话数据。

### 2.3 环境变量和秘密管理

生成高熵密钥：

```bash
openssl rand -base64 32
```

创建 `.env`：

```dotenv
NODE_ENV=development
PORT=4000
DATABASE_URL=postgres://app_user:local_dev_only_change_me@localhost:5432/workspace_auth
BETTER_AUTH_SECRET=替换成上面生成的高熵随机值
BETTER_AUTH_URL=http://localhost:4000
TRUSTED_ORIGINS=http://localhost:3000,http://localhost:4000
RESEND_API_KEY=替换成真实的邮件服务商API密钥
EMAIL_FROM=Workspace Demo <auth@your-verified-domain.example>
```

`BETTER_AUTH_SECRET` 至少应为 32 字符的高熵秘密，不要提交进 Git、发到聊天记录或写入日志。生产使用 secret manager/部署平台的秘密配置。`BETTER_AUTH_URL` 是认证服务自己的规范 URL；它不是前端地址。`TRUSTED_ORIGINS` 列出真正允许发起浏览器认证请求的 origin，包含协议、主机和端口，不包含路径。示例同时列出了前端 `localhost:3000` 与 API `localhost:4000`；生产环境换成你实际使用的前端和 API HTTPS origin。

添加 `.gitignore`：

```gitignore
.env
node_modules/
dist/
```

创建 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "drizzle.config.ts"]
}
```

## 第 3 章：理解 Better Auth 的数据库模型

Better Auth 的数据库不只是一个 `users` 表。核心模型通常包括：

- **`user`**：应用中的用户身份与个人资料，例如 ID、姓名、邮箱及邮箱验证状态。
- **`account`**：用户绑定的认证账户。邮箱密码凭据和 Google/GitHub 等 OAuth provider 账户都需要有地方关联到本地 user；密码哈希也存放在 credential account，而不是以明文形式放在 user 表中。
- **`session`**：已建立的登录会话，包含 token、所属 user、过期时间和请求环境信息等。会话可被续期或撤销。
- **`verification`**：验证用途的临时记录，例如邮箱验证与重置密码流程使用的验证数据。
- **插件表**：启用组织、双因素认证或其他插件后，可能增加字段或表。

这些是认证基础设施的数据，不等于业务领域数据。`workspace`、`task`、账单、项目权限和租户成员关系属于你自己的业务 schema。不要为了方便把整个业务模型塞进 Better Auth 的 user 表，也不要手动改写 Better Auth 管理的字段而不理解适配器映射。

Better Auth 官方会根据当前配置和插件生成 schema。**不要凭记忆手抄整套核心表**；官方 schema 是配置、插件和版本共同决定的。

官方参考：[Database Concepts—Core Schema and CLI](https://better-auth.com/docs/concepts/database)。

## 第 4 章：连接 Drizzle 与生成 Better Auth schema

### 4.1 先创建数据库连接

新建 `src/db/client.ts`：

```ts
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Missing DATABASE_URL");

export const pool = new Pool({ connectionString });

// 第一次生成 Better Auth schema 前先用这个基础版本。
// schema 生成后，按本章 4.3 节把 schema 参数补进去。
export const db = drizzle(pool);
```

这里有两个不同角色：`pg.Pool` 管 PostgreSQL 连接池；`drizzle` 提供类型安全的 SQL 查询接口。Better Auth 通过 Drizzle adapter 使用同一个数据库。不要为认证单独创造一套没有必要的、难以迁移的业务数据库连接。

### 4.2 创建 Better Auth 实例，然后生成 schema

先新建 `src/auth.ts` 的最小骨架，以便 CLI 找到认证配置：

```ts
import "dotenv/config";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db/client.js";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
  },
  // 在第一次 generate 之前就声明数据库 rate limit，确保 CLI 能生成需要的表。
  rateLimit: {
    enabled: true,
    window: 10,
    max: 100,
    storage: "database",
    customRules: {
      "/sign-in/email": { window: 10, max: 3 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },
});
```

在项目根目录执行：

```bash
npx auth@latest generate
```

CLI 会根据当前 Better Auth 配置生成需要的 ORM schema。将生成的 Drizzle schema 放到 `src/db/auth-schema.ts`，或者保留 CLI 给出的路径并统一修改后续 import。不同版本/CLI 参数可能有差别，生成后务必看清 CLI 输出，不要凭空假设输出路径。

**为什么是 generate 而不是 migrate？** Better Auth 的 `migrate` 命令适用于内置 Kysely adapter 的直接迁移流程；使用 Drizzle 时，应由 Better Auth 生成 schema，再由 Drizzle Kit 根据 schema 产生和应用 SQL migration。这能把迁移文件纳入代码评审和版本控制。

### 4.3 将生成的 schema 交给 Drizzle

生成成功后，改写 `src/db/client.ts`。假设 CLI 产出的文件导出了 `user`、`session`、`account`、`verification` 等表：

```ts
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as authSchema from "./auth-schema.js";
import * as appSchema from "./app-schema.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Missing DATABASE_URL");

export const pool = new Pool({ connectionString });
export const schema = { ...authSchema, ...appSchema };
export const db = drizzle(pool, { schema });
```

在业务 schema 尚未创建的短暂阶段，先只 import `authSchema`；第 5 章创建 `app-schema.ts` 后再合并。随后把 `auth.ts` 里的 adapter 修改为：

```ts
database: drizzleAdapter(db, {
  provider: "pg",
  schema,
}),
```

同时在 `auth.ts` 顶部将 import 改为：

```ts
import { db, schema } from "./db/client.js";
```

`schema` 的明确传递能让 Drizzle adapter 知道表定义。若你的当前稳定版生成格式与示例略有不同，以 CLI 实际生成的 schema 和对应官方 adapter 文档为准；不要把 beta 文档的包名和当前稳定版混用。本文使用稳定版文档里的 `better-auth/adapters/drizzle` 导入路径。

### 4.4 配置 Drizzle Kit

新建 `drizzle.config.ts`：

```ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Missing DATABASE_URL");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/*.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
```

注意 `schema` 指向 TypeScript schema 源文件，不是 PostgreSQL 表名，也不是 SQL migration 目录。

## 第 5 章：建立 workspace、成员和 task 的业务 schema

现在开始定义应用的授权边界。下面使用简单角色：

- `owner`：workspace 所有者，可以管理整个 workspace。
- `admin`：可以管理本 workspace 的任务和成员，但不能越过 workspace 边界。
- `member`：可读 workspace 任务，并可编辑自己创建的任务。
- `viewer`：只读。

角色不是认证身份。用户的角色必须来自可信数据库记录，不能直接接受客户端 body 里传来的 `role: "admin"`。

新建 `src/db/app-schema.ts`。此文件引用 CLI 生成的 `user` 表，实际导出名称以生成文件为准：

```ts
import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  text,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export const workspaces = pgTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workspaceMembers = pgTable(
  "workspace_member",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<WorkspaceRole>().notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    check(
      "workspace_member_role_check",
      sql`${table.role} in ('owner', 'admin', 'member', 'viewer')`,
    ),
  ],
);

export const tasks = pgTable(
  "task",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id),
    title: text("title").notNull(),
    status: text("status").$type<"open" | "done">().notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("task_status_check", sql`${table.status} in ('open', 'done')`),
  ],
);
```

如果你的 Drizzle 版本对 `pgTable` 的约束回调语法提示类型错误，先核对安装的 Drizzle 版本文档再改写语法；不能因为 TypeScript 的 `$type` 通过检查，就以为数据库值已被约束，所以这里还用 PostgreSQL `check` 约束角色和状态。

这里有三条重要设计：

1. `workspace_member` 的复合主键防止同一用户在同一 workspace 里出现重复成员记录。
2. `task.workspace_id` 确保任务属于某个 workspace。所有 task 查询还必须把 workspace ID 放进查询条件，不能只凭 task ID 取记录。
3. `created_by_user_id` 由服务端 session 的用户 ID 填写，而不是信任客户端请求体。

## 第 6 章：迁移数据库——不要让 schema 和数据库漂移

首次生成认证表和业务表后，执行：

```bash
npm run db:generate
```

打开 `drizzle/` 新生成的 SQL 文件，逐行检查它是否符合预期：是否创建了 Better Auth 需要的 `user`、`account`、`session`、`verification` 表；是否创建了业务表；外键是否指向正确表；是否有不必要的删除或类型变更。然后在本地开发数据库执行：

```bash
npm run db:migrate
```

不要在生产环境直接运行未经审查的 schema push，也不要在部署启动时让每个服务实例抢着执行 DDL migration。生产流程应是：生成 migration → code review → 备份/评估回滚策略 → 单独执行 migration → 部署依赖新 schema 的应用版本。

以后如果你启用插件、增加 Better Auth 配置字段或升级版本：

1. 阅读对应版本的升级说明和插件 schema 要求。
2. 重新运行 `npx auth@latest generate`，查看生成的 schema diff。
3. 与你自己的 `app-schema.ts` 区分开，不要让生成器意外覆盖业务表。
4. 运行 `npm run db:generate` 生成增量 SQL。
5. 检查是否包含字段重命名、删除、非空列、索引和外键变化；必要时先做兼容性迁移。
6. 在临时数据库恢复备份并执行 migration，再跑认证和业务测试。
7. 部署后执行 schema 检查，并查看 Better Auth 的 schema 验证日志。

不要把 `npx auth@latest migrate` 当成 Drizzle migration 的替代品。官方 Database 文档明确区分了内置 Kysely adapter 的 migrate 与 Drizzle/Prisma 这类 ORM 的 generate 工作流。

## 第 7 章：把认证方式、安全默认值和生命周期配起来

### 7.1 认证配置

把 `src/auth.ts` 整理成类似下面的结构。示例中的 `sendTransactionalEmail` 是第 8 章要接入真实邮件服务的业务函数，不是 Better Auth 自动替你发送邮件的魔法函数。

```ts
import "dotenv/config";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "./db/client.js";
import { sendTransactionalEmail } from "./email.js";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (trustedOrigins.length === 0) {
  throw new Error("TRUSTED_ORIGINS must contain at least one explicit origin");
}

export const auth = betterAuth({
  appName: "Workspace Auth Demo",
  baseURL: requiredEnv("BETTER_AUTH_URL"),
  secret: requiredEnv("BETTER_AUTH_SECRET"),

  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),

  trustedOrigins,

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    requireEmailVerification: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // 生产环境建议把消息可靠地写入队列；不要把重置 token/链接写入日志。
      void sendTransactionalEmail({
        to: user.email,
        subject: "重置密码",
        text: `请打开以下链接重置密码：${url}`,
      }).catch((error) => {
        console.error("password-reset email enqueue failed", error instanceof Error ? error.message : "unknown");
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: false,
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      // 生产环境建议 enqueue 到可靠邮件队列；服务端日志不要记录 url/token。
      void sendTransactionalEmail({
        to: user.email,
        subject: "验证你的邮箱",
        text: `请打开以下链接验证邮箱：${url}`,
      }).catch((error) => {
        console.error("verification email enqueue failed", error instanceof Error ? error.message : "unknown");
      });
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 会话 7 天后到期
    updateAge: 60 * 60 * 24,    // 达到 1 天更新阈值后，续期到 expiresIn
    freshAge: 60 * 60 * 24,     // 新会话被视为 fresh 的时长
    // 为了让撤销更直接可见，本教程不启用长寿命 cookieCache。
  },

  advanced: {
    // 生产 HTTPS 下强制 Secure；本地 HTTP 开发环境不应打开，否则 Cookie 不会被普通 HTTP 发送。
    useSecureCookies: process.env.NODE_ENV === "production",
  },

  rateLimit: {
    enabled: true,
    window: 10,
    max: 100,
    storage: "database",
    customRules: {
      "/sign-in/email": { window: 10, max: 3 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },
});
```

此配置选择数据库 rate limit 存储，以便多实例部署时共享计数状态；schema 生成时必须包含当前配置所需的 rate-limit 表。如果你的部署架构暂时只运行单实例，可以先使用默认内存存储，但要清楚它在多实例间不共享。Better Auth 默认在生产开启速率限制、开发环境默认关闭；这里显式开启，方便本地也能验收。

不要在没有邮件发送器的情况下把 `requireEmailVerification` 当作“已经完成邮箱验证”：如果邮件无法真正交付，用户可能永远无法完成流程。下一章会解释如何接好邮件。

### 7.2 密码哈希不要自己造轮子

Better Auth 默认使用 scrypt 对密码做哈希，而不是明文存储。哈希意味着数据库泄露时攻击者拿到的不是原始密码；但弱密码依然会遭受离线猜测，所以还需要合理密码长度、泄露监控、速率限制与二次验证等措施。不要自己发明“MD5 加盐”之类的密码存储方案。

如果组织有明确的 Argon2id 策略，可以通过 Better Auth 的 `emailAndPassword.password.hash` 和 `verify` 替换默认实现；这必须同时正确实现旧哈希兼容、参数管理和升级迁移。新手项目先保留官方默认通常更稳妥。

### 7.3 会话到期、续期、fresh 和撤销

会话生命周期不是一个单独的 Cookie `Max-Age` 设置。数据库中的 session 有过期时间；Cookie 只是浏览器携带会话凭据的方式。官方默认会话有效期为 7 天，`updateAge` 默认是 1 天；当会话使用达到续期阈值时，过期时间会被更新。本文显式设置了 7 天和 1 天，方便理解。

- **到期**：过了 `expiresAt` 的会话不能当作有效身份。
- **续期**：活跃用户可以按 `updateAge` 规则延长会话，不能把“Cookie 还存在”当成“服务端 session 一定有效”。
- **撤销**：登出、用户注销其他设备、密码重置或安全事件可以让 session 失效。
- **fresh session**：高风险操作可能需要最近重新认证。不要因为用户有长期有效会话，就允许他无提示地更改密码、绑定新 OAuth 账户或提升自己的权限。

如果未来启用 `session.cookieCache`，需要特别理解撤销延迟：缓存 Cookie 可能在短缓存期内保留旧的 session 信息。因此，对要求立即撤销的敏感操作，应禁用缓存或使用很短的缓存期限，并在安全操作时强制从服务端重新核验。

参考：[Session Management](https://better-auth.com/docs/concepts/session-management)。

## 第 8 章：邮箱验证、重置密码和 OAuth 不是只写一个开关

### 8.1 真实邮件交付

Better Auth 提供发送验证邮件和重置密码邮件的回调，但它不会自动替你创建邮件服务商账号、配置 DNS、完成发件人认证或保证邮件进收件箱。你需要接入 Resend、Amazon SES、Postmark、SMTP 等真实事务邮件服务。

本教程用 Resend 展示一份真实 SDK 实现。安装包时已经加入 `resend`；在 Resend 控制台取得 API key，并按供应商要求验证发件域名后，将 `RESEND_API_KEY` 和 `EMAIL_FROM` 配入服务器环境。示例中的 `.example` 域名只是占位符，不能真实投递；生产时必须换成已经验证的发件地址。

```ts
// src/email.ts
import { Resend } from "resend";

export type TransactionalEmail = {
  to: string;
  subject: string;
  text: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const resend = new Resend(requiredEnv("RESEND_API_KEY"));
const from = requiredEnv("EMAIL_FROM");

export async function sendTransactionalEmail(message: TransactionalEmail): Promise<void> {
  const { error } = await resend.emails.send({
    from,
    to: [message.to],
    subject: message.subject,
    text: message.text,
  });
  if (error) throw new Error(`Email provider rejected message: ${error.message}`);
}
```

Resend 官方 Node.js 示例使用 `new Resend(...)` 和 `resend.emails.send(...)` 发送邮件（[Resend Node.js 文档](https://resend.com/nodejs)）。开发测试也可以使用邮件沙箱；生产中更稳妥的方式是先把消息可靠地写入队列，异步发送并监控失败。上面的 `void ...catch(...)` 是为了让认证响应不直接等待慢速邮件发送，**不是**可靠队列的替代品。无服务器环境还要使用平台提供的 `waitUntil` 或等价机制，防止请求返回后任务被直接终止。

验证链接的域名和回调地址应来自你控制的 `BETTER_AUTH_URL` 与受信任回调配置，不能直接接受任意用户输入后拼成 URL。检查发件域名的 SPF、DKIM、DMARC 设置，设置邮件供应商 webhook/告警，并实际点击一遍验证链接与密码重置链接。

启用 `requireEmailVerification: true` 后，未验证的邮箱不能正常建立密码登录会话；同时前端需要展示“请检查邮箱”的用户体验。不要用不同的明显错误消息泄漏某个邮箱是否已注册。Better Auth 在启用邮箱验证的特定注册流程中会使用合成成功响应来减少邮箱枚举风险，但你的 UI、日志和自定义接口也必须避免泄露。

### 8.2 密码重置

重置密码邮件应发送短时效链接，本文把 token 有效期设为 1 小时，并开启 `revokeSessionsOnPasswordReset`。重置成功后要求用户重新登录通常比继续信任所有旧设备更安全。重置 URL 只能跳转到允许的回调地址；不能关闭 origin 校验来“解决”回调错误。

用户修改自己的密码时，Better Auth 客户端支持 `changePassword` 的 `revokeOtherSessions: true`，以撤销其他活动会话。用户还可以查看活动 session 并撤销某个设备、其他设备或所有会话。真实应用应为这些操作提供明确界面，并把撤销结果写入安全审计日志。

### 8.3 OAuth（例如 Google/GitHub）

只有确实需要时才启用 OAuth。在 `auth.ts` 中配置 provider 的 client ID 和 client secret，例如：

```ts
socialProviders: {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  },
},
```

同时：

1. 在 Google/GitHub 开发者控制台注册应用。
2. 把服务端计算出的、与 Better Auth 配置相匹配的 callback URL 注册到 provider。默认回调路径通常为 `/api/auth/callback/<provider>`；以当前版本文档和运行时配置为准。
3. 将 client secret 放在服务器秘密管理系统中，不要下发到前端。
4. 给新用户、已有用户和账户绑定设计清晰规则；不要把“provider 返回一个同名邮箱”随意视为已授权的账户绑定依据。
5. 逐一验证正确回调、错误回调、取消授权、过期 state、未允许的 redirect URL 与生产域名。

官方参考：[OAuth](https://better-auth.com/docs/concepts/oauth)、[Email](https://better-auth.com/docs/concepts/email)。

## 第 9 章：将 Better Auth 接入 Fastify

Better Auth 通过统一 handler 接收 `/api/auth/*` 请求。Fastify 的业务路由仍由你自己控制。此处使用官方 Fastify 集成文档的思路：把 Fastify 请求头转换为标准 `Headers`，再构造 Fetch API `Request` 交给 `auth.handler`，最后把 `Response` 转回 Fastify 响应。

新建 `src/server.ts`：

```ts
import "dotenv/config";
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.js";

const app = Fastify({ logger: true });
const publicAuthUrl = process.env.BETTER_AUTH_URL;
if (!publicAuthUrl) throw new Error("Missing BETTER_AUTH_URL");

const trustedOrigins = new Set(
  (process.env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

await app.register(fastifyCors, {
  origin(origin, callback) {
    // 没有 Origin 的请求（例如某些命令行客户端）不需要浏览器 CORS 响应头。
    // 对有 Origin 的浏览器请求，必须匹配明确的允许列表。
    if (!origin || trustedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed"), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  maxAge: 86400,
});

app.route({
  method: ["GET", "POST"],
  url: "/api/auth/*",
  async handler(request, reply) {
    try {
      // 使用部署时配置的规范 URL 作 base，避免把未验证的 Host 头用作信任来源。
      const url = new URL(request.url, publicAuthUrl);
      const headers = fromNodeHeaders(request.headers);
      const method = request.method.toUpperCase();

      const init: RequestInit = {
        method,
        headers,
      };
      // 本示例假定认证 POST body 使用 JSON；GET/HEAD 不能构造带 body 的 Request。
      if (request.body !== undefined && method !== "GET" && method !== "HEAD") {
        init.body = JSON.stringify(request.body);
      }

      const response = await auth.handler(new Request(url, init));
      reply.status(response.status);

      // Set-Cookie 应单独保留，不能把多条 Set-Cookie 合成一条逗号分隔字符串。
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
      });
      const setCookies = response.headers.getSetCookie(); // Node.js 20+
      if (setCookies.length > 0) reply.header("set-cookie", setCookies);

      if (response.body === null) return reply.send();
      return reply.send(await response.text());
    } catch (error) {
      request.log.error({ err: error }, "Better Auth handler failed");
      return reply.status(500).send({ error: "Internal authentication error" });
    }
  },
});

app.get("/health", async () => ({ ok: true }));

// 后续章节的 /api/me 和 workspace/task 路由必须放在这一行之前注册。
const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
```

**安全说明：**

- 这是一个面向常见 JSON 认证请求的 Fastify handler 示例。若你启用了使用其他 Content-Type 或原始请求体的插件，应确保原始 body 被正确转发，而不是无条件 `JSON.stringify`。
- 使用 `getSetCookie()` 逐条转发多个 `Set-Cookie`，避免 session cookie、OAuth state cookie 等在代理层被错误合并。Node 20+ 支持此接口。
- 生产环境应正确配置代理与 TLS。只有当你的服务确实位于可信反向代理后面时，才配置 Fastify `trustProxy`；否则攻击者可能伪造转发 IP 头，影响审计和速率限制。
- `auth.handler` 不会替你给所有自定义 `/api/workspaces/*` 业务路由做授权；业务路由还要显式调用 `auth.api.getSession` 并检查成员关系。

官方参考：[Fastify Integration](https://better-auth.com/docs/integrations/fastify)。

## 第 10 章：CORS、Cookie、credentials 与 CSRF

这些配置经常被混为一谈，但它们回答的是不同问题：

- **CORS**：浏览器是否允许某个 origin 的 JavaScript 读取响应，以及预检请求如何响应。
- **Cookie 属性**：浏览器在什么条件下保存和发送 Cookie；`HttpOnly` 限制前端 JavaScript 读取，`Secure` 要求 HTTPS，`SameSite` 限制部分跨站请求携带 Cookie。
- **Trusted origins**：Better Auth 对来源和回调/跳转 URL 的信任策略。
- **CSRF 防护**：阻止攻击者借受害者浏览器自动携带的 Cookie，诱导服务端执行敏感动作。
- **授权**：即使请求通过了 CORS/CSRF 检查，当前用户仍然只能访问自己有权限的资源。

### 10.1 前端必须发送 credentials

当前前后端本地部署示例为 `http://localhost:3000` 与 `http://localhost:4000`，origin 不同。浏览器调用受保护 API 时：

```ts
const response = await fetch("http://localhost:4000/api/me", {
  method: "GET",
  credentials: "include",
});
```

跨 origin Cookie 请求需要 `credentials: "include"`。服务端必须明确允许前端 origin，并设置 `credentials: true`。当允许凭据时，不能使用 `Access-Control-Allow-Origin: *`；应返回具体的受信任 origin。`Authorization` header 与 Cookie 认证也不是一回事；本教程走的是 Cookie session。

### 10.2 Cookie 属性和跨子域部署

Better Auth 默认使用 Cookie-based session。主 `session_token` Cookie 是服务端 session 的标识；启用 `session.cookieCache` 后还可能有 `session_data` 缓存 Cookie，它不是同一个东西。

官方默认 Cookie 使用 `HttpOnly`，生产环境启用 `Secure`，默认 `SameSite=Lax`。生产务必通过 HTTPS 提供服务；开发 HTTP 环境不要误设 `Secure=true`，否则浏览器不会像预期那样通过 HTTP 发送 Cookie。

跨子域的推荐顺序：

1. 先尝试让浏览器向固定 API 子域发请求，保持 host-only cookie，不共享到整个根域。
2. 只有确实需要 `app.example.com`、`admin.example.com` 等子域共用 Cookie 时，才配置 `crossSubDomainCookies` 的 domain。
3. 根域 Cookie 会扩大信任范围：任何被攻陷或由不可信团队托管的子域都可能增加风险。绝不要把不可信的 `user-content.example.com` 与认证 Cookie 随意共享。
4. 如果前端与 API 是真正的跨站点不同站点（例如 `frontend.example.net` 与 `api.example.com`），通常需要 `SameSite=None; Secure` 才能携带 Cookie，但浏览器的第三方 Cookie 策略仍可能阻止它；CORS 配对并不能保证第三方 Cookie 一定工作。能改成同站部署时，通常更简单可靠。

### 10.3 Trusted origins 与 CSRF

`trustedOrigins` 应配置精确 origin，例如：

```dotenv
TRUSTED_ORIGINS=https://app.example.com,https://api.example.com
```

不要将客户端提交的 `callbackURL`、`redirectTo` 直接当作任意跳转目标；也不要为了消除错误而开启 `disableCSRFCheck` 或 `disableOriginCheck`。官方安全文档明确警告，这会放开 CSRF 或开放重定向风险。

重要细节：Better Auth 自带的来源校验保护其认证 handler，并不意味着你自己写的所有 Fastify 业务 mutation 自动获得同等 CSRF 防护。对于基于 Cookie 的 `POST`、`PUT`、`PATCH`、`DELETE` 业务路由，也应该校验可信 `Origin`，并根据风险采用 anti-CSRF token 或框架推荐的 CSRF 策略。下面第 11 章会把“需要可信来源”和“必须已登录”作为两项独立检查。

官方参考：[Cookies](https://better-auth.com/docs/concepts/cookies)、[Security](https://better-auth.com/docs/reference/security)、[Fastify Integration](https://better-auth.com/docs/integrations/fastify)。

## 第 11 章：每条受保护 API 都验证会话

现在实现 `/api/me`。不要只在前端页面加载时检查一次登录状态；那只改善 UI，不能保护 API。每条受保护请求都必须从本次 HTTP 请求中取 session。

在 `src/server.ts` 继续添加以下路由。`fromNodeHeaders` 在第 9 章已经导入过；若你按章节逐步合并代码，请只保留一条 import，不要重复声明。**所有路由都必须在 `await app.listen(...)` 之前注册**；为方便逐章学习，先把第 9 章 `listen` 两行移到文件末尾。

```ts
app.get("/api/me", async (request, reply) => {
  const current = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });

  if (!current) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  // 只返回客户端确实需要的安全字段，不要返回 account token、内部字段等。
  return reply.send({
    user: {
      id: current.user.id,
      name: current.user.name,
      email: current.user.email,
      emailVerified: current.user.emailVerified,
    },
    session: {
      expiresAt: current.session.expiresAt,
    },
  });
});
```

不要自行解析 Cookie 后就信任其中的 user ID，也不要只验证 JWT 签名而忽略服务端会话撤销策略。让 Better Auth 来解析并核验 session。

为避免每个路由复制粘贴，可以抽成 helper；但 helper 的语义一定要明确：没有 session 时结束请求并返回 401；调用者不能忽略“没有用户”的结果后继续访问数据库。

对管理员设置、密码/账户安全变更等高风险操作，还应要求近期重新认证，而不只依赖几天前建立的 session。

## 第 12 章：在业务层执行 RBAC 与 ownership 检查

本章是安全系统最重要的一章。会话验证只回答“当前是谁”，并不回答“当前用户能访问什么”。

### 12.1 可信来源检查 helper

对基于 Cookie 的浏览器 mutation，要求有 `Origin` 且与明确允许列表匹配。示例采取默认拒绝：没有 Origin 的非浏览器客户端应设计单独的 API 身份方案，而不是悄悄绕过检查。

```ts
const trustedOrigins = new Set(
  (process.env.TRUSTED_ORIGINS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean),
);

function requireTrustedMutationOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true;
  const origin = request.headers.origin;
  if (origin && trustedOrigins.has(origin)) return true;
  reply.code(403).send({ error: "Untrusted origin" });
  return false;
}
```

在严格 TypeScript 项目中，你可以把 helper 的 request/reply 类型改为 Fastify 自己的类型；这里重点是策略，不是强迫某个类型注解写法。此 helper 不能替代 Better Auth 对认证路由的 CSRF 防护，也不替代业务授权。

### 12.2 查询成员关系

在 `server.ts` 顶部合并尚未导入的依赖。第 9 章已经导入 `auth`、`fromNodeHeaders`，不要重复导入它们：

```ts
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "./db/client.js";
import { workspaceMembers, tasks } from "./db/app-schema.js";
import type { WorkspaceRole } from "./db/app-schema.js";
```

加一个用于读取当前会话的函数：

```ts
async function getCurrentSession(request: FastifyRequest) {
  return auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
}
```

在需要泛型的 Fastify 版本中，`request` 类型可直接使用 `FastifyRequest`；如 TypeScript 对 `fromNodeHeaders` 的类型推导报错，直接把参数改成 Fastify 的 `request.headers` 对应类型即可，不要用 `any` 把所有错误遮住。

接着建立成员查询函数：

```ts
async function getMembership(userId: string, workspaceId: string) {
  const [membership] = await db
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(
      eq(workspaceMembers.userId, userId),
      eq(workspaceMembers.workspaceId, workspaceId),
    ))
    .limit(1);

  return membership ?? null;
}

function roleCanRead(role: WorkspaceRole): boolean {
  return ["owner", "admin", "member", "viewer"].includes(role);
}

function roleCanCreateTask(role: WorkspaceRole): boolean {
  return ["owner", "admin", "member"].includes(role);
}

function canEditTask(role: WorkspaceRole, creatorUserId: string, currentUserId: string): boolean {
  if (role === "owner" || role === "admin") return true;
  if (role === "member" && creatorUserId === currentUserId) return true;
  return false; // viewer 只读；其他所有情况默认拒绝
}
```

不要只用 `roleCanRead` 判断所有动作。读、创建、更新、删除、分享、导出可能有不同的风险，应分别定义最小权限策略。

### 12.3 实现列出 workspace 任务

```ts
app.get<{ Params: { workspaceId: string } }>(
  "/api/workspaces/:workspaceId/tasks",
  async (request, reply) => {
    const current = await getCurrentSession(request);
    if (!current) return reply.code(401).send({ error: "Unauthorized" });

    const { workspaceId } = request.params;
    const membership = await getMembership(current.user.id, workspaceId);

    // 返回 404 可减少向非成员暴露 workspace 是否存在的信息。
    if (!membership || !roleCanRead(membership.role)) {
      return reply.code(404).send({ error: "Workspace not found" });
    }

    const rows = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        createdByUserId: tasks.createdByUserId,
        createdAt: tasks.createdAt,
      })
      .from(tasks)
      .where(eq(tasks.workspaceId, workspaceId));

    return reply.send({ tasks: rows });
  },
);
```

注意最后的 SQL 也加了 `tasks.workspaceId = workspaceId`。只验证成员关系但随后把数据库里所有 task 都查出来，同样是安全漏洞。

### 12.4 创建 task：角色从数据库来，creator 从 session 来

```ts
app.post<{
  Params: { workspaceId: string };
  Body: { title?: unknown };
}>(
  "/api/workspaces/:workspaceId/tasks",
  async (request, reply) => {
    if (!requireTrustedMutationOrigin(request, reply)) return;

    const current = await getCurrentSession(request);
    if (!current) return reply.code(401).send({ error: "Unauthorized" });

    const { workspaceId } = request.params;
    const membership = await getMembership(current.user.id, workspaceId);
    if (!membership) return reply.code(404).send({ error: "Workspace not found" });
    if (!roleCanCreateTask(membership.role)) {
      return reply.code(403).send({ error: "Insufficient permission" });
    }

    const title = request.body?.title;
    if (typeof title !== "string" || title.trim().length === 0 || title.length > 200) {
      return reply.code(400).send({ error: "Invalid title" });
    }

    const [created] = await db.insert(tasks).values({
      id: randomUUID(),
      workspaceId,
      createdByUserId: current.user.id,
      title: title.trim(),
      status: "open",
    }).returning({ id: tasks.id, title: tasks.title, status: tasks.status });

    return reply.code(201).send({ task: created });
  },
);
```

这里故意不接受客户端提交的 `createdByUserId`、`workspaceId` 或 `role`：workspaceId 来自被路由约束的路径，并在成员关系里核对；创建者来自已验证 session；角色来自 DB。对于正式应用，还应使用 Fastify JSON Schema 或 Zod 对 body 做完整校验，并校验 UUID/资源 ID 格式。

### 12.5 更新 task：同时校验租户、资源归属和角色

```ts
app.patch<{
  Params: { workspaceId: string; taskId: string };
  Body: { title?: unknown; status?: unknown };
}>(
  "/api/workspaces/:workspaceId/tasks/:taskId",
  async (request, reply) => {
    if (!requireTrustedMutationOrigin(request, reply)) return;

    const current = await getCurrentSession(request);
    if (!current) return reply.code(401).send({ error: "Unauthorized" });

    const { workspaceId, taskId } = request.params;
    const membership = await getMembership(current.user.id, workspaceId);
    if (!membership) return reply.code(404).send({ error: "Task not found" });

    const [task] = await db
      .select({
        id: tasks.id,
        workspaceId: tasks.workspaceId,
        createdByUserId: tasks.createdByUserId,
      })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
      .limit(1);

    if (!task) return reply.code(404).send({ error: "Task not found" });
    if (!canEditTask(membership.role, task.createdByUserId, current.user.id)) {
      return reply.code(403).send({ error: "Insufficient permission" });
    }

    const patch: { title?: string; status?: "open" | "done"; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (request.body?.title !== undefined) {
      if (typeof request.body.title !== "string" ||
          request.body.title.trim().length === 0 ||
          request.body.title.length > 200) {
        return reply.code(400).send({ error: "Invalid title" });
      }
      patch.title = request.body.title.trim();
    }
    if (request.body?.status !== undefined) {
      if (request.body.status !== "open" && request.body.status !== "done") {
        return reply.code(400).send({ error: "Invalid status" });
      }
      patch.status = request.body.status;
    }
    if (patch.title === undefined && patch.status === undefined) {
      return reply.code(400).send({ error: "No editable fields supplied" });
    }

    const [updated] = await db.update(tasks)
      .set(patch)
      .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)))
      .returning({ id: tasks.id, title: tasks.title, status: tasks.status });

    return reply.send({ task: updated });
  },
);
```

此策略定义了：owner/admin 可以编辑 workspace 中任何任务；member 只能编辑自己创建的任务；viewer 什么都不能修改。具体产品也许要允许 member 编辑所有共享任务，但那应该是明确的业务规则，而不是无意中漏掉授权检查的结果。

### 12.6 成员管理必须单独保护

`workspace_member.role` 是敏感权限数据。创建/修改成员的 API 应先验证 session，再确认调用者是当前 workspace 的 owner/admin，再检查被邀请/被修改用户，最后才写入新角色。普通 member 不得自己把角色改成 admin；不能允许 `PATCH /workspace-member` 直接更新请求体里任意 `role`。高风险角色提升应记录审计日志，必要时要求重新认证或双因素认证。

若希望 Better Auth 管理组织、邀请和组织角色，可以研究 [Organization plugin](https://better-auth.com/docs/plugins/organization)；但插件的组织权限不会自动替你检查自定义 task 表的 ownership、租户 ID 和业务级规则。无论使用插件还是自建 `workspace_member`，都必须在每条业务 API 中做相应授权。

## 第 13 章：速率限制、枚举、暴力破解与安全事件

### 13.1 速率限制不是一个全局数字就够了

Better Auth 内置 rate limiter 在生产环境默认启用，文档中的默认窗口为 10 秒、100 次请求；它也为登录等敏感端点提供更严格的自定义规则。本文显式指定了登录 10 秒 3 次、注册 60 秒 5 次。

生产系统还应该：

- 在 CDN/WAF/API gateway 上为登录、注册、验证邮件和重置密码设置限制。
- 同时考虑 IP、账号标识、设备和风险信号；对 IP 的判断只信任受控代理提供的头，不能直接相信任意 `X-Forwarded-For`。
- 多实例部署要使用共享数据库或 Redis 等共享存储；各实例的内存计数不会自动同步。
- 注意官方 rate limiter 主要限制客户端请求，直接在服务器里调用 `auth.api` 的程序化请求不会自动受到相同速率限制，所以自有后台任务和管理接口也需要自己的限流策略。

### 13.2 防邮箱枚举

攻击者可能通过注册、找回密码或登录反馈猜某个邮箱是否存在。用统一、模糊但有用的响应，例如“如果该邮箱已注册且可接收邮件，你将收到后续说明”；不要公开返回“此邮箱用户存在/不存在”的差异，也不要在前端展示供应商原始错误信息。启用 `requireEmailVerification` 后，Better Auth 对某些重复邮箱注册路径提供枚举防护；自定义邮件与 UI 也要维持同样策略。

### 13.3 安全日志与撤销

建议建立审计事件表或集中式审计系统，记录：

- 事件类型（登录成功/失败、密码重置请求、会话撤销、成员角色变化、跨 workspace 访问被拒绝）。
- user ID（如果可识别）、资源 ID、时间、request ID、经过可信代理处理的来源 IP 和结果。
- 管理员更改权限时的操作者、目标用户、修改前后角色。

**不要记录**密码、完整 Cookie、session token、OAuth access/refresh token、邮件验证链接或重置密码 URL。日志的访问权限和保留周期也需要管理。对失败登录应可观察、可告警，但避免用未脱敏邮箱或秘密 token 做高基数指标标签。

需要安全响应时，按事件撤销相关 session；被盗账户可撤销全部 session、强制重置密码、核查 OAuth 绑定，并检查角色/资源的异常访问记录。

## 第 14 章：逐项测试——用行为验收，而不是“能登录就算好了”

先准备至少两个用户 Alice、Bob，以及两个 workspace `W1`、`W2`。让 Alice 是 W1 的 owner，Bob 是 W1 的 viewer；Alice 不加入 W2。再建立一条 W1 的 task 与一条 W2 的 task。每项测试都应通过真实 HTTP 请求执行，而不只是调用前端组件。

| 测试场景 | 操作 | 期望结果 | 验收理由 |
|---|---|---|---|
| 未登录 | 不带 Cookie 请求 `/api/me` | `401` | 自有 API 每次都验证 session |
| 未登录读取任务 | 不带 Cookie 请求 W1 tasks | `401` | 不允许仅靠前端控制访问 |
| 有效登录 | Alice 登录后请求 `/api/me` | `200`，只返回允许字段 | Cookie/session 流程工作 |
| 过期 session | 在测试库把测试用户 session 的 `expiresAt` 改为过去，再请求 `/api/me` | `401` | 服务端检查过期，而不只看 Cookie 是否存在 |
| 已撤销 session | 登出或撤销测试用户的 session 后重用旧 Cookie | `401` | 撤销必须影响后续请求 |
| 非成员跨 workspace | Bob 请求自己不属于的 W2 tasks | `404`（或你明确定义的 `403`） | 不能凭已登录身份跨租户读取 |
| viewer 只读 | Bob 请求 W1 tasks | `200` | 读权限符合定义 |
| viewer 写入 | Bob 创建或更新 W1 task | `403` | 只读角色不能通过直接 API 调用绕过 UI |
| member 改别人任务 | member 更新同 workspace 中他人创建的 task | `403` | ownership 检查生效 |
| member 改自己的任务 | member 更新自己创建的 task | `200` | 最小授权没有误伤允许的行为 |
| 跨 workspace task ID | 请求 `/api/workspaces/W1/tasks/<W2 的 taskId>` | `404` | 查询同时约束 taskId 与 workspaceId |
| 管理员操作 | W1 admin 更新 W1 的任务或成员 | 按策略成功 | 管理权限限制在对应租户 |
| 普通用户自提权 | member 尝试直接提交 `role: "admin"` | 被拒绝，数据库角色不变 | 角色只能由经授权逻辑设置 |
| 恶意 Origin | 从未在 allowlist 的 origin 发起 mutation | CORS/Origin/CSRF 检查拒绝 | 浏览器跨站攻击面受到约束 |
| 生产 Cookie | HTTPS 登录并检查浏览器存储 | `Secure`、`HttpOnly`、合理 `SameSite` | Cookie 属性符合部署方式 |
| OAuth 正确回调 | provider 回调到注册的 URL | 成功登录并建立 session | provider 与 Better Auth 配置匹配 |
| OAuth 错误回调 | 使用不允许的 redirect/callback URL | 请求被拒绝，不发生开放跳转 | 回调与 origin 校验没有被绕过 |
| 邮箱验证 | 注册真实邮箱，点邮件中的链接 | 验证状态改变，后续登录按配置工作 | 邮件交付与 token 流程真实可用 |
| 密码重置 | 请求邮件、使用链接改密码、重放旧 token | 新密码生效，旧 token 不能继续用，旧 session 按配置撤销 | 找回密码流程及撤销机制有效 |
| 限流 | 在短窗口内反复尝试登录 | 超出阈值后被限流，并有可观察日志 | 暴力破解防护生效 |

### 14.1 测试 Cookie session 的实用命令

登录/注册端点路径和请求 body 请以当前版本官方 API 文档为准。常见的邮箱密码登录路径是 `/api/auth/sign-in/email`。例如：

```bash
curl -i -c cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.test","password":"一个强测试密码"}' \
  http://localhost:4000/api/auth/sign-in/email

curl -i -b cookies.txt http://localhost:4000/api/me
```

如果开启邮箱验证，用户必须先通过测试邮箱接收到的验证链接，否则未验证账号按配置不能建立正常 session。不要为了让 curl “马上成功”就在生产关闭邮箱验证；本地可以使用邮件沙箱，或在隔离测试库中创建已验证的测试用户。

过期 session 测试可以在**专用测试数据库**中把测试用户会话的 `expiresAt` 改成过去。生成 schema 使用了何种 SQL 标识符大小写/表名，以实际迁移为准，下面只是典型示意：

```sql
UPDATE "session"
SET "expiresAt" = now() - interval '1 minute'
WHERE "userId" = '你的测试用户 ID';
```

不要在生产库执行测试 SQL。测试时不要把真实 session token 贴进报告或工单。撤销会话最好优先通过 Better Auth 提供的登出/会话管理 API 完成。

### 14.2 自动化测试建议

在 CI 中用一次性 PostgreSQL 数据库执行 migrations，再跑 Fastify inject 或真实 HTTP 集成测试。给授权代码写纯函数测试（如 `canEditTask`），同时写数据库集成测试确认查询确实约束 `workspaceId`。每次修改角色、引入新 endpoint、升级 Better Auth 或增加插件，都重新运行这张表的核心回归用例。

## 第 15 章：常见失败原因与排查顺序

**登录成功但刷新后掉线：** 先检查响应是否完整转发 `Set-Cookie`，请求下一次是否带 Cookie，前端是否使用 `credentials: "include"`，API/CORS 的 origin 是否准确，Cookie 是否因 Secure/SameSite 条件而被浏览器拦截。

**浏览器报 CORS 错误：** 检查预检 OPTIONS、准确 origin、`credentials: true`、允许的 method/header。带凭据时不能用通配 origin。CORS 报错并不一定代表业务 API 本身没有执行，所以 mutation 也必须有独立 CSRF 与授权保护。

**开发环境收不到 Cookie：** 检查是否错误地在 HTTP 环境强制 Secure，检查 Cookie 的 Domain、Path、SameSite 和浏览器开发者工具中的拒绝原因。

**Better Auth 提示 schema 不匹配：** 对照当前配置、插件与 CLI 生成 schema；检查生成后的 Drizzle schema 是否真正传入 `drizzle(...)` 和 `drizzleAdapter(...)`；再检查 migration 是否已经在当前数据库执行。不要一边手动改表，一边期待生成器自动理解你所有自定义更改。

**邮箱验证/重置链接打不开：** 检查邮件服务商是否发送成功、验证域名、`BETTER_AUTH_URL`、链接回调 allowlist、token 有效期、反向代理是否正确转发 HTTPS 信息。不要通过关闭 origin 校验来绕过错误。

**多实例下限流不一致：** 检查是否使用共享 rate limit storage，是否只依赖每个实例的内存计数，以及代理 IP 是否可信。认证 API 的登录限流与自定义业务路由的限流可能需要分别配置。

**用户 A 能读到用户 B 的数据：** 不要只补一个前端判断。找到每个数据查询，确保在 session 验证后，检查 workspace 成员关系和角色，而且 SQL 本身也约束 workspace/资源 ID。继续检查导出、批量读取、搜索、后台任务和 WebSocket 等旁路入口。

## 第 16 章：上线前检查清单（完成后逐项打勾）

这不是替代上文学习过程的提纲，而是完成教程后用于验收的最后一关：

- [ ] 已能解释认证、会话和授权的差别；明确登录成功并不代表拥有任意 workspace/task 的访问权。
- [ ] 使用官方 Better Auth 实例和 PostgreSQL Drizzle adapter；秘密从环境/secret manager 读取。
- [ ] 已通过当前 Better Auth CLI 生成认证 schema，且数据库 migration 经检查和版本控制。
- [ ] Better Auth schema 与业务 schema 有明确边界；插件/版本升级后会重新生成并 review migration。
- [ ] `/api/auth/*` Fastify handler 正确转发状态码、响应头和每条 `Set-Cookie`。
- [ ] 所有受保护业务 API 在每次请求中调用 `auth.api.getSession`；没有 session 时返回 401。
- [ ] 任务读写和成员管理都会检查 workspace membership、role 和 ownership，并对 SQL 加租户范围条件。
- [ ] 默认拒绝未知角色/权限；客户端无法自行改变自己或他人的角色。
- [ ] `TRUSTED_ORIGINS` 精确列出允许的 origin；CORS 不使用凭据通配源；业务 mutation 也有 CSRF/Origin 防护。
- [ ] 生产 HTTPS、Secure/HttpOnly/SameSite Cookie 与跨子域配置已在真实浏览器上验收。
- [ ] 邮件供应商、验证邮件、密码重置、回调 URL 和错误处理都经过真实端到端测试。
- [ ] 密码哈希保留安全默认值；登录/注册/找回密码有速率限制、枚举防护和告警。
- [ ] 会话到期、续期、登出、撤销其他 session、密码重置撤销和安全事件响应已测试。
- [ ] CI 覆盖未登录、过期、撤销、非成员、只读、跨 workspace、ownership、管理员和恶意 Origin 场景。
- [ ] 日志中不包含密码、Cookie、session token、OAuth token 或邮件中的秘密链接。

---

## 官方文档索引（建议学习时逐页对照）

以下链接均为 Better Auth 官方文档。版本升级时，优先查看与你安装版本一致的稳定文档，尤其留意页面是否标记为 Beta。

1. [Installation](https://better-auth.com/docs/installation)：环境变量、实例、适配器、schema 生成和 handler。
2. [Fastify Integration](https://better-auth.com/docs/integrations/fastify)：Fastify handler、getSession、CORS 和 trusted origins。
3. [Database Concepts](https://better-auth.com/docs/concepts/database)：user/session/account/verification、CLI 和 schema。
4. [PostgreSQL Adapter](https://better-auth.com/docs/adapters/postgresql)：PostgreSQL 连接和 schema 选项。
5. [Session Management](https://better-auth.com/docs/concepts/session-management)：过期、续期、fresh session、撤销和 cookie cache。
6. [Cookies](https://better-auth.com/docs/concepts/cookies)：Cookie 属性、跨子域和安全 Cookie。
7. [Security](https://better-auth.com/docs/reference/security)：密码哈希、会话安全、Origin/CSRF 和其他保护。
8. [Rate Limit](https://better-auth.com/docs/concepts/rate-limit)：限流配置、端点规则和存储后端。
9. [Email](https://better-auth.com/docs/concepts/email)：邮箱验证和密码重置邮件。
10. [Email & Password](https://better-auth.com/docs/authentication/email-password)：密码配置、枚举防护与重置密码。
11. [OAuth](https://better-auth.com/docs/concepts/oauth)：OAuth provider、client secret、回调 URL 和账户关联。
12. [Options Reference](https://better-auth.com/docs/reference/options)：`trustedOrigins`、`emailAndPassword`、`session` 与速率限制选项。
13. [Organization Plugin](https://better-auth.com/docs/plugins/organization)：如果需要内建组织/成员/角色/invitation 管理，可作为下一阶段学习主题。
14. [Resend Node.js](https://resend.com/nodejs)：本文邮件发送示例采用的邮件供应商 SDK 指南。

**最后的学习原则：认证库替你处理大量容易出错的认证协议细节，但它不知道你的业务里谁拥有哪个 workspace、哪些 task 可以被编辑。安全实现必须把每次请求的有效身份与数据库中的资源授权结合起来，并用跨租户测试证明默认拒绝真正有效。**
