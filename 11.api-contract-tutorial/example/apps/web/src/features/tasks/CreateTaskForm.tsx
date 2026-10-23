import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@taskflow/api-client";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import { ErrorBanner } from "../../components/ErrorBanner";
import { applyServerFieldErrors } from "../../lib/errors";
import { useCreateTask } from "./api";
import {
  CREATE_TASK_FIELDS,
  PRIORITY_LABEL,
  createTaskFormSchema,
  emptyCreateTaskForm,
  toCreateTaskBody,
  type CreateTaskFormInput,
  type CreateTaskFormOutput,
} from "./task-form-schema";

/** 这些状态码说明「服务端确定没有落库」，换一个新的幂等键再提交是安全的 */
const DEFINITELY_NOT_CREATED = new Set([400, 403, 404, 409]);

export function CreateTaskForm({ projectId }: { projectId: string }) {
  const createTask = useCreateTask(projectId);
  const form = useForm<CreateTaskFormInput, unknown, CreateTaskFormOutput>({
    resolver: zodResolver(createTaskFormSchema),
    defaultValues: emptyCreateTaskForm,
    mode: "onTouched",
  });
  const { errors, isSubmitting } = form.formState;

  // 一次「创建意图」一个键：网络重试复用它；成功或确定失败后才换新键
  const idempotencyKey = useRef(crypto.randomUUID());

  async function onSubmit(values: CreateTaskFormOutput) {
    try {
      await createTask.mutateAsync({
        body: toCreateTaskBody(values),
        idempotencyKey: idempotencyKey.current,
      });
      idempotencyKey.current = crypto.randomUUID();
      form.reset(emptyCreateTaskForm);
    } catch (error) {
      if (
        error instanceof ApiError &&
        DEFINITELY_NOT_CREATED.has(error.status)
      ) {
        idempotencyKey.current = crypto.randomUUID();
      }
      // 400 / 409 的字段错误回到对应输入框；其余错误由下方 ErrorBanner 展示
      applyServerFieldErrors(error, form.setError, CREATE_TASK_FIELDS);
    }
  }

  const fieldProps = (name: (typeof CREATE_TASK_FIELDS)[number]) => ({
    id: `task-${name}`,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `task-${name}-error` : undefined,
  });
  const fieldError = (name: (typeof CREATE_TASK_FIELDS)[number]) =>
    errors[name] && (
      <p id={`task-${name}-error`} className="field-error" role="alert">
        {errors[name]?.message}
      </p>
    );

  // 字段级错误已经回填到输入框上，就不再重复弹横幅
  const showBanner =
    createTask.isError &&
    !(
      createTask.error instanceof ApiError &&
      [400, 409].includes(createTask.error.status)
    );

  return (
    <form
      noValidate
      className="card"
      onSubmit={form.handleSubmit(onSubmit)}
      aria-label="新建任务"
    >
      <h2>新建任务</h2>
      {showBanner && <ErrorBanner error={createTask.error} />}
      {errors.root?.server && (
        <p role="alert" className="field-error">
          {errors.root.server.message}
        </p>
      )}

      <label htmlFor="task-title">标题</label>
      <input {...fieldProps("title")} {...form.register("title")} />
      {fieldError("title")}

      <label htmlFor="task-description">描述</label>
      <textarea
        {...fieldProps("description")}
        rows={3}
        {...form.register("description")}
      />
      {fieldError("description")}

      <label htmlFor="task-priority">优先级</label>
      <select {...fieldProps("priority")} {...form.register("priority")}>
        {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {fieldError("priority")}

      <label htmlFor="task-dueDate">截止日期</label>
      <input
        type="date"
        {...fieldProps("dueDate")}
        {...form.register("dueDate")}
      />
      {fieldError("dueDate")}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "创建中…" : "创建任务"}
      </button>
    </form>
  );
}
