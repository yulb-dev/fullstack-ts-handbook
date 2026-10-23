import { test, expect } from "./fixtures";

/**
 * 跨工作区越权场景（对应第 12 章综合实战 · 练习 2）。
 * 数据模型：alice 只属于 ws-alpha；bob 只属于 ws-beta。
 * 约定：非成员访问一律 403（不回 404，避免泄露资源是否存在）。
 */

test.describe("租户隔离：alice 看不到 ws-beta 的数据", () => {
  test("工作区切换器里只有自己所属的工作区", async ({ page }) => {
    await page.goto("/");
    const select = page.getByLabel("当前工作区");
    await expect(select).toHaveCount(1);
    // alice 只属于 Alpha，看不到 Beta
    await expect(select.locator("option")).toHaveText(["Alpha"]);
  });

  test("带 cookie 直接请求他人工作区的任务列表会得到 403", async ({
    request,
  }) => {
    // request fixture 复用了 alice 的 storageState：有合法会话，但无 Beta 权限
    const res = await request.get("/api/tasks?workspaceId=ws-beta");
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });

  test("按 id 访问他人工作区的任务同样 403，且不泄露存在性", async ({
    request,
  }) => {
    // t-107 / t-108 是种子数据里 ws-beta 的任务 id
    const res = await request.get("/api/tasks/t-107");
    expect(res.status()).toBe(403);

    // 不存在的任务 id 与「存在但无权」的任务 id，对 alice 而言响应必须一致，
    // 否则攻击者可以靠 404/403 的差异枚举出资源存在性。
    const missing = await request.get("/api/tasks/t-does-not-exist");
    expect(missing.status()).toBe(403);
    expect((await missing.json()).error.code).toBe("forbidden");
  });

  test("bob 在 Beta 创建的任务，alice 通过 UI 搜索不到", async ({
    browser,
    seed,
  }) => {
    const title = seed.uniqueTitle("Beta机密任务");

    // 1) 用独立的浏览器上下文以 bob 身份登录（多角色协作测试的标准手法，第 7 章）
    const bobContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const bobPage = await bobContext.newPage();
    await bobPage.goto("/");
    await bobPage.getByLabel("邮箱").fill("bob@taskboard.dev");
    await bobPage.getByLabel("密码").fill("bob123");
    await bobPage.getByRole("button", { name: "登录" }).click();
    await expect(bobPage.getByText("bob@taskboard.dev")).toBeVisible();

    // 2) bob 在自己的工作区创建任务（UI 操作，走真实用户路径）
    await bobPage.getByLabel("任务标题").fill(title);
    await bobPage.getByRole("button", { name: "新建任务" }).click();
    await expect(
      bobPage.getByRole("listitem").filter({ hasText: title }),
    ).toBeVisible();

    // 3) alice 的页面（storageState 登录态）搜索同名任务：一无所获
    const aliceContext = await browser.newContext({
      storageState: "playwright/.auth/alice.json",
    });
    const alicePage = await aliceContext.newPage();
    await alicePage.goto("/");
    await alicePage.getByLabel("搜索标题").fill(title);
    await alicePage.getByLabel("搜索标题").press("Enter");
    await expect(alicePage.getByText("没有符合条件的任务")).toBeVisible();

    await bobContext.close();
    await aliceContext.close();
  });
});
