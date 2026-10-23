import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

// relations 只存在于应用层：它不会创建外键，也不会改变数据库结构。
// 它告诉 Drizzle「怎样把两张表连起来」，以便 db.query.* 一次查出嵌套数据。
export const relations = defineRelations(schema, (r) => ({
  users: {
    orders: r.many.orders(),
    reviews: r.many.reviews(),
  },
  authors: {
    // 多对多：通过 book_authors 连接表直达 books
    books: r.many.books({
      from: r.authors.id.through(r.bookAuthors.authorId),
      to: r.books.id.through(r.bookAuthors.bookId),
    }),
  },
  books: {
    // 反方向：Drizzle 会根据 authors.books 自动推断
    authors: r.many.authors(),
    // 需要读取连接表上的额外字段（position）时，直接关联连接表
    credits: r.many.bookAuthors(),
    reviews: r.many.reviews(),
  },
  bookAuthors: {
    book: r.one.books({
      from: r.bookAuthors.bookId,
      to: r.books.id,
      optional: false,
    }),
    author: r.one.authors({
      from: r.bookAuthors.authorId,
      to: r.authors.id,
      optional: false,
    }),
  },
  orders: {
    user: r.one.users({
      from: r.orders.userId,
      to: r.users.id,
      optional: false,
    }),
    items: r.many.orderItems(),
  },
  orderItems: {
    order: r.one.orders({
      from: r.orderItems.orderId,
      to: r.orders.id,
      optional: false,
    }),
    book: r.one.books({
      from: r.orderItems.bookId,
      to: r.books.id,
      optional: false,
    }),
  },
  reviews: {
    user: r.one.users({
      from: r.reviews.userId,
      to: r.users.id,
      optional: false,
    }),
    book: r.one.books({
      from: r.reviews.bookId,
      to: r.books.id,
      optional: false,
    }),
  },
}));
