import type { Task, TaskPriority, TaskTone } from "../types";
import { cn } from "../lib/cn";

/** tone → 完整类名映射（第 9 章 9.4 姿势一），绝不做 bg-${tone} 拼接 */
const TONE_STYLES: Record<TaskTone, string> = {
  todo: "bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300",
  doing: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  done: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
};

const TONE_LABELS: Record<TaskTone, string> = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
};

/**
 * TaskCard —— 任务卡片（第 9 章 9.5 成品）
 * 职责：卡片内部的结构与外观。
 * 不负责：外部布局（间距/网格位置由父容器决定）、数据来源。
 */
export function TaskCard({
  task,
  priority = "normal",
  onSelect,
  className,
}: {
  task: Task;
  priority?: TaskPriority;
  onSelect?: (id: string) => void;
  className?: string;
}) {
  return (
    <article
      // 布局无关的外观全部内聚；className 作为受控逃生舱，经 cn() 保证覆盖语义
      className={cn(
        "group rounded-xl border border-app-border bg-app-surface p-5 shadow-card",
        "transition hover:-translate-y-0.5 hover:shadow-card-hover",
        "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-app-accent",
        "motion-reduce:hover:translate-y-0",
        priority === "high" && "border-l-4 border-l-app-danger",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold leading-snug text-app-text group-hover:text-app-accent">
          <button
            type="button"
            onClick={() => onSelect?.(task.id)}
            className="cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
          >
            {task.title}
          </button>
        </h3>
        {/* 状态徽标：tone → 完整类名映射，文案映射分离 */}
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
            TONE_STYLES[task.tone],
          )}
        >
          {TONE_LABELS[task.tone]}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 text-sm text-app-text-muted">
        {task.summary}
      </p>

      <footer className="mt-4 flex items-center justify-between border-t border-app-border pt-4">
        <div className="flex -space-x-2">
          {task.assignees.map((user) => (
            // 循环渲染：类名只写一次（第 3 章策略一）
            <img
              key={user.id}
              src={user.avatarUrl}
              alt={user.name}
              title={user.name}
              className="size-7 rounded-full ring-2 ring-app-surface"
            />
          ))}
        </div>
        <time dateTime={task.dueDate} className="text-xs text-app-text-muted">
          {task.dueDateLabel} 截止
        </time>
      </footer>
    </article>
  );
}
