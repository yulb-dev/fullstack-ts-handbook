import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { relations } from "../src/db/relations";

/** 每次调用都有独立数据库；迁移文件就是生产同一套文件，不手写另一套 CREATE TABLE */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle({ client, relations });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db, close: () => client.close() };
}
