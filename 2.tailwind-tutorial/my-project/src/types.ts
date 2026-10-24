/** 任务卡片的领域模型（第 9 章 9.5 TaskCard 依赖的形状） */

export type TaskTone = "todo" | "doing" | "done";
export type TaskPriority = "normal" | "high";

export interface Assignee {
  id: string;
  name: string;
  avatarUrl: string;
}

export interface Task {
  id: string;
  title: string;
  summary: string;
  tone: TaskTone;
  priority: TaskPriority;
  assignees: Assignee[];
  dueDate: string; // ISO 日期，供 <time dateTime>
  dueDateLabel: string; // 展示文案，如 "10 月 30 日"
}
