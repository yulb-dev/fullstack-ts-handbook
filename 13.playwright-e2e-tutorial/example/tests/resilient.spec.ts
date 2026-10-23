import { test, expect } from "./fixtures";

/**
 * 异常与边界场景（对应第 9、12 章）：
 * 网络失败、慢响应加载态、表单校验、分页、键盘交互、会话过期。
 * 手法：用 page.route() 在「不改应用代码」的前提下注入故障。
 */

test.describe("网络异常与错误状态", () => {
  test("列表接口 500 时展示错误提示，重试后可恢复", async ({ page }) => {
    // 第一次请求被拦截并伪装成服务器错误
    await page.route("**/api/tasks?**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "internal", message: "服务器开小差了" },
        }),
      }),
    );

    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText(
      "加载任务失败：服务器开小差了",
    );
    await expect(page.getByRole("listitem")).toHaveCount(0);

    // 解除拦截后重试：用户无需刷新页面即可恢复
    await page.unroute("**/api/tasks?**");
    await page.getByRole("button", { name: "重试" }).click();
    await expect(page.getByRole("alert")).toBeHidden();
    await expect(page.getByRole("listitem").first()).toBeVisible();
  });

  test("断网（请求被中断）时展示网络错误", async ({ page }) => {
    await page.route("**/api/tasks?**", (route) => route.abort());
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText("加载任务失败");
  });

  test("慢响应期间展示加载态，结束后自动消失", async ({ page }) => {
    // 「门闩」模式：第一个任务列表请求被扣住，直到测试主动放行。
    // 比固定延迟更确定：断言 loading 时请求必然还在飞。
    // 注意用「标记变量放行后续请求」而不是在 handler 里 page.unroute：
    // 实测在 handler 内部 unroute 会立刻放行当前这个被扣住的请求。
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    await page.route("**/api/tasks?**", async (route) => {
      if (!first) return route.continue(); // 后续请求（如重试）正常放行
      first = false;
      await gate;
      await route.continue();
    });

    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText("加载中…");

    release(); // 放行被扣住的请求
    await expect(page.getByRole("status")).toBeHidden();
    await expect(page.getByRole("listitem").first()).toBeVisible();
  });

  test("会话过期（401）时提示重新登录", async ({ page }) => {
    await page.route("**/api/tasks?**", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "unauthorized", message: "请先登录" },
        }),
      }),
    );
    await page.goto("/");
    await expect(page.getByRole("alert")).toHaveText("登录已过期，请重新登录");
  });

  test("更新状态失败时在列表区展示错误", async ({ page, seed }) => {
    const title = seed.uniqueTitle("待更新任务");
    await seed.createTask({ title });

    await page.goto("/");
    await page.getByLabel("搜索标题").fill(title);
    await page.getByLabel("搜索标题").press("Enter");

    const item = page.getByRole("listitem").filter({ hasText: title });
    await expect(item).toBeVisible();

    await page.route("**/api/tasks/**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "internal", message: "更新失败" },
        }),
      }),
    );
    await item.getByLabel(`修改「${title}」的状态`).selectOption("done");
    await expect(page.getByRole("alert")).toContainText("更新失败");
  });
});

test.describe("表单校验", () => {
  test("空标题提交时前端拦截并提示", async ({ page }) => {
    await page.goto("/");
    // 先等列表加载完成再采样基准数量：count() 是瞬时读取（非重试断言），
    // 在数据到达前采样会得到 0，后续比较必然失败——第 4 章反模式的真实现场
    await expect(page.getByRole("listitem").first()).toBeVisible();
    const before = await page.getByRole("listitem").count();

    await page.getByRole("button", { name: "新建任务" }).click();
    await expect(page.getByRole("alert")).toHaveText("标题不能为空");
    // 没有发出创建请求：列表数量不变
    await expect(page.getByRole("listitem")).toHaveCount(before);
  });

  test("服务端 400（标题超长）时把错误透传给用户", async ({ page }) => {
    await page.goto("/");
    // 输入框没有 maxlength，前端只拦空标题；超长校验由服务端 400 完成
    await page.getByLabel("任务标题").fill("x".repeat(81));
    await page.getByRole("button", { name: "新建任务" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "标题长度需在 1~80 个字符之间",
    );
  });
});

test.describe("分页", () => {
  test("下一页/上一页正确切换，按钮禁用状态随页码变化", async ({
    page,
    seed,
  }) => {
    // 造 5 条数据，保证 ws-alpha 至少两页（种子 7 条 + 5 条 > 2 页）
    for (let i = 1; i <= 5; i += 1) {
      await seed.createTask({ title: seed.uniqueTitle(`分页填充${i}`) });
    }

    await page.goto("/");
    const list = page.getByRole("listitem");
    const prev = page.getByRole("button", { name: "上一页" });
    const next = page.getByRole("button", { name: "下一页" });

    // 第一页：满页 5 条，「上一页」禁用
    await expect(list).toHaveCount(5);
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();

    // 翻到第二页
    await next.click();
    await expect(page.getByText(/第 2 \/ \d+ 页/)).toBeVisible();
    await expect(prev).toBeEnabled();

    // 翻回第一页
    await prev.click();
    await expect(page.getByText(/第 1 \/ \d+ 页/)).toBeVisible();
    await expect(prev).toBeDisabled();
  });
});

test.describe("键盘交互", () => {
  test("Tab 走查登录表单，Enter 直接提交", async ({ browser, browserName }) => {
    // 用干净的上下文避免 storageState 自动登录
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const guestPage = await context.newPage();
    await guestPage.goto("/");

    await guestPage.getByLabel("邮箱").focus();
    await expect(guestPage.getByLabel("邮箱")).toBeFocused();

    // 输入框之间的 Tab 顺序在所有引擎上一致
    await guestPage.keyboard.press("Tab");
    await expect(guestPage.getByLabel("密码")).toBeFocused();

    // 注意：不再断言「再按 Tab 焦点到登录按钮」——macOS WebKit 默认不把
    // Tab 焦点给按钮（跟随系统键盘导航设置），这是真实的跨浏览器差异；
    // 提交改用「表单内按 Enter」验证，它在所有引擎上行为一致。
    await guestPage.getByLabel("邮箱").fill("alice@taskboard.dev");
    await guestPage.getByLabel("密码").fill("alice123");
    await guestPage.getByLabel("密码").press("Enter"); // 表单内 Enter 即提交
    await expect(
      guestPage.getByRole("heading", { name: "任务列表" }),
    ).toBeVisible();

    await context.close();
    expect(["chromium", "firefox", "webkit"]).toContain(browserName); // 顺便演示 browserName fixture
  });

  test("搜索框回车才触发筛选，输入过程不触发", async ({
    page,
    seed,
    browserName,
  }) => {
    const title = seed.uniqueTitle("键盘搜索目标");
    await seed.createTask({ title });

    await page.goto("/");
    const search = page.getByLabel("搜索标题");
    await search.fill(title);
    // 只输入不回车：不应触发搜索，仍是全量列表
    await expect(
      page.getByRole("listitem").filter({ hasText: title }),
    ).toBeHidden();
    await expect(page.getByRole("listitem").first()).toBeVisible();

    await search.press("Enter"); // 回车才触发
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("listitem")).toContainText(title);

    // 真实的跨浏览器行为差异：Chromium 与 Firefox 中按 Escape 会清空
    // type="search" 输入框，WebKit 不会。对这类平台既定行为，
    // 按 browserName 分支断言，而不是只在一个引擎上能通过。
    await search.press("Escape");
    if (browserName === "webkit") {
      await expect(search).toHaveValue(title); // WebKit：值保留
    } else {
      await expect(search).toHaveValue(""); // Chromium / Firefox：清空
    }
  });
});
