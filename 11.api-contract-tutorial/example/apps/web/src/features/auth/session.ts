import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, unwrap, type Session } from "@taskflow/api-client";
import { csrf, useApi } from "../../lib/api";

export const sessionKey = ["session"] as const;

/** 当前会话。未登录是正常状态：返回 null，而不是让查询进入 error */
export function useSession() {
  const api = useApi();
  return useQuery({
    queryKey: sessionKey,
    queryFn: async ({ signal }): Promise<Session | null> => {
      try {
        const session = await unwrap(
          api.GET("/api/v1/auth/session", { signal }),
        );
        csrf.set(session.csrfToken);
        return session;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          csrf.set(null);
          return null;
        }
        throw error;
      }
    },
    staleTime: Infinity,
  });
}

export function useLogin() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      unwrap(api.POST("/api/v1/auth/login", { body: { email } })),
    onSuccess: (session) => {
      csrf.set(session.csrfToken);
      queryClient.setQueryData(sessionKey, session);
    },
  });
}

export function useLogout() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/auth/logout")),
    onSettled: () => {
      csrf.set(null);
      // 换了身份，所有服务端缓存都不再可信
      queryClient.clear();
      queryClient.setQueryData(sessionKey, null);
    },
  });
}
