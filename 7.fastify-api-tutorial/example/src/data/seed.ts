import type { SeedData } from "./memory-store.js";

/** 固定 ID，方便在 curl 和测试里直接引用 */
export const SEED_IDS = {
  alice: "00000000-0000-4000-8000-000000000001",
  bob: "00000000-0000-4000-8000-000000000002",
  admin: "00000000-0000-4000-8000-000000000003",
  aliceTask: "10000000-0000-4000-8000-000000000001",
  bobTask: "10000000-0000-4000-8000-000000000002",
} as const;

export const SEED_TOKENS = {
  alice: "alice-token",
  bob: "bob-token",
  admin: "admin-token",
} as const;

export function createSeedData(): SeedData {
  return {
    users: [
      {
        id: SEED_IDS.alice,
        name: "Alice",
        email: "alice@example.com",
        role: "member",
        apiToken: SEED_TOKENS.alice,
      },
      {
        id: SEED_IDS.bob,
        name: "Bob",
        email: "bob@example.com",
        role: "member",
        apiToken: SEED_TOKENS.bob,
      },
      {
        id: SEED_IDS.admin,
        name: "Carol",
        email: "carol@example.com",
        role: "admin",
        apiToken: SEED_TOKENS.admin,
      },
    ],
    tasks: [
      {
        id: SEED_IDS.aliceTask,
        title: "准备周会材料",
        description: null,
        status: "todo",
        priority: "medium",
        ownerId: SEED_IDS.alice,
        assigneeId: null,
        createdAt: "2026-01-05T09:00:00.000Z",
        updatedAt: "2026-01-05T09:00:00.000Z",
        internalNote: "客户 VIP，优先处理",
        version: 1,
      },
      {
        id: SEED_IDS.bobTask,
        title: "修复登录页样式",
        description: "移动端按钮错位",
        status: "doing",
        priority: "high",
        ownerId: SEED_IDS.bob,
        assigneeId: SEED_IDS.bob,
        createdAt: "2026-01-06T09:00:00.000Z",
        updatedAt: "2026-01-06T09:00:00.000Z",
        internalNote: "与设计稿 v3 对照",
        version: 1,
      },
    ],
  };
}
