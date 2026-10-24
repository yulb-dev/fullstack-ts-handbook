import { useState } from "react";
import type { Task } from "../types";
import { Button } from "../components/Button";
import { TaskCard } from "../components/TaskCard";
import { StatsTable } from "../components/StatsTable";

/**
 * BoardPage —— 页面层，只负责布局（第 9 章 9.3 / 第 10 章 10.2）
 * 卡片区：grid gap-4 md:grid-cols-2 lg:grid-cols-3（1→2→3 列渐进）
 * 组件自身无任何外边距，间距全部由这里的父容器决定
 */
export function BoardPage({ tasks }: { tasks: Task[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-app-text sm:text-3xl">
            产品迭代看板
          </h1>
          <p className="mt-1 text-sm text-app-text-muted">
            共 {tasks.length} 个任务
          </p>
        </div>
        <Button variant="primary">+ 新建任务</Button>
      </div>

      {/* 选中任务详情：条件渲染的可关闭面板（演示定位 / 语义 / 可访问性） */}
      {selected && (
        <section
          aria-label="任务详情"
          className="mt-6 rounded-xl border border-app-accent bg-app-accent-soft p-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-app-text">{selected.title}</h2>
              <p className="mt-1 text-sm text-app-text-muted">
                {selected.summary}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSelectedId(null)}
            >
              关闭
            </Button>
          </div>
        </section>
      )}

      {/* 布局归父级：卡片组件自身无任何外边距 */}
      <section
        className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
        aria-label="任务列表"
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            priority={task.priority}
            onSelect={setSelectedId}
          />
        ))}
      </section>

      <StatsTable tasks={tasks} className="mt-12" />
    </main>
  );
}
