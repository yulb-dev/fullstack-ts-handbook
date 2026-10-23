# 第 5 章：读懂类型推断，真正完成增删改

[上一章](./04-constraints-and-modeling.md) · [目录](./README.md) · [下一章](./06-migrations-and-release.md)

这一章要拆掉一个常见误解：“我定义一个 Book interface，所有输入输出都用它就行。”

数据库完整行、插入参数、更新补丁和公开 API 响应，往往是四种不同的形状。Drizzle 能帮助推断其中一部分，但不能把业务输入与权限自动设计好。

## 5.1 从 schema 推断，别手抄一份行类型

沿用第 4 章的 books：

```ts
import { books } from "./db/schema";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";

type Book = typeof books.$inferSelect;
type NewBook = typeof books.$inferInsert;

// 同等用途的类型辅助 API：
type BookAlt = InferSelectModel<typeof books>;
type NewBookAlt = InferInsertModel<typeof books>;
```

`$inferSelect` / `$inferInsert` 是类型推断入口，不是运行时查询。`typeof` 在类型位置提取表对象的类型，TypeScript 再根据列配置计算模型。

完整 Book 形状可以理解为：

```ts
type BookExplanation = {
  id: number;
  isbn: string;
  title: string;
  priceCents: number;
  stock: number;
  publishedOn: string | null;
  createdAt: Date;
  updatedAt: Date;
};
```

但不要把这个说明用的 interface 当成第二份权威模型。若 schema 变更，你应该让类型自动跟着变，而不是维护两个文件。

## 5.2 Insert shape 为什么不等于 Select shape？

读取数据库完整行时，ID 已生成、默认值已填入，字段都属于这行；某些字段的值可能是 null。

插入前则不同：

```ts
const input = {
  isbn: "9780000000010",
  title: "从 SQL 到 Drizzle",
  priceCents: 5900,
} satisfies NewBook;
```

没有 stock，也没有 createdAt 和 updatedAt。数据库会提供默认值；没有 publishedOn，数据库允许其为 NULL。identity always 的 id 不属于普通可写入 shape。

一般规律：

| 列性质                    | 普通 Insert shape       | 完整 Select shape     |
| ------------------------- | ----------------------- | --------------------- |
| 非空、无默认值            | 通常必填                | 属性存在，值不为 null |
| 非空、有默认值            | 通常可省略              | 属性存在，值不为 null |
| 可空                      | 通常可省略，也可传 null | 属性存在，值可能 null |
| always generated identity | 普通写入中不应提供      | 读取时有值            |

因此不要写 `Partial<Book>` 充当 NewBook。它会让本应必填的 title/priceCents 变得可省略，还可能把不该普通写入的 generated 字段包含进来。

`undefined` 和 `null` 对应不同意图：省略值通常让默认填充逻辑处理；null 是明确的空值。

## 5.3 Insert 与 returning：返回数据库真正存下的结果

在脚本中加入：

```ts
const [created] = await db.insert(books).values(input).returning();
if (!created) throw new Error("没有返回新图书");
console.log(created.id, created.stock, created.publishedOn);
```

你应该看到自动生成的 ID、stock=0、publishedOn=null，以及创建时间。不是简单地把 input 原样返回。

如果只需要新 ID 与标题：

```ts
const rows = await db
  .insert(books)
  .values({
    isbn: "9780000000011",
    title: "另一本文集",
    priceCents: 3900,
  })
  .returning({ bookId: books.id, title: books.title });
```

推断为 `{ bookId: number; title: string }[]`。`bookId` 是响应键，并不会把数据库 id 列重命名。

`returning` 可以减少“插完又查一遍”的网络往返。它仍然返回数组，零行/多行都要按实际行为处理。例如 `onConflictDoNothing().returning()` 发生冲突时，常见结果是空数组，而不是返回已存在那行。

## 5.4 批量写入不是 Promise.all 插入循环

```ts
await db.insert(books).values([
  { isbn: "9780000000012", title: "数据库笔记", priceCents: 4900 },
  { isbn: "9780000000013", title: "SQL 练习册", priceCents: 2900 },
]);
```

它表达一条多 VALUES 的 INSERT。与循环执行两条 SQL 相比，网络往返更少，一条语句内部也具备原子性：没有特殊冲突处理时，其中一行违反约束会使整条语句失败。

真实导入要考虑参数数量、消息大小、内存、锁时长。不要把几百万行塞进一个 `.values()`。第 9 章会讨论分块与全局事务边界。

空数组不是“自然成功的空 INSERT”；调用前先判断是否有行。

## 5.5 Update shape：省略、保留与清空

给作者补简介：

```ts
import { eq } from "drizzle-orm";
import { authors } from "./db/schema";

await db
  .update(authors)
  .set({ bio: "作者擅长数据库教学" })
  .where(eq(authors.id, authorId));
```

这里的 `authorId` 要用实际查到的 ID。`.set()` 使用 TS 属性名 `bio`，不是拼接数据库列名。

接着做两次实验：

```ts
// 忽略 bio 这项：原简介保持不变。
await db
  .update(authors)
  .set({ bio: undefined, name: "林远" })
  .where(eq(authors.id, authorId));

// 明确清空简介。
await db.update(authors).set({ bio: null }).where(eq(authors.id, authorId));
```

不要用 `value ?? null` 处理所有输入。它会把未提交字段也转换成 null，造成意外清空。

对 NOT NULL 列不能传 null；`set({ title: null })` 应在类型检查时提示问题，数据库也会保护它。只有 undefined 的空补丁也不应该作为合法更新放行，业务入口应拒绝没有可修改字段的请求。

数据库 DEFAULT 不会在普通 UPDATE 中自动生效。如果确实要恢复默认，可以明确使用 SQL `DEFAULT`，但要理解这是主动修改，不是省略字段。

## 5.6 不要先读数值，再用旧数值写回

补库存应该这样表达：

```ts
import { sql } from "drizzle-orm";

const [changed] = await db
  .update(books)
  .set({ stock: sql`${books.stock} + ${5}` })
  .where(eq(books.id, bookId))
  .returning({ id: books.id, stock: books.stock });
```

`stock = stock + 5` 在数据库里计算。若两个请求都先 SELECT 得到 stock=10，再各自 `set({ stock: 15 })`，最后可能只有 15，而不是 20。事务和原子表达式的完整推演在第 9 章。

`.returning()` 无行意味着没有匹配，不能一律报告“更新成功”。数据库没有自动抛出你的业务 404。

## 5.7 条件不仅是定位，还可以守住所有权和状态

```ts
import { and, eq } from "drizzle-orm";
import { orders } from "./db/schema";

const updated = await db
  .update(orders)
  .set({ status: "paid" })
  .where(
    and(
      eq(orders.id, orderId),
      eq(orders.userId, authenticatedUserId),
      eq(orders.status, "pending"),
    ),
  )
  .returning({ id: orders.id, status: orders.status });
```

这条语句同时要求 ID、归属和原状态匹配，避免另一个人仅凭订单 ID 修改你的记录，也避免重复状态迁移。

但 `authenticatedUserId` 必须来自服务端已经验证的身份；不能让客户端在 body 里随便传。`paid` 还必须由可信支付结果触发，普通用户有权拥有订单并不意味着有权宣布它已经付款。

这一点 TypeScript 完全无法替你决定。本文 demo 的支付标记只是教学模拟，不是可直接开放的 HTTP 端点。

## 5.8 Delete：语法简单，影响需要设计

删除自己的书评：

```ts
import { reviews } from "./db/schema";

const removed = await db
  .delete(reviews)
  .where(and(eq(reviews.id, reviewId), eq(reviews.userId, authenticatedUserId)))
  .returning({ id: reviews.id });
```

没有 WHERE 的 `db.delete(reviews)` 会删除所有书评。Drizzle 不会自动要求你确认。

删除图书还受到外键策略约束：有订单行引用时会被拒绝；署名/书评的 cascade 只有在父图书删除成功后才发生。若真实业务采用归档，应增加 `archivedAt` 并在公开查询统一过滤，而不是装一个全局“软删除魔法”然后忘了某条 raw SQL。

不要在生产直接练习删除。学习时使用独立测试库，先选择出要影响的行，再对照 WHERE 与数据库返回结果。

## 5.9 数据库模型不是公开请求模型

注册用户的 NewUser 可能允许传入 role，但公共注册接口不能接受 admin：

```ts
import { z } from "zod";

const registration = z
  .object({
    email: z.email().transform((value) => value.toLowerCase()),
    displayName: z.string().trim().min(1).max(100),
  })
  .strict();

const validated = registration.parse(rawRequestBody);
await db.insert(users).values(validated);
```

Zod 做运行时校验和字段白名单，数据库 DEFAULT 填 customer，UNIQUE 挡重复邮箱。这三层各自有价值。

Drizzle 1.0 也提供 `createInsertSchema`：

```ts
import { createInsertSchema } from "drizzle-orm/zod";

const formSchema = createInsertSchema(books).pick({
  isbn: true,
  title: true,
  priceCents: true,
});
```

它可以复用列结构，但必须继续限制业务可写字段、格式与范围。它不会自动知道“只有管理员能改价格”，也不会自动复制所有数据库 CHECK 和跨表规则。

## 5.10 练习：从错误类型倒推真正意图

尝试写：

```ts
const wrong: Book = {
  isbn: "9780000000099",
  title: "新书",
  priceCents: 4900,
};
```

会缺少 id、stock、日期等字段。问题不是“TS 太严格”，而是你用完整已存储行类型表达了创建输入。

参考修改：使用 `satisfies NewBook`，然后把数据库 `.returning()` 的结果当成 Book。

再练习：将书评 body 从字符串改为 undefined，确认没有清空；改为 null 后确认被清空。若变更只允许 rating 和 body，别直接接收 `Partial<Review>`，那会把 userId、bookId 也暴露为可改字段。

## 本章验收

- [ ] 能从 schema 推断 select / insert 类型，并解释必填差异。
- [ ] 能完成单行和批量 insert、update、delete、returning 投影。
- [ ] 能正确处理 undefined 保留与 null 清空。
- [ ] 知道投影结果不是完整行，输入模型不等于公开权限。

官方阅读：[Type API](https://orm.drizzle.team/docs/goodies)、[Insert](https://orm.drizzle.team/docs/insert)、[Update](https://orm.drizzle.team/docs/update)、[Delete](https://orm.drizzle.team/docs/delete)、[Zod](https://orm.drizzle.team/docs/zod)。
