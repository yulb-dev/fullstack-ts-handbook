# 第 4 章：自动等待与断言

> 本章目标：深入 Playwright 可靠性的两大支柱——动作前的 actionability 自动等待，与断言的自动重试；掌握 web-first 断言全景、soft 断言、`expect.poll/toPass`、超时体系，并彻底理解「为什么固定 sleep 是反模式」。
>
> 对应总目标：**自动等待与 web-first assertions；为什么固定 sleep、任意 timeout 会制造脆弱测试。**

---

## 4.1 一次 click 背后发生了什么

`await locator.click()` 远不止「派发一个点击事件」。Playwright 在执行真正的点击前，会对目标元素做一轮 **actionability checks（可操作性检查）**，任何一项不满足就等待并重试，直到超时：

| 检查                     | 含义                                                  |
| ------------------------ | ----------------------------------------------------- |
| Attached                 | 元素已挂载到 DOM                                      |
| Visible                  | 有非空包围盒、不是 `visibility:hidden`                |
| Stable                   | 连续两帧位置不变（等动画结束）                        |
| Receives Events          | 命中测试（hit-test）落在该元素上——没被遮罩/悬浮层挡住 |
| Enabled                  | 未被禁用                                              |
| Editable（仅输入类动作） | 非 readonly                                           |

全部通过后才会滚动到元素、计算点击坐标、派发事件。如果超时，报错信息会明确告诉你**卡在哪一项**：

```text
locator.click: Timeout 30000ms exceeded.
=========================== logs ===========================
waiting for getByRole('button', { name: '新建任务' })
  locator resolved to <button>新建任务</button>
  unexpected value "<button disabled>新建任务</button>"
    did you mean to wait for the element to be enabled?
============================================================
```

这段 call log 是排障的一手资料：上例说明按钮一直 disabled——测试没错，是应用没有按预期启用按钮（或前置数据没就绪）。第 10 章会讲如何在 Trace Viewer 里看它。

**推论**：在 Playwright 里，「元素还没出现就操作」这类竞争条件被机制性消灭了。你唯一要做的是——别绕过它（见 4.3）。

## 4.2 web-first 断言：把「等」写进断言里

动作有自动等待，断言有**自动重试**。`await expect(locator).toBeVisible()` 的语义不是「现在必须可见」，而是「**最终**会可见；在超时前我会反复检查」。检查失败不报错，重新解析 locator 再查，直到通过或超时。

这就是 web-first（也叫 auto-retrying）断言。常用清单：

| 断言                                                                        | 检查内容                    |
| --------------------------------------------------------------------------- | --------------------------- |
| `toBeVisible()` / `toBeHidden()`                                            | 可见 / 不可见               |
| `toBeEnabled()` / `toBeDisabled()`                                          | 可用 / 禁用                 |
| `toBeChecked()` / `toBeEditable()` / `toBeFocused()`                        | 选中 / 可编辑 / 聚焦        |
| `toHaveText()` / `toContainText()`                                          | 文本全等（或正则）/ 包含    |
| `toHaveValue()` / `toHaveValues()`                                          | 输入框的值 / 多选框的选中值 |
| `toHaveCount(n)`                                                            | 匹配元素恰好 n 个           |
| `toHaveAttribute()` / `toHaveClass()` / `toHaveCSS()` / `toHaveId()`        | 属性 / class / 样式 / id    |
| `toHaveRole()` / `toHaveAccessibleName()` / `toHaveAccessibleDescription()` | ARIA 语义                   |
| `toBeAttached()` / `toBeInViewport()` / `toBeEmpty()`                       | 挂载 / 视口内 / 空容器      |
| `toHaveScreenshot()` / `toMatchAriaSnapshot()`                              | 视觉回归 / ARIA 结构快照    |
| `expect(page).toHaveTitle()` / `toHaveURL()`                                | 页面标题 / URL              |
| `expect(response).toBeOK()`                                                 | API 响应是 2xx              |

所有 web-first 断言都是异步的，**必须 `await`**。漏写 await 的断言不会等待，还常常根本不执行（promise 悬空）——这也是官方推荐用 ESLint 规则 `@typescript-eslint/no-floating-promises` 扫测试代码的原因。

### 手动断言反模式

官方最佳实践里点名批评的写法：

```ts
// 👎 把「瞬时采样」交给立即断言：不等待、不重试，flaky 之源
expect(await page.getByText("welcome").isVisible()).toBe(true);

// 👎 更隐蔽的同款：先取值再断言
const text = await page.getByText("status").textContent();
expect(text).toBe("Submitted");

// 👍 web-first：把期望交给 Playwright，由它负责等到成立
await expect(page.getByText("welcome")).toBeVisible();
await expect(page.getByText("status")).toHaveText("Submitted");
```

区别的本质：前两种在**某个瞬间采样一次**就下结论；后一种描述的是**一个应当成立的状态**，由框架负责在时间窗口内验证。异步网页里，前者必然间歇性失败。

那 `isVisible()` 这类方法还有用吗？有，但只用于**条件分支**而不是断言——「弹窗可能出现也可能不出现，出现了就关掉」：

```ts
const dialog = page.getByText("Confirm security settings");
if (await dialog.isVisible()) {
  await page.getByRole("button", { name: "Dismiss" }).click();
}
```

### 通用（非重试）断言

对已经拿到的普通值（API 响应体、计算结果），用同步断言即可，它们不重试也不该重试：

```ts
const res = await request.get("/api/tasks/t-107");
expect(res.status()).toBe(403); // 值已在手，立即判断
const body = await res.json();
expect(body.error.code).toBe("forbidden");
```

配套的还有非对称匹配器（`expect.any()`、`expect.objectContaining()`、`expect.stringMatching()` 等），用法与 Jest 一致。TaskBoard 的越权测试（`tests/tenancy.spec.ts`）正是「UI 层用 web-first 断言、API 层用通用断言」的组合。

## 4.3 sleep 与任意 timeout：脆弱性的两个来源

现在可以完整回答路线图验收项「为什么固定 sleep、任意 timeout 会制造脆弱测试」。

### 固定 sleep 为什么脆弱

```ts
await page.getByRole("button", { name: "提交" }).click();
await page.waitForTimeout(2000); // ❌
await expect(page.getByText("成功")).toBeVisible();
```

`waitForTimeout(2000)` 是对「操作耗时」的**常量猜测**，而真实耗时是个分布：

- 本地开发机：200ms 完成 → 白等 1.8s（几百条测试累积起来就是分钟级浪费）；
- CI 低配容器 + 冷缓存：2.5s 完成 → **断言在数据到达前执行，失败**；
- 更糟的是它的失败是概率性的：同一份代码，今天绿明天红。

固定 sleep 同时输掉了「快」和「稳」，是纯粹的下行风险。web-first 断言在同样的场景下：200ms 完成就 200ms 继续，2.9s 完成就等到 2.9s——**它用条件判断取代了时间猜测**。

Playwright 没有禁掉 `waitForTimeout`（个别模拟「人类节奏」的场景可用），但它属于「你确定自己在做什么」才碰的 API。本教程的验收标准直接采纳路线图原文：**关键旅程无任意固定 sleep**。

### 任意放大 timeout 为什么也不行

flaky 测试出现后，常见反应是把超时从 5s 调到 60s「压一压」。这是把症状当病治：

1. 掩盖根因：真正的竞争条件、坏等待、共享数据问题还在，只是发作频率降低；
2. 拖垮反馈速度：真失败的测试要等满 60s 才报错，重试再乘 2；
3. 超时数值本身成了新的「猜测常量」，和 sleep 没有本质区别。

正确顺序（第 10 章详述）：先看 trace 找根因 → 修等待方式或数据隔离 → 超时保持默认。路线图原话：「先查竞争条件、共享测试数据、网络依赖和不稳定等待，再决定是否调整 retry」。

### 该用等待的地方：waitForURL / waitForResponse

「不要用 sleep」不等于「不能显式等待」。当你要等的是一个**明确的条件**时，Playwright 提供条件式等待 API——它们和 web-first 断言同构（等条件，不等时长）：

```ts
// 等 URL 变化（登录跳转）
await page.waitForURL("**/dashboard");

// 等某个网络响应（点击后触发的请求）
const responsePromise = page.waitForResponse("**/api/tasks?**"); // 先挂监听
await page.getByRole("button", { name: "重试" }).click(); // 再触发动作
const response = await responsePromise; // 最后收结果
expect(response.status()).toBe(200);
```

注意 `waitForResponse` 的**先挂 promise、再触发动作**的顺序——反过来写就是竞争条件（响应可能在监听开始前已到达）。

## 4.4 超时体系：四层超时各管什么

Playwright 的超时不是一个大常量，而是分层的。理解每层的职责，才知道该调哪个：

| 配置                | 默认                        | 管什么                                                 | 在哪配                                  |
| ------------------- | --------------------------- | ------------------------------------------------------ | --------------------------------------- |
| `timeout`           | 30s（Windows 上 CI 为 60s） | **单个测试**的总时长（含 fixture 建立/清理）           | `defineConfig({ timeout })`             |
| `expect.timeout`    | 5s                          | **单条 web-first 断言**的重试窗口                      | `defineConfig({ expect: { timeout } })` |
| 动作超时            | 无（受测试总超时约束）      | 单次动作的 actionability 等待；可传 `{ timeout }` 覆盖 | `locator.click({ timeout })`            |
| `navigationTimeout` | 无（受测试总超时约束）      | `page.goto` 等导航                                     | `use: { navigationTimeout }`            |
| `globalTimeout`     | 无                          | **整轮测试**的总时长上限（CI 建议设置，第 11 章）      | `defineConfig({ globalTimeout })`       |

默认配置下的关系：一条测试 30s 封顶；测试内每条断言最多重试 5s；一条断言失败即测试失败（soft 断言除外）。**对初学者：全部用默认值。**需要调整的时机几乎总是「某个操作确实合理地久」（如大文件上传），此时用参数级 `{ timeout }` 精准放宽，而不是全局放大。

单条断言也可以就地覆盖：

```ts
// 导出报表可能要 20s，就给它单独的窗口
await expect(page.getByText("报表已生成")).toBeVisible({ timeout: 20_000 });
```

以及自定义消息——失败时报告里会先显示这句话，对「一条测试多个断言」的可读性帮助很大：

```ts
await expect(page.getByText("Alice"), "登录后顶栏应显示用户名").toBeVisible();
```

## 4.5 soft 断言：一次跑完所有检查

默认断言失败会立即终止测试。当你想「一次执行、收集全部失败」（例如检查一个表单的所有字段回显），用 `expect.soft`：

```ts
await expect.soft(page.getByTestId("status")).toHaveText("Success");
await expect.soft(page.getByTestId("eta")).toHaveText("1 day");
// 前两条即使失败也继续执行；测试最终标记为 failed，报告里列出全部失败项
await page.getByRole("link", { name: "next page" }).click();
```

需要「soft 失败后别再往下跑」时，手动检查：

```ts
expect(test.info().errors).toHaveLength(0);
```

克制使用：soft 断言适合**同一状态的多侧面检查**；不适合串联步骤（第一步就错了，后面的 soft 检查只会制造噪音）。

## 4.6 expect.poll 与 expect.toPass：给任意条件加上重试

web-first 断言覆盖的是 DOM 状态。如果要重试的条件是「异步函数返回值」或「一段包含多个断言的逻辑」，用这两个：

```ts
// poll：反复执行一个函数，对返回值做断言
await expect
  .poll(
    async () => {
      const response = await page.request.get("https://api.example.com/status");
      return response.status();
    },
    {
      message: "make sure API eventually succeeds",
      timeout: 10_000,
      intervals: [1_000, 2_000, 10_000], // 自定义重试节奏，默认 [100, 250, 500, 1000]
    },
  )
  .toBe(200);

// toPass：反复执行一整块（可含多个同步断言）逻辑直到不再抛错
await expect(async () => {
  const response = await page.request.get("https://api.example.com");
  expect(response.status()).toBe(200);
}).toPass();
```

典型场景：轮询后台任务状态、等待 webhook 生效、等第三方副作用落库。它们本质上是「带重试的通用断言」，让 4.2 节的「手动采样」反模式有了正确的替代写法——注意 `toPass` 默认不设超时（timeout 0），CI 上建议显式传。

## 4.7 自定义匹配器：expect.extend

当同一类断言在几十个测试里重复出现，可以扩展 expect。官方示例（自定义 `toHaveAmount`）的骨架：

```ts
// fixtures.ts
import { expect as baseExpect, type Locator } from "@playwright/test";
export { test } from "@playwright/test";

export const expect = baseExpect.extend({
  async toHaveAmount(
    locator: Locator,
    expected: number,
    options?: { timeout?: number },
  ) {
    // 实现约定：返回 { pass, message, name, expected, actual }
    // 内部复用已有断言（这里用 toHaveAttribute）就自动获得重试能力
    let pass: boolean;
    try {
      const expectation = this.isNot
        ? baseExpect(locator).not
        : baseExpect(locator);
      await expectation.toHaveAttribute(
        "data-amount",
        String(expected),
        options,
      );
      pass = true;
    } catch (e: any) {
      pass = false;
    }
    if (this.isNot) pass = !pass;
    return {
      pass,
      message: () => `expected ${locator} to have amount ${expected}`,
      name: "toHaveAmount",
      expected,
    };
  },
});
```

```ts
// 测试里从 fixtures.ts 导入扩展后的 expect
import { test, expect } from "./fixtures";
await expect(page.locator(".cart")).toHaveAmount(4);
```

多个模块各自扩展过 expect / test 时，用 `mergeExpects` / `mergeTests` 合并。对大多数项目，**先把内置断言用熟再考虑自定义**——自定义匹配器是团队级 API，引入前想清楚维护成本。

两个官方提醒：

1. 别把 Playwright 的 `expect` 和独立 `expect` 库（jest 生态那个）混用——后者不接自动重试、不接报告步骤；
2. `expect.configure({ timeout, soft })` 可以预制一个改过默认值的 expect 实例复用（如 `slowExpect`）。

## 4.8 断言失败时，报告里有什么

一条 web-first 断言超时的完整报错包含四部分，学会读它等于半个排障专家：

```text
  1) [chromium] › tests/journey.spec.ts:12:5 › 创建任务 ✘ (6.2s)

   Error: expect.toBeVisible with timeout 5000ms
   Locator: getByRole('listitem').filter({ hasText: '发布说明-abc123' })
   Expected: visible
   Received: <element(s) not found>
   Call log:
     - expect.toBeVisible with timeout 5000ms
     - waiting for getByRole('listitem').filter({ hasText: '发布说明-abc123' })
     -   locator resolved to 0 elements
```

- **Locator**：等的是谁——检查定位器是否写错；
- **Expected / Received**：期望状态 vs 实际状态——`<element(s) not found>` 是「压根没匹配到」，`unexpected value "…"` 是「匹配到了但状态不对」，两者根因完全不同；
- **Call log**：重试过程的逐条记录；
- 失败现场附件：截图 / 视频 / trace（取决于第 6 章的配置）。

先读报错，再看 trace，最后才怀疑框架——这个顺序能解决 95% 的问题。

---

## 常见错误

1. **漏 `await`**：`expect(locator).toBeVisible();`（无 await）不重试、可能不执行、ESLint 不加规则就静默通过。
2. **`waitForTimeout` 当创可贴**：每贴一处，套件慢一点、脆一点。看到它就该问：我在等什么条件？那个条件对应的 web-first 断言/waitFor API 是什么？
3. **用 `isVisible()` 的返回值做断言**（4.2 节反模式）：采样一次就下结论。
4. **全局放大超时压 flaky**：症状消失，根因潜伏（4.3 节）。
5. **`waitForResponse` 写在触发点击之后**：监听晚于事件，死等到超时。永远「先挂 promise，再触发，后 await」。
6. **在断言里写副作用**：`await expect(locator).toHaveText(await fetchSomething())` 中 fetch 只求值一次；期望值应当先算好再传入。

## 练习

1. 把下面三行「脆弱写法」改写为健壮写法，并说明各自的问题：
   ```ts
   await page.waitForTimeout(1000);
   expect(await page.getByRole("alert").textContent()).toContain("失败");
   expect(await page.getByRole("listitem").count()).toBe(5);
   ```
2. TaskBoard 的「慢响应加载态」测试（`tests/resilient.spec.ts`）里，为什么断言 `getByRole('status')` 先 `toHaveText('加载中…')` 再 `toBeHidden()` 不需要任何等待代码？
3. 写一个 `expect.poll`，轮询 `/api/health` 直到返回 `{ ok: true }`（提示：poll 函数里用 `request.get`，返回布尔或状态码）。
4. 解释：`expect.timeout` 调到 30s、测试 `timeout` 保持 30s，会发生什么奇怪现象？
5. 给「登录后顶栏显示用户邮箱」这条断言加上自定义消息，并制造一次失败，观察报告输出的差异。

<details>
<summary>参考答案</summary>

1.

```ts
// a) 删除。后面的断言自带等待；若是在等某状态，直接写该状态的 web-first 断言
// b) 瞬时采样 → web-first：
await expect(page.getByRole("alert")).toContainText("失败");
// c) 瞬时采样 → web-first 集合断言：
await expect(page.getByRole("listitem")).toHaveCount(5);
```

2. 两条都是 web-first 断言：`toHaveText` 会重试到 500ms 延迟的请求返回前（loading 正在显示），`toBeHidden` 会重试到响应到达、loading 消失。整条测试的时间适应性完全由断言重试承担，无需等待代码。
3.

```ts
await expect
  .poll(
    async () => {
      const res = await request.get("/api/health");
      return res.ok() && (await res.json()).ok === true;
    },
    { message: "health check eventually ok" },
  )
  .toBe(true);
```

4. 单条断言的窗口（30s）等于整个测试的窗口（30s）：第一条断言若失败会耗尽全部测试时长，测试以「Test timeout of 30000ms exceeded」而非断言错误终止，后续代码全部没机会执行，报错信息也更难读。expect.timeout 应显著小于测试 timeout（默认 5s vs 30s 就是这个关系）。
5. `await expect(page.getByText('alice@taskboard.dev'), '登录后顶栏应显示用户邮箱').toBeVisible();` 失败时报告首行会显示该消息（✅/❌ 步骤均带），定位「哪个业务预期挂了」快于读 locator。

</details>

## 本章验收清单

- [ ] 能列出 click 前的 actionability 检查项，并解释报错 call log 中「卡在哪一项」的含义；
- [ ] 能区分 web-first 断言与通用断言的适用对象，说出至少 10 个常用 web-first 断言；
- [ ] 能从机制上解释固定 sleep 与任意 timeout 为何制造脆弱测试（4.3 节两问）；
- [ ] 会用 `waitForURL` / `waitForResponse`（含正确的挂载顺序）做条件式等待；
- [ ] 知道四层超时各自的职责与默认值，并坚持「默认值 + 参数级精准放宽」；
- [ ] 会用 soft 断言、`expect.poll`、`expect.toPass`、自定义消息，了解 `expect.extend`。

## 官方文档

- [Assertions](https://playwright.dev/docs/test-assertions) — 断言全景：auto-retrying、soft、poll、toPass、extend
- [Actions](https://playwright.dev/docs/input) 与 [Actionability](https://playwright.dev/docs/actionability) — 自动等待的检查项
- [Timeouts](https://playwright.dev/docs/test-timeouts) — 超时体系
- [Best Practices · Use web first assertions](https://playwright.dev/docs/best-practices) — 手动断言反模式

上一章：[定位器](./03-locators.md) ｜ 下一章：[fixture 与测试隔离](./05-fixtures-and-isolation.md)。
