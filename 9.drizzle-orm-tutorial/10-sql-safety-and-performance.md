# 第 10 章：Raw SQL、安全和性能是一条连续的链

[上一章](./09-transactions-and-concurrency.md) · [目录](./README.md) · [下一章](./11-connections-and-supabase.md)

ORM 会生成 SQL，但 SQL 仍是数据库真正执行的东西。本章学习怎样安全地写 ORM 没直接覆盖的表达式，以及怎样确认一条“看起来优雅”的查询不会拖垮应用。

## 10.1 Raw SQL 不等于拼接字符串

给图书列表返回标题的字符长度：

```ts
import { sql } from "drizzle-orm";

const rows = await db
  .select({
    id: books.id,
    title: books.title,
    titleLength: sql<number>`length(${books.title})`,
  })
  .from(books)
  .limit(20);
```

你仍然可以使用有类型的 builder，只在一个字段放进 SQL 表达式。这比为了一个表达式把整条查询改成拼接字符串更容易维护。

`sql` 后的反引号构成 tagged template。它接收到静态 SQL 片段和动态插值，分别处理表/列、SQL片段和值，不等于先做 JS 字符串模板拼接。

## 10.2 参数绑定：恶意字符串也只是一段值

```ts
const email = "' OR 1=1 --";
const query = db
  .select({ id: users.id })
  .from(users)
  .where(eq(users.email, email));
console.log(query.toSQL());
```

你会看到类似：

```text
sql: select "id" from "users" where "users"."email" = $1
params: ["' OR 1=1 --"]
```

数据库不会把 params 中的内容重新解释成 SQL 指令，它只比较有没有邮箱等于这段文本。

同样可以安全地写：

```ts
const result = await db.execute(sql`
  select "id", "display_name"
  from ${users}
  where ${users.email} = ${email}
  limit ${20}
`);
```

用户值不要自己加 SQL 单引号。正确的是 `= ${email}`，不是 `= '${email}'`。驱动知道如何绑定字符串；你加引号可能破坏占位符语义。

表/列对象插值会生成合适的带引号标识符。普通动态值则进入 params。`.values()`、`.set()`、`eq()` 等正常传值也会参数化。

## 10.3 sql.raw 是一个明确的安全边界

下面是危险示例，不要执行：

```ts
// 错误：用户数据先被拼成 SQL 文本。
const unsafe = sql.raw(`select * from users where email = '${email}'`);
```

`sql.raw` 不负责转义、不负责参数绑定。把它嵌套进 `sql` 也不会重新净化里面的文本。

它适合由开发者控制的固定 SQL 结构，例如迁移脚本中的常量语句，而不是用户输入。不要认为“用到了 Drizzle”就天然没有注入。

参数绑定还不是完整授权：安全绑定 `userId=另一个人的ID` 仍可能越权。身份 scope、字段白名单、RLS/Service 规则继续需要落实。

## 10.4 动态排序字段不能当成普通参数

假设 URL 传 `sort=price`、`direction=desc`。不能简单写：

```ts
sql`order by ${sort} ${direction}`;
```

因为绑定的字符串值不是 SQL 列名或关键字。也不能用 `sql.raw(sort)` 暴露任意 SQL 结构。正确做法是有限白名单：

```ts
import { asc, desc } from "drizzle-orm";
import { z } from "zod";

const sortingSchema = z.object({
  sort: z.enum(["price", "title", "createdAt"]).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("asc"),
});
const sorting = sortingSchema.parse(rawQuery);
const sortColumn = {
  price: books.priceCents,
  title: books.title,
  createdAt: books.createdAt,
}[sorting.sort];

const rows = await db
  .select({ id: books.id, title: books.title })
  .from(books)
  .orderBy(
    sorting.direction === "desc" ? desc(sortColumn) : asc(sortColumn),
    asc(books.id),
  )
  .limit(20);
```

这里外部输入只在有限集合中选择已有列对象，不会成为任意 SQL 文本。若使用游标，排序字段和方向变化也必须同步改变游标规则，不只是加一个动态 orderBy。

`sql.identifier(value)` 可以做标识符转义，但转义不等于授权。让用户随便指定任何表名，即使没有注入，也可能访问本不该访问的数据。结构动态化时仍要白名单与权限边界。

## 10.5 类型注解与运行时转换不要混淆

```ts
const rows = await db
  .select({
    count: sql<number>`count(*)`,
  })
  .from(books);
```

`sql<number>` 只是“我告诉 TypeScript 这个表达式应该是 number”。Postgres count 返回 bigint，驱动常把大整数传为字符串；泛型不会在运行时 Number()。

对明确在安全整数范围内的计数，可用 Drizzle 的 helper：

```ts
import { count } from "drizzle-orm";

await db.select({ value: count() }).from(books);
await db.select({ value: sql`count(*)`.mapWith(Number) }).from(books);
```

helper 会进行对应转换；超大规模计数依然要评估 JS 安全整数范围。SUM(numeric)、AVG 等也不能随便断言为 number，应该依据 SQL返回类型和驱动映射确定。

外连接表达式可能为 null，也要真实表达类型：`sql<string | null>`。类型声明不是让真实数据库值按照你希望的方式出现。

## 10.6 execute 返回的是驱动结果，不是神奇的实体映射

在 node-postgres 中常见是：

```ts
const result = await db.execute(sql`
  select id, price_cents from ${books} where id = ${bookId}
`);
console.log(result.rows);
```

字段名按 SQL 输出，例如 price_cents，不一定自动变成 priceCents。Date、numeric 和 JSON映射也不能假定和任意嵌套实体查询完全一致。

相比之下，core select 的列投影对象为你提供清晰结果键与列映射。如果写整条 raw SQL，需要自己选择别名并验证结果结构；不要对未知 raw 行做 `as Book[]` 就宣称类型化完成。

Raw SQL 可以用于复杂 PostgreSQL 特性，例如全文检索、窗口函数、CTE。它是可控逃生舱，而不是放弃类型和安全的必然结果。

## 10.7 N+1 是怎样出现的？

```ts
const page = await db
  .select({ id: books.id, title: books.title })
  .from(books)
  .orderBy(books.id)
  .limit(20);
for (const book of page) {
  const writers = await db
    .select()
    .from(bookAuthors)
    .where(eq(bookAuthors.bookId, book.id));
  // 后续还有逐作者查名字……
}
```

查询数量随记录数增长：先 1 次，再 N 次，甚至再多一层。数据库单次很快，累计往返仍然慢。

用 Promise.all 不会消除 N+1。它只把 N 条 SQL更并发地发给数据库，可能加大连接池竞争。

两种常见修复：

1. 合理有界的关系查询，在一次 SQL中读取嵌套数据。
2. 分两次批量读取，再用 Map 分组，不要每个父实体发一次请求。

第二种的完整核心示例：

```ts
import { eq, inArray } from "drizzle-orm";

const page = await db
  .select({ id: books.id, title: books.title })
  .from(books)
  .orderBy(books.id)
  .limit(20);
if (page.length === 0) return [];

const credits = await db
  .select({
    bookId: bookAuthors.bookId,
    position: bookAuthors.position,
    authorName: authors.name,
  })
  .from(bookAuthors)
  .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
  .where(
    inArray(
      bookAuthors.bookId,
      page.map((b) => b.id),
    ),
  )
  .orderBy(bookAuthors.bookId, bookAuthors.position);

const grouped = new Map<number, { position: number; authorName: string }[]>();
for (const credit of credits) {
  const group = grouped.get(credit.bookId) ?? [];
  group.push({ position: credit.position, authorName: credit.authorName });
  grouped.set(credit.bookId, group);
}
return page.map((book) => ({ ...book, credits: grouped.get(book.id) ?? [] }));
```

以上内容应放在 async 函数内部。父记录的查询有界，但还需要知道每本书作者数量的业务上界；如果一个父对象可能有十万子行，第二次查询仍然会巨大。

## 10.8 一次查询也可以无界

```ts
await db.query.users.findMany({
  with: { orders: { with: { items: { with: { book: true } } } } },
});
```

这可能一次请求取走全部用户、全部订单、全部订单行。没有 N+1 不等于安全。

为查询定义资源边界：

- 父表 limit、子集合 limit，以及合理最大页大小。
- 必要的用户/租户 scope 与筛选。
- 列投影，避免大 JSON、长文本和秘密字段。
- 计数、搜索与导出单独预算，必要时异步作业。
- 请求超时、数据库 statement timeout、慢查询观测。

LIMIT只约束返回行，不一定约束扫描/排序/聚合工作量。全表 count、深 offset、未索引搜索都可能处理大量数据。

## 10.9 怎样检查真正生成的 SQL？

先在开发脚本使用 `.toSQL()`：

```ts
const query = db
  .select({ id: books.id, title: books.title })
  .from(books)
  .where(ilike(books.title, "%SQL%"))
  .orderBy(books.id)
  .limit(20);
console.log(query.toSQL());
```

确认有你期待的 WHERE、ORDER BY、LIMIT、投影和 params。如果没有 scope，不能因为 TS 推断漂亮就放心。

创建 db 时 `logger: true` 可以看到执行语句。自定义 logger 还能数查询：

```ts
import type { Logger } from "drizzle-orm/logger";

class CountingLogger implements Logger {
  queries = 0;
  logQuery(query: string, _params: unknown[]) {
    this.queries++;
    console.log(query);
  }
}
```

Logger 回调通常记录查询发起，不是完整延迟追踪。单独脚本里计数很有帮助；多请求服务不能用一个全局计数随便相减当某请求指标，应使用请求级 tracing/context。

线上日志要脱敏。params 中可能含邮箱、订单信息和秘密；不要开启明文全量日志长期运行，也不要把数据库错误的完整 SQL/params 返回给用户。

## 10.10 用 EXPLAIN，而不是“加索引应该就好了”

在测试库对只读 SELECT 使用：

```ts
const plan = await db.execute(sql`
  explain (analyze, buffers)
  ${query.getSQL()}
`);
console.log(plan.rows);
```

`EXPLAIN` 看计划，`ANALYZE` 实际执行语句并记录时间。对 UPDATE/DELETE等写入使用 ANALYZE 会真正修改数据；不要在生产随便复制这个命令。

新手先看四件事：

1. `Seq Scan` / `Index Scan`：扫描方式是否符合你的数据规模和选择性。
2. 估计 rows 与实际 rows：统计信息是否严重失准。
3. 是否排序大量行、是否落盘、子计划 loops 有多大。
4. 大量行被过滤、buffer读取和实际耗时的位置。

小表选择顺序扫描可以是合理的，不是所有 Seq Scan 都是错误。也不要为了让 plan 出现 Index Scan 强行塞一堆索引。

复合索引应服务你的 WHERE + ORDER BY。普通 title索引通常不能直接加速 `%term%`；FK 也不自动替引用侧创建索引。用真实规模、有代表性参数、更新统计信息后再比较方案。

## 10.11 练习与验收

练习一：写一条恶意邮箱参数查询，检查 SQL文本里没有恶意值、params 里有它，执行结果没有返回全表。配套测试已经包含这个实验。

练习二：给 N+1 示例加 logger，比较父列表 2 行和 20 行时查询次数，再改为批量读取。目标是次数不随父列表线性增长，同时结果有界。

练习三：比较相同数据上 id 查询和 `%标题%` 查询的 EXPLAIN。不要在空表上宣称索引性能已经证明。

- [ ] 能安全使用 sql tagged template 并知道 sql.raw 的危险边界。
- [ ] 能区分值绑定、结构白名单、类型断言和运行时转换。
- [ ] 能识别 N+1、无界嵌套、深 offset和大聚合。
- [ ] 能核对生成 SQL、查询次数和执行计划，而不是只凭代码风格判断性能。

官方阅读：[SQL](https://orm.drizzle.team/docs/sql)、[Goodies / Logging](https://orm.drizzle.team/docs/goodies)、[Select / Aggregations](https://orm.drizzle.team/docs/select)、[Query performance](https://orm.drizzle.team/docs/perf-queries)。
