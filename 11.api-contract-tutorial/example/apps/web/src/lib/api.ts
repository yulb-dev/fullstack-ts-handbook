import { createApiClient, type ApiClient } from "@taskflow/api-client";
import { createContext, useContext } from "react";

/**
 * CSRF token 只放内存：它不是秘密（每次 GET /auth/session 都能拿到），
 * 但也没必要写进 localStorage，刷新页面后重新获取即可。
 */
let csrfToken: string | null = null;
export const csrf = {
  get: () => csrfToken,
  set: (token: string | null) => {
    csrfToken = token;
  },
};

export function createBrowserApi(): ApiClient {
  return createApiClient({
    // 同源部署留空；跨源部署时通过 VITE_API_BASE_URL 指向 API 源
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? "",
    getCsrfToken: csrf.get,
  });
}

export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi 必须在 <ApiContext.Provider> 内使用");
  return api;
}
