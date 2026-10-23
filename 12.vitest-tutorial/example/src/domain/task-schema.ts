import { z } from "zod";
import { TASK_STATUSES } from "@/domain/task-flow.js";

/**
 * 创建任务的输入 schema。
 * 注意：「截止日期不能是过去」不放在 schema 里，而是放在 service 里用注入的 clock 判断——
 * schema 保持纯数据结构校验，时间相关规则显式传入 now，测试时不需要 fake timers 也能覆盖。
 */
export const createTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "标题不能为空")
    .max(80, "标题不能超过 80 个字符"),
  // 前端 <input type="date"> 提交的是 YYYY-MM-DD；也接受完整 ISO 字符串
  dueDate: z.coerce.date().nullish(),
  assigneeId: z.string().min(1).nullish(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/** 状态迁移请求体 */
export const transitionSchema = z.object({
  to: z.enum(TASK_STATUSES),
});
