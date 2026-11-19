import { trace } from "@opentelemetry/api";
import type { FastifyServerOptions } from "fastify";

// 把当前活跃 span 的 trace_id/span_id 注入日志字段（独立导出便于单测）。
export function traceMixin(): Record<string, string> {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const ctx = span.spanContext();
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}

// Fastify 内置 Pino。这里做两件事：
// 1. mixin：日志 ↔ trace 关联；
// 2. redact：敏感字段脱敏 → 日志不泄漏凭据（路线图隐私红线）。
export function loggerOptions(): NonNullable<FastifyServerOptions["logger"]> {
  return {
    level: process.env.LOG_LEVEL ?? "info",
    mixin: traceMixin,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.password",
        "*.token",
        "*.secret",
      ],
      censor: "[REDACTED]",
    },
  };
}
