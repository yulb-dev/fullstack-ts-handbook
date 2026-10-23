import { timingSafeEqual } from "node:crypto";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import scalar from "@scalar/fastify-api-reference";
import type { FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { DocsUi } from "../config.js";
import { AppError } from "../errors/app-error.js";

/**
 * OpenAPI 文档自身的版本号（info.version）。
 * 它和 URL 里的 /v1 不是一回事：/v1 是“主版本”，只有破坏性变更才升到 /v2；
 * info.version 记录这份契约的每次发布，兼容的新增也会让它变化。
 */
export const API_DOC_VERSION = "1.1.0";

export interface DocsPluginOptions {
  ui: DocsUi;
  routePrefix?: `/${string}`;
  basicAuth?: { username: string; password: string } | undefined;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // 长度不同也要做一次比较，避免通过耗时差异猜出长度
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function createBasicAuthHook(credentials: {
  username: string;
  password: string;
}) {
  return async function docsBasicAuth(request: FastifyRequest) {
    const header = request.headers.authorization ?? "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      const username = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);
      // 两项都比较完再判断，不用 && 短路，避免通过耗时判断用户名是否正确
      const usernameOk = safeEqual(username, credentials.username);
      const passwordOk = safeEqual(password, credentials.password);
      if (separator > 0 && usernameOk && passwordOk) return;
    }
    throw new AppError("UNAUTHORIZED", {
      headers: { "www-authenticate": 'Basic realm="api-docs"' },
    });
  };
}

/**
 * 文档插件：
 *  1. @fastify/swagger 负责“收集路由 schema → 生成 OpenAPI 文档”，必须先于业务路由注册；
 *  2. Scalar 或 Swagger UI 只是把这份文档渲染成网页，二选一即可。
 * 用 fastify-plugin 包装，让 @fastify/swagger 的 onRoute 钩子挂在根作用域，能看到所有路由。
 */
export default fp<DocsPluginOptions>(
  async function docsPlugin(app, options) {
    await app.register(swagger, {
      openapi: {
        openapi: "3.1.0",
        info: {
          title: "TaskHub API",
          version: API_DOC_VERSION,
          description:
            "团队任务管理 API。所有 /v1 接口都需要 `Authorization: Bearer <token>`。",
        },
        // 只写相对路径，不在文档里暴露内网主机名
        servers: [{ url: "/" }],
        tags: [
          { name: "tasks", description: "任务的增删改查" },
          { name: "users", description: "当前用户与用户管理" },
        ],
        components: {
          securitySchemes: {
            // 文档会被很多人看到：只描述认证方式，不写任何真实或示例 token
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              description: "在 Authorization 请求头中携带 Bearer token",
            },
          },
        },
        security: [{ bearerAuth: [] }],
      },
      // 让带 $id 的共享 schema 以原名出现在 components.schemas 中，而不是 def-0、def-1
      refResolver: {
        buildLocalReference(json, _baseUri, _fragment, i) {
          return typeof json.$id === "string" ? json.$id : `def-${i}`;
        },
      },
    });

    if (options.ui === "none") return;

    const routePrefix = options.routePrefix ?? "/docs";
    const onRequest = options.basicAuth
      ? createBasicAuthHook(options.basicAuth)
      : undefined;

    if (options.ui === "scalar") {
      await app.register(scalar, {
        routePrefix,
        logLevel: "warn",
        ...(onRequest ? { hooks: { onRequest } } : {}),
        configuration: { title: "TaskHub API Reference" },
      });
    } else {
      await app.register(swaggerUi, {
        routePrefix,
        logLevel: "warn",
        ...(onRequest ? { uiHooks: { onRequest } } : {}),
      });
    }
  },
  { name: "docs", fastify: "5.x" },
);
