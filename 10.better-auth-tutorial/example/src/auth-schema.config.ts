import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { readEnv } from "./env.js";
import { authOptions } from "./auth-options.js";

// 只供 CLI 生成，避免“尚未生成的 schema”与运行时 auth 互相依赖。
const env = readEnv(process.env);
const pool = new Pool({ connectionString: env.DATABASE_URL });
export const auth = betterAuth({
  ...authOptions(env, async () => {}),
  database: drizzleAdapter(drizzle(pool), {
    provider: "pg",
    transaction: true,
  }),
});
