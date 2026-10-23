/**
 * 没有 Docker / Postgres 时的「内存数据库」开发模式：
 * 用 PGlite（WebAssembly 版 Postgres）跑同一套迁移和种子数据，进程退出数据即消失。
 * 只用于本地体验与调试，不要用于生产。
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { buildApp } from "../app";
import { loadConfig } from "../config";
import { projectMembers, projects, users } from "../db/schema";

const client = new PGlite();
const db = drizzle({ client });
await migrate(db, { migrationsFolder: "./drizzle" });

const [alice, bob] = await db
  .insert(users)
  .values([
    { email: "alice@example.com", displayName: "Alice（负责人）" },
    { email: "bob@example.com", displayName: "Bob（只读成员）" },
    { email: "carol@example.com", displayName: "Carol（非成员）" },
  ])
  .returning();
const [project] = await db
  .insert(projects)
  .values({ name: "TaskFlow 发布计划" })
  .returning();
if (!alice || !bob || !project) throw new Error("seed failed");
await db.insert(projectMembers).values([
  { projectId: project.id, userId: alice.id, role: "owner" },
  { projectId: project.id, userId: bob.id, role: "viewer" },
]);

const config = loadConfig();
const app = await buildApp({
  db,
  config,
  logger: { level: config.logLevel, transport: { target: "pino-pretty" } },
});
await app.listen({ port: Number(process.env.PORT ?? 3000), host: "127.0.0.1" });
