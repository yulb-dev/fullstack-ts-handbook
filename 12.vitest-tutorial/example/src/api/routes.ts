import type { FastifyInstance } from "fastify";
import type { Actor } from "@/domain/permissions.js";
import { transitionSchema } from "@/domain/task-schema.js";
import type { TaskService } from "@/services/task-service.js";

interface CreateTaskBody {
  title?: unknown;
  dueDate?: unknown;
  assigneeId?: unknown;
}

interface TransitionBody {
  to?: unknown;
}

/** 路由层只做三件事：取出身份、校验请求形状、调用 service。业务规则不在这里重复 */
export function registerRoutes(
  app: FastifyInstance,
  service: TaskService,
): void {
  app.get("/tasks", async (request, reply) => {
    const actor: Actor = request.actor;
    const query = request.query as Record<string, string | undefined>;
    const result = await service.listTasks(actor, query);
    return reply.status(200).send(result);
  });

  app.post("/tasks", async (request, reply) => {
    const actor: Actor = request.actor;
    const body = (request.body ?? {}) as CreateTaskBody;
    const task = await service.createTask(actor, {
      title: body.title,
      dueDate: body.dueDate,
      assigneeId: body.assigneeId,
    });
    return reply.status(201).send({ task });
  });

  app.post("/tasks/:id/transition", async (request, reply) => {
    const actor: Actor = request.actor;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as TransitionBody;
    const parsed = transitionSchema.parse(body); // 非法状态名 → ZodError → 400
    const task = await service.transitionStatus(actor, id, parsed.to);
    return reply.status(200).send({ task });
  });
}
