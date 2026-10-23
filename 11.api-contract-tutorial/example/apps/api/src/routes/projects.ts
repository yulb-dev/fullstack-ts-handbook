import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { desc, eq } from "drizzle-orm";
import { errorResponses, ref } from "../contract/common";
import { ProjectList } from "../contract/projects";
import { projectMembers, projects } from "../db/schema";
import { requireAuth } from "../plugins/auth";

export const projectRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app;

  app.get(
    "/projects",
    {
      schema: {
        operationId: "listMyProjects",
        tags: ["projects"],
        summary: "列出我参与的项目",
        response: { 200: ref(ProjectList), ...errorResponses(401, 500) },
      },
    },
    async (request) => {
      const { user } = requireAuth(request);
      const rows = await db
        .select({
          id: projects.id,
          name: projects.name,
          myRole: projectMembers.role,
          createdAt: projects.createdAt,
        })
        .from(projectMembers)
        .innerJoin(projects, eq(projects.id, projectMembers.projectId))
        .where(eq(projectMembers.userId, user.id))
        .orderBy(desc(projects.createdAt));
      return {
        items: rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  );
};
