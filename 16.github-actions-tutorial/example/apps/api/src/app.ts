import Fastify, { type FastifyInstance } from "fastify";
import { isTaskStatus, parsePagination } from "@workboard/shared";
import type { TaskStore } from "./store.js";

export function buildApp(
  { store }: { store: TaskStore },
  { logger = true } = {},
): FastifyInstance {
  const app = Fastify({ logger });

  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/api/tasks", async (request) => {
    const { page, pageSize } = parsePagination(
      request.query as Record<string, unknown>,
    );
    const all = store.list();
    const start = (page - 1) * pageSize;
    return {
      tasks: all.slice(start, start + pageSize),
      total: all.length,
      page,
      pageSize,
    };
  });

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
      return reply.code(201).send({ task: store.create(trimmed) });
    },
  );

  app.patch(
    "/api/tasks/:id/status",
    {
      schema: {
        body: {
          type: "object",
          required: ["status"],
          additionalProperties: false,
          properties: { status: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { status } = request.body as { status: string };
      if (!isTaskStatus(status)) {
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "非法状态",
            requestId: request.id,
          },
        });
      }
      const task = store.get(id);
      if (!task) {
        return reply.code(404).send({
          error: {
            code: "NOT_FOUND",
            message: "任务不存在",
            requestId: request.id,
          },
        });
      }
      const updated = store.transition(id, status);
      if (!updated) {
        return reply.code(409).send({
          error: {
            code: "INVALID_TRANSITION",
            message: "非法状态迁移",
            requestId: request.id,
          },
        });
      }
      return { task: updated };
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
    request.log.error({ err, statusCode, code }, "request failed");
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
