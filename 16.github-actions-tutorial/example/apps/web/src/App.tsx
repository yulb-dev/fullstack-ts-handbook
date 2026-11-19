import { useEffect, useState, type FormEvent } from "react";
import { canTransition, type TaskStatus } from "@workboard/shared";

interface Task {
  id: string;
  title: string;
  status: TaskStatus;
}

const NEXT: Record<TaskStatus, TaskStatus | null> = {
  todo: "doing",
  doing: "done",
  done: null,
};

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/tasks");
    if (res.ok) {
      const data = (await res.json()) as { tasks: Task[] };
      setTasks(data.tasks);
      setError(null);
    } else {
      const body = (await res.json()) as {
        error: { message: string; requestId: string };
      };
      setError(`${body.error.message}（requestId: ${body.error.requestId}）`);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      setTitle("");
      await load();
    } else {
      const body = (await res.json()) as { error: { message: string } };
      setError(body.error.message);
    }
  }

  async function onAdvance(task: Task) {
    const next = NEXT[task.status];
    if (!next || !canTransition(task.status, next)) return;
    await fetch(`/api/tasks/${task.id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    await load();
  }

  return (
    <main
      style={{ maxWidth: 640, margin: "2rem auto", fontFamily: "system-ui" }}
    >
      <h1>Workboard</h1>
      <form onSubmit={onCreate}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="新任务标题"
          aria-label="新任务标题"
        />
        <button type="submit">创建</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <ul>
        {tasks.map((t) => (
          <li key={t.id}>
            [{t.status}] {t.title}{" "}
            {NEXT[t.status] && (
              <button
                type="button"
                onClick={() => void onAdvance(t)}
                aria-label={`推进 ${t.title}`}
              >
                → {NEXT[t.status]}
              </button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
