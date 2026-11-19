// 启动时一次性校验环境变量：缺失/非法立即失败，而不是等到线上请求才暴露。
// 这是「配置与秘密运行时注入」的第一环：镜像里没有任何配置，配置全部来自环境。

export interface ApiEnv {
  NODE_ENV: "development" | "test" | "production";
  PORT: number;
  DATABASE_URL: string;
}

const NODE_ENVS = ["development", "test", "production"] as const;

export function readEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const nodeEnv = source.NODE_ENV ?? "development";
  if (!NODE_ENVS.includes(nodeEnv as (typeof NODE_ENVS)[number])) {
    throw new Error(
      `NODE_ENV 非法: ${nodeEnv}（允许: ${NODE_ENVS.join(" | ")}）`,
    );
  }

  const port = Number(source.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT 非法: ${source.PORT}`);
  }

  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "缺少必需环境变量 DATABASE_URL（示例: postgres://workboard:workboard_dev@localhost:5432/workboard）",
    );
  }

  return {
    NODE_ENV: nodeEnv as ApiEnv["NODE_ENV"],
    PORT: port,
    DATABASE_URL: databaseUrl,
  };
}
