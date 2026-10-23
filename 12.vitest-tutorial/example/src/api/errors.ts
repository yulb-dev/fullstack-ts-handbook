/**
 * 统一错误 envelope：所有非 2xx 响应都是 { error: { code, message }, requestId }。
 * 测试断言这个结构，而不是每个路由各自发明的错误格式。
 */
export interface ErrorBody {
  error: { code: string; message: string };
  requestId: string;
}

export function buildErrorBody(
  code: string,
  message: string,
  requestId: string,
): ErrorBody {
  return { error: { code, message }, requestId };
}
