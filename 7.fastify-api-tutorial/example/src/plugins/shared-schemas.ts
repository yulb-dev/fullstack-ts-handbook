import fp from "fastify-plugin";
import {
  ErrorDetailSchema,
  ErrorResponseSchema,
  PageMetaSchema,
} from "../schemas/common.js";
import { TaskListSchema, TaskSchema } from "../schemas/task.js";
import { PublicUserSchema } from "../schemas/user.js";

/**
 * 注册所有带 $id 的共享 schema。
 *
 * addSchema 是“封装”的：在子插件里注册的 schema，父级和兄弟插件里的路由引用不到，
 * 启动时会报 FST_ERR_SCH_VALIDATION_BUILD（can't resolve reference）。
 * 这里用 fastify-plugin 把它们注册到根实例上，所有路由都可以 { $ref: 'Task' }，
 * @fastify/swagger 也会把它们放进 components.schemas。
 */
export default fp(
  async function sharedSchemasPlugin(app) {
    for (const schema of [
      ErrorDetailSchema,
      ErrorResponseSchema,
      PageMetaSchema,
      PublicUserSchema,
      TaskSchema,
      TaskListSchema,
    ]) {
      app.addSchema(schema);
    }
  },
  { name: "shared-schemas", fastify: "5.x" },
);
