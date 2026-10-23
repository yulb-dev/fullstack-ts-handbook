import { z } from "zod";
import { reviews } from "../db/schema";
import type { Db } from "../db/types";
import { NotPurchasedError } from "../domain/errors";
import { hasPurchased } from "../repositories/order-repository";

const reviewSchema = z
  .object({
    bookId: z.number().int().positive(),
    rating: z.number().int().min(1).max(5),
    body: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export async function saveReview(db: Db, userId: number, rawInput: unknown) {
  const input = reviewSchema.parse(rawInput);
  // 本示例不提供退款/取消已支付订单；若增加该功能，需重新设计购买资格的并发规则。
  if (!(await hasPurchased(db, userId, input.bookId)))
    throw new NotPurchasedError(input.bookId);
  const [review] = await db
    .insert(reviews)
    .values({ ...input, userId })
    .onConflictDoUpdate({
      target: [reviews.userId, reviews.bookId],
      // 省略 body 的语义是「保留原评论」，null 是「清空评论」
      set: { rating: input.rating, body: input.body },
    })
    .returning({ id: reviews.id, rating: reviews.rating, body: reviews.body });
  if (!review) throw new Error("保存书评没有返回行");
  return review;
}
