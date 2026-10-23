export interface AppConfig {
  /** 允许携带 Cookie 跨域访问的浏览器来源；空数组 = 只接受同源（经代理）请求 */
  webOrigins: string[];
  cookieSecure: boolean;
  logLevel: string;
  /** 会话有效期（毫秒） */
  sessionTtlMs: number;
  /** 是否在 /docs 暴露 API 参考文档 */
  exposeDocs: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProd = env.NODE_ENV === "production";
  const cookieSecure = env.COOKIE_SECURE
    ? env.COOKIE_SECURE === "true"
    : isProd;
  if (isProd && !cookieSecure) {
    throw new Error("生产环境必须开启 COOKIE_SECURE=true");
  }
  return {
    webOrigins: (env.WEB_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    cookieSecure,
    logLevel: env.LOG_LEVEL ?? "info",
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
    exposeDocs: !isProd,
  };
}
