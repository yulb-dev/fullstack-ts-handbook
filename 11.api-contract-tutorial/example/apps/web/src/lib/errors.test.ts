import { ApiError, NetworkError } from "@taskflow/api-client";
import { describe, expect, it, vi } from "vitest";
import { applyServerFieldErrors, describeError } from "./errors";
import { retryDelay, shouldRetryQuery } from "./query-client";

const apiError = (status: number, code: ApiError["code"] = "UNKNOWN") =>
  new ApiError(status, code, "服务端说明", "req-42");

describe("describeError：状态码 → UI", () => {
  it.each([
    [400, "VALIDATION_FAILED", "提交的数据有误", "none"],
    [401, "UNAUTHENTICATED", "登录已过期", "login"],
    [403, "FORBIDDEN", "没有权限", "back"],
    [403, "CSRF_REJECTED", "页面已过期", "reload"],
    [404, "NOT_FOUND", "内容不存在", "back"],
    [409, "CONFLICT", "与现有数据冲突", "none"],
    [412, "PRECONDITION_FAILED", "内容已被他人修改", "reload"],
    [429, "RATE_LIMITED", "操作太频繁", "retry"],
    [500, "INTERNAL", "服务器出错了", "retry"],
    [502, "UNKNOWN", "服务器出错了", "retry"],
  ] as const)("%i %s → %s", (status, code, title, action) => {
    const view = describeError(apiError(status, code));
    expect(view).toMatchObject({ title, action });
  });

  it("5xx 一定带上 requestId，便于用户反馈", () => {
    expect(describeError(apiError(500, "INTERNAL")).requestId).toBe("req-42");
  });

  it("网络错误提示重试", () => {
    expect(describeError(new NetworkError("断网了"))).toMatchObject({
      title: "网络异常",
      action: "retry",
    });
  });
});

describe("applyServerFieldErrors", () => {
  it("body 字段回填到表单，其余汇总到 root", () => {
    const setError = vi.fn();
    const error = new ApiError(400, "VALIDATION_FAILED", "x", "r", [
      {
        in: "body",
        path: "title",
        rule: "minLength",
        message: "至少 1 个字符",
      },
      {
        in: "headers",
        path: "idempotency-key",
        rule: "required",
        message: "必填",
      },
    ]);
    const applied = applyServerFieldErrors(error, setError, [
      "title",
      "description",
    ]);
    expect(applied).toBe(true);
    expect(setError).toHaveBeenCalledWith(
      "title",
      { type: "server.minLength", message: "至少 1 个字符" },
      { shouldFocus: true },
    );
    expect(setError).toHaveBeenCalledWith("root.server", {
      type: "server",
      message: "idempotency-key：必填",
    });
  });
});

describe("查询重试策略", () => {
  it("只重试网络错误与可恢复的状态码，且最多 3 次", () => {
    expect(shouldRetryQuery(0, new NetworkError("x"))).toBe(true);
    expect(shouldRetryQuery(0, apiError(503))).toBe(true);
    expect(shouldRetryQuery(0, apiError(429))).toBe(true);
    for (const status of [400, 401, 403, 404, 409, 500]) {
      expect(shouldRetryQuery(0, apiError(status)), String(status)).toBe(false);
    }
    expect(shouldRetryQuery(3, new NetworkError("x"))).toBe(false);
  });

  it("优先遵守 Retry-After，否则指数退避且有上限", () => {
    const limited = new ApiError(429, "RATE_LIMITED", "x", null, [], 5000);
    expect(retryDelay(0, limited)).toBe(5000);
    expect(retryDelay(10, new NetworkError("x"))).toBeLessThanOrEqual(10_000);
  });
});
