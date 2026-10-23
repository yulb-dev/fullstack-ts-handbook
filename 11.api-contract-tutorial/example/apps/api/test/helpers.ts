import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Writable } from "node:stream";
import { buildApp } from "../src/app";
import type { AppConfig } from "../src/config";
import { projectMembers, projects, users } from "../src/db/schema";

export const WEB_ORIGIN = "http://localhost:5173";

/** 把日志收集进数组，测试可以断言「日志里有什么、响应里没有什么」 */
export function memoryLogger() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const line of String(chunk).split("\n").filter(Boolean)) {
        lines.push(JSON.parse(line));
      }
      cb();
    },
  });
  return { lines, logger: { level: "info", stream } };
}

/** 每个测试文件一套独立数据库 + 应用；迁移文件与生产完全相同 */
export async function createTestApp() {
  const client = new PGlite();
  const db = drizzle({ client });
  await migrate(db, { migrationsFolder: "./drizzle" });

  const [alice, bob, carol] = await db
    .insert(users)
    .values([
      { email: "alice@example.com", displayName: "Alice" },
      { email: "bob@example.com", displayName: "Bob" },
      { email: "carol@example.com", displayName: "Carol" },
    ])
    .returning();
  const [project] = await db
    .insert(projects)
    .values({ name: "Launch" })
    .returning();
  if (!alice || !bob || !carol || !project) throw new Error("seed failed");
  await db.insert(projectMembers).values([
    { projectId: project.id, userId: alice.id, role: "owner" },
    { projectId: project.id, userId: bob.id, role: "viewer" },
  ]);

  const config: AppConfig = {
    webOrigins: [WEB_ORIGIN],
    cookieSecure: false,
    logLevel: "info",
    sessionTtlMs: 60 * 60 * 1000,
    exposeDocs: false,
  };
  const logs = memoryLogger();
  const app = await buildApp({ db, config, logger: logs.logger });

  /** 以某个用户登录，返回之后请求要带的 cookie 与 CSRF 头 */
  async function loginAs(email: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email },
    });
    if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
    const sid = res.cookies.find((c) => c.name === "sid");
    if (!sid) throw new Error("no session cookie");
    const { csrfToken } = res.json() as { csrfToken: string };
    return {
      cookies: { sid: sid.value },
      headers: { "x-csrf-token": csrfToken },
      setCookie: sid,
    };
  }

  return {
    app,
    db,
    logs: logs.lines,
    projectId: project.id,
    loginAs,
    close: async () => {
      await app.close();
      await client.close();
    },
  };
}
