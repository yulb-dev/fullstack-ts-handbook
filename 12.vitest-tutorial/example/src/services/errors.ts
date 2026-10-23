/**
 * 业务错误：每种错误带一个稳定的 code，API 层按 code 映射 HTTP 状态，
 * 测试既可以断言错误类型，也可以断言 code 与 message，不必依赖字符串全文。
 */
export abstract class TaskDeskError extends Error {
  abstract readonly code: string;
}

export class PermissionDeniedError extends TaskDeskError {
  readonly code = "PERMISSION_DENIED";
  constructor(message = "没有权限执行该操作") {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export class TaskNotFoundError extends TaskDeskError {
  readonly code = "TASK_NOT_FOUND";
  constructor(taskId: string) {
    super(`任务不存在：${taskId}`);
    this.name = "TaskNotFoundError";
  }
}

export class TaskConflictError extends TaskDeskError {
  readonly code = "TASK_CONFLICT";
  constructor(message = "同名任务已存在") {
    super(message);
    this.name = "TaskConflictError";
  }
}

export class InvalidTransitionError extends TaskDeskError {
  readonly code = "INVALID_TRANSITION";
  constructor(from: string, to: string) {
    super(`不允许从 ${from} 迁移到 ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export class PastDueDateError extends TaskDeskError {
  readonly code = "PAST_DUE_DATE";
  constructor() {
    super("截止日期不能早于当前时间");
    this.name = "PastDueDateError";
  }
}
