import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { User } from "../contract/auth";
import { sessions, users } from "../db/schema";
import type { Db } from "../db/types";
import { AppError, unauthenticated } from "../domain/errors";

export const SESSION_COOKIE = "sid";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface AuthContext {
  user: User;
  csrfToken: string;
  tokenHash: string;
}

declare module "fastify" {
  interface FastifyRequest {
    /** onRequest 阶段由 Cookie 解析出的会话；未登录为 null */
    auth: AuthContext | null;
  }
}

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const newToken = () => randomBytes(32).toString("base64url");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function loadSession(db: Db, token: string): Promise<AuthContext | null> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({
      csrfToken: sessions.csrfToken,
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return null;
  const { csrfToken, ...user } = row;
  return { user, csrfToken, tokenHash };
}

/** 路由里调用：拿到当前用户，否则 401 */
export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthenticated();
  return request.auth;
}

/**
 * 认证 + CSRF 防护（第 8 章）
 * 1. 读 HttpOnly 会话 Cookie → request.auth
 * 2. 写请求校验 Origin：只接受白名单或同源
 * 3. 已登录的写请求必须带 X-CSRF-Token，且与会话绑定的 token 一致
 */
export const authPlugin = fp(async function auth(
  app: FastifyInstance,
  opts: { db: Db; webOrigins: string[] },
) {
  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.auth = token ? await loadSession(opts.db, token) : null;

    if (!UNSAFE_METHODS.has(request.method)) return;

    const origin = request.headers.origin;
    if (origin) {
      const sameOrigin = origin === `${request.protocol}://${request.host}`;
      if (!sameOrigin && !opts.webOrigins.includes(origin)) {
        throw new AppError(403, "CSRF_REJECTED", "请求来源不被信任", {
          logContext: { origin },
        });
      }
    }

    if (request.auth) {
      const header = request.headers["x-csrf-token"];
      if (
        typeof header !== "string" ||
        !safeEqual(header, request.auth.csrfToken)
      ) {
        throw new AppError(403, "CSRF_REJECTED", "页面已过期，请刷新后重试", {
          logContext: { reason: header ? "mismatch" : "missing" },
        });
      }
    }
  });
});
