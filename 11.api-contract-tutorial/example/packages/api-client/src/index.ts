import type { components, operations, paths } from "./generated/openapi";

export {
  createApiClient,
  unwrap,
  type ApiClient,
  type ApiClientOptions,
} from "./client";
export {
  ApiError,
  NetworkError,
  isAbortError,
  parseRetryAfter,
  toApiError,
  type ErrorCode,
  type FieldError,
} from "./errors";

export type { components, operations, paths };

// 常用 schema 的别名：前端只从这里拿类型，不手写第二份
type Schemas = components["schemas"];
export type Task = Schemas["Task"];
export type TaskPage = Schemas["TaskPage"];
export type TaskStatus = Schemas["TaskStatus"];
export type TaskPriority = Schemas["TaskPriority"];
export type CreateTaskBody = Schemas["CreateTaskBody"];
export type UpdateTaskBody = Schemas["UpdateTaskBody"];
export type Project = Schemas["Project"];
export type Session = Schemas["Session"];
export type User = Schemas["User"];
