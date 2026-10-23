import { test as setup, expect } from '@playwright/test';

/**
 * setup 项目：只负责登录并保存 storageState，不做业务断言。
 * 其他项目通过 dependencies: ['setup'] + storageState 复用登录态（见第 7 章）。
 */
const authFile = 'playwright/.auth/alice.json';

setup('authenticate as alice', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('邮箱').fill('alice@taskboard.dev');
  await page.getByLabel('密码').fill('alice123');
  await page.getByRole('button', { name: '登录' }).click();

  // 等待「登录确实完成」的可观察信号，而不是等固定时间：
  // 顶栏出现用户名，说明 /api/me 与会话 cookie 都已就绪。
  await expect(page.getByText('alice@taskboard.dev')).toBeVisible();

  await page.context().storageState({ path: authFile });
});
