import { isRouteErrorResponse, useRouteError, Link } from "react-router";

// 根错误边界：区分 404 / 403 / 意外崩溃 / 未知（第 6 章）
export default function RootErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    const message = typeof error.data === "string" ? error.data : "请求失败";

    if (error.status === 404) {
      return (
        <Shell title="404 · 没找到">
          <p>{message}</p>
        </Shell>
      );
    }
    if (error.status === 403) {
      return (
        <Shell title="403 · 无权限">
          <p>{message}</p>
          <p>
            <Link to="/login">换个账号登录</Link>
          </p>
        </Shell>
      );
    }
    return (
      <Shell title={`${error.status} ${error.statusText}`}>
        <p>{message}</p>
      </Shell>
    );
  }

  if (error instanceof Error) {
    return (
      <Shell title="出错了">
        <p>{error.message}</p>
        {/* 仅开发环境展示堆栈，避免生产泄露技术细节 */}
        {import.meta.env.DEV && <pre>{error.stack}</pre>}
      </Shell>
    );
  }

  return (
    <Shell title="未知错误">
      <p>发生了意料之外的情况。</p>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main>
      <h1>{title}</h1>
      {children}
      <p>
        <Link to="/">回到首页</Link>
      </p>
    </main>
  );
}
