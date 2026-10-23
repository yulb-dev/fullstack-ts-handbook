/** 教学用 RBAC：角色 + 资源归属共同决定「能不能做」。纯函数，不查数据库、不看时间 */
export type Role = "member" | "manager";

export interface Actor {
  id: string;
  role: Role;
}

/** 资源带归属信息：谁创建的、指派给谁 */
export interface OwnedResource {
  ownerId: string;
  assigneeId: string | null;
}

export function canCreateTask(_actor: Actor): boolean {
  return true;
}

export function canUpdateTask(actor: Actor, task: OwnedResource): boolean {
  if (actor.role === "manager") return true;
  return task.ownerId === actor.id || task.assigneeId === actor.id;
}

export function canArchiveTask(actor: Actor): boolean {
  return actor.role === "manager";
}

export function canViewBoard(actor: Actor): boolean {
  // 教学项目里 member 与 manager 都能看列表；真实项目可能按 workspace 成员关系判断
  return actor.role === "member" || actor.role === "manager";
}
