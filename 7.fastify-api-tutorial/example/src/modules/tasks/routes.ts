import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
// 只引入类型：让路由 config 里的 rateLimit 字段有类型提示（插件本身在 app.ts 注册）
import type {} from "@fastify/rate-limit";
import type { FastifyRequest } from "fastify";
import type { TaskRecord } from "../../data/memory-store.js";
import { AppError } from "../../errors/app-error.js";
import { currentUser } from "../../plugins/auth.js";
import { errorResponses, ref } from "../../schemas/common.js";
import {
  CreateTaskBodySchema,
  ListTasksQuerySchema,
  TaskListSchema,
  TaskParamsSchema,
  TaskSchema,
  UpdateTaskBodySchema,
  UpdateTaskHeadersSchema,
} from "../../schemas/task.js";
import { createTaskService, type TaskService } from "./service.js";

declare module "fastify" {
  interface FastifyInstance {
    /** 只在 tasks 插件作用域内存在（见下方 decorate） */
    taskService: TaskService;
  }
  interface FastifyRequest {
    /** 由 loadWritableTask 这个 preHandler 填充；只在 tasks 作用域内存在 */
    task: TaskRecord | null;
  }
}

export interface TaskRoutesOptions {
  /** 每个用户每分钟最多创建多少个任务 */
  createTaskRateLimit: number;
}

/**
 * preValidation：在 schema 校验之前规范化原始输入。
 * 去掉首尾空白后再校验，"   " 这样的标题就会因为 minLength 被拒绝。
 * 这里只做纯计算，不访问数据库。
 */
async function trimBodyStrings(request: FastifyRequest): Promise<void> {
  const body = request.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) return;
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string")
      (body as Record<string, unknown>)[key] = value.trim();
  }
}

function loadedTask(request: FastifyRequest): TaskRecord {
  // 走到这里却没有 task，说明路由忘了挂 preHandler：这是程序错误，交给 500
  if (!request.task)
    throw new Error("loadWritableTask preHandler is missing on this route");
  return request.task;
}

/** ETag 必须带双引号（RFC 9110）；内容用内部版本号，不暴露更多信息 */
function etagOf(task: TaskRecord): string {
  return `"${task.version}"`;
}

/**
 * 任务路由插件。没有用 fastify-plugin 包装，所以它是一个独立的封装作用域：
 * 这里 decorate 的 taskService、decorateRequest 的 task，外部都看不到。
 */
const taskRoutes: FastifyPluginAsyncTypebox<TaskRoutesOptions> =
  async function (app, options) {
    app.decorate("taskService", createTaskService(app.db));
    app.decorateRequest("task", null);

    /**
     * preHandler：此时参数已经通过校验（taskId 一定是 UUID），可以放心查库。
     * 统一处理“任务是否存在 / 是否有权修改”，handler 只关心更新本身。
     */
    async function loadWritableTask(request: FastifyRequest): Promise<void> {
      const actor = currentUser(request);
      // params 已经被 TaskParamsSchema 校验过；这个 hook 被多个路由复用，所以在这里显式标注类型
      const { taskId } = request.params as { taskId: string };
      const task = await app.taskService.getVisible(actor, taskId);
      app.taskService.assertCanWrite(actor, task);
      request.task = task;
    }

    app.get(
      "/tasks",
      {
        schema: {
          tags: ["tasks"],
          summary: "分页列出我能看到的任务",
          operationId: "listTasks",
          querystring: ListTasksQuerySchema,
          response: {
            200: ref(TaskListSchema),
            ...errorResponses(400, 401),
          },
        },
      },
      async (request) => {
        return app.taskService.list(currentUser(request), request.query);
      },
    );

    app.get(
      "/tasks/:taskId",
      {
        schema: {
          tags: ["tasks"],
          summary: "查看单个任务",
          description: "响应头 ETag 可用于后续 PATCH 的 If-Match",
          operationId: "getTask",
          params: TaskParamsSchema,
          response: {
            200: ref(TaskSchema),
            ...errorResponses(400, 401, 404),
          },
        },
      },
      async (request, reply) => {
        const task = await app.taskService.getVisible(
          currentUser(request),
          request.params.taskId,
        );
        reply.header("etag", etagOf(task));
        return task;
      },
    );

    app.post(
      "/tasks",
      {
        preValidation: trimBodyStrings,
        config: {
          rateLimit: {
            max: options.createTaskRateLimit,
            timeWindow: "1 minute",
            // 已登录接口按用户限流，比按 IP 更公平（同一出口 IP 后面可能有很多人）
            keyGenerator: (request) => request.user?.id ?? request.ip,
          },
        },
        schema: {
          tags: ["tasks"],
          summary: "创建任务",
          operationId: "createTask",
          body: CreateTaskBodySchema,
          response: {
            201: ref(TaskSchema),
            ...errorResponses(400, 401, 409, 422, 429),
          },
        },
      },
      async (request, reply) => {
        const task = await app.taskService.create(
          currentUser(request),
          request.body,
        );
        request.log.info({ taskId: task.id }, "task created");
        // app.prefix 是当前作用域的前缀（这里是 /v1），避免把版本号写死在业务代码里
        return reply
          .code(201)
          .header("location", `${app.prefix}/tasks/${task.id}`)
          .send(task);
      },
    );

    app.patch(
      "/tasks/:taskId",
      {
        preValidation: trimBodyStrings,
        preHandler: loadWritableTask,
        schema: {
          tags: ["tasks"],
          summary: "修改任务（部分字段）",
          operationId: "updateTask",
          params: TaskParamsSchema,
          headers: UpdateTaskHeadersSchema,
          body: UpdateTaskBodySchema,
          response: {
            200: ref(TaskSchema),
            ...errorResponses(400, 401, 403, 404, 409, 412, 422),
          },
        },
      },
      async (request, reply) => {
        const task = loadedTask(request);
        // 子 logger：这条请求后续的日志都带上 taskId，而不必每次手写
        const log = request.log.child({ taskId: task.id });

        const ifMatch = request.headers["if-match"];
        if (ifMatch !== undefined && ifMatch !== etagOf(task)) {
          log.info({ ifMatch, current: etagOf(task) }, "stale update rejected");
          throw new AppError("PRECONDITION_FAILED");
        }

        const updated = await app.taskService.update(task, request.body);
        log.info({ changedFields: Object.keys(request.body) }, "task updated");
        reply.header("etag", etagOf(updated));
        return updated;
      },
    );

    app.delete(
      "/tasks/:taskId",
      {
        preHandler: loadWritableTask,
        schema: {
          tags: ["tasks"],
          summary: "删除任务",
          operationId: "deleteTask",
          params: TaskParamsSchema,
          response: {
            204: Type.Null({ description: "删除成功，无响应体" }),
            ...errorResponses(400, 401, 403, 404),
          },
        },
      },
      async (request, reply) => {
        const task = loadedTask(request);
        await app.taskService.remove(task);
        request.log.info({ taskId: task.id }, "task deleted");
        return reply.code(204).send(null);
      },
    );
  };

export default taskRoutes;
