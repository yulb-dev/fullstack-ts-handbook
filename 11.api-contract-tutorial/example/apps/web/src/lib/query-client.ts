import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError, NetworkError } from "@taskflow/api-client";

/**
 * 查询（GET）的重试策略：只重试「换个时间可能就好了」的错误。
 * - 网络错误、429、502/503/504：重试；
 * - 4xx（参数错、没权限、不存在）：重试一百次也一样，立刻失败；
 * - 500：通常是代码 bug，重试只会放大日志噪音。
 */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= 3) return false;
  if (error instanceof NetworkError) return true;
  if (error instanceof ApiError)
    return [429, 502, 503, 504].includes(error.status);
  return false;
}

/** 指数退避 + 抖动；服务端给了 Retry-After 就听服务端的 */
export function retryDelay(attempt: number, error: unknown): number {
  if (error instanceof ApiError && error.retryAfterMs !== null) {
    return Math.min(error.retryAfterMs, 30_000);
  }
  const base = Math.min(1000 * 2 ** attempt, 10_000);
  return base / 2 + Math.random() * (base / 2);
}

export function createQueryClient(handlers: { onUnauthenticated: () => void }) {
  // 任何请求遇到 401：会话失效，统一回到登录态，而不是每个组件各自处理
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401)
      handlers.onUnauthenticated();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: { retry: shouldRetryQuery, retryDelay, staleTime: 30_000 },
      // 写操作默认不重试：除非这个接口有幂等保障（见 useCreateTask）
      mutations: { retry: false },
    },
  });
}
