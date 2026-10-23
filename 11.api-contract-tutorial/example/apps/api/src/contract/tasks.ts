import Type, { type Static } from "typebox";
import {
  CalendarDate,
  CursorPage,
  DateTime,
  Id,
  PageLimit,
  ref,
} from "./common";

// 契约里的 schema 只描述「线上传输的形状」，与数据库表结构刻意分开（第 3 章）

export const TaskStatus = Type.Enum(["todo", "doing", "done"], {
  $id: "TaskStatus",
  description: "任务状态。新增取值属于契约变更，客户端需对未知值兜底",
});
export const TaskPriority = Type.Enum(["low", "medium", "high"], {
  $id: "TaskPriority",
});

// pattern "\S"：至少包含一个非空白字符。否则 "   " 能通过 minLength，服务端 trim 后变成 ""，
// 再撞上数据库 CHECK 约束，用户得到的就是 500 而不是 400（第 5 章）
const Title = Type.String({ minLength: 1, maxLength: 120, pattern: "\\S" });
const Description = Type.String({ maxLength: 2000 });

export const Task = Type.Object(
  {
    id: Id,
    projectId: Id,
    title: Title,
    description: Type.Union([Description, Type.Null()]),
    status: ref(TaskStatus),
    priority: ref(TaskPriority),
    dueDate: Type.Union([CalendarDate, Type.Null()]),
    createdBy: Id,
    version: Type.Integer({
      minimum: 1,
      description: "乐观并发版本号，更新时通过 If-Match 带回",
    }),
    createdAt: DateTime,
    updatedAt: DateTime,
  },
  { $id: "Task", additionalProperties: false },
);
export type Task = Static<typeof Task>;

export const CreateTaskBody = Type.Object(
  {
    title: Title,
    description: Type.Optional(Type.Union([Description, Type.Null()])),
    priority: Type.Optional(ref(TaskPriority)),
    dueDate: Type.Optional(Type.Union([CalendarDate, Type.Null()])),
  },
  {
    $id: "CreateTaskBody",
    additionalProperties: false,
    description:
      "status / createdBy / version 由服务端决定，客户端传了会被拒绝",
  },
);
export type CreateTaskBody = Static<typeof CreateTaskBody>;

export const UpdateTaskBody = Type.Object(
  {
    title: Type.Optional(Title),
    description: Type.Optional(Type.Union([Description, Type.Null()])),
    status: Type.Optional(ref(TaskStatus)),
    priority: Type.Optional(ref(TaskPriority)),
    dueDate: Type.Optional(Type.Union([CalendarDate, Type.Null()])),
  },
  { $id: "UpdateTaskBody", additionalProperties: false, minProperties: 1 },
);
export type UpdateTaskBody = Static<typeof UpdateTaskBody>;

export const TaskPage = CursorPage(ref(Task), "TaskPage");
export type TaskPage = Static<typeof TaskPage>;

// 查询参数不设 additionalProperties: false：多余参数（如防缓存的 ?_=123）直接忽略即可
export const ListTasksQuery = Type.Object({
  limit: Type.Optional(PageLimit),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  status: Type.Optional(ref(TaskStatus)),
});

export const ProjectParams = Type.Object({ projectId: Id });
export const TaskParams = Type.Object({ taskId: Id });

export const IdempotencyHeaders = Type.Object({
  "idempotency-key": Type.String({
    format: "uuid",
    description: "同一次「创建意图」的唯一键；网络重试时必须复用同一个值",
  }),
});

// 声明为可选：缺失时由 handler 返回 428，而不是笼统的 400（第 11 章）
export const IfMatchHeaders = Type.Object({
  "if-match": Type.Optional(
    Type.String({
      pattern: '^"[0-9]+"$',
      description: '资源版本，格式为带引号的整数，例如 "3"。更新时必须提供',
    }),
  ),
});

export const taskSchemas = [
  TaskStatus,
  TaskPriority,
  Task,
  CreateTaskBody,
  UpdateTaskBody,
  TaskPage,
];
