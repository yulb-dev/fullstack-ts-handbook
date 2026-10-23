import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { LogController, type FastifyServerOptions } from "fastify";

/** Pino 只需要一个带 write 方法的对象作为输出目标 */
export interface LogDestination {
  write(line: string): void;
}

export interface LoggingOptions {
  /** false 表示完全关闭日志（单元测试常用） */
  enabled: boolean;
  level?: string;
  /** 开发环境用 pino-pretty 输出人类可读格式；生产保持 JSON 一行一条 */
  pretty?: boolean;
  /** 测试时可以传入一个内存 stream 收集日志 */
  stream?: LogDestination;
}

/**
 * 需要在日志中隐藏的字段。
 * Pino 的 redact 路径是精确路径：'*.apiToken' 只匹配第二层（如 user.apiToken），
 * 顶层的 apiToken、更深的字段、数组元素里的字段都要单独写。
 */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "user.email",
  "password",
  "apiToken",
  "*.password",
  "*.apiToken",
];

export function buildLoggerOptions(
  options: LoggingOptions,
): FastifyServerOptions["logger"] {
  if (!options.enabled) return false;

  return {
    level: options.level ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
    serializers: {
      // 白名单式的 req 序列化：只记录排查需要的字段，比“全量记录再 redact”更安全
      req(request) {
        return {
          method: request.method,
          url: request.url,
          host: request.host,
          remoteAddress: request.ip,
          userAgent: request.headers["user-agent"],
        };
      },
    },
    ...(options.stream ? { stream: options.stream } : {}),
    ...(options.pretty && !options.stream
      ? {
          transport: {
            target: "pino-pretty",
            options: { translateTime: "HH:MM:ss Z", ignore: "pid,hostname" },
          },
        }
      : {}),
  };
}

/** 与错误响应里的 requestId 字段同名，方便日志与响应对照 */
export const logController = new LogController({
  requestIdLogLabel: "requestId",
});

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * 生成请求 ID：上游（网关/负载均衡）已经带了合法的 x-request-id 就沿用，否则生成 UUID。
 * Fastify 的 requestIdHeader 选项不会校验头的内容，所以这里自己做格式检查，
 * 防止调用方塞入超长字符串或换行符污染日志。
 */
export function genReqId(req: IncomingMessage): string {
  const incoming = req.headers["x-request-id"];
  if (typeof incoming === "string" && REQUEST_ID_PATTERN.test(incoming))
    return incoming;
  return randomUUID();
}
