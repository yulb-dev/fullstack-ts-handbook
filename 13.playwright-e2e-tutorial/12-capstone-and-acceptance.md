# 第 12 章：综合实战与逐项验收

> 本章目标：把前 11 章收拢成一次完整验收：三个必做练习在 example 工程中的落地位置与实现思路；路线图阶段 13 的「核心概念清单」逐项对账；扩展练习；上线前检查清单。
>
> 通过标准（路线图原文）：**关键旅程无任意固定 sleep，主要定位使用可访问角色或明确测试 id；测试数据相互隔离，可重复执行，不依赖生产服务或真实用户数据；发生失败时能从 trace 还原页面动作、请求/响应与断言失败原因。**

---

## 12.1 必做练习一：关键旅程自动化

> 路线图原文：自动跑通登录 → 创建 workspace/project/task → 修改状态 → 搜索/筛选 → 登出。

**落地位置**：`tests/journey.spec.ts`（TaskBoard lite 里 workspace 是种子数据，故旅程为：登录（storageState）→ 创建任务 → 修改状态 → 搜索/筛选 → 登出）。

**实现思路回顾**（每步依赖的章节）：

| 步骤       | 关键手法                                                                       | 章节  |
| ---------- | ------------------------------------------------------------------------------ | ----- |
| 登录       | setup 项目产出 storageState，业务测试零登录代码                                | 7     |
| 创建任务   | `getByLabel('任务标题').fill()` + 角色定位按钮                                 | 3     |
| 定位新任务 | 创建后立即搜索（列表有分页，不能假设它在第 1 页）→ `filter({ hasText })`       | 3、9  |
| 修改状态   | 卡片内 `getByLabel('修改「…」的状态').selectOption('done')` + `exact` 徽标断言 | 3、4  |
| 搜索/筛选  | 回车触发 + `toHaveCount(1)` 集合断言                                           | 3、9  |
| 登出       | **独立 context + 专属会话**（共享 token 登出会踢掉所有并行测试）               | 5、10 |

全程 0 个 `waitForTimeout`。验收方式：

```bash
grep -rn "waitForTimeout" tests/    # 应无输出（练习里刻意演示的除外）
npx playwright test tests/journey.spec.ts
```

**一个值得复盘的决策**：旅程测试拆成了「创建→改状态→搜索→筛选」与「登出」两条。不是因为登出不重要，而是登出有全局副作用（吊销会话），必须隔离到专属 context（第 10 章案例）。**旅程的完整性靠 describe 语义保持，而不是硬塞进一个 test。**

## 12.2 必做练习二：跨 workspace 越权场景

> 路线图原文：增加跨 workspace 越权场景，验证用户看不到其他租户的数据。

**落地位置**：`tests/tenancy.spec.ts`，四个测试构成完整的越权矩阵：

| 测试                              | 攻击面         | 断言                                               |
| --------------------------------- | -------------- | -------------------------------------------------- |
| 工作区切换器只有自己所属的        | UI 信息泄露    | `option` 集合 `toHaveText(['Alpha'])`              |
| 带 cookie 直接 GET 他人工作区列表 | API 水平越权   | 403 + `error.code === 'forbidden'`                 |
| 按 id GET 他人任务 / 不存在的任务 | 存在性枚举     | 两者都 403，响应不可区分                           |
| bob 建任务，alice UI 搜不到       | 端到端数据隔离 | 双 context 协作（bob UI 创建 → alice UI 搜索为空） |

**实现思路里的两个安全测试要点**：

1. **403 而非 404 的一致性**：服务端对「不存在」和「无权」返回同样的 403（`server.js` 中 `workspaceId = owner ?? '__unknown__'` 一行），测试显式断言了这个一致性——它是防资源枚举的设计决策，值得一条测试守护；
2. **双角色协作测试的结构**：bob 用干净 context 现场登录（他是数据的「生产方」），alice 用 storageState（她是「消费方」）——生产方走完整 UI 路径让数据可信，消费方走快路径让测试聚焦。

**扩展一步（练习）**：Carol 是双工作区管理员，为「内部备注仅管理员可改」补一组角色差异测试（第 7 章练习 3 的完整版）：alice 的对话框里 `getByLabel('内部备注（仅管理员）')` 应 `toBeHidden()`，carol 应可见可改；再用 API 断言 alice PATCH notes 得 403。

## 12.3 必做练习三：CI 执行与产物安全

> 路线图原文：在 CI 中执行 E2E，失败时上传 trace 和必要截图；不要上传包含真实密钥/个人数据的状态文件。

**落地位置**：`.github/workflows/playwright.yml` + `playwright.config.ts` + `.gitignore` 三件套：

1. **CI 执行**：官方 workflow（第 11 章逐行讲过）；`CI=1` 时配置自动切换为 retries=1、workers=2、trace=on-first-retry、forbidOnly；
2. **失败产物**：`screenshot: 'only-on-failure'` + `video: 'retain-on-failure'` + trace 首次重试录制，全部内嵌进 HTML 报告，`upload-artifact` 只传 `playwright-report/`；
3. **状态文件安全**：`playwright/.auth/` 同时被 `.gitignore`（不进仓库）与 artifact 路径白名单（不进 CI 产物）排除。两道防线缺一不可——gitignore 防的是提交，artifact 防的是 CI 侧泄露。

**自查命令**（在 example 目录）：

```bash
git check-ignore playwright/.auth/alice.json   # 应输出该路径（被忽略）
grep -n "playwright/.auth" .github/workflows/playwright.yml   # 应只出现在警示注释里
```

## 12.4 核心概念清单逐项验收

对照路线图阶段 13 的清单，每项给出「教学章节 + example 中的实证」：

| ☐ 验收项                                                              | 教学章节 | example 实证                                                                |
| --------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| test/expect、page/context/browser、locator 与语义化定位的取舍         | 1、3、4  | 全部 spec 只用 role/label/text 定位，0 个 CSS 选择器、0 个 testid           |
| 自动等待与 web-first assertions；固定 sleep/任意 timeout 为何脆弱     | 4        | `grep waitForTimeout tests/` 为空；断言全部 `await expect(locator)` 形态    |
| Fixture、beforeEach/afterEach、测试隔离、稳定测试数据与并行执行       | 5        | `fixtures.ts` 的 seed（hash 唯一后缀）；4 workers × 反复运行 0 flaky        |
| 配置 webServer、baseURL、浏览器项目、重试、trace、截图/视频与 CI 报告 | 6、11    | `playwright.config.ts` 全部就位；本地/CI 差异化                             |
| storageState 的安全使用；不同角色的测试身份与数据种子                 | 7        | setup 项目 + alice.json；游客重置（guest.spec.ts）；bob 现场登录（tenancy） |
| API/setup 准备数据，但 E2E 仍通过 UI 验证用户可观察行为               | 5、8     | seed.createTask 走 API；断言全部落在 UI（journey 另用 API 复核持久化）      |
| 网络失败、权限失败、加载状态、表单校验、分页与键盘交互                | 8、9     | resilient.spec.ts 六个 describe 逐一对应；权限失败在 tenancy/guest          |
| 失败诊断：trace viewer、控制台错误、请求失败、服务器日志和 requestId  | 10       | trace 配置 + 10.5 完整排障案例；error-context.md 实战                       |
| （边界）重试用于诊断而非掩盖 flaky                                    | 10、11   | 本地 retries=0；CI retries=1 + on-first-retry 取证                          |

**验收方式建议**（对照仓库总规则「能脱离教程重做才算通过」）：合上教程，在 example 里完成以下三件事——

1. 新增一条旅程：以 Carol 身份登录 → 打开任意任务详情 → 修改内部备注 → API 复核 notes 已更新；
2. 新增一条故障注入：拦截 `PATCH **/api/tasks/**` 返回 403，在卡片上改状态，断言列表区出现「更新失败」错误；
3. 让整套测试在 `--workers=4` 下连跑三轮全绿，且 HTML 报告 flaky 数为 0。

三件事都能独立完成，阶段 13 通过。

## 12.5 example 套件地图（21 个测试 × 3 引擎 + 1 setup = 64）

```text
tests/
├── auth.setup.ts        (1)  alice 登录 → playwright/.auth/alice.json
├── guest.spec.ts        (3)  游客：只见登录表单 / 错误密码提示 / API 401
├── journey.spec.ts      (4)  创建→改状态→搜索→筛选 / 登出+服务端吊销 / 对话框改任务 / 删除
├── tenancy.spec.ts      (4)  切换器隔离 / 列表 403 / id 403 不泄露存在性 / bob建-alice搜不到
└── resilient.spec.ts   (10)  500+重试恢复 / 断网 / 加载态门闩 / 401过期 / 更新失败
                              空标题拦截 / 服务端400透传 / 分页往返 / Tab+Enter / 回车搜索+Esc差异
```

运行数据（macOS，4 workers，编写时实测）：全量三引擎 64 个测试约 30~50 秒；单 chromium 项目 22 个测试约 21 秒。

## 12.6 扩展练习（按难度递增）

1. **POM 重构**：把 journey/tenancy 里重复的「搜索并定位任务卡片」抽成 `TaskBoardPage` 类 + fixture（官方 POM 文档的模式），对比重构前后测试体的可读性。
2. **视觉回归**：给登录卡片加 `toHaveScreenshot()`，分别在本地与官方 Docker 镜像里跑，对比快照差异（理解为什么视觉测试要锁渲染环境）。
3. **ARIA 快照**：用 `toMatchAriaSnapshot` 重写「任务卡片结构」断言（第 9 章），体验 `--update-snapshots` 工作流。
4. **时钟测试**：给 TaskBoard 增加「任务创建时间显示为相对时间（3 分钟前）」的需求（改 app.js），然后用 `page.clock.setFixedTime` + `page.clock.fastForward` 测试跨天边界。
5. **组件级下探**：把 TaskBoard 前端改写成 React 组件（任意脚手架），用 `@playwright/experimental-ct-react` 对「任务卡片」做组件测试，体会 E2E 与组件测试的边界（并理解为什么仓库的 Vitest 阶段用 Testing Library 做同样的事）。
6. **接入毕业项目**：把本套件的四个 spec 类型映射到 FlowOps（工单 = 任务、组织 = 工作区），为其「登录 → 建工单 → 流转 → 评论 → 关闭」旅程写出测试计划（不必实现），并标注每条测试对应的必测场景（FlowOps 手册 8.2 节）。

## 12.7 上线前检查清单

把本教程的全部红线压缩成一页，接入真实项目时逐项打勾：

**测试设计**

- [ ] E2E 只覆盖关键旅程与跨层边界；单元/集成层没有明显空洞（金字塔不倒挂）；
- [ ] 每条测试自足：不依赖执行顺序、不依赖别的测试留下的数据；
- [ ] 关键旅程 0 个固定 sleep；断言全部 web-first；
- [ ] 定位以 role/label 为主；testid 有明确约定；无长链 CSS/XPath。

**数据与隔离**

- [ ] 测试数据唯一命名（run id + test id），可并行、可重复执行；
- [ ] 不连生产服务、不用真实用户数据；种子数据可复现；
- [ ] 登出/改密码等全局副作用操作使用专属会话。

**认证与安全**

- [ ] storageState 文件在 `.gitignore` 与 CI artifact 白名单之外；
- [ ] 测试账号仅存在于测试环境；凭证走 CI secrets，不硬编码（example 为教学例外）；
- [ ] 越权矩阵覆盖：列表级、资源级、存在性不可区分。

**CI 与诊断**

- [ ] CI：`npm ci` + `playwright install --with-deps`（或官方镜像）+ 失败也上传报告；
- [ ] globalTimeout 已设且小于平台 job 时限；workers 收紧；forbidOnly 开启；
- [ ] trace=on-first-retry；失败处理流程（11.7）团队周知；
- [ ] flaky 数纳入周检，> 0 即建 bug 单归因。

---

## 下一步去哪

- **测试分层补全**：本仓库 [Fastify 教程第 14 章](../7.fastify-api-tutorial/14-testing-with-inject.md)（API 集成测试）与路线图阶段 12（Vitest）——E2E 之下两层的地基；
- **契约测试**：[API 契约教程](../11.api-contract-tutorial/README.md)——让「前后端类型漂移」在 E2E 之前就被拦截；
- **毕业项目**：[FlowOps 开发手册](../docs/flowops/FlowOps_开发手册.md) 第 8 章测试策略与 CI 流水线——把本教程的一切放进真实项目；
- **官方进阶**：[Playwright 文档](https://playwright.dev/docs/intro)的 Components（组件测试）、Mock API（HAR/WebSocket）、Accessibility snapshots 专题。

## 官方文档

- [Best Practices](https://playwright.dev/docs/best-practices) — 全教程红线的官方出处
- [Authentication](https://playwright.dev/docs/auth) / [Network](https://playwright.dev/docs/network) / [CI](https://playwright.dev/docs/ci) — 三个必做练习的对应章节
- [Release notes](https://playwright.dev/docs/release-notes) — 保持版本更新的入口

上一章：[在 CI 中运行 E2E](./11-ci-integration.md) ｜ 返回：[README](./README.md)。
