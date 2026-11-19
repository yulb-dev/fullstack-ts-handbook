import { buildApp } from "./app.js";
import { createPool } from "./db.js";
import { readEnv } from "./env.js";

const env = readEnv();
const pool = createPool(env.DATABASE_URL);
const app = buildApp({ db: pool });

// 优雅关闭：先停 HTTP（不再接新连接、等在途请求完成），再释放数据库连接池。
// 容器 stop 时 Docker 发 SIGTERM；这里保证进程能干净地退出（第 9 章）。
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down gracefully");
  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "error during shutdown");
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  // 必须监听 0.0.0.0：容器内的 127.0.0.1 只接受容器自己的回环，
  // 端口映射和容器间通信都到不了它（第 9 章详解）。
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "failed to start");
  process.exit(1);
}
