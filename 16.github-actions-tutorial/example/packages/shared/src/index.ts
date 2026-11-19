// 同构纯函数：前后端都能安全 import（无 Node/浏览器专属 API）。
// 这是 monorepo 里「共享业务逻辑」的最小示例（阶段 14 的 packages/shared）。

export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ["doing"],
  doing: ["todo", "done"],
  done: [],
};

export function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    typeof value === "string" &&
    (TASK_STATUSES as readonly string[]).includes(value)
  );
}

/** 状态机：done 是终态；todo 不能直接跳 done。 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface Pagination {
  page: number;
  pageSize: number;
}

/** 分页参数解析：非法输入回退默认值，越界钳制——边界行为都有测试。 */
export function parsePagination(input: {
  page?: unknown;
  pageSize?: unknown;
}): Pagination {
  const page = Number(input.page);
  const pageSize = Number(input.pageSize);
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize:
      Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 20,
  };
}
