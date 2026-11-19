import { buildApp } from "./app.js";
import { createTaskStore } from "./store.js";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`PORT 非法: ${process.env.PORT}`);
}

const app = buildApp({ store: createTaskStore() });

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down gracefully");
  await app.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port, host: "0.0.0.0" });
