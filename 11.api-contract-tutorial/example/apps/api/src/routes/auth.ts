import { eq, sql } from "drizzle-orm";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import { LoginBody, Session, User } from "../contract/auth";
import { errorResponses, ref } from "../contract/common";
import { sessions, users } from "../db/schema";
import { AppError } from "../domain/errors";
import {
  SESSION_COOKIE,
  hashToken,
  newToken,
  requireAuth,
} from "../plugins/auth";

export const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, config } = app;

  app.post(
    "/auth/login",
    {
      schema: {
        operationId: "login",
        tags: ["auth"],
        summary: "登录并建立会话",
        description:
          "成功后通过 Set-Cookie 下发 HttpOnly 会话 Cookie，并在响应体返回 csrfToken。",
        security: [],
        body: ref(LoginBody),
        response: {
          200: ref(Session),
          ...errorResponses(400, 401, 403, 500),
        },
      },
    },
    async (request, reply) => {
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
        })
        .from(users)
        .where(eq(sql`lower(${users.email})`, request.body.email.toLowerCase()))
        .limit(1);
      if (!user) {
        // 不区分「邮箱不存在」与「凭据错误」，避免账户枚举
        throw new AppError(401, "UNAUTHENTICATED", "邮箱或凭据不正确");
      }

      const token = newToken();
      const csrfToken = newToken();
      await db.insert(sessions).values({
        tokenHash: hashToken(token),
        userId: user.id,
        csrfToken,
        expiresAt: new Date(Date.now() + config.sessionTtlMs),
      });

      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true, // JS 读不到，XSS 偷不走会话
        secure: config.cookieSecure, // 生产必须 true：只走 HTTPS
        sameSite: "lax", // 跨站子请求不带 Cookie，CSRF 第一道防线
        path: "/",
        maxAge: Math.floor(config.sessionTtlMs / 1000),
      });
      return { user, csrfToken };
    },
  );

  app.get(
    "/auth/session",
    {
      schema: {
        operationId: "getSession",
        tags: ["auth"],
        summary: "读取当前会话",
        response: { 200: ref(Session), ...errorResponses(401, 500) },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      return { user: auth.user, csrfToken: auth.csrfToken };
    },
  );

  app.post(
    "/auth/logout",
    {
      schema: {
        operationId: "logout",
        tags: ["auth"],
        summary: "退出登录",
        security: [{ cookieAuth: [], csrfHeader: [] }],
        response: {
          204: Type.Null({ description: "已退出" }),
          ...errorResponses(401, 403, 500),
        },
      },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      await db.delete(sessions).where(eq(sessions.tokenHash, auth.tokenHash));
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return reply.code(204).send(null);
    },
  );

  // 已弃用接口示例（第 12 章）：仍可用，但在契约与响应头里都宣告了退场时间
  app.get(
    "/me",
    {
      schema: {
        operationId: "getMe",
        tags: ["auth"],
        summary: "【已弃用】读取当前用户，请改用 GET /api/v1/auth/session",
        deprecated: true,
        response: { 200: ref(User), ...errorResponses(401, 500) },
      },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      reply.headers({
        deprecation: "@1793491200", // 2026-11-01T00:00:00Z 起弃用（RFC 9745）
        sunset: "Mon, 01 Feb 2027 00:00:00 GMT", // 之后可能下线（RFC 8594）
        link: '</api/v1/auth/session>; rel="successor-version"',
      });
      return auth.user;
    },
  );
};
