import { afterEach } from "vitest";
import { buildApp, type App, type BuildAppOptions } from "../src/app.js";
import { SEED_TOKENS } from "../src/data/seed.js";

const openApps: App[] = [];

/**
 * 每个测试拿到一个全新的应用实例（全新的内存数据），互不干扰。
 * 测试结束后统一 close，触发 onClose 钩子释放资源。
 */
export async function createTestApp(
  options: BuildAppOptions = {},
): Promise<App> {
  const app = await buildApp(options);
  openApps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

export function bearer(user: keyof typeof SEED_TOKENS): {
  authorization: string;
} {
  return { authorization: `Bearer ${SEED_TOKENS[user]}` };
}

/** 收集 Pino 输出的 JSON 行，用来断言日志内容 */
export function createLogCollector() {
  const lines: Record<string, unknown>[] = [];
  return {
    lines,
    stream: {
      write(line: string) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  };
}
