import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_URL: z.url(),
  WEB_ORIGIN: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  MAIL_MODE: z.enum(["local", "resend"]).default("local"),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;
export function readEnv(raw: NodeJS.ProcessEnv): Env {
  const env = schema.parse(raw);
  for (const value of [env.BETTER_AUTH_URL, env.WEB_ORIGIN]) {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password) {
      throw new Error("URL 必须是完整 origin，不包含路径、凭证或尾部斜杠");
    }
    if (env.NODE_ENV === "production" && url.protocol !== "https:") {
      throw new Error("生产认证必须使用 HTTPS");
    }
  }
  if (env.NODE_ENV === "production" && env.MAIL_MODE === "local") {
    throw new Error("生产环境不能使用本地邮件打印器");
  }
  if (env.MAIL_MODE === "resend" && (!env.RESEND_API_KEY || !env.MAIL_FROM)) {
    throw new Error("Resend 需要 API key 和已验证发件人");
  }
  if (Boolean(env.GITHUB_CLIENT_ID) !== Boolean(env.GITHUB_CLIENT_SECRET)) {
    throw new Error("GitHub client ID 与 secret 必须同时配置");
  }
  return env;
}
