import createClient, { type Middleware } from "openapi-fetch";
import { NetworkError, isAbortError, toApiError } from "./errors";
import type { paths } from "./generated/openapi";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface ApiClientOptions {
  /** 同源部署（Vite 代理 / 反向代理）留空；跨源部署填 API 源，例如 https://api.example.com */
  baseUrl?: string;
  /** 读取当前会话的 CSRF token（来自 GET /api/v1/auth/session） */
  getCsrfToken: () => string | null;
  /** 测试时注入假的 fetch */
  fetch?: (input: Request) => Promise<Response>;
}

/**
 * 唯一的 HTTP 出口。类型全部来自 openapi.json 生成的 paths，
 * apps/web 不需要、也不允许 import 服务端源码。
 */
export function createApiClient(options: ApiClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? "",
    // 同源时浏览器默认就会带 Cookie；跨源部署必须 include，且服务端要配 CORS credentials
    credentials: "include",
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  const middleware: Middleware = {
    onRequest({ request }) {
      // 前端生成的 requestId：即使请求没拿到响应，也能把前端日志和网关日志串起来
      request.headers.set("x-request-id", `web-${crypto.randomUUID()}`);
      if (UNSAFE_METHODS.has(request.method)) {
        const token = options.getCsrfToken();
        if (token) request.headers.set("x-csrf-token", token);
      }
      return request;
    },
    onError({ error }) {
      // 主动取消（AbortController / TanStack Query 取消）原样抛出，不当作网络故障
      if (isAbortError(error)) return;
      return new NetworkError("网络连接失败，请检查网络后重试", {
        cause: error,
      });
    },
  };
  client.use(middleware);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * 把 openapi-fetch 的 { data, error, response } 变成「成功返回 data，失败抛 ApiError」，
 * 正好符合 TanStack Query 的 queryFn / mutationFn 约定。
 */
export async function unwrap<T>(
  pending: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await pending;
  if (!response.ok) throw toApiError(error, response);
  return data as T;
}
