import { ApiError, NetworkError, isAbortError } from "@taskflow/api-client";
import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";

/** UI 只关心「怎么展示、下一步做什么」，不关心 HTTP 细节 */
export interface ErrorView {
  title: string;
  message: string;
  requestId: string | null;
  action: "retry" | "login" | "reload" | "back" | "none";
}

export function describeError(error: unknown): ErrorView {
  if (error instanceof NetworkError) {
    return {
      title: "网络异常",
      message: error.message,
      requestId: null,
      action: "retry",
    };
  }
  if (isAbortError(error)) {
    return {
      title: "请求已取消",
      message: "",
      requestId: null,
      action: "none",
    };
  }
  if (!(error instanceof ApiError)) {
    return {
      title: "出错了",
      message: "发生未知错误，请刷新页面",
      requestId: null,
      action: "reload",
    };
  }

  const { requestId } = error;
  switch (error.status) {
    case 400:
      return {
        title: "提交的数据有误",
        message: error.message,
        requestId,
        action: "none",
      };
    case 401:
      return {
        title: "登录已过期",
        message: "请重新登录后继续",
        requestId,
        action: "login",
      };
    case 403:
      return error.code === "CSRF_REJECTED"
        ? {
            title: "页面已过期",
            message: "请刷新页面后重试",
            requestId,
            action: "reload",
          }
        : {
            title: "没有权限",
            message: error.message,
            requestId,
            action: "back",
          };
    case 404:
      return {
        title: "内容不存在",
        message: "它可能已被删除，或你没有访问权限",
        requestId,
        action: "back",
      };
    case 409:
      return {
        title: "与现有数据冲突",
        message: error.message,
        requestId,
        action: "none",
      };
    case 412:
    case 428:
      return {
        title: "内容已被他人修改",
        message: error.message,
        requestId,
        action: "reload",
      };
    case 422:
      return {
        title: "无法重复提交",
        message: error.message,
        requestId,
        action: "reload",
      };
    case 429:
      return {
        title: "操作太频繁",
        message: "请稍等片刻再试",
        requestId,
        action: "retry",
      };
  }
  if (error.status >= 500) {
    return {
      title: "服务器出错了",
      message:
        "我们已记录这个问题，请稍后重试。如需反馈，请附上下方的请求编号。",
      requestId,
      action: "retry",
    };
  }
  return {
    title: "请求失败",
    message: error.message,
    requestId,
    action: "none",
  };
}

/**
 * 把服务端的字段错误回填到 React Hook Form。
 * 只认「body 里、且表单确实有这个字段」的错误；其余的（例如 headers.idempotency-key）
 * 对用户没有意义，汇总到 root 让表单顶部展示。
 * 返回值：是否至少回填了一个字段。
 */
export function applyServerFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  formFields: readonly FieldPath<T>[],
): boolean {
  if (!(error instanceof ApiError) || error.fields.length === 0) return false;
  let applied = false;
  const leftovers: string[] = [];
  for (const field of error.fields) {
    const name = field.path as FieldPath<T>;
    if (field.in === "body" && formFields.includes(name)) {
      setError(
        name,
        { type: `server.${field.rule}`, message: field.message },
        { shouldFocus: !applied },
      );
      applied = true;
    } else {
      leftovers.push(`${field.path}：${field.message}`);
    }
  }
  if (leftovers.length > 0) {
    setError("root.server", { type: "server", message: leftovers.join("；") });
  }
  return applied;
}
