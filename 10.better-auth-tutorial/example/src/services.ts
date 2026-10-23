import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/types.js";
import { memberships, tasks, user, workspaces } from "./db/schema.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
const notFound = () => new HttpError(404, "NOT_FOUND");
const forbidden = () => new HttpError(403, "FORBIDDEN");
export const roleSchema = z.enum(["owner", "admin", "editor", "viewer"]);
export type Role = z.infer<typeof roleSchema>;

export function canEditTask(
  role: string,
  actorId: string,
  createdBy: string,
): boolean {
  if (role === "owner" || role === "admin") return true;
  if (role === "editor") return actorId === createdBy;
  return false;
}

async function requireMember(
  db: Db,
  actorId: string,
  workspaceId: string,
  lock = false,
) {
  const query = db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, actorId),
        eq(memberships.workspaceId, workspaceId),
      ),
    );
  const [member] = await (lock ? query.for("share") : query);
  if (!member) throw notFound();
  const role = roleSchema.safeParse(member.role);
  if (!role.success) throw forbidden();
  return role.data;
}

export function services(db: Db) {
  return {
    async listWorkspaces(actorId: string) {
      return db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          role: memberships.role,
        })
        .from(workspaces)
        .innerJoin(memberships, eq(workspaces.id, memberships.workspaceId))
        .where(eq(memberships.userId, actorId))
        .orderBy(desc(workspaces.createdAt), desc(workspaces.id))
        .limit(50);
    },
    async createWorkspace(actorId: string, name: string) {
      return db.transaction(async (tx) => {
        const [workspace] = await tx
          .insert(workspaces)
          .values({ name })
          .returning();
        if (!workspace) throw new Error("workspace 写入失败");
        await tx
          .insert(memberships)
          .values({
            workspaceId: workspace.id,
            userId: actorId,
            role: "owner",
          });
        return workspace;
      });
    },
    async listTasks(actorId: string, workspaceId: string) {
      await requireMember(db, actorId, workspaceId);
      // JOIN 再次限制当前成员关系，避免检查之后成员被删除仍返回数据。
      return db
        .select({
          id: tasks.id,
          title: tasks.title,
          done: tasks.done,
          createdBy: tasks.createdBy,
        })
        .from(tasks)
        .innerJoin(
          memberships,
          and(
            eq(memberships.workspaceId, tasks.workspaceId),
            eq(memberships.userId, actorId),
          ),
        )
        .where(eq(tasks.workspaceId, workspaceId))
        .orderBy(desc(tasks.createdAt), desc(tasks.id))
        .limit(50);
    },
    async createTask(actorId: string, workspaceId: string, title: string) {
      return db.transaction(async (tx) => {
        const role = await requireMember(tx, actorId, workspaceId, true);
        if (!["owner", "admin", "editor"].includes(role)) throw forbidden();
        const [task] = await tx
          .insert(tasks)
          .values({ workspaceId, createdBy: actorId, title })
          .returning();
        if (!task) throw new Error("task 写入失败");
        return task;
      });
    },
    async updateTask(
      actorId: string,
      workspaceId: string,
      taskId: string,
      done: boolean,
    ) {
      return db.transaction(async (tx) => {
        const role = await requireMember(tx, actorId, workspaceId, true);
        const scope = and(
          eq(tasks.workspaceId, workspaceId),
          eq(tasks.id, taskId),
        );
        const [task] = await tx.select().from(tasks).where(scope).for("update");
        if (!task) throw notFound();
        if (!canEditTask(role, actorId, task.createdBy)) throw forbidden();
        const [updated] = await tx
          .update(tasks)
          .set({ done })
          .where(scope)
          .returning();
        return updated;
      });
    },
    async deleteTask(actorId: string, workspaceId: string, taskId: string) {
      return db.transaction(async (tx) => {
        const role = await requireMember(tx, actorId, workspaceId, true);
        const scope = and(
          eq(tasks.workspaceId, workspaceId),
          eq(tasks.id, taskId),
        );
        const [task] = await tx.select().from(tasks).where(scope).for("update");
        if (!task) throw notFound();
        if (!canEditTask(role, actorId, task.createdBy)) throw forbidden();
        await tx.delete(tasks).where(scope);
      });
    },
    async addMember(
      actorId: string,
      workspaceId: string,
      targetId: string,
      role: Exclude<Role, "owner">,
    ) {
      return db.transaction(async (tx) => {
        if ((await requireMember(tx, actorId, workspaceId, true)) !== "owner")
          throw forbidden();
        // 这个教学入口按已有用户 ID 添加，不能当作邮件邀请或自助加入。
        const [target] = await tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, targetId));
        if (!target) throw notFound();
        const [added] = await tx
          .insert(memberships)
          .values({ workspaceId, userId: targetId, role })
          .onConflictDoNothing()
          .returning();
        if (!added) throw new HttpError(409, "ALREADY_MEMBER");
        return added;
      });
    },
  };
}
