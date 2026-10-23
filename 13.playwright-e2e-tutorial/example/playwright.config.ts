import { defineConfig, devices } from '@playwright/test';

/**
 * TaskBoard lite 的 E2E 配置。
 * 各配置项的含义在教程第 6 章逐项讲解。
 */
export default defineConfig({
  testDir: './tests',

  // 单个测试的超时上限（毫秒）
  timeout: 30_000,

  // web-first 断言的重试上限
  expect: { timeout: 5_000 },

  // CI 上禁止 .only，防止「只跑了一个测试」的绿色假象
  forbidOnly: Boolean(process.env.CI),

  // 本地不重试；CI 上重试一次并顺带录制 trace
  retries: process.env.CI ? 1 : 0,

  // CI 上限制并发保稳定；本地用默认值（约 CPU 核数的一半）
  workers: process.env.CI ? 2 : undefined,

  reporter: process.env.CI
    ? [['html'], ['github']]
    : [['html', { open: 'never' }]],

  use: {
    baseURL: 'http://127.0.0.1:4173',
    // 失败时保留截图与视频；trace 只在 CI 首次重试时录制
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
  },

  projects: [
    // 登录一次，产出 storageState 供其他项目复用
    { name: 'setup', testMatch: /.*\.setup\.ts/ },

    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/alice.json' },
      dependencies: ['setup'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], storageState: 'playwright/.auth/alice.json' },
      dependencies: ['setup'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], storageState: 'playwright/.auth/alice.json' },
      dependencies: ['setup'],
    },

    // 未登录场景不需要单独的项目：
    // guest.spec.ts 内部用 test.use({ storageState: { cookies: [], origins: [] } }) 重置。
  ],

  // 由 Playwright 负责启动/复用被测服务
  webServer: {
    command: 'npm run app',
    url: 'http://127.0.0.1:4173/api/health',
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
});
