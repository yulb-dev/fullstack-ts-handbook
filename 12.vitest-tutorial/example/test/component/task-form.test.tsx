import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { TaskForm } from "@/ui/task-form.js";

describe("TaskForm 组件（按用户可见行为测试）", () => {
  it("渲染出带标签的输入框和提交按钮（按 role/label 查询，不碰实现细节）", () => {
    render(<TaskForm onSubmit={vi.fn()} />);

    expect(screen.getByRole("form", { name: "创建任务" })).toBeInTheDocument();
    expect(screen.getByLabelText("任务标题")).toBeInTheDocument();
    expect(screen.getByLabelText("截止日期")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建任务" })).toBeEnabled();
  });

  it("必填校验：空标题提交 → 显示错误、aria-invalid 生效、onSubmit 不被调用", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TaskForm onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "创建任务" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "请填写任务标题",
    );
    expect(screen.getByLabelText("任务标题")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("标题超过 80 字符 → 显示长度错误", async () => {
    const user = userEvent.setup();
    render(<TaskForm onSubmit={vi.fn()} />);

    await user.type(screen.getByLabelText("任务标题"), "a".repeat(81));
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "标题不能超过 80 个字符",
    );
  });

  it("提交成功：onSubmit 收到 trim 后的值，表单被清空", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    render(<TaskForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("任务标题"), "  写周报  ");
    await user.type(screen.getByLabelText("截止日期"), "2026-04-01");
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      title: "写周报",
      dueDate: "2026-04-01",
    });
    await waitFor(() =>
      expect(screen.getByLabelText("任务标题")).toHaveValue(""),
    );
  });

  it("不填截止日期 → dueDate 为 null", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    render(<TaskForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("任务标题"), "无截止日期");
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        title: "无截止日期",
        dueDate: null,
      }),
    );
  });

  it("提交进行中：按钮 disabled 且文案变化（防止重复提交的可见证据）", async () => {
    const user = userEvent.setup();
    let resolveSubmit!: () => void;
    const onSubmit = vi.fn(
      () => new Promise<void>((resolve) => (resolveSubmit = resolve)),
    );
    render(<TaskForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("任务标题"), "慢请求");
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    const button = await screen.findByRole("button", { name: "创建中…" });
    expect(button).toBeDisabled();

    resolveSubmit(); // 放行挂起的提交，让组件状态收尾，避免 act 警告
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "创建任务" })).toBeEnabled(),
    );
  });

  it("服务器拒绝（如 409 重名）→ 展示服务器错误消息，表单内容保留", async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<
        (values: { title: string; dueDate: string | null }) => Promise<void>
      >()
      .mockRejectedValueOnce(new Error("已存在同名任务：重构缓存层"));
    render(<TaskForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("任务标题"), "重构缓存层");
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "已存在同名任务：重构缓存层",
    );
    // 失败后不清空：用户可以直接改几个字重新提交
    expect(screen.getByLabelText("任务标题")).toHaveValue("重构缓存层");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
