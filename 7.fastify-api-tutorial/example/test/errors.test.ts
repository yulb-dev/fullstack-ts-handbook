import { describe, expect, it } from "vitest";
import { SEED_IDS } from "../src/data/seed.js";
import { bearer, createLogCollector, createTestApp } from "./helpers.js";

describe("统一错误模型", () => {
  it("所有错误都有相同的结构：statusCode / code / message / requestId", async () => {
    const app = await createTestApp();
    const response = await app.inject({
      url: "/v1/tasks/not-a-uuid",
      headers: bearer("alice"),
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body).toEqual({
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "请求参数不符合接口约定",
      requestId: response.headers["x-request-id"],
      details: [
        {
          location: "params",
          field: "/taskId",
          rule: "format",
          message: 'must match format "uuid"',
        },
      ],
    });
  });

  it("body 缺字段：field 指向缺失的属性", async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: bearer("alice"),
      payload: { priority: "high" },
    });
    expect(response.json().details).toEqual([
      {
        location: "body",
        field: "/title",
        rule: "required",
        message: "must have required property 'title'",
      },
    ]);
  });

  it("headers 校验：If-Match 格式不对返回 400", async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/tasks/${SEED_IDS.aliceTask}`,
      headers: { ...bearer("alice"), "if-match": "v1" },
      payload: { status: "doing" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().details[0]).toMatchObject({
      location: "headers",
      field: "/if-match",
      rule: "pattern",
    });
  });

  it("非法 JSON 返回 INVALID_JSON，而不是 500", async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { ...bearer("alice"), "content-type": "application/json" },
      payload: '{"title": ',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_JSON");
  });

  it("不支持的 Content-Type 返回 415", async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { ...bearer("alice"), "content-type": "application/xml" },
      payload: "<task/>",
    });
    expect(response.statusCode).toBe(415);
    expect(response.json().code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("未登录返回 401 并带 WWW-Authenticate；token 错误同样是 401", async () => {
    const app = await createTestApp();
    const missing = await app.inject({ url: "/v1/me" });
    expect(missing.statusCode).toBe(401);
    expect(missing.headers["www-authenticate"]).toBe("Bearer");

    const wrong = await app.inject({
      url: "/v1/me",
      headers: { authorization: "Bearer nope" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe("UNAUTHORIZED");
  });

  it("角色不够返回 403；管理员查不存在的用户返回 404", async () => {
    const app = await createTestApp();
    const url = `/v1/admin/users/${SEED_IDS.bob}`;

    const asMember = await app.inject({ url, headers: bearer("alice") });
    expect(asMember.statusCode).toBe(403);

    const asAdmin = await app.inject({ url, headers: bearer("admin") });
    expect(asAdmin.json()).toEqual({
      id: SEED_IDS.bob,
      name: "Bob",
      email: "bob@example.com",
      role: "member",
    });

    const missing = await app.inject({
      url: "/v1/admin/users/00000000-0000-4000-8000-00000000ffff",
      headers: bearer("admin"),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("USER_NOT_FOUND");
  });

  it("不存在的路由返回统一结构的 404", async () => {
    const app = await createTestApp();
    const response = await app.inject({ url: "/v2/tasks" });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("ROUTE_NOT_FOUND");
  });

  it("超过限流返回 429，带 Retry-After，按用户分别计数", async () => {
    const app = await createTestApp({ createTaskRateLimit: 2 });
    const create = (user: "alice" | "bob", title: string) =>
      app.inject({
        method: "POST",
        url: "/v1/tasks",
        headers: bearer(user),
        payload: { title },
      });

    expect((await create("alice", "a1")).statusCode).toBe(201);
    expect((await create("alice", "a2")).statusCode).toBe(201);
    const limited = await create("alice", "a3");
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBeDefined();

    // Bob 有自己的额度
    expect((await create("bob", "b1")).statusCode).toBe(201);
  });

  it("未知错误：响应只说“服务器内部错误”，细节只进日志", async () => {
    const logs = createLogCollector();
    const app = await createTestApp({
      logging: { enabled: true, stream: logs.stream },
    });
    app.get("/boom", async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.12:5432");
    });

    const response = await app.inject({ url: "/boom" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      statusCode: 500,
      code: "INTERNAL_ERROR",
      message: "服务器内部错误",
      requestId: response.headers["x-request-id"],
    });
    expect(response.body).not.toContain("ECONNREFUSED");

    const errorLog = logs.lines.find((line) => line.msg === "unhandled error");
    expect(errorLog).toMatchObject({
      level: 50,
      requestId: response.headers["x-request-id"],
    });
    expect((errorLog?.err as { message: string }).message).toContain(
      "ECONNREFUSED",
    );
  });
});

describe("请求 ID", () => {
  it("没有上游 ID 时生成 UUID，并通过响应头返回", async () => {
    const app = await createTestApp();
    const response = await app.inject({ url: "/healthz" });
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("沿用上游传入的合法 x-request-id，忽略不合法的", async () => {
    const app = await createTestApp();
    const kept = await app.inject({
      url: "/healthz",
      headers: { "x-request-id": "gateway-abc-123" },
    });
    expect(kept.headers["x-request-id"]).toBe("gateway-abc-123");

    const replaced = await app.inject({
      url: "/healthz",
      headers: { "x-request-id": "bad id with spaces" },
    });
    expect(replaced.headers["x-request-id"]).not.toBe("bad id with spaces");
  });
});
