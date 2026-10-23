import contract from "@taskflow/api-client/openapi.json";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  PRIORITY_LABEL,
  createTaskFormSchema,
  toCreateTaskBody,
} from "./task-form-schema";

/**
 * 前端 Zod 与服务端契约「独立维护」，但数值约束不能悄悄分叉。
 * 规则：表单可以比契约更严格（体验选择），但绝不能更宽松——
 * 否则用户在表单里填得好好的，提交后才被服务端 400 拒绝。
 */
type JsonSchema = {
  minLength?: number;
  maxLength?: number;
  enum?: string[];
  anyOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
};

const body = contract.components.schemas.CreateTaskBody as JsonSchema;
const form = z.toJSONSchema(createTaskFormSchema, {
  io: "input",
}) as JsonSchema;

/** 契约里 nullable 字段是 anyOf: [string, null]，取出 string 分支 */
function stringBranch(schema: JsonSchema | undefined): JsonSchema {
  return (
    schema?.anyOf?.find(
      (s) => s.maxLength !== undefined || s.minLength !== undefined,
    ) ??
    schema ??
    {}
  );
}

describe("表单 schema 与 OpenAPI 契约对齐", () => {
  for (const field of ["title", "description"] as const) {
    it(`${field} 的长度限制不比契约宽松`, () => {
      const server = stringBranch(body.properties?.[field]);
      const client = stringBranch(form.properties?.[field]);
      if (server.maxLength !== undefined) {
        expect(client.maxLength, "表单缺少 maxLength").toBeDefined();
        expect(client.maxLength!).toBeLessThanOrEqual(server.maxLength);
      }
      if (server.minLength !== undefined) {
        expect(client.minLength ?? 0).toBeGreaterThanOrEqual(server.minLength);
      }
    });
  }

  it("优先级选项与契约枚举完全一致", () => {
    const serverEnum = (contract.components.schemas.TaskPriority as JsonSchema)
      .enum;
    expect(Object.keys(PRIORITY_LABEL).sort()).toEqual(
      [...(serverEnum ?? [])].sort(),
    );
  });
});

describe("toCreateTaskBody", () => {
  it("空字符串整理成 null，标题去掉首尾空格", () => {
    const values = createTaskFormSchema.parse({
      title: "  发布  ",
      description: "",
      priority: "high",
      dueDate: "",
    });
    expect(toCreateTaskBody(values)).toEqual({
      title: "发布",
      description: null,
      priority: "high",
      dueDate: null,
    });
  });
});
