# 第 2 章：环境搭建与第一个测试

> 本章目标：从空目录开始装好 Playwright，理解脚手架生成的每个文件；学会运行测试的常用姿势（过滤、有头、UI Mode、codegen）；对 TaskBoard lite 写出并跑通第一个真实测试。
>
> 对应总目标：**会搭建、会运行、会看报告——建立完整的开发回路。**

---

## 2.1 环境要求

| 项         | 要求                                                  |
| ---------- | ----------------------------------------------------- |
| Node.js    | 22.x / 24.x / 26.x（本教程在 Node 24 实测）           |
| 操作系统   | macOS 14+ / Windows 11+ / Ubuntu 22.04+ 等            |
| Playwright | `@playwright/test` 1.64.1（npm `latest`，编写时核对） |

Playwright 会下载它自己构建的浏览器二进制（Chromium、Firefox、WebKit），**不使用你系统里装的 Chrome/Safari**，因此测试结果与本机浏览器版本无关、团队之间可复现。浏览器缓存在：

- macOS/Linux：`~/Library/Caches/ms-playwright`、`~/.cache/ms-playwright`
- Windows：`%USERPROFILE%\AppData\Local\ms-playwright`

## 2.2 初始化：`npm init playwright@latest`

官方推荐的初始化方式是在项目根目录执行：

```bash
npm init playwright@latest
```

交互式向导会问四个问题（都选了默认值的结果如下）：

| 问题                                | 选择                                                                 |
| ----------------------------------- | -------------------------------------------------------------------- |
| TypeScript or JavaScript?           | **TypeScript**（对 JS 项目也建议选 TS，Playwright 零配置支持）       |
| Where to put your end-to-end tests? | **tests**（若已存在 `tests` 目录则建议 `e2e`）                       |
| Add a GitHub Actions workflow?      | **Yes**（自动生成 `.github/workflows/playwright.yml`，第 11 章细讲） |
| Install Playwright browsers?        | **Yes**（约几百 MB，也可以之后手动装）                               |

完成后得到的脚手架：

```text
my-project/
├── playwright.config.ts      # 全部配置的唯一入口
├── package.json              # devDependencies 里只有 @playwright/test
├── tests/
│   └── example.spec.ts       # 一个可运行的示例测试
└── .github/workflows/playwright.yml
```

两个细节：

1. 向导**可以重复执行**，不会覆盖你已写的测试，适合往老项目里补装；
2. 除了 CLI，官方还提供 VS Code 扩展（Playwright Test for VSCode），能可视化运行/调试/录制测试。本教程以 CLI 为主，扩展属于锦上添花。

配套的 [example](./example) 工程就是用这个流程初始化后改造的：删掉示例测试、把 `playwright.config.ts` 换成第 6 章逐行讲解的版本、加入被测应用。

## 2.3 先认识被测应用

在写测试之前，把 TaskBoard lite 跑起来：

```bash
cd 13.playwright-e2e-tutorial/example
npm install
npm run app        # TaskBoard lite listening on http://127.0.0.1:4173
```

浏览器打开 `http://127.0.0.1:4173`，用 `alice@taskboard.dev / alice123` 登录，把每个功能点一遍：创建任务、卡片上改状态、点标题开详情对话框、搜索、筛选、翻页、切换工作区（Alice 只有 Alpha）、退出登录。

**写 E2E 测试前手工走一遍应用不是浪费时间**——你会自然形成「哪些是关键旅程」的判断，这正是 1.7 节说的黄金判据的输入。

## 2.4 第一个测试

新建 `tests/smoke.spec.ts`（脚手架示例测的是 playwright.dev 官网，我们换成自己的应用）：

```ts
import { test, expect } from "@playwright/test";

test("未登录时显示登录表单", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/");

  await expect(page).toHaveTitle("TaskBoard");
  await expect(
    page.getByRole("heading", { name: "登录 TaskBoard" }),
  ).toBeVisible();
});

test("登录后能看到任务列表", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/");

  await page.getByLabel("邮箱").fill("alice@taskboard.dev");
  await page.getByLabel("密码").fill("alice123");
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page.getByRole("heading", { name: "任务列表" })).toBeVisible();
  await expect(page.getByText("alice@taskboard.dev")).toBeVisible();
});
```

逐行拆解第二个测试：

| 代码                                     | 发生了什么                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `test('...', async ({ page }) => {...})` | 声明一个测试。`{ page }` 是**fixture 解构**：运行器在调用函数前创建一个全新 BrowserContext + Page 注入进来（第 5 章详解） |
| `page.goto(...)`                         | 导航并等待页面 load 事件                                                                                                  |
| `page.getByLabel('邮箱')`                | 创建一个 locator：按关联 `<label>` 的文本找表单控件（第 3 章详解）                                                        |
| `.fill(...)`                             | 自动等待元素可编辑，清空后输入                                                                                            |
| `.click()`                               | 自动等待元素可见、稳定、可接收事件，然后点击                                                                              |
| `await expect(locator).toBeVisible()`    | web-first 断言：反复检查直到可见，或 5 秒超时报错（第 4 章详解）                                                          |

注意**整个测试没有一个 sleep、没有一处手动等待**，但它能可靠地跑过——这就是 1.5 节自动等待机制的第一次实战。

## 2.5 运行测试的常用姿势

```bash
npx playwright test                          # 全部测试（默认无头、并行、跑 config 里所有浏览器项目）
npx playwright test tests/smoke.spec.ts      # 只跑一个文件
npx playwright test smoke.spec.ts:21         # 只跑某一行所在的测试
npx playwright test -g "登录后"               # 按标题关键字过滤
npx playwright test --project=chromium       # 只跑一个浏览器项目
npx playwright test --headed                 # 有头模式：亲眼看着浏览器执行
npx playwright test --debug                  # 打开 Inspector 单步调试（第 10 章）
npx playwright test --ui                     # UI Mode：watch + 时间旅行（第 10 章）
```

默认输出（list reporter）长这样，每行一个测试，标注项目名与耗时：

```text
Running 6 tests using 3 workers

  ✓  1 [chromium] › tests/smoke.spec.ts:3:5 › 未登录时显示登录表单 (1.2s)
  ✓  2 [chromium] › tests/smoke.spec.ts:9:5 › 登录后能看到任务列表 (1.8s)
  ...

  6 passed (5.4s)
```

几个高频问题的答案：

- **测试文件怎么被发现？** 默认匹配 `testDir` 下的 `*.spec.ts` / `*.test.ts`（可用 `testMatch` 改）；
- **默认跑几个浏览器？** 脚手架配置是 Chromium、Firefox、WebKit 三个项目各跑一遍——同一份测试 × 3；
- **并行度多少？** 默认约为 CPU 逻辑核数的一半，文件之间并行、单文件内按声明顺序串行（第 5 章）。

## 2.6 HTML 报告

每次运行结束后，结果会写入 `playwright-report/`。有失败时自动打开，也可以手动看：

```bash
npx playwright show-report
```

报告按浏览器项目、通过/失败/跳过/flaky（重试后通过）过滤；点开单个测试能看到每一步动作、耗时、错误信息，以及失败时附带的截图/视频/trace（配置了才有，见第 6 章）。**从第一次运行起就养成「失败先看报告再看代码」的习惯。**

## 2.7 两个提效工具：codegen 与 UI Mode

### codegen：录制生成测试与定位器

```bash
npx playwright codegen http://127.0.0.1:4173
```

会打开一个浏览器窗口 + Playwright Inspector。你在页面里操作，Inspector 实时生成测试代码；生成的定位器优先使用 role/label/testid（和手写最佳实践一致）。停止录制后点 **Pick Locator**，悬停任意元素即可得到它的推荐 locator。

定位建议：**用 codegen 快速起草，但产物必须人工改写**——录制代码常见绝对 URL（应改为 baseURL 相对路径）、冗余断言、以及不适合复用的结构。它的更大价值是 Pick Locator：不确定某个元素怎么定位时，让官方工具告诉你答案。

### UI Mode：watch 模式 + 时间旅行

```bash
npx playwright test --ui
```

左侧是测试树，点击单个运行；右侧显示每一步动作前后的页面快照，可以拖动时间轴「时间旅行」，还能直接看到每个 locator 在页面上匹配到了什么。写测试时开着它，效率远高于反复 `npx playwright test`。细节在第 10 章展开。

## 2.8 让测试不依赖「手动先起服务」：webServer 预览

上面的测试有个隐患：必须**先** `npm run app` 把服务跑起来，否则全部失败。Playwright 的 `webServer` 配置可以代劳：

```ts
// playwright.config.ts（节选，完整讲解见第 6 章）
export default defineConfig({
  webServer: {
    command: "npm run app",
    url: "http://127.0.0.1:4173/api/health",
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
});
```

效果：`npx playwright test` 时自动启动服务、等 `url` 返回 2xx~4xx 就绪后再跑测试，跑完自动关掉；本地如果服务已在跑（`reuseExistingServer`），直接复用不重启。配置了 `baseURL` 之后，测试里的 `page.goto` 可以写相对路径：

```ts
await page.goto("/"); // 等价于 http://127.0.0.1:4173/
```

这也是 example 工程的最终形态——从第 3 章起，所有代码都假设这两项配置已就位。

## 2.9 目录约定与工程卫生

example 工程最终结构（也是推荐的项目结构）：

```text
example/
├── server/server.js        # 被测应用（真实项目里这里是你的 dev/build 产物）
├── public/                 # 前端静态文件
├── playwright.config.ts    # 配置唯一入口
├── tests/
│   ├── auth.setup.ts       # 登录一次保存 storageState（第 7 章）
│   ├── fixtures.ts         # 自定义 fixture（第 5 章）
│   └── *.spec.ts           # 测试按「用户旅程/领域」组织，不按页面组织
├── playwright/.auth/       # storageState 产物——必须 gitignore！
├── test-results/           # 失败产物（截图/视频/trace）——gitignore
└── playwright-report/      # HTML 报告——gitignore
```

三条工程卫生规则，现在就记住：

1. `playwright/.auth/` 里是**含会话 cookie 的状态文件**，拿到它等于拿到测试账号的登录态，绝不提交（官方文档对此有明确的 danger 警告）；
2. `test-results/`、`playwright-report/` 是运行产物，gitignore；
3. 测试文件按业务旅程命名（`journey.spec.ts`、`tenancy.spec.ts`），不要按页面命名（`login-page.spec.ts`）——E2E 测的是流程，不是页面。

---

## 常见错误

1. **`Error: browserType.launch: Executable doesn't exist`**：装了包没装浏览器。执行 `npx playwright install`（CI 上用 `--with-deps` 一并装系统依赖）。
2. **测试连不上应用**：忘了先启动服务，或忘了配 `webServer`。报错通常是 `page.goto: net::ERR_CONNECTION_REFUSED`。
3. **改了配置不生效**：确认改的是项目根目录的 `playwright.config.ts`，且没有同时存在 `.js`/`.ts` 两份配置。
4. **端口被占用**：`webServer` 在 CI 上（`reuseExistingServer: false` 语义）发现端口已被占用会直接报错而不是复用；本地则默认复用。行为差异是刻意的：CI 上「已经有服务在跑」通常意味着脏环境。
5. **把 `npx playwright test` 和 `npm test` 搞混**：后者取决于你 `package.json` 里 `test` 脚本怎么写。example 里 `"test": "playwright test"`，两者等价。

## 练习

1. 在 example 工程里新建 `tests/smoke.spec.ts`，写入 2.4 节的两个测试并跑通（注意：与仓库中现有 spec 并存没有冲突）。
2. 用 `--headed` 重跑，观察浏览器执行过程；再用 `-g "登录后"` 只跑第二个测试。
3. 打开 `npx playwright codegen http://127.0.0.1:4173`，录制一遍「登录 → 创建任务」，对照生成的代码找出至少两处你会改写的地方。
4. 把 `webServer.url` 改成一个不存在的路径（如 `/api/nope`），运行测试，观察并解释报错信息（提示：404 属于 2xx~4xx 就绪判定范围吗？动手验证）。

<details>
<summary>参考答案（要点）</summary>

1. 略。若全部通过，输出形如 `2 passed`；报告在 `playwright-report/`。
2. 有头模式能看到真实的点击与输入过程；`-g` 过滤后只运行标题含「登录后」的测试。
3. 典型改写点：绝对 URL → `page.goto('/')`（依赖 baseURL）；补上缺失的断言（录制只记动作不记期望）；把重复的登录动作抽成 fixture/storageState（第 7 章）；生成的 `getByRole('button', { name: '新建任务' })` 之类可保留。
4. `/api/nope` 由静态处理器返回 404。webServer 的就绪判定接受 2xx、3xx、400、401、402、403——**404 不在其中**，所以 Playwright 会一直等到 `timeout`（30 秒）后报「Process from config.webServer exited early / URL 未就绪」类错误。这说明 `url` 应指向一个明确会返回就绪状态码的端点（如健康检查接口）。

</details>

## 本章验收清单

- [ ] 能用 `npm init playwright@latest` 从零初始化，并说出脚手架每个文件的用途；
- [ ] 能独立写出「导航 → 定位 → 操作 → 断言」四段式的测试；
- [ ] 熟练使用文件/行号/`-g`/`--project`/`--headed` 过滤运行，会看 HTML 报告；
- [ ] 理解 `webServer` + `baseURL` 的作用与 `reuseExistingServer` 在本地/CI 的差异；
- [ ] 记住三条工程卫生规则，尤其是 `playwright/.auth/` 不入库。

## 官方文档

- [Installation](https://playwright.dev/docs/intro) — 安装、系统要求、升级
- [Running tests](https://playwright.dev/docs/running-tests) — 命令行过滤、并行、报告
- [Test generator (codegen)](https://playwright.dev/docs/codegen) — 录制与 Pick Locator
- [UI Mode](https://playwright.dev/docs/test-ui-mode) — watch 与时间旅行
- [VS Code extension](https://playwright.dev/docs/getting-started-vscode) — 编辑器集成

上一章：[为什么需要端到端测试](./01-why-e2e-and-playwright.md) ｜ 下一章：[定位器——像用户一样找到元素](./03-locators.md)。
