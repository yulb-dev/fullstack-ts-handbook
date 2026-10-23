import { and, asc, eq, gt, gte, ilike, lte, or, sql } from "drizzle-orm";
import { books, reviews } from "../db/schema";
import type { Db } from "../db/types";

export const MAX_PAGE_SIZE = 50;

export type BookCursor = { createdAt: Date; id: number };

export type ListBooksParams = {
  search?: string;
  maxPriceCents?: number;
  inStockOnly?: boolean;
  cursor?: BookCursor | null;
  limit?: number;
};

/** LIKE 模式里 % 和 _ 是通配符，用户输入要先转义（这不是注入问题，而是语义与性能问题） */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** 图书列表：条件组合 + 投影 + (created_at, id) 游标分页 + 页大小上限 */
export async function listBooks(db: Db, params: ListBooksParams = {}) {
  const requestedLimit = params.limit ?? 20;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    throw new RangeError("limit 必须是正整数");
  }
  const limit = Math.min(requestedLimit, MAX_PAGE_SIZE);
  const { cursor } = params;

  const rows = await db
    .select({
      id: books.id,
      title: books.title,
      priceCents: books.priceCents,
      stock: books.stock,
      createdAt: books.createdAt,
    })
    .from(books)
    .where(
      and(
        params.search
          ? ilike(books.title, `%${escapeLike(params.search)}%`)
          : undefined,
        params.maxPriceCents !== undefined
          ? lte(books.priceCents, params.maxPriceCents)
          : undefined,
        params.inStockOnly ? gt(books.stock, 0) : undefined,
        cursor
          ? or(
              gt(books.createdAt, cursor.createdAt),
              and(
                eq(books.createdAt, cursor.createdAt),
                gt(books.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(asc(books.createdAt), asc(books.id))
    // 多取一条，用来判断是否还有下一页
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  return {
    items,
    nextCursor:
      hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

/** 图书详情：用关系查询一次取出作者（多对多）和最近书评（一对多） */
export async function getBookDetail(db: Db, bookId: number) {
  return db.query.books.findFirst({
    where: { id: bookId },
    columns: {
      id: true,
      isbn: true,
      title: true,
      priceCents: true,
      stock: true,
      publishedOn: true,
    },
    with: {
      credits: {
        columns: { position: true },
        orderBy: { position: "asc" },
        with: { author: { columns: { id: true, name: true } } },
      },
      reviews: {
        columns: { id: true, rating: true, body: true, createdAt: true },
        orderBy: { createdAt: "desc", id: "desc" },
        limit: 5,
        with: { user: { columns: { displayName: true } } },
      },
    },
    extras: {
      reviewCount: (t) => db.$count(reviews, eq(reviews.bookId, t.id)),
    },
  });
}

/**
 * 原子扣库存：条件写在 WHERE 里，数据库在行锁保护下判断并修改。
 * 返回 null 表示「图书不存在」或「库存不足」。
 */
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

export async function bookExists(db: Db, bookId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: books.id })
    .from(books)
    .where(eq(books.id, bookId));
  return row !== undefined;
}
