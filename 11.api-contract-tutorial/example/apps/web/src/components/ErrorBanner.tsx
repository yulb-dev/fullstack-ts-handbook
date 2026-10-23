import { describeError } from "../lib/errors";

/** 统一的错误展示：标题 + 说明 + 可复制的请求编号 + 下一步动作 */
export function ErrorBanner({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const view = describeError(error);
  if (view.action === "none" && !view.message) return null;
  return (
    <div role="alert" className="error-banner">
      <strong>{view.title}</strong>
      {view.message && <p>{view.message}</p>}
      {view.requestId && (
        <p className="request-id">
          请求编号：<code>{view.requestId}</code>
        </p>
      )}
      {view.action === "retry" && onRetry && (
        <button type="button" onClick={onRetry}>
          重试
        </button>
      )}
      {view.action === "reload" && (
        <button type="button" onClick={() => window.location.reload()}>
          刷新页面
        </button>
      )}
    </div>
  );
}
