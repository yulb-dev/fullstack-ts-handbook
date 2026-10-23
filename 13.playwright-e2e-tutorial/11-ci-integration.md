# 第 11 章：在 CI 中运行 E2E

> 本章目标：把 Playwright 套件接入 GitHub Actions：官方 workflow 逐行讲解、浏览器安装与缓存策略、CI 专属配置（workers/globalTimeout/retries/trace）、失败产物上传的安全边界、分片加速与部署后测试。
>
> 对应总目标：**在 CI 中执行 E2E，失败时上传 trace 和必要截图；不要上传包含真实密钥/个人数据的状态文件。配置 … 与 CI 报告。**

---

## 11.1 CI 上跑 E2E 的三步骨架

任何 CI 平台（GitHub Actions / GitLab / Jenkins / Azure Pipelines）都是同一骨架：

```bash
# ① 让 CI 机器能跑浏览器：装依赖（Linux 需要系统库）
npm ci
npx playwright install --with-deps

# ② 跑测试（webServer 会自动拉起被测应用）
npx playwright test

# ③ 上传报告产物（失败时诊断用）
#    → 各平台的 artifact 机制
```

`--with-deps` 会用系统包管理器安装浏览器运行所需的 Linux 共享库（libnss3、libatk 等）——这是 Linux CI 与本地 macOS/Windows 的最大差异点。或者直接用官方 Docker 镜像 `mcr.microsoft.com/playwright:v1.64.0-noble`（浏览器与系统库预装好，版本与 Playwright 严格对应）。

## 11.2 GitHub Actions workflow 逐行讲解

`npm init playwright` 时选「Add GitHub Actions workflow」得到的官方模板（example 的 `.github/workflows/playwright.yml` 与之等价）：

```yml
name: Playwright Tests
on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  test:
    runs-on: ubuntu-latest # Linux 最便宜；官方建议 CI 用 Linux
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: lts/*
      - name: Install dependencies
        run: npm ci # 锁文件安装，可复现
      - name: Install Playwright Browsers
        run: npx playwright install --with-deps
      - name: Run Playwright tests
        run: npx playwright test
      - uses: actions/upload-artifact@v5
        if: ${{ !cancelled() }} # 失败/成功都上传（取消才跳过）
        with:
          name: playwright-report
          path: playwright-report/ # HTML 报告，含失败 trace/截图/视频
          retention-days: 30
```

逐点解释容易忽略的细节：

- **`if: ${{ !cancelled() }}`**：测试失败时 job 状态是 failure，但步骤默认还会继续吗？不会——`run: npx playwright test` 失败会中断后续步骤，**除非**给上传步骤加 `if: ${{ !cancelled() }}`（或 `always()`），这正是模板的写法：失败也上传报告；
- **上传的是 `playwright-report/`**：HTML 报告里内嵌了失败测试的 trace/截图/视频（下载 artifact 后 `npx playwright show-report` 本地打开）；
- **绝不上传 `playwright/.auth/`**：storageState 含会话 cookie。模板没有上传它，你也不要在自定义 artifact 里包含它——这是路线图验收清单里的显式红线；
- **只装需要的浏览器**：如果 CI 只跑 Chromium，`npx playwright install chromium --with-deps` 能省一半以上下载时间（官方优化建议）。

### 容器方案（截图一致性 + 免装依赖）

```yml
jobs:
  playwright:
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/playwright:v1.64.0-noble # 镜像版本必须与 package.json 的 Playwright 版本一致
      options: --user 1001
```

容器里浏览器与系统库已预装，跳过 `playwright install`。额外收益：视觉回归测试（`toHaveScreenshot`）的渲染环境跨运行完全一致。**注意镜像 tag 与依赖版本锁定同步升级**，版本错配是容器方案最常见的翻车点。

## 11.3 CI 专属配置：与本地刻意不同

example 的 `playwright.config.ts` 里所有 `process.env.CI ? A : B` 的分支，理由汇总：

```ts
export default defineConfig({
  forbidOnly: Boolean(process.env.CI), // CI 上 .only 直接报错，防「绿色谎言」（第 6 章）
  retries: process.env.CI ? 1 : 0, // CI 吸收环境噪音并借 on-first-retry 录 trace；本地 0 逼你面对失败
  workers: process.env.CI ? 2 : undefined, // CI 机器资源少且共享，收紧并发保稳定（官方甚至建议 1）
  globalTimeout: 60 * 60 * 1000, // CI 必设：整轮 1 小时封顶
  reporter: process.env.CI
    ? [["html"], ["github"]]
    : [["html", { open: "never" }]],
  use: {
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
  },
  webServer: {
    reuseExistingServer: !process.env.CI, // CI 必须全新启动，防脏环境（第 6 章）
  },
});
```

两个展开：

**workers**：官方对 CI 的建议是 `workers: 1`（稳定与可复现优先）；example 用 2 是在套件很小（21 个测试）前提下的折中。经验法则：套件 < 5 分钟 → 1~2 个 worker 足够；更大 → 别加 worker，用分片（11.4）。GitHub Actions 标准 runner 只有 2~4 核，workers 超过核数只会互相拖慢并制造 flaky。

**globalTimeout**：默认整轮无上限。一个挂死的测试会耗尽 CI 平台的 job 时限，被平台强杀 ⇒ **没有测试报告**（HTML 都来不及生成）。设置 globalTimeout 让 Playwright 自己体面收尾、产出报告。若同时设了平台级 `timeout-minutes`，务必让它显著大于 globalTimeout，保证「Playwright 先停」。

## 11.4 分片（sharding）：套件变大后的横向扩展

worker 是单机并行，shard 是**多机并行**：把测试文件均分成 N 份，每份一个 CI job：

```bash
npx playwright test --shard=1/3   # job 1
npx playwright test --shard=2/3   # job 2
npx playwright test --shard=3/3   # job 3
```

GitHub Actions 矩阵写法 + 报告合并（blob reporter 是官方方案）：

```yml
jobs:
  playwright:
    strategy:
      fail-fast: false # 一片失败不取消其他片
      matrix:
        shard: [1/4, 2/4, 3/4, 4/4]
    steps:
      # ... checkout / install 同前 ...
      - run: npx playwright test --shard=${{ matrix.shard }}
        env:
          PLAYWRIGHT_BLOB_NAME: report-${{ strategy.job-index }}.zip
      - uses: actions/upload-artifact@v5
        if: ${{ !cancelled() }}
        with:
          name: blob-${{ matrix.shard }}
          path: blob-report/

  merge-reports:
    if: ${{ !cancelled() }}
    needs: [playwright]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: npm ci
      - uses: actions/download-artifact@v5
        with:
          path: all-blob-reports
          pattern: blob-*
          merge-multiple: true
      - run: npx playwright merge-reports --reporter html ./all-blob-reports
      - uses: actions/upload-artifact@v5
        with:
          name: html-report
          path: playwright-report/
```

（分片 job 的 reporter 需配 `[['blob']]`；完整细节见官方 Sharding 文档。）分片的成本是 N 份环境安装，收益近似线性加速——**套件超过 15~20 分钟再考虑**，小套件分片纯属浪费。

## 11.5 部署后测试：deployment_status 模式

E2E 不只对着 localhost 跑。Vercel 等平台部署成功后会发 `deployment_status` 事件，官方模板让 E2E 直接打真实部署环境（smoke test）：

```yml
on:
  deployment_status:

jobs:
  test:
    if: github.event.deployment_status.state == 'success'
    steps:
      # ... install 同前 ...
      - name: Run Playwright tests
        run: npx playwright test
        env:
          PLAYWRIGHT_TEST_BASE_URL: ${{ github.event.deployment_status.target_url }}
```

`PLAYWRIGHT_TEST_BASE_URL` 环境变量会覆盖配置里的 `baseURL`——同一套测试，本地打 localhost、部署后打 preview URL，零改动。对生产环境跑 E2E 要额外小心：只用只读旅程或专用测试账号，别在生产数据上跑写操作（参考第 8 章 mock 边界：这种场景宁可少测，不可写脏）。

## 11.6 提速清单：让 CI 上的 E2E 不那么贵

按性价比排序：

1. **只跑必要的项目**：PR 上 `--project=chromium`，main 分支跑全三引擎（用两个 workflow 或路径条件区分）；
2. **只装必要浏览器**：`npx playwright install chromium --with-deps`；
3. **`--only-changed=origin/$GITHUB_BASE_REF`**（官方 Fail-Fast 模式）：PR 上先跑受变更影响的测试文件（基于依赖图的启发式），再跑全量兜底；需要 `fetch-depth: 0` 的完整 checkout；
4. **收紧 workers**（11.3）：CI 上并发不是越多越快；
5. **maxFailures**：`--max-failures=10`，环境级崩坏（服务起不来）时快速止损，别烧满 30 分钟；
6. **分片**（11.4）：最后手段，也是最大杀器；
7. **缓存**：官方**不推荐**缓存浏览器二进制（恢复缓存与重新下载耗时相当，Linux 系统库还不进缓存）；值得缓存的是 npm 依赖（`actions/setup-node` 的 `cache: npm` 或 `setup-node@v6` 默认行为）。

## 11.7 CI 失败的标准处理流

把第 10 章的诊断流程搬到 CI 语境：

```
PR 变红
 ├─ 打开 job → 下载 playwright-report artifact → npx playwright show-report
 │   ├─ 真 bug：修复应用代码
 │   ├─ 测试问题：修 locator/断言/隔离（第 10 章分类）
 │   └─ 环境问题（网络/资源）：报告里通常表现为大面积超时 → 查 runner 资源、外部依赖
 ├─ flaky（重试后绿）：不能放过——下载首轮 trace 归因，进 10.4 治理流程
 └─ 反复失败但本地复现不了：
     ├─ 对比环境：Node 版本、浏览器版本（CI 容器 vs 本地）
     ├─ DEBUG=pw:browser 看浏览器启动日志
     └─ 在 CI 上 --workers=1 重跑排除并发因素
```

配套 FlowOps 手册的质量门禁（其 CI 流水线第 10 步）：E2E 可以按「PR 跑冒烟子集、主分支跑全量」分层执行，但**主分支必须全量绿**。

---

## 常见错误

1. **忘了 `--with-deps`**：Linux runner 上浏览器启动失败（缺共享库）。报错通常是 `error while loading shared libraries`。
2. **artifact 上传步骤没加 `if: ${{ !cancelled() }}`**：测试一失败，job 中断，报告没上传，只能看着红叉猜。
3. **上传了 `playwright/.auth/` 或整个仓库目录**：会话 cookie 泄漏进 CI 产物。只传 `playwright-report/`（或 blob-report）。
4. **容器镜像版本与 Playwright 依赖版本不一致**：镜像 tag `v1.64.0` 配 `@playwright/test@1.62` → 浏览器二进制对不上。升级依赖时同步改镜像 tag。
5. **CI 上 `reuseExistingServer` 为 true**：复用到脏服务（官方语义里 CI 默认 false 的原因，第 6 章）。
6. **不设 globalTimeout，job 被平台强杀**：没有任何报告产出（11.3）。
7. **workers 拉满**：4 核 runner 开 8 个 worker，每个测试都变慢且随机超时——「CI 上比本地 flaky」的头号人为原因。
8. **在 CI 缓存浏览器**：官方明确不推荐，恢复缓存≈重新下载，还白占缓存配额。

## 练习

1. 把 example 的 `.github/workflows/playwright.yml` 改造成「PR 只跑 chromium、push main 跑全部三引擎」的两个 job（提示：`if: github.event_name == 'pull_request'` + `--project` 参数）。
2. 给 workflow 加上 `PLAYWRIGHT_BLOB_NAME` 与 4 分片矩阵 + merge-reports job（照 11.4 抄一遍并理解每一步）。
3. 本地模拟 CI 环境：`CI=1 npx playwright test`，对照 11.3 逐项验证配置差异生效（retries=1、workers=2、forbidOnly、trace=on-first-retry——最后这项可通过故意制造一个失败再让重试通过，检查 test-results 里是否出现 trace.zip）。
4. 思考题：为什么官方建议 CI 用 Linux 而不是 macOS runner？（提示：成本与速度之外，还有截图/渲染一致性与 Docker 镜像支持。）
5. 思考题：`deployment_status` 模式对生产环境跑 E2E，哪些测试绝不能 included？为 example 的套件做一次分类（提示：写操作、登出、越权探测）。

<details>
<summary>参考答案（要点）</summary>

1. 两个 job 或一个 job 带条件步骤：PR job 加 `--project=chromium`（仍需 setup 项目：`--project=setup --project=chromium`）；main job 不带 `--project` 全量跑。
2. 略。关键点：分片 job 的 reporter 配 `[['blob']]`、`fail-fast: false`、merge job `needs: [playwright]` 且 `if: ${{ !cancelled() }}`。
3. `CI=1` 下 retries=1：失败测试会显示 `(retry #1)`；flaky 结果出现在报告 flaky 过滤器；`test-results/` 中首轮失败目录含 trace.zip（on-first-retry 生效）。
4. Linux runner 单价低、并发配额高；官方 Docker 镜像只有 Linux 版；截图基线只需维护一种 OS 的渲染结果。
5. 绝不能对生产跑：一切写操作（创建/删除/改状态——会污染真实数据）、登出与会话吊销（影响真实用户会话）、越权探测（触发风控/审计告警）。生产 smoke 只保留只读旅程 + 健康检查。

</details>

## 本章验收清单

- [ ] 能独立写出 GitHub Actions 上跑 Playwright 的 workflow（含浏览器安装、失败也上传报告）；
- [ ] 理解 CI 与本地配置的每处差异及其理由（forbidOnly/retries/workers/globalTimeout/trace/reuseExistingServer）；
- [ ] 掌握分片 + blob reporter + merge-reports 的完整链路，知道何时才需要分片；
- [ ] 牢记产物上传的安全边界：报告可传，`.auth` 状态文件绝不传；
- [ ] 知道 deployment_status 模式与生产 smoke 测试的红线。

## 官方文档

- [Continuous Integration](https://playwright.dev/docs/ci) — 各平台配置全集（本章主体依据）
- [Sharding](https://playwright.dev/docs/test-sharding) — 分片与报告合并
- [Docker](https://playwright.dev/docs/docker) — 官方镜像与推荐配置
- [Test Retry](https://playwright.dev/docs/test-retries) — retries 与 flaky 报告
- [Command line](https://playwright.dev/docs/test-cli) — --only-changed、--max-failures 等全量开关

上一章：[调试、Trace Viewer 与 flaky 治理](./10-debugging-and-flaky-tests.md) ｜ 下一章：[综合实战与逐项验收](./12-capstone-and-acceptance.md)。
