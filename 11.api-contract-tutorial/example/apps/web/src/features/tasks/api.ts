import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ApiError,
  NetworkError,
  unwrap,
  type CreateTaskBody,
  type Task,
  type TaskStatus,
  type UpdateTaskBody,
} from "@taskflow/api-client";
import { useApi } from "../../lib/api";

/** query key 工厂：所有任务相关缓存都挂在 ["tasks"] 下，便于整体失效 */
export const taskKeys = {
  all: ["tasks"] as const,
  lists: (projectId: string) => [...taskKeys.all, "list", projectId] as const,
  list: (projectId: string, status: TaskStatus | undefined) =>
    [...taskKeys.lists(projectId), { status: status ?? "all" }] as const,
};

export function useProjects() {
  const api = useApi();
  return useQuery({
    queryKey: ["projects"],
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/projects", { signal })),
  });
}

export function useTaskList(projectId: string, status?: TaskStatus) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: taskKeys.list(projectId, status),
    // signal：组件卸载 / key 变化时，TanStack Query 会中止还在路上的请求
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET("/api/v1/projects/{projectId}/tasks", {
          params: {
            path: { projectId },
            query: {
              limit: 20,
              ...(pageParam ? { cursor: pageParam } : {}),
              ...(status ? { status } : {}),
            },
          },
          signal,
        }),
      ),
    initialPageParam: null as string | null,
    // 游标是不透明字符串：原样回传，绝不自己拼
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export interface CreateTaskVariables {
  body: CreateTaskBody;
  /** 同一次「创建意图」的键：由表单持有，重试时保持不变 */
  idempotencyKey: string;
}

export function useCreateTask(projectId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["createTask", projectId],
    mutationFn: ({ body, idempotencyKey }: CreateTaskVariables) =>
      unwrap(
        api.POST("/api/v1/projects/{projectId}/tasks", {
          params: {
            path: { projectId },
            header: { "idempotency-key": idempotencyKey },
          },
          body,
        }),
      ),
    // 有幂等键兜底，「不知道服务器收没收到」的网络错误才敢自动重试；4xx 绝不重试
    retry: (failureCount, error) =>
      failureCount < 2 && error instanceof NetworkError,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: taskKeys.lists(projectId) }),
  });
}

export function useUpdateTask(projectId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ task, patch }: { task: Task; patch: UpdateTaskBody }) =>
      unwrap(
        api.PATCH("/api/v1/tasks/{taskId}", {
          params: {
            path: { taskId: task.id },
            // 带上「我看到的版本」：别人先改了，服务端会返回 412 而不是覆盖
            header: { "if-match": `"${task.version}"` },
          },
          body: patch,
        }),
      ),
    onSettled: (_data, error) => {
      // 成功：刷新列表；412：本地数据已过期，同样需要拉最新
      if (!error || (error instanceof ApiError && error.status === 412)) {
        return queryClient.invalidateQueries({
          queryKey: taskKeys.lists(projectId),
        });
      }
    },
  });
}
