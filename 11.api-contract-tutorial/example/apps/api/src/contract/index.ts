import { ErrorCode, ErrorResponse, FieldError } from "./common";
import { authSchemas } from "./auth";
import { projectSchemas } from "./projects";
import { taskSchemas } from "./tasks";

/** 所有带 $id 的共享 schema：注册顺序要求被引用者在前 */
export const sharedSchemas = [
  ErrorCode,
  FieldError,
  ErrorResponse,
  ...authSchemas,
  ...projectSchemas,
  ...taskSchemas,
];
