import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { Actor } from "@/domain/permissions.js";
import {
  InvalidTransitionError,
  PastDueDateError,
  PermissionDeniedError,
  TaskConflictError,
  TaskNotFoundError,
} from "@/services/errors.js";
import {
  createInMemoryTaskRepository,
  createNotificationCollector,
} from "@/services/in-memory-task-repository.js";
import type {
  NotificationPort,
  TaskRecord,
  TaskRepository,
} from "@/services/ports.js";
import { createTaskService } from "@/services/task-service.js";

/**
 * vi.mock 替换 ID 生成模块：让每个新任务拿到确定性的 ID。
 * 调用会被提升到文件顶部、先于所有 import 执行——所以它必须写在顶层（Vitest 5 强制）。
 * 这是「mock 模块依赖」的示例；repo 与 notifier 则用真实的手写测试替身（第 6 章讲取舍）。
 */
vi.mock("@/domain/id.js", () => {
  let n = 0;
  return { generateTaskId: () => `task_test_${++n}` };
});

const FIXED_NOW = new Date("2026-03-10T12:00:00Z");
const member: Actor = { id: "u1", role: "member" };
const stranger: Actor = { id: "u9", role: "member" };
const manager: Actor = { id: "m1", role: "manager" };

function makeService(
  overrides: { repo?: TaskRepository; notifier?: NotificationPort } = {},
) {
  const defaultNotifier = createNotificationCollector();
  const repo = overrides.repo ?? createInMemoryTaskRepository();
  const notifier = overrides.notifier ?? defaultNotifier;
  const service = createTaskService({ repo, notifier, clock: () => FIXED_NOW });
  // events 只在默认 collector 上存在；显式注入替身时用 vi.fn 断言交互
  const events = overrides.notifier
    ? ([] as Array<{
        type: string;
        taskId: string;
        from?: unknown;
        to?: unknown;
      }>)
    : defaultNotifier.events;
  return { service, repo, notifier, events };
}

describe("createTaskService.createTask", () => {
  it("成功路径：写入仓储、发出通知、返回完整记录（AAA 三段清晰）", async () => {
    // Arrange
    const { service, repo, events } = makeService();

    // Act
    const task = await service.createTask(member, {
      title: "  发布 v2  ",
      dueDate: "2026-04-01",
    });

    // Assert：返回值、副作用、持久化状态各验一处
    expect(task).toEqual({
      id: expect.stringMatching(/^task_test_\d+$/),
      title: "发布 v2", // schema 负责 trim
      status: "todo",
      dueDate: new Date("2026-04-01T00:00:00.000Z"),
      ownerId: "u1",
      assigneeId: null,
      createdAt: FIXED_NOW, // 注入的 clock，而不是真实时间
    });
    expect(await repo.findById(task.id)).toEqual(task);
    expect(events).toEqual([{ type: "created", taskId: task.id }]);
  });

  it("空标题抛 ZodError，且不产生任何副作用", async () => {
    const { service, repo, events } = makeService();

    await expect(service.createTask(member, { title: "   " })).rejects.toThrow(
      ZodError,
    );
    expect(await repo.count()).toBe(0);
    expect(events).toHaveLength(0);
  });

  it("截止日期在过去 → PastDueDateError（时间规则走注入的 clock）", async () => {
    const { service } = makeService();
    await expect(
      service.createTask(member, { title: "过期任务", dueDate: "2026-03-09" }),
    ).rejects.toThrow(PastDueDateError);
  });

  it("截止日期恰好等于 now 不算过去（>= 边界）", async () => {
    const { service } = makeService();
    await expect(
      service.createTask(member, {
        title: "此刻到期",
        dueDate: FIXED_NOW.toISOString(),
      }),
    ).resolves.toMatchObject({ title: "此刻到期" });
  });

  it("同名任务 → TaskConflictError，错误消息里带标题", async () => {
    const { service } = makeService();
    await service.createTask(member, { title: "重复标题" });

    await expect(
      service.createTask(member, { title: "重复标题" }),
    ).rejects.toThrow(TaskConflictError);
    await expect(
      service.createTask(member, { title: "重复标题" }),
    ).rejects.toThrow("已存在同名任务：重复标题");
  });

  it("并发创建同名任务：findByTitle 都看不到对方，唯一约束兜底（模拟竞态）", async () => {
    // 两个「同时」进来的请求：service 的查重都通过，insert 阶段由仓储的唯一约束拒绝一个。
    // 内存仓储的 insert 模拟了数据库行为；第 10 章用真 PGlite 再验证一次。
    const { service } = makeService();
    const results = await Promise.allSettled([
      service.createTask(member, { title: "抢购券" }),
      service.createTask(stranger, { title: "抢购券" }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});

describe("createTaskService.transitionStatus", () => {
  async function seedTask(actor: Actor = member) {
    const ctx = makeService();
    const task = await ctx.service.createTask(actor, { title: "待迁移任务" });
    return { ...ctx, task };
  }

  it("owner 可以推进自己的任务，并发出 transitioned 通知", async () => {
    const { service, events, task } = await seedTask();

    const updated = await service.transitionStatus(
      member,
      task.id,
      "in_progress",
    );

    expect(updated.status).toBe("in_progress");
    expect(events).toContainEqual({
      type: "transitioned",
      taskId: task.id,
      from: "todo",
      to: "in_progress",
    });
  });

  it("无关 member 越权 → PermissionDeniedError，状态保持不变", async () => {
    const { service, repo, task } = await seedTask();

    await expect(
      service.transitionStatus(stranger, task.id, "done"),
    ).rejects.toThrow(PermissionDeniedError);
    expect((await repo.findById(task.id))?.status).toBe("todo");
  });

  it("manager 可以迁移任何人的任务", async () => {
    const { service, task } = await seedTask();
    await expect(
      service.transitionStatus(manager, task.id, "in_progress"),
    ).resolves.toMatchObject({
      status: "in_progress",
    });
  });

  it("非法迁移 todo → done → InvalidTransitionError", async () => {
    const { service, task } = await seedTask();
    await expect(
      service.transitionStatus(member, task.id, "done"),
    ).rejects.toThrow(InvalidTransitionError);
    await expect(
      service.transitionStatus(member, task.id, "done"),
    ).rejects.toThrow("不允许从 todo 迁移到 done");
  });

  it("任务不存在 → TaskNotFoundError，消息里带 ID", async () => {
    const { service } = makeService();
    await expect(
      service.transitionStatus(member, "task_missing", "done"),
    ).rejects.toThrow(TaskNotFoundError);
    await expect(
      service.transitionStatus(member, "task_missing", "done"),
    ).rejects.toThrow("任务不存在：task_missing");
  });
});

describe("createTaskService.listTasks", () => {
  it("分页参数透传给仓储，返回 items/page/pageSize/total", async () => {
    const seed: TaskRecord[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      title: `任务 ${i}`,
      status: "todo" as const,
      dueDate: null,
      ownerId: "u1",
      assigneeId: null,
      createdAt: new Date(FIXED_NOW.getTime() - i * 1000),
    }));
    const repo = createInMemoryTaskRepository(seed);
    const findPage = vi.spyOn(repo, "findPage");
    const { service } = makeService({ repo });

    const result = await service.listTasks(member, {
      page: "2",
      pageSize: "2",
    });

    expect(result).toMatchObject({ page: 2, pageSize: 2, total: 5 });
    expect(result.items).toHaveLength(2);
    // spyOn 观察真实实现：既验证行为，也验证「传给仓储的参数」
    expect(findPage).toHaveBeenCalledWith({ offset: 2, limit: 2 });
  });

  it("非法分页参数 → ZodError（400 的来源）", async () => {
    const { service } = makeService();
    await expect(service.listTasks(member, { page: "0" })).rejects.toThrow(
      ZodError,
    );
  });
});

describe("用 vi.fn() 当替身：验证交互而不是结果", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifier.taskCreated 恰好被调用一次，参数是完整任务", async () => {
    const taskCreated = vi.fn(async (_task: TaskRecord) => {});
    const notifier: NotificationPort = {
      taskCreated,
      taskTransitioned: vi.fn(async () => {}),
    };
    const { service } = makeService({ notifier });

    const task = await service.createTask(member, { title: "通知测试" });

    expect(taskCreated).toHaveBeenCalledTimes(1);
    expect(taskCreated).toHaveBeenCalledWith(
      expect.objectContaining({ title: "通知测试" }),
    );
    expect(taskCreated.mock.calls[0]?.[0]?.id).toBe(task.id);
  });

  it("Vitest 5 默认 clearMocks：上一个测试的调用记录不会带进这一个", async () => {
    // 本文件顶部没有手动 vi.clearAllMocks()——v5 在每个测试前自动清除调用历史。
    // 如果这里看到「toHaveBeenCalledTimes(2)」通过了，说明 mock 状态泄漏了。
    const taskCreated = vi.fn(async (_task: TaskRecord) => {});
    const { service } = makeService({
      notifier: { taskCreated, taskTransitioned: vi.fn() },
    });

    await service.createTask(member, { title: "第一个" });
    expect(taskCreated).toHaveBeenCalledTimes(1);

    await service.createTask(member, { title: "第二个" });
    // 只有本测试的第二次调用被计入？不对——clearMocks 在每个测试「开始前」清一次，
    // 测试内部的两次调用都保留，所以这里是 2。泄漏指的是跨测试累计（v4 会是 3）。
    expect(taskCreated).toHaveBeenCalledTimes(2);
  });

  it("clock 也可以整个用 fake timers 代替注入：两条路殊途同归", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    const repo = createInMemoryTaskRepository();
    // 不传 clock —— service 默认用 () => new Date()，此时读到的是假时钟
    const service = createTaskService({
      repo,
      notifier: createNotificationCollector(),
    });

    const task = await service.createTask(member, { title: "假时钟任务" });
    expect(task.createdAt).toEqual(FIXED_NOW);

    vi.advanceTimersByTime(60_000);
    const later = await service.createTask(member, { title: "一分钟后的任务" });
    expect(later.createdAt.getTime() - task.createdAt.getTime()).toBe(60_000);
  });
});
