import { Type, type Static } from "typebox";
import { Uuid } from "./common.js";

export const UserRoleSchema = Type.Enum(["member", "admin"], {
  description: "member 只能管理自己的任务；admin 可以管理所有任务",
});

export type UserRole = Static<typeof UserRoleSchema>;

/** 对外公开的用户信息。注意：这里刻意没有 email 和 apiToken。 */
export const PublicUserSchema = Type.Object(
  {
    id: Uuid,
    name: Type.String(),
    role: UserRoleSchema,
  },
  { $id: "PublicUser", description: "对外公开的用户信息" },
);

export type PublicUser = Static<typeof PublicUserSchema>;
