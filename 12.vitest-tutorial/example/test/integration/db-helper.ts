import { openDb, type Db } from "@/db/client.js";

/**
 * 每个数据库测试文件调用一次：建一个全新的内存 PGlite 并跑真实迁移。
 * 文件之间天然隔离（各建各的库）；文件内部由每个测试的 beforeEach 清表保证隔离。
 */
export async function createTestDb(): Promise<{
  db: Db;
  close: () => Promise<void>;
}> {
  const { db, client } = await openDb();
  return { db, close: () => client.close() };
}
