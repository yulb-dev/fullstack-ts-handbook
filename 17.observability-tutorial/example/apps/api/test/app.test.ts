import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createMemoryRepository } from "../src/repository.js";

function build() {
  return buildApp({ repo: createMemoryRepository() }, { logger: false });
}

describe("requestId 贯穿", () => {
  it("响应头 x-request-id 与错误 envelope 的 requestId 同源", async () => {
    const app = build();
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const headerId = res.headers["x-request-id"];
    expect(headerId).toBeTruthy();
    expect(res.json().error.requestId).toBe(headerId);
    await app.close();
  });
});

describe("失败路径", () => {
  it("viewer 角色创建任务被拒 403", async () => {
    const app = build();
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { "x-demo-role": "viewer" },
      payload: { title: "越权尝试" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    await app.close();
  });

  it("模拟数据库故障 → 500，envelope 不泄漏内部细节", async () => {
    const app = build();
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "FAIL_DB" },
    });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).not.toContain("connection terminated");
    expect(body.error.requestId).toBe(res.headers["x-request-id"]);
    await app.close();
  });

  it("全空白 title 400", async () => {
    const app = build();
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "   " },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("成功路径", () => {
  it("创建任务 201，列表可见", async () => {
    const app = build();
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "观测演练" },
    });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(
      list.json().tasks.some((t: { title: string }) => t.title === "观测演练"),
    ).toBe(true);
    await app.close();
  });

  it("liveness 恒 200，readiness 依赖仓储 ping", async () => {
    const app = build();
    expect(
      (await app.inject({ method: "GET", url: "/health/live" })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/health/ready" })).statusCode,
    ).toBe(200);
    await app.close();
  });
});
