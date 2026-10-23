import type { ErrorCode, FieldError } from "../contract/common";

/**
 * 业务层抛出的「可预期错误」。
 * - statusCode / code / message 会进入统一错误 envelope 返回给客户端；
 * - message 必须是可以给用户看的话，不放 SQL、堆栈、内部 ID；
 * - 排查用的细节放在 logContext，只进日志，不进响应。
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly options: {
      fields?: FieldError[];
      logContext?: Record<string, unknown>;
      headers?: Record<string, string>;
    } = {},
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthenticated = () =>
  new AppError(401, "UNAUTHENTICATED", "请先登录");

export const forbidden = (message = "你没有执行该操作的权限") =>
  new AppError(403, "FORBIDDEN", message);

export const notFound = (resource: string) =>
  new AppError(404, "NOT_FOUND", `${resource}不存在或你无权访问`);

export const fieldConflict = (path: string, message: string) =>
  new AppError(409, "CONFLICT", message, {
    fields: [{ in: "body", path, rule: "unique", message }],
  });
