import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createTask } from "@/ui/api-client.js";

export interface CreateTaskVariables {
  title: string;
  dueDate?: string | null;
}

/**
 * 创建任务的 mutation。
 * 组件不直接 new QueryClient——client 由 Provider 注入，
 * 测试里每个用例渲染自己的 QueryClientProvider，缓存互不污染（见第 8 章）。
 */
export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: CreateTaskVariables) => createTask(variables),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}
