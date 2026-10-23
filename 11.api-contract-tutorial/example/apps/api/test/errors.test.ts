import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestApp } from "./helpers";

let ctx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  ctx = await createTestApp();
  // 测试专用路由：模拟一个带敏感信息的意外异常（buildApp 后、ready 前仍可加路由）
  ctx.app.get("/boom", async () => {
    throw new Error("connect ECONNREFUSED 10.0.3.7:5432 password=hunter2");
  });
});
afterAll(() => ctx.close());

it("500：响应只给通用文案和 requestId；完整错误进日志，且能用 requestId 检索", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/boom" });
  expect(res.statusCode).toBe(500);
  const body = res.json();
  expect(body).toEqual({
    error: {
      code: "INTERNAL",
      message: "服务器开小差了，请稍后重试",
      requestId: res.headers["x-request-id"],
    },
  });
  expect(res.body).not.toContain("ECONNREFUSED");
  expect(res.body).not.toContain("hunter2");

  const entry = ctx.logs.find(
    (l) => l.requestId === body.error.requestId && l.msg === "unhandled error",
  );
  expect(entry).toBeDefined();
  expect(JSON.stringify(entry)).toContain("ECONNREFUSED");
});

it("未知路由也返回统一 envelope", async () => {
  const res = await ctx.app.inject({ method: "GET", url: "/api/v1/nope" });
  expect(res.statusCode).toBe(404);
  expect(res.json().error.code).toBe("NOT_FOUND");
});
