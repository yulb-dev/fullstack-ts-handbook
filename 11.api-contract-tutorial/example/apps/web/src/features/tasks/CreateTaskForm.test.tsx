import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createApiClient } from "@taskflow/api-client";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ApiContext } from "../../lib/api";
import { CreateTaskForm } from "./CreateTaskForm";

const PROJECT = "6b0b6d2e-1d7c-4d4f-9a4e-0f0e8c7a1b11";

afterEach(cleanup);

type Handler = (req: Request, body: unknown) => Response | Promise<Response>;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "req-test" },
  });
}

function envelope(code: string, message: string, fields?: unknown[]) {
  return {
    error: {
      code,
      message,
      requestId: "req-test",
      ...(fields ? { fields } : {}),
    },
  };
}

/** 渲染表单，并用假 fetch 记录每个请求 */
function setup(handler: Handler) {
  const requests: { req: Request; body: unknown }[] = [];
  const api = createApiClient({
    baseUrl: "http://test",
    getCsrfToken: () => "csrf-test",
    fetch: async (req) => {
      const body = await req
        .clone()
        .json()
        .catch(() => null);
      requests.push({ req, body });
      return handler(req, body);
    },
  });
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retryDelay: 0 } },
  });
  render(
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={queryClient}>
        <CreateTaskForm projectId={PROJECT} />
      </QueryClientProvider>
    </ApiContext.Provider>,
  );
  return { requests, user: userEvent.setup() };
}

const task = {
  id: "0d3e2b7c-1c52-4f53-8f6e-2c3c5b0b7a11",
  projectId: PROJECT,
  title: "写发布说明",
  description: null,
  status: "todo",
  priority: "medium",
  dueDate: null,
  createdBy: "9a3e2b7c-1c52-4f53-8f6e-2c3c5b0b7a11",
  version: 1,
  createdAt: "2026-10-22T08:30:00.000Z",
  updatedAt: "2026-10-22T08:30:00.000Z",
};

describe("CreateTaskForm：完整链路与错误映射", () => {
  it("客户端校验不通过时根本不发请求", async () => {
    const { requests, user } = setup(() => json(201, task));
    await user.click(screen.getByRole("button", { name: "创建任务" }));
    expect(await screen.findByText("请填写标题")).toBeTruthy();
    expect(screen.getByLabelText("标题").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(requests).toHaveLength(0);
  });

  it("成功：请求体符合契约，带幂等键与 CSRF 头，成功后清空并换新键", async () => {
    const { requests, user } = setup(() => json(201, task));
    await user.type(screen.getByLabelText("标题"), "  写发布说明 ");
    await user.click(screen.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(requests).toHaveLength(1));

    const first = requests[0]!;
    expect(first.req.method).toBe("POST");
    expect(first.req.headers.get("x-csrf-token")).toBe("csrf-test");
    expect(first.body).toEqual({
      title: "写发布说明",
      description: null,
      priority: "medium",
      dueDate: null,
    });
    await waitFor(() =>
      expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe(
        "",
      ),
    );

    await user.type(screen.getByLabelText("标题"), "第二个任务");
    await user.click(screen.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.req.headers.get("idempotency-key")).not.toBe(
      first.req.headers.get("idempotency-key"),
    );
  });

  it("400 字段错误 → 回填到对应输入框", async () => {
    const { user } = setup(() =>
      json(
        400,
        envelope("VALIDATION_FAILED", "提交的数据有误", [
          {
            in: "body",
            path: "title",
            rule: "pattern",
            message: "标题不能只包含表情符号",
          },
        ]),
      ),
    );
    await user.type(screen.getByLabelText("标题"), "🎉");
    await user.click(screen.getByRole("button", { name: "创建任务" }));
    expect(await screen.findByText("标题不能只包含表情符号")).toBeTruthy();
    expect(screen.getByLabelText("标题").getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  it("409 唯一冲突 → 标题字段提示", async () => {
    const { user } = setup(() =>
      json(
        409,
        envelope("CONFLICT", "该项目中已有同名的未完成任务", [
          {
            in: "body",
            path: "title",
            rule: "unique",
            message: "该项目中已有同名的未完成任务",
          },
        ]),
      ),
    );
    await user.type(screen.getByLabelText("标题"), "Deploy");
    await user.click(screen.getByRole("button", { name: "创建任务" }));
    expect(
      await screen.findByText("该项目中已有同名的未完成任务"),
    ).toBeTruthy();
  });

  it("403 → 权限横幅；500 → 通用文案 + 请求编号", async () => {
    let status = 403;
    const { user } = setup(() =>
      status === 403
        ? json(403, envelope("FORBIDDEN", "只读成员不能创建或修改任务"))
        : json(500, envelope("INTERNAL", "服务器开小差了，请稍后重试")),
    );
    await user.type(screen.getByLabelText("标题"), "试试");
    await user.click(screen.getByRole("button", { name: "创建任务" }));
    expect(await screen.findByText("没有权限")).toBeTruthy();
    expect(screen.getByText("只读成员不能创建或修改任务")).toBeTruthy();

    status = 500;
    await user.click(screen.getByRole("button", { name: "创建任务" }));
    expect(await screen.findByText("服务器出错了")).toBeTruthy();
    expect(screen.getByText("req-test")).toBeTruthy();
  });

  it("网络错误自动重试，且重试复用同一个幂等键", async () => {
    let calls = 0;
    const { requests, user } = setup(() => {
      calls++;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return json(201, task);
    });
    await user.type(screen.getByLabelText("标题"), "弱网提交");
    await user.click(screen.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    const keys = requests.map((r) => r.req.headers.get("idempotency-key"));
    expect(keys[0]).toBe(keys[1]);
  });
});
