# 第 8 章：OTel Node 插桩实战——看到 server span

> 本章目标：用 NodeSDK + 自动插桩 instrument Fastify API；处理 ESM loader hook；用 console/OTLP exporter 按环境导出；写手动业务 span；避开两个实测版本坑；完成练习 3。
>
> 对应核心概念：**② OTel 插桩、exporter。** 对应练习：**练习 3。**

---

## 8.1 NodeSDK 一站式初始化

`apps/api/src/instrumentation.ts`（节选）：

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace";

const useOtlp = Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    "service.name": process.env.OTEL_SERVICE_NAME ?? "workboard-api",
    "service.version": process.env.APP_VERSION ?? "0.0.0",
    "deployment.environment.name": environment,
  }),
  spanProcessors: [
    useOtlp
      ? new BatchSpanProcessor({ exporter: new OTLPTraceExporter() }) // 生产：攒批发到 collector
      : new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() }), // 本地：立即打印
  ],
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
    }),
  ],
});
sdk.start();
```

- **自动插桩**：`getNodeAutoInstrumentations()` 一次性启用 http/pg/dns 等库的插桩——无需改业务代码就有 server span 与 DB span；
- **按环境切 exporter**：本地 console（看得见的反馈），生产 OTLP（到 collector）。

## 8.2 实测坑 1：sdk-trace 3.x 构造器变了

```ts
new SimpleSpanProcessor(exporter); // ✗ 2.x 写法，3.x 类型报错且运行时不导出
new SimpleSpanProcessor({ exporter }); // ✓ 3.x：options 对象
```

`@opentelemetry/sdk-trace` 3.x 把 `SimpleSpanProcessor`/`BatchSpanProcessor` 的构造器从「位置参数 exporter」改为「`{ exporter }` 对象」。照抄旧教程会踩。**以你安装到的主版本文档为准**（路线图附录 B 的原则）。

## 8.3 实测坑 2：instrumentation-fastify 不支持 Fastify 5

`@opentelemetry/instrumentation-fastify`（0.57）当前仅支持 Fastify 3/4，对 Fastify 5 **静默不生效**（不报错，只是没有 fastify span）。应对：

- **http 自动插桩已提供 server span**（`POST` span），满足路线图「至少看到 server span」；
- 业务细节用**手动 span** 补充（8.5）；
- 关注 instrumentation 的版本支持矩阵，升级 Fastify 大版本时复核。

这正是路线图边界原话的实例：「具体 instrumentation 与导出器版本……不要假定……成熟程度完全一致」。

## 8.4 ESM 必须加载 loader hook

OTel 自动插桩要 patch 模块加载。ESM 下需要 hook：

```bash
# 开发（tsx）：--import 先加载 instrumentation
tsx --import ./src/instrumentation.ts src/server.ts

# 生产（node ESM）：先 hook.mjs，再 instrumentation，再 server
node --import @opentelemetry/instrumentation/hook.mjs --import ./dist/instrumentation.js dist/server.js
```

`hook.mjs` 由 `@opentelemetry/instrumentation` 提供。**漏了它，ESM 项目的自动插桩不生效**（CJS 用 --require 则不需要）。Dockerfile 的 CMD 已带这两个 --import（阶段 15 模式 + OTel）。

## 8.5 手动业务 span

自动插桩给的是「技术 span」（http/pg）；业务语义要手动标注（`app.ts`）：

```ts
import { SpanStatusCode, trace } from "@opentelemetry/api";
const tracer = trace.getTracer("workboard-api");

return tracer.startActiveSpan("task.create", async (span) => {
  try {
    const task = await repo.create(trimmed);
    span.setAttribute("task.id", task.id);
    return reply.code(201).send({ task });
  } catch (err) {
    span.recordException(err as Error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw err;
  } finally {
    span.end();
  }
});
```

`startActiveSpan` 把 span 设为 active——所以日志 mixin 能拿到它的 trace_id（第 9 章）。失败时 `recordException` + ERROR 状态，让 trace 里一眼看出哪段出错。

## 8.6 练习 3：看到 server span 并导出

```bash
# 本地（console exporter）：
pnpm smoke:api
curl -X POST http://localhost:3000/api/tasks -H 'content-type: application/json' -d '{"title":"trace"}'
# API 终端打印 span：name 'POST'（http server span）、'task.create'、resource 含 service.name

# 导出到可检查后端（需 Docker）：
docker compose up --build -d
curl -X POST http://localhost:3000/api/tasks -H 'content-type: application/json' -d '{"title":"jaeger"}'
# Jaeger UI http://localhost:16686 → service workboard-api → 看到 trace 树
```

测试侧用 InMemorySpanExporter 断言 span 存在（`test/telemetry.test.ts`），注意 `SimpleSpanProcessor` 异步导出，断言前 `await processor.forceFlush()`（不用 sleep）。

## 8.7 常见坑

| 现象                         | 原因                             | 解决                   |
| ---------------------------- | -------------------------------- | ---------------------- |
| 类型报错 exporter 不匹配     | sdk-trace 3.x 构造器变化         | `{ exporter }` 对象    |
| 没有 fastify span            | instrumentation 不支持 Fastify 5 | http span + 手动 span  |
| ESM 项目无自动插桩           | 漏 loader hook                   | --import hook.mjs      |
| 测试里 getFinishedSpans 为空 | 异步导出未完成                   | await forceFlush()     |
| span 没 service.name         | resource 没设                    | resourceFromAttributes |

## 8.8 本章验收清单

- [ ] 完成练习 3：看到 server span，按环境导出到 console/Jaeger；
- [ ] 能解释两个实测版本坑及应对；
- [ ] ESM hook 正确加载（dev 与生产两条路径）；
- [ ] 手动业务 span 带属性与错误状态；
- [ ] 测试用 forceFlush 确定性断言 span。

---

上一章：[← 第 7 章：OpenTelemetry 心智模型](./07-otel-mental-model.md) ｜ 下一章：[第 9 章：关联与传播 →](./09-correlation-and-propagation.md) ｜ 返回：[教程目录 README](./README.md)
