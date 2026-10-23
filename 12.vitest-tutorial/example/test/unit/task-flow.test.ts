import { describe, expect, it } from "vitest";
import {
  canTransition,
  isTerminal,
  nextStatuses,
  TASK_STATUSES,
  type TaskStatus,
} from "@/domain/task-flow.js";

describe("task-flow 状态机", () => {
  it("todo 只能进入 in_progress 或 archived", () => {
    expect(canTransition("todo", "in_progress")).toBe(true);
    expect(canTransition("todo", "archived")).toBe(true);
    expect(canTransition("todo", "done")).toBe(false); // 不允许跳过进行中直接完成
    expect(canTransition("todo", "todo")).toBe(false); // 原地踏步也是非法迁移
  });

  it("in_progress 可以回退、完成或归档", () => {
    expect(canTransition("in_progress", "todo")).toBe(true);
    expect(canTransition("in_progress", "done")).toBe(true);
    expect(canTransition("in_progress", "archived")).toBe(true);
  });

  it("done 只能重新打开，不能直接归档", () => {
    expect(canTransition("done", "in_progress")).toBe(true);
    expect(canTransition("done", "archived")).toBe(false);
    expect(canTransition("done", "todo")).toBe(false);
  });

  it("archived 是终态：任何迁移都非法", () => {
    for (const to of TASK_STATUSES) {
      expect(canTransition("archived", to)).toBe(false);
    }
    expect(isTerminal("archived")).toBe(true);
    expect(nextStatuses("archived")).toEqual([]);
  });

  it("nextStatuses 与 canTransition 对同一张表负责（穷举交叉验证）", () => {
    // 边界思维：不是抽几个例子，而是穷举 4×4 全矩阵，防止两张表不一致
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        expect(canTransition(from, to)).toBe(nextStatuses(from).includes(to));
      }
    }
  });

  it("非终态都有至少一个出口", () => {
    const nonTerminal = TASK_STATUSES.filter((s: TaskStatus) => !isTerminal(s));
    expect(nonTerminal).toEqual(["todo", "in_progress", "done"]);
    for (const status of nonTerminal) {
      expect(nextStatuses(status).length).toBeGreaterThan(0);
    }
  });
});
