import { and, eq } from "drizzle-orm";
import { projectMembers } from "../db/schema";
import type { Db } from "../db/types";
import { forbidden, notFound } from "../domain/errors";

export type MemberRole = "owner" | "editor" | "viewer";

export async function findRole(
  db: Db,
  projectId: string,
  userId: string,
): Promise<MemberRole | null> {
  const [row] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
      ),
    )
    .limit(1);
  return row?.role ?? null;
}

/**
 * 授权决策集中在这里，路由与前端都不做最终判断（第 9 章）。
 *
 * - 不是成员：一律 404。不让外人通过 403/404 的差异探测「这个项目是否存在」；
 * - 是成员但权限不够：403。他本来就能看到项目，告诉他「没权限」是有用的信息。
 */
export async function assertCanRead(db: Db, projectId: string, userId: string) {
  const role = await findRole(db, projectId, userId);
  if (!role) throw notFound("项目");
  return role;
}

export async function assertCanWrite(
  db: Db,
  projectId: string,
  userId: string,
) {
  const role = await assertCanRead(db, projectId, userId);
  if (role === "viewer") throw forbidden("只读成员不能创建或修改任务");
  return role;
}
