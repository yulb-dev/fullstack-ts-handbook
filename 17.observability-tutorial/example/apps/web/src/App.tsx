import * as Sentry from "@sentry/react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

interface Task {
  id: string;
  title: string;
  status: string;
}

interface ApiError {
  code: string;
  message: string;
  requestId: string;
}

// 故意抛错的组件：演示 ErrorBoundary 捕获渲染错误并上报 Sentry
function Boom(): ReactNode {
  throw new Error("Sentry 前端测试错误（渲染异常）");
}

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [boom, setBoom] = useState(false);

  async function load() {
    const res = await fetch("/api/tasks");
    if (res.ok) {
      const data = (await res.json()) as { tasks: Task[] };
      setTasks(data.tasks);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setApiError(null);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      setTitle("");
      await load();
      return;
    }
    const body = (await res.json()) as { error: ApiError };
    setApiError(body.error);
    // 关键关联：把后端返回的 requestId 作为 tag 上报 Sentry，
    // 排障时可从 Sentry 事件 → requestId → 后端日志/trace（第 9、11 章）。
    Sentry.captureException(
      new Error(`API ${body.error.code}: ${body.error.message}`),
      {
        tags: { requestId: body.error.requestId, errorCode: body.error.code },
      },
    );
  }

  return (
    <Sentry.ErrorBoundary
      fallback={<p role="alert">页面渲染出错，已上报 Sentry。</p>}
    >
      <main
        style={{ maxWidth: 640, margin: "2rem auto", fontFamily: "system-ui" }}
      >
        <h1>Workboard · 可观测性演练</h1>
        <form onSubmit={onCreate}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="新任务标题（输入 FAIL_DB 触发后端故障）"
            aria-label="新任务标题"
            size={40}
          />
          <button type="submit">创建</button>
        </form>
        {apiError && (
          <p role="alert" style={{ color: "crimson" }}>
            {apiError.code}: {apiError.message}（requestId: {apiError.requestId}
            ）
          </p>
        )}
        <ul>
          {tasks.map((t) => (
            <li key={t.id}>
              [{t.status}] {t.title}
            </li>
          ))}
        </ul>
        <hr />
        <button type="button" onClick={() => setBoom(true)}>
          触发前端渲染异常（练习 1）
        </button>
        {boom && <Boom />}
      </main>
    </Sentry.ErrorBoundary>
  );
}
