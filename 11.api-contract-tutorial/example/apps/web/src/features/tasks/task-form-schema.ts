import type {
  CreateTaskBody,
  TaskPriority,
  TaskStatus,
} from "@taskflow/api-client";
import { z } from "zod";

/**
 * 前端表单 schema：只为「用户体验」服务——即时提示、友好文案、把空字符串整理成 null。
 * 它不是安全边界，服务端的 TypeBox 契约才是。两者独立维护，靠下面三道闸防止漂移：
 *   ① 选项表 satisfies Record<契约枚举, string> —— 枚举增删会编译失败；
 *   ② toCreateTaskBody 的返回类型是生成的 CreateTaskBody —— 字段改名/改类型会编译失败；
 *   ③ task-form-schema.test.ts 比对数值约束 —— 长度上限不一致会测试失败。
 */

export const PRIORITY_LABEL = {
  low: "低",
  medium: "中",
  high: "高",
} as const satisfies Record<TaskPriority, string>;

export const STATUS_LABEL = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
} as const satisfies Record<TaskStatus, string>;

const priorities = Object.keys(PRIORITY_LABEL) as [
  TaskPriority,
  ...TaskPriority[],
];

export const createTaskFormSchema = z.object({
  title: z.string().trim().min(1, "请填写标题").max(120, "标题最多 120 个字"),
  description: z.string().trim().max(2000, "描述最多 2000 个字"),
  priority: z.enum(priorities),
  // <input type="date"> 的值要么是 ""，要么是 YYYY-MM-DD
  dueDate: z.union([z.literal(""), z.iso.date("请选择有效日期")]),
});

export type CreateTaskFormInput = z.input<typeof createTaskFormSchema>;
export type CreateTaskFormOutput = z.output<typeof createTaskFormSchema>;

/** 表单字段名清单：服务端字段错误只回填到这些字段上 */
export const CREATE_TASK_FIELDS = [
  "title",
  "description",
  "priority",
  "dueDate",
] as const;

export const emptyCreateTaskForm: CreateTaskFormInput = {
  title: "",
  description: "",
  priority: "medium",
  dueDate: "",
};

/** 表单值 → 契约请求体。返回类型由生成代码决定，契约一变这里就编译失败 */
export function toCreateTaskBody(values: CreateTaskFormOutput): CreateTaskBody {
  return {
    title: values.title,
    description: values.description === "" ? null : values.description,
    priority: values.priority,
    dueDate: values.dueDate === "" ? null : values.dueDate,
  };
}
