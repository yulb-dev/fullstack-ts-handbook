import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * 数据访问的「执行者」类型：同时兼容 db 与 tx，
 * 也同时兼容 node-postgres（运行）与 PGlite（测试）。
 */
export type Db = PgAsyncDatabase<PgQueryResultHKT>;
