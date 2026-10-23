import { Form, redirect, useNavigation, useSearchParams } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { setSession } from "../auth";

// 登录 action：写入登录态，然后 redirect 回来源页（第 3、4 章）
export async function action({ request }: ActionFunctionArgs) {
  const fd = await request.formData();
  const role = (fd.get("role") as "user" | "admin") ?? "user";
  const from = new URL(request.url).searchParams.get("from") ?? "/";
  setSession({ name: role === "admin" ? "管理员 Ada" : "普通用户 Bob", role });
  return redirect(from);
}

export default function Login() {
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from");
  const submitting = navigation.state === "submitting";

  return (
    <main>
      <h1>登录（演示用）</h1>
      {from && (
        <p>
          登录后将返回：<code>{from}</code>
        </p>
      )}
      <Form method="post">
        <button type="submit" name="role" value="user" disabled={submitting}>
          以普通用户登录
        </button>{" "}
        <button type="submit" name="role" value="admin" disabled={submitting}>
          以管理员登录
        </button>
      </Form>
      <p>提示：以「普通用户」登录后访问 /admin/report 会看到 403（第 6 章）。</p>
    </main>
  );
}
