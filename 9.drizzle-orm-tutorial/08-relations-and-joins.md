# 第 8 章：外键、关系查询和 Join 不是同一件事

[上一章](./07-select-and-pagination.md) · [目录](./README.md) · [下一章](./09-transactions-and-concurrency.md)

图书列表已经能显示了，但详情页还需要作者和最近书评。订单页需要订单里的图书。数据库里存的是独立表，页面要的却是嵌套对象。

本章用同一份数据分别做关系查询和 SQL Join，观察结果形状。理解这一步，你才不会因为 `with` 看起来方便，就误以为它会创建外键、保证唯一性或自动让查询廉价。

## 8.1 先把三个层次拆开

| 层次              | 例子                                      | 它保证什么                       |
| ----------------- | ----------------------------------------- | -------------------------------- |
| 数据库 FK         | `orders.user_id REFERENCES users(id)`     | 指向的用户必须存在，删除行为受控 |
| Drizzle relations | `orders.user = r.one.users(...)`          | ORM 知道查询如何连接并组织对象   |
| SQL Join          | `JOIN users ON orders.user_id = users.id` | 某一次查询怎样组合行             |

删除 relations 文件不会删除数据库外键。只写 relations 不会让 Kit 自动生成 FK。即使没有 relations，core `.innerJoin()` 仍然可以查询；即使没有 FK，relations 也可以按配置查，但悬空数据风险由你承担。

所有这些都不等于权限检查。用户是否能看到订单，需要可信身份和所有权/RLS 等明确策略。

## 8.2 先定义最简单的一对多

`users 1 → N orders`。在 `src/db/relations.ts` 写：

```ts
import { defineRelations } from "drizzle-orm";
import { users, orders } from "./schema";

export const relations = defineRelations({ users, orders }, (r) => ({
  orders: {
    user: r.one.users({
      from: r.orders.userId,
      to: r.users.id,
      optional: false,
    }),
  },
  users: {
    orders: r.many.orders(),
  },
}));
```

逐项解释：

- `orders.user` 决定嵌套返回键叫 user，不是自动生成表名。
- `from` 是当前 orders 的 userId。
- `to` 是关联 users 的 id。
- `r.one.users` 返回一个对象，`r.many.orders` 返回数组。
- 反向 orders 关系可从已给出的那一侧推断。多个相似关系时不能依赖含糊推断，要用 alias/明确配置消歧。

`optional: false` 主要是类型层面的断言：你确信每个订单一定能读到用户。本文有非空 FK、restrict 且教学查询没有 RLS 过滤用户，所以采用它；如果外键不存在、RLS 隐藏目标或关联附加筛选会排除目标，这个断言可能不成立。它不会补出缺失用户，也不会创建 NOT NULL。

## 8.3 初始化时提供 relations

第 2 章的 client.ts 改为：

```ts
import { relations } from "./relations";

export const db = drizzle({ client: pool, relations });
```

现在可以：

```ts
const result = await db.query.orders.findMany({
  where: { userId: authenticatedUserId },
  orderBy: { createdAt: "desc", id: "desc" },
  limit: 20,
  with: { user: { columns: { id: true, displayName: true } } },
});
```

`db.query` 是关系查询入口，与 `db.select().from(...)` 是两种不同风格。本文是 RQB v2：where 使用对象过滤、orderBy 可使用对象写法，初始化传 relations。

稳定 0.x 常见的是 `relations(table, ({ one, many }) => ...)`、初始化 `{ schema }`，where callback 写法也不同。不要把旧例子和本文新参数随意拼在一起。迁移旧项目请阅读官方 [v1 → v2 关系升级](https://orm.drizzle.team/docs/relations-v1-v2)。

## 8.4 多对多必须有真实连接表

一本书有多位作者，作者也能有多本书。第 4 章的 book_authors 保存真实关系，FK/复合 PK 保存完整性。RC 可以通过 `through` 跳过连接表形状，直接读取作者数组：

```ts
export const relations = defineRelations(
  { books, authors, bookAuthors },
  (r) => ({
    authors: {
      books: r.many.books({
        from: r.authors.id.through(r.bookAuthors.authorId),
        to: r.books.id.through(r.bookAuthors.bookId),
      }),
    },
    books: { authors: r.many.authors() },
  }),
);
```

from 的作者 ID 通过 author_id，to 的图书 ID 通过 book_id，两个 through 描述从两端走进同一连接表。

```ts
const book = await db.query.books.findFirst({
  where: { id: bookId },
  columns: { id: true, title: true },
  with: { authors: { columns: { id: true, name: true } } },
});
```

得到概念上这样的对象：

```ts
{
  id: 2,
  title: 'TypeScript 实战',
  authors: [{ id: 1, name: '林远' }, { id: 2, name: '周青' }]
}
```

如果没找到书，findFirst 返回 undefined，不是 `{ authors: [] }`。空作者数组表示“这本书存在，但没有符合关联查询的作者”。两者不要混为一谈。

## 8.5 连接表的额外字段怎么办？

`position` 是署名顺序，直接 authors 数组不会自动把 position 变成作者自己的列。所以增加对连接表本身的关系：

```ts
books: { credits: r.many.bookAuthors() },
bookAuthors: {
  book: r.one.books({ from: r.bookAuthors.bookId, to: r.books.id, optional: false }),
  author: r.one.authors({ from: r.bookAuthors.authorId, to: r.authors.id, optional: false }),
}
```

这段是关系配置片段，与上一节 books.authors 等放在同一个 defineRelations 中；不是另建一个同名变量覆盖旧关系。完整可复制文件见 [relations.ts](./example/src/db/relations.ts)。

查询：

```ts
const book = await db.query.books.findFirst({
  where: { id: bookId },
  columns: { id: true, title: true },
  with: {
    credits: {
      columns: { position: true },
      orderBy: { position: "asc" },
      with: { author: { columns: { id: true, name: true } } },
    },
  },
});
```

结果是 credits 数组，每项都有 position 和 author。设计模型时保存了关系属性，查询时才有办法正确读取它。

## 8.6 做一个带最近书评的完整详情

使用配套完整 relations（包括 reviews.user 与 reviews.book）后：

```ts
import { eq } from "drizzle-orm";
import { reviews } from "../db/schema";

export async function getBookDetail(db: Db, bookId: number) {
  return db.query.books.findFirst({
    where: { id: bookId },
    columns: {
      id: true,
      isbn: true,
      title: true,
      priceCents: true,
      stock: true,
      publishedOn: true,
    },
    with: {
      credits: {
        columns: { position: true },
        orderBy: { position: "asc" },
        with: { author: { columns: { id: true, name: true } } },
      },
      reviews: {
        columns: { id: true, rating: true, body: true, createdAt: true },
        orderBy: { createdAt: "desc", id: "desc" },
        limit: 5,
        with: { user: { columns: { displayName: true } } },
      },
    },
    extras: {
      reviewCount: (t) => db.$count(reviews, eq(reviews.bookId, t.id)),
    },
  });
}
```

`Db` 的完整定义见 [types.ts](./example/src/db/types.ts)，未整理分层时也可直接在当前 db 实例调用查询。

它返回图书基础列、按位置排序的署名、最多五条最新书评，以及总书评数。嵌套的投影也在 SQL 层实现，不是把整张 users 表完整拉到 Node 再删 email。

为什么 extras 用 callback 的 t？RQB 内部会给表起别名，当前作用域的列必须由 callback 参数引用。不要直接写导入的 books.id 放进嵌套 extras / RAW / orderBy，否则可能引用错误别名。

`$count` 是这里的相关子查询，数据库仍需要处理它；这不是一个白送的缓存数字。普通汇总报表、复杂 GROUP BY 更适合 core queries，而不是把任意聚合硬塞进 extras。

## 8.7 父级过滤与子级过滤的区别

```ts
await db.query.books.findMany({
  limit: 20,
  with: { reviews: { where: { rating: { gte: 4 } }, limit: 5 } },
});
```

它表示“查图书，每本书只附带高分书评”，不是“只查询有高分书评的图书”。没有高分书评的图书仍可能返回 reviews=[]。

RQB v2 可以在父级条件里使用关系过滤：

```ts
await db.query.books.findMany({
  where: { reviews: { rating: { gte: 4 } } },
  orderBy: { id: "asc" },
  limit: 20,
});
```

表示“具有符合条件的关联书评的图书”。先明确你在过滤父行还是嵌套数组，再决定条件放哪里。

RC 支持嵌套 offset，但可用不等于必用。父 limit=20、子 limit=5 约束形状仍可能读 100 条子行以及对应关联；无限嵌套不会因为只有一次 SQL 就变得便宜。

## 8.8 同一份数据用 Join 会怎样？

```ts
import { eq } from "drizzle-orm";
import { books, bookAuthors, authors } from "../db/schema";

const rows = await db
  .select({
    bookId: books.id,
    title: books.title,
    authorName: authors.name,
    position: bookAuthors.position,
  })
  .from(books)
  .innerJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
  .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
  .where(eq(books.id, bookId))
  .orderBy(bookAuthors.position);
```

共同作者的书会返回两行：

```text
bookId  title                 authorName  position
2       TypeScript 实战       林远         1
2       TypeScript 实战       周青         2
```

Join 合并的是行，不会自动变成一行里面的 authors 数组。关系查询额外替你组织了嵌套结构；Join 让你直接控制 SQL 行形状。

- Inner Join：只保留关联成功的组合。
- Left Join：保留左表行，即使右表没有对应记录。

外连接的右侧字段可为 null，即使其表声明列为 NOT NULL，因为没有匹配行时是查询制造了空右侧。

## 8.9 外连接的类型推断与条件位置

```ts
const rows = await db
  .select({
    bookId: books.id,
    author: { id: authors.id, name: authors.name },
  })
  .from(books)
  .leftJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
  .leftJoin(authors, eq(authors.id, bookAuthors.authorId));
```

author 对象可能为 null。若把字段平铺，authorId/name 也会分别带 nullable。自己编写 SQL 表达式时，例如 `upper(author.name)`，要如实声明 `sql<string | null>`；generic 不会自动替你推断 raw 表达式的空值语义。

另一个常见坑：

```text
LEFT JOIN reviews ...
WHERE reviews.rating >= 4
```

WHERE 会排除没有书评的空右侧行，实际不再保留“无评价图书”。若你想保留书，只限制附带的书评，应将相应条件放进 ON 子句或用子查询。不要仅凭 leftJoin 方法名判断最终语义。

## 8.10 为什么 Join 后 LIMIT 20 可能不是二十本书？

如果每本书三位作者，Join 后的 20 行最多只包含约七本书。给它 `limit(20)` 截的是组合行，不是先选二十本父记录。

要按父实体分页，先对 books 做筛选/排序/分页子查询，再 Join 作者；或者使用关系查询并分别约束父子数量。若需要一张报表“一行一个作者署名”，Join 后分页反而正合适。

先确定返回单位是什么：图书、订单、订单行，还是作者署名。ORM 不会替你猜单位。

## 8.11 选择关系查询还是 Join？

详情页需要嵌套作者/书评 → 关系查询通常更直接。

汇总“每本书平均评分、销售数量” → core Select + Join / GROUP BY 或独立聚合子查询更明确。同时 Join 两组一对多（作者与书评）时会发生行乘积，count/sum 可能被放大；先各自聚合再连接，或按业务选择 distinct。

逐条处理导出数据 → 明确字段、分批、有边界的查询，不因为 with 能写就附带整棵对象树。

本文 RQB 生成单条 SQL，常借助 LATERAL / JSON 聚合组织结果。一次网络往返能减少应用层 N+1，但单条 SQL 仍可能在数据库内有大量工作。第 10 章会用 EXPLAIN 看实际代价。

## 8.12 练习与验收

练习：为两位作者的图书分别写 Join 和关系查询。预测一个返回两行，一个返回一行中的 credits 数组，再执行。

参考判断：FK 与 relations 都应正确，但它们职责不同；position 属于连接表，所以读取它应走 credits。

再回答：只把 profiles 关联设为 one，能否阻止同用户两条 profile？不能，必须有唯一/主键约束。

- [ ] 能解释 FK、relations、Join 三者区别。
- [ ] 能查询一对多、多对多和连接表额外字段。
- [ ] 能正确处理 findFirst 未找到、空数组和外连接 nullable。
- [ ] 能区分父/子过滤，识别 Join 行乘积与分页单位。
- [ ] 不把单 SQL 等同于无限嵌套无成本。

官方阅读：[Relations](https://orm.drizzle.team/docs/relations)、[RQB](https://orm.drizzle.team/docs/rqb)、[Joins](https://orm.drizzle.team/docs/joins)、[Relations 升级](https://orm.drizzle.team/docs/relations-v1-v2)。
