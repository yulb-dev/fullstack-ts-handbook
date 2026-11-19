# 第 2 章：结构化日志与 Pino

> 本章目标：理解结构化日志为什么是排障地基；用 Fastify 内置 Pino 输出可查询字段；用 redact 做敏感字段脱敏；理解子 logger 与日志级别。
>
> 关键概念：Fastify/Pino 结构化日志——requestId、route、duration、statusCode、error code 等可查询字段。

---

## 2.1 为什么是结构化日志

```
# 非结构化：人能读，机器难查
2026-11-18 ERROR 创建任务失败 user=42 task=abc

# 结构化（JSON）：每个字段可索引、可过滤、可聚合
{"level":50,"time":1794996885032,"reqId":"req-2","trace_id":"d9ae...","statusCode":500,"code":"INTERNAL_ERROR","msg":"request failed"}
```

排障时你会问「给我所有 statusCode=500 且 code=INTERNAL_ERROR 的日志」——结构化日志让这成为一次查询，而不是 grep 正则地狱。**日志的价值取决于它能否被机器查询**。

## 2.2 Fastify 内置 Pino

Fastify 默认集成 Pino（一个高性能的 JSON 日志库；logger 就是「写日志的工具」，替代你随手写的 console.log）。开启即自动记录请求/响应：

```ts
const app = Fastify({ logger: true });
```

默认每条请求日志已含：`reqId`（requestId）、`req.method`、`req.url`、`res.statusCode`、`responseTime`（duration）。这些正是路线图要求的可查询字段。

本教程在此基础上加两件事（`src/logger.ts`）：

```ts
import { trace } from "@opentelemetry/api";
import type { FastifyServerOptions } from "fastify";

export function traceMixin(): Record<string, string> {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const ctx = span.spanContext();
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}

export function loggerOptions(): NonNullable<FastifyServerOptions["logger"]> {
  return {
    level: process.env.LOG_LEVEL ?? "info",
    mixin: traceMixin, // 每条日志注入当前 span 的 trace_id/span_id（第 9 章关联）
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.password",
        "*.token",
        "*.secret",
      ],
      censor: "[REDACTED]",
    },
  };
}
```

- **mixin**：Pino 在每条日志输出前调用，返回要合并的字段。这里把 OTel 活跃 span 的 trace_id/span_id 注入——日志与 trace 由此关联（第 9 章详解）；
- **redact**：按路径脱敏。`req.headers.cookie`、任何层级的 `*.password` 等被替换为 `[REDACTED]`。**这是隐私红线的第一道闸**。

## 2.3 字段设计：可查询 + 不泄密

| 字段             | 来源               | 用途                     |
| ---------------- | ------------------ | ------------------------ |
| reqId            | Fastify request.id | 关联同一次请求的所有日志 |
| trace_id/span_id | OTel mixin         | 关联 trace               |
| statusCode       | 响应               | 过滤错误                 |
| code             | 业务错误码         | 区分错误类型             |
| route            | 路由               | 按接口聚合               |
| responseTime     | Fastify            | 延迟分析                 |

**不该出现的字段**：密码、token、Cookie、完整请求体、个人敏感信息。redact 兜底，但更好的做法是**一开始就不记录**（第 10 章）。

## 2.4 子 logger 与级别

```ts
request.log.info({ taskId }, "task created"); // 子 logger 自动带 reqId
app.log.warn("..."); // 应用级
```

`request.log` 是绑定了当前请求上下文的子 logger——它写的每条日志自动带 reqId，无需手动传。级别：`trace < debug < info < warn < error < fatal`；生产用 `info`，排障临时调 `debug`（`LOG_LEVEL` 环境变量）。

## 2.5 常见坑

| 现象                     | 原因                              | 解决                        |
| ------------------------ | --------------------------------- | --------------------------- |
| 日志里能看到 Cookie/密码 | 没配 redact                       | redact paths + 不记录请求体 |
| 日志没有 requestId       | 用了 console.log 而非 request.log | 一律用 Fastify logger       |
| trace_id 缺失            | mixin 没配 / 无活跃 span          | 第 8、9 章接 OTel           |
| 日志量太大               | debug 级别上生产                  | 生产 info；按需临时调级     |

## 2.6 本章验收清单

- [ ] 能解释结构化日志为什么是排障地基；
- [ ] 能列出 Fastify 默认日志字段与额外注入的字段；
- [ ] redact 配置生效，敏感字段被脱敏；
- [ ] 会用 request.log 子 logger 与日志级别。

---

上一章：[← 第 1 章：为什么需要可观测性](./01-why-observability.md) ｜ 下一章：[第 3 章：requestId 与错误 envelope →](./03-request-id-error-envelope.md) ｜ 返回：[教程目录 README](./README.md)
