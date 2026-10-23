import { and, eq, sql } from "drizzle-orm";
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

/** userId 来自已验证的身份上下文，不允许客户端通过 body 任意指定 */
export async function placeOrder(db: Db, userId: number, rawInput: unknown) {
  const input = inputSchema.parse(rawInput);
  // 所有订单按同一顺序锁图书行，降低死锁概率
  const items = [...input.items].sort((a, b) => a.bookId - b.bookId);

  return db.transaction(
    async (tx) => {
      // 先占用幂等键，再扣库存。同键并发请求在唯一索引处等待。
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
      // total_cents 是 int4，不能只检查 JS Number.isSafeInteger
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

/** 示例：带所有权和状态条件的修改，不先查再无条件更新 */
export async function markPaid(db: Db, userId: number, orderId: number) {
  const [order] = await db
    .update(orders)
    .set({ status: "paid", updatedAt: sql`now()` })
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.userId, userId),
        eq(orders.status, "pending"),
      ),
    )
    .returning({ id: orders.id, status: orders.status });
  return order ?? null;
}
