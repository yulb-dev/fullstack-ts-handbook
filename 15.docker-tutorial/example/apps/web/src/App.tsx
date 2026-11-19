import { useEffect, useState, type FormEvent } from "react";

interface Task {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

interface ErrorEnvelope {
  error: { code: string; message: string; requestId: string };
}

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<ErrorEnvelope["error"] | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) throw (await res.json()) as ErrorEnvelope;
      const data = (await res.json()) as { tasks: Task[] };
      setTasks(data.tasks);
      setError(null);
    } catch (err) {
      setError(
        (err as ErrorEnvelope).error ?? {
          code: "NETWORK_ERROR",
          message: "网络请求失败",
          requestId: "-",
        },
      );
    } finally {
      setLoading(false);
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
      const body = (await res.json()) as ErrorEnvelope;
      setError(body.error);
    }
  }

  return (
    <main
      style={{ maxWidth: 640, margin: "2rem auto", fontFamily: "system-ui" }}
    >
      <h1>Workboard</h1>
      <p>
        阶段 15 示例：这个页面在生产环境由 nginx 提供静态文件，/api 由 nginx
        代理到 API 容器。
      </p>
      <form onSubmit={onCreate}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="新任务标题"
          aria-label="新任务标题"
        />
        <button type="submit">创建</button>
      </form>
      {error && (
        <p role="alert" style={{ color: "crimson" }}>
          {error.code}: {error.message}（requestId: {error.requestId}）
        </p>
      )}
      {loading ? (
        <p>加载中…</p>
      ) : (
        <ul>
          {tasks.map((t) => (
            <li key={t.id}>
              [{t.status}] {t.title}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
