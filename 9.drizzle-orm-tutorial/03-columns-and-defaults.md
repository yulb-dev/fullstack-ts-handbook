# 第 3 章：从 Postgres 列类型到 TypeScript 值

[上一章](./02-setup-and-first-query.md) · [目录](./README.md) · [下一章](./04-constraints-and-modeling.md)

用户表跑通后，现在给图书定义字段。先不要急着添加关系；本章专门练习最容易产生误解的东西：类型、NULL、默认值和“由谁生成值”。

## 3.1 Builder 描述的是数据库列，不是某个 JS 值

`text()` 不是创建字符串，`integer()` 也不是把输入转换为整数。它们返回列的 builder，让你声明数据库结构：

```ts
import { integer, pgTable, text } from "drizzle-orm/pg-core";

export const books = pgTable("books", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  title: text().notNull(),
  priceCents: integer("price_cents").notNull(),
  stock: integer().notNull().default(0),
});
```

生成的 DDL 约等于：

```sql
CREATE TABLE books (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  price_cents integer NOT NULL,
  stock integer NOT NULL DEFAULT 0
);
```

Builder 的链式方法逐渐积累元数据，也改变推断出的类型。例如 `.notNull()` 会让完整行的对应属性从 `string | null` 变成 `string`，`.default()` 会影响插入参数是否可以省略。

它们不会检查客户端的 `JSON.parse()` 结果。浏览器传入 `priceCents: '便宜'`，必须在服务端用运行时校验拒绝，不能指望 TypeScript 在运行时出现。

## 3.2 本项目常用的列如何选择

| SQL 类型       | Builder                               | 常见 JS/TS 值            | 适用场景                   |
| -------------- | ------------------------------------- | ------------------------ | -------------------------- |
| integer / int4 | `integer()`                           | `number`                 | 库存、数量、分单位金额     |
| smallint       | `smallint()`                          | `number`                 | 1～5 评分、有限范围整数    |
| text           | `text()`                              | `string`                 | 标题、介绍、邮箱           |
| varchar(n)     | `varchar({ length: n })`              | `string`                 | 有数据库最大长度要求的字段 |
| boolean        | `boolean()`                           | `boolean`                | 明确的开关                 |
| uuid           | `uuid()`                              | `string`                 | 幂等键、外部标识           |
| numeric(p,s)   | `numeric({ precision: p, scale: s })` | 默认 `string`            | 精确十进制、小数金额       |
| bigint         | `bigint({ mode: 'bigint' })`          | `bigint`                 | 超出普通整数范围的计数     |
| date           | `date({ mode: 'string' })`            | `string`                 | 不带时刻的日历日期         |
| timestamptz    | `timestamp({ withTimezone: true })`   | 默认 `Date`              | 下单、创建等事件时刻       |
| jsonb          | `jsonb()`                             | 需要明确结构或运行时校验 | 灵活、非核心关系数据       |

加不加 `.notNull()` 还会决定是否带 `| null`。表里写的是非空情况下常见值，不是每列都默认非空。

### 为什么价格用 priceCents？

JavaScript 浮点数有 `0.1 + 0.2 !== 0.3` 的问题。书店金额只需要两位小数，因此用“分”的整数：49 元存成 4900。计算订单总价也用整数。

Postgres int4 范围是 -2,147,483,648 到 2,147,483,647，比 JavaScript safe integer 小得多。业务函数计算总额后必须检查数据库范围，不能只做 `Number.isSafeInteger`。

如果业务需要多货币、小数税率或非常大金额，考虑 `numeric` 与十进制运算库。默认把 numeric 当字符串，保留精度；强行使用 `mode: 'number'` 会承担 JS 浮点精度损失。`sql<number>` 更不会神奇地解决这个问题。

`bigint` 超出 JS 安全整数时也不能随便转 number；此外 `JSON.stringify` 默认不能序列化 JS bigint，API 层应有明确的字符串输出规则。

## 3.3 NULL 不是 undefined，更不是空字符串

给作者新增简介：

```ts
bio: text();
```

它默认允许 SQL NULL。NULL 表示“这个值没有提供/未知”，不是 `''`。

- SQL NULL 在普通 select 中映射为 JS `null`。
- JS `undefined` 一般表达“这次没有提供这个属性”，数据库并没有一个对应的 undefined 值。
- `''` 是一个存在的空字符串，NOT NULL 不会拒绝它。

查询空值不能写 `bio = NULL`：SQL 的普通等号不能按你的直觉比较 NULL。用：

```ts
import { isNull, isNotNull } from "drizzle-orm";

await db.select().from(authors).where(isNull(authors.bio));
await db.select().from(authors).where(isNotNull(authors.bio));
```

分别对应 `IS NULL` 和 `IS NOT NULL`。`WHERE` 只保留条件为 true 的行；含 NULL 的比较经常产生 unknown，而不是 true/false 二选一。

## 3.4 默认值和非空约束是两个独立开关

对比四个列声明：

```ts
const demo = pgTable("column_demo", {
  a: text(),
  b: text().notNull(),
  c: text().default("hello"),
  d: text().notNull().default("hello"),
});
```

按插入和读取来分析：

| 声明                                   | 插入时省略          | 显式插入 null   | 完整读取类型 |
| -------------------------------------- | ------------------- | --------------- | ------------ | ----- |
| `a: text()`                            | 允许，结果通常 NULL | 允许            | `string      | null` |
| `b: text().notNull()`                  | 不允许，且无默认值  | 不允许          | `string`     |
| `c: text().default('hello')`           | 允许，得到 hello    | 允许，结果 NULL | `string      | null` |
| `d: text().notNull().default('hello')` | 允许，得到 hello    | 不允许          | `string`     |

`DEFAULT` 不等于“遇到 null 自动修复”。它是在 INSERT 没有提供值或使用 DEFAULT 时生效，显式 NULL 就是你提供的值。

也不要把数据库默认值理解为 UPDATE 的自动行为。更新其他字段时 `stock.default(0)` 不会把已有库存重置成 0。

在 Drizzle 的 insert values 中，省略/undefined 一般表示采用默认填充路径；更新的 `.set()` 则忽略 undefined。第 5 章会用真实修改演示这个区别。

## 3.5 数据库默认值与运行时默认值

### 数据库负责生成

```ts
import { uuid, timestamp, integer } from "drizzle-orm/pg-core";

id: uuid().defaultRandom().primaryKey();
createdAt: timestamp({ withTimezone: true }).notNull().defaultNow();
stock: integer().notNull().default(0);
```

它们分别生成数据库的 `gen_random_uuid()`、`now()` 和 `DEFAULT 0`。别的程序直接写 SQL，也能得到这些默认值。

注意 `now()` 在 PostgreSQL 中是事务开始时刻，同一事务多行的创建时间可能完全一样。用它排序时应加 ID 作为第二排序键。

### Drizzle 在 JS 运行时负责生成

```ts
import { randomUUID } from "node:crypto";

externalId: text("external_id")
  .notNull()
  .$defaultFn(() => randomUUID());
updatedAt: timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());
```

`$defaultFn` / `$default` 是别名；`$onUpdateFn` / `$onUpdate` 也是别名。这里的 `$` 提醒你它属于 ORM 运行时。

它们不会作为数据库 DEFAULT 或触发器生成到 Kit 迁移中。绕过 Drizzle 的 SQL 不会触发它们。`$onUpdate` 在 ORM update 未显式提供该字段时补值；若没有默认值，文档还说明它可参与 insert 的补值。

因此项目中 `updatedAt` 的维护策略是：通过 ORM 修改会自动补当前时间，直接 raw UPDATE 必须自己维护。如果你要求所有写入方都统一维护时间，需要数据库 trigger 或组织明确的写入协议，而不是仅靠 `$onUpdate`。

生产中也要决定时间取自应用服务器还是数据库，不要在必须严格统一时钟的场景随意混用。

## 3.6 identity、serial 和 UUID 的职责

本项目用：

```ts
id: integer().primaryKey().generatedAlwaysAsIdentity();
```

它清楚表达“数据库管理这个标识”。区别如下：

- `generatedAlwaysAsIdentity()`：通常不能显式插入 ID，除非 SQL 使用对应 override 机制。
- `generatedByDefaultAsIdentity()`：默认生成，但允许指定 ID。
- `serial()`：Postgres 传统序列简写，旧示例中很常见，不等于“不正确”。
- `uuid().defaultRandom()`：数据库生成随机 UUID，应用也可以显式传 UUID。

自动生成不等于唯一性：identity 管生成，PRIMARY KEY 管唯一。不要把一个数字 sequence 当成免加 PK 的理由。

幂等键则由调用方针对一次请求生成，不能用订单自己的 auto ID 替代。本文 `orders.idempotencyKey` 没有默认值，因为重试必须带同一个键，服务端每次重新生成就无法识别重复请求。

## 3.7 日期与时间：不要在不知不觉间丢掉时区和精度

出版日期不需要时刻，使用：

```ts
publishedOn: date({ mode: "string" });
```

得到 `2026-01-01` 这样的日历日期，不应把它随意转换成某个时区的午夜再跨时区展示。

订单创建时间是一个全球可比较的时刻：

```ts
createdAt: timestamp({ withTimezone: true, precision: 3 })
  .notNull()
  .defaultNow();
```

`withTimezone: true` 对应 `timestamp with time zone`，常写成 `timestamptz`。它保存的是一个绝对时刻，不是保留原始输入的时区名字。显示哪个时区由数据库/应用格式化决定。

默认 date 模式映射为 JS Date；`mode: 'string'` 则让你自行处理原始文本。API JSON 往往把 Date 输出为 ISO 字符串，浏览器收到的不是自动复活的 Date 对象。

为什么本文精度设为 3？Postgres 默认可保存微秒，而 JS Date 只能表示毫秒。若直接把微秒时间读成 Date，再用于 `(created_at, id)` 游标条件，会丢精度并可能漏行/重复。本文把数据库列约束为毫秒；如果你的项目必须保留微秒，用无损字符串游标与相应查询设计，别盲目截断。

## 3.8 枚举与 JSON 的类型边界

数据库枚举：

```ts
import { pgEnum, snakeCase } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["customer", "admin"]);
export const users = snakeCase.table("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  role: userRole().notNull().default("customer"),
});
```

`pgEnum` 会生成数据库 TYPE，数据库真的会拒绝其他值。相对地，`text({ enum: [...] })` 或 `$type<'a' | 'b'>()` 主要改变 TS 推断，并不自动创建一个检查内容的数据库枚举约束。

枚举很好地表达稳定有限集合，但变更枚举也需要迁移，特别是删除/重新组织取值比较麻烦。如果状态经常由运营新增，可以考虑字典表，而不是每新增一项就发布程序。

JSON 可定义类型：

```ts
metadata: jsonb().$type<{ language: string; keywords: string[] }>();
```

`$type` 不会运行时验证 JSON。别的写入方存了 `{ language: 123 }`，TS 仍可能“相信”你的声明。结构复杂时要用 Zod 校验输入；核心作者关系、订单行不应为了方便写一个 JSON 数组而放弃外键和可查询模型。

## 3.9 统一命名，但不要混用版本

本文最终 schema 使用 RC 的 `snakeCase.table`：

```ts
export const books = snakeCase.table("books", {
  priceCents: integer().notNull(),
  publishedOn: date({ mode: "string" }),
});
```

它在数据库生成 `price_cents` / `published_on`，TS 中仍使用 camelCase。第 2 章的显式列名方法也合法。

稳定 0.x 没有本文这个新 builder 时，应使用显式列名，并按对应版本配置 naming。不要照旧教程在 RC 的 db 初始化中继续使用旧 `casing` API。

## 3.10 动手：预测插入与读取

给出下面一列：

```ts
note: text().default("待补充");
```

预测三次插入：`{}`、`{ note: null }`、`{ note: '' }`，然后实际建一个测试表验证。

参考结果依次是 `'待补充'`、`null`、`''`；完整 select 类型仍为 `string | null`。

再回答：如果使用 `$defaultFn` 生成 ID，管理员用 raw SQL 省略这个非空 ID 字段会怎样？没有对应数据库 DEFAULT 时，可能违反 NOT NULL。ORM 运行时生成机制不会帮助管理员的 SQL。

## 本章验收

- [ ] 能为金额、日历日期、事件时刻选择合理列类型。
- [ ] 能分清允许 NULL、允许省略、数据库默认、ORM 默认四件事。
- [ ] 知道 `$type` 和 `sql<T>` 都不是运行时验证。
- [ ] 能解释时间戳精度为什么会影响分页正确性。

官方阅读：[PostgreSQL Column Types](https://orm.drizzle.team/docs/column-types/pg)、[Schema 命名](https://orm.drizzle.team/docs/sql-schema-declaration)、[v1 Changes](https://orm.drizzle.team/docs/v0-v1-changes)。
