import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createApiClient } from "@taskflow/api-client";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ApiContext } from "../../lib/api";
import { TaskList } from "./TaskList";

afterEach(cleanup);

const PROJECT = "6b0b6d2e-1d7c-4d4f-9a4e-0f0e8c7a1b11";

const baseTask = {
  id: "0d3e2b7c-1c52-4f53-8f6e-2c3c5b0b7a11",
  projectId: PROJECT,
  title: "写发布说明",
  description: null,
  status: "todo",
  priority: "medium",
  dueDate: "2026-10-30",
  createdBy: "9a3e2b7c-1c52-4f53-8f6e-2c3c5b0b7a11",
  version: 1,
  createdAt: "2026-10-22T08:30:00.000Z",
  updatedAt: "2026-10-22T08:30:00.000Z",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "req-list" },
  });
}

function setup(handler: (req: Request) => Response) {
  const requests: Request[] = [];
  const api = createApiClient({
    baseUrl: "http://test",
    getCsrfToken: () => "csrf-test",
    fetch: async (req) => {
      requests.push(req);
      return handler(req);
    },
  });
  render(
    <ApiContext.Provider value={api}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TaskList projectId={PROJECT} canWrite />
      </QueryClientProvider>
    </ApiContext.Provider>,
  );
  return { requests, user: userEvent.setup() };
}

describe("TaskList", () => {
  it("服务端新增了前端不认识的枚举值：显示原值，不崩溃", async () => {
    setup(() =>
      json(200, {
        items: [{ ...baseTask, status: "blocked" }],
        nextCursor: null,
      }),
    );
    expect(await screen.findByText("写发布说明")).toBeTruthy();
    expect(screen.getByText("blocked")).toBeTruthy();
  });

  it("更新时带 If-Match；412 → 提示被他人修改，并重新拉取列表", async () => {
    let version = 1;
    const { requests, user } = setup((req) => {
      if (req.method === "PATCH") {
        version = 2; // 别人抢先改了
        return json(412, {
          error: {
            code: "PRECONDITION_FAILED",
            message: "任务已被其他人修改，请查看最新内容后再保存",
            requestId: "req-list",
          },
        });
      }
      return json(200, { items: [{ ...baseTask, version }], nextCursor: null });
    });

    await user.click(
      await screen.findByRole("button", { name: "标记为「进行中」" }),
    );
    expect(await screen.findByText("内容已被他人修改")).toBeTruthy();

    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.headers.get("if-match")).toBe('"1"');
    // 412 之后列表被重新请求了一次
    await waitFor(() =>
      expect(requests.filter((r) => r.method === "GET")).toHaveLength(2),
    );
  });
});
