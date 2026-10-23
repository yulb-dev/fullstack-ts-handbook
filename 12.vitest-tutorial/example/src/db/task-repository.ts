import { asc, desc, eq, sql } from "drizzle-orm";
import { tasks } from "@/db/schema.js";
import type { Db } from "@/db/client.js";
import type { TaskStatus } from "@/domain/task-flow.js";
import { TaskConflictError, TaskNotFoundError } from "@/services/errors.js";
import type { TaskRecord, TaskRepository } from "@/services/ports.js";

/** 数据库错误 → 业务错误的翻译只发生在这一层，service 不感知 Postgres 细节。
 * 注意：Drizzle 1.0 RC 会把驱动错误包成 DrizzleQueryError，
 * Postgres 的 23505 在 error.cause 上，所以要沿 cause 链找 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 5 && current !== null && typeof current === "object";
    depth++
  ) {
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function toRecord(row: typeof tasks.$inferSelect): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    status: row.status as TaskStatus,
    dueDate: row.dueDate,
    ownerId: row.ownerId,
    assigneeId: row.assigneeId,
    createdAt: row.createdAt,
  };
}

/** TaskRepository 的 Drizzle + PGlite 实现：集成测试与本地 API 都使用它 */
export function createDbTaskRepository(db: Db): TaskRepository {
  return {
    async insert(task) {
      try {
        await db.insert(tasks).values({
          id: task.id,
          title: task.title,
          status: task.status,
          dueDate: task.dueDate,
          ownerId: task.ownerId,
          assigneeId: task.assigneeId,
          createdAt: task.createdAt,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new TaskConflictError(`已存在同名任务：${task.title}`);
        }
        throw error;
      }
    },
    async findById(id) {
      const rows = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, id))
        .limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    },
    async updateStatus(id, status) {
      const rows = await db
        .update(tasks)
        .set({ status })
        .where(eq(tasks.id, id))
        .returning();
      const row = rows[0];
      if (!row) throw new TaskNotFoundError(id);
      return toRecord(row);
    },
    async findByTitle(title) {
      const rows = await db
        .select()
        .from(tasks)
        .where(eq(tasks.title, title))
        .limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    },
    async findPage({ offset, limit, status }) {
      const where = status ? eq(tasks.status, status) : undefined;
      const rows = await db
        .select()
        .from(tasks)
        .where(where)
        .orderBy(desc(tasks.createdAt), asc(tasks.id))
        .limit(limit)
        .offset(offset);
      return rows.map(toRecord);
    },
    async count() {
      const rows = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(tasks);
      return rows[0]?.value ?? 0;
    },
  };
}
