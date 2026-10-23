# 第 7 章：从“查所有书”走到一个可靠的图书列表

[上一章](./06-migrations-and-release.md) · [目录](./README.md) · [下一章](./08-relations-and-joins.md)

现在表和迁移都有了，产品要显示图书列表：按标题搜索、只看有库存、限制价格、每页 20 条。我们按需求逐步把最简单的 select 改造成可以复用的列表函数。

## 7.1 先确定页面需要什么字段

```ts
const rows = await db.select().from(books);
```

这会返回全部行和全部声明列。Drizzle 实际会显式列出列名，而不是简单 SELECT \*；但从业务角度它仍是“不限行、不限字段”的查询。

列表只需要 id、title、priceCents、stock：

```ts
const query = db
  .select({
    id: books.id,
    title: books.title,
    priceCents: books.priceCents,
    stock: books.stock,
  })
  .from(books);
```

这叫投影（projection）：在 SQL 的 SELECT 子句中决定返回列。不是先从数据库取完全部字段，然后在 JS map 里删掉。

结果自动推断为这四个属性的数组。若你访问 `rows[0]?.isbn`，TS 会提示不存在，因为没有选择这个字段。

API 公开数据更适合显式白名单投影，而不是“除密码外都返回”；以后表增加管理员备注时，白名单不会意外公开它。

## 7.2 一个条件，再到多个条件

```ts
import { and, eq, gt, lte, or } from "drizzle-orm";

const affordable = await db
  .select()
  .from(books)
  .where(and(gt(books.stock, 0), lte(books.priceCents, 5000)));
```

对应 SQL：

```sql
WHERE stock > $1 AND price_cents <= $2
-- 参数：[0, 5000]
```

组合条件时要按逻辑画括号。比如“价格低于 50 或标题命中，但必须有库存”：

```ts
.where(and(
  gt(books.stock, 0),
  or(lte(books.priceCents, 5000), eq(books.title, '指定图书')),
))
```

不是 `(有库存 AND 价格低) OR 标题命中`，后者会让缺货的指定书也进入列表。`and`/`or` 是 SQL 表达式构建函数，不是立即计算数据库值的 JS 布尔运算。

## 7.3 可选条件：没有参数意味着“不添加此条件”

```ts
const rows = await db
  .select()
  .from(books)
  .where(
    and(
      maxPriceCents !== undefined
        ? lte(books.priceCents, maxPriceCents)
        : undefined,
      inStockOnly ? gt(books.stock, 0) : undefined,
    ),
  );
```

`and` 会跳过 undefined 条件。这里对 maxPriceCents 用 `!== undefined`，因为 0 是合法筛选值；若写 `maxPriceCents ? ...`，会错误忽略 0。

查询 builder 常规模式下 `.where()` 通常只能调用一次。不要写 `.where(a).where(b)` 并猜测会自动合并。需要多个条件就先用 and/or 组合。

`.$dynamic()` 可支持动态查询增强函数，但它不是“自动合并任何重复条件”的授权。哪怕解除调用次数限制，也需要你明确组合筛选，避免后续设置覆盖原先的权限条件。

## 7.4 搜索字符串不是任何地方都能直接使用

标题包含搜索：

```ts
import { ilike } from 'drizzle-orm';

const search = 'SQL';
.where(ilike(books.title, `%${search}%`))
```

ILIKE 是 Postgres 不区分大小写的模式匹配。动态值仍被绑定为参数，不会直接注入 SQL 结构。

但 `%` 和 `_` 是 LIKE 通配符。用户搜索 `100%`，通常想找字面百分号，不是想匹配任意后缀。先转义：

```ts
export function escapeLike(input: string) {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
```

然后传 `%${escapeLike(search)}%`。这是默认 PostgreSQL LIKE 反斜线转义语义；如果主动更改 ESCAPE 设置，也要对应调整。

参数绑定解决注入，不解决搜索语义和性能。`%SQL%` 这种前置通配符搜索通常无法直接受益于普通标题 B-tree 索引；数据变大时要评估全文检索或 trigram 索引。先观察执行计划再选策略，第 10 章会讲。

## 7.5 offset 分页先容易理解，再知道代价

```ts
const page = 2;
const pageSize = 20;
const rows = await db
  .select({ id: books.id, title: books.title })
  .from(books)
  .orderBy(books.id)
  .limit(pageSize)
  .offset((page - 1) * pageSize);
```

第二页跳过 20 行，再取 20 行。至少要验证 page/pageSize 为正整数，并限制 pageSize 上限。

问题有两个：

1. 页码越深，数据库越可能需要扫描/跳过越多数据；LIMIT 20 不代表只处理 20 行。
2. 用户翻页过程中有插入/删除，前面的行移动，可能重复或漏行。

后台小规模、需要跳页的表格可以用 offset。持续滚动的大列表更适合游标/键集（keyset）分页。二者都有使用场景，不需要宣布其中一个永远错误。

## 7.6 游标是什么？它不是服务器保存的鼠标位置

游标表示“上一页最后一条记录的排序边界”。按 id 升序时：

```ts
const rows = await db
  .select()
  .from(books)
  .where(cursorId !== undefined ? gt(books.id, cursorId) : undefined)
  .orderBy(books.id)
  .limit(20);
```

下一页从 `id > 上次最后id` 开始，不再跳过大量前置行。

产品若要按创建时刻排序，仅存时间不够：同一事务里的书可能同一毫秒创建。排序和游标都应使用 `(createdAt, id)`：

```text
ORDER BY created_at ASC, id ASC

下一页：
created_at > 上次时间
OR (created_at = 上次时间 AND id > 上次id)
```

如果排序改成降序，比较方向也要改成 `<`。不能只改 orderBy，不改游标比较。

## 7.7 完整列表函数

下面就是 [book-repository](./example/src/repositories/book-repository.ts) 的核心实现。`Db` 是可接受 db 或 tx 的执行者类型，第 12 章展开；尚未做分层时，可以临时用 `type Db = typeof db` 表达当前实例类型。

```ts
import { and, asc, eq, gt, ilike, lte, or } from "drizzle-orm";
import { books } from "../db/schema";
import type { Db } from "../db/types";

export type BookCursor = { createdAt: Date; id: number };
export type ListBooksParams = {
  search?: string;
  maxPriceCents?: number;
  inStockOnly?: boolean;
  cursor?: BookCursor | null;
  limit?: number;
};

export function escapeLike(input: string) {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listBooks(db: Db, params: ListBooksParams = {}) {
  const requestedLimit = params.limit ?? 20;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    throw new RangeError("limit 必须是正整数");
  }
  const limit = Math.min(requestedLimit, 50);
  const { cursor } = params;

  const rows = await db
    .select({
      id: books.id,
      title: books.title,
      priceCents: books.priceCents,
      stock: books.stock,
      createdAt: books.createdAt,
    })
    .from(books)
    .where(
      and(
        params.search
          ? ilike(books.title, `%${escapeLike(params.search)}%`)
          : undefined,
        params.maxPriceCents !== undefined
          ? lte(books.priceCents, params.maxPriceCents)
          : undefined,
        params.inStockOnly ? gt(books.stock, 0) : undefined,
        cursor
          ? or(
              gt(books.createdAt, cursor.createdAt),
              and(
                eq(books.createdAt, cursor.createdAt),
                gt(books.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(asc(books.createdAt), asc(books.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}
```

多取一行是为了判断是否还有下一页，不是把所有匹配行 count 一遍。最后一页返回 nextCursor=null，调用者可以停下。

实际跟做：

```ts
const first = await listBooks(db, { limit: 2 });
console.log(first.items);
if (first.nextCursor) {
  const second = await listBooks(db, { limit: 2, cursor: first.nextCursor });
  console.log(second.items);
}
```

返回类型由查询投影推断，再由函数返回对象自然推断。不要强制给它一个 `Book[]`，因为它没有 isbn/publishedOn/updatedAt。

## 7.8 游标经过 HTTP 后需要重新验证

Date 放进 JSON 通常变为字符串。服务端不能把 URL 参数直接断言成 BookCursor。用 Zod 或同等运行时校验：

```ts
import { z } from "zod";

const cursorSchema = z.object({
  createdAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value)),
  id: z.number().int().positive(),
});
const cursor = cursorSchema.parse(JSON.parse(cursorText));
```

客户端发送的编码字符串可以用 Base64URL 包装，但编码不是加密、签名或权限检查。如果不想允许改游标内容，需签名；无论是否签名，每次查询的用户/租户 scope 都要来自服务端可信上下文。

对列表入口还应验证 search 长度、maxPriceCents 的非负整数范围、cursor 日期合法性。Repository 的 typed 参数假设入口已验证，不代表 TS 可以从 HTTP 字符串中自动提供安全保证。

翻下一页时必须保留相同筛选和排序；修改搜索条件后应清掉旧游标。从“查询所有书”的游标不能直接当成“只查询某作者”的新边界。

## 7.9 游标也不是一次查询快照

游标减少 offset 位移问题，但不能冻结整个列表。分页之间若修改排序字段，仍可能重复或漏行；筛选条件、可见性也可能变化。

本文使用通常不变的 createdAt + id，减少这一问题。需要严格快照导出时，需要额外的一致性/导出设计，而不是把 UI 多页请求包进一个跨分钟事务。

对应索引 `(created_at, id)` 已在第 4 章模型声明。若还按 tenant_id 过滤，可能需要 `(tenant_id, created_at, id)`；索引要匹配实际常用过滤和排序。

## 7.10 练习与参考判断

练习一：改为“最新图书优先”，实现相应游标。

答案要点：两个 orderBy 都 desc，时间比较和相同时间的 id 比较都用 lt，返回上一页最后行的两个键。

练习二：为什么只按 createdAt 排序，不加 id，会出现问题？

答案：时间可能重复，没有稳定、唯一的行边界。只用 `createdAt > cursor` 会漏同时间的剩余行。

练习三：给本章列表加一个“ISBN 搜索”条件，但仍要求有库存。先画括号，再实现 and/or；确认 OR 没有绕过库存或权限条件。

- [ ] 能写投影、条件组合、可选筛选和稳定排序。
- [ ] 能解释 offset 与游标各自代价。
- [ ] 能实现复合游标并限制页大小。
- [ ] 能处理 HTTP 日期类型、清掉失效游标，并理解非快照语义。

官方阅读：[Select](https://orm.drizzle.team/docs/select)、[Operators](https://orm.drizzle.team/docs/operators)、[Conditional Filters](https://orm.drizzle.team/docs/guides/conditional-filters-in-query)、[Cursor Pagination](https://orm.drizzle.team/docs/guides/cursor-based-pagination)、[Dynamic Query Building](https://orm.drizzle.team/docs/dynamic-query-building)。
