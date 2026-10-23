import Type, { type Static } from "typebox";
import { Id, ref } from "./common";

export const LoginBody = Type.Object(
  {
    email: Type.String({ format: "email", maxLength: 254 }),
  },
  {
    $id: "LoginBody",
    additionalProperties: false,
    description:
      "教学用免密登录：只校验邮箱是否存在。真实项目换成密码/OAuth/Passkey",
  },
);

export const User = Type.Object(
  {
    id: Id,
    email: Type.String({ format: "email" }),
    displayName: Type.String(),
  },
  { $id: "User", additionalProperties: false },
);
export type User = Static<typeof User>;

export const Session = Type.Object(
  {
    user: ref(User),
    csrfToken: Type.String({
      description: "写请求必须放进 X-CSRF-Token 请求头（第 8 章）",
    }),
  },
  { $id: "Session", additionalProperties: false },
);
export type Session = Static<typeof Session>;

export const authSchemas = [LoginBody, User, Session];
