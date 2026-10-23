import type { components } from "./generated/openapi";

export type ErrorCode = components["schemas"]["ErrorCode"];
export type FieldError = components["schemas"]["FieldError"];
type ErrorResponse = components["schemas"]["ErrorResponse"];

/**
 * 客户端「认识」的错误码清单。
 * `satisfies Record<ErrorCode, true>` 要求它与契约里的枚举一一对应：
 * 服务端新增或删除错误码 → 重新生成类型 → 这里编译失败，提醒你更新 UI 映射。
 */
const KNOWN_CODES = {
  VALIDATION_FAILED: true,
  BAD_REQUEST: true,
  UNAUTHENTICATED: true,
  FORBIDDEN: true,
  CSRF_REJECTED: true,
  NOT_FOUND: true,
  CONFLICT: true,
  IDEMPOTENCY_KEY_REUSED: true,
  PRECONDITION_FAILED: true,
  PRECONDITION_REQUIRED: true,
  RATE_LIMITED: true,
  INTERNAL: true,
} satisfies Record<ErrorCode, true>;

/** 服务端返回了 HTTP 错误（4xx/5xx） */
export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    readonly status: number,
    /** 不认识的码（新版服务端 / 网关返回的 HTML）一律是 UNKNOWN，UI 按 status 兜底 */
    readonly code: ErrorCode | "UNKNOWN",
    message: string,
    readonly requestId: string | null,
    readonly fields: FieldError[] = [],
    /** 429 / 503 的 Retry-After，换算成毫秒 */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

/** 请求根本没拿到 HTTP 响应：断网、DNS 失败、连接被重置、被 CORS 拦截…… */
export class NetworkError extends Error {
  override readonly name = "NetworkError";
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isErrorResponse(body: unknown): body is ErrorResponse {
  if (typeof body !== "object" || body === null || !("error" in body))
    return false;
  const e = (body as { error: unknown }).error;
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { code?: unknown }).code === "string" &&
    typeof (e as { message?: unknown }).message === "string"
  );
}

export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

const FALLBACK_MESSAGE: Record<number, string> = {
  502: "服务暂时不可用，请稍后重试",
  503: "服务暂时不可用，请稍后重试",
  504: "服务器响应超时，请稍后重试",
};

/** 把任意错误响应规整成 ApiError；不信任响应体一定符合契约 */
export function toApiError(body: unknown, response: Response): ApiError {
  const headerRequestId = response.headers.get("x-request-id");
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
  if (isErrorResponse(body)) {
    const { code, message, requestId, fields } = body.error;
    return new ApiError(
      response.status,
      code in KNOWN_CODES ? code : "UNKNOWN",
      message,
      requestId ?? headerRequestId,
      Array.isArray(fields) ? fields : [],
      retryAfterMs,
    );
  }
  return new ApiError(
    response.status,
    "UNKNOWN",
    FALLBACK_MESSAGE[response.status] ?? `请求失败（HTTP ${response.status}）`,
    headerRequestId,
    [],
    retryAfterMs,
  );
}
