/**
 * 稳定错误码目录。
 * code 是给客户端程序判断用的契约：一旦发布，只能新增，不能改名或改语义。
 * message 是给人看的默认说明，可以润色，但不能包含内部细节。
 */
export const ErrorCatalog = {
  VALIDATION_FAILED: { statusCode: 400, message: "请求参数不符合接口约定" },
  INVALID_JSON: { statusCode: 400, message: "请求体不是合法的 JSON" },
  BAD_REQUEST: { statusCode: 400, message: "请求无法被处理" },
  UNAUTHORIZED: { statusCode: 401, message: "缺少或无效的身份凭证" },
  FORBIDDEN: { statusCode: 403, message: "没有执行该操作的权限" },
  ROUTE_NOT_FOUND: { statusCode: 404, message: "接口不存在" },
  TASK_NOT_FOUND: { statusCode: 404, message: "任务不存在" },
  USER_NOT_FOUND: { statusCode: 404, message: "用户不存在" },
  TASK_TITLE_CONFLICT: { statusCode: 409, message: "你已经有一个同名任务" },
  TASK_ALREADY_DONE: { statusCode: 409, message: "已完成的任务只能修改状态" },
  PRECONDITION_FAILED: {
    statusCode: 412,
    message: "资源已被修改，请重新获取后再提交",
  },
  PAYLOAD_TOO_LARGE: { statusCode: 413, message: "请求体过大" },
  UNSUPPORTED_MEDIA_TYPE: { statusCode: 415, message: "不支持的 Content-Type" },
  ASSIGNEE_NOT_FOUND: { statusCode: 422, message: "指派的用户不存在" },
  RATE_LIMITED: { statusCode: 429, message: "请求过于频繁，请稍后再试" },
  INTERNAL_ERROR: { statusCode: 500, message: "服务器内部错误" },
} as const satisfies Record<string, { statusCode: number; message: string }>;

export type ErrorCode = keyof typeof ErrorCatalog;

export interface ErrorDetail {
  /** 出错的位置：body / querystring / params / headers */
  location: string;
  /** JSON Pointer 风格的字段路径，例如 /title；整个对象出错时为空字符串 */
  field: string;
  /** 违反的规则，例如 minLength、required、enum */
  rule: string;
  message: string;
}

interface AppErrorOptions {
  /** 覆盖默认 message；只放可以安全给客户端看的内容 */
  message?: string;
  details?: ErrorDetail[];
  /** 需要附带在响应上的头，例如 Retry-After、WWW-Authenticate */
  headers?: Record<string, string>;
  /** 原始错误，只进日志，不进响应 */
  cause?: unknown;
}

/**
 * 应用主动抛出的“预期内错误”。
 * 只要是 AppError，错误处理器就可以放心把 code 和 message 返回给客户端。
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: ErrorDetail[] | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? ErrorCatalog[code].message, {
      cause: options.cause,
    });
    this.name = "AppError";
    this.code = code;
    this.statusCode = ErrorCatalog[code].statusCode;
    this.details = options.details;
    this.headers = options.headers;
  }
}
