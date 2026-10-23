import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { relations } from "./relations";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("缺少 DATABASE_URL，请先配置独立教学数据库");
const max = Number(process.env.DB_POOL_MAX ?? 10);
if (!Number.isInteger(max) || max < 1)
  throw new Error("DB_POOL_MAX 必须是正整数");

// 整个进程只创建一个 Pool（不要在每次请求里 new Pool）
const pool = new Pool({
  connectionString,
  // 长驻服务：按「数据库允许的连接数 ÷ 实例数」估算；Serverless 设为 1（见第 11 章）
  max,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// 空闲连接被服务端断开时 pg 会在 Pool 上触发 error，不监听会导致进程崩溃
pool.on("error", (err) => {
  console.error("[pg pool] idle client error", err);
});

export const db = drizzle({
  client: pool,
  relations,
  logger: process.env.DB_LOG === "1",
});

export async function closeDb() {
  await pool.end();
}
