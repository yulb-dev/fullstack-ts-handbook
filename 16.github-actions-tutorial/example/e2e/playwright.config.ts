import { defineConfig } from "@playwright/test";

// E2E 跑在「生产构建」上：api 用 node dist/server.js，web 用 vite preview。
// 所以执行顺序是 pnpm build → pnpm e2e（CI 的 main workflow 也是如此）。
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["html", { open: "never" }], ["github"]]
    : [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "pnpm --filter @workboard/api start",
      url: "http://localhost:3000/health/live",
      cwd: "..",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command:
        "pnpm --filter @workboard/web preview -- --port 4173 --strictPort",
      url: "http://localhost:4173",
      cwd: "..",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
