import { createPgDb } from "../db/client";
import { projectMembers, projects, users } from "../db/schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("缺少 DATABASE_URL");
const { db, close } = createPgDb(databaseUrl);

const [alice, bob, carol] = await db
  .insert(users)
  .values([
    { email: "alice@example.com", displayName: "Alice（负责人）" },
    { email: "bob@example.com", displayName: "Bob（只读成员）" },
    { email: "carol@example.com", displayName: "Carol（非成员）" },
  ])
  .returning();
if (!alice || !bob || !carol) throw new Error("seed users failed");

const [project] = await db
  .insert(projects)
  .values({ name: "TaskFlow 发布计划" })
  .returning();
if (!project) throw new Error("seed project failed");

await db.insert(projectMembers).values([
  { projectId: project.id, userId: alice.id, role: "owner" },
  { projectId: project.id, userId: bob.id, role: "viewer" },
]);

console.log("Seeded:", {
  project: project.id,
  alice: alice.email,
  bob: bob.email,
  carol: carol.email,
});
await close();
