import type { FastifyInstance } from "fastify";
import type { Actor, Role } from "@/domain/permissions.js";

/** 通过模块声明扩展 Fastify 类型：request.actor 有完整类型提示 */
declare module "fastify" {
  interface FastifyRequest {
    actor: Actor;
  }
}

export class UnauthorizedError extends Error {
  readonly code = "UNAUTHORIZED";
  constructor(message = "缺少或非法的身份标识") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

const ROLES: readonly Role[] = ["member", "manager"];

/**
 * 教学用「认证」：从请求头读取身份。
 * 真实项目应验证会话 Cookie / JWT（见 better-auth 教程），但边界形状一致：
 * hook 解析身份 → 挂在 request 上 → 路由与 service 只消费 Actor。
 */
export function registerContext(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    // 直接使用 Fastify 内置的 request.id（默认 req-1、req-2…，生产可用 genReqRequestId 定制），
    // 而不是另造一个 UUID：错误体里的 requestId 和响应头必须同源，否则日志对不上
    reply.header("x-request-id", request.id);
  });

  app.addHook("preHandler", async (request) => {
    const userId = request.headers["x-user-id"];
    const role = request.headers["x-user-role"];
    if (typeof userId !== "string" || userId.length === 0) {
      throw new UnauthorizedError("缺少 x-user-id 请求头");
    }
    if (typeof role !== "string" || !ROLES.includes(role as Role)) {
      throw new UnauthorizedError("x-user-role 必须是 member 或 manager");
    }
    request.actor = { id: userId, role: role as Role };
  });
}
