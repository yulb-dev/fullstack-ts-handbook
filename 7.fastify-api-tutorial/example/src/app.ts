import rateLimit from "@fastify/rate-limit";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";
import type { SeedData } from "./data/memory-store.js";
import { createSeedData } from "./data/seed.js";
import {
  buildLoggerOptions,
  genReqId,
  logController,
  type LoggingOptions,
} from "./logger.js";
import healthRoutes from "./modules/health/routes.js";
import v1Routes from "./modules/v1.js";
import authPlugin from "./plugins/auth.js";
import dbPlugin from "./plugins/db.js";
import docsPlugin, { type DocsPluginOptions } from "./plugins/docs.js";
import errorHandlerPlugin from "./plugins/error-handler.js";
import requestContextPlugin from "./plugins/request-context.js";
import sharedSchemasPlugin from "./plugins/shared-schemas.js";

export interface BuildAppOptions {
  logging?: LoggingOptions; // 默认关闭；测试日志时传入内存 stream
  seed?: SeedData; // 默认使用种子数据；可传入定制数据
  docs?: DocsPluginOptions; // 默认 { ui: 'none' }
  createTaskRateLimit?: number; // 默认 20；测试限流时调小
  slowRequestMs?: number; // 默认 1000；测试慢请求日志时设为 0
}

/**
 * 应用工厂：只负责“装配”，不负责 listen。
 * 生产入口（server.ts）和测试都调用它，于是测试里跑的就是真实的插件组合。
 *
 * 注册顺序就是依赖顺序：
 *   基础设施（错误处理、请求上下文、共享 schema、数据库、认证、限流）
 *   → 文档（@fastify/swagger 必须先于路由，才能通过 onRoute 收集到它们）
 *   → 业务路由
 */
export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: buildLoggerOptions(options.logging ?? { enabled: false }),
    logController,
    genReqId,
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(errorHandlerPlugin);
  await app.register(requestContextPlugin, {
    slowRequestMs: options.slowRequestMs ?? 1000,
  });
  await app.register(sharedSchemasPlugin);
  await app.register(dbPlugin, { seed: options.seed ?? createSeedData() });
  await app.register(authPlugin);
  // global: false —— 只有在路由 config.rateLimit 中声明的路由才限流
  await app.register(rateLimit, { global: false });

  await app.register(docsPlugin, options.docs ?? { ui: "none" });

  await app.register(healthRoutes);
  await app.register(v1Routes, {
    prefix: "/v1",
    createTaskRateLimit: options.createTaskRateLimit ?? 20,
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
