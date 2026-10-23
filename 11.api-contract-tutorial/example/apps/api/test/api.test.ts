import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tasks } from "../src/db/schema";
import { assertMatchesSchema, openapiDoc } from "./contract";
import { WEB_ORIGIN, createTestApp } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
type Session = Awaited<ReturnType<Ctx["loginAs"]>>;

let ctx: Ctx;
let alice: Session;
let bob: Session;
let carol: Session;

beforeAll(async () => {
  ctx = await createTestApp();
  alice = await ctx.loginAs("alice@example.com");
  bob = await ctx.loginAs("bob@example.com");
  carol = await ctx.loginAs("carol@example.com");
});
afterAll(() => ctx.close());

function createTask(
  who: Session,
  payload: unknown,
  opts: {
    key?: string;
    projectId?: string;
    headers?: Record<string, string>;
  } = {},
) {
  return ctx.app.inject({
    method: "POST",
    url: `/api/v1/projects/${opts.projectId ?? ctx.projectId}/tasks`,
    cookies: who.cookies,
    headers: {
      ...who.headers,
      "idempotency-key": opts.key ?? randomUUID(),
      ...opts.headers,
    },
    payload: payload as Record<string, unknown>,
  });
}

describe("OpenAPI 文档本身", () => {
  it("声明了安全方案，且每个操作都有唯一 operationId 和统一错误响应", () => {
    expect(Object.keys(openapiDoc.components.securitySchemes)).toEqual([
      "cookieAuth",
      "csrfHeader",
    ]);
    const ids = new Set<string>();
    for (const [path, ops] of Object.entries(openapiDoc.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        expect(op.operationId, `${method} ${path}`).toBeTruthy();
        expect(ids.has(op.operationId!)).toBe(false);
        ids.add(op.operationId!);
        expect(Object.keys(op.responses), `${method} ${path}`).toContain("500");
      }
    }
  });
});

describe("401 / requestId", () => {
  it("未登录返回 401 envelope，requestId 与响应头一致", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${ctx.projectId}/tasks`,
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    assertMatchesSchema("ErrorResponse", body);
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.requestId).toBe(res.headers["x-request-id"]);
  });

  it("沿用上游合法的 X-Request-Id，拒绝不安全的值", async () => {
    const ok = await ctx.app.inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-request-id": "web-1234abcd" },
    });
    expect(ok.headers["x-request-id"]).toBe("web-1234abcd");
    const bad = await ctx.app.inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-request-id": "bad id\nINJECTED" },
    });
    expect(bad.headers["x-request-id"]).not.toContain("INJECTED");
  });
});

describe("创建任务：成功路径", () => {
  it("201 + Location + ETag，响应符合 Task 契约，服务端决定 status/version", async () => {
    const res = await createTask(alice, {
      title: "  写发布说明  ",
      priority: "high",
      dueDate: "2026-10-30",
    });
    expect(res.statusCode).toBe(201);
    const task = res.json();
    assertMatchesSchema("Task", task);
    expect(task).toMatchObject({
      title: "写发布说明",
      status: "todo",
      priority: "high",
      dueDate: "2026-10-30",
      version: 1,
    });
    expect(task.createdAt).toMatch(/Z$/);
    expect(res.headers.location).toBe(`/api/v1/tasks/${task.id}`);
    expect(res.headers.etag).toBe('"1"');
  });
});

describe("400：契约校验与字段映射", () => {
  it("空标题 → fields[].path = title, rule = minLength", async () => {
    const res = await createTask(alice, { title: "" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    assertMatchesSchema("ErrorResponse", body);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.fields).toEqual([
      {
        in: "body",
        path: "title",
        rule: "minLength",
        message: "至少 1 个字符",
      },
    ]);
  });

  it("缺少必填字段 → path 指向缺失字段而不是父对象", async () => {
    const res = await createTask(alice, { priority: "low" });
    expect(res.json().error.fields[0]).toMatchObject({
      path: "title",
      rule: "required",
    });
  });

  it("绕过前端：偷塞 status / createdBy / version 被拒绝，而不是被采纳", async () => {
    const res = await createTask(alice, {
      title: "越权字段",
      status: "done",
      createdBy: randomUUID(),
      version: 99,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields[0]).toMatchObject({
      rule: "additionalProperties",
    });
  });

  it("绕过前端：非法枚举、非法日期、超长文本、纯空白标题", async () => {
    for (const payload of [
      { title: "a", priority: "urgent" },
      { title: "a", dueDate: "2026-13-45" },
      { title: "x".repeat(121) },
      { title: "   " },
    ]) {
      const res = await createTask(alice, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it("缺少 Idempotency-Key → 400，指出 headers 里的字段", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${ctx.projectId}/tasks`,
      cookies: alice.cookies,
      headers: alice.headers,
      payload: { title: "no key" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fields[0]).toMatchObject({
      in: "headers",
      path: "idempotency-key",
    });
  });

  it("JSON 语法错误 → 400 BAD_REQUEST，同样是统一 envelope", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${ctx.projectId}/tasks`,
      cookies: alice.cookies,
      headers: {
        ...alice.headers,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      payload: "{bad json",
    });
    expect(res.statusCode).toBe(400);
    assertMatchesSchema("ErrorResponse", res.json());
    expect(res.json().error.code).toBe("BAD_REQUEST");
  });
});

describe("403 / 404：授权", () => {
  it("只读成员创建 → 403", async () => {
    const res = await createTask(bob, { title: "bob 想建任务" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("非成员与不存在的项目得到完全相同的 404", async () => {
    const notMember = await createTask(carol, { title: "carol" });
    const missing = await createTask(
      alice,
      { title: "x" },
      { projectId: randomUUID() },
    );
    expect(notMember.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(notMember.json().error.message).toBe(missing.json().error.message);
  });
});

describe("409：唯一性冲突", () => {
  it("同项目未完成任务重名（忽略大小写）→ 409 + 字段级错误", async () => {
    await createTask(alice, { title: "Deploy" });
    const res = await createTask(alice, { title: "deploy" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: "CONFLICT",
      fields: [{ in: "body", path: "title", rule: "unique" }],
    });
  });
});

describe("幂等键", () => {
  it("同键同内容重试：只创建一次，第二次重放", async () => {
    const key = randomUUID();
    const payload = { title: "幂等测试", description: "retry me" };
    const first = await createTask(alice, payload, { key });
    const second = await createTask(
      alice,
      { description: "retry me", title: "幂等测试" },
      { key },
    );
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.json().id).toBe(first.json().id);
    const [row] = await ctx.db
      .select({ n: count() })
      .from(tasks)
      .where(eq(tasks.title, "幂等测试"));
    expect(row?.n).toBe(1);
  });

  it("同键不同内容 → 422", async () => {
    const key = randomUUID();
    await createTask(alice, { title: "第一次" }, { key });
    const res = await createTask(alice, { title: "第二次" }, { key });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("因 409 失败的请求不会占用幂等键：改正后可用同一个键重试", async () => {
    const key = randomUUID();
    await createTask(alice, { title: "Unique-1" });
    const conflict = await createTask(alice, { title: "Unique-1" }, { key });
    expect(conflict.statusCode).toBe(409);
    const fixed = await createTask(alice, { title: "Unique-2" }, { key });
    expect(fixed.statusCode).toBe(201);
  });
});

describe("CSRF / CORS", () => {
  it("已登录的写请求缺少 X-CSRF-Token → 403 CSRF_REJECTED", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/projects/${ctx.projectId}/tasks`,
      cookies: alice.cookies,
      headers: { "idempotency-key": randomUUID() },
      payload: { title: "csrf" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("CSRF_REJECTED");
  });

  it("来自不受信任 Origin 的写请求 → 403", async () => {
    const res = await createTask(
      alice,
      { title: "evil" },
      {
        headers: { origin: "https://evil.example" },
      },
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("CSRF_REJECTED");
  });

  it("会话 Cookie 是 HttpOnly + SameSite=Lax", () => {
    expect(alice.setCookie.httpOnly).toBe(true);
    expect(alice.setCookie.sameSite).toBe("Lax");
  });

  it("预检请求：白名单 Origin 得到精确回显 + allow-credentials", async () => {
    const res = await ctx.app.inject({
      method: "OPTIONS",
      url: `/api/v1/projects/${ctx.projectId}/tasks`,
      headers: {
        origin: WEB_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers":
          "content-type,idempotency-key,x-csrf-token",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(String(res.headers["access-control-allow-headers"])).toContain(
      "Idempotency-Key",
    );
  });

  it("预检请求：非白名单 Origin 拿不到 CORS 头", async () => {
    const res = await ctx.app.inject({
      method: "OPTIONS",
      url: `/api/v1/projects/${ctx.projectId}/tasks`,
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "POST",
      },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("更新：乐观并发", () => {
  it("缺 If-Match → 428；旧版本 → 412；正确版本 → 200 且 version + 1", async () => {
    const created = (await createTask(alice, { title: "并发更新" })).json();
    const patch = (ifMatch?: string, title = "改名") =>
      ctx.app.inject({
        method: "PATCH",
        url: `/api/v1/tasks/${created.id}`,
        cookies: alice.cookies,
        headers: {
          ...alice.headers,
          ...(ifMatch ? { "if-match": ifMatch } : {}),
        },
        payload: { title },
      });

    expect((await patch()).statusCode).toBe(428);

    const ok = await patch('"1"');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().version).toBe(2);
    expect(ok.headers.etag).toBe('"2"');

    const stale = await patch('"1"', "别人的旧修改");
    expect(stale.statusCode).toBe(412);
    expect(stale.json().error.code).toBe("PRECONDITION_FAILED");
    expect(stale.headers.etag).toBe('"2"');
  });

  it("非成员修改任务 → 404（即使没带 If-Match，也先得到 404 而不是 428）", async () => {
    const created = (
      await createTask(alice, { title: "carol 看不见我" })
    ).json();
    for (const headers of [
      carol.headers,
      { ...carol.headers, "if-match": '"1"' },
    ]) {
      const res = await ctx.app.inject({
        method: "PATCH",
        url: `/api/v1/tasks/${created.id}`,
        cookies: carol.cookies,
        headers,
        payload: { title: "越权修改" },
      });
      expect(res.statusCode).toBe(404);
    }
  });
});

describe("分页契约", () => {
  it("游标翻页不重不漏，最后一页 nextCursor 为 null", async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/v1/projects/${ctx.projectId}/tasks`,
        query: { limit: "3", ...(cursor ? { cursor } : {}) },
        cookies: alice.cookies,
      });
      expect(res.statusCode).toBe(200);
      const page: { items: { id: string }[]; nextCursor: string | null } =
        res.json();
      assertMatchesSchema("TaskPage", page);
      for (const t of page.items) {
        expect(seen.has(t.id)).toBe(false);
        seen.add(t.id);
      }
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 50);
    const [row] = await ctx.db.select({ n: count() }).from(tasks);
    expect(seen.size).toBe(row?.n);
  });

  it("limit 越界与伪造游标 → 400", async () => {
    const tooBig = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${ctx.projectId}/tasks?limit=1000`,
      cookies: alice.cookies,
    });
    expect(tooBig.json().error.fields[0]).toMatchObject({
      in: "query",
      path: "limit",
    });
    const forged = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${ctx.projectId}/tasks?cursor=not-a-cursor`,
      cookies: alice.cookies,
    });
    expect(forged.statusCode).toBe(400);
    expect(forged.json().error.fields[0]).toMatchObject({
      in: "query",
      path: "cursor",
    });
  });
});

describe("弃用接口", () => {
  it("仍然可用，但带 Deprecation / Sunset / Link 头", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: alice.cookies,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.deprecation).toMatch(/^@\d+$/);
    expect(res.headers.sunset).toBeTruthy();
    expect(res.headers.link).toContain("successor-version");
  });
});
