import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import scalar from "@scalar/fastify-api-reference";
import Fastify, { LogController, type FastifyServerOptions } from "fastify";
import type { AppConfig } from "./config";
import type { Db } from "./db/types";
import { authPlugin } from "./plugins/auth";
import { errorHandlerPlugin } from "./plugins/errors";
import { openapiPlugin } from "./plugins/openapi";
import { genReqId } from "./plugins/request-id";
import { authRoutes } from "./routes/auth";
import { projectRoutes } from "./routes/projects";
import { taskRoutes } from "./routes/tasks";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    config: AppConfig;
  }
}

export interface BuildAppOptions {
  db: Db;
  config: AppConfig;
  logger?: FastifyServerOptions["logger"];
  /** 部署在反向代理之后时设为 true，才能信任 X-Forwarded-Proto/Host */
  trustProxy?: boolean;
}

/** 只「组装」应用，不 listen：测试、导出 OpenAPI、启动服务都复用它 */
export async function buildApp(opts: BuildAppOptions) {
  const app = Fastify({
    logger: opts.logger ?? {
      level: opts.config.logLevel,
      // 默认的 req 序列化器不输出请求头；这里兜底，防止手写日志时带出敏感值
      redact: [
        "req.headers.cookie",
        "req.headers['x-csrf-token']",
        "headers.cookie",
      ],
    },
    genReqId,
    // 日志里的请求标识字段叫 requestId，与错误 envelope 里的字段同名，方便检索
    logController: new LogController({ requestIdLogLabel: "requestId" }),
    trustProxy: opts.trustProxy ?? false,
    ajv: {
      customOptions: {
        // 遇到契约外的字段直接 400，而不是悄悄删掉（第 5 章）
        removeAdditional: false,
      },
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.decorate("db", opts.db);
  app.decorate("config", opts.config);

  // 每个响应都带上 X-Request-Id，前端报错时可以展示给用户 / 上报
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  await app.register(errorHandlerPlugin);
  await app.register(openapiPlugin);
  await app.register(cookie);

  // 只有前后端「跨源」部署时才需要 CORS；同源代理部署时 webOrigins 为空即可（第 8 章）
  if (opts.config.webOrigins.length > 0) {
    await app.register(cors, {
      origin: opts.config.webOrigins,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: [
        "Content-Type",
        "X-CSRF-Token",
        "Idempotency-Key",
        "If-Match",
        "X-Request-Id",
      ],
      exposedHeaders: [
        "X-Request-Id",
        "ETag",
        "Location",
        "Retry-After",
        "Idempotent-Replayed",
        "Deprecation",
        "Sunset",
        "Link",
      ],
      maxAge: 600,
    });
  }

  await app.register(authPlugin, {
    db: opts.db,
    webOrigins: opts.config.webOrigins,
  });

  await app.register(
    async (v1) => {
      await v1.register(authRoutes);
      await v1.register(projectRoutes);
      await v1.register(taskRoutes);
    },
    { prefix: "/api/v1" },
  );

  app.get("/healthz", { schema: { hide: true } }, async () => ({ ok: true }));

  if (opts.config.exposeDocs) {
    // /docs 交互式文档，/docs/openapi.json 原始契约
    await app.register(scalar, { routePrefix: "/docs" });
  }

  return app;
}
