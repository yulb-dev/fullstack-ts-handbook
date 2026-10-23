import { existsSync } from "node:fs";

export type DocsUi = "scalar" | "swagger-ui" | "none";

export interface AppConfig {
  env: "development" | "production" | "test";
  host: string;
  port: number;
  logLevel: string;
  docs: {
    ui: DocsUi;
    basicAuth?: { username: string; password: string };
  };
  createTaskRateLimit: number;
}

function readEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined || value === "") return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(
    `环境变量值 "${value}" 不在允许范围 ${allowed.join(", ")} 内`,
  );
}

function readInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`环境变量值 "${value}" 不是正整数`);
  }
  return parsed;
}

/** 读取并校验环境变量。配置错误应该让进程启动失败，而不是带病运行。 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = readEnum(
    env.NODE_ENV,
    ["development", "production", "test"] as const,
    "development",
  );
  const username = env.DOCS_USERNAME;
  const password = env.DOCS_PASSWORD;

  return {
    env: nodeEnv,
    host: env.HOST || "127.0.0.1",
    port: readInt(env.PORT, 3000),
    logLevel: env.LOG_LEVEL || "info",
    docs: {
      // 生产环境默认不暴露文档，需要时显式打开
      ui: readEnum(
        env.DOCS_UI,
        ["scalar", "swagger-ui", "none"] as const,
        nodeEnv === "production" ? "none" : "scalar",
      ),
      ...(username && password ? { basicAuth: { username, password } } : {}),
    },
    createTaskRateLimit: readInt(env.CREATE_TASK_RATE_LIMIT, 20),
  };
}

/** 本地开发时读取 .env；文件不存在时什么也不做。 */
export function loadDotEnvIfPresent(path = ".env"): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
