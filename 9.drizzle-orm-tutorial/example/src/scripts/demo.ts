import { randomUUID } from "node:crypto";
import { db, closeDb } from "../db/client";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { listBooks, getBookDetail } from "../repositories/book-repository";
import { placeOrder, markPaid } from "../services/order-service";
import { saveReview } from "../services/review-service";

try {
  const [reader] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "reader@example.com"));
  if (!reader) throw new Error("请先运行 npm run seed");
  const page = await listBooks(db, { limit: 2 });
  console.log("第一页", page);
  const book = page.items[0];
  if (!book) throw new Error("没有图书");
  const input = {
    idempotencyKey: randomUUID(),
    items: [{ bookId: book.id, quantity: 1 }],
  };
  const order = await placeOrder(db, reader.id, input);
  const replay = await placeOrder(db, reader.id, input);
  console.log("订单与幂等重放", {
    orderId: order.id,
    replayId: replay.id,
    totalCents: order.totalCents,
  });
  // 仅教学：生产由已验证的支付回调触发，不开放给普通用户自助标记支付。
  await markPaid(db, reader.id, order.id);
  await saveReview(db, reader.id, {
    bookId: book.id,
    rating: 5,
    body: "学会了先设计数据库！",
  });
  console.log("带作者和书评的详情", await getBookDetail(db, book.id));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
