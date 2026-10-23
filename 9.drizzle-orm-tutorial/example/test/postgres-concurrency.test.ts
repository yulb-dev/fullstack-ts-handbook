import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { relations } from "../src/db/relations";
import { books, users } from "../src/db/schema";
import { placeOrder } from "../src/services/order-service";

// 只接受显式指定的、专用测试库 URL；不从 DATABASE_URL 猜测或复用生产库。
const url = process.env.TEST_POSTGRES_URL;
describe.skipIf(!url)("真实 Postgres：两个连接的并发验证", () => {
  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle({ client: pool, relations });
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  afterAll(async () => {
    await pool.end();
  });

  async function fixture() {
    const [user] = await db
      .insert(users)
      .values({
        email: `${randomUUID()}@test.example`,
        displayName: "并发测试",
      })
      .returning();
    const [book] = await db
      .insert(books)
      .values({
        // 13 位教学标识，不执行 ISBN 校验位算法
        isbn: String(Date.now()),
        title: "并发专用图书",
        priceCents: 1000,
        stock: 1,
      })
      .returning();
    if (!user || !book) throw new Error("测试数据创建失败");
    return { user, book };
  }

  it("不同幂等键抢最后一本：恰好一个成功", async () => {
    const { user, book } = await fixture();
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
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected");
    expect(failed?.status === "rejected" ? failed.reason : null).toMatchObject({
      code: "OUT_OF_STOCK",
    });
    const [stored] = await db.select().from(books).where(eq(books.id, book.id));
    expect(stored?.stock).toBe(0);
  });

  it("相同幂等键并发重放：返回同一张订单，不重复扣库存", async () => {
    const { user, book } = await fixture();
    const input = {
      idempotencyKey: randomUUID(),
      items: [{ bookId: book.id, quantity: 1 }],
    };
    const [first, second] = await Promise.all([
      placeOrder(db, user.id, input),
      placeOrder(db, user.id, input),
    ]);
    expect(second.id).toBe(first.id);
    const [stored] = await db.select().from(books).where(eq(books.id, book.id));
    expect(stored?.stock).toBe(0);
  });
});
