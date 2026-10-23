import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";

/**
 * 共享 render helper：关键在「每次调用都 new 一个 QueryClient」。
 * retry 关掉——测试里失败就该立刻失败，不要等指数退避重试拖慢并掩盖问题。
 */
export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    options,
  );

  return { ...result, queryClient };
}
