import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createPgDb } from "./db/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("缺少 DATABASE_URL，请复制 .env.example 为 .env");

const config = loadConfig();
const { db, close } = createPgDb(databaseUrl);
const app = await buildApp({
  db,
  config,
  // 部署在反向代理（Nginx / 负载均衡）之后时开启，否则 request.protocol / host 是代理内侧的值（第 8 章）
  trustProxy: process.env.TRUST_PROXY === "true",
  logger:
    process.env.NODE_ENV === "production"
      ? { level: config.logLevel }
      : { level: config.logLevel, transport: { target: "pino-pretty" } },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    await close();
    process.exit(0);
  });
}

await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
