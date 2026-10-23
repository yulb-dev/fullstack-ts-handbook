import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";

/**
 * 给负载均衡/容器编排用的存活探针。
 * - 不在 /v1 下：它不是业务契约，不随 API 版本变化；
 * - hide: true：不出现在对外 API 文档里；
 * - logLevel: 'warn'：探针每几秒一次，不记 info 级请求日志，避免刷屏。
 */
const healthRoutes: FastifyPluginAsyncTypebox = async function (app) {
  app.get(
    "/healthz",
    {
      logLevel: "warn",
      schema: {
        hide: true,
        response: { 200: Type.Object({ status: Type.Literal("ok") }) },
      },
    },
    async () => ({ status: "ok" as const }),
  );
};

export default healthRoutes;
