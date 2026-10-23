import { and, eq } from "drizzle-orm";
import { orderItems, orders } from "../db/schema";
import type { Db } from "../db/types";

const orderWithItems = {
  with: {
    items: {
      columns: { bookId: true, quantity: true, unitPriceCents: true },
      orderBy: { bookId: "asc" },
      with: { book: { columns: { title: true } } },
    },
  },
} as const;

export async function findOrderByIdempotencyKey(
  db: Db,
  userId: number,
  idempotencyKey: string,
) {
  return db.query.orders.findFirst({
    where: { userId, idempotencyKey },
    ...orderWithItems,
  });
}

export async function findOrderById(db: Db, orderId: number) {
  return db.query.orders.findFirst({
    where: { id: orderId },
    ...orderWithItems,
  });
}

export async function listOrdersForUser(db: Db, userId: number, limit = 20) {
  if (!Number.isInteger(limit) || limit < 1)
    throw new RangeError("limit 必须是正整数");
  return db.query.orders.findMany({
    where: { userId },
    orderBy: { createdAt: "desc", id: "desc" },
    limit: Math.min(limit, 50),
    ...orderWithItems,
  });
}

export async function hasPurchased(
  db: Db,
  userId: number,
  bookId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ orderId: orders.id })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.status, "paid"),
        eq(orderItems.bookId, bookId),
      ),
    )
    .limit(1);
  return row !== undefined;
}
