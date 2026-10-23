import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "typebox";
import { AppError } from "../../errors/app-error.js";
import { currentUser } from "../../plugins/auth.js";
import { errorResponses, ref, Uuid } from "../../schemas/common.js";
import { PublicUserSchema, UserRoleSchema } from "../../schemas/user.js";

/** 管理员视角的用户：比 PublicUser 多一个 email，但仍然没有 apiToken */
const AdminUserViewSchema = Type.Object({
  id: Uuid,
  name: Type.String(),
  email: Type.String({ format: "email" }),
  role: UserRoleSchema,
});

const userRoutes: FastifyPluginAsyncTypebox = async function (app) {
  app.get(
    "/me",
    {
      schema: {
        tags: ["users"],
        summary: "当前登录用户",
        operationId: "getCurrentUser",
        response: {
          // handler 返回的是完整的 UserRecord（含 email、apiToken），
          // 响应 schema 只允许 id/name/role 通过
          200: ref(PublicUserSchema),
          ...errorResponses(401),
        },
      },
    },
    async (request) => currentUser(request),
  );

  app.get(
    "/admin/users/:userId",
    {
      // 路由级 onRequest 在作用域级 onRequest（authenticate）之后执行，此时 request.user 已就绪
      onRequest: app.requireRole("admin"),
      schema: {
        tags: ["users"],
        summary: "查看用户详情（仅管理员）",
        operationId: "getUserAsAdmin",
        params: Type.Object({ userId: Uuid }),
        response: {
          200: AdminUserViewSchema,
          ...errorResponses(400, 401, 403, 404),
        },
      },
    },
    async (request) => {
      const user = await app.db.users.findById(request.params.userId);
      if (!user) throw new AppError("USER_NOT_FOUND");
      return user;
    },
  );
};

export default userRoutes;
