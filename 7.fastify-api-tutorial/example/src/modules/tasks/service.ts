import type {
  Store,
  TaskPatch,
  TaskRecord,
  UserRecord,
} from "../../data/memory-store.js";
import { AppError } from "../../errors/app-error.js";
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  type PageMeta,
} from "../../schemas/common.js";
import {
  DEFAULT_TASK_SORT,
  type CreateTaskBody,
  type ListTasksQuery,
  type UpdateTaskBody,
} from "../../schemas/task.js";

/**
 * 业务规则层。
 * schema 只能回答“数据长得对不对”（结构校验）；
 * 这里回答“数据在当前系统状态下是否允许”（业务规则），这类判断往往需要查数据库。
 * 它不依赖 Fastify 的 request/reply，可以单独测试，也可以被别的入口（队列、CLI）复用。
 */
export function createTaskService(db: Store) {
  function canRead(actor: UserRecord, task: TaskRecord): boolean {
    return (
      actor.role === "admin" ||
      task.ownerId === actor.id ||
      task.assigneeId === actor.id
    );
  }

  async function assertAssigneeExists(
    assigneeId: string | null | undefined,
  ): Promise<void> {
    if (!assigneeId) return;
    if (!(await db.users.findById(assigneeId))) {
      throw new AppError("ASSIGNEE_NOT_FOUND", {
        details: [
          {
            location: "body",
            field: "/assigneeId",
            rule: "exists",
            message: "用户不存在",
          },
        ],
      });
    }
  }

  async function assertTitleAvailable(
    ownerId: string,
    title: string,
    exceptTaskId?: string,
  ): Promise<void> {
    const existing = await db.tasks.findByOwnerAndTitle(ownerId, title);
    if (existing && existing.id !== exceptTaskId)
      throw new AppError("TASK_TITLE_CONFLICT");
  }

  return {
    async list(
      actor: UserRecord,
      query: ListTasksQuery,
    ): Promise<{ items: TaskRecord[]; page: PageMeta }> {
      // 运行时 Ajv 已经按 schema 的 default 补齐了这些值，这里的兜底只是为了让类型完整
      const page = query.page ?? DEFAULT_PAGE;
      const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
      const { items, total } = await db.tasks.list({
        ...(actor.role === "admin" ? {} : { visibleTo: actor.id }),
        ...(query.status ? { status: query.status } : {}),
        ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
        sort: query.sort ?? DEFAULT_TASK_SORT,
        page,
        pageSize,
      });
      return {
        items,
        page: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      };
    },

    /** 看不到的任务一律当作不存在（404），不用 403 暴露“这个 ID 存在” */
    async getVisible(actor: UserRecord, taskId: string): Promise<TaskRecord> {
      const task = await db.tasks.findById(taskId);
      if (!task || !canRead(actor, task)) throw new AppError("TASK_NOT_FOUND");
      return task;
    },

    /** 能看到但不是负责人/管理员：明确告诉调用方“没权限”（403） */
    assertCanWrite(actor: UserRecord, task: TaskRecord): void {
      if (actor.role !== "admin" && task.ownerId !== actor.id)
        throw new AppError("FORBIDDEN");
    },

    async create(actor: UserRecord, body: CreateTaskBody): Promise<TaskRecord> {
      await assertAssigneeExists(body.assigneeId);
      await assertTitleAvailable(actor.id, body.title);
      return db.tasks.insert({
        title: body.title,
        description: body.description ?? null,
        status: "todo",
        priority: body.priority ?? "medium",
        ownerId: actor.id,
        assigneeId: body.assigneeId ?? null,
        internalNote: "",
      });
    },

    async update(task: TaskRecord, patch: UpdateTaskBody): Promise<TaskRecord> {
      const changingOtherThanStatus = Object.keys(patch).some(
        (key) => key !== "status",
      );
      if (task.status === "done" && changingOtherThanStatus)
        throw new AppError("TASK_ALREADY_DONE");

      if (patch.title !== undefined)
        await assertTitleAvailable(task.ownerId, patch.title, task.id);
      await assertAssigneeExists(patch.assigneeId);

      const changes: TaskPatch = {};
      if (patch.title !== undefined) changes.title = patch.title;
      if (patch.description !== undefined)
        changes.description = patch.description;
      if (patch.status !== undefined) changes.status = patch.status;
      if (patch.priority !== undefined) changes.priority = patch.priority;
      if (patch.assigneeId !== undefined) changes.assigneeId = patch.assigneeId;
      // { ownerId: 'x' } 这样的请求能通过 minProperties，但未知字段随后被 Ajv 移除，
      // 最终没有任何可改的字段：原样返回，不产生新版本
      if (Object.keys(changes).length === 0) return task;
      return db.tasks.update(task.id, changes);
    },

    async remove(task: TaskRecord): Promise<void> {
      await db.tasks.delete(task.id);
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
