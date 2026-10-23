import { describe, expect, it } from "vitest";
import {
  ApiError,
  NetworkError,
  createApiClient,
  parseRetryAfter,
  unwrap,
} from "../src";

const BASE = "http://api.test";

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function clientWith(handler: (req: Request) => Promise<Response> | Response) {
  const seen: Request[] = [];
  const api = createApiClient({
    baseUrl: BASE,
    getCsrfToken: () => "csrf-123",
    fetch: async (req) => {
      seen.push(req);
      return handler(req);
    },
  });
  return { api, seen };
}

const PROJECT = "6b0b6d2e-1d7c-4d4f-9a4e-0f0e8c7a1b11";

describe("createApiClient 中间件", () => {
  it("写请求带 CSRF 头，读请求不带；每个请求都带 requestId", async () => {
    const { api, seen } = clientWith(() =>
      json(200, { items: [], nextCursor: null }),
    );
    await api.GET("/api/v1/projects/{projectId}/tasks", {
      params: { path: { projectId: PROJECT } },
    });
    await api.POST("/api/v1/projects/{projectId}/tasks", {
      params: {
        path: { projectId: PROJECT },
        header: { "idempotency-key": crypto.randomUUID() },
      },
      body: { title: "x" },
    });
    expect(seen[0]?.headers.get("x-csrf-token")).toBeNull();
    expect(seen[1]?.headers.get("x-csrf-token")).toBe("csrf-123");
    expect(seen[1]?.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[0]?.headers.get("x-request-id")).toMatch(/^web-/);
  });

  it("fetch 本身失败 → NetworkError；主动取消 → 原样的 AbortError", async () => {
    const offline = clientWith(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(offline.api.GET("/api/v1/projects")).rejects.toBeInstanceOf(
      NetworkError,
    );

    const controller = new AbortController();
    const aborting = clientWith((req) => {
      controller.abort();
      req.signal.throwIfAborted();
      throw new Error("unreachable");
    });
    await expect(
      aborting.api.GET("/api/v1/projects", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("unwrap / toApiError", () => {
  it("错误 envelope → ApiError（保留 code、fields、requestId）", async () => {
    const { api } = clientWith(() =>
      json(400, {
        error: {
          code: "VALIDATION_FAILED",
          message: "提交的数据有误",
          requestId: "req-1",
          fields: [
            {
              in: "body",
              path: "title",
              rule: "minLength",
              message: "至少 1 个字符",
            },
          ],
        },
      }),
    );
    const err = await unwrap(api.GET("/api/v1/projects")).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 400,
      code: "VALIDATION_FAILED",
      requestId: "req-1",
      fields: [{ path: "title" }],
    });
  });

  it("不认识的错误码 → UNKNOWN（新服务端 + 旧前端不会崩）", async () => {
    const { api } = clientWith(() =>
      json(409, {
        error: { code: "SOME_FUTURE_CODE", message: "新冲突", requestId: "r" },
      }),
    );
    const err = (await unwrap(api.GET("/api/v1/projects")).catch(
      (e) => e,
    )) as ApiError;
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toBe("新冲突");
  });

  it("网关返回 HTML 502 → UNKNOWN + 友好文案 + 响应头里的 requestId", async () => {
    const { api } = clientWith(
      () =>
        new Response("<html>Bad Gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html", "x-request-id": "gw-9" },
        }),
    );
    const err = (await unwrap(api.GET("/api/v1/projects")).catch(
      (e) => e,
    )) as ApiError;
    expect(err).toMatchObject({
      status: 502,
      code: "UNKNOWN",
      requestId: "gw-9",
    });
    expect(err.message).toBe("服务暂时不可用，请稍后重试");
  });

  it("成功时返回带类型的数据", async () => {
    const { api } = clientWith(() => json(200, { items: [] }));
    const data = await unwrap(api.GET("/api/v1/projects"));
    expect(data.items).toEqual([]);
  });
});

describe("parseRetryAfter", () => {
  it("同时支持秒数与 HTTP 日期", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    const now = Date.parse("2026-10-22T00:00:00Z");
    expect(parseRetryAfter("Thu, 22 Oct 2026 00:00:05 GMT", now)).toBe(5000);
    expect(parseRetryAfter(null)).toBeNull();
  });
});
