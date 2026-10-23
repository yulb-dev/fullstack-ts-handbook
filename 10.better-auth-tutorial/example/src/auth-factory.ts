import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { Db } from "./db/types.js";
import * as authSchema from "./db/auth-schema.js";
import { authOptions } from "./auth-options.js";
import type { Env } from "./env.js";
import type { Mailer } from "./mail.js";

export function createAuth(db: Db, env: Env, send: Mailer) {
  return betterAuth({
    ...authOptions(env, send),
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: authSchema,
      transaction: true,
    }),
  });
}
export type Auth = ReturnType<typeof createAuth>;
