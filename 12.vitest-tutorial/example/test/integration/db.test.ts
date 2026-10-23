import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { tasks } from "@/db/schema.js";
import { createDbTaskRepository } from "@/db/task-repository.js";
import { TaskConflictError, TaskNotFoundError } from "@/services/errors.js";
import type { TaskRecord } from "@/services/ports.js";
import { createTestDb } from "./db-helper.js";

/**
 * 数据库集成测试：真实 Postgres 语义（PGlite 是编译成 WASM 的 Postgres）。
 * - 表结构来自与生产完全相同的迁移文件
 * - 每个测试文件自建一个全新内存库（顶层 await），文件间天然隔离
 * - 文件内部由 beforeEach 清表保证测试间隔离
 * - 这里验证的是「mock 永远验证不了」的东西：唯一约束、事务回滚、类型往返
 */

const { db, close } = await createTestDb();
const repo = createDbTaskRepository(db);

afterAll(async () => {
  await close(); // 不关库，测试进程可能挂住不退
});

const BASE: TaskRecord = {
  id: "task_1",
  title: "数据库集成测试任务",
  status: "todo",
  dueDate: null,
  ownerId: "u1",
  assigneeId: null,
  createdAt: new Date("2026-03-10T12:00:00Z"),
};

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return { ...BASE, ...overrides };
}

beforeEach(async () => {
  // 数据隔离：不依赖测试执行顺序，每个测试从空表开始
  await db.delete(tasks);
});

describe("迁移与基础读写", () => {
  it("迁移建出的 tasks 表初始为空", async () => {
    const rows = await db.select().from(tasks);
    expect(rows).toEqual([]);
  });

  it("insert → findById 往返：Date 字段仍是 Date，不是字符串", async () => {
    const task = makeTask({ dueDate: new Date("2026-04-01T00:00:00Z") });
    await repo.insert(task);

    const found = await repo.findById(task.id);
    expect(found).toEqual(task);
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.dueDate).toBeInstanceOf(Date);
  });

  it("findById 未命中返回 null 而不是抛错", async () => {
    expect(await repo.findById("task_missing")).toBeNull();
  });

  it("updateStatus 返回更新后的行；目标不存在时抛 TaskNotFoundError", async () => {
    await repo.insert(makeTask());

    const updated = await repo.updateStatus("task_1", "in_progress");
    expect(updated.status).toBe("in_progress");

    await expect(repo.updateStatus("task_missing", "done")).rejects.toThrow(
      TaskNotFoundError,
    );
  });
});

describe("唯一约束：mock 数据库测不到的真实行为", () => {
  it("重复标题触发 23505，仓储把它翻译成 TaskConflictError", async () => {
    await repo.insert(makeTask({ id: "task_1", title: "唯一标题" }));

    await expect(
      repo.insert(makeTask({ id: "task_2", title: "唯一标题" })),
    ).rejects.toThrow(TaskConflictError);
  });

  it("并发插入同名任务：恰好一条存活（数据库兜底，而不是先查后插）", async () => {
    const results = await Promise.allSettled([
      repo.insert(makeTask({ id: "task_a", title: "并发同名" })),
      repo.insert(makeTask({ id: "task_b", title: "并发同名" })),
    ]);

    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.title, "并发同名"));
    expect(rows[0]?.n).toBe(1);
  });
});

describe("分页与过滤下推到 SQL", () => {
  it("findPage 按 createdAt 倒序、offset/limit 生效、status 过滤生效", async () => {
    for (let i = 0; i < 5; i++) {
      await repo.insert(
        makeTask({
          id: `task_${i}`,
          title: `任务 ${i}`,
          status: i % 2 === 0 ? "todo" : "in_progress",
          createdAt: new Date(BASE.createdAt.getTime() + i * 60_000),
        }),
      );
    }

    const page2 = await repo.findPage({ offset: 2, limit: 2 });
    expect(page2.map((t) => t.id)).toEqual(["task_2", "task_1"]); // 新 → 旧

    const todoOnly = await repo.findPage({
      offset: 0,
      limit: 10,
      status: "todo",
    });
    expect(todoOnly.map((t) => t.id)).toEqual(["task_4", "task_2", "task_0"]);

    expect(await repo.count()).toBe(5);
  });
});

describe("事务：要么全部生效，要么全部回滚", () => {
  it("事务内两条插入同时可见，提交后落库", async () => {
    await db.transaction(async (tx) => {
      await tx
        .insert(tasks)
        .values(makeTask({ id: "tx_1", title: "事务任务 1" }));
      await tx
        .insert(tasks)
        .values(makeTask({ id: "tx_2", title: "事务任务 2" }));
    });

    const rows = await db.select({ id: tasks.id }).from(tasks);
    expect(rows.map((r) => r.id).sort()).toEqual(["tx_1", "tx_2"]);
  });

  it("事务中途抛错 → 已插入的行也消失（回滚）", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx
          .insert(tasks)
          .values(makeTask({ id: "tx_a", title: "会回滚的任务" }));
        throw new Error("模拟事务中途失败");
      }),
    ).rejects.toThrow("模拟事务中途失败");

    const rows = await db.select().from(tasks);
    expect(rows).toEqual([]); // tx_a 没有留在库里
  });

  it("业务模式：创建任务 + 写审计在同一事务里，失败不留半截数据", async () => {
    // 真实项目常有「多表一致写入」需求；这里用同表两条记录模拟多表
    await expect(
      db.transaction(async (tx) => {
        await tx
          .insert(tasks)
          .values(makeTask({ id: "biz_1", title: "主记录" }));
        // 第二条违反唯一约束 → 整个事务回滚，主记录也不能留下
        await tx
          .insert(tasks)
          .values(makeTask({ id: "biz_2", title: "主记录" }));
      }),
    ).rejects.toThrow();

    expect(await repo.findById("biz_1")).toBeNull();
  });
});
