import type { TaskStatus } from "@/domain/task-flow.js";
import type {
  NotificationPort,
  TaskRecord,
  TaskRepository,
} from "@/services/ports.js";

/**
 * 内存仓储：给单元测试与快速 API 测试使用。
 * 每次调用 createInMemoryTaskRepository() 都是全新实例——测试隔离靠「新建」，
 * 不靠共享单例 + 手动清空。
 */
export function createInMemoryTaskRepository(
  seed: TaskRecord[] = [],
): TaskRepository {
  const tasks = new Map<string, TaskRecord>(seed.map((t) => [t.id, { ...t }]));

  return {
    async insert(task) {
      if (tasks.has(task.id)) throw new Error(`duplicate id: ${task.id}`);
      for (const existing of tasks.values()) {
        if (existing.title === task.title) {
          // 模拟数据库唯一约束：并发 insert 时同样会命中
          throw new Error(`unique violation: title "${task.title}"`);
        }
      }
      tasks.set(task.id, { ...task });
    },
    async findById(id) {
      const found = tasks.get(id);
      return found ? { ...found } : null;
    },
    async updateStatus(id, status: TaskStatus) {
      const found = tasks.get(id);
      if (!found) throw new Error(`not found: ${id}`);
      const updated = { ...found, status };
      tasks.set(id, updated);
      return { ...updated };
    },
    async findByTitle(title) {
      for (const task of tasks.values()) {
        if (task.title === title) return { ...task };
      }
      return null;
    },
    async findPage({ offset, limit, status }) {
      const all = [...tasks.values()]
        .filter((t) => (status ? t.status === status : true))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return all.slice(offset, offset + limit).map((t) => ({ ...t }));
    },
    async count() {
      return tasks.size;
    },
  };
}

/** 通知端口的测试替身：记录每次调用，供断言「副作用发生了、且只发生一次」 */
export function createNotificationCollector(): NotificationPort & {
  events: Array<
    | { type: "created"; taskId: string }
    | { type: "transitioned"; taskId: string; from: TaskStatus; to: TaskStatus }
  >;
} {
  const events: Array<
    | { type: "created"; taskId: string }
    | { type: "transitioned"; taskId: string; from: TaskStatus; to: TaskStatus }
  > = [];
  return {
    events,
    async taskCreated(task) {
      events.push({ type: "created", taskId: task.id });
    },
    async taskTransitioned(task, from, to) {
      events.push({ type: "transitioned", taskId: task.id, from, to });
    },
  };
}
