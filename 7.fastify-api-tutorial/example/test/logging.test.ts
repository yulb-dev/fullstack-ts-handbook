import { describe, expect, it } from "vitest";
import { SEED_IDS } from "../src/data/seed.js";
import { bearer, createLogCollector, createTestApp } from "./helpers.js";

describe("结构化日志", () => {
  it("每条请求日志都带 requestId；请求完成日志带状态码与耗时", async () => {
    const logs = createLogCollector();
    const app = await createTestApp({
      logging: { enabled: true, stream: logs.stream },
    });
    const response = await app.inject({
      url: "/v1/me",
      headers: bearer("alice"),
    });
    const requestId = response.headers["x-request-id"];

    const mine = logs.lines.filter((line) => line.requestId === requestId);
    expect(mine.map((line) => line.msg)).toEqual([
      "incoming request",
      "request completed",
    ]);

    const completed = mine[1];
    expect(completed).toMatchObject({ level: 30, res: { statusCode: 200 } });
    expect(typeof completed?.responseTime).toBe("number");
  });

  it("req 序列化器是白名单：不会把 Authorization 头写进日志", async () => {
    const logs = createLogCollector();
    const app = await createTestApp({
      logging: { enabled: true, stream: logs.stream },
    });
    await app.inject({ url: "/v1/me", headers: bearer("alice") });

    const incoming = logs.lines.find((line) => line.msg === "incoming request");
    expect(incoming?.req).toMatchObject({ method: "GET", url: "/v1/me" });
    expect(JSON.stringify(logs.lines)).not.toContain("alice-token");
  });

  it("认证后通过子 logger 自动附加 userId；业务日志携带结构化字段", async () => {
    const logs = createLogCollector();
    const app = await createTestApp({
      logging: { enabled: true, stream: logs.stream },
    });
    const response = await app.inject({
      method: "PATCH",
      url: `/v1/tasks/${SEED_IDS.aliceTask}`,
      headers: bearer("alice"),
      payload: { priority: "high" },
    });
    expect(response.statusCode).toBe(200);

    const updated = logs.lines.find((line) => line.msg === "task updated");
    expect(updated).toMatchObject({
      level: 30,
      requestId: response.headers["x-request-id"],
      userId: SEED_IDS.alice,
      taskId: SEED_IDS.aliceTask,
      changedFields: ["priority"],
    });
  });

  it("redact：即使有人把带敏感字段的对象写进日志，也会被替换", async () => {
    const logs = createLogCollector();
    const app = await createTestApp({
      logging: { enabled: true, stream: logs.stream },
    });
    app.get("/debug-user", async (request) => {
      const user = await app.db.users.findById(SEED_IDS.alice);
      request.log.info({ user, headers: request.headers }, "debug dump");
      return { ok: true };
    });

    await app.inject({
      url: "/debug-user",
      headers: { authorization: "Bearer secret-value" },
    });
    const dump = logs.lines.find((line) => line.msg === "debug dump") as {
      user: Record<string, unknown>;
      headers: Record<string, unknown>;
    };
    expect(dump.user).toMatchObject({
      name: "Alice",
      apiToken: "[Redacted]",
      email: "[Redacted]",
    });
    expect(dump.headers.authorization).toBe("[Redacted]");
  });

  it("4xx 记为 info（带错误码），不会触发 error 级别告警", async () => {
    const logs = createLogCollector();
    const app = await createTestApp({
      logging: { enabled: true, stream: logs.stream },
    });
    await app.inject({
      url: `/v1/tasks/${SEED_IDS.bobTask}`,
      headers: bearer("alice"),
    });

    const rejected = logs.lines.find((line) => line.msg === "request rejected");
    expect(rejected).toMatchObject({
      level: 30,
      code: "TASK_NOT_FOUND",
      statusCode: 404,
    });
    expect(logs.lines.some((line) => (line.level as number) >= 50)).toBe(false);
  });

  it("日志级别：/healthz 路由设为 warn，不产生 info 请求日志", async () => {
    const logs = createLogCollector();
    const app = await createTestApp({
      logging: { enabled: true, stream: logs.stream },
    });
    await app.inject({ url: "/healthz" });
    expect(
      logs.lines.filter((line) => line.msg === "incoming request"),
    ).toHaveLength(0);
  });

  it("全局级别设为 warn 时，info 日志全部被过滤", async () => {
    const logs = createLogCollector();
    const app = await createTestApp({
      logging: { enabled: true, level: "warn", stream: logs.stream },
    });
    await app.inject({ url: "/v1/me", headers: bearer("alice") });
    expect(logs.lines).toHaveLength(0);
  });

  it("慢请求在 onResponse 中记一条 warn", async () => {
    const logs = createLogCollector();
    const app = await createTestApp({
      logging: { enabled: true, stream: logs.stream },
      slowRequestMs: 0,
    });
    await app.inject({ url: "/v1/me", headers: bearer("alice") });
    await app.close(); // 等 onResponse 跑完

    const slow = logs.lines.find((line) => line.msg === "slow request");
    expect(slow).toMatchObject({ level: 40, route: "/v1/me", statusCode: 200 });
  });

  it("关闭应用时执行 onClose 钩子", async () => {
    const logs = createLogCollector();
    const app = await createTestApp({
      logging: { enabled: true, stream: logs.stream },
    });
    await app.ready();
    await app.close();
    expect(
      logs.lines.some((line) => line.msg === "database connections closed"),
    ).toBe(true);
  });
});
