import { ApiError, type Task, type TaskStatus } from "@taskflow/api-client";
import { useState } from "react";
import { ErrorBanner } from "../../components/ErrorBanner";
import { formatCalendarDate, formatInstant } from "../../lib/dates";
import { useTaskList, useUpdateTask } from "./api";
import { PRIORITY_LABEL, STATUS_LABEL } from "./task-form-schema";

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: "doing",
  doing: "done",
  done: "todo",
};

/** 服务端将来新增的枚举值，旧前端不认识：显示原值，而不是崩溃或显示空白 */
function label<T extends string>(map: Record<T, string>, value: T): string {
  return (map as Record<string, string>)[value] ?? value;
}

export function TaskList({
  projectId,
  canWrite,
}: {
  projectId: string;
  canWrite: boolean;
}) {
  const [status, setStatus] = useState<TaskStatus | undefined>();
  const list = useTaskList(projectId, status);
  const update = useUpdateTask(projectId);

  const tasks = list.data?.pages.flatMap((page) => page.items) ?? [];

  function advance(task: Task) {
    const next = NEXT_STATUS[task.status] ?? "todo";
    update.mutate({ task, patch: { status: next } });
  }

  return (
    <section className="card" aria-labelledby="task-list-title">
      <h2 id="task-list-title">任务</h2>
      <label htmlFor="status-filter">状态筛选</label>
      <select
        id="status-filter"
        value={status ?? ""}
        onChange={(e) =>
          setStatus((e.target.value || undefined) as TaskStatus | undefined)
        }
      >
        <option value="">全部</option>
        {Object.entries(STATUS_LABEL).map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>

      {update.isError && (
        <ErrorBanner
          error={update.error}
          {...(update.error instanceof ApiError && update.error.status === 412
            ? {}
            : { onRetry: () => update.reset() })}
        />
      )}

      {list.isPending && <p>加载中…</p>}
      {list.isError && (
        <ErrorBanner error={list.error} onRetry={() => list.refetch()} />
      )}

      <ul className="task-list">
        {tasks.map((task) => (
          <li key={task.id}>
            <strong>{task.title}</strong>
            <span className={`badge badge-${task.status}`}>
              {label(STATUS_LABEL, task.status)}
            </span>
            <span>优先级：{label(PRIORITY_LABEL, task.priority)}</span>
            {task.dueDate && (
              <span>截止：{formatCalendarDate(task.dueDate)}</span>
            )}
            <time dateTime={task.createdAt}>
              创建于 {formatInstant(task.createdAt)}
            </time>
            {canWrite && (
              <button
                type="button"
                onClick={() => advance(task)}
                disabled={update.isPending}
              >
                标记为「
                {label(STATUS_LABEL, NEXT_STATUS[task.status] ?? "todo")}」
              </button>
            )}
          </li>
        ))}
      </ul>

      {list.hasNextPage && (
        <button
          type="button"
          onClick={() => list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
        >
          {list.isFetchingNextPage ? "加载中…" : "加载更多"}
        </button>
      )}
      {!list.isPending && tasks.length === 0 && <p>还没有任务。</p>}
    </section>
  );
}
