export interface ApiEnv {
  NODE_ENV: "development" | "test" | "production";
  PORT: number;
  /** 可选：未设置时用内存仓储（仅本地演练），设置后走真实 Postgres */
  DATABASE_URL: string | undefined;
}

const NODE_ENVS = ["development", "test", "production"] as const;

export function readEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const nodeEnv = source.NODE_ENV ?? "development";
  if (!NODE_ENVS.includes(nodeEnv as (typeof NODE_ENVS)[number])) {
    throw new Error(`NODE_ENV 非法: ${nodeEnv}`);
  }
  const port = Number(source.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT 非法: ${source.PORT}`);
  }
  return {
    NODE_ENV: nodeEnv as ApiEnv["NODE_ENV"],
    PORT: port,
    DATABASE_URL: source.DATABASE_URL,
  };
}
