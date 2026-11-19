import { SpanStatusCode, trace } from "@opentelemetry/api";
import * as Sentry from "@sentry/node";
import Fastify, { type FastifyInstance } from "fastify";
import { loggerOptions } from "./logger.js";
import type { TaskRepository } from "./repository.js";

const tracer = trace.getTracer("workboard-api");

export function buildApp(
  { repo }: { repo: TaskRepository },
  { logger = true }: { logger?: boolean } = {},
): FastifyInstance {
  const app = Fastify({ logger: logger ? loggerOptions() : false });

  // requestId 贯穿三处：响应头 x-request-id、错误 envelope、日志（同一来源 request.id）
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/health/ready", async (request, reply) => {
    try {
      await repo.ping();
      return { status: "ready" };
    } catch (err) {
      request.log.warn({ err }, "readiness check failed");
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  app.get("/api/tasks", async () => ({ tasks: await repo.list() }));

  app.post(
    "/api/tasks",
    {
      schema: {
        body: {
          type: "object",
          required: ["title"],
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
          },
        },
      },
      // 教学用授权替身：真实项目接 Better Auth + workspace membership（阶段 10）。
      // 这里只演示「权限拒绝」这条失败路径如何被观测。
      preHandler: async (request, reply) => {
        if (request.headers["x-demo-role"] === "viewer") {
          request.log.warn({ role: "viewer" }, "authorization denied");
          return reply.code(403).send({
            error: {
              code: "FORBIDDEN",
              message: "只读角色不能创建任务",
              requestId: request.id,
            },
          });
        }
      },
    },
    async (request, reply) => {
      const { title } = request.body as { title: string };
      const trimmed = title.trim();
      if (trimmed.length === 0) {
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "title 不能为空",
            requestId: request.id,
          },
        });
      }
      // 手动 span：把「创建任务」这个业务操作变成 trace 里可见的一段
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
    },
  );

  app.setErrorHandler((err: unknown, request, reply) => {
    const error = err as { statusCode?: number; message?: string };
    const statusCode =
      typeof error.statusCode === "number" ? error.statusCode : 500;
    const code =
      statusCode === 400
        ? "VALIDATION_ERROR"
        : statusCode >= 500
          ? "INTERNAL_ERROR"
          : "REQUEST_ERROR";
    // 结构化错误日志：requestId 由 Fastify 自动带入（reqId），trace_id/span_id 由 mixin 注入
    request.log.error({ err, statusCode, code }, "request failed");
    if (statusCode >= 500) {
      // 显式捕获并打 requestId tag：Sentry 事件 ↔ 日志 ↔ trace 由此关联
      Sentry.captureException(err, {
        tags: { requestId: request.id, errorCode: code },
      });
    }
    return reply.code(statusCode).send({
      error: {
        code,
        message:
          statusCode >= 500 ? "服务器内部错误" : (error.message ?? "请求错误"),
        requestId: request.id,
      },
    });
  });

  return app;
}
