import swagger from "@fastify/swagger";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { sharedSchemas } from "../contract";

export const API_VERSION = "1.3.0";

/**
 * OpenAPI 文档由 route schema 自动生成（code-first），本插件只补充「全局」信息：
 * 版本、服务器、标签、安全方案，以及把共享 schema 输出到 components.schemas。
 */
export const openapiPlugin = fp(async function openapi(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "TaskFlow API",
        version: API_VERSION,
        description:
          "TaskFlow 的 HTTP 契约。所有错误都返回 ErrorResponse；所有时间点都是 UTC ISO 8601。",
      },
      servers: [
        { url: "/", description: "与 Web 同源（经 Vite 代理或反向代理）" },
      ],
      tags: [
        { name: "auth", description: "会话与身份" },
        { name: "projects", description: "项目" },
        { name: "tasks", description: "任务" },
      ],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "sid",
            description:
              "登录后由服务端下发的 HttpOnly 会话 Cookie，浏览器自动携带",
          },
          csrfHeader: {
            type: "apiKey",
            in: "header",
            name: "X-CSRF-Token",
            description:
              "写请求必须携带，值来自 GET /api/v1/auth/session 的 csrfToken",
          },
        },
      },
      // 默认：需要登录。个别公开接口在路由里用 security: [] 覆盖
      security: [{ cookieAuth: [] }],
    },
    // 共享 schema 在 components 里使用自己的 $id 作名字，而不是 def-0、def-1
    refResolver: {
      buildLocalReference(json, _baseUri, _fragment, i) {
        return typeof json.$id === "string" ? json.$id : `def-${i}`;
      },
    },
  });

  for (const schema of sharedSchemas) app.addSchema(schema);
});
