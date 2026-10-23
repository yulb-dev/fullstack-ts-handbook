import { authors, books, bookAuthors, users } from "./schema";
import type { Db } from "./types";

/** 只在独立、空的教学数据库执行；不删除或覆盖已有数据 */
export async function seedData(db: Db) {
  return db.transaction(async (tx) => {
    if ((await tx.$count(books)) || (await tx.$count(users))) {
      throw new Error("教学种子需要空数据库；本脚本不会清空现有数据");
    }
    const [user] = await tx
      .insert(users)
      .values({ email: "reader@example.com", displayName: "小林" })
      .returning();
    const writers = await tx
      .insert(authors)
      .values([
        { name: "林远", bio: "喜欢用故事讲清技术。" },
        { name: "周青", bio: null },
      ])
      .returning();
    const catalog = await tx
      .insert(books)
      .values([
        {
          isbn: "9780000000001",
          title: "SQL 第一步",
          priceCents: 4900,
          stock: 10,
          publishedOn: "2026-01-01",
        },
        {
          isbn: "9780000000002",
          title: "TypeScript 实战",
          priceCents: 6900,
          stock: 5,
        },
        {
          isbn: "9780000000003",
          title: "并发的故事",
          priceCents: 5900,
          stock: 1,
        },
      ])
      .returning();
    if (
      !user ||
      !writers[0] ||
      !writers[1] ||
      !catalog[0] ||
      !catalog[1] ||
      !catalog[2]
    ) {
      throw new Error("种子写入没有返回预期行");
    }
    await tx.insert(bookAuthors).values([
      { bookId: catalog[0].id, authorId: writers[0].id },
      { bookId: catalog[1].id, authorId: writers[0].id },
      { bookId: catalog[1].id, authorId: writers[1].id, position: 2 },
      { bookId: catalog[2].id, authorId: writers[1].id },
    ]);
    return { user, writers, catalog };
  });
}
