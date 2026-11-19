import type { Queryable } from "./db.js";

export interface Task {
  id: string;
  title: string;
  status: "todo" | "doing" | "done";
  createdAt: string;
}

export interface TaskRepository {
  list(): Promise<Task[]>;
  create(title: string): Promise<Task>;
  ping(): Promise<void>;
}

// 内存仓储：本地演练用。title 为 FAIL_DB 时模拟数据库故障（排障演练的故障注入）。
export function createMemoryRepository(): TaskRepository {
  const tasks: Task[] = [
    {
      id: "t-1",
      title: "阅读可观测性教程第 1 章",
      status: "todo",
      createdAt: new Date().toISOString(),
    },
  ];
  let seq = 1;
  return {
    async list() {
      return [...tasks];
    },
    async create(title) {
      if (title === "FAIL_DB") {
        throw new Error(
          "simulated database outage: connection terminated unexpectedly",
        );
      }
      const task: Task = {
        id: `t-${++seq}`,
        title,
        status: "todo",
        createdAt: new Date().toISOString(),
      };
      tasks.push(task);
      return task;
    },
    async ping() {},
  };
}

// 真实 Postgres 仓储：OTel 的 pg 自动插桩会为每次查询生成 client span。
export function createPgRepository(db: Queryable): TaskRepository {
  return {
    async list() {
      const { rows } = await db.query(
        "SELECT id, title, status, created_at FROM tasks ORDER BY created_at DESC LIMIT 100",
      );
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        createdAt: r.created_at,
      }));
    },
    async create(title) {
      const { rows } = await db.query(
        "INSERT INTO tasks (title) VALUES ($1) RETURNING id, title, status, created_at",
        [title],
      );
      const r = rows[0];
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        createdAt: r.created_at,
      };
    },
    async ping() {
      await db.query("SELECT 1");
    },
  };
}
