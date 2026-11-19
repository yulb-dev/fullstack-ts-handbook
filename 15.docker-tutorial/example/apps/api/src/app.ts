import Fastify, { type FastifyInstance } from "fastify";
import type { Queryable } from "./db.js";

export interface AppDeps {
  db: Queryable;
}

export interface AppOptions {
  logger?: boolean;
}

// buildApp 工厂：不读环境变量、不监听端口，依赖从外部注入。
// 这样同一份 app 既能被 server.ts 拉起，也能被 vitest + inject 测试。
export function buildApp(
  { db }: AppDeps,
  { logger = true }: AppOptions = {},
): FastifyInstance {
  const app = Fastify({ logger });

  // liveness：进程活着就返回 200。不查数据库——数据库挂了不应该导致容器被重启。
  app.get("/health/live", async () => ({ status: "ok" }));

  // readiness：真正能服务流量才返回 200。数据库不可达时返回 503。
  app.get("/health/ready", async (request, reply) => {
    try {
      await db.query("SELECT 1");
      return { status: "ready" };
    } catch (err) {
      request.log.warn({ err }, "readiness check failed");
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  app.get("/api/tasks", async () => {
    const { rows } = await db.query(
      "SELECT id, title, status, created_at FROM tasks ORDER BY created_at DESC LIMIT 100",
    );
    return { tasks: rows };
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
      // schema 管结构，业务规则管语义：全空白标题在这里被拒绝。
      if (trimmed.length === 0) {
        return reply.code(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "title 不能为空",
            requestId: request.id,
          },
        });
      }
      const { rows } = await db.query(
        "INSERT INTO tasks (title) VALUES ($1) RETURNING id, title, status, created_at",
        [trimmed],
      );
      return reply.code(201).send({ task: rows[0] });
    },
  );

  // 统一错误出口：稳定 envelope，500 不泄漏内部细节。
  // Fastify 5 的 errorHandler 回调参数是 unknown，先收窄再使用。
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
