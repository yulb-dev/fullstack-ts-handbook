/**
 * 浏览器端 API client。测试组件时我们用 vi.mock 替换这个模块——
 * 它是「组件世界」与「网络世界」的边界，mock 就停在这里，不再往组件内部深入。
 */
export interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const API_BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody &
    Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.error?.code ?? "UNKNOWN",
      body.error?.message ?? `请求失败（${response.status}）`,
    );
  }
  return body as T;
}

export function createTask(input: {
  title: string;
  dueDate?: string | null;
}): Promise<unknown> {
  return request("/tasks", { method: "POST", body: JSON.stringify(input) });
}

export function listTasks(page = 1): Promise<unknown> {
  return request(`/tasks?page=${page}`);
}
