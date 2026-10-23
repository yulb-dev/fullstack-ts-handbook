import { describe, expect, it } from "vitest";
import {
  canArchiveTask,
  canCreateTask,
  canUpdateTask,
  canViewBoard,
  type Actor,
} from "@/domain/permissions.js";

const member: Actor = { id: "u1", role: "member" };
const otherMember: Actor = { id: "u2", role: "member" };
const manager: Actor = { id: "m1", role: "manager" };

const taskOwnedByMember = { ownerId: "u1", assigneeId: null };

describe("permissions RBAC", () => {
  it("任何登录用户都能创建任务", () => {
    expect(canCreateTask(member)).toBe(true);
    expect(canCreateTask(manager)).toBe(true);
  });

  it("member 能改自己创建的任务", () => {
    expect(canUpdateTask(member, taskOwnedByMember)).toBe(true);
  });

  it("member 能改指派给自己的任务", () => {
    const assigned = { ownerId: "someone-else", assigneeId: "u1" };
    expect(canUpdateTask(member, assigned)).toBe(true);
  });

  it("member 不能改别人的任务（越权路径必须有明确断言）", () => {
    const foreign = { ownerId: "someone-else", assigneeId: "yet-another" };
    expect(canUpdateTask(member, foreign)).toBe(false);
    expect(canUpdateTask(otherMember, taskOwnedByMember)).toBe(false);
  });

  it("manager 能改任何任务", () => {
    const foreign = { ownerId: "someone-else", assigneeId: null };
    expect(canUpdateTask(manager, foreign)).toBe(true);
  });

  it("只有 manager 能归档", () => {
    expect(canArchiveTask(member)).toBe(false);
    expect(canArchiveTask(manager)).toBe(true);
  });

  it("两种角色都能查看列表", () => {
    expect(canViewBoard(member)).toBe(true);
    expect(canViewBoard(manager)).toBe(true);
  });
});
