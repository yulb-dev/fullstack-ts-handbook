import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { UserRecord } from "../data/memory-store.js";
import { AppError } from "../errors/app-error.js";
import type { UserRole } from "../schemas/user.js";

type AuthHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module "fastify" {
  interface FastifyInstance {
    /** 校验 Bearer token 并把用户放到 request.user 上；失败抛出 401 */
    authenticate: AuthHook;
    /** 生成一个检查角色的 hook；角色不符抛出 403 */
    requireRole: (role: UserRole) => AuthHook;
  }
  interface FastifyRequest {
    /** 未经过 authenticate 的路由上永远是 null */
    user: UserRecord | null;
  }
}

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

/** 在需要登录的 handler 里取当前用户；拿不到说明路由忘了挂 authenticate */
export function currentUser(request: FastifyRequest): UserRecord {
  if (!request.user) throw new AppError("UNAUTHORIZED");
  return request.user;
}

export default fp(
  async function authPlugin(app) {
    // 先用 null 声明形状，每个请求再赋值；不要用对象做默认值，否则所有请求会共享同一个引用
    app.decorateRequest("user", null);

    app.decorate(
      "authenticate",
      async function authenticate(request: FastifyRequest) {
        const match = BEARER_PATTERN.exec(request.headers.authorization ?? "");
        const token = match?.[1];
        if (!token) {
          throw new AppError("UNAUTHORIZED", {
            headers: { "www-authenticate": "Bearer" },
          });
        }

        const user = await app.db.users.findByToken(token);
        if (!user) {
          // 响应体与“没带 token”完全相同，不透露更多信息；
          // 只有 WWW-Authenticate 按 RFC 6750 标出 invalid_token，提示客户端重新获取凭证
          throw new AppError("UNAUTHORIZED", {
            headers: { "www-authenticate": 'Bearer error="invalid_token"' },
          });
        }

        request.user = user;
        // 之后本请求的所有日志都自动带上 userId
        request.log = request.log.child({ userId: user.id });
      },
    );

    app.decorate("requireRole", function requireRole(role: UserRole): AuthHook {
      return async function checkRole(request: FastifyRequest) {
        if (currentUser(request).role !== role) throw new AppError("FORBIDDEN");
      };
    });
  },
  { name: "auth", fastify: "5.x", dependencies: ["db"] },
);
