import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { books, orders, reviews, users } from "../src/db/schema";
import { pgErrorCode } from "../src/db/errors";
import { seedData } from "../src/db/seed-data";
import { getBookDetail, listBooks } from "../src/repositories/book-repository";
import { markPaid, placeOrder } from "../src/services/order-service";
import { registerUser } from "../src/services/user-service";
import { saveReview } from "../src/services/review-service";
import { createTestDb } from "./setup-db";

describe("Inkwell 数据访问与业务规则", () => {
  let fixture: Awaited<ReturnType<typeof createTestDb>>;
  let seed: Awaited<ReturnType<typeof seedData>>;
  beforeEach(async () => {
    fixture = await createTestDb();
    seed = await seedData(fixture.db);
  });
  afterEach(async () => {
    await fixture?.close();
  });

  it("省略字段使用默认值，nullable 字段返回 null", () => {
    const book = seed.catalog[1]!;
    expect(book.publishedOn).toBeNull();
    expect(book.createdAt).toBeInstanceOf(Date);
    expect(seed.user.role).toBe("customer");
  });

  it("投影、搜索和复合游标分页不重复或漏掉同时间的行", async () => {
    const { db } = fixture;
    const first = await listBooks(db, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listBooks(db, { limit: 2, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((b) => b.id)).size,
    ).toBe(3);
    expect(first.items[0]).not.toHaveProperty("isbn");
    expect(
      (await listBooks(db, { search: "SQL", maxPriceCents: 5000 })).items,
    ).toHaveLength(1);
  });

  it("关系查询读取连接表的署名顺序和直接多对多关系", async () => {
    const book = seed.catalog[1]!;
    const detail = await getBookDetail(fixture.db, book.id);
    expect(detail?.credits.map((c) => c.author.name)).toEqual(["林远", "周青"]);
    expect(detail?.reviewCount).toBe(0);
    const direct = await fixture.db.query.books.findFirst({
      where: { id: book.id },
      with: { authors: true },
    });
    expect(direct?.authors).toHaveLength(2);
    expect(await getBookDetail(fixture.db, 99999)).toBeUndefined();
  });

  it("数据库 CHECK 与外键阻止类型合法但业务非法的行", async () => {
    const { db } = fixture;
    try {
      await db
        .update(books)
        .set({ stock: -1 })
        .where(eq(books.id, seed.catalog[0]!.id));
      throw new Error("应违反 CHECK");
    } catch (error) {
      expect(pgErrorCode(error)).toBe("23514");
    }
    try {
      await db
        .insert(reviews)
        .values({ userId: seed.user.id, bookId: 99999, rating: 4 });
      throw new Error("应违反外键");
    } catch (error) {
      expect(pgErrorCode(error)).toBe("23503");
    }
  });

  it("唯一冲突翻译成业务错误，注册输入不允许写 role", async () => {
    await expect(
      registerUser(fixture.db, {
        email: "READER@example.com",
        displayName: "重复",
      }),
    ).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    await expect(
      registerUser(fixture.db, {
        email: "new@example.com",
        displayName: "新用户",
        role: "admin",
      }),
    ).rejects.toThrow();
  });

  it("成功下单计算服务端价格，重复提交只扣一次库存", async () => {
    const { db } = fixture;
    const book = seed.catalog[0]!;
    const input = {
      idempotencyKey: randomUUID(),
      items: [{ bookId: book.id, quantity: 2 }],
    };
    const first = await placeOrder(db, seed.user.id, input);
    const second = await placeOrder(db, seed.user.id, input);
    expect(second.id).toBe(first.id);
    expect(first.totalCents).toBe(book.priceCents * 2);
    expect(first.items[0]?.unitPriceCents).toBe(book.priceCents);
    const [stored] = await db.select().from(books).where(eq(books.id, book.id));
    expect(stored?.stock).toBe(8);
    expect(await db.$count(orders)).toBe(1);
  });

  it("幂等键不能用于不同购物车，库存不足会回滚之前扣掉的库存和订单", async () => {
    const { db } = fixture;
    const book = seed.catalog[0]!;
    const last = seed.catalog[2]!;
    const key = randomUUID();
    await placeOrder(db, seed.user.id, {
      idempotencyKey: key,
      items: [{ bookId: book.id, quantity: 1 }],
    });
    await expect(
      placeOrder(db, seed.user.id, {
        idempotencyKey: key,
        items: [{ bookId: book.id, quantity: 2 }],
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      placeOrder(db, seed.user.id, {
        idempotencyKey: randomUUID(),
        items: [
          { bookId: book.id, quantity: 2 },
          { bookId: last.id, quantity: 2 },
        ],
      }),
    ).rejects.toMatchObject({ code: "OUT_OF_STOCK" });
    const [stored] = await db.select().from(books).where(eq(books.id, book.id));
    expect(stored?.stock).toBe(9);
    expect(await db.$count(orders)).toBe(1);
  });

  it("购买资格检查、书评 upsert、undefined 保留与 null 清空", async () => {
    const { db } = fixture;
    const book = seed.catalog[0]!;
    await expect(
      saveReview(db, seed.user.id, { bookId: book.id, rating: 5 }),
    ).rejects.toMatchObject({ code: "NOT_PURCHASED" });
    const order = await placeOrder(db, seed.user.id, {
      idempotencyKey: randomUUID(),
      items: [{ bookId: book.id, quantity: 1 }],
    });
    await markPaid(db, seed.user.id, order.id);
    const first = await saveReview(db, seed.user.id, {
      bookId: book.id,
      rating: 5,
      body: "好书",
    });
    const second = await saveReview(db, seed.user.id, {
      bookId: book.id,
      rating: 4,
    });
    expect(second.id).toBe(first.id);
    expect(second.body).toBe("好书");
    const cleared = await saveReview(db, seed.user.id, {
      bookId: book.id,
      rating: 4,
      body: null,
    });
    expect(cleared.body).toBeNull();
    expect(
      await db.$count(
        reviews,
        and(eq(reviews.bookId, book.id), eq(reviews.userId, seed.user.id)),
      ),
    ).toBe(1);
  });

  it("参数绑定把恶意输入当值，不变成 SQL 指令", async () => {
    const payload = "' OR 1=1 --";
    const query = fixture.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, payload));
    const built = query.toSQL();
    expect(built.sql).not.toContain(payload);
    expect(built.params).toContain(payload);
    expect(await query).toHaveLength(0);
    const result = await fixture.db.execute(
      sql`select ${payload}::text as value`,
    );
    expect(result.rows[0]).toMatchObject({ value: payload });
  });

  it("迁移重复执行不重复建表，已有业务数据保持不变", async () => {
    await migrate(fixture.db, { migrationsFolder: "./drizzle" });
    expect(await fixture.db.$count(books)).toBe(3);
  });
});
