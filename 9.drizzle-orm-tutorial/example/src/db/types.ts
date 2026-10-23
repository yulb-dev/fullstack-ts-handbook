import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { relations } from "./relations";
import type * as schema from "./schema";

/**
 * 数据访问函数的「执行者」类型。
 * - 同时兼容 db 与 tx（事务对象继承自 PgAsyncDatabase）
 * - 同时兼容 node-postgres（生产）与 PGlite（测试）
 */
export type Db = PgAsyncDatabase<PgQueryResultHKT, typeof relations>;

// 行类型（select shape）与写入类型（insert shape）
export type User = typeof schema.users.$inferSelect;
export type NewUser = typeof schema.users.$inferInsert;
export type Book = typeof schema.books.$inferSelect;
export type NewBook = typeof schema.books.$inferInsert;
export type Author = typeof schema.authors.$inferSelect;
export type Order = typeof schema.orders.$inferSelect;
export type OrderItem = typeof schema.orderItems.$inferSelect;
export type Review = typeof schema.reviews.$inferSelect;
