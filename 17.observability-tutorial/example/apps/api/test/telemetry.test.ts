import { SpanStatusCode, trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { traceMixin } from "../src/logger.js";
import { createMemoryRepository } from "../src/repository.js";

// 测试用 OTel：InMemorySpanExporter 收集 span，不依赖外部 collector。
// 不加载自动插桩（vitest 的模块转换环境不适合），只验证手动 span 与关联机制。
const exporter = new InMemorySpanExporter();
const processor = new SimpleSpanProcessor({ exporter });
const sdk = new NodeSDK({ spanProcessors: [processor], instrumentations: [] });
sdk.start();

afterAll(() => sdk.shutdown());

function build() {
  return buildApp({ repo: createMemoryRepository() }, { logger: false });
}

// SimpleSpanProcessor 异步导出：forceFlush 等待在途导出完成（确定性，不用 sleep）
async function finishedSpans() {
  await processor.forceFlush();
  return exporter.getFinishedSpans();
}

describe("业务 span", () => {
  it("创建任务生成 task.create span，带 task.id 属性", async () => {
    exporter.reset();
    const app = build();
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "span 验证" },
    });
    expect(res.statusCode).toBe(201);
    await app.close();
    const span = (await finishedSpans()).find((s) => s.name === "task.create");
    expect(span).toBeTruthy();
    expect(span?.attributes["task.id"]).toBeTruthy();
  });

  it("故障时 span 记录异常事件并置 ERROR 状态", async () => {
    exporter.reset();
    const app = build();
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { title: "FAIL_DB" },
    });
    expect(res.statusCode).toBe(500);
    await app.close();
    const span = (await finishedSpans()).find((s) => s.name === "task.create");
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.events.some((e) => e.name === "exception")).toBe(true);
  });
});

describe("日志 ↔ trace 关联", () => {
  it("活跃 span 存在时 mixin 注入匹配的 trace_id/span_id", () => {
    const tracer = trace.getTracer("test");
    tracer.startActiveSpan("probe", (span) => {
      const fields = traceMixin();
      const ctx = span.spanContext();
      expect(fields.trace_id).toBe(ctx.traceId);
      expect(fields.span_id).toBe(ctx.spanId);
      span.end();
    });
  });

  it("无活跃 span 时 mixin 返回空对象（不污染日志）", () => {
    expect(traceMixin()).toEqual({});
  });
});
