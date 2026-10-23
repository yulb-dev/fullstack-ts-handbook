import Type, { type Static } from "typebox";
import { DateTime, Id, ref } from "./common";

export const MemberRole = Type.Enum(["owner", "editor", "viewer"], {
  $id: "MemberRole",
});

export const Project = Type.Object(
  {
    id: Id,
    name: Type.String(),
    myRole: ref(MemberRole),
    createdAt: DateTime,
  },
  { $id: "Project", additionalProperties: false },
);
export type Project = Static<typeof Project>;

export const ProjectList = Type.Object(
  { items: Type.Array(ref(Project)) },
  { $id: "ProjectList", additionalProperties: false },
);

export const projectSchemas = [MemberRole, Project, ProjectList];
