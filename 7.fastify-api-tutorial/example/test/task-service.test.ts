import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/data/memory-store.js";
import { createSeedData, SEED_IDS } from "../src/data/seed.js";
import { AppError } from "../src/errors/app-error.js";
import { createTaskService } from "../src/modules/tasks/service.js";

/**
 * 业务规则不依赖 Fastify，可以不经过 HTTP 直接测试。
 * HTTP 层（状态码、响应形状）的测试见 tasks.test.ts。
 */
describe("TaskService 业务规则", () => {
  function setup() {
    const seed = createSeedData();
    const db = createMemoryStore(seed);
    const service = createTaskService(db);
    const [alice, bob, admin] = seed.users;
    if (!alice || !bob || !admin) throw new Error("seed users missing");
    return { db, service, alice, bob, admin };
  }

  it("同一个人不能创建同名任务，不同的人可以", async () => {
    const { service, alice, bob } = setup();
    await expect(
      service.create(alice, { title: "准备周会材料" }),
    ).rejects.toMatchObject({ code: "TASK_TITLE_CONFLICT" });
    await expect(
      service.create(bob, { title: "准备周会材料" }),
    ).resolves.toMatchObject({ ownerId: bob.id });
  });

  it("指派给不存在的用户时抛出带 details 的 AppError", async () => {
    const { service, alice } = setup();
    const error = await service
      .create(alice, {
        title: "x",
        assigneeId: "00000000-0000-4000-8000-00000000ffff",
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "ASSIGNEE_NOT_FOUND",
      statusCode: 422,
    });
  });

  it("看不到的任务等同于不存在；能看到不等于能修改", async () => {
    const { service, alice, bob, admin } = setup();
    await expect(
      service.getVisible(alice, SEED_IDS.bobTask),
    ).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });

    const bobTask = await service.getVisible(admin, SEED_IDS.bobTask);
    expect(() => service.assertCanWrite(alice, bobTask)).toThrow(AppError);
    expect(() => service.assertCanWrite(bob, bobTask)).not.toThrow();
    expect(() => service.assertCanWrite(admin, bobTask)).not.toThrow();
  });

  it("done 状态的任务只能改 status", async () => {
    const { service, alice } = setup();
    const task = await service.getVisible(alice, SEED_IDS.aliceTask);
    const done = await service.update(task, { status: "done" });

    await expect(
      service.update(done, { title: "新标题" }),
    ).rejects.toMatchObject({ code: "TASK_ALREADY_DONE" });
    await expect(
      service.update(done, { status: "doing" }),
    ).resolves.toMatchObject({ status: "doing" });
  });

  it("空修改不产生新版本", async () => {
    const { service, alice } = setup();
    const task = await service.getVisible(alice, SEED_IDS.aliceTask);
    const result = await service.update(task, {});
    expect(result.version).toBe(task.version);
  });
});
