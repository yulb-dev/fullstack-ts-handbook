import "dotenv/config";
import { buildApp } from "@/api/app.js";
import { openDb } from "@/db/client.js";
import { createDbTaskRepository } from "@/db/task-repository.js";
import { createConsoleNotifier } from "@/services/console-notifier.js";
import { createTaskService } from "@/services/task-service.js";

/** 本地开发入口：数据落在 .pgdata/（已 gitignore）。测试永远不会执行这个文件 */
async function main() {
  const { db } = await openDb({ dataDir: ".pgdata" });
  const service = createTaskService({
    repo: createDbTaskRepository(db),
    notifier: createConsoleNotifier(),
  });
  const app = buildApp({ service, logger: true });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "127.0.0.1" });
  app.log.info(`TaskDesk API listening on http://127.0.0.1:${port}`);
}

void main();
