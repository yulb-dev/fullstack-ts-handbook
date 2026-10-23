# Playwright 端到端测试从 0 到 1：用真实浏览器守护关键用户旅程

你的单元测试全绿、集成测试全绿，但用户登录后看到一片空白——因为前后端的 cookie 名字对不上。这类只存在于「真实浏览器 + 真实服务端 + 真实网络」组合里的 bug，就是端到端（E2E）测试的辖区。

这份教程对应[全栈技术栈学习路线图](../docs/roadmap/fullstack_tech_stack_learning_roadmap.pdf)的**阶段 13｜Playwright 端到端测试**，从一个空目录开始，围绕配套工程 **TaskBoard lite**（一个零依赖的多工作区任务看板）构建一套完整的 E2E 测试，最终得到：

- 覆盖**关键用户旅程**的自动化测试：登录 → 创建任务 → 修改状态 → 搜索/筛选 → 登出；
- **跨租户越权矩阵**：水平越权、存在性枚举、双角色协作，全部有断言守护；
- **故障注入**能力：500、断网、慢响应、会话过期，不改应用代码即可测试错误处理；
- **storageState 认证复用**：登录一次，64 个测试共享，且状态文件不泄漏；
- **并行安全**的测试数据策略：4 workers 反复运行，0 flaky；
- **CI 就绪**：GitHub Actions workflow、失败自动上传 trace/截图/视频。

## 先说明版本

本次编写时核对了 npm 与 Playwright 官方文档：

| 包                 | 使用版本                                 | 说明                                               |
| ------------------ | ---------------------------------------- | -------------------------------------------------- |
| `@playwright/test` | 1.64.1                                   | npm `latest`（`next` 上有 1.65 alpha，本书不使用） |
| Node.js            | 24（要求 ≥ 22）                          | 官方支持 22.x / 24.x / 26.x                        |
| 浏览器             | Chromium 156 / Firefox 157 / WebKit 27.2 | 由 `npx playwright install` 下载，与系统浏览器无关 |

配套工程的 64 个测试（21 个测试 × 3 引擎 + setup）已在 macOS + Node 24 实测全绿；文中所有标注「实测」的行为（如 route handler 内 unroute 的放行行为、WebKit 的 Esc/Tab 差异）均为实际运行观察所得。

## 适合谁，需要先会什么

- 需要会 TypeScript 基础语法、`async/await`、npm 的基本使用；
- 最好接触过本仓库任意一个前端教程（[Tailwind](../2.tailwind-tutorial/README.md)、[React Router](../3.react-router-tutorial/README.md)），理解「组件渲染是异步的」即可；
- **不需要**测试经验：第 1 章从「E2E 在测试金字塔里的位置」讲起；
- **不需要**数据库/Docker：TaskBoard lite 用内存数据，`npm install` 后一条命令可跑。

学过路线图阶段 12（Vitest）更好——本教程会反复引用「哪类问题该下沉到单元/集成层」；没学过也不影响，第 1 章会补齐必要的心智模型。

## 贯穿项目：TaskBoard lite

一个多工作区任务看板：三个测试账号（Alice/Bob 分属互不可见的工作区，Carol 是双区管理员），任务增删改查、搜索、筛选、分页、角色差异（内部备注仅管理员）、统一的 `{ error: { code, message } }` 错误模型。服务端是约 360 行的 `node:http` 单文件，前端是原生 ESM 三件套——**小到可以通读源码**，这对理解「测试为什么失败」至关重要。详见 [example/README.md](./example/README.md)。

## 完整章节

| 章节                                                                     | 本章要解决的实际问题                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [01 为什么需要端到端测试](./01-why-e2e-and-playwright.md)                | E2E 证明什么/不证明什么；测试金字塔；Playwright 四部件；browser/context/page/locator 对象模型          |
| [02 环境搭建与第一个测试](./02-setup-and-first-test.md)                  | 初始化脚手架；运行测试的常用姿势；HTML 报告；codegen 与 UI Mode；webServer 预览                        |
| [03 定位器——像用户一样找到元素](./03-locators.md)                        | role/label/testid/CSS 的优先级取舍；strictness；filter 与链式收窄；列表断言                            |
| [04 自动等待与断言](./04-auto-waiting-and-assertions.md)                 | actionability 检查；web-first 断言全景；sleep/任意 timeout 为何脆弱；四层超时；soft/poll/toPass/extend |
| [05 fixture 与测试隔离](./05-fixtures-and-isolation.md)                  | test.extend；worker/auto fixture；hooks 的边界；三层隔离；并行与测试锁；test.step                      |
| [06 playwright.config 逐项精讲](./06-configuration.md)                   | testDir/超时/重试/forbidOnly/reporter/use/projects/webServer；配置覆盖层级                             |
| [07 认证与 storageState](./07-authentication-and-storage-state.md)       | setup 项目；共享账号 vs 每 worker 账号；API 登录；多角色与游客视角；状态文件安全                       |
| [08 网络、mock 与 API 测试](./08-network-and-api-testing.md)             | request fixture 造数与 API 断言；route 拦截/伪造/掐断；故障注入；mock 的边界；HAR                      |
| [09 常见交互场景实战](./09-common-scenarios.md)                          | 表单校验、对话框、键盘、上传下载、iframe/多标签、分页与加载态、响应式、ARIA 快照                       |
| [10 调试、Trace Viewer 与 flaky 治理](./10-debugging-and-flaky-tests.md) | error-context/trace 五面板；UI Mode/Inspector；flaky 成因分类与治理流程；三个实测反直觉行为            |
| [11 在 CI 中运行 E2E](./11-ci-integration.md)                            | GitHub Actions workflow 逐行；CI 专属配置；分片与报告合并；部署后测试；提速清单                        |
| [12 综合实战与逐项验收](./12-capstone-and-acceptance.md)                 | 三个必做练习落地；路线图核心概念逐项对账；扩展练习；上线前检查清单                                     |

建议按顺序阅读。每章都包含：问题引入、概念讲解、来自配套工程的真实代码、常见错误、练习与参考答案、本章验收清单和官方文档链接。

## 如何运行配套工程

最终工程位于 [example](./example)。第 2 章介绍了从零搭建的过程，这里是快速入口：

```bash
cd 13.playwright-e2e-tutorial/example
npm install
npx playwright install        # 首次下载浏览器（约几百 MB）
npm test                      # 自动启动应用并运行全部 64 个测试
```

其他命令：

```bash
npm run app              # 只启动应用：http://127.0.0.1:4173
npm run test:chromium    # 只跑 Chromium（最快反馈）
npm run test:headed      # 有头模式，肉眼看执行
npm run test:ui          # UI Mode（watch + 时间旅行）
npm run report           # 打开 HTML 测试报告
```

测试账号（**只用于本地学习**）：

| 用户  | 角色   | 工作区      | 邮箱 / 密码                        |
| ----- | ------ | ----------- | ---------------------------------- |
| Alice | member | Alpha       | `alice@taskboard.dev` / `alice123` |
| Bob   | member | Beta        | `bob@taskboard.dev` / `bob123`     |
| Carol | admin  | Alpha、Beta | `carol@taskboard.dev` / `carol123` |

## 核心概念逐项验收地图

对照路线图阶段 13 的「核心概念清单（逐项验收）」：

| 验收项                                                           | 教学章节   | 动手成果                                              |
| ---------------------------------------------------------------- | ---------- | ----------------------------------------------------- |
| test/expect、page/context/browser、locator 与语义化定位取舍      | 01、03、04 | 全套件 0 个 CSS 选择器；tenancy 的角色定位链          |
| 自动等待与 web-first assertions；sleep/任意 timeout 为何脆弱     | 04         | 全套件 0 个 waitForTimeout；门闩式加载态测试          |
| Fixture、hooks、测试隔离、稳定测试数据与并行执行                 | 05         | seed fixture（hash 唯一后缀）；4 workers 多轮 0 flaky |
| webServer、baseURL、浏览器项目、重试、trace、截图/视频与 CI 报告 | 06、11     | playwright.config.ts 全项 + 本地/CI 差异              |
| storageState 安全使用；多角色测试身份与数据种子                  | 07         | setup 项目；游客重置；bob 现场登录；.auth 双防线      |
| API/setup 准备数据，E2E 通过 UI 验证可观察行为                   | 05、08     | API 造数 + UI 断言 + API 复核持久化                   |
| 网络失败、权限失败、加载状态、表单校验、分页与键盘交互           | 08、09     | resilient.spec.ts 十个测试逐一对应                    |
| 失败诊断：trace viewer、控制台、请求失败、服务器日志             | 10         | 10.5 完整排障案例（共享会话 401 互踩）                |
| 边界：重试用于诊断而非掩盖 flaky                                 | 10、11     | 本地 retries=0；CI on-first-retry 取证                |

第 12 章为每一项提供了验收方式与「脱离教程重做」的三道验收题。

## 官方依据与验证范围

内容依据 Playwright 1.64 官方文档（每章末尾附具体链接）：Installation、Writing tests、Locators、Assertions、Test isolation/Parallelism、Fixtures、TestConfig/TestOptions reference、Authentication、Network、API mocking、API testing、Trace Viewer、Debug、CI、Sharding、POM、Best Practices、Codegen。

配套工程已通过三引擎全量实测（64 passed，macOS + Node 24 + Playwright 1.64.1）；服务端行为另经 curl 冒烟验证（登录/越权/403 一致性/分页/校验/登出吊销）。

未做自动化验证的部分：GitHub Actions 上的真实 CI 运行（workflow 为官方模板 + 教程配置，未推送执行）；Docker 镜像方案；视觉回归快照的跨平台一致性；Windows/Linux 上的浏览器行为差异。教程涉及这些内容处均已注明依据来源。

准备好了，就从[第 1 章](./01-why-e2e-and-playwright.md)开始。
