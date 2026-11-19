# 第 9 章：关联与传播——把错误、日志、trace 串成一条链

> 本章目标：用 requestId + trace_id 把 Sentry 事件、Pino 日志、OTel trace 串联；理解前后端 trace 传播的两种格式与取舍；落实「避免重复 instrumentation」。
>
> 关键概念：前后端关联、避免重复 instrumentation、明确 Sentry 与 OTel 的范围。

---

## 9.1 三个 ID 的分工

| ID        | 粒度       | 串起什么                        |
| --------- | ---------- | ------------------------------- |
| requestId | 一次请求   | 前端事件 ↔ 后端日志 ↔ envelope  |
| trace_id  | 一次因果链 | 跨服务/跨异步的所有 span + 日志 |
| span_id   | 一个操作   | 定位到具体哪一段                |

本教程的关联设计（实测成立）：

```
前端 Sentry 事件 ──tags.requestId──┐
后端 Pino 日志 ──reqId + trace_id──┼──> 同一次请求
OTel trace ──trace_id──────────────┘
```

- 日志 mixin 注入 trace_id/span_id（第 2 章）→ 日志能跳到 trace；
- Sentry 事件带 requestId tag（第 5、6 章）→ 事件能跳到日志；
- 三者由 requestId/trace_id 闭环。

## 9.2 实测验证

`pnpm smoke:api` 后触发 `FAIL_DB`，日志里：

```json
{
  "level": 50,
  "reqId": "req-2",
  "trace_id": "d9ae5f66...",
  "span_id": "a04c9fc5...",
  "statusCode": 500,
  "code": "INTERNAL_ERROR",
  "msg": "request failed"
}
```

同一个 trace_id 出现在 console 打印的 span 里——**日志与 trace 指向同一次请求**。测试 `telemetry.test.ts` 用断言钉死这个关联（mixin 返回值 === span.spanContext()）。

## 9.3 前后端 trace 传播：两种格式与取舍

| 格式              | 谁用            | 头                       |
| ----------------- | --------------- | ------------------------ |
| W3C Trace Context | OTel 默认       | traceparent / tracestate |
| Sentry Trace      | Sentry 前端 SDK | sentry-trace / baggage   |

本教程前端用 Sentry browserTracingIntegration（发 sentry-trace/baggage），后端用 OTel（默认解析 traceparent）。**两者格式不同**，要打通有两条路：

1. **requestId 关联（本教程采用）**：不依赖 trace 头格式一致，前端把后端 requestId 带进 Sentry 事件。简单、可靠、零额外配置——满足路线图「按支持情况配置上下文传播」；
2. **统一传播格式（进阶）**：让后端 Sentry 也启用 tracing 并解析 sentry-trace，或前端改用 OTel web SDK 发 traceparent。代价是复杂度与重复插桩风险。

路线图要求「至少一个关键业务流程可串联定位」——requestId 路径已达成。trace 头打通是锦上添花，按需选择。

## 9.4 避免重复 instrumentation（核心概念⑧）

Sentry v8+ 底层用 OTel。若两边都开 tracing，同一请求会被插桩两遍——span 重复、数据打架。本教程的分工：

```ts
// OTel 拥有 tracing
const sdk = new NodeSDK({ ... }); sdk.start();

// Sentry 只管错误，关联到 OTel 的活跃 span
Sentry.init({
  enableOpenTelemetrySetup: false,   // 不让 Sentry 自建 OTel 管线
  // 不设 tracesSampleRate / tracesSampler
  integrations: (defaults) => [
    ...defaults.filter((i) => i.name !== "Fastify"),  // 去掉与 OTel 重叠的插桩
    Sentry.openTelemetryIntegration(),                // 错误 ↔ 活跃 span 关联
  ],
});
```

范围划分：

| 能力       | 谁负责                   |
| ---------- | ------------------------ |
| 错误采集   | Sentry                   |
| trace 生成 | OTel（自动 + 手动 span） |
| trace 导出 | OTel → collector/Jaeger  |
| 错误展示   | Sentry UI                |
| trace 展示 | Jaeger UI                |

若想把 span 也送进 Sentry，可加 `Sentry.getOtlpTracesEndpoint(dsn)` 的 OTLP exporter（官方 custom-setup 文档）——但那是「OTel 拥有 tracing、Sentry 作为后端之一」，仍不重复插桩。

## 9.5 常见坑

| 现象                      | 原因                       | 解决                               |
| ------------------------- | -------------------------- | ---------------------------------- |
| 日志与 trace 对不上       | mixin 没注入 / 无活跃 span | startActiveSpan + mixin            |
| 前后端 trace 串不起       | 传播格式不同               | requestId 关联（9.3）或统一格式    |
| 同一请求两套 span         | Sentry + OTel 都开 tracing | enableOpenTelemetrySetup: false    |
| Sentry 事件找不到后端日志 | 事件没带 requestId         | captureException 带 tags.requestId |

## 9.6 本章验收清单

- [ ] 能解释 requestId/trace_id/span_id 的分工；
- [ ] 实测日志 trace_id 与 span 一致，测试钉死；
- [ ] 能说出两种传播格式与本教程的取舍；
- [ ] 落实避免重复 instrumentation，能划分 Sentry/OTel 范围。

---

上一章：[← 第 8 章：OTel Node 插桩实战](./08-otel-node-instrumentation.md) ｜ 下一章：[第 10 章：采样、隐私与成本 →](./10-sampling-privacy-cost.md) ｜ 返回：[教程目录 README](./README.md)
