import { useForm } from "react-hook-form";
import { z } from "zod";

/** 表单级 schema：只校验「用户此刻能改」的字段；服务器规则（如重名）走提交错误 */
const formSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "请填写任务标题")
    .max(80, "标题不能超过 80 个字符"),
  dueDate: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export interface TaskFormResult {
  title: string;
  dueDate: string | null;
}

export interface TaskFormProps {
  /** 提交动作注入进来：组件测试传 stub，真实页面传 useCreateTask().mutateAsync */
  onSubmit: (values: TaskFormResult) => Promise<void>;
}

/**
 * 可访问性优先的表单：
 * - 每个输入都有 <label htmlFor>（getByLabelText 可查询）
 * - 错误通过 aria-describedby 关联到输入（读屏可感知）
 * - 提交中按钮 disabled（测试断言 disabled 状态防止重复提交）
 */
export function TaskForm({ onSubmit }: TaskFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { title: "", dueDate: "" },
  });

  async function handleValid(values: FormValues) {
    try {
      await onSubmit({
        title: values.title.trim(), // 服务端 schema 也会 trim，但表单不应把脏值交出去
        dueDate: values.dueDate ? values.dueDate : null,
      });
    } catch (error) {
      // 服务器拒绝（如重名 409）：把错误挂到表单根级别，用 role="alert" 展示
      setError("root", {
        message:
          error instanceof Error ? error.message : "创建失败，请稍后重试",
      });
      return;
    }
    reset();
  }

  return (
    <form
      noValidate
      aria-label="创建任务"
      onSubmit={handleSubmit(handleValid)}
      style={{ display: "grid", gap: 12, maxWidth: 360 }}
    >
      <div>
        <label htmlFor="task-title">任务标题</label>
        <input
          id="task-title"
          type="text"
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? "task-title-error" : undefined}
          {...register("title", {
            required: "请填写任务标题",
            validate: (value) => {
              const parsed = formSchema.shape.title.safeParse(value);
              return parsed.success
                ? true
                : (parsed.error.issues[0]?.message ?? "标题不合法");
            },
          })}
        />
        {errors.title && (
          <p id="task-title-error" role="alert">
            {errors.title.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="task-due">截止日期</label>
        <input id="task-due" type="date" {...register("dueDate")} />
      </div>

      {errors.root && (
        <p role="alert" id="task-form-error">
          {errors.root.message}
        </p>
      )}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "创建中…" : "创建任务"}
      </button>
    </form>
  );
}
