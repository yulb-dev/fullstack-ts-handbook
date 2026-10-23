import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "@/api/app.js";
import {
  createInMemoryTaskRepository,
  createNotificationCollector,
} from "@/services/in-memory-task-repository.js";
import { createTaskService } from "@/services/task-service.js";

/**
 * API 集成测试（不碰数据库那一档）：
 * 真实 Fastify 实例 + 真实 service + 内存仓储，用 app.inject() 打请求。
 * 验证的是「HTTP 边界」：状态码、错误 envelope、requestId、鉴权 hook、并发。
 */

const FIXED_NOW = new Date("2026-03-10T12:00:00Z");

const member = { "x-user-id": "u1", "x-user-role": "member" };
const otherMember = { "x-user-id": "u2", "x-user-role": "member" };
const manager = { "x-user-id": "m1", "x-user-role": "manager" };

let app: FastifyInstance;

beforeEach(() => {
  app = buildApp({
    service: createTaskService({
      repo: createInMemoryTaskRepository(),
      notifier: createNotificationCollector(),
      clock: () => FIXED_NOW,
    }),
  });
});

afterEach(async () => {
  // 必须 close：否则 hook、连接等资源泄漏，测试进程可能挂住
  await app.close();
});

describe("身份边界（preHandler hook）", () => {
  it("缺少 x-user-id → 401 + 统一错误 envelope + requestId", async () => {
    const res = await app.inject({ method: "GET", url: "/tasks" });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toContain("x-user-id");
    expect(body.requestId).toEqual(expect.any(String));
    expect(res.headers["x-request-id"]).toBe(body.requestId);
  });

  it("非法角色 → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/tasks",
      headers: { "x-user-id": "u1", "x-user-role": "admin" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("未匹配的路由 → 404（不会被误报成 500）", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/nope",
      headers: member,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /tasks", () => {
  it("成功创建 → 201 + { task }，字段完整", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: member,
      payload: { title: "  写 Vitest 教程  ", dueDate: "2026-04-01" },
    });

    expect(res.statusCode).toBe(201);
    const { task } = res.json();
    expect(task).toMatchObject({
      title: "写 Vitest 教程", // trim 发生在 schema
      status: "todo",
      ownerId: "u1",
    });
    expect(task.dueDate).toBe("2026-04-01T00:00:00.000Z"); // JSON 序列化后是 ISO 字符串
    expect(task.createdAt).toBe(FIXED_NOW.toISOString());
  });

  it("空标题 → 400 VALIDATION_ERROR，消息带字段路径", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: member,
      payload: { title: "   " },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toMatch(/^title: /);
  });

  it("截止日期在过去 → 422 PAST_DUE_DATE", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: member,
      payload: { title: "回到过去", dueDate: "2026-03-09" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("PAST_DUE_DATE");
  });

  it("重名 → 409 TASK_CONFLICT", async () => {
    await app.inject({
      method: "POST",
      url: "/tasks",
      headers: member,
      payload: { title: "重复" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: otherMember,
      payload: { title: "重复" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TASK_CONFLICT");
  });

  it("并发重名提交：恰好一个 201、一个 409（查重竞态由唯一约束兜底）", async () => {
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/tasks",
        headers: member,
        payload: { title: "秒杀" },
      }),
      app.inject({
        method: "POST",
        url: "/tasks",
        headers: otherMember,
        payload: { title: "秒杀" },
      }),
    ]);
    const statuses = responses.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([201, 409]);
  });
});

describe("POST /tasks/:id/transition", () => {
  async function createTask(
    headers: Record<string, string>,
    title: string,
  ): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/tasks",
      headers,
      payload: { title },
    });
    expect(res.statusCode).toBe(201);
    return (res.json().task as { id: string }).id;
  }

  it("owner 走合法路径 todo → in_progress → done", async () => {
    const id = await createTask(member, "全链路任务");

    const r1 = await app.inject({
      method: "POST",
      url: `/tasks/${id}/transition`,
      headers: member,
      payload: { to: "in_progress" },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().task.status).toBe("in_progress");

    const r2 = await app.inject({
      method: "POST",
      url: `/tasks/${id}/transition`,
      headers: member,
      payload: { to: "done" },
    });
    expect(r2.json().task.status).toBe("done");
  });

  it("非法迁移 todo → done → 422 INVALID_TRANSITION", async () => {
    const id = await createTask(member, "跳步任务");
    const res = await app.inject({
      method: "POST",
      url: `/tasks/${id}/transition`,
      headers: member,
      payload: { to: "done" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_TRANSITION");
    expect(res.json().error.message).toBe("不允许从 todo 迁移到 done");
  });

  it("越权：无关 member 迁移别人的任务 → 403，状态不变", async () => {
    const id = await createTask(member, "别人的任务");

    const res = await app.inject({
      method: "POST",
      url: `/tasks/${id}/transition`,
      headers: otherMember,
      payload: { to: "archived" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("PERMISSION_DENIED");

    const after = await app.inject({
      method: "GET",
      url: "/tasks",
      headers: manager,
    });
    expect(after.json().items[0].status).toBe("todo");
  });

  it("manager 可以归档任何任务", async () => {
    const id = await createTask(member, "待归档");
    await app.inject({
      method: "POST",
      url: `/tasks/${id}/transition`,
      headers: manager,
      payload: { to: "in_progress" },
    });
    const res = await app.inject({
      method: "POST",
      url: `/tasks/${id}/transition`,
      headers: manager,
      payload: { to: "archived" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().task.status).toBe("archived");
  });

  it("任务不存在 → 404 TASK_NOT_FOUND", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/tasks/task_missing/transition",
      headers: member,
      payload: { to: "done" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TASK_NOT_FOUND");
  });

  it("未知状态名 → 400（枚举白名单在路由层就拦下）", async () => {
    const id = await createTask(member, "状态白名单");
    const res = await app.inject({
      method: "POST",
      url: `/tasks/${id}/transition`,
      headers: member,
      payload: { to: "deleted" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /tasks 分页与过滤", () => {
  it("返回 items/page/pageSize/total，默认第 1 页 20 条", async () => {
    for (const title of ["任务 A", "任务 B", "任务 C"]) {
      await app.inject({
        method: "POST",
        url: "/tasks",
        headers: member,
        payload: { title },
      });
    }

    const res = await app.inject({
      method: "GET",
      url: "/tasks",
      headers: member,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    expect(res.json().items).toHaveLength(3);
  });

  it("page=2&pageSize=2 只返回 1 条", async () => {
    for (const title of ["t1", "t2", "t3"]) {
      await app.inject({
        method: "POST",
        url: "/tasks",
        headers: member,
        payload: { title },
      });
    }
    const res = await app.inject({
      method: "GET",
      url: "/tasks?page=2&pageSize=2",
      headers: member,
    });
    expect(res.json()).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(res.json().items).toHaveLength(1);
  });

  it("非法分页参数 → 400", async () => {
    for (const url of [
      "/tasks?page=0",
      "/tasks?pageSize=101",
      "/tasks?page=abc",
    ]) {
      const res = await app.inject({ method: "GET", url, headers: member });
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error.code, url).toBe("VALIDATION_ERROR");
    }
  });

  it("status 过滤：非法值 400，合法值只返回匹配任务", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/tasks",
      headers: member,
      payload: { title: "过滤目标" },
    });
    const id = (created.json().task as { id: string }).id;
    await app.inject({
      method: "POST",
      url: `/tasks/${id}/transition`,
      headers: member,
      payload: { to: "in_progress" },
    });
    await app.inject({
      method: "POST",
      url: "/tasks",
      headers: member,
      payload: { title: "仍是 todo" },
    });

    const bad = await app.inject({
      method: "GET",
      url: "/tasks?status=nope",
      headers: member,
    });
    expect(bad.statusCode).toBe(400);

    const inProgress = await app.inject({
      method: "GET",
      url: "/tasks?status=in_progress",
      headers: member,
    });
    expect(inProgress.json().items).toHaveLength(1);
    expect(inProgress.json().items[0].title).toBe("过滤目标");
  });
});

describe("requestId 可观测性", () => {
  it("每个响应都带 x-request-id，且与错误体里的 requestId 一致", async () => {
    const a = await app.inject({
      method: "GET",
      url: "/tasks",
      headers: member,
    });
    const b = await app.inject({
      method: "GET",
      url: "/tasks",
      headers: member,
    });

    expect(a.headers["x-request-id"]).toEqual(expect.any(String));
    expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);

    const err = await app.inject({ method: "GET", url: "/tasks" });
    expect(err.headers["x-request-id"]).toBe(err.json().requestId);
  });
});
