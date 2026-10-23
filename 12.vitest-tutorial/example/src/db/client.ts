import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { relations } from "@/db/relations.js";

export type Db = PgliteDatabase<typeof relations>;

/**
 * 打开一个 PGlite 数据库（编译成 WASM 的嵌入式 Postgres）。
 * - 不传 dataDir：纯内存实例，进程退出即消失——集成测试用它，每个测试文件一个全新数据库
 * - 传 dataDir：数据落盘——本地 `npm run api` 用它，重启后数据还在
 * 迁移使用与生产完全相同的 drizzle/ 目录，不为测试手写另一套建表 SQL。
 */
export async function openDb(
  options: { dataDir?: string; migrationsFolder?: string } = {},
) {
  const client = new PGlite(options.dataDir);
  const db = drizzle({ client, relations });
  await migrate(db, {
    migrationsFolder: options.migrationsFolder ?? "./drizzle",
  });
  return { db, client };
}
