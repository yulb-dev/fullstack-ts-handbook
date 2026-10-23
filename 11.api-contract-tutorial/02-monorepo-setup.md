# 第 2 章：从零搭建 monorepo

> 本章目标：搭好 TaskFlow 的骨架——一个 pnpm workspace，包含 `apps/api`、`apps/web`、`packages/api-client` 三个包；准备好数据库与迁移；并用脚本**强制**「前端不能直接依赖服务端实现」。
>
> 对应核心概念：**② 保持 `apps/web` 不直接依赖服务端实现文件。**

---

## 2.1 为什么用 monorepo，又为什么要「隔离」

把前后端放进同一个仓库有明显好处：一次提交可以同时修改接口和调用方；CI 可以在一个流水线里检查「契约变了，前端是否跟上」。

但 monorepo 也有一个危险：**太方便了**。前端同学随手写一句 `import { Task } from "../../api/src/..."`，编译通过、页面正常，第 1 章说的所有问题（泄露实现、耦合构建、契约不可见）就悄悄回来了。

所以我们要同时做到两件事：

1. **物理上在一起**：同一个仓库、同一套工具链、同一个 CI；
2. **逻辑上隔离**：前端只能通过 `packages/api-client` 这一个「窗口」了解后端，而这个窗口里的东西全部来自契约生成。

---

## 2.2 准备工具

```bash
node -v    # v24.x
pnpm -v    # 12.x（没有的话：npm i -g pnpm 或 corepack enable）
```

数据库有两种选择：

- **Docker Postgres**：最接近生产，推荐；
- **PGlite**：WebAssembly 版 Postgres，进程内运行，不用装任何东西。配套工程的测试全部用它，另外提供了 `dev:memory` 命令用它启动整个 API。

---

## 2.3 根目录：workspace 与共享配置

```bash
mkdir taskflow && cd taskflow
```

**`package.json`**（根目录只放编排脚本，不放业务依赖）：

```json
{
  "name": "taskflow-contract",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.11.2",
  "engines": { "node": ">=24" },
  "scripts": {
    "contract:generate": "pnpm --filter @taskflow/api openapi:export && pnpm --filter @taskflow/api-client generate",
    "contract:check": "node scripts/check-contract.mjs",
    "boundaries:check": "node scripts/check-boundaries.mjs",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "dev:api": "pnpm --filter @taskflow/api dev",
    "dev:web": "pnpm --filter @taskflow/web dev"
  }
}
```

`contract:*` 和 `boundaries:check` 两组脚本是本教程的主角，第 4 章和本章末尾分别实现。

**`pnpm-workspace.yaml`**：

```yaml
packages:
  - apps/*
  - packages/*

# pnpm 默认不运行依赖的安装脚本；esbuild（tsx / vite 依赖）需要显式放行
allowBuilds:
  esbuild: true
```

> **pnpm 新版本的一个坑**：pnpm 默认**不执行**依赖包的 `postinstall` 等脚本（这是供应链安全措施）。没有放行时，`pnpm install` 会报 `ERR_PNPM_IGNORED_BUILDS`。你可以运行 `pnpm approve-builds` 交互式选择，它会把结果写进 `allowBuilds`；也可以像上面这样直接写好。

**`tsconfig.base.json`**（三个包共享的严格配置）：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true
  }
}
```

几个选项值得解释：

- `noUncheckedIndexedAccess`：`rows[0]` 的类型是 `Row | undefined`。查数据库时这能逼你处理「查不到」的情况；
- `verbatimModuleSyntax`：只用作类型的导入必须写 `import type`。这让「前端只导入类型、不导入服务端值」更容易审查；
- `moduleResolution: "Bundler"`：允许不写 `.js` 后缀的相对导入，配合 `tsx`（服务端）和 Vite（前端）都能工作。

---

## 2.4 `apps/api`：契约的源头

```bash
mkdir -p apps/api/src && cd apps/api
```

**`apps/api/package.json`**：

```json
{
  "name": "@taskflow/api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=.env src/server.ts",
    "dev:memory": "tsx src/scripts/dev-memory.ts",
    "start": "tsx --env-file=.env src/server.ts",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "seed": "tsx --env-file=.env src/scripts/seed.ts",
    "openapi:export": "tsx src/scripts/export-openapi.ts ../../packages/api-client/openapi.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@fastify/cookie": "11.1.3",
    "@fastify/cors": "11.3.1",
    "@fastify/swagger": "9.9.2",
    "@fastify/type-provider-typebox": "6.3.0",
    "@scalar/fastify-api-reference": "1.75.1",
    "drizzle-orm": "1.0.0-rc.4",
    "fastify": "5.12.7",
    "fastify-plugin": "6.0.1",
    "pg": "8.23.1",
    "typebox": "1.4.2"
  },
  "devDependencies": {
    "@electric-sql/pglite": "0.5.11",
    "@types/node": "24.19.2",
    "@types/pg": "8.23.1",
    "ajv": "8.20.0",
    "ajv-formats": "3.0.1",
    "drizzle-kit": "1.0.0-rc.4",
    "pino-pretty": "13.2.0",
    "tsx": "4.23.15",
    "typescript": "7.0.2",
    "vitest": "5.0.5"
  }
}
```

各依赖的职责：

| 依赖                                                     | 作用                                         | 用在哪章 |
| -------------------------------------------------------- | -------------------------------------------- | -------- |
| `fastify` + `typebox` + `@fastify/type-provider-typebox` | 路由、用 TypeBox 写 schema、推导类型         | 3        |
| `@fastify/swagger`                                       | 从 route schema 生成 OpenAPI                 | 3        |
| `@scalar/fastify-api-reference`                          | 在 `/docs` 渲染交互式文档                    | 3        |
| `@fastify/cookie` / `@fastify/cors`                      | 会话 Cookie、跨源配置                        | 8        |
| `drizzle-orm` + `pg`                                     | 数据访问                                     | 9        |
| `@electric-sql/pglite`                                   | 测试与内存开发模式用的 Postgres              | 2、9     |
| `ajv` + `ajv-formats`（dev）                             | 契约测试：用导出的 openapi.json 校验真实响应 | 3、13    |

> 版本都写死（没有 `^`），是为了让教程可复现。真实项目可以用 `^`，但一定要提交 lockfile。

**`apps/api/tsconfig.json`**：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": ["node"]
  },
  "include": ["src", "test", "drizzle.config.ts", "vitest.config.ts"]
}
```

注意服务端的 `lib` 里**没有** `DOM`——服务端代码里写 `window`、`document` 会直接报错。

---

## 2.5 数据模型与迁移

这一节只把表建好，表结构背后的设计（为什么要版本号、为什么有幂等键表）会在第 9、11 章展开。

**`apps/api/src/db/schema.ts`**：

```ts
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  primaryKey,
  snakeCase,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// 枚举值与 API 契约里的 TaskStatus / TaskPriority 保持一致（第 12 章讲为什么不直接复用）
export const taskStatus = pgEnum("task_status", ["todo", "doing", "done"]);
export const taskPriority = pgEnum("task_priority", ["low", "medium", "high"]);
export const memberRole = pgEnum("member_role", ["owner", "editor", "viewer"]);

// 所有时间点统一 timestamptz + 毫秒精度：与 JS Date / ISO 字符串的精度一致，游标分页才不会因为截断而漏行
const createdAt = timestamp({ withTimezone: true, precision: 3 })
  .notNull()
  .defaultNow();
const updatedAt = timestamp({ withTimezone: true, precision: 3 })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

export const users = snakeCase.table(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    displayName: text().notNull(),
    createdAt,
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)],
);

// 服务端会话：Cookie 里只放随机 token，数据库只存 token 的 SHA-256
export const sessions = snakeCase.table(
  "sessions",
  {
    tokenHash: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    csrfToken: text().notNull(),
    expiresAt: timestamp({ withTimezone: true, precision: 3 }).notNull(),
    createdAt,
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export const projects = snakeCase.table("projects", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  createdAt,
});

export const projectMembers = snakeCase.table(
  "project_members",
  {
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("project_members_user_id_idx").on(t.userId),
  ],
);

export const tasks = snakeCase.table(
  "tasks",
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text(),
    status: taskStatus().notNull().default("todo"),
    priority: taskPriority().notNull().default("medium"),
    // 截止「日期」是日历概念，不是时间点：用 date，并以 'YYYY-MM-DD' 字符串进出
    dueDate: date({ mode: "string" }),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    // 乐观并发控制：每次更新 +1，客户端用 If-Match 带回它（第 11 章）
    version: integer().notNull().default(1),
    createdAt,
    updatedAt,
  },
  (t) => [
    // 游标分页的排序键 (created_at desc, id desc) 需要对应的复合索引（第 12 章）
    index("tasks_project_created_idx").on(
      t.projectId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    // 同一项目里「未完成」任务标题不可重复（不区分大小写）——第 9 章的 409 来源
    uniqueIndex("tasks_project_open_title_uq")
      .on(t.projectId, sql`lower(${t.title})`)
      .where(sql`${t.status} <> 'done'`),
    check("tasks_title_len_ck", sql`char_length(${t.title}) between 1 and 120`),
    check("tasks_version_pos_ck", sql`${t.version} > 0`),
  ],
);

// 幂等键记录：同一用户 + 同一个键 = 同一次「创建意图」（第 11 章）
export const idempotencyKeys = snakeCase.table(
  "idempotency_keys",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: uuid().notNull(),
    scope: text().notNull(), // 作用域：同一个键不能被挪用到别的接口
    requestHash: text().notNull(), // 请求体指纹：同键不同内容要拒绝
    responseStatus: integer().notNull(),
    responseBody: jsonb().notNull(),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index("idempotency_keys_created_idx").on(t.createdAt),
  ],
);
```

对外的 ID 全部是 **UUID**：自增整数会暴露业务量（「我是第 1024 个用户」），也方便别人遍历 `/tasks/1`、`/tasks/2`。

还有一个刻意的设计：**数据库也在做校验**。`CHECK (char_length(title) between 1 and 120)` 和 API 契约里的 `maxLength: 120` 是重复的——这不是冗余，而是最后一道防线。第 5 章会解释为什么。

**`apps/api/drizzle.config.ts`**：

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
```

生成迁移（不需要连接数据库）：

```bash
pnpm db:generate --name init
# [✓] Your SQL migration ➜ drizzle/20261022142010_init/migration.sql 🚀
```

打开生成的 `migration.sql`，你能看到唯一索引和 CHECK 约束都被翻译成了 SQL：

```sql
CREATE UNIQUE INDEX "tasks_project_open_title_uq" ON "tasks" ("project_id",lower("title")) WHERE "status" <> 'done';
CREATE INDEX "tasks_project_created_idx" ON "tasks" ("project_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
```

**两种方式启动数据库：**

方式 A：Docker（根目录 `compose.yaml`）：

```yaml
services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: taskflow
    ports:
      - "5432:5432"
    volumes:
      - taskflow-pg:/var/lib/postgresql

volumes:
  taskflow-pg:
```

```bash
docker compose up -d
cp apps/api/.env.example apps/api/.env
pnpm --filter @taskflow/api db:migrate
pnpm --filter @taskflow/api seed
```

方式 B：不装 Docker，用内存数据库（`apps/api/src/scripts/dev-memory.ts`）：

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { buildApp } from "../app";
import { loadConfig } from "../config";
import { projectMembers, projects, users } from "../db/schema";

const client = new PGlite();
const db = drizzle({ client });
await migrate(db, { migrationsFolder: "./drizzle" }); // 与生产相同的迁移文件

// ……插入 alice（owner）、bob（viewer）、carol（非成员）与一个项目……

const config = loadConfig();
const app = await buildApp({
  db,
  config,
  logger: { level: config.logLevel, transport: { target: "pino-pretty" } },
});
await app.listen({ port: Number(process.env.PORT ?? 3000), host: "127.0.0.1" });
```

`buildApp` 是第 3 章的主角：它只「组装」应用，不连接特定数据库、不监听端口。正因为如此，同一个 `buildApp` 可以被生产启动脚本、内存开发模式、测试、OpenAPI 导出脚本复用。

**`.env.example`**：

```bash
# 本地 Docker Postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/taskflow

# 允许「跨源」携带 Cookie 访问 API 的浏览器来源（逗号分隔，见第 8 章）。
# 开发期走 Vite 代理、生产走同域反向代理时都是同源，留空即可。
WEB_ORIGINS=

# 生产环境必须为 true：Cookie 只走 HTTPS
COOKIE_SECURE=false

PORT=3000
LOG_LEVEL=info
```

---

## 2.6 `packages/api-client`：唯一的窗口

```bash
mkdir -p packages/api-client/src/generated
```

**`packages/api-client/package.json`**：

```json
{
  "name": "@taskflow/api-client",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./openapi.json": "./openapi.json"
  },
  "scripts": {
    "generate": "openapi-typescript openapi.json --output src/generated/openapi.ts",
    "lint:openapi": "redocly lint openapi.json --format=stylish",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "openapi-fetch": "0.17.0"
  },
  "devDependencies": {
    "@redocly/cli": "2.67.0",
    "openapi-typescript": "7.13.0",
    "typescript": "5.9.3",
    "vitest": "5.0.5"
  }
}
```

几个关键点：

1. **`exports` 直接指向 `.ts` 源码**。这是 monorepo 内部包的常见做法：不需要单独构建，Vite 和 TypeScript（`moduleResolution: Bundler`）都能直接消费源码；
2. **只有一个运行时依赖 `openapi-fetch`**（约 6 KB），生成的类型在运行时完全消失；
3. **这个包的 TypeScript 是 5.9，不是 7.0**。

### 为什么这里要锁 TypeScript 5.9？

TypeScript 7 是用 Go 重写的原生编译器，速度快了一个数量级，但它的 npm 包**不再导出旧的编译器 JS API**（`ts.factory` 等）。我们可以亲手验证：

```bash
node -e "const ts=require('typescript'); console.log(typeof ts.factory, ts.version)"
# TS 7.0.2 下输出：undefined 7.0.2
```

而 `openapi-typescript@7` 正是用 `ts.factory` 来生成代码的，它在 `peerDependencies` 里声明了 `typescript: ^5.x`。如果整个仓库只有一个 TypeScript 7，安装时会得到：

```
npm error Could not resolve dependency:
npm error peer typescript@"^5.x" from openapi-typescript@7.13.0
```

pnpm 的依赖是**按包隔离**的，所以解决办法很干净：只在 `packages/api-client` 里声明 `typescript@5.9.3`，代码生成器在这里找到满足 peer 的 TypeScript；`apps/api` 和 `apps/web` 继续用 TypeScript 7 做类型检查。生成出来的 `.ts` 文件是普通的类型声明，两个版本的编译器都能检查。

> 这类「工具链版本冲突」在真实项目里非常常见。处理原则是：**把有特殊版本要求的工具隔离在最小的包里**，而不是为了它降级整个仓库。

**`packages/api-client/tsconfig.json`**：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": []
  },
  "include": ["src", "test"]
}
```

这个包运行在浏览器里（用到 `fetch`、`Request`、`Response`），所以 `lib` 包含 `DOM`。

---

## 2.7 `apps/web`：只认识 api-client

**`apps/web/package.json`**：

```json
{
  "name": "@taskflow/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@hookform/resolvers": "6.0.0",
    "@taskflow/api-client": "workspace:*",
    "@tanstack/react-query": "5.104.5",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "react-hook-form": "7.90.0",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@testing-library/dom": "10.4.2",
    "@testing-library/react": "16.3.3",
    "@testing-library/user-event": "14.6.8",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.2",
    "jsdom": "30.1.3",
    "typescript": "7.0.2",
    "vite": "8.3.5",
    "vitest": "5.0.5"
  }
}
```

注意依赖列表里：

- 有 `"@taskflow/api-client": "workspace:*"`——前端了解后端的唯一途径；
- **没有** `@taskflow/api`、`fastify`、`drizzle-orm`、`typebox`。

pnpm 的 `node_modules` 是严格的：一个包只能 `import` 自己声明过的依赖。所以如果有人在前端写 `import ... from "@taskflow/api"`，会直接得到「找不到模块」。这是第一道防线。

**`apps/web/vite.config.ts`**：

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 开发期同源代理：浏览器只和 5173 打交道，没有跨源，也就没有 CORS 与预检（第 8 章）
      // changeOrigin 保持默认 false：Host 仍是 localhost:5173，服务端的同源 Origin 校验能通过
      // 目标写 127.0.0.1 而不是 localhost：避免 Node 把 localhost 解析成 IPv6 的 ::1 而连不上
      "/api": { target: "http://127.0.0.1:3000" },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

代理的细节（为什么 `changeOrigin` 要保持 `false`）是第 8 章的重点，这里先记住结论：**开发期浏览器只访问 5173，`/api/*` 由 Vite 转发给 3000，浏览器眼里是同源请求**。

---

## 2.8 第二道防线：边界检查脚本

pnpm 的严格依赖挡住了「按包名导入」，但挡不住相对路径：

```ts
// apps/web/src/whatever.ts
import { Task } from "../../api/src/contract/tasks"; // pnpm 拦不住！
```

TypeScript 会愉快地解析这个路径。所以我们需要一个显式检查——**`scripts/check-boundaries.mjs`**：

```js
/**
 * 依赖边界检查：apps/web 只能通过 @taskflow/api-client 了解后端。
 * - package.json 不允许依赖 @taskflow/api；
 * - 源码不允许 import 服务端包，也不允许用相对路径「翻墙」进 apps/api。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const webDir = resolve(root, "apps/web");
const apiDir = resolve(root, "apps/api");
const problems = [];

const pkg = JSON.parse(readFileSync(join(webDir, "package.json"), "utf8"));
for (const field of ["dependencies", "devDependencies"]) {
  if (pkg[field]?.["@taskflow/api"]) {
    problems.push(`apps/web/package.json 的 ${field} 依赖了 @taskflow/api`);
  }
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|jsx|mts)$/.test(name)) yield full;
  }
}

const IMPORT =
  /(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
for (const file of walk(join(webDir, "src"))) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(IMPORT)) {
    const spec = match[1] ?? match[2];
    const forbiddenPackage =
      spec === "@taskflow/api" || spec.startsWith("@taskflow/api/");
    const escapesIntoApi =
      spec.startsWith(".") && resolve(dirname(file), spec).startsWith(apiDir);
    if (forbiddenPackage || escapesIntoApi) {
      problems.push(`${relative(root, file)} 引用了服务端代码：${spec}`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  console.error(
    "\napps/web 只能依赖 @taskflow/api-client（生成的契约），不能直接依赖服务端实现。",
  );
  process.exit(1);
}
console.log("✓ apps/web 没有直接依赖服务端实现");
```

试一下它是否真的有效：

```bash
echo 'import { Task } from "../../api/src/contract/tasks";' > apps/web/src/_probe.ts
pnpm boundaries:check
# ✗ apps/web/src/_probe.ts 引用了服务端代码：../../api/src/contract/tasks
#
# apps/web 只能依赖 @taskflow/api-client（生成的契约），不能直接依赖服务端实现。
rm apps/web/src/_probe.ts
```

> 注意「`@taskflow/api-client`」以 `@taskflow/api` 开头，所以判断用的是「等于 `@taskflow/api`」或「以 `@taskflow/api/` 开头」，而不是 `startsWith("@taskflow/api")`。写这类检查时，**先写一个应该失败的用例，确认它真的失败**，再写应该通过的用例——否则你可能得到一个永远绿灯的检查。

在大型项目里，你也可以用 ESLint 的 `no-restricted-imports`、`eslint-plugin-boundaries` 或 dependency-cruiser 实现同样的规则。工具不重要，**重要的是这条规则被自动执行，并在 CI 里失败**。

---

## 2.9 安装并验证

```bash
pnpm install
pnpm boundaries:check
# ✓ apps/web 没有直接依赖服务端实现
```

到这里，三个包的骨架、数据库模型和边界规则都准备好了。下一章我们开始写真正的契约。

---

## 2.10 常见坑

| 现象                                             | 原因                                                         | 解决                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `ERR_PNPM_IGNORED_BUILDS`                        | pnpm 默认不跑依赖的安装脚本                                  | `pnpm approve-builds` 或在 `pnpm-workspace.yaml` 写 `allowBuilds`      |
| `peer typescript@"^5.x" from openapi-typescript` | TS 7 没有旧 JS API                                           | 在 `packages/api-client` 单独锁 `typescript@5.9`                       |
| Vite 代理报 `ECONNREFUSED ::1:3000`              | `localhost` 被解析成 IPv6，服务只监听 IPv4                   | 代理目标写 `127.0.0.1`                                                 |
| 前端能 import 到后端文件                         | 相对路径绕过了包边界                                         | `check-boundaries.mjs` / ESLint 规则 + CI                              |
| `Type` 类型不兼容、`Static` 推导出 `unknown`     | 混用了 TypeBox 0.x（`@sinclair/typebox`）与 1.x（`typebox`） | 全仓库只用 `typebox` 1.x，并保持 `"type": "module"`（1.x 是 ESM-only） |

---

## 2.11 本章验收清单

- [ ] 能解释为什么前后端放在同一个仓库，却要在逻辑上隔离；
- [ ] 搭好 pnpm workspace，`pnpm install` 成功；
- [ ] 理解 `packages/api-client` 为什么单独使用 TypeScript 5.9；
- [ ] 能用 Docker 或 `dev:memory` 两种方式启动数据库；
- [ ] `apps/web/package.json` 里没有任何服务端依赖；
- [ ] `pnpm boundaries:check` 能拦住相对路径越界，并在正常情况下通过。

---

上一章：[← 第 1 章：为什么需要 API 契约](./01-why-contracts.md) ｜ 下一章：[第 3 章：Fastify route schema 就是契约 →](./03-route-schema-as-contract.md)
