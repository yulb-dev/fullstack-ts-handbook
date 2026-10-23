import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { createTaskSchema, transitionSchema } from "@/domain/task-schema.js";

describe("createTaskSchema", () => {
  it("接受合法输入并 trim 标题", () => {
    const parsed = createTaskSchema.parse({ title: "  修复登录页  " });
    expect(parsed.title).toBe("修复登录页");
    expect(parsed.dueDate).toBeUndefined();
    expect(parsed.assigneeId).toBeUndefined();
  });

  it("空白标题被拒绝（trim 后 min(1)）", () => {
    expect(() => createTaskSchema.parse({ title: "   " })).toThrow(ZodError);
    expect(() => createTaskSchema.parse({ title: "" })).toThrow(ZodError);
  });

  it("标题边界：80 字符合法，81 字符拒绝", () => {
    expect(() =>
      createTaskSchema.parse({ title: "a".repeat(80) }),
    ).not.toThrow();
    expect(() => createTaskSchema.parse({ title: "a".repeat(81) })).toThrow(
      "标题不能超过 80 个字符",
    );
  });

  it("dueDate：YYYY-MM-DD 与 ISO 字符串都 coerce 成 Date，空串变 null", () => {
    const a = createTaskSchema.parse({ title: "t", dueDate: "2026-04-01" });
    expect(a.dueDate).toBeInstanceOf(Date);
    expect(a.dueDate?.toISOString()).toBe("2026-04-01T00:00:00.000Z");

    const b = createTaskSchema.parse({
      title: "t",
      dueDate: "2026-04-01T08:30:00.000Z",
    });
    expect(b.dueDate?.toISOString()).toBe("2026-04-01T08:30:00.000Z");

    // .nullish()：undefined/null 保持原样
    expect(
      createTaskSchema.parse({ title: "t", dueDate: null }).dueDate,
    ).toBeNull();
    expect(createTaskSchema.parse({ title: "t" }).dueDate).toBeUndefined();
  });

  it("非法日期字符串被拒绝", () => {
    expect(() =>
      createTaskSchema.parse({ title: "t", dueDate: "not-a-date" }),
    ).toThrow(ZodError);
  });

  it("缺少 title 时错误路径指向 title", () => {
    const result = createTaskSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["title"]);
    }
  });
});

describe("transitionSchema", () => {
  it("只接受状态机里的四个状态名", () => {
    for (const to of ["todo", "in_progress", "done", "archived"]) {
      expect(transitionSchema.parse({ to }).to).toBe(to);
    }
  });

  it("未知状态名被拒绝——枚举就是白名单", () => {
    expect(() => transitionSchema.parse({ to: "deleted" })).toThrow(ZodError);
    expect(() => transitionSchema.parse({})).toThrow(ZodError);
  });
});
