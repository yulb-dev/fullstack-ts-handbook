import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  primaryKey,
  smallint,
  snakeCase,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────
// 枚举：数据库里的 CREATE TYPE ... AS ENUM
// ─────────────────────────────────────────────
export const userRole = pgEnum("user_role", ["customer", "admin"]);
export const orderStatus = pgEnum("order_status", [
  "pending",
  "paid",
  "cancelled",
]);

// 可复用的审计字段（每张表展开一次）
const timestamps = {
  createdAt: timestamp({ withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow(),
  // defaultNow() 是数据库默认值；$onUpdate 只在「通过 Drizzle 执行 update」时由应用层填充
  updatedAt: timestamp({ withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ─────────────────────────────────────────────
// users：顾客与管理员
// ─────────────────────────────────────────────
export const users = snakeCase.table(
  "users",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    email: text().notNull(),
    displayName: text().notNull(),
    role: userRole().notNull().default("customer"),
    ...timestamps,
  },
  (t) => [
    // 邮箱大小写不敏感唯一：表达式索引必须手动命名
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    check("users_email_format_ck", sql`position('@' in ${t.email}) > 1`),
  ],
);

// ─────────────────────────────────────────────
// authors：作者
// ─────────────────────────────────────────────
export const authors = snakeCase.table("authors", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  bio: text(),
  ...timestamps,
});

// ─────────────────────────────────────────────
// books：图书（价格用「分」存整数，避免浮点误差）
// ─────────────────────────────────────────────
export const books = snakeCase.table(
  "books",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    isbn: varchar({ length: 13 }).notNull().unique("books_isbn_uq"),
    title: text().notNull(),
    priceCents: integer().notNull(),
    stock: integer().notNull().default(0),
    publishedOn: date({ mode: "string" }),
    ...timestamps,
  },
  (t) => [
    check("books_price_nonneg_ck", sql`${t.priceCents} >= 0`),
    check("books_stock_nonneg_ck", sql`${t.stock} >= 0`),
    // 游标分页按 (created_at, id) 排序，需要对应的复合索引
    index("books_created_at_id_idx").on(t.createdAt, t.id),
  ],
);

// ─────────────────────────────────────────────
// book_authors：多对多的连接表（junction table）
// ─────────────────────────────────────────────
export const bookAuthors = snakeCase.table(
  "book_authors",
  {
    bookId: integer()
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    authorId: integer()
      .notNull()
      .references(() => authors.id, { onDelete: "restrict" }),
    // 作者署名顺序：第一作者、第二作者……
    position: smallint().notNull().default(1),
  },
  (t) => [
    // 复合主键 (book_id, author_id) 自带唯一索引，可以服务「按 book_id 查」
    primaryKey({ columns: [t.bookId, t.authorId] }),
    // 反方向「按 author_id 查」需要单独的索引
    index("book_authors_author_id_idx").on(t.authorId),
  ],
);

// ─────────────────────────────────────────────
// orders / order_items：订单与订单行
// ─────────────────────────────────────────────
export const orders = snakeCase.table(
  "orders",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: orderStatus().notNull().default("pending"),
    totalCents: integer().notNull(),
    // 客户端生成的幂等键：防止重复提交生成两张订单
    idempotencyKey: uuid().notNull(),
    ...timestamps,
  },
  (t) => [
    unique("orders_user_idempotency_uq").on(t.userId, t.idempotencyKey),
    check("orders_total_nonneg_ck", sql`${t.totalCents} >= 0`),
    index("orders_user_created_idx").on(t.userId, t.createdAt.desc()),
  ],
);

export const orderItems = snakeCase.table(
  "order_items",
  {
    orderId: integer()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    bookId: integer()
      .notNull()
      .references(() => books.id, { onDelete: "restrict" }),
    quantity: integer().notNull(),
    // 下单时的价格快照：图书以后改价，历史订单金额不能跟着变
    unitPriceCents: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.bookId] }),
    index("order_items_book_id_idx").on(t.bookId),
    check("order_items_quantity_pos_ck", sql`${t.quantity} > 0`),
    check("order_items_price_nonneg_ck", sql`${t.unitPriceCents} >= 0`),
  ],
);

// ─────────────────────────────────────────────
// reviews：书评（每人每本书最多一条）
// ─────────────────────────────────────────────
export const reviews = snakeCase.table(
  "reviews",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bookId: integer()
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    rating: smallint().notNull(),
    body: text(),
    ...timestamps,
  },
  (t) => [
    unique("reviews_user_book_uq").on(t.userId, t.bookId),
    index("reviews_book_id_idx").on(t.bookId),
    check("reviews_rating_range_ck", sql`${t.rating} between 1 and 5`),
  ],
);
