import { data, redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { getSession } from "../../auth";

// 第 6 章：未登录 → redirect 到登录页；已登录但非管理员 → throw 403
// 第 8 章：本文件通过 router 的 lazy 动态 import，只有访问 /admin/report 时才下载
export async function loader({ request }: LoaderFunctionArgs) {
  const user = getSession();
  if (!user) {
    const from = new URL(request.url).pathname;
    return redirect(`/login?from=${encodeURIComponent(from)}`);
  }
  if (user.role !== "admin") {
    throw data("你没有权限访问后台报表", { status: 403 });
  }
  return { user, revenue: 128_000 };
}

export default function AdminReport() {
  const { user, revenue } = useLoaderData() as {
    user: { name: string; role: string };
    revenue: number;
  };
  return (
    <main>
      <h1>后台报表</h1>
      <p>
        你好，{user.name}（管理员）。本月票房收入：¥{revenue.toLocaleString()}
      </p>
      <p>
        <small>
          这个路由是懒加载的：首次访问时才会下载它的代码 chunk（打开 DevTools → Network 观察）。
        </small>
      </p>
    </main>
  );
}
