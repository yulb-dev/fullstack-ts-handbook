import fp from "fastify-plugin";
import {
  createMemoryStore,
  type SeedData,
  type Store,
} from "../data/memory-store.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Store;
  }
}

export interface DbPluginOptions {
  seed: SeedData;
}

/**
 * 数据访问插件：把“数据库”挂到实例上。
 * 用 fastify-plugin 包装，是因为 db 必须对兄弟插件（auth、tasks 路由）可见。
 */
export default fp<DbPluginOptions>(
  async function dbPlugin(app, options) {
    app.decorate("db", createMemoryStore(options.seed));

    app.addHook("onClose", async (instance) => {
      // 真实数据库在这里关闭连接池；onClose 在所有请求处理完之后才执行
      instance.log.info("database connections closed");
    });
  },
  { name: "db", fastify: "5.x" },
);
