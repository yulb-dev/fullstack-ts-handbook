import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import type { Db } from "./db/types.js";
import type { Auth } from "./auth-factory.js";
import type { Env } from "./env.js";
import { HttpError, services } from "./services.js";

const workspaceParams = z.object({ workspaceId: z.uuid() });
const taskParams = workspaceParams.extend({ taskId: z.uuid() });

export async function createApp(
  db: Db,
  auth: Auth,
  env: Env,
  trustedProxies: string[] = [],
) {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "test" ? "silent" : "info",
      redact: [
        "req.headers.cookie",
        "req.headers.authorization",
        "res.headers.set-cookie",
      ],
      // 默认请求 URL 可能含重置 token；日志仅保留路径。
      serializers: {
        req: (req) => ({
          method: req.method,
          path: req.url?.startsWith("/api/auth/")
            ? "/api/auth/[已脱敏]"
            : req.url?.split("?")[0],
        }),
      },
    },
    trustProxy: trustedProxies.length ? trustedProxies : false,
    bodyLimit: 32 * 1024,
  });
  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    exposedHeaders: ["X-Retry-After"],
  });

  function authHeaders(request: FastifyRequest) {
    const headers = fromNodeHeaders(request.headers);
    // Better Auth 只读取由本服务根据连接/可信代理计算出的 IP。
    headers.delete("x-forwarded-for");
    headers.set("x-real-ip", request.ip);
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    return headers;
  }

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    handler: async (request, reply) => {
      const url = new URL(request.url, env.BETTER_AUTH_URL);
      if (url.origin !== env.BETTER_AUTH_URL)
        throw new HttpError(400, "INVALID_URL");
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: authHeaders(request),
          ...(request.method === "POST" && request.body !== undefined
            ? { body: JSON.stringify(request.body) }
            : {}),
        }),
      );
      reply.code(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header("set-cookie", cookies);
      reply.header("Cache-Control", "no-store");
      return reply.send(response.body ? await response.text() : null);
    },
  });

  async function requireIdentity(
    request: FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) {
    const { response, headers } = await auth.api.getSession({
      headers: authHeaders(request),
      query: { disableCookieCache: true },
      returnHeaders: true,
    });
    const cookies = headers.getSetCookie();
    if (cookies.length) reply.header("set-cookie", cookies);
    reply.header("Cache-Control", "no-store");
    if (!response) throw new HttpError(401, "UNAUTHENTICATED");
    if (!response.user.emailVerified)
      throw new HttpError(403, "EMAIL_NOT_VERIFIED");
    return response.user;
  }

  // 自有业务写 API 的 CSRF 策略；Better Auth 的防护不会自动覆盖它们。
  app.addHook("preHandler", async (request) => {
    const path = request.url.split("?")[0]!;
    if (
      path.startsWith("/api/auth/") ||
      ["GET", "HEAD", "OPTIONS"].includes(request.method)
    )
      return;
    if (request.headers.origin !== env.WEB_ORIGIN)
      throw new HttpError(403, "UNTRUSTED_ORIGIN");
    if (request.headers["sec-fetch-site"] === "cross-site")
      throw new HttpError(403, "CROSS_SITE_REQUEST");
    const contentType = request.headers["content-type"]
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "application/json")
      throw new HttpError(415, "JSON_REQUIRED");
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError)
      return reply.code(error.status).send({ code: error.code });
    if (error instanceof z.ZodError)
      return reply.code(400).send({ code: "INVALID_INPUT" });
    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply.code(error.statusCode).send({ code: "INVALID_REQUEST" });
    }
    request.log.error(
      { errorType: error instanceof Error ? error.name : "Unknown" },
      "请求失败，错误详情应在受控诊断通道采集",
    );
    return reply.code(500).send({ code: "INTERNAL_ERROR" });
  });

  const svc = services(db);
  app.get("/api/me", async (req, reply) => {
    const current = await requireIdentity(req, reply);
    return { id: current.id, name: current.name, email: current.email };
  });
  app.get("/api/workspaces", async (req, reply) =>
    svc.listWorkspaces((await requireIdentity(req, reply)).id),
  );
  app.post("/api/workspaces", async (req, reply) => {
    const actor = await requireIdentity(req, reply);
    const { name } = z
      .object({ name: z.string().trim().min(1).max(80) })
      .strict()
      .parse(req.body);
    return reply.code(201).send(await svc.createWorkspace(actor.id, name));
  });
  app.get("/api/workspaces/:workspaceId/tasks", async (req, reply) => {
    const actor = await requireIdentity(req, reply);
    const { workspaceId } = workspaceParams.parse(req.params);
    return svc.listTasks(actor.id, workspaceId);
  });
  app.post("/api/workspaces/:workspaceId/tasks", async (req, reply) => {
    const actor = await requireIdentity(req, reply);
    const { workspaceId } = workspaceParams.parse(req.params);
    const { title } = z
      .object({ title: z.string().trim().min(1).max(200) })
      .strict()
      .parse(req.body);
    return reply
      .code(201)
      .send(await svc.createTask(actor.id, workspaceId, title));
  });
  app.patch(
    "/api/workspaces/:workspaceId/tasks/:taskId",
    async (req, reply) => {
      const actor = await requireIdentity(req, reply);
      const { workspaceId, taskId } = taskParams.parse(req.params);
      const { done } = z.object({ done: z.boolean() }).strict().parse(req.body);
      return svc.updateTask(actor.id, workspaceId, taskId, done);
    },
  );
  app.delete(
    "/api/workspaces/:workspaceId/tasks/:taskId",
    async (req, reply) => {
      const actor = await requireIdentity(req, reply);
      const { workspaceId, taskId } = taskParams.parse(req.params);
      await svc.deleteTask(actor.id, workspaceId, taskId);
      return reply.code(204).send();
    },
  );
  app.post("/api/workspaces/:workspaceId/members", async (req, reply) => {
    const actor = await requireIdentity(req, reply);
    const { workspaceId } = workspaceParams.parse(req.params);
    const { userId, role } = z
      .object({
        userId: z.string().min(1),
        role: z.enum(["admin", "editor", "viewer"]),
      })
      .strict()
      .parse(req.body);
    return reply
      .code(201)
      .send(await svc.addMember(actor.id, workspaceId, userId, role));
  });
  await app.ready();
  return app;
}
