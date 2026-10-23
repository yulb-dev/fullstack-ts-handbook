# 第 4 章：把业务规则放到正确的约束里

[上一章](./03-columns-and-defaults.md) · [目录](./README.md) · [下一章](./05-types-and-crud.md)

现在我们已经能描述列，但“每列有类型”还不足以形成正确的数据模型。库存为 -1 仍是整数，不存在的图书 ID 仍是整数，重复书评也仍是一条结构完整的记录。

这一章将业务要求翻译成数据库约束，再选择能支持常用查询的索引。最终你会拥有七张表，而不是七个互不相关的对象类型。

## 4.1 先画关系，再写代码

```text
users 1 ── N orders 1 ── N order_items N ── 1 books
  │                                                │
  └─ 1 ── N reviews N ── 1 ────────────────────────┘
                                                   │
                                                   N
                                             book_authors
                                                   N
                                                   │
                                                authors
```

`book_authors` 的每一行属于一位作者和一本书。这个连接表把“图书与作者多对多”拆成两个一对多关系。

先问自己：

- 订单必须属于一个存在的用户吗？是：非空外键。
- 删除用户能否抹掉财务订单？不能：restrict。
- 删除图书时是否能删除它的署名关系？可以：cascade。
- 有历史订单引用的书能不能直接删除？不能：restrict，实际常采用归档字段。
- 一个用户能否对同一本书创建两条评论？不能：复合 UNIQUE。

这些决定都是数据设计，不是 ORM 选型的结果。

## 4.2 主键、外键、唯一、CHECK 和索引各管什么？

### 主键：这一行是谁

主键必须唯一且非空。一张表只有一个主键，但主键可以包含多列。订单行用 `(order_id, book_id)` 表示“这张订单中的这本书”；本教程要求购物车先合并同书数量，所以不需要另一枚独立订单行 ID。

Postgres 会为主键创建唯一索引。不要再为同一列/列组合建一个完全相同的普通索引。

### 外键：指向的实体是否存在

```ts
userId: integer()
  .notNull()
  .references(() => users.id, { onDelete: "restrict" });
```

外键由数据库执行。它引用的列需要具备合适的唯一性，常见的是另一张表的主键，不是任意普通列。

`.notNull()` 与 FK 不同：允许 NULL 的外键通常允许“不关联任何父行”。而非空外键表达“必须有关联”。

删除行为：

- `restrict`：仍有引用时拒绝删除。
- `cascade`：删除父行时一并删除引用它的子行。
- `set null`：清空引用；子列必须允许 NULL。
- 默认 `no action`：通常同样阻止不合法删除，但与 restrict 在约束检查时机等方面存在差异，不能完全混为一谈。

不要看到 cascade 很方便就给所有 FK 添加 cascade。误删用户后连历史订单一起消失，可能是严重事故。

### UNIQUE：哪个业务标识不能重复

`books.isbn` 唯一；书评的用户与图书组合唯一；幂等键在同一用户下唯一。

Postgres 默认 UNIQUE 通常允许多个 NULL。若业务真的要求“最多一个空值”，要结合 NOT NULL 或明确的 `NULLS NOT DISTINCT` 设计。不要把 nullable UNIQUE 当成必填唯一标识。

### CHECK：这一行的值是否符合规则

```ts
check("books_stock_nonneg_ck", sql`${t.stock} >= 0`);
```

CHECK 适合一行内部的规则，如评分 1～5、数量 > 0。含 NULL 的表达式可能产生 unknown 而通过 CHECK；如果不能为 NULL，要同时 NOT NULL。

“所有订单行金额之和等于订单总额”跨多行，不是一个简单 CHECK 能可靠解决的问题。本文由事务内 Service 计算；如果有多个独立写入方，还需进一步定义写入协议或数据库机制。

### 索引：怎样更快找到行

普通索引不拒绝重复数据；UNIQUE 索引同时承担唯一性限制。FK 并不会自动为引用侧列创建索引。

例：`orders(user_id, created_at)` 支持查某用户的最近订单。复合 B-tree 索引往往最自然地支持左侧前缀查询；`(book_id, author_id)` 的 PK 索引已经能服务按 book_id 找署名，而按 author_id 找图书仍需要另一方向索引。

这不是机械的“所有外键再建三个索引”。每个索引增加存储空间和写入成本，应该根据真实查询和执行计划选择。

## 4.3 写完整模型

从零跟做时，将 `src/db/schema.ts` 扩展为下面内容。它与 [配套 schema](./example/src/db/schema.ts) 表达同一模型。

```ts
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  primaryKey,
  smallint,
  snakeCase,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["customer", "admin"]);
export const orderStatus = pgEnum("order_status", [
  "pending",
  "paid",
  "cancelled",
]);

const timestamps = {
  createdAt: timestamp({ withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp({ withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = snakeCase.table(
  "users",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    email: text().notNull(),
    displayName: text().notNull(),
    role: userRole().notNull().default("customer"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    check("users_email_format_ck", sql`position('@' in ${t.email}) > 1`),
  ],
);

export const authors = snakeCase.table("authors", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  bio: text(),
  ...timestamps,
});

export const books = snakeCase.table(
  "books",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    isbn: varchar({ length: 13 }).notNull().unique("books_isbn_uq"),
    title: text().notNull(),
    priceCents: integer().notNull(),
    stock: integer().notNull().default(0),
    publishedOn: date({ mode: "string" }),
    ...timestamps,
  },
  (t) => [
    check("books_price_nonneg_ck", sql`${t.priceCents} >= 0`),
    check("books_stock_nonneg_ck", sql`${t.stock} >= 0`),
    index("books_created_at_id_idx").on(t.createdAt, t.id),
  ],
);

export const bookAuthors = snakeCase.table(
  "book_authors",
  {
    bookId: integer()
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    authorId: integer()
      .notNull()
      .references(() => authors.id, { onDelete: "restrict" }),
    position: smallint().notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.authorId] }),
    index("book_authors_author_id_idx").on(t.authorId),
  ],
);

export const orders = snakeCase.table(
  "orders",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: orderStatus().notNull().default("pending"),
    totalCents: integer().notNull(),
    idempotencyKey: uuid().notNull(),
    ...timestamps,
  },
  (t) => [
    unique("orders_user_idempotency_uq").on(t.userId, t.idempotencyKey),
    check("orders_total_nonneg_ck", sql`${t.totalCents} >= 0`),
    index("orders_user_created_idx").on(t.userId, t.createdAt.desc()),
  ],
);

export const orderItems = snakeCase.table(
  "order_items",
  {
    orderId: integer()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    bookId: integer()
      .notNull()
      .references(() => books.id, { onDelete: "restrict" }),
    quantity: integer().notNull(),
    unitPriceCents: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.bookId] }),
    index("order_items_book_id_idx").on(t.bookId),
    check("order_items_quantity_pos_ck", sql`${t.quantity} > 0`),
    check("order_items_price_nonneg_ck", sql`${t.unitPriceCents} >= 0`),
  ],
);

export const reviews = snakeCase.table(
  "reviews",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bookId: integer()
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    rating: smallint().notNull(),
    body: text(),
    ...timestamps,
  },
  (t) => [
    unique("reviews_user_book_uq").on(t.userId, t.bookId),
    index("reviews_book_id_idx").on(t.bookId),
    check("reviews_rating_range_ck", sql`${t.rating} between 1 and 5`),
  ],
);
```

先读每个第三参数 callback。它返回数组，是本文采用的 table-level constraint/index 写法。列里写 `.unique()` 表达单列唯一；callback 中 `unique().on(...)` 适合复合唯一。

`users_email_lower_uq` 是表达式 UNIQUE 索引，保证邮箱大小写不敏感。我们还在 Service 中将邮箱小写，但真正挡住不同写入方和并发重复的，是数据库索引。

邮箱 CHECK 只是教学性的最低检查，它不是完整邮箱格式验证。varchar(13) 也只限制最长 13 字符，并不验证 ISBN 校验位。**“数据库有约束”不等于“所有业务输入都已验证”。**

## 4.4 让模型真正进入数据库

生成并检查迁移：

```bash
npx drizzle-kit generate --name=bookstore_model
```

如果从第 2 章延续，你会看到对 users 的 ALTER，以及其余六张表、枚举、索引和外键的创建。打开 SQL，逐项对应模型，而不是只看 CLI 是否成功。

```bash
npx drizzle-kit migrate
```

若第 2 章重复创建了同邮箱用户，新增唯一索引可能失败。这不是 Kit 失灵，而是数据库拒绝接受不符合新规则的已有数据。先用查询找到冲突，再根据实际业务合并/纠正，不能为了迁移通过随意删除业务数据。

后续例子默认使用本章模型。你可以把代码放进新的脚本，仍然沿用第 2 章的 `try/finally closeDb()` 执行框架。

## 4.5 用坏数据验收，不要只用好数据

以下写入都值得在专用测试数据库尝试：

```ts
import { eq } from "drizzle-orm";
import { books, reviews } from "../db/schema";

// number 类型合法，数据库 CHECK 不允许。
await db.update(books).set({ stock: -1 }).where(eq(books.id, 1));

// 外键要求被引用的用户和图书存在。
await db.insert(reviews).values({ userId: 999999, bookId: 999999, rating: 5 });
```

预期分别出现 SQLSTATE `23514`（CHECK）和 `23503`（FK）。如果第一个没有行匹配，就不会触发 stock CHECK；请先创建/读出一个实际图书 ID，不能拿不存在的 ID 验证规则。

这说明测试应覆盖“类型能表达，但数据库不应该接受”的输入。第 12 章的测试会避免硬编码不存在的种子 ID。

## 4.6 一对一也需要数据库证明

你可能以后增加用户 profile：

```ts
export const profiles = snakeCase.table("profiles", {
  userId: integer()
    .primaryKey()
    .references(() => users.id),
  bio: text(),
});
```

共享主键让每个用户最多对应一个 profile。如果只是普通非唯一 `user_id` 外键，即使关系查询写成 `one`，数据库依然能插入多条 profile。ORM 的 `one` 不是唯一约束。

## 4.7 练习：订单为什么不能随便 cascade？

问题：把 `orders.userId` 的删除规则改为 cascade 后，删除用户会发生什么？为什么可能不可接受？

参考推演：用户删除导致订单删除，订单删除再导致 order_items 删除。若订单用于财务、审计或售后，历史记录消失。真实产品可能需要用户匿名化、软删除或受控归档，而不是通用级联。

第二题：给 `book_authors(book_id, author_id)` 再建同列复合普通索引有什么价值？

参考判断：通常无额外价值，因为 PK 已有对应唯一索引。是否需要反向 `(author_id, book_id)`，取决于按作者找图书的查询量和执行计划。

## 本章验收

- [ ] 能解释每张表的主键、外键和删除规则。
- [ ] 能说明 FK 与索引不是同一个东西。
- [ ] 能写复合 PK / UNIQUE 和单行 CHECK。
- [ ] 能让数据库拒绝负库存、悬空引用和重复书评。
- [ ] 知道哪些业务规则仍由 Service 或其他数据库机制维护。

官方阅读：[Indexes & Constraints](https://orm.drizzle.team/docs/indexes-constraints)、[Relations Fundamentals](https://orm.drizzle.team/docs/relations-schema-declaration)。
