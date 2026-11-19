# 第 6 章：Sentry 后端接入——显式捕获与隐私

> 本章目标：在 Fastify 接入 @sentry/node；用显式捕获 + requestId tag 关联错误；用 dataCollection 关闭敏感采集；理解与 OTel 的初始化顺序。
>
> 对应核心概念：**① Sentry 后端；⑦ 隐私与安全。**

---

## 6.1 初始化：在 OTel 之后、应用之前

`apps/api/src/instrumentation.ts`（节选）：

```ts
import * as Sentry from "@sentry/node";

// OTel NodeSDK 已先 start()（第 8 章）——顺序很重要
Sentry.init({
  dsn: process.env.SENTRY_DSN, // 未设置时禁用发送
  environment, // NODE_ENV
  release: process.env.APP_VERSION,
  enableOpenTelemetrySetup: false, // OTel 拥有 tracing（第 9 章）
  // 不设 tracesSampleRate / tracesSampler
  integrations: (defaults) => [
    ...defaults.filter((i) => i.name !== "Fastify"), // 去掉默认 Fastify 集成，避免与 OTel 重复
    Sentry.openTelemetryIntegration(), // 把错误关联到活跃 OTel span
  ],
  dataCollection: {
    userInfo: false, // 不采集用户身份
    cookies: false, // 不采集 Cookie
    httpBodies: [], // 不采集请求体
    urlQueryParams: false, // 不采集 URL 查询参数
  },
});
```

两个要点：

1. **OTel provider 先启动，再 Sentry.init**——`openTelemetryIntegration()` 需要已存在的 OTel 管线；
2. **`enableOpenTelemetrySetup: false` + 不设采样率**：Sentry 不再自建 tracing，避免重复插桩（第 9 章）。

## 6.2 显式捕获：带 requestId tag

本教程不依赖 Sentry 的自动错误捕获，而在统一错误出口**显式捕获**（`app.ts`）：

```ts
if (statusCode >= 500) {
  Sentry.captureException(err, {
    tags: { requestId: request.id, errorCode: code },
  });
}
```

为什么显式：

- **确定性**：精确控制哪些错误上报（只 5xx；4xx 是预期业务拒绝，不该刷 issue）；
- **关联**：打上 requestId tag，与日志/trace/前端事件串联；
- **避免重复**：去掉默认 Fastify 集成后，不会自动再捕获一遍。

> Sentry 的 fastifyIntegration 默认跳过 3xx/4xx、捕获 5xx，可用 shouldHandleError 自定义。本教程选择显式捕获以获得 requestId 控制权——两种路径都可，关键是**别重复捕获**。

## 6.3 隐私：dataCollection 与 beforeSend

`dataCollection`（v11）按类别关闭自动采集：userInfo / cookies / httpBodies / urlQueryParams。这是「默认不采集敏感数据」的开关。

更细的审查用 `beforeSend`（发送前最后一道闸）：

```ts
Sentry.init({
  beforeSend(event) {
    // 例：删除可能含敏感信息的字段
    if (event.request?.headers) delete event.request.headers["authorization"];
    return event; // 返回 null 可丢弃整个事件
  },
});
```

**审查清单**（路线图要求）：breadcrumbs（导航/控制台面包屑）、请求体、source maps 都可能带敏感信息。第 10 章系统展开。

## 6.4 优雅关闭时冲刷

`server.ts` 关闭时调用 `Sentry.close(2000)`（在 `shutdownTelemetry` 里），确保未发送的事件在进程退出前发出——否则崩溃前最后几条错误可能丢失。

## 6.5 常见坑

| 现象                   | 原因                    | 解决                               |
| ---------------------- | ----------------------- | ---------------------------------- |
| 错误事件没有 requestId | 没显式打 tag            | captureException 带 tags.requestId |
| 4xx 也刷 issue         | 自动捕获没过滤          | 只捕获 5xx / shouldHandleError     |
| 同一错误上报两次       | 默认集成 + 显式捕获重复 | 去掉默认 Fastify 集成              |
| 事件含 Cookie/请求体   | dataCollection 没关     | 6.1 配置 + beforeSend 审查         |
| 崩溃前错误丢失         | 没冲刷                  | Sentry.close(2000)                 |

## 6.6 本章验收清单

- [ ] Sentry 在 OTel 之后初始化，enableOpenTelemetrySetup: false；
- [ ] 5xx 显式捕获并带 requestId tag，4xx 不刷 issue；
- [ ] dataCollection 关闭敏感采集；
- [ ] 能列出三类需审查的泄漏面（breadcrumbs/请求体/source maps）。

---

上一章：[← 第 5 章：Sentry 前端接入](./05-sentry-react.md) ｜ 下一章：[第 7 章：OpenTelemetry 心智模型 →](./07-otel-mental-model.md) ｜ 返回：[教程目录 README](./README.md)
