import { test, expect } from "./fixtures";

/**
 * 关键用户旅程（对应第 12 章综合实战 · 练习 1）：
 * 已登录（storageState）→ 创建任务 → 修改状态 → 搜索 → 筛选 → 登出。
 * 全程使用语义化定位与 web-first 断言，无任何固定 sleep。
 */

test.describe("关键旅程：任务的完整生命周期", () => {
  test("创建 → 改状态 → 搜索 → 筛选", async ({ page, seed }) => {
    const title = seed.uniqueTitle("发布说明");

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "任务列表" })).toBeVisible();

    // 1) 通过 UI 创建任务；创建后用搜索定位（列表有分页，
    //    直接断言「新任务在第 1 页可见」会依赖数据量，不稳定）
    await page.getByLabel("任务标题").fill(title);
    await page.getByRole("button", { name: "新建任务" }).click();
    await page.getByLabel("搜索标题").fill(title);
    await page.getByLabel("搜索标题").press("Enter");
    const item = page.getByRole("listitem").filter({ hasText: title });
    await expect(item).toBeVisible();
    // exact: true 必需——卡片内状态下拉框的选项文本是「设为待办」，
    // 模糊匹配会同时命中徽标和 option（strict violation）
    await expect(item.getByText("待办", { exact: true })).toBeVisible();

    // 2) 在卡片上直接把状态改为「已完成」
    await item.getByLabel(`修改「${title}」的状态`).selectOption("done");
    await expect(item.getByText("已完成", { exact: true })).toBeVisible();

    // 3) 搜索：命中唯一结果
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("listitem")).toContainText(title);

    // 4) 筛选「已完成」仍然能看到它；筛选「待办」则看不到。
    // 工具栏筛选器的 label 是「按状态筛选」——命名必须与对话框里的「状态」、
    // 卡片上的「修改「…」的状态」区分开，否则 exact 也救不了（它们都在 DOM 里，
    // 包括已关闭的 <dialog> 内部）
    await page.getByLabel("按状态筛选").selectOption("done");
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await page.getByLabel("按状态筛选").selectOption("todo");
    await expect(page.getByText("没有符合条件的任务")).toBeVisible();
  });

  test("登出后回到登录页，且旧会话在服务端失效", async ({ browser }) => {
    // 登出会让服务端吊销会话。若用共享的 page fixture（alice.json 的 token）登出，
    // 会把所有并行测试的登录态一并吊销（同一 token）——典型的服务端共享状态互踩。
    // 正确做法：干净 context 里重新登录，拿到一个专属的新会话，再吊销它。
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    await page.goto("/");
    await page.getByLabel("邮箱").fill("alice@taskboard.dev");
    await page.getByLabel("密码").fill("alice123");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByRole("heading", { name: "任务列表" })).toBeVisible();

    // 登出前先快照 cookie：稍后用它验证「服务端真的吊销了会话」，
    // 而不仅仅是浏览器本地清了 cookie
    const cookiesBefore = await context.cookies();

    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(
      page.getByRole("heading", { name: "登录 TaskBoard" }),
    ).toBeVisible();

    // 把旧 cookie 塞回去直接调 API：必须 401，证明吊销发生在服务端
    await context.addCookies(cookiesBefore);
    const me = await context.request.get("/api/me");
    expect(me.status()).toBe(401);

    await context.close();
  });

  test("任务详情对话框可以修改标题与状态", async ({ page, seed }) => {
    const title = seed.uniqueTitle("重构登录模块");
    const task = await seed.createTask({ title });

    await page.goto("/");
    await page.getByLabel("搜索标题").fill(title);
    await page.getByLabel("搜索标题").press("Enter");

    const item = page.getByRole("listitem").filter({ hasText: title });
    // exact: true 必需——删除按钮的 aria-label（删除「标题」）也包含标题子串，
    // 模糊匹配会同时命中标题按钮和删除按钮（strict violation）
    await item.getByRole("button", { name: title, exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("标题").fill(`${title}（已改名）`);
    await dialog.getByLabel("状态").selectOption("doing");
    await dialog.getByRole("button", { name: "保存" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(`${title}（已改名）`)).toBeVisible();
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: title })
        .getByText("进行中", { exact: true }),
    ).toBeVisible();

    // UI 之外再用 API 复核一次持久化结果（第 8 章：UI 断言用户可见行为，API 断言数据）
    const check = await page.request.get(`/api/tasks/${task.id}`);
    expect(check.ok()).toBeTruthy();
    const body = await check.json();
    expect(body.task.title).toBe(`${title}（已改名）`);
    expect(body.task.status).toBe("doing");
  });

  test("删除任务后列表不再显示", async ({ page, seed }) => {
    const title = seed.uniqueTitle("临时任务");
    await seed.createTask({ title });

    await page.goto("/");
    await page.getByLabel("搜索标题").fill(title);
    await page.getByLabel("搜索标题").press("Enter");

    const item = page.getByRole("listitem").filter({ hasText: title });
    await expect(item).toBeVisible();
    await item.getByRole("button", { name: `删除「${title}」` }).click();
    await expect(item).toBeHidden();
    await expect(page.getByText("没有符合条件的任务")).toBeVisible();
  });
});
