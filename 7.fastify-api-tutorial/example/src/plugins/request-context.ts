import fp from "fastify-plugin";

export interface RequestContextOptions {
  /** 超过这个耗时（毫秒）的请求记一条 warn 日志 */
  slowRequestMs?: number;
}

/**
 * 请求级的横切关注点：
 *  - onSend：把请求 ID 回写到响应头，客户端报错时可以带上它；
 *  - onResponse：响应已经发出后做统计，这里记录慢请求。
 * 这两个 hook 对所有路由生效，所以用 fastify-plugin 注册到根作用域。
 */
export default fp<RequestContextOptions>(
  async function requestContextPlugin(app, options) {
    const slowRequestMs = options.slowRequestMs ?? 1000;

    app.addHook("onSend", async (request, reply, payload) => {
      reply.header("x-request-id", request.id);
      return payload;
    });

    app.addHook("onResponse", async (request, reply) => {
      if (reply.elapsedTime > slowRequestMs) {
        request.log.warn(
          {
            route: request.routeOptions.url,
            statusCode: reply.statusCode,
            elapsedMs: Math.round(reply.elapsedTime),
          },
          "slow request",
        );
      }
    });
  },
  { name: "request-context", fastify: "5.x" },
);
