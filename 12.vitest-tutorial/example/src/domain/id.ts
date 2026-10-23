import { randomBytes } from "node:crypto";

/**
 * 任务 ID 生成。单独放在一个模块里，是为了在测试中演示 vi.mock：
 * 用确定性的假 ID 替换随机 ID，让快照与断言稳定。
 * 业务代码永远通过 import 使用它，而不是把 Math.random 散落在各处。
 */
export function generateTaskId(): string {
  return `task_${randomBytes(8).toString("hex")}`;
}
