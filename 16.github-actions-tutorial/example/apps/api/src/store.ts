import { canTransition, type TaskStatus } from "@workboard/shared";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
}

export interface TaskStore {
  list(): Task[];
  create(title: string): Task;
  get(id: string): Task | undefined;
  transition(id: string, to: TaskStatus): Task | undefined;
}

// 内存仓储：本教程聚焦 CI 门禁，数据库集成属于阶段 9/12。
// 接口与实现分离，测试与生产用同一份 app。
export function createTaskStore(): TaskStore {
  const tasks = new Map<string, Task>();
  let seq = 0;
  const seed: Task = {
    id: "t-1",
    title: "阅读 CI 教程第 1 章",
    status: "todo",
  };
  tasks.set(seed.id, seed);
  seq = 1;

  return {
    list: () => [...tasks.values()],
    create(title) {
      const task: Task = { id: `t-${++seq}`, title, status: "todo" };
      tasks.set(task.id, task);
      return task;
    },
    get: (id) => tasks.get(id),
    transition(id, to) {
      const task = tasks.get(id);
      if (!task || !canTransition(task.status, to)) return undefined;
      task.status = to;
      return task;
    },
  };
}
