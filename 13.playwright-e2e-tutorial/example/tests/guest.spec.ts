import { test, expect } from "@playwright/test";

/**
 * 未登录（游客）视角。
 * 关键点：用 test.use 把 storageState 重置为空，
 * 覆盖掉项目级配置里注入的 alice 登录态（第 7 章）。
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("游客边界", () => {
  test("未登录访问首页时只能看到登录表单", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "登录 TaskBoard" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "任务列表" })).toBeHidden();
  });

  test("错误的密码会得到明确提示，且不会进入应用", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("邮箱").fill("alice@taskboard.dev");
    await page.getByLabel("密码").fill("wrong-password");
    await page.getByRole("button", { name: "登录" }).click();

    await expect(page.getByRole("alert")).toHaveText("邮箱或密码不正确");
    await expect(page.getByRole("heading", { name: "任务列表" })).toBeHidden();
  });

  test("未登录直接调用 API 会被拒绝（401）", async ({ page, request }) => {
    // 即使绕过 UI 直接发请求，服务端也必须拒绝——E2E 同样要覆盖这一层
    const res = await request.get("/api/tasks?workspaceId=ws-alpha");
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");

    // 顺带确认页面本身仍然正常（没有因为 401 崩溃）
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "登录 TaskBoard" }),
    ).toBeVisible();
  });
});
