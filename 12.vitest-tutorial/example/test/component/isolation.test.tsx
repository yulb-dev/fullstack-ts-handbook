import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { TaskPage } from "@/ui/task-page.js";
import { initialDraftState, useDraftStore } from "@/ui/draft-store.js";
import { renderWithProviders } from "../test-utils.js";
import { TaskForm } from "@/ui/task-form.js";

/**
 * mock 停在「组件世界与网络世界」的边界：只替换 api-client 模块，
 * 组件、React Query、store 都跑真实实现。
 */
vi.mock("@/ui/api-client.js", () => ({
  ApiError: class ApiError extends Error {},
  createTask: vi.fn(async () => ({ ok: true })),
  listTasks: vi.fn(async () => ({ items: [] })),
}));

describe("QueryClient 隔离：每个测试自己的缓存", () => {
  it("测试 A：往缓存写入数据", async () => {
    const { queryClient } = renderWithProviders(
      <TaskForm onSubmit={vi.fn()} />,
    );
    queryClient.setQueryData(["tasks"], ["测试 A 留下的数据"]);

    expect(queryClient.getQueryData(["tasks"])).toEqual(["测试 A 留下的数据"]);
  });

  it("测试 B：全新 QueryClient 看不到测试 A 的缓存", async () => {
    const { queryClient } = renderWithProviders(
      <TaskForm onSubmit={vi.fn()} />,
    );

    // 如果两个测试共享一个模块级 QueryClient，这里会读到测试 A 的数据——污染发生了
    expect(queryClient.getQueryData(["tasks"])).toBeUndefined();
  });

  it("不套 Provider 直接用 useCreateTask 会抛错——证明 client 确实来自注入", async () => {
    const { useCreateTask } = await import("@/ui/use-create-task.js");
    function Probe() {
      useCreateTask();
      return null;
    }
    // 抑制 React 抛错时打印的 error 日志，保持测试输出干净
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow();
    spy.mockRestore();
  });
});

describe("Zustand store 隔离：模块级单例必须显式重置", () => {
  beforeEach(() => {
    // store 是模块级单例，跨测试共享同一份状态：每个测试前恢复初始值
    useDraftStore.setState(initialDraftState);
  });

  it("测试 A：把草稿改成「A 的草稿」", () => {
    useDraftStore.getState().setDraftTitle("A 的草稿");
    expect(useDraftStore.getState().draftTitle).toBe("A 的草稿");
  });

  it("测试 B：因为有 beforeEach 重置，看到的仍是初始值", () => {
    // 删掉 beforeEach 里的 setState，这个测试就会读到「A 的草稿」而失败
    expect(useDraftStore.getState().draftTitle).toBe("");
  });
});

describe("TaskPage 组合：mutation + store + Provider 一起工作", () => {
  beforeEach(() => {
    useDraftStore.setState(initialDraftState);
  });

  it("提交成功后展示状态区域，并把标题写进草稿 store", async () => {
    const user = userEvent.setup();
    render(<TaskPage />);

    await user.type(screen.getByLabelText("任务标题"), "打通全链路");
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "已创建：打通全链路",
    );
    expect(useDraftStore.getState().draftTitle).toBe("打通全链路");
  });

  it("再次渲染（新 QueryClient）不受上一个测试的 mutation 状态影响", async () => {
    render(<TaskPage />);

    // 上一个测试 mutation 已成功；如果 QueryClient 被共享，这里可能直接出现 status 区域
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(useDraftStore.getState().draftTitle).toBe("");
    await waitFor(() =>
      expect(
        screen.getByRole("form", { name: "创建任务" }),
      ).toBeInTheDocument(),
    );
  });
});

describe("每个测试新建 QueryClient 的正确姿势", () => {
  it("QueryClient 不能跨 render 复用：clear 只清缓存，不清 mutation 观察者", () => {
    const client = new QueryClient();
    client.setQueryData(["k"], 1);
    client.clear();
    expect(client.getQueryData(["k"])).toBeUndefined();
    // 结论：与其 shared client + clear，不如每个测试 new 一个——成本几乎为零
  });
});
