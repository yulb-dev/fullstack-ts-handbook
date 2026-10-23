import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

// 只接受「看起来像 ID」的外部 requestId，防止日志注入与超长头
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * 生成本次请求的 requestId：
 * - 上游（网关 / 前端）已经带了合法的 X-Request-Id，就沿用，便于全链路串联；
 * - 否则由服务端生成 UUID。
 */
export function genReqId(req: IncomingMessage): string {
  const incoming = req.headers["x-request-id"];
  if (typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming)) {
    return incoming;
  }
  return randomUUID();
}
