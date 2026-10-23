import { buildApp } from "./app.js";
import { loadConfig, loadDotEnvIfPresent } from "./config.js";

loadDotEnvIfPresent();
const config = loadConfig();

const app = await buildApp({
  logging: {
    enabled: true,
    level: config.logLevel,
    pretty: config.env === "development",
  },
  docs: { ui: config.docs.ui, basicAuth: config.docs.basicAuth },
  createTaskRateLimit: config.createTaskRateLimit,
});

// 优雅停机：收到信号后不再接新请求，等进行中的请求结束，再执行 onClose（关闭数据库等）
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "shutting down");
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, "error during shutdown");
      process.exit(1);
    }
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
  if (config.docs.ui !== "none")
    app.log.info(`API docs: http://${config.host}:${config.port}/docs`);
} catch (error) {
  app.log.error({ err: error }, "failed to start");
  process.exit(1);
}
