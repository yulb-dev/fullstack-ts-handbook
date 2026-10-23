import { db, closeDb } from "../db/client";
import { seedData } from "../db/seed-data";

try {
  const { user, catalog } = await seedData(db);
  console.log("种子完成", {
    userId: user.id,
    books: catalog.map((b) => ({ id: b.id, title: b.title })),
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
