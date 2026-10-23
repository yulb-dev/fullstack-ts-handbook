import type { Env } from "./env.js";

export type Mail = { to: string; subject: string; text: string };
export type Mailer = (message: Mail) => Promise<void>;

export function createMailer(env: Env): Mailer {
  if (env.MAIL_MODE === "local") {
    if (env.NODE_ENV === "production")
      throw new Error("禁止在生产打印认证邮件");
    return async (message) => {
      console.info("[仅限本地的邮件预览]", message);
    };
  }
  return async (message) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: env.MAIL_FROM, ...message }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`邮件服务拒绝交付：${response.status}`);
  };
}

// 教学实现：捕获后台发送失败，但不是持久化队列。
export function dispatchMail(send: Mailer, message: Mail): void {
  void send(message).catch(() => {
    console.error("认证邮件交付失败，请检查服务与告警；不记录邮件正文或 token");
  });
}
