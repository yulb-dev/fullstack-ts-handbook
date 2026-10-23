import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { MAX_PAGE_SIZE, parsePagination } from "@/domain/pagination.js";

describe("parsePagination", () => {
  it("缺省时返回第 1 页、每页 20 条", () => {
    expect(parsePagination()).toEqual({
      page: 1,
      pageSize: 20,
      offset: 0,
      limit: 20,
    });
    expect(parsePagination({})).toEqual({
      page: 1,
      pageSize: 20,
      offset: 0,
      limit: 20,
    });
  });

  it("查询串里的字符串数字会被 coerce 成 number", () => {
    // URL query 永远是字符串：这是分页解析最常见的输入形态
    expect(parsePagination({ page: "3", pageSize: "10" })).toEqual({
      page: 3,
      pageSize: 10,
      offset: 20,
      limit: 10,
    });
  });

  it("offset 按 (page-1)*pageSize 计算（第 1 页 offset 必须是 0）", () => {
    expect(parsePagination({ page: 1, pageSize: 50 }).offset).toBe(0);
    expect(parsePagination({ page: 2, pageSize: 50 }).offset).toBe(50);
    expect(parsePagination({ page: 10, pageSize: 5 }).offset).toBe(45);
  });

  // 边界值：每个约束取「刚好合法」与「刚好非法」两侧
  it("pageSize 上限：100 合法，101 拒绝", () => {
    expect(parsePagination({ pageSize: MAX_PAGE_SIZE }).pageSize).toBe(100);
    expect(() => parsePagination({ pageSize: MAX_PAGE_SIZE + 1 })).toThrow(
      ZodError,
    );
  });

  it("page 下限：1 合法，0 与负数拒绝", () => {
    expect(parsePagination({ page: 1 }).page).toBe(1);
    expect(() => parsePagination({ page: 0 })).toThrow(ZodError);
    expect(() => parsePagination({ page: -1 })).toThrow(ZodError);
  });

  it("非整数拒绝：1.5 页不存在", () => {
    expect(() => parsePagination({ page: 1.5 })).toThrow(ZodError);
    expect(() => parsePagination({ pageSize: "10.5" })).toThrow(ZodError);
  });

  it("非数字字符串拒绝，错误里带字段路径", () => {
    try {
      parsePagination({ page: "abc" });
      expect.unreachable("应当抛出 ZodError");
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      const zodError = error as ZodError;
      expect(zodError.issues[0]?.path).toEqual(["page"]);
    }
  });

  it("空字符串按缺省处理会失败——必须显式传 undefined", () => {
    // z.coerce.number() 会把 "" coerce 成 0，然后被 min(1) 拒绝。
    // 这正是要用测试钉住的行为：路由层把空 query 参数转成 undefined 再进来。
    expect(() => parsePagination({ page: "" })).toThrow(ZodError);
  });
});
