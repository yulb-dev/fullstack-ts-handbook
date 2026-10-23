import { Type, type Static } from "typebox";
import {
  IsoDateTime,
  Nullable,
  PageMetaSchema,
  PageQuery,
  ref,
  Uuid,
} from "./common.js";

// ---------- 可复用的字段 ----------

// 纯字符串枚举用 Type.Enum：生成 { enum: [...] }，校验错误和文档都比 Union<Literal> 简洁。
// Static 推断结果同样是 'todo' | 'doing' | 'done'。
export const TaskStatusSchema = Type.Enum(["todo", "doing", "done"], {
  description: "任务状态",
});

export const TaskPrioritySchema = Type.Enum(["low", "medium", "high"], {
  description: "优先级",
});

export type TaskStatus = Static<typeof TaskStatusSchema>;
export type TaskPriority = Static<typeof TaskPrioritySchema>;

const Title = Type.String({
  minLength: 1,
  maxLength: 120,
  description: "标题，首尾空白会被去掉",
});
const Description = Nullable(
  Type.String({ maxLength: 2000, description: "描述，可以为 null" }),
);
const AssigneeId = Nullable(
  Type.String({ format: "uuid", description: "负责人 ID，null 表示未指派" }),
);

// ---------- 对外的 Task 结构（响应） ----------

export const TaskSchema = Type.Object(
  {
    id: Uuid,
    title: Type.String(),
    description: Description,
    status: TaskStatusSchema,
    priority: TaskPrioritySchema,
    ownerId: Uuid,
    assigneeId: AssigneeId,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  },
  {
    $id: "Task",
    description:
      "对外公开的任务。内部字段（如 internalNote）不在此列，序列化时会被丢弃",
  },
);

export type Task = Static<typeof TaskSchema>;

export const TaskListSchema = Type.Object(
  {
    items: Type.Array(ref(TaskSchema)),
    page: ref(PageMetaSchema),
  },
  { $id: "TaskList", description: "一页任务及分页信息" },
);

export type TaskList = Static<typeof TaskListSchema>;

// ---------- 请求 ----------

export const TaskParamsSchema = Type.Object({
  taskId: Uuid,
});

/** headers 的 key 一律写小写：Node.js 收到的请求头名都是小写 */
export const UpdateTaskHeadersSchema = Type.Object({
  "if-match": Type.Optional(
    Type.String({
      pattern: '^"[0-9]+"$',
      description:
        '可选。传入上次读到的 ETag（如 "3"），若任务已被他人修改则返回 412',
    }),
  ),
});

export const CreateTaskBodySchema = Type.Object(
  {
    title: Title,
    description: Type.Optional(Description),
    priority: Type.Optional(TaskPrioritySchema),
    assigneeId: Type.Optional(AssigneeId),
  },
  {
    // 未声明的字段（如 ownerId、status）会被 Fastify 的 Ajv 配置直接移除，
    // 防止客户端“顺手”改到不该改的字段（mass assignment）
    additionalProperties: false,
    examples: [{ title: "整理发布清单", priority: "high" }],
  },
);

export type CreateTaskBody = Static<typeof CreateTaskBodySchema>;

export const UpdateTaskBodySchema = Type.Object(
  {
    title: Type.Optional(Title),
    description: Type.Optional(Description),
    status: Type.Optional(TaskStatusSchema),
    priority: Type.Optional(TaskPrioritySchema),
    assigneeId: Type.Optional(AssigneeId),
  },
  {
    additionalProperties: false,
    minProperties: 1,
    description: "只传需要修改的字段；至少传一个",
  },
);

export type UpdateTaskBody = Static<typeof UpdateTaskBodySchema>;

export const DEFAULT_TASK_SORT = "-createdAt";

export const TaskSortSchema = Type.Enum(
  ["createdAt", "-createdAt", "priority", "-priority", "title", "-title"],
  {
    default: DEFAULT_TASK_SORT,
    description: "排序字段，前缀 - 表示降序；同值时按 id 升序保证稳定",
  },
);

export type TaskSort = Static<typeof TaskSortSchema>;

export const ListTasksQuerySchema = Type.Object(
  {
    ...PageQuery,
    sort: Type.Optional(TaskSortSchema),
    status: Type.Optional(TaskStatusSchema),
    assigneeId: Type.Optional(Uuid),
  },
  { additionalProperties: false },
);

export type ListTasksQuery = Static<typeof ListTasksQuerySchema>;
