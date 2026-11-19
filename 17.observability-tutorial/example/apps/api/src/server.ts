import { buildApp } from "./app.js";
import { createPool } from "./db.js";
import { readEnv } from "./env.js";
import { shutdownTelemetry } from "./instrumentation.js";
import { createMemoryRepository, createPgRepository } from "./repository.js";

const env = readEnv();
const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : null;
const repo = pool ? createPgRepository(pool) : createMemoryRepository();
const app = buildApp({ repo });
if (!pool) {
  app.log.warn(
    "DATABASE_URL 未设置：使用内存仓储（仅本地演练；生产必须配置数据库）",
  );
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down gracefully");
  try {
    await app.close();
    await pool?.end();
    await shutdownTelemetry(); // 冲刷 span 与 Sentry 事件后再退出
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "error during shutdown");
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "failed to start");
  process.exit(1);
}
