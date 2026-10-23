import { describe, expect, it } from "vitest";
import { SEED_IDS } from "../src/data/seed.js";
import { bearer, createTestApp } from "./helpers.js";

describe("任务 CRUD 与业务规则", () => {
  it("创建任务：返回 201、Location 头，且忽略客户端擅自传入的 ownerId/status", async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: bearer("alice"),
      payload: {
        title: "  写周报  ",
        priority: "high",
        ownerId: SEED_IDS.bob,
        status: "done",
      },
    });

    expect(response.statusCode).toBe(201);
    const task = response.json();
    expect(response.headers.location).toBe(`/v1/tasks/${task.id}`);
    expect(task).toMatchObject({
      title: "写周报", // preValidation 去掉了首尾空白
      priority: "high",
      status: "todo", // 客户端传的 status 被 additionalProperties: false 移除
      ownerId: SEED_IDS.alice, // ownerId 来自登录用户，而不是请求体
    });
  });

  it("响应 schema 会丢弃未声明的字段（internalNote、version 不会泄露）", async () => {
    const app = await createTestApp();
    const response = await app.inject({
      url: `/v1/tasks/${SEED_IDS.aliceTask}`,
      headers: bearer("alice"),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Object.keys(body).sort()).toEqual([
      "assigneeId",
      "createdAt",
      "description",
      "id",
      "ownerId",
      "priority",
      "status",
      "title",
      "updatedAt",
    ]);
    expect(body).not.toHaveProperty("internalNote");
    expect(response.headers.etag).toBe('"1"');
  });

  it("可为 null 的字段：null 保持为 null，不会被类型转换成空字符串", async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: bearer("alice"),
      payload: { title: "可空字段", description: null, assigneeId: null },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      description: null,
      assigneeId: null,
    });
  });

  it("/v1/me 返回的用户信息不包含 email 与 apiToken", async () => {
    const app = await createTestApp();
    const response = await app.inject({
      url: "/v1/me",
      headers: bearer("alice"),
    });
    expect(response.json()).toEqual({
      id: SEED_IDS.alice,
      name: "Alice",
      role: "member",
    });
  });

  it("看不到的任务返回 404，能看到但无权修改返回 403", async () => {
    const app = await createTestApp();

    // Alice 既不是 Bob 任务的负责人也不是被指派人：对她来说这个任务“不存在”
    const hidden = await app.inject({
      url: `/v1/tasks/${SEED_IDS.bobTask}`,
      headers: bearer("alice"),
    });
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json().code).toBe("TASK_NOT_FOUND");

    // 把 Alice 的任务指派给 Bob 后，Bob 能看到，但不能修改
    await app.inject({
      method: "PATCH",
      url: `/v1/tasks/${SEED_IDS.aliceTask}`,
      headers: bearer("alice"),
      payload: { assigneeId: SEED_IDS.bob },
    });
    const visible = await app.inject({
      url: `/v1/tasks/${SEED_IDS.aliceTask}`,
      headers: bearer("bob"),
    });
    expect(visible.statusCode).toBe(200);

    const forbidden = await app.inject({
      method: "PATCH",
      url: `/v1/tasks/${SEED_IDS.aliceTask}`,
      headers: bearer("bob"),
      payload: { title: "被 Bob 改掉" },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().code).toBe("FORBIDDEN");

    // 管理员可以修改任何任务
    const asAdmin = await app.inject({
      method: "PATCH",
      url: `/v1/tasks/${SEED_IDS.bobTask}`,
      headers: bearer("admin"),
      payload: { priority: "low" },
    });
    expect(asAdmin.statusCode).toBe(200);
  });

  it("业务规则：同名任务 409，指派人不存在 422（结构合法但查库后不成立）", async () => {
    const app = await createTestApp();

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: bearer("alice"),
      payload: { title: "准备周会材料" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("TASK_TITLE_CONFLICT");

    const ghostAssignee = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: bearer("alice"),
      payload: {
        title: "新任务",
        assigneeId: "00000000-0000-4000-8000-00000000ffff",
      },
    });
    expect(ghostAssignee.statusCode).toBe(422);
    expect(ghostAssignee.json()).toMatchObject({
      code: "ASSIGNEE_NOT_FOUND",
      details: [{ location: "body", field: "/assigneeId", rule: "exists" }],
    });
  });

  it("已完成的任务只能改状态（409），If-Match 不匹配时返回 412", async () => {
    const app = await createTestApp();
    const url = `/v1/tasks/${SEED_IDS.aliceTask}`;

    const done = await app.inject({
      method: "PATCH",
      url,
      headers: { ...bearer("alice"), "if-match": '"1"' },
      payload: { status: "done" },
    });
    expect(done.statusCode).toBe(200);
    expect(done.headers.etag).toBe('"2"');

    const stale = await app.inject({
      method: "PATCH",
      url,
      headers: { ...bearer("alice"), "if-match": '"1"' },
      payload: { status: "todo" },
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json().code).toBe("PRECONDITION_FAILED");

    const renameDone = await app.inject({
      method: "PATCH",
      url,
      headers: bearer("alice"),
      payload: { title: "改名" },
    });
    expect(renameDone.statusCode).toBe(409);
    expect(renameDone.json().code).toBe("TASK_ALREADY_DONE");

    const reopen = await app.inject({
      method: "PATCH",
      url,
      headers: { ...bearer("alice"), "if-match": '"2"' },
      payload: { status: "doing" },
    });
    expect(reopen.statusCode).toBe(200);
  });

  it("PATCH 只带未知字段：字段被移除后没有实际修改，版本号不变", async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/tasks/${SEED_IDS.aliceTask}`,
      headers: bearer("alice"),
      payload: { ownerId: SEED_IDS.bob },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"1"');
    expect(response.json().ownerId).toBe(SEED_IDS.alice);
  });

  it("删除任务返回 204 且没有响应体", async () => {
    const app = await createTestApp();
    const url = `/v1/tasks/${SEED_IDS.aliceTask}`;

    const removed = await app.inject({
      method: "DELETE",
      url,
      headers: bearer("alice"),
    });
    expect(removed.statusCode).toBe(204);
    expect(removed.body).toBe("");

    const after = await app.inject({ url, headers: bearer("alice") });
    expect(after.statusCode).toBe(404);
  });
});

describe("分页与排序契约", () => {
  async function appWithTasks(count: number) {
    const app = await createTestApp();
    for (let i = 1; i <= count; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/tasks",
        headers: bearer("alice"),
        payload: {
          title: `任务 ${String(i).padStart(2, "0")}`,
          priority: i % 2 === 0 ? "high" : "low",
        },
      });
      expect(response.statusCode).toBe(201);
    }
    return app;
  }

  it("默认第 1 页、每页 20 条，并返回 total/totalPages", async () => {
    const app = await appWithTasks(3);
    const response = await app.inject({
      url: "/v1/tasks",
      headers: bearer("alice"),
    });
    expect(response.json().page).toEqual({
      page: 1,
      pageSize: 20,
      total: 4,
      totalPages: 1,
    });
  });

  it("querystring 中的数字字符串会被转换成整数，翻页时不重复不遗漏", async () => {
    const app = await appWithTasks(5);
    const seen: string[] = [];
    for (const page of ["1", "2", "3"]) {
      const response = await app.inject({
        url: "/v1/tasks",
        query: { page, pageSize: "2", sort: "title" },
        headers: bearer("alice"),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.page.page).toBe(Number(page)); // 是数字，不是字符串
      seen.push(...body.items.map((task: { title: string }) => task.title));
    }
    expect(seen).toEqual([
      "任务 01",
      "任务 02",
      "任务 03",
      "任务 04",
      "任务 05",
      "准备周会材料",
    ]);
  });

  it("按优先级降序排序，并支持按状态筛选", async () => {
    const app = await appWithTasks(4);
    const response = await app.inject({
      url: "/v1/tasks?sort=-priority&status=todo",
      headers: bearer("alice"),
    });
    const priorities = response
      .json()
      .items.map((task: { priority: string }) => task.priority);
    expect(priorities).toEqual(["high", "high", "medium", "low", "low"]);
  });

  it("pageSize 超过上限、sort 不在白名单时返回 400", async () => {
    const app = await createTestApp();
    const tooLarge = await app.inject({
      url: "/v1/tasks?pageSize=500",
      headers: bearer("alice"),
    });
    expect(tooLarge.statusCode).toBe(400);
    expect(tooLarge.json().details[0]).toMatchObject({
      location: "querystring",
      field: "/pageSize",
      rule: "maximum",
    });

    const badSort = await app.inject({
      url: "/v1/tasks?sort=internalNote",
      headers: bearer("alice"),
    });
    expect(badSort.statusCode).toBe(400);
    expect(badSort.json().details[0]).toMatchObject({
      field: "/sort",
      rule: "enum",
    });
  });

  it("管理员能看到所有人的任务，普通成员只能看到自己相关的", async () => {
    const app = await createTestApp();
    const asAlice = await app.inject({
      url: "/v1/tasks",
      headers: bearer("alice"),
    });
    const asAdmin = await app.inject({
      url: "/v1/tasks",
      headers: bearer("admin"),
    });
    expect(asAlice.json().page.total).toBe(1);
    expect(asAdmin.json().page.total).toBe(2);
  });
});
