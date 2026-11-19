// 遥测初始化：必须在应用代码之前加载（node --import / tsx --import）。
// 分工（路线图核心概念⑧）：OTel 负责 tracing；Sentry 只负责错误监控。
// 关键：enableOpenTelemetrySetup: false + 不设 tracesSampleRate，避免重复 instrumentation。
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace";
import * as Sentry from "@sentry/node";

const environment = process.env.NODE_ENV ?? "development";
const useOtlp = Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);

const sdk = new NodeSDK({
  // resource：这条遥测数据「来自谁」——服务名/版本/环境
  resource: resourceFromAttributes({
    "service.name": process.env.OTEL_SERVICE_NAME ?? "workboard-api",
    "service.version": process.env.APP_VERSION ?? "0.0.0",
    "deployment.environment.name": environment,
  }),
  spanProcessors: [
    // 本地默认 console（SimpleSpanProcessor 立即输出，便于观察）；
    // 设置 OTEL_EXPORTER_OTLP_ENDPOINT 后走 OTLP/HTTP 到 collector（Batch 攒批）。
    useOtlp
      ? new BatchSpanProcessor({ exporter: new OTLPTraceExporter() })
      : new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() }),
  ],
  instrumentations: [
    getNodeAutoInstrumentations({
      // fs 插桩噪声大，关掉；http/pg/dns 等保持默认启用。
      // 注意：instrumentation-fastify 当前仅支持 Fastify 3/4，对 Fastify 5 不生效；
      // http 自动插桩已提供 server span，业务细节用手动 span 补充（第 8 章详解）。
      "@opentelemetry/instrumentation-fs": { enabled: false },
    }),
  ],
});
sdk.start();

// Sentry：DSN 未设置时 SDK 自动禁用发送（本地/CI 零配置可跑）。
// OTel provider 已先启动；openTelemetryIntegration 把错误关联到活跃 span。
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment,
  release: process.env.APP_VERSION,
  enableOpenTelemetrySetup: false,
  // 不设 tracesSampleRate / tracesSampler：tracing 归 OTel
  integrations: (defaults) => [
    // 去掉默认 Fastify 集成，避免与 OTel 的 fastify 插桩重复；
    // 错误捕获由 app.ts 的 setErrorHandler 显式完成（带 requestId tag）。
    ...defaults.filter((i) => i.name !== "Fastify"),
    Sentry.openTelemetryIntegration(),
  ],
  // 隐私：不采集用户身份、Cookie、请求体、URL 查询参数
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpBodies: [],
    urlQueryParams: false,
  },
});

export async function shutdownTelemetry(): Promise<void> {
  // 优雅关闭时冲刷未导出的 span 与未发送的事件
  await sdk.shutdown().catch(() => undefined);
  await Sentry.close(2000).catch(() => undefined);
}
