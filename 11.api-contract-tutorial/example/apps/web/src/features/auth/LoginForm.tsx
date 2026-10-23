import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useLogin } from "./session";

const loginSchema = z.object({
  email: z.email("请输入有效的邮箱"),
});

export function LoginForm() {
  const login = useLogin();
  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "alice@example.com" },
  });
  const emailError = form.formState.errors.email;

  return (
    <form
      noValidate
      className="card"
      onSubmit={form.handleSubmit((values) => login.mutate(values.email))}
    >
      <h1>登录 TaskFlow</h1>
      <p className="hint">
        教学用免密登录：alice（负责人）/ bob（只读）/
        carol（非成员）@example.com
      </p>
      {login.isError && <ErrorBanner error={login.error} />}
      <label htmlFor="email">邮箱</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        aria-invalid={emailError ? true : undefined}
        aria-describedby={emailError ? "email-error" : undefined}
        {...form.register("email")}
      />
      {emailError && (
        <p id="email-error" className="field-error" role="alert">
          {emailError.message}
        </p>
      )}
      <button type="submit" disabled={login.isPending}>
        {login.isPending ? "登录中…" : "登录"}
      </button>
    </form>
  );
}
