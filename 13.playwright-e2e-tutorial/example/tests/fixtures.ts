import { test as base, expect } from "@playwright/test";
import { createHash } from "node:crypto";

/**
 * 自定义 fixture：每个测试独享的「数据种子」。
 * - 任务标题带 testId，保证并行测试互不碰撞；
 * - 通过 API 造数（快），UI 只验证用户可观察行为（真）。
 * 讲解见第 5 章（fixture）与第 8 章（API 造数）。
 */
type Seed = {
  /** 生成一个「本轮运行 + 本测试」专属的任务标题 */
  uniqueTitle(prefix: string): string;
  /** 通过 API 在当前工作区创建一个任务，返回完整任务对象 */
  createTask(input: {
    title: string;
    status?: "todo" | "doing" | "done";
  }): Promise<{
    id: string;
    title: string;
    status: string;
    assignee: string;
    notes: string;
  }>;
};

const RUN_ID = Date.now().toString(36);

export const test = base.extend<{ seed: Seed }>({
  seed: async ({ request }, use, testInfo) => {
    const workspaceId = "ws-alpha";
    // 唯一后缀 = hash(本轮运行 + 本测试) 取前 10 位：
    // - 只用 testId 不够：它是稳定哈希，跨运行不变——若服务器数据残留
    //  （如本地 reuseExistingServer），上一轮的同名任务会让搜索命中 2 条；
    // - 直接拼接 RUN_ID + testId 又太长：testId 本身 33 字符，
    //   叠加中文前缀会超过应用 80 字符的标题上限——唯一性方案也要守业务约束。
    const suffix = createHash("sha1")
      .update(`${RUN_ID}:${testInfo.testId}`)
      .digest("hex")
      .slice(0, 10);
    await use({
      uniqueTitle: (prefix) => `${prefix}-${suffix}`,
      createTask: async ({ title, status = "todo" }) => {
        const res = await request.post(
          `/api/tasks?workspaceId=${workspaceId}`,
          {
            data: { title, status },
          },
        );
        expect(res.status(), "造数接口应当返回 201").toBe(201);
        const body = await res.json();
        return body.task;
      },
    });
  },
});

export { expect };
