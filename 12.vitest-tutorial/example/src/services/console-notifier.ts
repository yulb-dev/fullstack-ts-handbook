import type { TaskRecord } from "@/services/ports.js";

/** 本地开发用的通知实现：只打印日志。真实项目里这里可能是邮件、Webhook 或消息队列 */
export function createConsoleNotifier() {
  return {
    async taskCreated(task: TaskRecord) {
      console.log(`[notify] task created: ${task.id} (${task.title})`);
    },
    async taskTransitioned(task: TaskRecord, from: string, to: string) {
      console.log(`[notify] task ${task.id}: ${from} -> ${to}`);
    },
  };
}
