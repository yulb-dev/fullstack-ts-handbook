import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createTaskStore } from "../src/store.js";

function build() {
  return buildApp({ store: createTaskStore() }, { logger: false });
}

describe("GET /api/tasks", () => {
  it("返回种子任务与分页契约", async () => {
    const app = build();
    const res = await app.inject({
      method: "GET",
      url: "/api/tasks?page=1&pageSize=10",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.tasks[0].title).toBe("阅读 CI 教程第 1 章");
    await app.close();
  });

  it("非法分页参数回退默认值（共享纯函数的边界行为）", async () => {
    const app = build();
    const res = await app.inject({
      method: "GET",
      url: "/api/tasks?page=abc&pageSize=-1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().page).toBe(1);
    expect(res.json().pageSize).toBe(20);
    await app.close();
  });
});

describe("POST /api/tasks", () => {
  it("创建成功 201", async () => {
    const app = build();
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "新任务" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().task.status).toBe("todo");
    await app.close();
  });

  it("缺少 title 400，envelope 带 requestId", async () => {
    const app = build();
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.requestId).toBeTruthy();
    await app.close();
  });
});

describe("PATCH /api/tasks/:id/status", () => {
  it("合法迁移 todo → doing", async () => {
    const app = build();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/tasks/t-1/status",
      payload: { status: "doing" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().task.status).toBe("doing");
    await app.close();
  });

  it("非法迁移 todo → done 返回 409", async () => {
    const app = build();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/tasks/t-1/status",
      payload: { status: "done" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("INVALID_TRANSITION");
    await app.close();
  });

  it("不存在的任务 404", async () => {
    const app = build();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/tasks/nope/status",
      payload: { status: "doing" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
    await app.close();
  });

  it("非法状态值 400", async () => {
    const app = build();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/tasks/t-1/status",
      payload: { status: "archived" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
