// Sentry 前端初始化：必须作为入口的第一个 import（先于 React 渲染）。
// DSN 未设置时 SDK 自动禁用发送——本地/CI 零配置可跑。
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_APP_VERSION,
  integrations: [Sentry.browserTracingIntegration()],
  // 前端性能采样：生产建议降低（第 10 章）
  tracesSampleRate: 0.1,
  // 只给同源/本地 API 请求附加 trace 头（sentry-trace / baggage）
  tracePropagationTargets: ["localhost", /^\//],
  // 隐私：不采集用户身份
  dataCollection: { userInfo: false },
});
