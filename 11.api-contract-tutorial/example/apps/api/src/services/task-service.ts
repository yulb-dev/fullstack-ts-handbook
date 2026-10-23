import { createHash } from "node:crypto";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type {
  CreateTaskBody,
  Task,
  TaskPage,
  UpdateTaskBody,
} from "../contract/tasks";
import { isUniqueViolation } from "../db/errors";
import { idempotencyKeys, projectMembers, tasks } from "../db/schema";
import type { Db } from "../db/types";
import { AppError, fieldConflict, forbidden, notFound } from "../domain/errors";
import { assertCanRead, assertCanWrite } from "./access";

const OPEN_TITLE_UQ = "tasks_project_open_title_uq";

type TaskRow = typeof tasks.$inferSelect;

/**
 * 数据库行 → 契约 DTO。显式列出每个字段：
 * 新增数据库列不会「顺手」泄露到 API；Date 在这里统一转成 UTC ISO 字符串。
 */
export function toTaskDto(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    createdBy: row.createdBy,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ───────────── 列表：游标分页（第 12 章） ─────────────

interface Cursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.createdAt, c.id])).toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  const invalid = () =>
    new AppError(400, "VALIDATION_FAILED", "分页游标无效，请从第一页重新加载", {
      fields: [
        { in: "query", path: "cursor", rule: "format", message: "游标无效" },
      ],
    });
  try {
    const value: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      !Number.isNaN(Date.parse(value[0])) &&
      typeof value[1] === "string" &&
      /^[0-9a-f-]{36}$/i.test(value[1])
    ) {
      return { createdAt: value[0], id: value[1] };
    }
  } catch {
    // 落到下面统一报错
  }
  throw invalid();
}

export async function listTasks(
  db: Db,
  userId: string,
  projectId: string,
  query: { limit?: number; cursor?: string; status?: Task["status"] },
): Promise<TaskPage> {
  await assertCanRead(db, projectId, userId);
  const limit = query.limit ?? 20;

  const conditions: SQL[] = [eq(tasks.projectId, projectId)];
  if (query.status) conditions.push(eq(tasks.status, query.status));
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    // 行值比较 (a, b) < (x, y)：与 ORDER BY created_at DESC, id DESC 严格对应
    conditions.push(
      sql`(${tasks.createdAt}, ${tasks.id}) < (${c.createdAt}::timestamptz, ${c.id}::uuid)`,
    );
  }

  // 多取一条，用来判断「还有没有下一页」，不需要额外 count(*)
  const rows = await db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(desc(tasks.createdAt), desc(tasks.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toTaskDto),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}

// ───────────── 创建：幂等键（第 11 章） ─────────────

/** 键顺序无关的稳定 JSON，用来给请求体算指纹 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface CreateResult {
  task: Task;
  replayed: boolean;
}

export async function createTask(
  db: Db,
  userId: string,
  projectId: string,
  input: CreateTaskBody,
  idempotencyKey: string,
): Promise<CreateResult> {
  await assertCanWrite(db, projectId, userId);

  const scope = `createTask:${projectId}`;
  const requestHash = createHash("sha256")
    .update(stableStringify(input))
    .digest("hex");

  try {
    return await db.transaction(async (tx) => {
      // ① 先「占」幂等键。并发的同键请求会在这条 INSERT 上等待第一笔事务结束
      const [claimed] = await tx
        .insert(idempotencyKeys)
        .values({
          userId,
          key: idempotencyKey,
          scope,
          requestHash,
          responseStatus: 0,
          responseBody: {},
        })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key });

      if (!claimed) {
        // ② 键已被使用：同内容 → 重放第一次的结果；不同内容 → 拒绝
        const [existing] = await tx
          .select()
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.userId, userId),
              eq(idempotencyKeys.key, idempotencyKey),
            ),
          );
        if (!existing) throw new Error("幂等键冲突但读取不到记录");
        if (existing.scope !== scope || existing.requestHash !== requestHash) {
          throw new AppError(
            422,
            "IDEMPOTENCY_KEY_REUSED",
            "这个提交编号已用于另一份内容，请刷新页面后重新提交",
            { logContext: { idempotencyKey } },
          );
        }
        return { task: existing.responseBody as Task, replayed: true };
      }

      // ③ 真正创建。服务端决定 status / createdBy / version，客户端无权指定
      const [row] = await tx
        .insert(tasks)
        .values({
          projectId,
          title: input.title.trim(),
          description: input.description ?? null,
          priority: input.priority ?? "medium",
          dueDate: input.dueDate ?? null,
          createdBy: userId,
        })
        .returning();
      if (!row) throw new Error("插入任务后没有返回行");
      const task = toTaskDto(row);

      // ④ 把响应和键存在同一事务里：要么都成功，要么都回滚
      await tx
        .update(idempotencyKeys)
        .set({ responseStatus: 201, responseBody: task })
        .where(
          and(
            eq(idempotencyKeys.userId, userId),
            eq(idempotencyKeys.key, idempotencyKey),
          ),
        );
      return { task, replayed: false };
    });
  } catch (err) {
    if (isUniqueViolation(err, OPEN_TITLE_UQ)) {
      throw fieldConflict("title", "该项目中已有同名的未完成任务");
    }
    throw err;
  }
}

// ───────────── 读取与更新：乐观并发（第 11 章） ─────────────

/** 按任务 ID 读取，同时拿到当前用户在该项目里的角色；不是成员就当作不存在 */
async function loadTaskWithRole(db: Db, userId: string, taskId: string) {
  const [row] = await db
    .select({ task: tasks, role: projectMembers.role })
    .from(tasks)
    .innerJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, tasks.projectId),
        eq(projectMembers.userId, userId),
      ),
    )
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!row) throw notFound("任务");
  return row;
}

export async function getTask(db: Db, userId: string, taskId: string) {
  const { task } = await loadTaskWithRole(db, userId, taskId);
  return toTaskDto(task);
}

export async function updateTask(
  db: Db,
  userId: string,
  taskId: string,
  patch: UpdateTaskBody,
  ifMatch: string | undefined,
): Promise<Task> {
  // 先授权、再检查前置条件：对看不见这个任务的人，任何请求都应该是 404
  const { task, role } = await loadTaskWithRole(db, userId, taskId);
  if (role === "viewer") throw forbidden("只读成员不能创建或修改任务");

  if (!ifMatch) {
    throw new AppError(
      428,
      "PRECONDITION_REQUIRED",
      "缺少版本信息，请刷新后重试",
    );
  }
  const expectedVersion = Number(ifMatch.slice(1, -1));

  try {
    // 条件更新：版本号匹配才写入，判断与修改在同一条 SQL 里，没有竞态窗口
    const [row] = await db
      .update(tasks)
      .set({
        ...patch,
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        version: sql`${tasks.version} + 1`,
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.version, expectedVersion)))
      .returning();
    if (!row) {
      throw new AppError(
        412,
        "PRECONDITION_FAILED",
        "任务已被其他人修改，请查看最新内容后再保存",
        {
          headers: { etag: `"${task.version}"` },
          logContext: { expectedVersion, currentVersion: task.version },
        },
      );
    }
    return toTaskDto(row);
  } catch (err) {
    if (isUniqueViolation(err, OPEN_TITLE_UQ)) {
      throw fieldConflict("title", "该项目中已有同名的未完成任务");
    }
    throw err;
  }
}
