import type { BetterAuthOptions } from "better-auth";
import type { Env } from "./env.js";
import { dispatchMail, type Mailer } from "./mail.js";

export function authOptions(env: Env, send: Mailer) {
  return {
    appName: "Harbor",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.WEB_ORIGIN],
    logger: {
      level: "warn",
      log: (level, message) => {
        if (env.NODE_ENV === "test") return;
        // 生产仅留组件事件级别；详细诊断与安全审计需受控、脱敏通道。
        console.warn(
          env.NODE_ENV === "production"
            ? `认证组件事件：${level}`
            : message.replace(/https?:\/\/\S+/g, "[URL 已脱敏]"),
        );
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        dispatchMail(send, {
          to: user.email,
          subject: "重置 Harbor 密码",
          text: url,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        dispatchMail(send, {
          to: user.email,
          subject: "验证 Harbor 邮箱",
          text: url,
        });
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 5,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
      },
    },
    advanced: {
      // 测试环境也执行真实 origin / CSRF 检查，避免安全测试虚假通过。
      disableOriginCheck: false,
      disableCSRFCheck: false,
      useSecureCookies: env.NODE_ENV === "production",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    },
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          socialProviders: {
            github: {
              clientId: env.GITHUB_CLIENT_ID,
              clientSecret: env.GITHUB_CLIENT_SECRET,
              requireEmailVerification: true,
            },
          },
        }
      : {}),
  } satisfies BetterAuthOptions;
}
