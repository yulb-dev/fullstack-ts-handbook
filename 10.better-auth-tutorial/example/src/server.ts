import { db, env, pool } from "./db/client.js";
import { auth } from "./auth.js";
import { createApp } from "./app.js";

const app = await createApp(db, auth, env);
app.addHook("onClose", async () => {
  await pool.end();
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().catch(() => {
      process.exitCode = 1;
    });
  });
}
try {
  await app.listen({ host: "127.0.0.1", port: 4000 });
} catch {
  await app.close();
  process.exitCode = 1;
}
