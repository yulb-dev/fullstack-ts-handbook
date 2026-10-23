import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { readEnv } from "../env.js";
import * as schema from "./schema.js";

export const env = readEnv(process.env);
export const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
pool.on("error", () => console.error("数据库空闲连接发生错误"));
export const db = drizzle(pool, { schema });
