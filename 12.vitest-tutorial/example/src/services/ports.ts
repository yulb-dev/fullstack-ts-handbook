import type { TaskStatus } from "@/domain/task-flow.js";

/**
 * 端口（port）：service 只依赖这两个接口，不依赖 PGlite、Drizzle 或任何具体实现。
 * 单元测试注入内存实现或 vi.fn()，集成测试注入真实数据库实现——同一份业务逻辑，两种测法。
 */
export interface TaskRecord {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: Date | null;
  ownerId: string;
  assigneeId: string | null;
  createdAt: Date;
}

export interface TaskRepository {
  insert(task: TaskRecord): Promise<void>;
  findById(id: string): Promise<TaskRecord | null>;
  updateStatus(id: string, status: TaskStatus): Promise<TaskRecord>;
  findByTitle(title: string): Promise<TaskRecord | null>;
  findPage(options: {
    offset: number;
    limit: number;
    status?: TaskStatus;
  }): Promise<TaskRecord[]>;
  count(): Promise<number>;
}

export interface NotificationPort {
  taskCreated(task: TaskRecord): Promise<void>;
  taskTransitioned(
    task: TaskRecord,
    from: TaskStatus,
    to: TaskStatus,
  ): Promise<void>;
}
