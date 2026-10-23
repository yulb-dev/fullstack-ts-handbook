# 第 1 章：从一张购物清单理解 SQL 与 ORM

[目录](./README.md) · [下一章](./02-setup-and-first-query.md)

## 1.1 先遇到一个问题，再引入数据库

小林在书店买了两本书。你可能第一反应是写一个 JavaScript 对象：

```ts
const order = {
  customer: { name: "小林", email: "reader@example.com" },
  books: [
    { title: "SQL 第一步", author: "林远", price: 49, quantity: 1 },
    { title: "TypeScript 实战", author: "林远", price: 69, quantity: 2 },
  ],
};
```

对象很容易显示在 React 页面上，但它还不是合理的持久化模型。想象再来一万张订单：小林的邮箱和同一本书的信息会被复制很多次。小林改名，要改所有订单吗？作者改笔名，要遍历所有历史记录吗？一本书有两位作者，`author` 又该怎样保存？

还有更棘手的问题：最后一本书被两个人同时点击购买，一个对象里的 `stock: 1` 无法协调两个服务器实例。

数据库不只是“一个保存对象的地方”。它提供共享的数据结构、约束、查询、并发控制和持久性。设计的第一步是决定：**哪些信息属于实体，哪些信息属于实体之间的关系，哪些信息是某个业务时刻的快照。**

## 1.2 表、行、列：不是数组的同义词

我们先把图书保存为一张表：

| id  | title           | price_cents | stock |
| --- | --------------- | ----------- | ----- |
| 1   | SQL 第一步      | 4900        | 10    |
| 2   | TypeScript 实战 | 6900        | 5     |

- 表（table）规定一种数据的结构。
- 行（row）是这个结构的一条记录。
- 列（column）有数据库类型，还可能有默认值和约束。
- 主键（primary key）是用来唯一识别一行的键，不是它在数组中的位置。

SQL 中可以声明：

```sql
CREATE TABLE books (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0)
);
```

逐句读一遍：

1. `CREATE TABLE` 创建结构，不是在读取数据。
2. `integer` 是整数，`text` 是字符串。
3. `GENERATED ALWAYS AS IDENTITY` 让数据库生成编号。
4. `PRIMARY KEY` 要求编号唯一且不能是 NULL。
5. `NOT NULL` 要求值存在，但并不禁止空字符串。
6. `DEFAULT 0` 在插入时没有给库存值时补上 0。
7. `CHECK` 禁止价格或库存为负数。

即使绕开你的 Node 服务，用别的 SQL 客户端写入，数据库也会检查这些规则。这正是它与 TypeScript 类型的区别。

不要期待编号连续：事务失败、删除记录、序列缓存都可能产生间隔。ID 的职责是标识，不是统计，也不是凭证流水号。

## 1.3 把重复的数据拆开：正常化是为了避免异常

“一个作者写多本书”提示我们建立 `authors` 表。书上记录作者名字，看似简单，实际上名字不是稳定身份：两位作者可以同名，一位作者也可能改名。

更稳妥的是保存作者 ID。当一本书有多位作者时，再增加连接表：

```text
books                 book_authors                 authors
id  title             book_id  author_id           id  name
1   SQL 第一步         1        1                   1   林远
2   TypeScript 实战    2        1                   2   周青
                       2        2
```

这里的第二张表不是“多余的一层”，它保存的是“作者参与创作某本书”这个事实。删除一条连接只改变署名关系，不必删除图书或作者本身。

这也解释了正常化（normalization）的实际意义：减少不必要的重复，让修改一个事实只需要修改它的权威位置。它不是要求你把任何字符串都拆成另一张表；是否拆分要看数据的独立身份、业务含义及查询方式。

### 订单价格为什么反而应该重复保存？

如果订单只保存 `book_id`，每次计算金额都去读 `books.price_cents`，书店改价后历史订单也会变价。这是不正确的。

所以 `order_items.unit_price_cents` 保存**下单时成交单价**，而 `books.price_cents` 保存**当前目录价格**。它们表达不同事实，保存快照不是无意义的数据冗余。

同理，真实物流订单通常保存收货地址快照，而不是永远引用用户最新地址。数据库设计要从语义判断，不能机械背诵“不能重复”。

## 1.4 四种 SQL 操作与执行顺序

结构定义通常称为 DDL，例如 `CREATE TABLE`、`ALTER TABLE`、`CREATE INDEX`。数据的读取与修改则是：

```sql
-- 创建一行
INSERT INTO books (title, price_cents, stock)
VALUES ('SQL 第一步', 4900, 10);

-- 读取有库存、价格不超过 50 元的图书
SELECT id, title, price_cents
FROM books
WHERE stock > 0 AND price_cents <= 5000
ORDER BY id ASC
LIMIT 20;

-- 给指定图书增加库存
UPDATE books SET stock = stock + 5 WHERE id = 1;

-- 删除指定图书
DELETE FROM books WHERE id = 1;
```

`SELECT` 的逻辑理解顺序，可以先记为：

```text
FROM / JOIN 找到数据源
→ WHERE 筛选行
→ GROUP BY / HAVING 分组并筛选组（有聚合时）
→ SELECT 决定返回字段
→ ORDER BY 排序
→ LIMIT / OFFSET 截取
```

数据库优化器的物理执行不一定按这个顺序，但这个顺序能帮助你理解语义。比如“先取 20 本书，再查作者”和“把书与作者展开后取 20 行”，得到的结果可能完全不同。

特别注意两个底线：

- 没有 `ORDER BY` 的结果没有稳定顺序，不能拿它作为可靠分页。
- `UPDATE` / `DELETE` 没有 `WHERE` 是合法 SQL，会影响整张表。

ORM 不会因为“你可能只是忘了写条件”就自动替你阻止这些语句。

## 1.5 Drizzle 到底在其中做什么？

Drizzle 是 SQL 上的一层 TypeScript 工具。它让你把表结构写成 TypeScript 声明，并由声明推导查询结果和写入参数的类型。

上面的查询可以写成：

```ts
import { and, asc, gt, lte } from "drizzle-orm";

const rows = await db
  .select({ id: books.id, title: books.title, priceCents: books.priceCents })
  .from(books)
  .where(and(gt(books.stock, 0), lte(books.priceCents, 5000)))
  .orderBy(asc(books.id))
  .limit(20);
```

这段代码仍然表达一条 SQL 查询，不是在 Node 内存中读取整个数组后 `filter()`。筛选、排序和截取在数据库执行，网络上只传回选中的结果。

这里的 `db` 与 `books` 下一章会实际创建。此刻重点是认出：`.from()` 对应 `FROM`，`.where()` 对应 `WHERE`，投影对象对应 `SELECT`。

Drizzle 给你的收益是：字段补全、基于 schema 的类型推断、可组合查询、参数绑定和迁移生成工具。它不会替你选择主键、设计订单快照、决定级联删除、解决全部竞态、自动添加最佳索引或者审核权限。

## 1.6 分清四个“schema”和两个包

新手常被 schema 一词困住：

| 名称           | 实际含义                                             |
| -------------- | ---------------------------------------------------- |
| 数据库 schema  | PostgreSQL 中类似命名空间的容器，如 `public`、`auth` |
| Drizzle schema | TypeScript 中声明的表、列、约束等模型                |
| 校验 schema    | Zod 等库的运行时输入规则                             |
| 迁移 snapshot  | Kit 用于比较历史结构的机器可读文件                   |

Drizzle schema 不会因为被 `import` 就自动在数据库里建表。你要通过迁移将设计应用到数据库。

两个 npm 包也有分工：

- `drizzle-orm` 负责运行时的数据访问：构建 SQL、类型推断、关系查询等。
- `drizzle-kit` 是开发/发布时的 CLI：读模型、生成迁移、执行迁移、检查历史。

而真正创建 TCP 连接、收发协议消息的是驱动，比如 `pg` 或 `postgres`。关系可以画为：

```text
你的业务函数 → drizzle-orm → 数据库驱动 → PostgreSQL
你的 schema → drizzle-kit → migration.sql → PostgreSQL
```

## 1.7 为什么数据库代码不能直接放在 React 中？

浏览器代码会发给用户。把 `DATABASE_URL`、数据库密码放进客户端 bundle，相当于把钥匙公开发放。TypeScript 或 ORM 并不会把它变安全。

通常是：

```text
浏览器 React
  → 带身份凭证的 HTTPS 请求
  → 服务端验证身份、输入和权限
  → Service / 数据访问函数
  → Drizzle / Postgres
```

Supabase 的浏览器客户端则走 Data API 和 RLS，它与“拿数据库密码直连 Postgres”是不同路线，第 11 章会比较。

## 1.8 动手：给需求找一个权威位置

不用写代码，先写下以下信息应该放哪里，以及理由：

1. 作者最新笔名。
2. 顾客本次订单里某本书的成交价。
3. 一本书的第二作者署名顺序。
4. 顾客的所有订单 ID。
5. 每人每本书只能写一条书评这个规则。

参考答案：

1. `authors.name`；更新一行即可，不在每本书复制名字。
2. `order_items.unit_price_cents`；这是历史成交事实。
3. `book_authors.position`；它属于关系，不属于作者本人。
4. 不必在 `users` 保存 ID 数组；`orders.user_id` 能表达并查询这个关系。
5. `reviews(user_id, book_id)` 上的数据库 UNIQUE；运行时可校验，但最终并发防线是数据库约束。

## 本章验收

- [ ] 能区分 DDL、数据查询与数据修改。
- [ ] 能解释为什么“查询形状”不一定等于“存储结构”。
- [ ] 能解释订单快照不是简单违反正常化原则。
- [ ] 能说出 Drizzle ORM、Kit、驱动和数据库四者的职责。
- [ ] 知道 schema 声明不会自动创建表，类型检查不会替代权限和数据库规则。

官方阅读：[Overview](https://orm.drizzle.team/docs/overview)、[Schema](https://orm.drizzle.team/docs/sql-schema-declaration)、[Relations Fundamentals](https://orm.drizzle.team/docs/relations-schema-declaration)。

接下来，[实际创建一个项目](./02-setup-and-first-query.md)。
