import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { registerContext, UnauthorizedError } from "@/api/context.js";
import { buildErrorBody } from "@/api/errors.js";
import { registerRoutes } from "@/api/routes.js";
import { TaskDeskError } from "@/services/errors.js";
import type { TaskService } from "@/services/task-service.js";

export interface AppOptions {
  service: TaskService;
  logger?: boolean;
}

/**
 * app factory：构建与监听分离。
 * 测试用 app.inject() 直接打请求，不占用端口；开发/生产才调用 app.listen()。
 */
export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  registerContext(app);

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof UnauthorizedError) {
      return reply
        .status(401)
        .send(buildErrorBody(error.code, error.message, requestId));
    }
    if (error instanceof ZodError) {
      const first = error.issues[0];
      const path = first?.path.join(".") || "(root)";
      return reply
        .status(400)
        .send(
          buildErrorBody(
            "VALIDATION_ERROR",
            `${path}: ${first?.message ?? "格式错误"}`,
            requestId,
          ),
        );
    }
    if (error instanceof TaskDeskError) {
      const status =
        error.code === "PERMISSION_DENIED"
          ? 403
          : error.code === "TASK_NOT_FOUND"
            ? 404
            : error.code === "TASK_CONFLICT"
              ? 409
              : 422; // INVALID_TRANSITION / PAST_DUE_DATE
      return reply
        .status(status)
        .send(buildErrorBody(error.code, error.message, requestId));
    }

    request.log.error(error);
    // 未知错误不泄漏内部细节，只留 requestId 供查日志
    return reply
      .status(500)
      .send(buildErrorBody("INTERNAL", "服务器内部错误", requestId));
  });

  registerRoutes(app, options.service);
  return app;
}
