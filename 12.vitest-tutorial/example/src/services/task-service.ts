import { z } from "zod";
import { generateTaskId } from "@/domain/id.js";
import { parsePagination } from "@/domain/pagination.js";
import {
  canCreateTask,
  canUpdateTask,
  type Actor,
} from "@/domain/permissions.js";
import { canTransition, type TaskStatus } from "@/domain/task-flow.js";
import { createTaskSchema } from "@/domain/task-schema.js";
import {
  InvalidTransitionError,
  PastDueDateError,
  PermissionDeniedError,
  TaskConflictError,
  TaskNotFoundError,
} from "@/services/errors.js";
import type {
  NotificationPort,
  TaskRecord,
  TaskRepository,
} from "@/services/ports.js";

export interface TaskServiceDeps {
  repo: TaskRepository;
  notifier: NotificationPort;
  /** 时间依赖注入：默认取真实时钟，测试传固定时间或配合 fake timers */
  clock?: () => Date;
}

export function createTaskService(deps: TaskServiceDeps) {
  const clock = deps.clock ?? (() => new Date());

  return {
    async createTask(actor: Actor, input: unknown): Promise<TaskRecord> {
      if (!canCreateTask(actor)) throw new PermissionDeniedError();

      const parsed = createTaskSchema.parse(input); // 失败抛 ZodError（API 层映射为 400）

      if (parsed.dueDate && parsed.dueDate.getTime() < clock().getTime()) {
        throw new PastDueDateError();
      }

      const title = parsed.title; // schema 已 trim
      if (await deps.repo.findByTitle(title)) {
        throw new TaskConflictError(`已存在同名任务：${title}`);
      }

      const task: TaskRecord = {
        id: generateTaskId(),
        title,
        status: "todo",
        dueDate: parsed.dueDate ?? null,
        ownerId: actor.id,
        assigneeId: parsed.assigneeId ?? null,
        createdAt: clock(),
      };
      await deps.repo.insert(task);
      await deps.notifier.taskCreated(task);
      return task;
    },

    async transitionStatus(
      actor: Actor,
      taskId: string,
      to: TaskStatus,
    ): Promise<TaskRecord> {
      const task = await deps.repo.findById(taskId);
      if (!task) throw new TaskNotFoundError(taskId);
      if (!canUpdateTask(actor, task)) throw new PermissionDeniedError();
      if (!canTransition(task.status, to)) {
        throw new InvalidTransitionError(task.status, to);
      }
      const updated = await deps.repo.updateStatus(taskId, to);
      await deps.notifier.taskTransitioned(updated, task.status, to);
      return updated;
    },

    async listTasks(
      actor: Actor,
      query: { page?: unknown; pageSize?: unknown; status?: unknown } = {},
    ) {
      // 教学项目：所有已登录用户可看列表；真实项目应过滤 workspace 可见性
      void actor;
      const pagination = parsePagination(query);
      const status =
        query.status === undefined || query.status === ""
          ? undefined
          : z
              .enum(["todo", "in_progress", "done", "archived"])
              .parse(query.status);
      const items = await deps.repo.findPage({
        offset: pagination.offset,
        limit: pagination.limit,
        ...(status ? { status } : {}),
      });
      const total = await deps.repo.count();
      return {
        items,
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
      };
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
