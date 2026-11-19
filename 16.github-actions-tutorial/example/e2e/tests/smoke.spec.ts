import { expect, test } from "@playwright/test";

// 关键旅程冒烟：打开页面 → 创建任务 → 列表可见 → 推进状态。
// 语义化定位（getByLabel/getByRole），无固定 sleep（阶段 13 的原则）。
test("创建任务并推进状态", async ({ page }) => {
  const title = `E2E 冒烟 ${Date.now()}`;

  await page.goto("/");
  await page.getByLabel("新任务标题").fill(title);
  await page.getByRole("button", { name: "创建" }).click();

  const item = page.getByRole("listitem").filter({ hasText: title });
  await expect(item).toBeVisible();
  await expect(item).toContainText("[todo]");

  await item.getByRole("button", { name: `推进 ${title}` }).click();
  await expect(item).toContainText("[doing]");
});
