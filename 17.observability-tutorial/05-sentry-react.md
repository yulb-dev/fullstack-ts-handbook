# 第 5 章：Sentry 前端接入——React 19 错误钩子与 source maps

> 本章目标：接入 @sentry/react；用 React 19 错误钩子 + ErrorBoundary 捕获渲染错误；配置 release/environment；建立 source maps 上传策略；触发前端异常并按 release/environment 找到它（练习 1）。
>
> 关键概念：Sentry 前端——错误事件、release/environment、source maps。｜ 动手练习：练习 1。

---

## 5.1 初始化：入口的第一个 import

`apps/web/src/instrument.ts`：

```ts
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN, // 未设置时 SDK 自动禁用发送
  environment: import.meta.env.MODE, // development / production
  release: import.meta.env.VITE_APP_VERSION,
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 0.1, // 前端性能采样（第 10 章）
  tracePropagationTargets: ["localhost", /^\//], // 只给同源 API 附加 trace 头
  dataCollection: { userInfo: false }, // 隐私
});
```

`main.tsx` 第一行 `import "./instrument"`——**必须先于 React 渲染**，否则早期错误漏捕。

> Vite 环境变量只暴露 `VITE_` 前缀。DSN 是公钥可放前端；`SENTRY_AUTH_TOKEN` 绝不加 VITE\_ 前缀（第 5.4 节）。

## 5.2 React 19 错误钩子 + ErrorBoundary

React 19 的 `createRoot` 提供错误钩子，直接接 Sentry：

```tsx
import "./instrument";
import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root")!, {
  onUncaughtError: Sentry.reactErrorHandler((error, errorInfo) => {
    console.warn("Uncaught error", error, errorInfo.componentStack);
  }),
  onCaughtError: Sentry.reactErrorHandler(), // ErrorBoundary 捕获的
  onRecoverableError: Sentry.reactErrorHandler(), // React 自动恢复的
}).render(<App />);
```

ErrorBoundary 提供降级 UI（`App.tsx`）：

```tsx
<Sentry.ErrorBoundary
  fallback={<p role="alert">页面渲染出错，已上报 Sentry。</p>}
>
  <main>...</main>
</Sentry.ErrorBoundary>
```

示例有个「触发前端渲染异常」按钮，点击后渲染一个故意 throw 的 `<Boom />` 组件——ErrorBoundary 兜底 + 上报。

## 5.3 把后端 requestId 带进 Sentry 事件（关联关键）

API 失败时，前端把后端返回的 requestId 作为 tag 上报（`App.tsx`）：

```ts
const body = (await res.json()) as {
  error: { code: string; message: string; requestId: string };
};
Sentry.captureException(
  new Error(`API ${body.error.code}: ${body.error.message}`),
  {
    tags: { requestId: body.error.requestId, errorCode: body.error.code },
  },
);
```

这样 Sentry 事件就带上了后端 requestId——排障时从事件 → requestId → 后端日志/trace（第 9、11 章）。**这是前后端关联的最简可靠路径**。

## 5.4 source maps 上传策略

生产堆栈是压缩代码，需要 source maps 还原。策略（`vite.config.ts`）：

```ts
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);
export default defineConfig({
  plugins: [
    react(),
    ...(uploadSourceMaps
      ? sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN, // 秘密，只在 CI/发布环境
          release: { name: process.env.APP_VERSION },
          sourcemaps: {
            assets: "./dist/**",
            filesToDeleteAfterUpload: "./dist/**/*.map",
          },
        })
      : []),
  ],
  build: { sourcemap: true }, // 生成 map
});
```

三步：**生成 map → 上传到 Sentry（带 release）→ 删除公开产物里的 .map**。最后一步关键：map 含源码，不能留给终端用户下载。release 必须与 SDK init 的 release 一致，Sentry 才能匹配。

## 5.5 练习 1：触发并找到错误

```bash
# 配置 VITE_SENTRY_DSN + VITE_APP_VERSION 后：
pnpm --filter @workboard/web dev
# 点「触发前端渲染异常」→ Sentry 项目出现 issue
# 在 Sentry 按 environment=development、release=<你的版本> 过滤找到它
# 堆栈经 source maps 还原到 App.tsx 的 Boom 组件
```

无 DSN 时 SDK 禁用发送，页面仍正常兜底——本地零配置可演练交互。

## 5.6 常见坑

| 现象                    | 原因                           | 解决                                        |
| ----------------------- | ------------------------------ | ------------------------------------------- |
| 早期错误没捕获          | instrument 不是第一个 import   | 入口首行 import                             |
| 堆栈是 minified 代码    | 没上传 map / release 不匹配    | 5.4 三步 + release 一致                     |
| 源码被用户下载          | map 留在公开产物               | filesToDeleteAfterUpload                    |
| AUTH_TOKEN 泄漏到前端   | 加了 VITE\_ 前缀               | 只用 `SENTRY_AUTH_TOKEN`（无 `VITE_` 前缀） |
| 控制台手动 throw 不上报 | DevTools 沙箱错误不被 SDK 捕获 | 用页面按钮触发（官方说明）                  |

## 5.7 本章验收清单

- [ ] 完成练习 1：前端异常按 release/environment 在 Sentry 找到；
- [ ] React 19 错误钩子 + ErrorBoundary 生效；
- [ ] source maps 三步策略清楚，map 不公开；
- [ ] 后端 requestId 作为 tag 进入 Sentry 事件。

---

上一章：[← 第 4 章：Sentry 心智模型](./04-sentry-mental-model.md) ｜ 下一章：[第 6 章：Sentry 后端接入 →](./06-sentry-node.md) ｜ 返回：[教程目录 README](./README.md)
