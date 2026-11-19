import { describe, expect, it } from "vitest";
import { canTransition, isTaskStatus, parsePagination } from "../src/index.js";

describe("canTransition", () => {
  it("允许 todo → doing → done", () => {
    expect(canTransition("todo", "doing")).toBe(true);
    expect(canTransition("doing", "done")).toBe(true);
  });

  it("允许 doing 回退 todo", () => {
    expect(canTransition("doing", "todo")).toBe(true);
  });

  it("拒绝 todo 直跳 done 与 done 出终态", () => {
    expect(canTransition("todo", "done")).toBe(false);
    expect(canTransition("done", "todo")).toBe(false);
    expect(canTransition("done", "doing")).toBe(false);
  });
});

describe("isTaskStatus", () => {
  it("只接受三个合法值", () => {
    expect(isTaskStatus("todo")).toBe(true);
    expect(isTaskStatus("archived")).toBe(false);
    expect(isTaskStatus(1)).toBe(false);
    expect(isTaskStatus(undefined)).toBe(false);
  });
});

describe("parsePagination", () => {
  it("缺省回退 page=1 pageSize=20", () => {
    expect(parsePagination({})).toEqual({ page: 1, pageSize: 20 });
  });

  it("非法输入回退默认值", () => {
    expect(parsePagination({ page: "abc", pageSize: -3 })).toEqual({
      page: 1,
      pageSize: 20,
    });
    expect(parsePagination({ page: 1.5 })).toEqual({ page: 1, pageSize: 20 });
  });

  it("pageSize 上限钳制为 100", () => {
    expect(parsePagination({ page: "2", pageSize: "500" })).toEqual({
      page: 2,
      pageSize: 100,
    });
  });
});
