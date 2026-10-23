import { randomUUID } from "node:crypto";
import type {
  Task,
  TaskPriority,
  TaskSort,
  TaskStatus,
} from "../schemas/task.js";
import type { UserRole } from "../schemas/user.js";

/**
 * 这是“数据库”层：教程用内存实现，换成 Postgres/Drizzle 时只需保持这些方法签名。
 * 注意 Record 类型比对外的 schema 多出敏感/内部字段，正是为了演示 response schema 的过滤作用。
 */
export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** 教程为了简单直接保存明文 token；真实项目应只保存哈希，或改用 JWT / 会话 */
  apiToken: string;
}

export interface TaskRecord extends Task {
  /** 仅供内部运营查看的备注，绝不能出现在 API 响应里 */
  internalNote: string;
  /** 每次更新 +1，用来生成 ETag 做乐观并发控制 */
  version: number;
}

export interface SeedData {
  users: UserRecord[];
  tasks: TaskRecord[];
}

export interface ListTasksFilter {
  /** 只返回该用户拥有或被指派的任务；undefined 表示不限（管理员） */
  visibleTo?: string;
  status?: TaskStatus;
  assigneeId?: string;
  sort: TaskSort;
  page: number;
  pageSize: number;
}

export type TaskPatch = Partial<
  Pick<
    TaskRecord,
    "title" | "description" | "status" | "priority" | "assigneeId"
  >
>;

const priorityRank: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function compareTasks(sort: TaskSort) {
  const descending = sort.startsWith("-");
  const field = (descending ? sort.slice(1) : sort) as
    | "createdAt"
    | "priority"
    | "title";
  return (a: TaskRecord, b: TaskRecord): number => {
    let result: number;
    if (field === "priority")
      result = priorityRank[a.priority] - priorityRank[b.priority];
    else result = a[field].localeCompare(b[field]);
    if (descending) result = -result;
    // 主排序字段相同的时候按 id 排，保证翻页时顺序稳定、不会重复或漏数据
    return result !== 0 ? result : a.id.localeCompare(b.id);
  };
}

export function createMemoryStore(seed: SeedData) {
  // 复制一份，避免测试之间共享同一个可变对象
  const users = new Map(seed.users.map((user) => [user.id, { ...user }]));
  const tasks = new Map(seed.tasks.map((task) => [task.id, { ...task }]));

  return {
    users: {
      async findById(id: string): Promise<UserRecord | undefined> {
        return users.get(id);
      },
      async findByToken(token: string): Promise<UserRecord | undefined> {
        for (const user of users.values()) {
          if (user.apiToken === token) return user;
        }
        return undefined;
      },
    },

    tasks: {
      async list(
        filter: ListTasksFilter,
      ): Promise<{ items: TaskRecord[]; total: number }> {
        const matched = [...tasks.values()]
          .filter(
            (task) =>
              filter.visibleTo === undefined ||
              task.ownerId === filter.visibleTo ||
              task.assigneeId === filter.visibleTo,
          )
          .filter(
            (task) =>
              filter.status === undefined || task.status === filter.status,
          )
          .filter(
            (task) =>
              filter.assigneeId === undefined ||
              task.assigneeId === filter.assigneeId,
          )
          .sort(compareTasks(filter.sort));

        const offset = (filter.page - 1) * filter.pageSize;
        return {
          items: matched.slice(offset, offset + filter.pageSize),
          total: matched.length,
        };
      },

      async findById(id: string): Promise<TaskRecord | undefined> {
        return tasks.get(id);
      },

      async findByOwnerAndTitle(
        ownerId: string,
        title: string,
      ): Promise<TaskRecord | undefined> {
        for (const task of tasks.values()) {
          if (task.ownerId === ownerId && task.title === title) return task;
        }
        return undefined;
      },

      async insert(
        input: Omit<TaskRecord, "id" | "createdAt" | "updatedAt" | "version">,
      ): Promise<TaskRecord> {
        const now = new Date().toISOString();
        const record: TaskRecord = {
          ...input,
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
          version: 1,
        };
        tasks.set(record.id, record);
        return record;
      },

      async update(id: string, patch: TaskPatch): Promise<TaskRecord> {
        const current = tasks.get(id);
        if (!current) throw new Error(`task ${id} disappeared during update`);
        const next: TaskRecord = {
          ...current,
          ...patch,
          updatedAt: new Date().toISOString(),
          version: current.version + 1,
        };
        tasks.set(id, next);
        return next;
      },

      async delete(id: string): Promise<void> {
        tasks.delete(id);
      },
    },
  };
}

export type Store = ReturnType<typeof createMemoryStore>;
