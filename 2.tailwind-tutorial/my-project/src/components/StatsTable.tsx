import type { Task } from "../types";
import { cn } from "../lib/cn";

interface MemberStat {
  name: string;
  done: number;
  doing: number;
  todo: number;
}

/** 从任务列表按成员聚合各状态数量（数据驱动，避免硬编码统计） */
function computeStats(tasks: Task[]): MemberStat[] {
  const map = new Map<string, MemberStat>();
  for (const task of tasks) {
    for (const user of task.assignees) {
      const row =
        map.get(user.name) ??
        ({ name: user.name, done: 0, doing: 0, todo: 0 } as MemberStat);
      if (task.tone === "done") row.done += 1;
      else if (task.tone === "doing") row.doing += 1;
      else row.todo += 1;
      map.set(user.name, row);
    }
  }
  return [...map.values()];
}

/**
 * StatsTable —— 本周统计表（第 5 章 5.7 宽表格实战）
 * overflow-x-auto + min-w-[40rem]：小屏不挤压、可横向滑动
 * 布局外置：margin 由父级通过 className 传入（第 9 章 9.3）
 */
export function StatsTable({
  tasks,
  className,
}: {
  tasks: Task[];
  className?: string;
}) {
  const stats = computeStats(tasks);

  return (
    <section className={cn(className)} aria-label="任务统计表">
      <h2 className="text-xl font-semibold text-app-text">本周统计</h2>
      <div className="mt-4 overflow-x-auto rounded-xl border border-app-border bg-app-surface">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">各成员任务状态统计</caption>
          <thead className="border-b border-app-border bg-app-surface-raised text-left text-xs uppercase tracking-wide text-app-text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                成员
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                已完成
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                进行中
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                待办
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border">
            {stats.map((row) => (
              <tr key={row.name}>
                <th
                  scope="row"
                  className="px-4 py-3 text-left font-medium text-app-text"
                >
                  {row.name}
                </th>
                <td className="px-4 py-3 tabular-nums text-app-text-muted">
                  {row.done}
                </td>
                <td className="px-4 py-3 tabular-nums text-app-text-muted">
                  {row.doing}
                </td>
                <td className="px-4 py-3 tabular-nums text-app-text-muted">
                  {row.todo}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
