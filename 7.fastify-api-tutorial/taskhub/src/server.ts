import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/healthz", async () => {
  return { status: "ok" };
});

await app.listen({ host: "127.0.0.1", port: 3000 });
