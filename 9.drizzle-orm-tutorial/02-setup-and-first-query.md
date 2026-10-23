# 第 2 章：从空目录到第一条真实查询

[上一章](./01-sql-and-orm.md) · [目录](./README.md) · [下一章](./03-columns-and-defaults.md)

本章只做一条完整链路：创建项目 → 启动 Postgres → 声明用户表 → 生成 SQL → 应用 SQL → 插入并读回用户。先成功一次，再扩展到书店模型。

## 2.1 选择一个明确的学习环境

我们使用 Node.js 24 LTS + TypeScript + node-postgres（npm 包 `pg`）。Node 是服务端运行环境，`tsx` 让你直接运行 TypeScript 脚本，Postgres 是实际保存数据的数据库。

你有两种跟做方式：

- 从零建立 `inkwell` 目录，逐章添加文件。
- 使用 [最终工程](./example)，先运行 `npm ci`、`npm test` 看完整成果，然后回头逐章理解。最终工程已经包含完整 schema 和迁移，不要把本章的简化 schema 覆盖进去再执行迁移。

从零建立时：

```bash
mkdir inkwell
cd inkwell
npm init -y
npm pkg set type=module
npm install drizzle-orm@1.0.0-rc.4 pg@8 zod@4
npm install -D drizzle-kit@1.0.0-rc.4 typescript@5.9 tsx dotenv @types/node @types/pg
mkdir -p src/db src/scripts
```

`type=module` 是为了使用 ESM 和顶层 `await`。两个 Drizzle 包锁同一个 RC 版本，是因为当前官方文档已使用新 API。不要把本文当成所有历史版本都通用的代码。

创建 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "drizzle.config.ts"]
}
```

这里先用 `tsx` 运行、`tsc --noEmit` 检查类型，不构建生产 JS。若以后改为直接运行编译产物，需要按 Node ESM 的路径/扩展名规则配置构建，不能把教学 tsconfig 原样当成发布方案。

## 2.2 启动一个独立的本地 Postgres

如果已经安装并启动 Docker，可运行：

```bash
docker run --name inkwell-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=inkwell \
  -p 127.0.0.1:5432:5432 \
  -d postgres:17
```

解释几个参数：

- `POSTGRES_DB=inkwell` 创建教学数据库。
- `POSTGRES_PASSWORD` 是这个本地教学容器的密码；不是生产密码模板。
- 只绑定 `127.0.0.1`，避免把教学数据库直接暴露到外网。
- 没有使用持久卷，因此不要把这个容器当成重要数据的存储方案。后续删除容器可能失去数据。

确认启动状态：

```bash
docker exec inkwell-pg pg_isready -U postgres -d inkwell
```

等待输出 `accepting connections` 后再继续。之后重启已有容器用 `docker start inkwell-pg`，不要重复 `docker run` 导致同名冲突。

没有 Docker时，可以使用单独的本地 Postgres 或 Supabase 测试项目。Supabase 的直连/IP/SSL 有额外要求，请先按第 11 章配置，不要随便改端口碰运气。

## 2.3 保存连接串，先理解它的构成

创建 `.env`：

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/inkwell
```

连接串的构成是：

```text
postgresql://用户名:密码@主机:端口/数据库名称
```

`dotenv/config` 会在进程启动时读取 `.env`。它不是 Drizzle 的功能，环境变量也不是自动加密存储。生产平台应通过其 secret 配置注入；不要把 `.env` 提交到 Git，也不要使用 `VITE_DATABASE_URL` 或 `NEXT_PUBLIC_DATABASE_URL` 等客户端公开前缀。

创建 `.gitignore`：

```gitignore
node_modules/
.env
.env.local
```

可以提交不含真实秘密的 `.env.example` 给团队说明需要哪些变量。密码包含 `@`、`#` 等保留字符时必须 URL 编码；如果用 `Pool` 独立传 `password`，则不要重复 URL 编码该字段。

## 2.4 声明第一张表，但还没有建表

创建 `src/db/schema.ts`：

```ts
import { integer, pgTable, text } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  email: text().notNull(),
  displayName: text("display_name").notNull(),
});
```

三个层次要分清：

- `users` 是 TypeScript 的导出变量名。
- `pgTable('users', ...)` 的字符串是数据库表名。
- `displayName: text('display_name')` 让 TypeScript 属性叫 `displayName`，数据库列叫 `display_name`。

`pg-core` 表明这是 PostgreSQL 方言。不要从 MySQL 的 `mysql-core` 复制 builder，以为只换数据库 URL 就行。

`export` 很重要：Kit 会加载 schema 文件并找出导出的模型。单纯在文件内部定义但不导出的表可能不会被纳入生成。

## 2.5 生成与执行迁移是两个动作

创建根目录 `drizzle.config.ts`：

```ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

`!` 只告诉 TypeScript“相信我有值”，不是运行时检查。在本章我们已经配置 `.env`；正式脚本应显式检查缺失变量。

生成迁移：

```bash
npx drizzle-kit generate --name=first_users
```

在本文 RC 版本中，你会得到类似：

```text
drizzle/
  <时间戳>_first_users/
    migration.sql
    snapshot.json
```

打开 `migration.sql`。应能看到 `CREATE TABLE users`、identity、`email text NOT NULL` 和 `display_name text NOT NULL`。生成阶段比较的是本地模型与本地迁移快照，不是对在线数据库做全面同步。

然后应用：

```bash
npx drizzle-kit migrate
```

这一步才连接数据库并执行 SQL。数据库还会多一个迁移历史表；第 6 章详细讲它。

如果只执行了 `generate` 就开始查询，会遇到“relation users does not exist”。Postgres 的这个 `relation` 通常指数据库对象，不是 Drizzle 的关系配置。

## 2.6 创建 Pool，再创建 Drizzle

创建 `src/db/client.ts`：

```ts
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("缺少 DATABASE_URL");

const pool = new Pool({
  connectionString,
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});
pool.on("error", (error) => console.error("空闲数据库连接异常", error));

export const db = drizzle({ client: pool });
export const closeDb = () => pool.end();
```

Pool 是“可复用的一小组连接”，不是查询对象缓存。一个 Node 进程通常只创建一个 Pool。Drizzle 持有它，查询时使用池里的连接。因为本章只用 core query builder，暂时不需要 relations；第 8 章会加上它。

`max: 5` 是小型本地练习值，不是所有生产环境的最佳配置。云函数的实例很多时，这个数需要大幅降低。

## 2.7 写入一行，再读回一行

创建 `src/scripts/hello.ts`：

```ts
import { eq } from "drizzle-orm";
import { db, closeDb } from "../db/client";
import { users } from "../db/schema";

try {
  const [user] = await db
    .insert(users)
    .values({
      email: "reader@example.com",
      displayName: "小林",
    })
    .returning();
  if (!user) throw new Error("插入没有返回行");

  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
    })
    .from(users)
    .where(eq(users.id, user.id));
  console.log(rows);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
```

执行：

```bash
npx tsc --noEmit
npx tsx src/scripts/hello.ts
```

应看到类似 `[{ id: 1, displayName: '小林' }]`。ID 不一定是 1；不要把代码的正确性建立在“从来没有插入失败”之上。

`.returning()` 返回写入后的行，包括数据库生成的 ID。它返回数组，即使只插入一行也如此。`finally` 关闭脚本的连接池，否则进程可能继续等待空闲连接；在长期运行的 HTTP 服务中不能每次请求都关池。

本章没有 UNIQUE，重复执行会创建多个同邮箱用户。先观察现象，再到第 4 章加入规则；如果你跟做时已重复写入，下次加唯一约束前要处理已有重复数据。

## 2.8 不装 Postgres也能先做什么？

最终工程的 `npm test` 使用 PGlite。它在测试中执行真实的迁移和 SQL，便于检查 NULL、约束与关系查询。但它并不是本章 TCP 连接的替代验证：不能证明云端网络、SSL、连接池和双连接竞态正确。

建议先用它看到成功测试，再补一次本章的真实 Postgres 链路。两种验证各有边界。

## 2.9 动手练习与排错

练习：把查询投影改成只返回 `email`。在编辑器里试图读取 `rows[0]?.displayName`，观察类型错误；然后打印查询的 `.toSQL()`，确认 SQL 只选择邮箱列。

参考写法：

```ts
const query = db
  .select({ email: users.email })
  .from(users)
  .where(eq(users.id, 1));
console.log(query.toSQL());
const rows = await query;
```

常见错误的含义：

| 现象                        | 优先检查                                      |
| --------------------------- | --------------------------------------------- |
| `ECONNREFUSED`              | Postgres 是否启动、端口是否映射、主机是否正确 |
| 认证失败                    | 用户、数据库密码、URL 编码                    |
| 表不存在                    | 是否执行 migrate、是否连接了另一个库          |
| TS 找不到 `defineRelations` | 安装的是 0.x，不是本文 RC                     |
| 脚本结束不退出              | 是否在 finally 关池，有无尚未完成任务         |
| 缺少环境变量                | 是否在项目根执行、是否加载 dotenv             |

## 本章验收

- [ ] 能从空目录建立项目并执行一条真实读写。
- [ ] 能解释 `generate` 与 `migrate` 的区别。
- [ ] 能说明表名、列名与 TypeScript 属性名的映射。
- [ ] 能保护连接秘密并正确关闭脚本的 Pool。

官方阅读：[PostgreSQL Getting Started](https://orm.drizzle.team/docs/get-started/postgresql-new)、[node-postgres 接入](https://orm.drizzle.team/docs/get-started-postgresql)、[升级 v1](https://orm.drizzle.team/docs/upgrade-v1)。
