# 第 12 章：Repository、Service 与能发现真问题的测试

[上一章](./11-connections-and-supabase.md) · [目录](./README.md) · [下一章](./13-capstone-and-acceptance.md)

查询和下单都有了。现在的问题不是“多包几层会不会显得专业”，而是：哪些代码负责查询形状，哪些代码负责业务规则，谁拥有事务，怎样测试它们确实一起工作。

本章将前面的代码组织为小型数据访问层，同时明确不做无价值的泛化。最后用真实 SQL语义而不是链式mock检验系统。

## 12.1 先看到混在一起的代价

如果一个 HTTP handler同时读取JSON、验证身份、构建JOIN、扣库存、决定价格、捕获SQLSTATE和返回HTTP状态，那么改变任意一层都会影响全部。

但反过来，为每条SQL写一个一行wrapper、再为每个wrapper写一个interface和factory，也可能只是增加跳转次数。分层的价值应该是清晰责任、可组合事务、稳定业务意图和可测试边界。

本文结构是：

```text
src/
  db/
    schema.ts          表与数据库约束
    relations.ts       嵌套查询连接配置
    client.ts          驱动、连接池、实例生命周期
    types.ts           从模型推断的类型与执行者
    errors.ts          数据库错误识别
    seed-data.ts       教学种子
  repositories/
    book-repository.ts 图书列表、详情、原子库存修改
    order-repository.ts 订单查询与购买资格查询
  services/
    user-service.ts    注册输入、可写字段、重复邮箱规则
    order-service.ts   幂等下单、金额计算、事务边界
    review-service.ts  购买资格与书评upsert
  domain/errors.ts     业务错误
  scripts/
    seed.ts
    demo.ts
```

普通简单功能可以直接在Service里写SQL，本文注册就是如此。不是所有表都必须有Repository，数据库访问也不要求建立BaseRepository。

## 12.2 Repository处理“怎样查询”，Service处理“为什么做这些动作”

例如 `listBooks` 有投影、筛选、稳定分页、页大小边界。把它提取成命名函数，能统一结果形状，避免多个调用者各写一版分页。这是有价值的Repository。

`decrementStock` 的价值在于把“库存条件与更新合为一条SQL”封装成有明确语义的原语，而不是只把 `db.update()` 改一个名字。

Service的 `placeOrder` 决定：

- 允许的购物车输入。
- 身份来自可信调用上下文。
- 先占幂等键，再扣库存。
- 所有图书按固定顺序修改。
- 价格来自数据库并保存快照。
- 哪些操作必须共同提交或回滚。

这套业务顺序不应该由每个调用者分别理解并复制。

## 12.3 最重要的接口不是抽象工厂，而是执行者参数

Repository需要在事务中复用。不要这样写：

```ts
import { db } from "../db/client";

export function findOrder(id: number) {
  return db.query.orders.findFirst({ where: { id } });
}
```

Service在transaction中调用它时，它可能仍通过全局池查询，看不到同一tx里尚未提交的订单。尤其max=1还会争用连接。

改为：

```ts
export function findOrderById(db: Db, orderId: number) {
  return db.query.orders.findFirst({
    where: { id: orderId },
    with: {
      items: {
        columns: { bookId: true, quantity: true, unitPriceCents: true },
        orderBy: { bookId: "asc" },
        with: { book: { columns: { title: true } } },
      },
    },
  });
}
```

Service调用 `findOrderById(tx, id)`，普通调用者调用 `findOrderById(db, id)`。函数本身不用猜当前有没有事务。

## 12.4 Db类型：针对真实依赖，别引入any

配套 [types.ts](./example/src/db/types.ts) 使用RC的公共类型：

```ts
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { relations } from "./relations";

export type Db = PgAsyncDatabase<PgQueryResultHKT, typeof relations>;
```

它表达Postgres异步数据库以及我们具体的关系模型。事务对象继承相应Database，所以也能传入。PgQueryResultHKT让本文相同查询逻辑可用于node-postgres和PGlite；我们在Repository里主要依赖投影/returning，不依赖某驱动特有raw响应。

不要把某驱动的原生raw结果特性也假装泛化掉。需要驱动专有功能时应保留更具体类型，或者划分更窄能力接口。

这个类型名称是本文RC的API，稳定0.x的类型声明不同。升级依赖时同时核对它，不能把类型强转any消掉全部错误就当适配完成。

## 12.5 为什么不做GenericRepository<T>？

设想一个“所有表通用”的接口：

```text
findAll()
findById(id)
create(data)
update(id, data)
delete(id)
```

看似统一，但实际需求不同：

- book_authors与order_items使用复合主键，不是一个id。
- 列表必须有scope、投影、排序和分页，findAll本身鼓励无界查询。
- 用户不能更新role，订单不能任意更新status。
- 扣库存不是update(id, {stock})，它有条件原子语义。
- 同一本书详情与销售报表的返回shape不同。

为了统一往往要丢类型、加很多选项，最后成为另一个不透明ORM。明确业务查询函数更容易看到SQL与边界。

真正重复而稳定的投影、输入校验、错误翻译或查询条件，可以提取；不要为所有SQL创造新一套DSL。

## 12.6 Service可以直接写简单SQL

注册是一个完整例子：

```ts
import { z } from "zod";
import { users } from "../db/schema";
import { isUniqueViolation } from "../db/errors";
import { EmailTakenError } from "../domain/errors";
import type { Db } from "../db/types";

const inputSchema = z
  .object({
    email: z.email().transform((v) => v.toLowerCase()),
    displayName: z.string().trim().min(1).max(100),
  })
  .strict();

export async function registerUser(db: Db, rawInput: unknown) {
  const input = inputSchema.parse(rawInput);
  try {
    const [user] = await db.insert(users).values(input).returning({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    });
    if (!user) throw new Error("注册没有返回用户");
    return user;
  } catch (error) {
    if (isUniqueViolation(error, "users_email_lower_uq")) {
      throw new EmailTakenError(input.email);
    }
    throw error;
  }
}
```

这里没有另写一个只包含一条INSERT的UserRepository。Service直接完成校验、白名单、投影和业务错误翻译，责任已经清楚。

HTTP层再把EmailTakenError映射成产品约定的冲突响应，把Zod失败映射成字段错误，其他错误记录并返回脱敏500。业务函数不必依赖某HTTP框架。

认证层还需要验证用户凭证；`registerUser` 在本文只是数据创建，不是完整密码注册/登录系统。不要因为函数叫register就误以为认证、安全存储密码等已经实现。

## 12.7 测试要验证行为，不只验证方法被调用

如果你mock出 `.select().from().where()` 每一步，然后断言“调用了where”，测试可能不知道真实SQL拼错、JOIN放大行、UNIQUE缺失或事务漏传。

本教程主要用PGlite执行真实迁移和SQL。它的优点是无需单独启动数据库且有Postgres语义；局限是无法替代TCP连接、真实多连接锁竞争和云端配置验证。

为了测试运行时数据库，不要手写另一套CREATE TABLE。测试用生产同一套迁移，才能发现“TS模型更新了，但迁移漏了”的问题。

## 12.8 创建独立测试数据库

从零工程需要补安装：

```bash
npm install -D @electric-sql/pglite vitest@5
```

本文配套工程已经有这些依赖。创建 `test/setup-db.ts`：

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { relations } from "../src/db/relations";

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle({ client, relations });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db, close: () => client.close() };
}
```

每个测试新建实例并关闭，避免共享数据顺序依赖。PGlite初始化可能较慢，设置合理testTimeout/hookTimeout；不要把超时提高到无限后隐藏死锁。

## 12.9 写一个真正检查“失败回滚”的测试

```ts
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { books, orders } from "../src/db/schema";
import { seedData } from "../src/db/seed-data";
import { placeOrder } from "../src/services/order-service";
import { createTestDb } from "./setup-db";

it("第二本库存不足时，第一本库存和订单都回滚", async () => {
  const { db, close } = await createTestDb();
  try {
    const { user, catalog } = await seedData(db);
    const first = catalog[0]!;
    const last = catalog[2]!;
    await expect(
      placeOrder(db, user.id, {
        idempotencyKey: randomUUID(),
        items: [
          { bookId: first.id, quantity: 2 },
          { bookId: last.id, quantity: 2 },
        ],
      }),
    ).rejects.toMatchObject({ code: "OUT_OF_STOCK" });
    const [stored] = await db
      .select()
      .from(books)
      .where(eq(books.id, first.id));
    expect(stored?.stock).toBe(10);
    expect(await db.$count(orders)).toBe(0);
  } finally {
    await close();
  }
});
```

如果只断言抛了OutOfStockError，数据库可能仍留下半张订单而测试通过。检查失败后的业务数据才真正验证原子性。

固定fixture里的非空断言`!`只在你明确控制测试数据时使用，不应成为HTTP请求处理中的普遍方式。

## 12.10 还有哪些测试不可少？

配套 [inkwell.test.ts](./example/test/inkwell.test.ts) 包含：

- 省略字段默认值、nullable字段返回null。
- 同时间戳数据的复合游标，不重复、不漏行。
- 关系查询的署名顺序和多对多形状。
- 负库存CHECK、悬空FK。
- 邮箱唯一冲突的业务翻译、role字段白名单。
- 幂等重放只扣一次，同键不同购物车被拒绝。
- 第二本书不足时撤销第一本库存和订单。
- 支付资格、书评upsert、undefined保留与null清空。
- 注入字符串作为参数，而不是SQL结构。
- 重复migrate不重复执行已应用迁移。

执行：

```bash
npm run typecheck
npm run db:check
npm test
```

typecheck验证类型，db:check验证本地迁移历史，test验证运行时行为。三者不能相互替代。

## 12.11 真正多连接测试要用真实Postgres

配套 [postgres-concurrency.test.ts](./example/test/postgres-concurrency.test.ts) 使用Pool max=2：

```ts
const results = await Promise.allSettled([
  placeOrder(db, user.id, {
    idempotencyKey: randomUUID(),
    items: [{ bookId: book.id, quantity: 1 }],
  }),
  placeOrder(db, user.id, {
    idempotencyKey: randomUUID(),
    items: [{ bookId: book.id, quantity: 1 }],
  }),
]);
```

然后断言只有一个fulfilled、失败是OUT_OF_STOCK、stock=0。另一项同键并发测试断言返回同订单且库存只扣一次。

只在专用测试数据库上显式设置：

```bash
TEST_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/inkwell_test npm test
```

先创建独立库，例如本地教学容器：

```bash
docker exec inkwell-pg createdb -U postgres inkwell_test
```

测试会执行迁移并插入数据，不清空现有库；它不使用默认DATABASE_URL避免误连业务库。默认不设置TEST_POSTGRES_URL时两个并发测试跳过，不能把skip视为验证成功。

本次环境没有真实Postgres/Docker，因此已执行的是PGlite10项测试，并未执行这两项多连接测试。你还需要在目标运行环境验证SSL、prepared和连接池行为。

## 12.12 练习与验收

练习：在测试分支故意把库存更新使用的tx换成全局db，或把事务取消。观察哪一项测试能发现第一本库存没有回滚；完成后恢复正确实现。

再练习：找一个仅转发SQL的一行wrapper，判断它是否统一了scope、投影或业务语义。如果没有，尝试合并回Service；不要只因目录名叫repositories就必须往里加文件。

- [ ] 能解释Repository与Service各自职责，且Service拥有事务。
- [ ] 能给Repository传db/tx，不暗中使用全局连接。
- [ ] 能避免GenericRepository抹平主键、权限和查询形状。
- [ ] 能测试约束、回滚和查询结果，并知道PGlite验证边界。

官方阅读：[Drizzle PGlite](https://orm.drizzle.team/docs/connect-pglite)、[Transactions](https://orm.drizzle.team/docs/transactions)、[Goodies](https://orm.drizzle.team/docs/goodies)。分层与测试组织是基于这些机制的工程设计，不是Drizzle强制架构。
