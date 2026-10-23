import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createAuth } from "../src/auth-factory.js";
import { createApp } from "../src/app.js";
import { canEditTask, services } from "../src/services.js";
import * as schema from "../src/db/schema.js";
import type { Env } from "../src/env.js";
import type { Mail } from "../src/mail.js";

const env: Env = {
  NODE_ENV: "test",
  MAIL_MODE: "local",
  DATABASE_URL: "unused-in-pglite",
  BETTER_AUTH_URL: "http://localhost:4000",
  WEB_ORIGIN: "http://localhost:5173",
  BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
};
const client = new PGlite();
const db = drizzle(client, { schema });
const mails: Mail[] = [];
const auth = createAuth(db, env, async (mail) => {
  mails.push(mail);
});
const svc = services(db);
const password = "learning-only-long-passphrase";
let app: Awaited<ReturnType<typeof createApp>>;
let index = 0;

async function login(email: string) {
  const response = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  expect(response.status).toBe(200);
  const data = (await response.json()) as {
    token: string;
    user: { id: string };
  };
  const cookie = response.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  return { cookie, token: data.token, id: data.user.id, email };
}
async function register(verified = true) {
  const email = `student-${++index}@example.com`;
  const result = await auth.api.signUpEmail({
    body: { name: "学习者", email, password },
  });
  expect(result.token).toBeNull();
  if (!verified) return { email, id: result.user.id };
  const mail = mails.findLast(
    (m) => m.to === email && m.subject.includes("验证"),
  );
  expect(mail).toBeDefined();
  const response = await auth.handler(new Request(mail!.text));
  expect(response.status).toBeLessThan(400);
  return { email, id: result.user.id };
}
async function identity() {
  return login((await register()).email);
}
function request(
  cookie: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: {
      cookie,
      origin: env.WEB_ORIGIN,
      ...(method === "GET" ? {} : { "content-type": "application/json" }),
    },
    ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
  });
}
async function fixture() {
  const owner = await identity();
  const editor = await identity();
  const viewer = await identity();
  const admin = await identity();
  const outsider = await identity();
  const workspace = await svc.createWorkspace(owner.id, "red");
  await svc.addMember(owner.id, workspace.id, editor.id, "editor");
  await svc.addMember(owner.id, workspace.id, viewer.id, "viewer");
  await svc.addMember(owner.id, workspace.id, admin.id, "admin");
  const task = await svc.createTask(editor.id, workspace.id, "写测试");
  return {
    owner,
    editor,
    viewer,
    admin,
    outsider,
    workspace,
    task,
    url: `/api/workspaces/${workspace.id}/tasks/${task.id}`,
  };
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  app = await createApp(db, auth, env);
});
afterAll(async () => {
  await app?.close();
  await client.close();
});

it("未登录每条受保护 API 都拒绝，不只 /me", async () => {
  const f = await fixture();
  expect((await request("", "GET", "/api/me")).statusCode).toBe(401);
  expect(
    (await request("", "GET", `/api/workspaces/${f.workspace.id}/tasks`))
      .statusCode,
  ).toBe(401);
  expect((await request("", "PATCH", f.url, { done: true })).statusCode).toBe(
    401,
  );
});
it("邮箱未验证不能密码登录，验证链接完成后才能登录", async () => {
  const u = await register(false);
  const response = await auth.api.signInEmail({
    body: { email: u.email, password },
    asResponse: true,
  });
  expect(response.status).toBe(403);
  const mail = mails.findLast(
    (m) => m.to === u.email && m.subject.includes("验证"),
  )!;
  expect((await auth.handler(new Request(mail.text))).status).toBeLessThan(400);
  expect((await login(u.email)).cookie).toContain("session_token");
});
it("伪造 Cookie 与数据库已到期 session 都不能通过", async () => {
  expect(
    (await request("better-auth.session_token=forged", "GET", "/api/me"))
      .statusCode,
  ).toBe(401);
  const u = await identity();
  await db
    .update(schema.session)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(schema.session.token, u.token));
  expect((await request(u.cookie, "GET", "/api/me")).statusCode).toBe(401);
});
it("非成员读写都返回 404，失败后任务仍未修改", async () => {
  const f = await fixture();
  expect(
    (
      await request(
        f.outsider.cookie,
        "GET",
        `/api/workspaces/${f.workspace.id}/tasks`,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (await request(f.outsider.cookie, "PATCH", f.url, { done: true }))
      .statusCode,
  ).toBe(404);
  const [stored] = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, f.task.id));
  expect(stored?.done).toBe(false);
});
it("viewer 可以读，创建/修改/删除全部被拒绝", async () => {
  const f = await fixture();
  expect(
    (
      await request(
        f.viewer.cookie,
        "GET",
        `/api/workspaces/${f.workspace.id}/tasks`,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await request(
        f.viewer.cookie,
        "POST",
        `/api/workspaces/${f.workspace.id}/tasks`,
        { title: "越权" },
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (await request(f.viewer.cookie, "PATCH", f.url, { done: true })).statusCode,
  ).toBe(403);
  expect((await request(f.viewer.cookie, "DELETE", f.url, {})).statusCode).toBe(
    403,
  );
});
it("editor 只能改自己的任务，admin 能改本 workspace 他人的任务", async () => {
  const f = await fixture();
  const other = await svc.createTask(
    f.owner.id,
    f.workspace.id,
    "owner 的任务",
  );
  expect(
    (await request(f.editor.cookie, "PATCH", f.url, { done: true })).statusCode,
  ).toBe(200);
  expect(
    (
      await request(
        f.editor.cookie,
        "PATCH",
        `/api/workspaces/${f.workspace.id}/tasks/${other.id}`,
        { done: true },
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (await request(f.admin.cookie, "PATCH", f.url, { done: false })).statusCode,
  ).toBe(200);
  const otherURL = `/api/workspaces/${f.workspace.id}/tasks/${other.id}`;
  expect(
    (await request(f.admin.cookie, "DELETE", otherURL, {})).statusCode,
  ).toBe(204);
  expect(
    await db.select().from(schema.tasks).where(eq(schema.tasks.id, other.id)),
  ).toEqual([]);
});
it("换 workspaceId 不能搬运 task，管理员也不跨租户", async () => {
  const f = await fixture();
  const blue = await svc.createWorkspace(f.admin.id, "blue");
  const task = await svc.createTask(f.admin.id, blue.id, "blue task");
  expect(
    (
      await request(
        f.admin.cookie,
        "PATCH",
        `/api/workspaces/${f.workspace.id}/tasks/${task.id}`,
        { done: true },
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await request(
        f.owner.cookie,
        "PATCH",
        `/api/workspaces/${blue.id}/tasks/${task.id}`,
        { done: true },
      )
    ).statusCode,
  ).toBe(404);
});
it("成员移除后同一有效会话立即失去该 workspace 访问权", async () => {
  const f = await fixture();
  await db
    .delete(schema.memberships)
    .where(
      and(
        eq(schema.memberships.workspaceId, f.workspace.id),
        eq(schema.memberships.userId, f.editor.id),
      ),
    );
  expect(
    (await request(f.editor.cookie, "PATCH", f.url, { done: true })).statusCode,
  ).toBe(404);
  expect((await request(f.editor.cookie, "GET", "/api/me")).statusCode).toBe(
    200,
  );
});
it("未知角色默认拒绝，不把非 viewer 一律当成可写", () => {
  expect(canEditTask("future-role", "u", "u")).toBe(false);
  expect(canEditTask("viewer", "u", "u")).toBe(false);
});
it("请求体不能伪造归属、workspace 或管理员角色", async () => {
  const f = await fixture();
  expect(
    (
      await request(f.editor.cookie, "PATCH", f.url, {
        done: true,
        createdBy: f.owner.id,
        role: "admin",
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await request(
        f.admin.cookie,
        "POST",
        `/api/workspaces/${f.workspace.id}/members`,
        { userId: f.outsider.id, role: "viewer" },
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await request(
        f.owner.cookie,
        "POST",
        `/api/workspaces/${f.workspace.id}/members`,
        { userId: f.outsider.id, role: "owner" },
      )
    ).statusCode,
  ).toBe(400);
});
it("自有 API 拒绝恶意/缺失 origin 与跨站请求", async () => {
  const f = await fixture();
  for (const origin of ["https://evil.example", undefined]) {
    const response = await app.inject({
      method: "PATCH",
      url: f.url,
      headers: {
        cookie: f.owner.cookie,
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
      payload: { done: true },
    });
    expect(response.statusCode).toBe(403);
  }
  const response = await app.inject({
    method: "PATCH",
    url: f.url,
    headers: {
      cookie: f.owner.cookie,
      "content-type": "application/json",
      origin: env.WEB_ORIGIN,
      "sec-fetch-site": "cross-site",
    },
    payload: { done: true },
  });
  expect(response.statusCode).toBe(403);
});
it("Better Auth 自己拒绝不可信 origin 与开放重定向", async () => {
  const u = await identity();
  const badOrigin = await app.inject({
    method: "POST",
    url: "/api/auth/sign-out",
    headers: {
      cookie: u.cookie,
      origin: "https://evil.example",
      "content-type": "application/json",
    },
    payload: {},
  });
  expect(badOrigin.statusCode).toBe(403);
  const badRedirect = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: {
      origin: env.WEB_ORIGIN,
      "content-type": "application/json",
    },
    payload: { email: u.email, password, callbackURL: "https://evil.example" },
  });
  expect(badRedirect.statusCode).toBe(403);
});
it("handler 保留每条 Set-Cookie，退出后重放旧 Cookie 失败", async () => {
  const u = await register();
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    remoteAddress: "192.0.2.20",
    headers: {
      origin: env.WEB_ORIGIN,
      "content-type": "application/json",
    },
    payload: { email: u.email, password },
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  const values = response.headers["set-cookie"];
  expect(Array.isArray(values)).toBe(true);
  const cookie = (values as string[]).map((v) => v.split(";")[0]).join("; ");
  expect((await request(cookie, "GET", "/api/me")).statusCode).toBe(200);
  const out = await request(cookie, "POST", "/api/auth/sign-out", {});
  expect(out.statusCode).toBe(200);
  expect((await request(cookie, "GET", "/api/me")).statusCode).toBe(401);
});
it("撤销其他会话仅保留当前会话", async () => {
  const u = await identity();
  const other = await login(u.email);
  await auth.api.revokeOtherSessions({
    headers: new Headers({ cookie: u.cookie }),
  });
  expect((await request(u.cookie, "GET", "/api/me")).statusCode).toBe(200);
  expect((await request(other.cookie, "GET", "/api/me")).statusCode).toBe(401);
});
it("触发真实 HTTP 登录限流，伪造 IP 请求头不能绕过", async () => {
  const u = await register();
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      remoteAddress: "192.0.2.30",
      headers: {
        origin: env.WEB_ORIGIN,
        "content-type": "application/json",
        "x-real-ip": `198.51.100.${i + 1}`,
      },
      payload: { email: u.email, password: "incorrect-password" },
    });
    statuses.push(response.statusCode);
    if (response.statusCode === 429)
      expect(response.headers["x-retry-after"]).toBeDefined();
  }
  expect(statuses.at(-1)).toBe(429);
});
it("重复注册响应不泄露已有邮箱", async () => {
  const u = await register();
  const duplicate = await auth.api.signUpEmail({
    body: { name: "学习者", email: u.email, password },
    asResponse: true,
  });
  const fresh = await auth.api.signUpEmail({
    body: { name: "学习者", email: `fresh-${++index}@example.com`, password },
    asResponse: true,
  });
  expect(duplicate.status).toBe(200);
  expect(fresh.status).toBe(200);
  expect(Object.keys(await duplicate.json())).toEqual(
    Object.keys(await fresh.json()),
  );
});
it("达到 updateAge 后续期，同时向浏览器返回更新 Cookie", async () => {
  const u = await identity();
  const now = Date.now();
  const oldExpiry = new Date(now + 5 * 24 * 60 * 60 * 1000);
  await db
    .update(schema.session)
    .set({
      createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
      expiresAt: oldExpiry,
    })
    .where(eq(schema.session.token, u.token));
  const response = await request(u.cookie, "GET", "/api/me");
  expect(response.statusCode).toBe(200);
  expect(response.headers["set-cookie"]).toBeDefined();
  const [stored] = await db
    .select()
    .from(schema.session)
    .where(eq(schema.session.token, u.token));
  expect(stored!.expiresAt.getTime()).toBeGreaterThan(oldExpiry.getTime());
  expect(response.headers["cache-control"]).toBe("no-store");
});
it("密码保存为带盐哈希，同样密码不是同一存储值", async () => {
  const a = await register();
  const b = await register();
  const [first] = await db
    .select()
    .from(schema.account)
    .where(eq(schema.account.userId, a.id));
  const [second] = await db
    .select()
    .from(schema.account)
    .where(eq(schema.account.userId, b.id));
  expect(first!.providerId).toBe("credential");
  expect(first!.password).not.toBe(password);
  expect(first!.password).not.toBe(second!.password);
});
it("CORS 预检允许受信页面，业务写入拒绝非 JSON", async () => {
  const preflight = await app.inject({
    method: "OPTIONS",
    url: "/api/workspaces",
    headers: {
      origin: env.WEB_ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  expect(preflight.statusCode).toBe(204);
  expect(preflight.headers["access-control-allow-origin"]).toBe(env.WEB_ORIGIN);
  expect(preflight.headers["access-control-allow-credentials"]).toBe("true");
  const u = await identity();
  const response = await app.inject({
    method: "POST",
    url: "/api/workspaces",
    headers: {
      cookie: u.cookie,
      origin: env.WEB_ORIGIN,
      "content-type": "text/plain",
    },
    payload: '{"name":"应被拒绝"}',
  });
  expect(response.statusCode).toBe(415);
  expect(await svc.listWorkspaces(u.id)).toEqual([]);
});
it("密码重置后旧密码/旧会话/已用重置 token 全部失效", async () => {
  const u = await identity();
  await auth.api.requestPasswordReset({
    body: { email: u.email, redirectTo: `${env.WEB_ORIGIN}/` },
  });
  const mail = mails.findLast(
    (m) => m.to === u.email && m.subject.includes("重置"),
  )!;
  const redirect = await auth.handler(new Request(mail.text));
  const token = new URL(redirect.headers.get("location")!).searchParams.get(
    "token",
  )!;
  expect(token).toBeTruthy();
  await auth.api.resetPassword({
    body: { token, newPassword: "another-long-learning-passphrase" },
  });
  expect((await request(u.cookie, "GET", "/api/me")).statusCode).toBe(401);
  const oldLogin = await auth.api.signInEmail({
    body: { email: u.email, password },
    asResponse: true,
  });
  expect(oldLogin.status).not.toBe(200);
  const reuse = await auth.api.resetPassword({
    body: { token, newPassword: password },
    asResponse: true,
  });
  expect(reuse.status).not.toBe(200);
});
