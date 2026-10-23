import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/** 生产/开发用：一个进程一个 Pool（详见 Drizzle 教程第 11 章） */
export function createPgDb(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", (err) => {
    console.error("[pg pool] idle client error", err);
  });
  // 本项目只用核心查询构建器（select/insert/update），不需要传 relations
  const db = drizzle({ client: pool });
  return { db, close: () => pool.end() };
}
