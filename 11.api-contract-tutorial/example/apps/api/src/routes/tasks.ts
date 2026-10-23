import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { errorResponses, ref } from "../contract/common";
import {
  CreateTaskBody,
  IdempotencyHeaders,
  IfMatchHeaders,
  ListTasksQuery,
  ProjectParams,
  Task,
  TaskPage,
  TaskParams,
  UpdateTaskBody,
} from "../contract/tasks";
import { requireAuth } from "../plugins/auth";
import {
  createTask,
  getTask,
  listTasks,
  updateTask,
} from "../services/task-service";

const writeSecurity = [{ cookieAuth: [], csrfHeader: [] }];

export const taskRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app;

  app.get(
    "/projects/:projectId/tasks",
    {
      schema: {
        operationId: "listTasks",
        tags: ["tasks"],
        summary: "分页列出项目任务（按创建时间倒序）",
        params: ProjectParams,
        querystring: ListTasksQuery,
        response: { 200: ref(TaskPage), ...errorResponses(400, 401, 404, 500) },
      },
    },
    async (request) => {
      const { user } = requireAuth(request);
      return listTasks(db, user.id, request.params.projectId, request.query);
    },
  );

  app.post(
    "/projects/:projectId/tasks",
    {
      schema: {
        operationId: "createTask",
        tags: ["tasks"],
        summary: "创建任务",
        description:
          "必须携带 Idempotency-Key。同一个键 + 相同请求体会重放第一次的结果（响应头 Idempotent-Replayed: true）；同一个键 + 不同请求体返回 422。",
        security: writeSecurity,
        params: ProjectParams,
        headers: IdempotencyHeaders,
        body: ref(CreateTaskBody),
        response: {
          201: ref(Task, { description: "已创建（或幂等重放）" }),
          ...errorResponses(400, 401, 403, 404, 409, 422, 500),
        },
      },
    },
    async (request, reply) => {
      const { user } = requireAuth(request);
      const { task, replayed } = await createTask(
        db,
        user.id,
        request.params.projectId,
        request.body,
        request.headers["idempotency-key"],
      );
      if (replayed) reply.header("idempotent-replayed", "true");
      return reply
        .code(201)
        .header("location", `/api/v1/tasks/${task.id}`)
        .header("etag", `"${task.version}"`)
        .send(task);
    },
  );

  app.get(
    "/tasks/:taskId",
    {
      schema: {
        operationId: "getTask",
        tags: ["tasks"],
        summary: "读取单个任务",
        params: TaskParams,
        response: { 200: ref(Task), ...errorResponses(400, 401, 404, 500) },
      },
    },
    async (request, reply) => {
      const { user } = requireAuth(request);
      const task = await getTask(db, user.id, request.params.taskId);
      return reply.header("etag", `"${task.version}"`).send(task);
    },
  );

  app.patch(
    "/tasks/:taskId",
    {
      schema: {
        operationId: "updateTask",
        tags: ["tasks"],
        summary: "部分更新任务（乐观并发）",
        description:
          '必须携带 If-Match: "<version>"。版本不一致返回 412，缺少返回 428。',
        security: writeSecurity,
        params: TaskParams,
        headers: IfMatchHeaders,
        body: ref(UpdateTaskBody),
        response: {
          200: ref(Task),
          ...errorResponses(400, 401, 403, 404, 409, 412, 428, 500),
        },
      },
    },
    async (request, reply) => {
      const { user } = requireAuth(request);
      const task = await updateTask(
        db,
        user.id,
        request.params.taskId,
        request.body,
        request.headers["if-match"],
      );
      return reply.header("etag", `"${task.version}"`).send(task);
    },
  );
};
