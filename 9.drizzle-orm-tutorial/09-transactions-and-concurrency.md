# 第 9 章：让下单在失败与并发中仍然正确

[上一章](./08-relations-and-joins.md) · [目录](./README.md) · [下一章](./10-sql-safety-and-performance.md)

本章是数据访问层的分水岭。前面只需让一次查询正确，现在要面对：执行到一半失败、两个请求同时修改一行、客户端重试、写入唯一冲突。

我们先推演错误，再实现下单。不要只背“重要操作加事务”；事务解决原子性，但并不会自动把所有先读后写变成正确并发算法。

## 9.1 半张订单是怎样产生的？

天真的下单过程：

```text
1. 写 orders
2. 扣第一本书库存
3. 扣第二本书库存
4. 写 order_items
```

如果第二本书库存不足，前面三步中一部分可能已经提交。留下订单头、扣了第一本库存，但没有完整订单行。

我们要把这组动作视为一个逻辑单位：要么都成功，要么都不发生。这就是事务的原子性。

```ts
await db.transaction(async (tx) => {
  // 这一组查询都要通过 tx 执行。
  await tx.insert(orders).values(...);
  await tx.update(books).set(...).where(...);
  await tx.insert(orderItems).values(...);
});
```

上面省略号是流程示意，不是可运行代码；完整下单函数在 9.7 节。

回调正常完成，ORM提交；回调抛错，ORM回滚。返回的 Promise 要 await，否则请求可能在提交完成前就报告成功。

## 9.2 tx 不是 db 的另一个名字

Drizzle transaction 会在对应驱动上使用同一数据库事务连接。调用普通全局 db 查询，可能从池里借出另一条连接，不属于当前事务：

```ts
await db.transaction(async (tx) => {
  await tx.update(books).set({ stock: 0 }).where(eq(books.id, bookId));
  await db.insert(reviews).values({ userId, bookId, rating: 5 });
  throw new Error("后续失败");
});
```

书评写入不受这次 tx 回滚保护，甚至在 max=1 时可能等待当前事务持有的唯一连接，产生连接池等待问题。Repository 必须接受并使用传入的执行者，不能暗中 import 全局 db。

也不要吞掉失败：

```ts
await db.transaction(async (tx) => {
  try {
    await someBusinessStep(tx);
  } catch (error) {
    // 只记录日志而不抛出，可能让原本应该失败的业务继续提交。
    console.error(error);
  }
});
```

捕获是为了恢复还是翻译错误，要明确。如果整个业务应该失败，就继续抛错。某些 SQL 错误会让事务进入 aborted 状态，此时在 catch 后直接继续查也不能“修好”它。

## 9.3 有事务为什么仍可能超卖？

两个人抢 stock=1 的书：

```text
A BEGIN                     B BEGIN
A SELECT stock → 1          B SELECT stock → 1
A 判断库存足够               B 判断库存足够
A UPDATE stock = 0          B UPDATE stock = 0
A 写订单并提交               B 写订单并提交
```

结果库存是 0，却卖出两本。每笔交易内部看起来都完整，但读取和业务判断没有合适的并发保护。

CHECK stock >= 0 也挡不住：两个人最后都写 0，没有负数。

因此原子性、约束、隔离级别和业务并发策略都要设计，不能只有 transaction callback。

## 9.4 第一种修复：条件更新，把判断与修改放进同一语句

```ts
import { and, eq, gte, sql } from "drizzle-orm";
import { books } from "../db/schema";
import type { Db } from "../db/types";

export async function decrementStock(db: Db, bookId: number, quantity: number) {
  const [row] = await db
    .update(books)
    .set({ stock: sql`${books.stock} - ${quantity}` })
    .where(and(eq(books.id, bookId), gte(books.stock, quantity)))
    .returning({
      id: books.id,
      priceCents: books.priceCents,
      stock: books.stock,
    });
  return row ?? null;
}
```

对应：

```sql
UPDATE books
SET stock = stock - $1
WHERE id = $2 AND stock >= $1
RETURNING id, price_cents, stock;
```

在 Postgres 默认 Read Committed 下，并发 UPDATE 会争用同一行，后来的更新等待；若前者提交，后者根据更新后的行重新检查 WHERE。第一人把 1 扣为 0 后，第二人的 `stock >= 1` 不再满足，得到零行。

这正是我们依赖的数据库机制，不是 JS 里“await 自动排队”的魔法。多个 Node 实例同样由数据库协调。

前提：quantity 必须是经过校验的正整数。传入 -1 会变成加库存，类型 number 本身挡不住。返回 null 还可能表示图书不存在；需要时再查询区分错误，但不要将这次诊断 SELECT 当作并发正确性的来源。

CHECK 非负作为另一道保护仍有价值，但它不是这个完整算法的替代品。

## 9.5 第二种修复：锁定后读取，再判断

一些业务需要先读取复杂状态，可以：

```ts
await db.transaction(async (tx) => {
  const [book] = await tx
    .select()
    .from(books)
    .where(eq(books.id, bookId))
    .for("update");
  if (!book) throw new Error("图书不存在");
  if (book.stock < quantity) throw new Error("库存不足");
  await tx
    .update(books)
    .set({ stock: book.stock - quantity })
    .where(eq(books.id, book.id));
});
```

`FOR UPDATE` 锁住选中的行，直到事务结束。竞争事务不能同时从未锁的旧值开始做同样修改。

代价是持锁时间和等待，所以事务里不要调用支付接口、发邮件、sleep 或等用户操作。锁也有边界：锁住已有行不自动锁住“本来不存在的一行”。跨行总量/不存在记录的竞争可能需要更合适的唯一约束、隔离级别或锁策略。

多本书统一按 bookId 顺序处理，能降低“A 锁书1等书2，B 锁书2等书1”的死锁风险，但不能保证不存在任何死锁。

## 9.6 重复下单不是重复 SQL 那么简单

客户端请求超时，不知道服务端是否已提交，于是重试。如果每次都生成新订单，则库存和金额重复消费。

我们让客户端为一次下单意图生成 UUID，重试时保留同一个：

```ts
const input = {
  idempotencyKey: crypto.randomUUID(),
  items: [{ bookId: 1, quantity: 1 }],
};
```

数据库约束是 UNIQUE(user_id, idempotency_key)。幂等键属于这个用户的这次业务请求，不是订单 auto ID；不同用户可以用相同键而互不干扰。

还必须检查同键是否同购物车。如果重用旧键却改变数量，不能静默返回旧订单当成新订单成功；应报告 IDEMPOTENCY_CONFLICT。

## 9.7 完整下单：先占幂等键，再扣库存

实现位于 [order-service.ts](./example/src/services/order-service.ts)。下面保留全部核心行为，可作为 Service 文件使用：

```ts
import { eq } from "drizzle-orm";
import { z } from "zod";
import { orders, orderItems } from "../db/schema";
import type { Db } from "../db/types";
import { AppError, BookNotFoundError, OutOfStockError } from "../domain/errors";
import { bookExists, decrementStock } from "../repositories/book-repository";
import {
  findOrderById,
  findOrderByIdempotencyKey,
} from "../repositories/order-repository";

const inputSchema = z
  .object({
    idempotencyKey: z.uuid(),
    items: z
      .array(
        z.object({
          bookId: z.number().int().positive(),
          quantity: z.number().int().min(1).max(99),
        }),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.items.map((i) => i.bookId)).size !== value.items.length) {
      ctx.addIssue({
        code: "custom",
        message: "同一本书只能出现一次，请先合并数量",
      });
    }
  });

export async function placeOrder(db: Db, userId: number, rawInput: unknown) {
  const input = inputSchema.parse(rawInput);
  const items = [...input.items].sort((a, b) => a.bookId - b.bookId);

  return db.transaction(
    async (tx) => {
      const [claim] = await tx
        .insert(orders)
        .values({
          userId,
          idempotencyKey: input.idempotencyKey,
          totalCents: 0,
        })
        .onConflictDoNothing({ target: [orders.userId, orders.idempotencyKey] })
        .returning({ id: orders.id });

      if (!claim) {
        const existing = await findOrderByIdempotencyKey(
          tx,
          userId,
          input.idempotencyKey,
        );
        if (!existing) throw new Error("幂等键冲突但未找到订单");
        const same =
          existing.items.length === items.length &&
          existing.items.every((old, index) => {
            const next = items[index];
            return (
              next &&
              old.bookId === next.bookId &&
              old.quantity === next.quantity
            );
          });
        if (!same)
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "同一幂等键不能用于不同购物车",
          );
        return existing;
      }

      const lines: {
        bookId: number;
        quantity: number;
        unitPriceCents: number;
      }[] = [];
      let totalCents = 0;
      for (const item of items) {
        const updated = await decrementStock(tx, item.bookId, item.quantity);
        if (!updated) {
          if (!(await bookExists(tx, item.bookId)))
            throw new BookNotFoundError(item.bookId);
          throw new OutOfStockError(item.bookId);
        }
        lines.push({ ...item, unitPriceCents: updated.priceCents });
        totalCents += updated.priceCents * item.quantity;
      }
      if (totalCents > 2_147_483_647)
        throw new AppError("ORDER_TOO_LARGE", "订单金额超出支持范围");

      await tx
        .insert(orderItems)
        .values(lines.map((line) => ({ ...line, orderId: claim.id })));
      await tx
        .update(orders)
        .set({ totalCents })
        .where(eq(orders.id, claim.id));
      const result = await findOrderById(tx, claim.id);
      if (!result) throw new Error("下单完成后未找到订单");
      return result;
    },
    { isolationLevel: "read committed" },
  );
}
```

依赖的查询/领域错误完整实现见 [Repository](./example/src/repositories/order-repository.ts)、[图书函数](./example/src/repositories/book-repository.ts)、[业务错误](./example/src/domain/errors.ts)；第 12 章解释如何组织这些文件。

### 按两种并发场景推演

不同键抢同书：分别插入自己订单，竞争扣库存；一方失败后整笔事务回滚，连订单头也没有留下。

相同键重试：第二次 INSERT 在唯一索引冲突处等待第一笔交易。第一笔提交后，第二笔 do nothing 返回空数组，再用新的 Read Committed 语句读取已完成订单。第一笔回滚时，第二笔则可取得这个键继续下单。

为什么 totalCents 先写 0？用于先占幂等键，稍后在同一事务内完成订单。其他普通已提交读取看不到这个事务的中间状态。任何步骤失败都会撤销它。

本文禁止删除/随意修改已创建订单行，保证幂等比较的稳定性。若增加退款、可变订单、幂等记录清理和过期策略，就要相应重新设计，不可直接沿用所有结论。

### 为什么价格由服务端算？

客户端只传 bookId 与 quantity。成交单价来自数据库扣库存返回的当前行，写入 order_items 作为快照。客户端若传价格字段，strict 输入会拒绝它；浏览器显示的价格不是可信的计费来源。

## 9.8 唯一冲突应该怎样处理？

注册重复邮箱属于业务错误，不该自动覆盖已有用户：

```ts
import { DrizzleQueryError } from "drizzle-orm";

function isEmailConflict(error: unknown) {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "23505" &&
    "constraint" in cause &&
    cause.constraint === "users_email_lower_uq"
  );
}
```

Drizzle 常把驱动错误包在 DrizzleQueryError.cause 内；检查 SQLSTATE 和明确 constraint/index 名称，不要只匹配英文报错字符串，也不要把所有 23505 都翻译成“邮箱重复”。

先查邮箱不存在再 INSERT 不能消除竞态；两个请求可能同时查不到。可以做提前查询提升体验，但数据库 UNIQUE 和最终错误处理仍必须保留。

`onConflictDoNothing` 适合幂等占位/允许忽略的冲突；`onConflictDoUpdate` 适合业务确实允许覆盖的 upsert。书评按 `(userId, bookId)` 更新很合理，注册冲突后覆盖账号则可能成为安全问题。

发生普通 SQL 错误后，事务可能进入 aborted 状态。要恢复继续用事务，需要正确的 savepoint/nested transaction，或退出后新开事务；不能随便在 catch 里继续 SELECT。

## 9.9 批量、分块、嵌套事务与边界

订单行用一条多 VALUES INSERT，避免逐行网络往返。库存按固定顺序逐行条件更新，最多 20 本，是为了清晰地维护锁和失败语义。这是有上界的业务写入，不是无限 N+1；更大规模操作可以优化，但要保留并发证明。

导入上万图书可以分块：

```ts
async function importBooks(db: Db, values: (typeof books.$inferInsert)[]) {
  if (values.length === 0) return;
  await db.transaction(async (tx) => {
    for (let offset = 0; offset < values.length; offset += 500) {
      await tx.insert(books).values(values.slice(offset, offset + 500));
    }
  });
}
```

500 只是演示值，不是固定最佳批量。这个版本所有分块共用事务，任一块失败全部回滚，但事务可能很长。若每块各自提交，资源压力更可控，却会部分成功，必须设计恢复、去重和进度。这是业务决策。

node-postgres 没有通用 `.batch()` 本教程可随便调用的承诺；Drizzle 的 batch API 取决于驱动，官方 PostgreSQL batch 示例主要针对 Neon HTTP。批量 values、batch API、事务是三种不同概念。

嵌套 `tx.transaction()` 通常对应 savepoint，不是独立持久提交：内部成功后外层失败，内部修改仍会被外层撤销。仅当业务允许局部失败并继续时，才有必要设计这样的恢复边界。

## 9.10 隔离级别：知道在防哪一种问题

| 隔离级别        | 在 Postgres 中的主要理解                                             |
| --------------- | -------------------------------------------------------------------- |
| Read Committed  | 每条语句读已提交快照；本文条件库存更新与幂等重读基于此               |
| Repeatable Read | 事务内快照更稳定，但并发修改可能导致事务失败；不自动解决全部跨行异常 |
| Serializable    | 检测不能等价串行执行的竞争，可能主动中止一笔，需要重试               |

Postgres 的 Read Uncommitted 实际按 Read Committed 行为工作。Isolation 配置存在不代表它让数据库“不用锁”或“永远不失败”。

跨多行规则，例如“医生至少一人值班”，不是给各行非负 CHECK 就能解决。可能需要 Serializable、锁定统一协调行或其他明确机制。

## 9.11 有限重试，而不是遇到错误无限循环

SQLSTATE `40001`（serialization failure）、`40P01`（deadlock）可以按业务安全性做有限重试。必须重试整个事务，不能只重跑最后一条 SQL：

```ts
import { pgErrorCode } from "../db/errors";

async function retryTransaction<T>(
  operation: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const retryable = ["40001", "40P01"].includes(pgErrorCode(error) ?? "");
      if (!retryable || attempt + 1 >= attempts) throw error;
      const delay = 30 * 2 ** attempt + Math.random() * 30;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
```

校验失败、库存不足、邮箱冲突不属于这种自动重试。连接中断还可能有“是否已经提交未知”的问题，需要稳定幂等键协助，不是看到超时就生成新键重写。

支付、邮件和外部调用不能随事务重试重复执行。事务内可以写 outbox 记录，提交后由工作者发送，配合外部幂等/重试策略。数据库事务本身撤销不了已发送的邮件或已扣的第三方款项。

## 9.12 动手验收

先运行 PGlite 测试中的两本书失败场景：第一本有库存，第二本不足，确认第一本库存和订单总数不变。不要只断言抛错。

再在独立真实 Postgres 上运行第 12 章的双连接测试：不同键抢最后一本恰好一个成功；同键两请求都返回同一订单、只扣一次。PGlite 单实例测试无法替你证明独立数据库连接的等待行为。

- [ ] 能解释事务原子性与并发正确性不是一回事。
- [ ] 能写并说明条件原子更新、行锁和固定锁顺序。
- [ ] 能处理唯一冲突、重复请求和同键不同负载。
- [ ] 能正确传 tx、回滚、批量写入并定义有限重试。
- [ ] 能说出外部副作用与事务的边界。

官方阅读：[Transactions](https://orm.drizzle.team/docs/transactions)、[Insert conflicts](https://orm.drizzle.team/docs/insert)、[PostgreSQL Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)、[SQLSTATE](https://www.postgresql.org/docs/current/errcodes-appendix.html)。
