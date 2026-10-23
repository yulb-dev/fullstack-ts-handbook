# Drizzle ORM 从零到一：把 PostgreSQL 数据模型变成类型安全的数据访问层

**适合读者：** 会一点 JavaScript/TypeScript，知道 SQL 是数据库查询语言，但还没系统使用过 ORM 的开发者。  
**贯穿项目：** 一个小型博客：用户（users）可以写文章（posts），文章可以打标签（tags）。  
**学习目标：** 学完后，你应当能独立设计基本关系表、用 Drizzle 描述 schema、推导读写类型、编写 CRUD 与关系查询、管理事务及迁移，并知道哪些工作仍然属于数据库设计和运维。

> **版本说明（请先读）：** 本教程按 **2026-10-22 查阅到的 Drizzle 官方文档路线** 编写。当前官网文档的若干安装示例使用 `drizzle-orm@rc`、`drizzle-kit@rc`，关系查询章节也将旧版 Relations API 与 Relational Queries v2 分开介绍。为避免 API 混用，本文关系查询采用官网当前的 `defineRelations` 写法。跟随代码时请使用同一条版本线；不要只升级 `drizzle-orm` 而保留与之不匹配的 `drizzle-kit`，也不要把旧版 `relations(table, ...)` 代码和本文的 `defineRelations(...)` 混在同一项目里。官方 API 会变化，升级前应核对版本对应文档。

---

## 学习路线：我们会真正做出什么

这不是只记 API 名称的参考手册。我们会从一个业务需求开始，逐步做成可运行的数据访问层。最后的项目将具备以下能力：

- 数据库能拒绝空邮箱、重复邮箱、没有作者的文章和无效标题等坏数据。
- TypeScript 能区分“从数据库读出的行”和“准备插入的新行”。
- 应用能分页读取文章、选择需要的列、联查作者、读取文章标签。
- 多条相互依赖的写操作可以作为一个事务提交或整体回滚。
- 数据库结构变化通过可审查、可追踪的 SQL migration 发布。
- 连接池、Supabase 连接方式、prepared statements 与生产部署方式有清晰边界。

章节顺序如下：

1. 建立正确的心智模型：ORM 不等于数据库设计
2. 初始化 TypeScript 项目并连接 PostgreSQL
3. 先设计 SQL 数据模型，再写 Drizzle schema
4. 从 schema 推导 select / insert 类型
5. 建立数据库外键之外的 ORM relations
6. 查询数据：投影、条件组合、排序与分页
7. 写入数据：insert、update、delete、批量与冲突处理
8. 用事务保护跨语句业务操作，并理解并发一致性
9. 用 drizzle-kit 管理 schema 变化与迁移历史
10. raw SQL、参数绑定、安全性与性能排查
11. 连接池、Supabase 与部署时的连接限制
12. Repository / Service 如何划分，以及怎样避免无价值的抽象
13. 跑通完整示例，并用逐项验收与练习巩固知识

---

# 第 1 章：先建立正确的心智模型

## 1.1 数据访问层究竟做什么

一个 Web 应用通常有三层逻辑：业务入口（HTTP handler、RPC、任务）、业务规则（service/use case）和数据访问（SQL、数据库驱动）。Drizzle ORM 主要帮助你编写最后一层：它把 TypeScript 中定义的表、列和条件编译成 SQL，并在编译期根据这些定义推导查询结果与写入对象的类型。

例如，SQL 可以写成：

```sql
SELECT id, title
FROM posts
WHERE status = 'published'
ORDER BY created_at DESC
LIMIT 20;
```

Drizzle 的写法则接近 SQL：

```ts
const rows = await db
  .select({ id: posts.id, title: posts.title })
  .from(posts)
  .where(eq(posts.status, "published"))
  .orderBy(desc(posts.createdAt))
  .limit(20);
```

它的价值主要有三点：

1. **可组合。** 条件、投影、排序、分页能按需组合，不必把整条 SQL 拼成字符串。
2. **类型推导。** 选择了哪些字段，返回值就会反映哪些字段；列的可空性和默认值也会影响 insert 类型。
3. **SQL 仍然可见。** Drizzle 不是要求你忘掉 SQL 的魔法黑盒。遇到复杂查询时，你可以检查 SQL 或用 `sql` 模板补充表达式。

## 1.2 ORM 不会替你设计数据库

**数据库设计决定数据如何组织、哪些状态合法、并发时怎样保证正确；ORM 只帮助应用以更舒服的方式使用这套设计。**

下面这些决定仍需由你负责：

- 一张表到底代表什么业务实体；哪些字段应该拆成另一张表。
- 某个字段能否为 `NULL`，缺省值是什么，唯一性应由哪条约束保障。
- 删除用户后，文章应该级联删除、禁止删除，还是保留并把作者置空。
- 什么查询会高频发生，索引应该覆盖哪些过滤列和排序列。
- 哪些多步操作必须原子提交，系统能接受哪种隔离级别。
- 生产环境如何发布迁移、处理历史数据、备份及恢复。

如果数据库允许两个用户使用相同邮箱，只在 TypeScript 里先查一次“邮箱是否存在”，仍然不能保证唯一。两个并发请求可能同时检查通过再同时插入。**唯一约束必须由数据库负责，应用负责把冲突转化为合理的业务响应。**

## 1.3 四个层次不要混为一谈

| 层次 | 负责什么 | 例子 |
|---|---|---|
| SQL schema / 数据库 | 存储结构和数据完整性 | `NOT NULL`、`FOREIGN KEY`、`UNIQUE`、索引 |
| Drizzle table schema | 用 TypeScript 描述表、列和约束 | `pgTable(...)`、`integer()`、`references(...)` |
| Drizzle relations | 让查询以嵌套关系的方式读取相关数据 | 一篇文章的作者和标签 |
| Repository / Service | 复用数据访问、组织业务用例 | “发布文章”需要权限、状态校验和写入 |

后面会反复回到这一点：**TypeScript 的类型安全不等于运行时数据验证，更不等于数据库完整性。** 来自 HTTP 请求的内容仍要做运行时验证；所有写入路径最终都应受数据库约束保护。

### 本章小结

读写数据之前，先问两个问题：这条规则应当由数据库强制执行，还是只是应用中的业务编排？如果是数据完整性规则（例如唯一邮箱），通常应该尽可能由数据库约束兜底。若规则跨多个步骤（例如付款转账），通常还需要 Service 和事务。

---

# 第 2 章：初始化项目并连接 PostgreSQL

我们选 PostgreSQL，因为它能清楚展示主键、外键、约束、事务和索引。Drizzle 也支持其他数据库，但不同 dialect 的列类型和部分语法不同，本文不混用。

## 2.1 准备环境

你需要安装 Node.js 的当前 LTS 版本、npm，以及一个可以连接的 PostgreSQL 数据库。数据库可以是本地 PostgreSQL、开发容器或 Supabase 项目。先建立空数据库，例如 `drizzle_blog`，然后取得连接 URL：

```text
postgresql://USER:PASSWORD@HOST:PORT/DATABASE
```

把实际连接串放到项目根目录 `.env`：

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/drizzle_blog
```

`.env` 只保存在本地，不要提交到 Git。请把 `.env` 加入 `.gitignore`；部署时通过平台的环境变量或 secret 管理服务配置它。

## 2.2 创建项目和安装依赖

```bash
mkdir drizzle-blog
cd drizzle-blog
npm init -y
npm install drizzle-orm@rc postgres dotenv
npm install -D drizzle-kit@rc typescript tsx @types/node
npx tsc --init
```

这里选择 `postgres`（postgres.js）作为驱动。Drizzle ORM 本身不负责建立网络连接；驱动管理 PostgreSQL 连接、参数传递和连接复用，Drizzle 在其上提供类型化查询 API。

如果你的项目已经固定在另一个 Drizzle 版本，请不要盲目复制 `@rc`。先阅读对应版本的官方安装指南，保证 `drizzle-orm`、`drizzle-kit` 和关系查询 API 彼此匹配。

建议目录结构：

```text
drizzle-blog/
├─ drizzle/                 # 生成的迁移文件与 snapshots
├─ src/
│  ├─ db/
│  │  ├─ schema.ts          # 数据库表、列、约束
│  │  ├─ relations.ts        # ORM 关系定义
│  │  └─ index.ts            # 驱动与 db 实例
│  ├─ posts/                 # 后续可放业务模块
│  └─ index.ts               # 示例入口
├─ .env
├─ .gitignore
├─ drizzle.config.ts
├─ package.json
└─ tsconfig.json
```

## 2.3 配置环境变量

最小 `.gitignore`：

```gitignore
node_modules/
dist/
.env
.env.*
!.env.example
```

可以提交不包含秘密的 `.env.example`：

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
```

## 2.4 建立 Drizzle 数据库实例

创建 `src/db/index.ts`：

```ts
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { relations } from "./relations";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

// 这是长驻 Node.js 服务的起点配置；serverless 场景见第 11 章。
const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle({ client, relations });
export { client };
```

`max: 10` 表示这个进程的客户端池最多使用 10 个连接，不是“整个系统最多 10 个连接”。多进程、多个容器或多个 serverless 实例会各自持有连接预算。后面的生产章节会介绍怎么估算总量。

此刻 `relations.ts` 还不存在，TypeScript 会暂时报错。完成第 3 章的 schema 和第 5 章的 relations 后，连接代码就能工作。若想分阶段运行，可以先临时删掉 `relations` 导入并使用 `drizzle({ client })`，完成关系定义后再加回去。

## 2.5 建立 Drizzle Kit 配置

在项目根目录创建 `drizzle.config.ts`：

```ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured for Drizzle Kit");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
});
```

注意两种配置用途不同：`src/db/index.ts` 用于应用运行时的查询；`drizzle.config.ts` 用于 Drizzle Kit 读取 TypeScript schema、生成迁移、连接数据库执行迁移。两者可以读取相同的 `DATABASE_URL`，但生产应用的运行凭证与迁移凭证最好按权限需求分开管理。

在 `package.json` 的 `scripts` 中加入：

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio",
    "dev": "tsx src/index.ts"
  }
}
```

如果项目已有 `scripts`，把这些键合并进去，不要覆盖整个文件。

### 本章验收

- 你知道应用查询使用驱动 + `drizzle(...)` 实例。
- 数据库 URL 放在环境变量里，不会硬编码进源码或提交到 Git。
- 你能解释 `drizzle.config.ts` 和运行时 `db` 实例的职责区别。

---

# 第 3 章：先设计 SQL 数据模型，再写 Drizzle schema

本章是整套教程的核心。不要先急着堆 `pgTable`，先想清楚数据实体、关联、约束和常见查询。

## 3.1 从业务需求推导表

博客有三个实体：

- **users**：用户的邮箱、显示名称、创建时间。
- **posts**：文章的作者、标题、正文、状态、创建时间和可选发布时间。
- **tags**：标签名称。

一篇文章只有一个作者，一个用户可以写多篇文章，这是 **一对多**。一篇文章可以有多个标签，一个标签也可以被多篇文章使用，这是 **多对多**。关系型数据库通常用中间表表达多对多，因此新增 `post_tags(post_id, tag_id)`。

```text
users 1 ────── N posts
                  │
                  N
                  │
               post_tags
                  │
                  N
                  │
                  1
                 tags
```

这个模型比在 `posts` 中放一个 `tag_names` 字符串更容易约束，也更利于查询和维护。如果需要标签的颜色、创建时间、别名，独立 `tags` 表也会更自然。

## 3.2 先看约束，再看 ORM

| 设计问题 | 数据库机制 | 本教程中的选择 |
|---|---|---|
| 怎样唯一标识一行？ | `PRIMARY KEY` | 各表都有整数主键 |
| 文章一定要属于一个用户吗？ | `NOT NULL` + `FOREIGN KEY` | `posts.author_id` 必填且引用 `users.id` |
| 两个人能否使用相同邮箱？ | `UNIQUE` | 不允许重复邮箱 |
| 标题能否为空或过长？ | `NOT NULL` + `CHECK` | 标题长度必须在 1 到 200 字符之间 |
| 关联记录如何清理？ | 外键的 `ON DELETE` 行为 | 用户被删除时，文章和对应中间记录级联删除 |
| 如何支持“某作者最新文章”？ | 适当索引 | 在 `(author_id, created_at)` 上建索引 |

`ON DELETE CASCADE` 是一个需要慎重决定的业务策略。本文选择它是为了让教学项目容易维护；真实业务可能需要软删除、保留审计记录、禁止删除有文章的账号等策略。不能仅因为级联删除方便，就在生产系统中随处使用它。

## 3.3 列类型不是随便选的

PostgreSQL 常见类型及使用建议：

| 数据含义 | 常见类型 | 留意点 |
|---|---|---|
| 整数 ID、计数 | `integer` / `serial` / `bigint` | 预估增长范围；`serial` 是常见自增写法 |
| 自然人姓名、标题、正文 | `text` / `varchar(n)` | 业务长度通常还应由校验或约束明确表达 |
| 价格、高精度金额 | `numeric(precision, scale)` | 不要默认用浮点数保存精确货币 |
| 是 / 否 | `boolean` | `NULL` 不同于 `false` |
| 时间点 | `timestamp with time zone` | 对跨时区的时间点通常更合适 |
| 可选发布时间 | 可空 timestamp | “尚未发布”与一个具体时间是不同状态 |
| 有限状态值 | PostgreSQL enum 或受约束文本 | 状态变化要考虑数据库迁移策略 |
| 半结构化附属数据 | `jsonb` | 不要把所有关系数据塞进 JSON 逃避建模 |

Drizzle 的 column builder 是 TypeScript 表达方式，最终会映射为相应 SQL 类型。你必须知道它映射的数据库类型是什么，尤其是 `numeric`、日期时间和 JSON 等容易涉及运行时映射或业务约束的类型。

## 3.4 写出完整 schema

现在创建 `src/db/schema.ts`：

```ts
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const postStatus = pgEnum("post_status", [
  "draft",
  "published",
  "archived",
]);

export const users = pgTable(
  "users",
  {
    id: serial().primaryKey(),
    email: text().notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("users_email_uidx").on(table.email)],
);

export const posts = pgTable(
  "posts",
  {
    id: serial().primaryKey(),
    authorId: integer("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text().notNull(),
    title: text().notNull(),
    body: text().notNull().default(""),
    status: postStatus().notNull().default("draft"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    uniqueIndex("posts_slug_uidx").on(table.slug),
    index("posts_author_created_idx").on(table.authorId, table.createdAt),
    check(
      "posts_title_length_check",
      sql`char_length(${table.title}) BETWEEN 1 AND 200`,
    ),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: serial().primaryKey(),
    name: text().notNull(),
  },
  (table) => [uniqueIndex("tags_name_uidx").on(table.name)],
);

export const postTags = pgTable(
  "post_tags",
  {
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.tagId] }),
    // 复合主键以 post_id 开头；再为按 tag_id 查文章的查询建索引。
    index("post_tags_tag_id_idx").on(table.tagId),
  ],
);
```

现在逐段理解，不要只复制代码。

### `serial().primaryKey()`

`serial` 提供自增整数列的常见模式，`primaryKey()` 声明这列是主键。主键意味着唯一且非空。对于高规模系统或需要 UUID 的业务，可以选择 `bigserial`、identity column 或 UUID；关键是理解范围、生成策略和索引成本，不是某一种 ID 永远最好。

### `.notNull()` 与 `.defaultNow()`

`createdAt` 有 `.notNull().defaultNow()`：数据库在插入时可以自动填当前时间，读出来永远应有时间值。`body` 有默认空字符串，因此 insert 时可以不提供它，但读出来仍是 `string`。

相反，`publishedAt` 没有 `.notNull()`，也没有默认值：它允许 `NULL`。我们用 `NULL` 表示“尚无发布时间”，而不是随便塞一个虚构日期。

**默认值与可空性是两件事。** `DEFAULT` 指 insert 没提供该列时数据库使用什么；`NULL` 指列允许没有值。一个列完全可能 `NOT NULL DEFAULT ...`，也可能 `NULL DEFAULT ...`。

### 外键与删除动作

`posts.authorId` 是数据库真实外键，因为它使用了 `.references(() => users.id, ...)`。数据库会阻止指向不存在用户的文章。`onDelete: "cascade"` 决定用户被删时相应文章也删除。

### 唯一约束与唯一索引

`users_email_uidx`、`posts_slug_uidx` 和 `tags_name_uidx` 是唯一索引。它们同时建立查询访问路径并强制唯一性。单列唯一约束也可以用列级 `.unique()` 表达；复合唯一规则则可以在表级声明，例如“同一个租户内用户名唯一”通常是 `(tenant_id, username)` 的唯一约束/索引。

### 普通索引与 CHECK

`posts_author_created_idx` 为按作者过滤、再按创建时间排序的常见访问模式提供索引候选。索引不是装饰：它会增加磁盘占用，并给 insert/update/delete 带来维护成本。是否能用上索引需要通过 `EXPLAIN` 验证。

`check(...)` 让数据库拒绝长度不符合业务规则的标题。TypeScript 中的 `title: string` 只表示它是字符串，**并不能保证长度在 1 到 200 之间**，所以数据库 CHECK 仍有意义。应用层可以更早给用户友好的提示，但数据库应守住最后一道数据完整性边界。

### 为什么中间表用复合主键

`post_tags` 表示“某篇文章具有某个标签”。若 `post_id` 和 `tag_id` 都相同，就代表重复关系，因此用两列组合成主键。不需要再额外加一个永远没有业务含义的 surrogate ID。索引 `post_tags_tag_id_idx` 则支持从标签反向找文章。

## 3.5 唯一、主键、外键、索引、检查约束分别解决什么

- **主键（PRIMARY KEY）**：标识一行，不允许重复或为空。
- **外键（FOREIGN KEY）**：确保引用目标确实存在，并按设置处理目标删除/更新。
- **唯一约束 / 唯一索引（UNIQUE）**：防止重复的业务键，如 email、slug。
- **普通索引（INDEX）**：优化某些读取模式，但本身不要求值唯一。
- **检查约束（CHECK）**：限制一行中的值或字段组合必须满足表达式，如价格大于等于零。
- **非空约束（NOT NULL）**：拒绝 `NULL`，但不代表空字符串、0 或 `false` 不合法。

这六种机制不互相替代。给邮箱加普通索引并不会阻止重复邮箱；在应用中写一个 if 判断也不等同于数据库唯一约束。

### 本章验收

阅读 `schema.ts` 后，你应该能解释：每一列对应什么 PostgreSQL 类型、哪些字段 nullable、insert 哪些字段可省略、什么关联由数据库外键保障，以及索引为何放在那些列上。

---

# 第 4 章：理解 schema 与 TypeScript inferred types

Drizzle 的一个核心优势，是从数据库 schema 自动推导 TypeScript 类型，减少“SQL 表已改，但应用类型忘记改”的重复劳动。

## 4.1 推导 select 类型与 insert 类型

接着 `schema.ts` 写：

```ts
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { posts, users } from "./schema";

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;

// 等价的显式泛型形式：
export type UserSelect = InferSelectModel<typeof users>;
export type UserInsert = InferInsertModel<typeof users>;
```

`typeof users.$inferSelect` 表示从 `users` 表定义推导出的查询行类型；`typeof users.$inferInsert` 表示插入时可接受的对象形状。

## 4.2 为什么 select shape 和 insert shape 不一样

拿 `users` 举例，插入对象可以这样写：

```ts
const newUser: NewUser = {
  email: "sam@example.com",
  displayName: "Sam",
};
```

这里没有 `id`，因为数据库会通过 `serial` 生成它；也没有 `createdAt`，因为数据库默认使用 `now()`。读出来的行则包含它们：

```ts
const [created] = await db.insert(users).values(newUser).returning();

// 根据 schema，created.id 是 number，created.createdAt 是 Date。
console.log(created.id, created.createdAt);
```

形状上有几个重要差异：

| 字段类型 | Insert 时 | Select 时 |
|---|---|---|
| `id`：主键自增 | 可省略 | 必有，`number` |
| `createdAt`：非空且有默认值 | 可省略 | 必有，`Date` |
| `body`：非空且默认 `""` | 可省略 | 必有，`string` |
| `authorId`：非空且无默认值 | 必须提供 | 必有，`number` |
| `publishedAt`：可空且无默认值 | 可省略；若提供可为 Date 或 null | 必有，但类型是可空 Date |

注意 `publishedAt` 即使 insert 时可以完全不提供，select 类型里仍然会有这个字段，只是其值可能是 `null`。**对象属性存在与属性值可空，不是同一个概念。**

## 4.3 类型推导不等于运行时校验

`NewPost` 可帮助你的 TypeScript 代码在编译期发现字段名和基础类型问题，但它不会在运行时检查 HTTP JSON。例如，客户端仍可能发送：

```json
{
  "authorId": 999999,
  "title": "",
  "status": "made-up-status"
}
```

从网络收到的值进入程序时，本质上仍是不可信输入。你应在 API 边界用 Zod、Valibot 或自己的运行时验证逻辑检查字段、权限、长度和枚举值，再让 Drizzle 执行写入。数据库外键和 CHECK 则继续负责最后一道约束。不要因为 `NewPost` 编译通过，就直接信任用户输入。

## 4.4 推导类型应该放在哪

对从数据库 schema 推导出来的类型，一般在数据层导出并复用，不要再手工写一套重复的 `interface User`。但 API DTO 不一定和数据库行类型一样。例如，数据库可能有 `passwordHash`、内部审计字段或软删除标记，不能因为 select type 包含它们，就把整行对象直接返回给客户端。类型推导减少重复，不替代数据传输对象的边界设计。

### 本章验收

- `User` / `Post` 用 `$inferSelect` 表示读出来的行。
- `NewUser` / `NewPost` 用 `$inferInsert` 表示插入对象。
- 能解释默认值为何使 insert 字段可选、可空性为何影响 select 字段类型。
- 知道 TypeScript 类型不是对网络请求的运行时验证。

---

# 第 5 章：数据库外键与 Drizzle relations 是两回事

这一区分是初学者最容易混淆的点。

## 5.1 外键是数据库规则，relations 是查询描述

在前面的 schema 中：

```ts
authorId: integer("author_id")
  .notNull()
  .references(() => users.id, { onDelete: "cascade" }),
```

这会在 PostgreSQL 中创建真正的外键。数据库不允许 `author_id` 指向不存在的用户，无论数据来自 Drizzle、原始 SQL、管理后台还是另一个服务。

而下面的 ORM relation 用来告诉 Drizzle：“查询文章时，可以把这篇文章的作者作为 `author` 关系读出来。”它本身不创建外键，也不能替代数据库完整性约束。如果只定义 `relations.ts` 而忘记 `.references(...)`，查询 API 可能仍能根据指定列关联数据，但数据库并不会自动拒绝孤儿行。

## 5.2 定义一对多和多对多 relations

创建 `src/db/relations.ts`：

```ts
import { defineRelations } from "drizzle-orm";
import { posts, postTags, tags, users } from "./schema";

// 显式只传表，避免把同文件导出的 enum、辅助常量等一并交给关系定义。
export const relations = defineRelations({ users, posts, tags, postTags }, (r) => ({
  users: {
    // 一个用户可以有多篇文章。
    posts: r.many.posts(),
  },
  posts: {
    // 一篇文章对应一个作者，关联列在 posts.author_id。
    author: r.one.users({
      from: r.posts.authorId,
      to: r.users.id,
    }),
    // 多对多：从 posts 经 post_tags 到 tags。
    tags: r.many.tags({
      from: r.posts.id.through(r.postTags.postId),
      to: r.tags.id.through(r.postTags.tagId),
    }),
  },
  tags: {
    // 反方向：一个标签可以属于很多文章。
    posts: r.many.posts({
      from: r.tags.id.through(r.postTags.tagId),
      to: r.posts.id.through(r.postTags.postId),
    }),
  },
  postTags: {
    post: r.one.posts({
      from: r.postTags.postId,
      to: r.posts.id,
    }),
    tag: r.one.tags({
      from: r.postTags.tagId,
      to: r.tags.id,
    }),
  },
}));
```

这里使用官方当前 Relational Queries v2 的 `defineRelations`。配置好后，`src/db/index.ts` 中的 `drizzle({ client, relations })` 就把这些关系交给查询 API。

`users.posts` 只描述“用户有多篇文章”；`posts.author` 则显式指出从 `posts.authorId` 到 `users.id`。多对多需要经过 `postTags` 的两个映射。若一个用户表有多个外键指向自身（例如 `invitedBy`、`managerId`），通常还需要仔细命名关系并消歧，不能假设 ORM 能猜出业务含义。

## 5.3 一对一是什么

如果一个用户最多只有一份 profile，可以建 `profiles` 表，含 `user_id` 外键，并对 `user_id` 加唯一约束：

```ts
export const profiles = pgTable(
  "profiles",
  {
    id: serial().primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bio: text(),
  },
  (table) => [uniqueIndex("profiles_user_id_uidx").on(table.userId)],
);
```

外键确保 profile 指向真实用户；`UNIQUE(user_id)` 才保证同一个用户最多有一份 profile。若只定义 ORM 的 `one` relation 而不建唯一约束，数据库仍可能存多个 profile 指向同一个用户，所以真实基数并不是一对一。

## 5.4 用 relation query 读取嵌套数据

定义关系后，可以这样读取文章及作者和标签：

```ts
const result = await db.query.posts.findMany({
  columns: {
    id: true,
    title: true,
    status: true,
    createdAt: true,
  },
  with: {
    author: {
      columns: {
        id: true,
        displayName: true,
      },
    },
    tags: {
      columns: {
        id: true,
        name: true,
      },
    },
  },
  limit: 20,
});
```

返回结果会是结构化对象：每篇文章包含指定字段、一个 `author` 对象和一个 `tags` 数组。未选择的列不会进入结果类型。这比每次查询完再自己拼接对象更方便，也可以避免不必要地返回正文等大字段。

还可以通过 relation API 的过滤器筛选嵌套数据，例如按状态获取文章；复杂过滤请参考当前版本 Select Filters 文档。务必记得：本文采用关系查询 v2 的对象式 `where`，而旧版教程中的回调式 `where: (table, { eq }) => ...` 属于不同 API 版本，不能混抄。

## 5.5 relation query 与 SQL JOIN 怎么选

两种方式都合理，适用场景不同：

- **Relation query** 适合读取“文章以及作者和标签”等嵌套数据，返回结构自然，类型也跟着嵌套。
- **SQL join** 适合你要精确控制连接、平铺输出列、聚合、分组，或查询逻辑本身就是 SQL 形状的时候。

例如，普通 SQL join：

```ts
import { eq } from "drizzle-orm";

const rows = await db
  .select({
    postId: posts.id,
    title: posts.title,
    authorName: users.displayName,
  })
  .from(posts)
  .innerJoin(users, eq(posts.authorId, users.id))
  .where(eq(posts.status, "published"));
```

这里返回的是平铺对象：`{ postId, title, authorName }`。如果一篇文章 join 多个标签，SQL 结果会为每一个匹配标签产生一行，文章列会重复出现。这不是数据库出错，而是关系型 join 的正常语义；你若要嵌套标签数组，需要聚合或使用关系查询。

`INNER JOIN` 只返回两边匹配的行；`LEFT JOIN` 保留左边所有行，右边没匹配时右侧列变成 `NULL`。因此 Drizzle 在 `leftJoin` 的结果类型中通常会把右边整体或右边被选字段推导为可空。类型系统是在提醒你：SQL 的连接方式改变了“是否一定有值”。

### 本章验收

- 你能说出 `references(...)` 与 `defineRelations(...)` 的区别。
- 你能写出一对多及多对多关系，不把标签数组硬塞到文章表。
- 你知道 JOIN 可能产生重复父行，LEFT JOIN 右侧可以为 `NULL`。

---

# 第 6 章：查询数据——Select、投影、条件组合与分页

本章所有代码都假定从 `src/db/index.ts` 导入 `db`，从 `schema.ts` 导入表。

## 6.1 最简单的查询

```ts
const allPosts = await db.select().from(posts);
const onePage = await db.select().from(posts).limit(20);
```

`select()` 不带字段对象时会选择表的全部列。在探索数据时很方便，但在用户接口、列表接口或多表查询中，不要把“取整行”作为默认习惯。正文、内部字段和大型 JSON 可能并不需要出现在每个列表响应里。

## 6.2 字段投影与类型推断

```ts
const summaries = await db
  .select({
    id: posts.id,
    title: posts.title,
    createdAt: posts.createdAt,
  })
  .from(posts);
```

此时 `summaries` 的每个元素只包含 `id`、`title`、`createdAt`，类型由投影自动推导。对象中的键是返回对象键名，值决定对应 SQL 列，因此也可以改名：

```ts
const summaries = await db
  .select({
    postId: posts.id,
    headline: posts.title,
  })
  .from(posts);
```

投影既降低传输量，也能降低意外暴露敏感列的风险。对 API 返回内容，仍建议显式构造 DTO，不要因查询类型正确就把内部行直接原样送给浏览器。

## 6.3 基础过滤操作符

```ts
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  or,
} from "drizzle-orm";

const published = await db
  .select({ id: posts.id, title: posts.title })
  .from(posts)
  .where(eq(posts.status, "published"));

const popularAuthors = await db
  .select()
  .from(users)
  .where(ne(users.displayName, "Anonymous"));

const titleMatches = await db
  .select()
  .from(posts)
  .where(ilike(posts.title, "%drizzle%"));

const recentByAuthor = await db
  .select()
  .from(posts)
  .where(
    and(
      eq(posts.authorId, 1),
      eq(posts.status, "published"),
      gte(posts.createdAt, new Date("2026-01-01T00:00:00Z")),
    ),
  );

const selectedStatuses = await db
  .select()
  .from(posts)
  .where(or(eq(posts.status, "draft"), eq(posts.status, "published")));

const noPublishDate = await db
  .select()
  .from(posts)
  .where(isNull(posts.publishedAt));

const inAuthors = await db
  .select()
  .from(posts)
  .where(inArray(posts.authorId, [1, 2, 3]));
```

常见操作符有 `eq`、`ne`、`gt`、`gte`、`lt`、`lte`、`like` / `ilike`、`inArray`、`isNull` / `isNotNull`。不要用 `eq(column, null)` 替代 `isNull(column)`；在 SQL 中，`NULL` 是三值逻辑的一部分，比较方式与普通值不同。

## 6.4 动态条件：不要复制十几条查询

搜索页面可能有可选关键词、可选作者和可选状态。你无需针对每一种组合复制一条查询：

```ts
import type { SQL } from "drizzle-orm";
import { and, eq, ilike } from "drizzle-orm";

async function searchPosts(input: {
  keyword?: string;
  authorId?: number;
  status?: "draft" | "published" | "archived";
}) {
  const conditions: SQL[] = [];

  if (input.keyword) {
    conditions.push(ilike(posts.title, `%${input.keyword}%`));
  }
  if (input.authorId !== undefined) {
    conditions.push(eq(posts.authorId, input.authorId));
  }
  if (input.status !== undefined) {
    conditions.push(eq(posts.status, input.status));
  }

  return db
    .select({
      id: posts.id,
      title: posts.title,
      status: posts.status,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(50);
}
```

这里 `undefined` 表示“没有提供该过滤器”。`authorId !== undefined` 比 `if (authorId)` 更准确，因为 0 是 falsy；虽然本例自增 ID 通常从 1 起步，写 API 时仍建议明确区分“没传”和“传了某个值”。

提醒：`%keyword%` 中的 `%` 会被当作 SQL LIKE 通配符，这是搜索语义问题，不是 SQL injection。若产品要求把用户输入的 `%`、`_` 当作普通字符，需要自行转义 LIKE 通配符。

## 6.5 排序与稳定分页

```ts
const page = 2;
const pageSize = 20;

const rows = await db
  .select({ id: posts.id, title: posts.title, createdAt: posts.createdAt })
  .from(posts)
  .orderBy(desc(posts.createdAt), desc(posts.id))
  .limit(pageSize)
  .offset((page - 1) * pageSize);
```

分页不仅要 `limit` / `offset`，还要有确定的排序。只按 `createdAt` 排序时，多篇文章可能有相同时间；因此再加唯一 ID 作为次级排序键，让分页顺序可预测。数据持续变化时，offset 分页仍可能在翻页期间出现重复或漏项，而且深页 offset 可能代价较高。

如果用户通常只向前翻页，游标分页（keyset pagination）可能更好。本教程用单调 ID 做入门示例：

```ts
async function nextPosts(cursor?: number, pageSize = 20) {
  return db
    .select({ id: posts.id, title: posts.title })
    .from(posts)
    .where(cursor === undefined ? undefined : gt(posts.id, cursor))
    .orderBy(asc(posts.id))
    .limit(Math.min(Math.max(pageSize, 1), 100));
}
```

下一页用上一页最后一条的 `id` 作为 cursor。请注意，这个排序是按 ID，而不是按发布时间；如果要按 `createdAt DESC, id DESC` 作为游标，需要同时比较这两个键（时间较新，或时间相同且 ID 较小），而不是只用时间戳。

## 6.6 查询关系数据

第 5 章已经定义好 relations。现在可以读取“已发布文章以及作者名”：

```ts
const feed = await db.query.posts.findMany({
  where: {
    status: "published",
  },
  columns: {
    id: true,
    title: true,
    createdAt: true,
  },
  with: {
    author: {
      columns: {
        id: true,
        displayName: true,
      },
    },
  },
  limit: 30,
});
```

这是当前关系查询 v2 的对象式 `where` 风格。更复杂的 `AND` / `OR`、比较操作符和 `RAW` 过滤应当按照当前 Select Filters 文档编写。简单列表也可以使用普通 `select` + `join`；不要因为 relation API 很方便，就把所有查询都改成关系查询。

## 6.7 聚合不是普通字段

统计每个作者的文章数，可以用 SQL 聚合：

```ts
import { count, eq } from "drizzle-orm";

const result = await db
  .select({
    authorId: posts.authorId,
    postCount: count(posts.id),
  })
  .from(posts)
  .groupBy(posts.authorId);
```

对更复杂的表达式，可以使用 `sql<T>` 让 TypeScript 知道预期类型，但这只是类型提示，不会自动在运行时转换结果：

```ts
import { sql } from "drizzle-orm";

const totals = await db
  .select({
    authorId: posts.authorId,
    titleLength: sql<number>`sum(char_length(${posts.title}))`.mapWith(Number),
  })
  .from(posts)
  .groupBy(posts.authorId);
```

当你使用 `sql<T>` 时，`T` 是你对结果的声明，Drizzle 不会通过它对数据库返回的数据做神奇的验证。若数据库驱动返回字符串形式的数值，必要时使用合适的映射（如 `.mapWith(Number)`），并注意超过 JavaScript 安全整数范围时 `Number` 可能失真。

### 本章验收

- 你能写带投影的 select，并能说明结果类型为何只有选择的字段。
- 你能用 `and`、`or`、可选条件、排序和分页完成一个搜索接口。
- 你知道 `NULL` 判断方式、分页排序稳定性，以及无界查询的风险。

---

# 第 7 章：写入数据——Insert、Update、Delete、批量和冲突

## 7.1 Insert 与 returning

```ts
import { db } from "./db";
import { users, posts } from "./db/schema";

const [author] = await db
  .insert(users)
  .values({
    email: "sam@example.com",
    displayName: "Sam",
  })
  .returning({ id: users.id, email: users.email });

if (!author) {
  throw new Error("User insert did not return a row");
}

const [post] = await db
  .insert(posts)
  .values({
    authorId: author.id,
    slug: "hello-drizzle",
    title: "Hello Drizzle",
  })
  .returning();
```

`returning()` 是 PostgreSQL 常用能力，可在 insert 后直接返回插入的行；也可以像第一个例子只返回 ID 和 email。使用投影返回最少字段通常更清晰。

第二个 insert 只提供 `authorId`、`slug`、`title`。`body`、`status`、`createdAt` 会用数据库默认值；`publishedAt` 会是 `NULL`。但 `authorId` 没有默认值而且 `NOT NULL`，所以必须提供。

## 7.2 Insert 多行

```ts
const newTags = await db
  .insert(tags)
  .values([{ name: "typescript" }, { name: "database" }, { name: "tutorial" }])
  .returning();
```

一次插入多行通常比循环发送多条独立 insert 少一些网络往返。但单个语句本身原子，不等于你在应用里调用的多条 SQL 自动组成一个事务。若要写“创建文章、绑定三枚标签、写审计记录”，请看下一章的事务边界。

实际做批量导入时还需要考虑一次插入多少行、SQL/参数大小限制、锁竞争、重试和失败时如何定位坏行。超大批次可以分块；分块是否放在同一个事务中，取决于业务是否要求整批原子性。

## 7.3 唯一冲突：先决定业务语义

用户邮箱和文章 slug 都有唯一索引。并发请求可能触发数据库的唯一冲突。常用处理方式有两类。

不做事（常用于幂等导入标签）：

```ts
await db
  .insert(tags)
  .values({ name: "typescript" })
  .onConflictDoNothing({ target: tags.name });
```

冲突时更新（upsert）：

```ts
await db
  .insert(tags)
  .values({ name: "typescript" })
  .onConflictDoUpdate({
    target: tags.name,
    set: { name: "typescript" },
  });
```

第二个例子只是展示语法，没有实际业务更新价值，因为冲突前后名称相同。真正 upsert 时应更新你确实希望覆盖的字段，例如同步外部数据时的 `displayName` 或 `updatedAt`。不要把冲突一概吞掉：如果重复邮箱代表“账户已存在”，业务可能需要明确返回冲突，而不是伪装成成功。

**不要使用“先 SELECT 检查是否存在，再 INSERT”作为唯一性保障。** 查询检查与插入之间存在竞争窗口。唯一约束和原子 `ON CONFLICT` 才能正确处理并发。

## 7.4 Update：一定要想清楚 where

```ts
const updated = await db
  .update(posts)
  .set({
    title: "A better title",
    status: "published",
    publishedAt: new Date(),
  })
  .where(eq(posts.id, 1))
  .returning({ id: posts.id, title: posts.title, status: posts.status });
```

`.set()` 中 `undefined` 的值会被忽略；要将可空列设为空，应明确传 `null`。这很适合区分“请求没有提交该字段”和“请求明确清除该字段”，但前提是 API 输入解析要有这样的约定。

极其重要：没有 `.where(...)` 的 `update` 会更新整张表。在真实业务里，可把危险操作封装在更明确的函数中，并对执行结果的行数做断言。例如“更新指定文章”应当拿到 ID，并检查返回行是否为空，以区别“不存在”与“更新成功”。

## 7.5 Delete：同样要防止无条件删除

```ts
const deleted = await db
  .delete(posts)
  .where(eq(posts.id, 1))
  .returning({ id: posts.id });
```

`db.delete(posts)` 没有 `where` 时会删除所有文章；它不是“只删除当前对象”。有些清理任务确实需要批量删除，但应在明确的维护入口执行，最好有审计、备份和 dry-run。删除是否级联还受外键 `ON DELETE` 策略影响。

## 7.6 把 insert 类型用于函数边界

```ts
type NewPost = typeof posts.$inferInsert;

async function createPost(input: NewPost) {
  const [created] = await db.insert(posts).values(input).returning();
  return created;
}
```

这避免手写数据库字段的重复 interface。但真实系统通常不应该允许客户端直接传入全部 `NewPost` 字段：它也许能传 `status: "published"`，但只有有权限的用户才应该发布。更合适的结构是：API 输入 schema 只接收允许用户填写的字段；Service 填入当前用户 ID 与业务状态；Repository 执行数据库写入。接下来会具体讲这个分层。

### 本章验收

- 你能写 insert + returning、批量 insert、update/delete + where。
- 你知道 `onConflictDoNothing` 和 `onConflictDoUpdate` 是两种不同的业务策略。
- 你能指出无 `where` 的 update/delete 为什么危险。

---

# 第 8 章：事务、批量写入与并发一致性

## 8.1 什么时候必须用事务

事务把多个数据库语句当成一个逻辑单元：全部成功则提交；中间抛错则回滚。它很适合有先后依赖的写入，例如创建文章及其标签关系：

1. 确认当前用户可以创建文章。
2. 插入文章并取得 `post.id`。
3. 将 `post.id` 与一组 `tag.id` 写入 `post_tags`。
4. 写入文章审计记录。

如果第 3 步失败，不应留下一个“文章创建了、标签却没有完整绑定”的半成品，就可以把相关数据库操作放进同一个事务。

## 8.2 使用 transaction

```ts
import { db } from "./db";
import { postTags, posts, tags } from "./db/schema";

async function createPostWithTags(input: {
  authorId: number;
  slug: string;
  title: string;
  tagIds: number[];
}) {
  return db.transaction(async (tx) => {
    const [post] = await tx
      .insert(posts)
      .values({
        authorId: input.authorId,
        slug: input.slug,
        title: input.title,
      })
      .returning();

    if (!post) {
      throw new Error("Post insert failed");
    }

    if (input.tagIds.length > 0) {
      await tx.insert(postTags).values(
        input.tagIds.map((tagId) => ({
          postId: post.id,
          tagId,
        })),
      );
    }

    return post;
  });
}
```

在回调里务必使用 `tx`，不要不小心用外面的 `db` 发出同一逻辑的一部分语句。抛异常会让事务回滚；返回则提交。外键和复合主键会处理标签不存在、关系重复等问题。调用者还应验证 `tagIds` 的长度和权限，并决定某一个标签不存在时是整次失败还是跳过。

## 8.3 事务边界不应包含外部网络调用

数据库事务只能原子地管理数据库里的工作。假如事务里调用邮件服务、支付 API 或第三方 HTTP 接口，即使数据库回滚，外部系统也不会跟着回滚；而且网络请求慢会让数据库事务和锁持有更久。

常见做法是把数据库状态更新与 outbox 事件记录写进同一事务，事务提交后再由 worker 投递事件。若业务必须和外部系统协调，还需要幂等键、补偿逻辑和状态机，不能指望一个 SQL 事务解决跨系统一致性。

## 8.4 转账示例：事务之外还要保护并发

设想账户表 `accounts(id, balance)`，转账必须扣减付款方并增加收款方。事务能保证“扣款和入账一起提交”，但如果简单地先读取余额，再计算新余额写回，两个并发转账可能都基于同一个旧余额计算，造成超扣。

更安全的一种模式是让数据库原子地检查并扣款，利用 `WHERE balance >= amount`：

```ts
import { and, eq, gte, sql } from "drizzle-orm";

async function transfer(fromId: number, toId: number, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount must be positive");
  }

  await db.transaction(async (tx) => {
    const debited = await tx
      .update(accounts)
      .set({ balance: sql`${accounts.balance} - ${amount}` })
      .where(and(eq(accounts.id, fromId), gte(accounts.balance, amount)))
      .returning({ id: accounts.id });

    if (debited.length !== 1) {
      throw new Error("Account not found or insufficient balance");
    }

    const credited = await tx
      .update(accounts)
      .set({ balance: sql`${accounts.balance} + ${amount}` })
      .where(eq(accounts.id, toId))
      .returning({ id: accounts.id });

    if (credited.length !== 1) {
      throw new Error("Recipient account not found");
    }
  });
}
```

`accounts` 是此示例的假设表，需按同样的 schema 规则定义，并用精确金额类型而不是盲目用浮点数保存货币。示例还省略了自转账策略、币种检查、审计流水、幂等请求 ID 及死锁处理；真实金融业务不能直接复制这个简化实现。

要点在于：**事务保证原子性；原子条件更新、约束、锁或适当的隔离级别处理并发竞争。** 它们是相关但不同的工具。

## 8.5 隔离级别与重试

PostgreSQL 提供 `read committed`、`repeatable read`、`serializable` 等隔离级别。更强的隔离能预防某些并发异常，但可能增加冲突和重试需求，也不是每个业务都需要一律使用最高级别。Drizzle 允许传入 PostgreSQL 事务配置，例如：

```ts
await db.transaction(
  async (tx) => {
    // 这里放同一逻辑单元的数据库读写
    await tx.select().from(posts).limit(1);
  },
  {
    isolationLevel: "serializable",
    accessMode: "read write",
  },
);
```

如果使用更强隔离，数据库可能因为序列化冲突要求整笔事务重试。重试逻辑应围绕整笔、可重入的事务设计；不要在重试回调中直接发送邮件或执行不可撤销的外部动作。死锁也需要监控，并且通过缩短事务、按一致顺序访问资源来降低概率。

## 8.6 保存点、行数和事务时长

Drizzle 支持嵌套事务的 savepoint 用法，适合某些局部失败允许被恢复的流程。但不要为了捕获任何异常就嵌套大量事务。更关键的工程实践是：

- 只把必须原子执行的数据库操作放在事务里。
- 尽量让事务短小，避免等待用户输入或外部服务。
- 检查 `returning()` 结果或受影响行数，区分成功、目标不存在、余额不足或状态已变化。
- 使用数据库约束处理无法靠应用预检查可靠保证的规则。
- 在业务需要时使用幂等键，防止请求超时后重试导致重复创建。

### 本章验收

- 你能说明什么时候多条写操作必须使用事务。
- 能解释事务原子性和并发一致性的区别。
- 知道唯一冲突不是只靠先查再插解决，并且事务不能回滚外部 API。

---

# 第 9 章：drizzle-kit、schema diff 与迁移历史

数据库 schema 会随需求演进。你把一个字段加进 `schema.ts`，并不意味着生产数据库已自动拥有它。迁移（migration）负责把旧结构变成新结构，同时让每个环境知道自己应用到哪个版本。

## 9.1 四种常见工作方式

- **`generate`**：比较当前 Drizzle schema 与迁移快照，生成 SQL migration 文件供审查。
- **`migrate`**：把尚未应用的迁移执行到目标数据库，并记录迁移历史。
- **`push`**：读取当前 schema 和数据库 schema，生成并直接应用变更，常用于快速原型或开发环境。
- **`pull`**：从现有数据库反向读取结构，生成 TypeScript schema，适合 database-first 的项目。

团队项目通常更适合“schema 变更生成迁移文件，再审查和执行”的流程，因为 SQL 会进入版本控制，code review 能看到实际 DDL 和数据迁移。`push` 很方便，但没有同样清晰的、逐个已审查 SQL 文件作为发布记录；不要把原型阶段的便利与生产变更治理混为一谈。

## 9.2 第一次生成并执行迁移

确认第 3 章的 `schema.ts` 已写好，且 `.env` 能连接到开发数据库。运行：

```bash
npm run db:generate -- --name=init
```

检查 `drizzle/` 下生成的 migration SQL 和 snapshot。初次迁移大体会生成用户、文章、标签和中间表的 `CREATE TABLE`，以及主键、外键、索引、enum 等定义。实际生成的 SQL 文件名和目录组织由当前 Drizzle Kit 版本决定，重点是打开 SQL 文件逐条审阅。

确认 SQL 符合预期后应用：

```bash
npm run db:migrate
```

之后应检查数据库里是否真的出现各张表、约束和索引。可以用数据库客户端、SQL 查询或开发环境的 Drizzle Studio 验证，而不是只相信命令显示成功。

如果你只是做本地快速实验，也可以运行：

```bash
npm run db:push
```

但请先确认目标数据库是可丢弃的开发库，并且理解 `push` 会直接改数据库。

## 9.3 每次改 schema 的标准工作流

假设你想给文章加 `summary` 列。先在 `posts` 中加入：

```ts
summary: text(),
```

然后执行：

```bash
npm run db:generate -- --name=add-post-summary
```

下一步不是立刻执行，而是审查生成 SQL：

1. 它是不是 `ALTER TABLE ... ADD COLUMN summary text`？
2. 是否意外删除、重建或重命名了列？
3. 对现有数据是否安全？
4. 如果新增的是 `NOT NULL` 字段，老数据如何满足要求？
5. 如果索引要在大表上建立，是否需要考虑 `CONCURRENTLY` 与迁移事务限制？

确认后提交 schema 和 migration 文件到版本控制，并在开发/测试数据库应用迁移。不要手工修改已经在别的环境应用过的旧 migration 来“改历史”；一般应该新建一个 migration 修正它。

## 9.4 schema diff 不是业务意图识别

工具比较的是结构差异，不知道你是不是想保留旧数据。例如把 `display_name` 删除再增加 `name`，数据库工具可能无法确认这其实是“重命名”，而不是“丢弃旧列并创建一个新列”。涉及重命名、大规模类型改变、默认值调整和数据清洗时，请显式审阅 SQL，并按需要定制迁移脚本。

对新列添加 `NOT NULL` 常见的安全步骤是：

1. 先新增 nullable 列。
2. 部署兼容旧结构与新结构的代码，开始写入新列。
3. 回填历史数据。
4. 检查历史行全部满足规则。
5. 再添加 `NOT NULL` 约束。

大型表上还要考虑锁时间、回填节奏和索引建立方式。这类分阶段迁移通常叫 expand / contract（先扩展兼容，再收缩旧结构）。

## 9.5 迁移历史和生产发布

Drizzle Kit 的迁移执行器会读取 migration 文件，并查询数据库中的迁移日志表（官方文档默认示例使用 `drizzle` schema 下的 `__drizzle_migrations`），据此判断哪些 migration 已应用，避免每次重跑全部 SQL。这个日志是“已执行过哪些迁移”的事实记录，应由发布流程统一维护。

生产推荐工作流：

1. 开发者提交 `schema.ts` 与新增 migration。
2. CI 在干净数据库上验证能从头应用所有迁移，并跑集成测试。
3. Review 人员检查生成 SQL，尤其是删除字段、数据迁移、锁和索引。
4. 部署管道中由**一个受控迁移任务**执行 `drizzle-kit migrate`，而不是让每一个应用实例启动时各自执行迁移。
5. 迁移完成后才部署依赖新结构的应用代码，或使用 expand/contract 让两者在滚动部署中兼容。
6. 监控错误、锁等待、执行时长和应用指标。

生产凭证建议最小权限化。应用运行账号一般不应拥有任意 DDL 权限；迁移任务使用单独的数据库角色执行必要的结构变更。具体权限要结合你的部署架构和数据库托管服务。

## 9.6 回滚策略：不要假设 ORM 会自动给你反向迁移

很多 schema 变更并不能安全自动逆转。`DROP COLUMN` 后数据可能已经丢失；回填后的数据也未必能恢复原状。Drizzle Kit 生成的 migration 主要是正向 SQL，并不意味着每一个版本都有自动可靠的 down migration。

比较稳妥的策略是：

- **优先 roll forward。** 若迁移有错误，通常创建新的修正迁移修复数据库状态，而不是直接篡改已应用历史。
- **高风险变化先备份与演练。** 对重要生产库确认备份和时间点恢复能力，先在近似生产的数据量上演练。
- **使用 expand/contract。** 先新增并填充结构，在应用完成迁移后再删旧列；把不可逆删除尽量放到最后。
- **把数据迁移当程序审查。** 大量回填可拆批运行，考虑锁、执行时长、失败后重跑是否幂等。
- **事先写恢复方案。** 明确发现问题时停止哪一步、恢复哪个版本、是否需要恢复备份，以及数据丢失的可接受范围。

`drizzle-kit check` 可用于检查迁移历史中生成的迁移是否存在某些冲突问题；`drizzle-kit studio` 可辅助查看数据。它们不能取代 SQL 审查、备份、回滚演练和生产监控。

### 本章验收

- 能区分 `generate`、`migrate`、`push` 和 `pull`。
- 明白 schema 修改不会自动改生产数据库。
- 知道 migration SQL 要进入版本控制，生产应由受控任务单点执行。
- 能解释为什么回滚策略常常是新的修正 migration + 备份，而不是自动生成反向 SQL。

---

# 第 10 章：Raw SQL、参数绑定、安全性与性能

Drizzle 尽量贴近 SQL，但不代表每个 PostgreSQL 特性都一定有对应的高层 API。复杂聚合、窗口函数、特定运算符或数据库扩展功能，都可能需要 `sql` 模板。使用 raw SQL 本身不是问题；危险的是用字符串拼接处理不可信输入，或者把所有业务查询都塞进难以审查的巨大 SQL 片段。

## 10.1 使用 sql 模板与参数绑定

```ts
import { sql } from "drizzle-orm";

const authorId = 42;
const rows = await db.execute(sql`
  SELECT id, title
  FROM ${posts}
  WHERE ${posts.authorId} = ${authorId}
  ORDER BY ${posts.createdAt} DESC
  LIMIT 20
`);
```

Drizzle 会把表/列映射为正确的标识符，并将普通动态值作为参数绑定，而不是把字符串直接拼进 SQL。底层通常会形成类似 `WHERE author_id = $1` 的形式，再把 `42` 作为独立参数传给驱动。

以下形式应避免：

```ts
// 错误示范：不要这么拼 SQL
const sqlText = `SELECT * FROM users WHERE email = '${untrustedEmail}'`;
```

如果 `untrustedEmail` 含有特殊字符，字符串拼接可能改变 SQL 结构。永远优先用 Drizzle 的条件 API 或 `sql` 模板传参。

## 10.2 参数绑定不能替代标识符白名单

参数绑定适合值，但不能将参数当作列名、关键字或排序方向使用。例如网页传来的 `sort=createdAt`，不能直接把任意字符串插入 `ORDER BY`。应当把用户选择映射到一组明确允许的列：

```ts
const sortColumn = {
  newest: posts.createdAt,
  title: posts.title,
  id: posts.id,
} as const;

const chosen = sortColumn[requestedSort as keyof typeof sortColumn] ?? posts.createdAt;

const rows = await db
  .select({ id: posts.id, title: posts.title, createdAt: posts.createdAt })
  .from(posts)
  .orderBy(chosen)
  .limit(50);
```

真实代码应先把 `requestedSort` 做运行时校验，不能仅靠 TypeScript 断言信任外部输入。排序方向同理，用明确的 `asc` / `desc` 分支，而不是拼接任意 SQL 字符串。

`sql.raw(...)`、驱动的 unsafe SQL 字符串或手工拼接标识符，只有在你完全控制输入并清楚知道后果时才可谨慎使用。它们不是普通的参数绑定替代品。

## 10.3 `sql<T>` 只提供类型提示

例如：

```ts
const rows = await db
  .select({
    lowerTitle: sql<string>`lower(${posts.title})`,
  })
  .from(posts);
```

这里 `string` 帮 TypeScript 推导返回值，但不会在运行时验证 PostgreSQL 真正返回了字符串，也不会自动做任意类型转换。对聚合、`NULL` 可能性、数值精度和驱动返回形式要格外小心。你写下的类型如果与 SQL 真实语义不同，编译器不会自动发现这一点。

## 10.4 检查 N+1 查询

经典 N+1 问题是：先查询 50 篇文章，然后在循环中对每篇文章单独查询作者或标签：

```ts
// 反例：一条查文章 + N 条查询标签，数据量增加后往返次数增加
const rows = await db.select().from(posts).limit(50);
for (const row of rows) {
  const rowTags = await db
    .select()
    .from(postTags)
    .where(eq(postTags.postId, row.id));
  // ...
}
```

改进方式取决于查询形状：

- 需要嵌套相关数据时，考虑第 5 章的 relation query。
- 需要平铺字段时，使用 join。
- 有时先批量获取所有相关行（`inArray`）再在内存中按外键分组更清楚。
- 检查日志或数据库监控中的查询次数和延迟，不要只凭代码外观猜性能。

不过，不要把“一个 SQL 语句”误解为永远更快。大型 join、重复父行、复杂聚合也可能很昂贵；应该看真实 SQL、结果行数和 `EXPLAIN`。

## 10.5 避免无界查询

以下代码对小型测试表看似没问题：

```ts
const everything = await db.select().from(posts);
```

但随着数据增长，它会从数据库传送所有文章正文，耗费内存、网络和数据库资源。面向服务端接口时应默认考虑：

- 明确的字段投影。
- 明确的 `limit`，并限制客户端可要求的最大 page size。
- 可预期的排序及分页策略。
- 合适的过滤条件和索引。
- 对批处理设置批次大小和可观测性。

如果确实需要批量导出全表，要把它实现为专门的流式/分批任务，而不是拿普通列表 API 直接返回无限结果。

## 10.6 用 EXPLAIN 验证索引是否有价值

索引是否有效取决于数据分布、查询形状、选择性和数据库统计信息。面对慢查询，先记录或复现真实 SQL，再运行 PostgreSQL 的：

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, title, created_at
FROM posts
WHERE author_id = 42
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

`EXPLAIN ANALYZE` 会实际执行查询，因此只应对可接受的查询在合适环境中使用。检查执行计划的扫描方式、估算行数与实际行数、排序、缓冲区读写和执行时间。`posts_author_created_idx` 是合理候选，但排序里有 `id` 作为次级排序键时，能否完全避免额外排序需要具体看 PostgreSQL 计划和索引定义。

不要因为“这个字段常查询”就给所有列加索引。复合索引的列顺序影响可用性；索引维护也有成本。以常见访问模式为起点，以真实执行计划为验证。

### 本章验收

- 你能说出 Drizzle 的参数绑定为什么比字符串拼接安全。
- 知道动态列名/排序方向要做白名单映射。
- 能发现 N+1 和无界查询，并用查询形状、分页和执行计划来改进。

---

# 第 11 章：连接池、Supabase、prepared statements 与部署环境

数据库连接不是无限资源。使用 ORM 的应用除了 SQL 逻辑，还要正确管理连接生命周期和部署时的网络条件。

## 11.1 连接池解决什么问题

建立 PostgreSQL 连接有成本，数据库也会限制连接总数。池让应用重复使用有限数量的连接，避免每个请求都新建连接。通常应在应用进程的模块级创建一个共享客户端，而不是每次 HTTP 请求都重新调用 `postgres(...)`。

但池大小要看部署拓扑。一个进程的 `max: 10`，如果部署 8 个进程，理论上客户端侧就可能提出最多约 80 个连接需求；如果 serverless 函数不断扩容，连接预算更容易超过数据库上限。因此池配置应和实例并发、数据库最大连接数、其他服务的连接占用一起考虑。

## 11.2 长驻服务器 vs serverless

**长驻服务器**（VM、常驻容器）通常可以复用一个较稳定的应用连接池。如果网络可达，直接连接到 PostgreSQL 往往更直观；必要时使用 session pooler。

**Serverless / Edge** 会有许多短命实例和不可预测的并发扩容。通常应考虑托管数据库的共享连接池或 transaction-mode pooler，并按平台建议限制每个实例的客户端池。不能简单把长驻服务中的 `max: 10` 原样复制到每个 serverless 实例。

## 11.3 Supabase 应该选哪种连接

Supabase 提供多种连接模式，选择时根据运行环境而不是只看哪个 URL 最短：

| 场景 | 常见选择 | 主要考虑 |
|---|---|---|
| 长驻后端，网络能访问数据库直连端点 | Direct connection | 少一层池化；注意 IPv6 / IPv4 网络条件 |
| 长驻后端只能走 IPv4 | Session pooler | 可用性与会话级特性较接近传统连接 |
| Serverless / Edge、短时连接、高实例弹性 | Transaction pooler | 可复用后端连接，但不支持依赖会话状态的功能 |
| 迁移、备份、`pg_dump` 等管理任务 | 通常选 Direct connection | 单次管理操作通常更适合直接连接 |

Supabase Dashboard 的 Connect 页面会显示项目对应的连接串；不要手动猜测 host、端口或项目引用。把选定的 URL 放入服务环境变量。

## 11.4 Transaction pooler 与 prepared statements

Prepared statement（预备语句）允许数据库解析/准备语句并在之后重复执行；驱动的具体行为因驱动和配置而异。Supabase transaction-mode pooler 会在事务结束后将服务端连接归还池中，因此不支持依赖该连接长期保留的 prepared statements 和部分 session state。

对于 `postgres`（postgres.js）驱动，Supabase 官方 Drizzle 接入文档建议在 transaction pooler 模式关闭 prepared statements：

```ts
const client = postgres(process.env.DATABASE_URL!, {
  max: 1,
  prepare: false,
  ssl: "require",
});
```

这是一个 serverless 风格的示例，`max: 1` 是每个 warm instance 的客户端池大小，不是整个 Supabase 项目的连接上限。若你使用其他驱动，应按该驱动文档采用对应设置，而不是直接复制 postgres.js 选项。

Supabase 当前连接指南还提示 transaction mode 不支持 query pipelining，而 postgres.js 有相关默认行为。部署时必须同时核对驱动版本、transaction pooler 的限制和官方最新建议；如果在这个组合中遇到事务挂起或连接异常，不要只反复调大 `max`，先核对连接模式与驱动兼容性，必要时改用官方支持的驱动组合或连接模式。

## 11.5 一个 serverless 模块级连接实例

在适用的 Node.js serverless 环境中，可以把实例放在模块作用域，确保 warm instance 复用它：

```ts
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { relations } from "./relations";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is missing");

const client = postgres(url, {
  max: 1,
  prepare: false,
  ssl: "require",
});

export const db = drizzle({ client, relations });
```

请不要在每一次请求处理函数内部调用 `postgres(url, ...)` 并且不关闭客户端。这会制造连接开销，并可能导致连接逐步耗尽。反过来，如果使用 transaction pooler，也别无脑提高 `max`：先证明单个实例内部确实因为并发查询发生排队，再结合托管平台允许的连接预算调整。

## 11.6 migrations 与应用连接不要混在一起

生产应用进程主要需要查询所需的最小权限；migration 需要执行 DDL，权限通常更高。建议在 CI/CD 或 release job 中用单独的 migration step、单独凭证执行：

```bash
npm run db:migrate
```

之后才启动依赖新 schema 的应用版本，或通过 expand/contract 确保新旧代码在滚动部署期间相互兼容。不要在每个并发实例启动时都触发结构迁移。

### 本章验收

- 能估算多个实例的客户端池总量。
- 知道 Supabase 直连、session pooler 与 transaction pooler 的主要使用场景。
- 知道 transaction mode 的 prepared statement / session-state 限制，以及 `prepare: false` 的适用条件。
- 知道 serverless 客户端应在模块级复用，并且迁移任务应独立管理。

---

# 第 12 章：Repository 与 Service 的边界

ORM 项目常见两种极端：所有 SQL 都塞在路由 handler 中；或给每一个查询都创建一个只转发参数的 repository 方法。两者都容易让代码失去清晰边界。

## 12.1 Repository 通常放什么

Repository 是数据访问能力的组织层，常负责：

- 封装可复用的查询形状，例如按 ID 查文章、读取文章列表、绑定标签。
- 保持查询字段投影一致，让多个调用者用同一种数据结构。
- 组合读写 SQL，并返回数据层结果或领域上更明确的结果。
- 集中某些数据库细节，让上层不需要知道所有 join 和索引相关查询。

一个有价值的函数可能是：

```ts
// src/posts/post-repository.ts
import { eq } from "drizzle-orm";
import { db } from "../db";
import { posts } from "../db/schema";

export function findPostSummaryById(id: number) {
  return db
    .select({
      id: posts.id,
      title: posts.title,
      status: posts.status,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
}
```

它有明确语义：返回统一的摘要投影，避免每个调用者自己写不同的字段列表。如果项目很小、查询只用一次，直接在 service 里写清晰的 Drizzle 查询也完全可以，不必为了形式硬抽象一层。

## 12.2 Service 通常放什么

Service 负责业务用例而不是单纯 SQL 语法。例如“发布文章”可能需要：

- 验证用户有发布权限。
- 检查文章当前状态是否允许发布。
- 确认标签合法，并在需要时创建标签关系。
- 在事务中更新文章状态和发布时间。
- 返回业务定义的成功/失败结果。

这些步骤是业务规则，通常比“怎样执行 `UPDATE posts`”更适合放在 Service。Service 可调用 Repository，也可在有明确理由时直接用 Drizzle 组合查询；重点是职责清楚，不是强制每层只能调用下一层。

## 12.3 不要为每条 SQL 造一层没有价值的抽象

下面这样的 wrapper 往往没有多少价值：

```ts
async function getAllPosts() {
  return db.select().from(posts);
}
```

如果它没有稳定业务命名、复用的字段投影、权限约束、复杂条件或可测试边界，单纯给一行 SQL 套一层函数未必提升可维护性。真正需要抽象时，抽象应表达业务意图或稳定的数据访问能力，而不是为了让目录里多出 `repository.ts`。

也不要把一个巨型 Repository 做成所有业务共享的“万能数据库对象”。按业务边界拆分，例如 `posts`、`users`、`billing`，但拆分尺度随项目增长。小项目先保持可读，出现重复查询、复杂业务流程和测试需求后再引入适度结构。

## 12.4 测试也有边界

- 数据库约束、外键行为、迁移 SQL 和并发冲突需要通过真实 PostgreSQL 集成测试验证；仅 mock Repository 不会证明约束生效。
- Service 中的业务分支可以用单元测试覆盖，也需要集成测试验证事务和数据库状态变化。
- 迁移测试应从干净数据库运行所有 migration，还应在测试环境里验证旧数据迁移和关键约束。

### 本章验收

- 你能解释 Repository 管数据访问、Service 管业务用例的大致分工。
- 你知道不是每条 SQL 都必须包进一个 Repository 方法。
- 你不会把 API DTO、数据库行类型和业务状态混成同一个随意流动的对象。

---

# 第 13 章：把项目跑通，并完成最终验收

前面每章都给出了对应代码。现在把它们组合成一个最小完整流程。

## 13.1 第一次迁移

确认以下文件已经就绪：

- `src/db/schema.ts`
- `src/db/relations.ts`
- `src/db/index.ts`
- `drizzle.config.ts`
- `.env` 中的 `DATABASE_URL`

执行：

```bash
npm run db:generate -- --name=init
npm run db:migrate
```

打开数据库客户端检查表、主键、外键、唯一索引、CHECK 与一般索引。如果迁移运行报错，不要立刻切换到 `push` 隐藏错误；先检查连接字符串、数据库权限、SQL 与当前 schema 是否匹配。

## 13.2 编写一个入口验证 CRUD

在 `src/index.ts` 中写一个短流程：

```ts
import { db, client } from "./db";
import { posts, users } from "./db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const [user] = await db
    .insert(users)
    .values({
      email: `learner-${Date.now()}@example.com`,
      displayName: "Drizzle Learner",
    })
    .returning({ id: users.id, email: users.email });

  if (!user) throw new Error("Could not create test user");

  const [post] = await db
    .insert(posts)
    .values({
      authorId: user.id,
      slug: `first-post-${Date.now()}`,
      title: "My first Drizzle post",
      body: "Learning schema, inferred types and queries.",
    })
    .returning();

  if (!post) throw new Error("Could not create test post");

  const selected = await db
    .select({ id: posts.id, title: posts.title, status: posts.status })
    .from(posts)
    .where(eq(posts.id, post.id));

  await db
    .update(posts)
    .set({ status: "published", publishedAt: new Date() })
    .where(eq(posts.id, post.id));

  console.log({ user, post, selected });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
```

运行：

```bash
npm run dev
```

这是一次性教程脚本，所以末尾关闭 client；在长驻 HTTP server 里不要在每个请求后关闭共享数据库客户端，而是在应用生命周期结束时再优雅关闭。运行脚本后，你应能在数据库中看到测试用户和文章，且状态变成 `published`。

如果你希望演示 delete，请在开发库执行：

```ts
await db.delete(posts).where(eq(posts.id, post.id));
```

不要在不确定目标数据库时运行无条件 `delete`。

## 13.3 核心概念逐项验收

完成下面的检查，不要求死记 API；能够解释并自己写出来才算掌握。

- [ ] **Postgres column builders**：知道 `serial`、`integer`、`text`、`timestamp`、`pgEnum` 对应的数据库类型及用法。
- [ ] **nullable/default**：能解释 `NULL`、`NOT NULL`、`DEFAULT` 以及它们对 insert/select 类型的不同影响。
- [ ] **约束与索引**：能区分 primary key、foreign key、unique、index、check，并能说明级联删除的影响。
- [ ] **schema 和 inferred types**：会使用 `$inferSelect` 与 `$inferInsert`，知道 select shape 包含默认生成字段、insert shape 可省略默认字段。
- [ ] **关系定义**：知道 ORM relation 不会自动替代数据库外键；会写一对多、多对多和 relation query。
- [ ] **JOIN**：理解 inner/left join 的结果形状与空值传播，并知道一对多连接会重复父行。
- [ ] **CRUD**：会做 select、insert、update、delete；能组合条件、排序、分页并选择返回列。
- [ ] **事务与并发**：能决定事务边界，理解唯一冲突、原子条件更新、隔离级别、重试和外部副作用。
- [ ] **drizzle-kit**：能生成并审阅迁移，区分 generate/migrate/push/pull，并解释迁移历史与生产发布流程。
- [ ] **raw SQL 安全性**：会用 `sql` 参数绑定；不拼接不可信字符串；动态标识符通过白名单处理。
- [ ] **性能**：能识别 N+1 和无界查询，给列表设置字段投影和限制，使用 `EXPLAIN` 验证索引假设。
- [ ] **连接配置**：知道长驻服务与 serverless 连接池策略不同；能解释 Supabase transaction pooler 的 prepared statement 限制。
- [ ] **分层**：能判断一个逻辑应放在 Repository、Service、API validation 还是数据库约束中。

## 13.4 自己做一遍的练习

**练习 A：加一个 `updated_at` 字段。** 给 `posts` 加可由数据库默认填充的 `updated_at`，生成 migration 并检查 SQL。进一步思考：PostgreSQL 的列 default 只会在 insert 时执行，update 时自动刷新需要应用赋值或数据库 trigger，不能误以为 `.defaultNow()` 会自动更新时间。

**练习 B：实现按标签筛选文章。** 输入一个 tag ID，查出其文章摘要。请分别使用 SQL join 与 relation query 写一版，比较输出形状和执行 SQL。

**练习 C：给每个作者显示文章数。** 使用 `count` 和 `groupBy`，并解释为什么直接 join 后不分组会有重复行。

**练习 D：模拟唯一冲突。** 连续插入相同 email 两次。观察数据库错误；再试用 `onConflictDoNothing`，讨论它是否符合你的账户注册业务。

**练习 E：改字段约束。** 假设 `summary` 最终必须非空。不要直接对已有表加 `NOT NULL`；先描述新增 nullable 列、回填、验证、添加约束的迁移步骤。

**练习 F：找出一处性能风险。** 在测试数据库造一些文章，比较无索引和适当复合索引的 `EXPLAIN (ANALYZE, BUFFERS)` 计划。记录查询计划变化，并说明索引对写入的代价。

**练习 G：为发布文章设计 Service。** 约定只有文章作者或管理员可以发布。让 API 层验证入参，Service 执行权限和状态规则，Repository 或 Drizzle 查询负责数据访问，数据库外键与 CHECK 约束兜底。说明哪些步骤要放进同一事务。

做完这些练习后，才算真正把“从 SQL 数据模型到类型化数据访问层”的流程串起来，而不是仅仅记住 Drizzle 的方法链。

---

# 官方文档与延伸阅读

教程以 Drizzle ORM 与 Supabase 的官方资料为主。官方文档更新较快，尤其要留意安装版本、Relational Queries v1/v2 的语法差异、驱动配置和迁移命令选项。遇到细节时，优先点开与项目实际版本一致的文档。

1. [Drizzle + PostgreSQL 入门](https://orm.drizzle.team/docs/get-started-postgresql)
2. [PostgreSQL column types](https://orm.drizzle.team/docs/column-types)
3. [Indexes & Constraints](https://orm.drizzle.team/docs/indexes-constraints)
4. [Drizzle relations](https://orm.drizzle.team/docs/relations)
5. [Relational Queries v1 到 v2 的迁移说明](https://orm.drizzle.team/docs/relations-v1-v2)
6. [SQL Select](https://orm.drizzle.team/docs/select)
7. [Joins](https://orm.drizzle.team/docs/joins)
8. [Insert / 冲突处理](https://orm.drizzle.team/docs/insert)
9. [Update](https://orm.drizzle.team/docs/update)
10. [Delete](https://orm.drizzle.team/docs/delete)
11. [Transactions](https://orm.drizzle.team/docs/transactions)
12. [SQL 模板与 raw SQL](https://orm.drizzle.team/docs/sql)
13. [Drizzle Kit generate](https://orm.drizzle.team/docs/drizzle-kit-generate)
14. [Drizzle Kit migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate)
15. [Migrations 总览](https://orm.drizzle.team/docs/migrations)
16. [Drizzle Kit 配置文件](https://orm.drizzle.team/docs/drizzle-config-file)
17. [Drizzle 与 Supabase 连接](https://orm.drizzle.team/docs/connect-supabase)
18. [Supabase 官方 PostgreSQL 连接指南](https://supabase.com/docs/guides/database/connecting-to-postgres)
19. [Supabase 连接池与连接限制](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits)

---

## 最后，请记住这五条原则

1. **Drizzle 的类型从 schema 来，但真实约束必须存在于数据库。**
2. **Insert 类型不是 select 类型；默认值、nullable 与主外键会影响可写和可读的形状。**
3. **Relations 是读取关系的 API 描述，外键才是数据库的引用完整性规则。**
4. **事务解决原子性，约束、原子更新和隔离策略一起处理并发正确性。**
5. **迁移、连接池、索引和生产发布是应用工程的一部分，不会因为使用 ORM 就自动消失。**
