# 第 6 章：playwright.config 逐项精讲

> 本章目标：把 `playwright.config.ts` 从「抄来的模板」变成「每项都知道为什么」的配置：测试发现、超时与重试、reporter、`use` 选项、projects 多浏览器矩阵、webServer，以及配置的层级覆盖规则。
>
> 对应总目标：**配置 webServer、baseURL、浏览器项目、重试、trace、截图/视频与 CI 报告。**

---

## 6.1 配置文件是怎么被找到的

`npx playwright test` 按以下顺序寻找配置：`--config` 参数 → 当前目录的 `playwright.config.ts`（或 `.js`/`.mts`…）。配置用 `defineConfig` 包裹——它不做任何运行时处理，纯粹为了 TypeScript 的智能提示：

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  // 所有配置项都有类型与文档注释
});
```

example 工程的完整配置就 70 行，本章以它为地图逐区讲解：

```ts
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["html"], ["github"]]
    : [["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
  },
  projects: [
    /* setup + chromium/firefox/webkit，第 6.6 与第 7 章 */
  ],
  webServer: {
    /* 第 6.7 节 */
  },
});
```

## 6.2 测试发现：testDir 与 testMatch

| 配置         | 默认                                     | 说明                              |
| ------------ | ---------------------------------------- | --------------------------------- |
| `testDir`    | 配置文件所在目录                         | 测试文件搜索根                    |
| `testMatch`  | `**/*.@(spec\|test).?(c\|[m\])@(js\|ts)` | 在 testDir 下按 glob 匹配测试文件 |
| `testIgnore` | —                                        | 排除匹配到的文件                  |
| `outputDir`  | `test-results/`                          | 失败产物（截图/视频/trace）目录   |

两个实用细节：

1. `*.setup.ts` 这类文件默认**不会**被当成测试（不匹配 `*.spec/test.*`），第 7 章的 setup 项目正是靠自定义 `testMatch: /.*\.setup\.ts/` 把它们圈进来；
2. 项目级也可以有自己的 `testMatch`/`testIgnore`，实现「chromium 项目跑全部、mobile 项目只跑关键旅程」这类拆分。

## 6.3 超时与重试

第 4 章讲过四层超时，这里补上配置视角与 `retries` 的配合：

```ts
export default defineConfig({
  timeout: 30_000, // 每测试 30s
  expect: { timeout: 5_000 }, // 每条 web-first 断言 5s
  retries: process.env.CI ? 1 : 0, // 本地 0 次，CI 1 次
});
```

**`retries` 的正确心智模型**：重试是「诊断工具 + 偶发环境抖动的缓冲」，不是 flaky 测试的解药。

- 本地设 0：失败立刻暴露，逼你当场面对；本地重试只会让你误以为测试是稳的；
- CI 设 1~2：网络抖动、容器冷启动这类环境噪音可以被吸收；配合 `trace: 'on-first-retry'`，**恰好只在「第一次失败、第二次通过」时录下 trace**——这正是最需要诊断的样本；
- 重试后通过的测试在报告里标记为 **flaky**，有独立过滤器。flaky 数量是套件健康度的核心指标，应当定期清零（第 10 章）；
- 整个 describe 标了 serial 时，组内测试**一起**重试。

相关的还有 `maxFailures`（失败达到 N 个就终止整轮，CI 止损用）与 `forbidOnly`（下节）。

## 6.4 forbidOnly：防止「绿色的谎言」

`test.only` 是本地调试利器——只跑一个测试。但如果带着 `.only` 推上 CI，整轮只跑一个测试、其余全部静默跳过，CI 显示绿色通过。`forbidOnly: true` 让这种情况**直接报错**而不是假绿：

```ts
forbidOnly: Boolean(process.env.CI),
```

这是官方 GitHub Actions 模板自带的配置，成本为零，建议所有项目原样保留。

## 6.5 reporter：结果给谁看

reporter 决定运行结果输出到哪。可以叠加多个（数组写法）：

| reporter                | 用途                                                              |
| ----------------------- | ----------------------------------------------------------------- |
| `list`                  | 终端逐行输出（默认）                                              |
| `html`                  | 生成 `playwright-report/`，`npx playwright show-report` 查看      |
| `github`                | CI 专用：把失败转成 GitHub Actions 的注解，直接标在 PR 的文件行上 |
| `junit`                 | 输出 XML，对接 Jenkins/Azure 等                                   |
| `json`                  | 机器可读，对接自研平台                                            |
| `dot` / `line` / `blob` | 极简输出 / blob（跨机器分片合并用，第 11 章）                     |

example 的按环境切换是一个值得复制的模式：

```ts
reporter: process.env.CI
  ? [['html'], ['github']]              // CI：html 存档 + PR 注解
  : [['html', { open: 'never' }]],      // 本地：html 但不自动弹浏览器
```

html reporter 默认「失败时自动打开」，本地嫌打扰就 `open: 'never'`；CI 上没人看浏览器，生成的报告作为 artifact 上传（第 11 章）。

## 6.6 use 与 projects：一次测试 × N 种环境

### use：浏览器上下文的默认选项

`use` 里的每个键都对应创建 BrowserContext 时的选项（所以它们也能被 `test.use()` 在文件级覆盖）。最常用的：

| 选项                                                       | 说明                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `baseURL`                                                  | `page.goto('/')` 的前缀；也让相对路径成为可能                                      |
| `screenshot`                                               | `'off'` / `'only-on-failure'` / `'on'`                                             |
| `video`                                                    | `'off'` / `'retain-on-failure'`（失败保留）/ `'on-first-retry'` / `'on'`           |
| `trace`                                                    | `'off'` / `'on'` / `'retain-on-failure'` / `'on-first-retry'` / `'on-all-retries'` |
| `viewport` / `deviceScaleFactor` / `isMobile` / `hasTouch` | 视口与设备仿真                                                                     |
| `locale` / `timezoneId` / `geolocation` / `permissions`    | 语言、时区、地理位置                                                               |
| `storageState`                                             | 预注入 cookie/localStorage（第 7 章主角）                                          |
| `testIdAttribute`                                          | 改 `getByTestId` 认的属性（默认 `data-testid`）                                    |
| `actionTimeout` / `navigationTimeout`                      | 动作/导航级超时（第 4 章）                                                         |
| `httpCredentials`                                          | HTTP Basic Auth                                                                    |
| `colorScheme`                                              | `'light'` / `'dark'` 暗色模式仿真                                                  |

诊断产物三件套（screenshot/video/trace）的选型逻辑：**截图最便宜（始终开 only-on-failure）；视频较贵（磁盘/性能），失败保留即可；trace 最贵也最有用，本地 retain-on-failure、CI on-first-retry**。第 10 章会证明 trace 为什么值得。

### devices：设备预设

`devices` 是一组预调好的 `use` 组合（viewport + userAgent + isMobile + touch…）：

```ts
import { devices } from '@playwright/test';

use: { ...devices['Desktop Chrome'] }        // 桌面 Chrome
use: { ...devices['iPhone 15 Pro'] }         // 移动仿真（Chromium 上模拟 Mobile Safari 行为）
use: { ...devices['Desktop Safari'] }
```

### projects：配置的「多环境矩阵」

`projects` 把整套测试在多种环境下各跑一遍，每个 project 可以有独立的 `use`、`testMatch`、`dependencies`：

```ts
projects: [
  { name: 'setup', testMatch: /.*\.setup\.ts/ },               // 先跑：产出登录态
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/alice.json' },
    dependencies: ['setup'],                                    // setup 成功后才跑
  },
  { name: 'firefox', use: { ...devices['Desktop Firefox'], /* ... */ }, dependencies: ['setup'] },
  { name: 'webkit',  use: { ...devices['Desktop Safari'],  /* ... */ }, dependencies: ['setup'] },
],
```

- `dependencies` 声明项目间先后关系（第 7 章用它串起认证）；
- `--project=chromium` 可以只跑一个项目；
- 常见演进形态：`chromium`（PR 快速反馈）+ `firefox/webkit`（主分支全量）+ `mobile`（关键旅程子集，用项目级 testMatch 圈定）。

**三个浏览器都跑值得吗？** WebKit 项目跑的是 Safari 内核——前端兼容性 bug（日期输入、滚动行为、CSS 差异）真的只在 WebKit 出现。官方立场是「Testing across all browsers ensures your app works for all users」；务实立场是至少让主分支跑全三引擎，PR 可以只跑 Chromium 提速。

## 6.7 webServer：让测试自带被测服务

`webServer` 让 Playwright 在测试开始前拉起你的应用（第 2 章预览过，这里是完整语义）：

```ts
webServer: {
  command: 'npm run app',                       // 启动命令（构建+启动可以写成 npm run build && npm start）
  url: 'http://127.0.0.1:4173/api/health',      // 就绪探针：等它返回 2xx/3xx/400/401/402/403
  timeout: 30_000,                              // 等待就绪的上限
  reuseExistingServer: !process.env.CI,         // 本地：已有服务就复用；CI：必须全新启动
},
```

细节与陷阱：

1. **就绪判定看状态码**：`url` 返回 404 不算就绪，会一直等到 timeout——所以要用健康检查端点（`/api/health`）或首页，而不是随便一个路径；也可以改用 `port` 字段只等端口可连；
2. **`reuseExistingServer` 的本地/CI 差异是刻意的**：本地复用你手动跑着的 dev server（改代码热更新，测试立刻用新版本）；CI 上若端口已被占用说明环境不干净，宁可报错；
3. **多服务**：`webServer` 接受数组（前端 + 后端各一个条目）；数组形式下 `baseURL` 必须显式配置；
4. **动态端口**：服务打印 `Listening on port 4321` 之类日志时，可用 `wait: { stdout: /port (?<my_server_port>\d+)/ }` 捕获端口并自动成为 baseURL；
5. **调试启动问题**：`DEBUG=pw:webserver npx playwright test` 可以看到子服务的 stdout/stderr（默认 stderr 会 pipe 到你的终端，stdout 不会——服务起不来又没日志时先想到这个）。

## 6.8 配置层级：谁覆盖谁

同一选项可能出现在四个地方，覆盖顺序（后者胜）：

```
defineConfig({ use })            全局默认
  └─ projects[i].use             项目级（如 webkit 的 devices 预设）
      └─ test.use({ ... })       文件 / describe 级（如 guest.spec.ts 重置 storageState）
          └─ fixture 覆盖         代码级（base.extend 包装 page 等，第 5 章）
```

外加命令行开关（`--project`、`--workers`、`--retries`、`--trace` 等）优先级最高。理解这个层级后，第 7 章「项目注入登录态 + 单文件重置为游客」的组合拳就是自然而然的事。

---

## 常见错误

1. **`webServer.url` 指向返回 404 的路径**：永远等不到就绪，30 秒后超时。用健康检查端点。
2. **CI 上 `reuseExistingServer: true`**：复用到上一轮 job 残留的旧版本服务，测的不是本次构建。跟随官方惯例写 `!process.env.CI`。
3. **本地开 `retries: 2` 掩盖 flaky**：本地永远看不到失败，CI 上原形毕露。本地 0、CI 1~2。
4. **`trace: 'on'` 全局常开**：官方明确不推荐（性能开销大）；用 `on-first-retry` / `retain-on-failure`。
5. **在 `use` 里写了项目名（`use: { project: ... }`）之类的臆造键**：`use` 的键就是 context 选项 + 少量测试选项，写错键 TS 会提示——这也是坚持用 `defineConfig` 的理由。
6. **改了配置但 `--config` 指向了别的文件**：monorepo 里常见；`npx playwright test --list` 可以先列出「将被执行的测试」验证发现逻辑。
7. **`screenshot/video/trace` 全设 `on` 又抱怨产物太大**：三者按成本分级配置（6.6），并记得 `test-results/` 要 gitignore。

## 练习

1. 给 example 的配置新增一个 `mobile` 项目：`devices['iPhone 15']`、依赖 setup、用项目级 `testMatch` 只跑 `journey.spec.ts`。运行 `npx playwright test --project=mobile --headed` 观察移动端视口下的界面，看看有什么布局问题（这本身就是一次真实的兼容性测试体验）。
2. 把 `trace` 临时改成 `'on'`，跑一个测试，然后在 `test-results/` 里找到 trace.zip，用 `npx playwright show-trace <path>` 打开看一眼（第 10 章正式讲）。改回原配置。
3. 实验 `forbidOnly`：给任意测试加 `.only`，先本地跑（应只跑一个），再 `CI=1 npx playwright test` 跑（应直接报错）。
4. 把 `webServer.url` 改成 `/api/nope`，验证第 2 章练习 4 的结论（等满 timeout 报错）。
5. 解释：为什么 `reporter` 在 CI 上叠加 `['github']`，本地却不需要？

<details>
<summary>参考答案（要点）</summary>

1.

```ts
{
  name: 'mobile',
  use: { ...devices['iPhone 15'], storageState: 'playwright/.auth/alice.json' },
  dependencies: ['setup'],
  testMatch: /journey\.spec\.ts/,
},
```

移动端典型发现：工具栏横向溢出、点击目标过小等。2. trace.zip 位于 `test-results/<测试名带项目前缀>/trace.zip`；show-trace 打开后可见时间轴、DOM 快照、网络面板。3. `.only` + CI 环境变量 → `Error: test.only found in ...` 之类的 forbidOnly 报错，整轮失败。这就是它防的事故。4. 404 不在就绪状态码集合（2xx/3xx/400/401/402/403）内，等到 30s 超时。5. `github` reporter 把失败转成 PR 代码行上的 annotation，只在 GitHub Actions 环境有意义；本地终端没有这个消费方，html/list 足够。

</details>

## 本章验收清单

- [ ] 能不看文档写出包含 testDir / timeout / retries / use(baseURL, trace) / projects / webServer 的可用配置；
- [ ] 理解 retries 本地 0、CI 1 的理由，以及 flaky 标记的含义；
- [ ] 能说出 screenshot / video / trace 的成本分级与推荐取值；
- [ ] 掌握 webServer 的就绪判定、reuseExistingServer 语义与多服务/动态端口写法；
- [ ] 能画出配置覆盖层级：全局 use → project use → test.use → fixture → 命令行。

## 官方文档

- [TestConfig reference](https://playwright.dev/docs/api/class-testconfig) — 全量配置项
- [TestOptions reference](https://playwright.dev/docs/api/class-testoptions) — `use` 全量选项
- [Emulation](https://playwright.dev/docs/emulation) — devices、viewport、locale、时区
- [Test Reporter](https://playwright.dev/docs/test-reporters) — 各 reporter 详解

上一章：[fixture 与测试隔离](./05-fixtures-and-isolation.md) ｜ 下一章：[认证与 storageState](./07-authentication-and-storage-state.md)。
