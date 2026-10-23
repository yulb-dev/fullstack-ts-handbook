import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import taskRoutes from "./tasks/routes.js";
import userRoutes from "./users/routes.js";

export interface V1Options {
  createTaskRateLimit: number;
}

/**
 * /v1 版本的全部业务路由。
 * 这个插件没有用 fastify-plugin 包装，所以下面 addHook 的 authenticate
 * 只作用于 /v1 下的路由；/healthz、/docs 不受影响。
 */
const v1Routes: FastifyPluginAsyncTypebox<V1Options> = async function (
  app,
  options,
) {
  app.addHook("onRequest", app.authenticate);

  await app.register(userRoutes);
  await app.register(taskRoutes, {
    createTaskRateLimit: options.createTaskRateLimit,
  });
};

export default v1Routes;
