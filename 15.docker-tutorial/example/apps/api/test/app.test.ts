import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { Queryable } from "../src/db.js";

// 用 stub 替代真实数据库：本教程的测试重点是 HTTP 边界行为，
// 数据库集成测试属于阶段 12（Vitest）的范围。
function stubDb(overrides: Partial<Queryable> = {}): Queryable {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    ...overrides,
  } as unknown as Queryable;
}

function build(overrides: Partial<Queryable> = {}) {
  return buildApp({ db: stubDb(overrides) }, { logger: false });
}

describe("health endpoints", () => {
  it("liveness 不依赖数据库，始终 200", async () => {
    const app = build({
      query: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const res = await app.inject({ method: "GET", url: "/health/live" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("readiness 在数据库可用时 200", async () => {
    const app = build();
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
    await app.close();
  });

  it("readiness 在数据库不可达时 503", async () => {
    const app = build({
      query: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "unavailable" });
    await app.close();
  });
});

describe("POST /api/tasks", () => {
  it("缺少 title 时 400，且错误 envelope 带 requestId", async () => {
    const app = build();
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(typeof body.error.requestId).toBe("string");
    expect(body.error.requestId.length).toBeGreaterThan(0);
    await app.close();
  });

  it("全空白 title 被业务规则拒绝（schema 之外的校验）", async () => {
    const app = build();
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "   " },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("合法 title 创建成功，参数化查询防注入", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "1",
          title: "写 Dockerfile",
          status: "todo",
          created_at: "2026-11-18",
        },
      ],
    });
    const app = build({ query });
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "  写 Dockerfile  " },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().task.title).toBe("写 Dockerfile");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("VALUES ($1)"), [
      "写 Dockerfile",
    ]);
    await app.close();
  });
});

describe("错误出口", () => {
  it("数据库异常时 500，不泄漏内部错误细节", async () => {
    const app = build({
      query: vi
        .fn()
        .mockRejectedValue(
          new Error("password authentication failed for user secret"),
        ),
    });
    const res = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("secret");
    expect(body.error.requestId).toBeTruthy();
    await app.close();
  });
});
