# 第 7 章：OpenTelemetry 心智模型

> 本章目标：理解 OTel 的核心概念——API/SDK 分离、trace/span、attributes/resources、context propagation、exporter 与 collector；认清 JS 各信号的成熟度差异。
>
> 关键概念：OpenTelemetry 的 API/SDK、traces/spans、attributes/resources、context propagation、exporter 与 collector。

---

## 7.1 OTel 是什么

OpenTelemetry（OTel）是**可观测性数据的生成与采集标准 + 工具集**。它定义 trace/metric/log 的统一数据模型与 API，提供各语言 SDK 与自动插桩，把数据导出到任意后端（Jaeger、Tempo、Sentry、云厂商）。**厂商中立**是它的核心价值：换后端不用改应用代码。

## 7.2 API 与 SDK 分离

| 层  | 职责                                 | 包                         |
| --- | ------------------------------------ | -------------------------- |
| API | 定义「怎么创建 span/记录属性」的接口 | @opentelemetry/api         |
| SDK | 实现「怎么处理/采样/导出」           | @opentelemetry/sdk-node 等 |

业务代码只依赖 API（`trace.getTracer(...).startActiveSpan(...)`）；SDK 在启动时注册实现。**没注册 SDK 时 API 是 no-op**——库作者可以安全地 instrument 而不强制用户接 OTel。

## 7.3 trace 与 span

- **trace**：一次请求的完整因果链（一棵树），由 traceId 标识；
- **span**：树中的一个操作节点（一次 HTTP 处理、一次 DB 查询、一段业务逻辑），有名字、起止时间、状态、属性；
- **parent/child**：span 通过 parentSpanId 组成树。

```
trace (traceId=abc)
└─ POST /api/tasks            ← http server span（自动插桩）
   └─ task.create             ← 手动业务 span
      └─ pg query INSERT      ← pg client span（自动插桩）
```

本教程实测的 span 树正是这个结构（第 8 章验证）。

## 7.4 attributes 与 resources

- **attributes**：span 上的键值对（`task.id`、`http.route`、`db.statement`）——描述「这个操作的具体信息」；
- **resources**：进程级的键值对（`service.name`、`service.version`、`deployment.environment.name`）——描述「这条遥测来自谁」。

resource 让后端能按服务/版本/环境过滤。本教程用 `resourceFromAttributes` 设置（第 8 章）。

## 7.5 context propagation：跨服务/跨异步的因果链

span 的父子关系靠 **context** 传递：

- **进程内**：OTel 用 AsyncLocalStorage 在异步调用间传播 active span——所以 `request.log` 的 mixin 能拿到当前 span；
- **跨服务**：通过 HTTP 头传播。两种主流格式：
  - **W3C traceparent/tracestate**（OTel 默认）：`traceparent: 00-<traceId>-<spanId>-01`；
  - **sentry-trace/baggage**（Sentry 前端用）。

前端请求带 trace 头 → 后端解析并延续同一个 traceId → 前后端 span 在同一棵树里（第 9 章取舍）。

## 7.6 exporter 与 collector

- **exporter**：把 span 发出去（ConsoleSpanExporter 打印、OTLPTraceExporter 走 OTLP 协议）；
- **collector**：独立的中转服务，接收 → 处理（采样/脱敏/批处理）→ 分发到多个后端。

```
应用 ──OTLP──> collector ──> Jaeger / Tempo / Sentry
```

collector 的价值：**解耦应用与后端**——换后端、加采样、统一脱敏都在 collector 做，应用不动。本教程 compose 里 API → collector → Jaeger。

## 7.7 JS 各信号成熟度（路线图边界原话）

| 信号       | 状态         |
| ---------- | ------------ |
| Traces     | Stable       |
| Metrics    | Stable       |
| Logs       | Development  |
| 浏览器插桩 | Experimental |

**不要假定三者 API 成熟度一致**。本教程只用 traces（最成熟）；日志用 Pino 而非 OTel logs SDK。升级依赖前查官方 status 页与具体 instrumentation 的版本支持（第 8 章的 fastify 坑就是例证）。

## 7.8 常见坑

| 现象                             | 原因                       | 解决                                   |
| -------------------------------- | -------------------------- | -------------------------------------- |
| 业务代码 instrument 了但没数据   | 没注册 SDK（API 是 no-op） | 启动时 NodeSDK.start()                 |
| span 不成树                      | context 没传播             | 用 startActiveSpan / 正确的 propagator |
| 后端分不清服务                   | resource 没设 service.name | resourceFromAttributes                 |
| 假定 logs SDK 与 traces 一样成熟 | 成熟度不同                 | 查 status；日志暂用 Pino               |

## 7.9 本章验收清单

- [ ] 能解释 API/SDK 分离及 no-op 行为；
- [ ] 能画出 trace/span 树并解释 attributes vs resources；
- [ ] 能解释进程内与跨服务 context propagation；
- [ ] 能说出 exporter 与 collector 的分工；
- [ ] 能列出 JS 各信号成熟度差异。

---

上一章：[← 第 6 章：Sentry 后端接入](./06-sentry-node.md) ｜ 下一章：[第 8 章：OTel Node 插桩实战 →](./08-otel-node-instrumentation.md) ｜ 返回：[教程目录 README](./README.md)
