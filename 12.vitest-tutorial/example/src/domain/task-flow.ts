/** 任务状态机：状态本身与「允许的状态迁移」集中定义，业务代码不允许散落 if/else 判断 */
export const TASK_STATUSES = [
  "todo",
  "in_progress",
  "done",
  "archived",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ["in_progress", "archived"],
  in_progress: ["todo", "done", "archived"],
  done: ["in_progress"],
  archived: [],
};

/** 判断一次状态迁移是否合法（archived 是终态，任何迁移都不允许） */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** 列出某个状态下所有合法的下一步，UI 用它渲染可选按钮 */
export function nextStatuses(from: TaskStatus): readonly TaskStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function isTerminal(status: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}
