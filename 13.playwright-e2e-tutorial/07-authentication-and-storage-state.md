# 第 7 章：认证与 storageState

> 本章目标：解决「每条测试都要先登录」的问题：理解 storageState 的本质与边界；掌握官方推荐的认证分级方案（共享账号 setup 项目 → 每 worker 一个账号 → 多角色）；学会多角色同场测试与游客视角的写法；牢记状态文件的安全红线。
>
> 对应总目标：**认证状态 storageState 的安全使用；不同角色的测试身份与数据种子。**

---

## 7.1 问题：登录是所有测试的「税」

TaskBoard 的大部分测试都需要登录态。最直白的写法是在 `beforeEach` 里走一遍 UI 登录：

```ts
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("邮箱").fill("alice@taskboard.dev");
  await page.getByLabel("密码").fill("alice123");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByText("alice@taskboard.dev")).toBeVisible();
});
```

能跑，但有三笔账算不过来：

1. **时间税**：每条测试多付 1~3 秒。50 条测试 × 3 个浏览器项目 = 150 次重复登录；
2. **脆弱税**：登录 UI 一改（加个验证码、改个按钮文案），所有测试一起挂——而其中 95% 的测试根本不想测登录；
3. **语义税**：测试报告里满屏登录步骤，淹没了真正被测的业务动作。

正确思路：**登录一次，把「登录后的浏览器状态」保存下来，发给所有测试复用。**

## 7.2 storageState 是什么

`BrowserContext.storageState()` 把当前 context 的 **cookies + 每个 origin 的 localStorage**（1.5x 起还包含 IndexedDB）导出为一个 JSON 文件；创建 context 时传入 `storageState`，这些状态就被预先注入——页面一打开就是已登录状态。

TaskBoard 的会话是 `HttpOnly` cookie，登录成功后导出的文件形如：

```json
{
  "cookies": [
    {
      "name": "sb_session",
      "value": "8f14e45f-…",
      "domain": "127.0.0.1",
      "path": "/",
      "expires": 1790000000,
      "httpOnly": true,
      "secure": false,
      "sameSite": "Lax"
    }
  ],
  "origins": []
}
```

**边界**：`sessionStorage` 不在导出范围内（它本来就不跨页面加载持久化）。极少数用 sessionStorage 存登录态的应用，官方给了 `addInitScript` 手工搬运的片段（见本章末官方文档链接）。

**安全红线（官方原文级别的警告）**：这个文件里的 cookie 等价于测试账号的登录凭证，拿到就能冒充该账号。因此：

- 统一放在 `playwright/.auth/` 目录并加入 `.gitignore`（example 已配好）；
- CI 上绝不作为 artifact 上传（第 11 章的 workflow 里特意注释了这一点）；
- 只在受控的测试环境使用测试账号，永远不要用真实用户/生产凭证。

## 7.3 方案一（推荐起步）：setup 项目 + 共享账号

官方称之为「Basic: shared account in all tests」——所有测试共用一个账号的登录态。**适用前提：你的测试并行跑、都用同一账号，也不会互相影响服务端状态**（或者影响已被第 5 章的 uniqueTitle 策略化解）。

分三步，example 工程就是标准实现：

### 第一步：写一个「只负责登录」的 setup 文件

```ts
// tests/auth.setup.ts
import { test as setup, expect } from "@playwright/test";

const authFile = "playwright/.auth/alice.json";

setup("authenticate as alice", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("邮箱").fill("alice@taskboard.dev");
  await page.getByLabel("密码").fill("alice123");
  await page.getByRole("button", { name: "登录" }).click();

  // 等待「登录确实完成」的可观察信号，而不是等固定时间
  await expect(page.getByText("alice@taskboard.dev")).toBeVisible();

  await page.context().storageState({ path: authFile });
});
```

注意等待信号的选择：顶栏出现用户邮箱，说明会话 cookie 已种下且 `/api/me` 已成功——比 `waitForURL` 更强的完成信号。**导出前必须确认状态真的就绪**，否则会把半登录状态存进文件。

### 第二步：把 setup 声明为独立项目，其他项目依赖它

```ts
// playwright.config.ts
projects: [
  { name: 'setup', testMatch: /.*\.setup\.ts/ },
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/alice.json' },
    dependencies: ['setup'],      // setup 项目全部通过后，chromium 项目才开始
  },
  // firefox / webkit 同理
],
```

### 第三步：测试里什么都不用写

```ts
test("登录后能看到任务列表", async ({ page }) => {
  await page.goto("/"); // cookie 已注入，直接是登录态
  await expect(page.getByRole("heading", { name: "任务列表" })).toBeVisible();
});
```

运行机制：`npx playwright test` 时先跑 setup 项目（登录 + 存文件），再并行跑依赖它的项目；`page`/`request` fixture 都会带上这份 storageState——所以第 5 章的 `seed` fixture 才能直接调 API 造数。

两个运维细节：

- **状态过期**：会话过期后 setup 会重新登录并覆盖文件，天然自愈。若不想跨运行保留，可把文件写到 `testInfo.project.outputDir` 下（每轮自动清理）；
- **UI Mode 默认不跑 setup 项目**（为了快）。登录态过期时手动执行一次 `npx playwright test --project=setup` 即可。

## 7.4 方案二：每个 worker 一个账号

当测试会修改**账号级**的服务端状态（改个人设置、改头像），共享账号在并行下会互相踩踏。官方方案「Moderate: one account per parallel worker」：用 worker 级 fixture 覆写 `storageState`，每个并行 worker 用 `parallelIndex` 领一个专属账号，登录一次、本 worker 所有测试复用：

```ts
// playwright/fixtures.ts（官方模式的简化）
export const test = base.extend<{}, { workerStorageState: string }>({
  // 覆写内置 storageState：所有测试自动改用 worker 专属状态
  storageState: ({ workerStorageState }, use) => use(workerStorageState),

  workerStorageState: [
    async ({ browser }, use) => {
      const id = test.info().parallelIndex; // 0..workers-1，worker 重建后不变
      const fileName = path.resolve(
        test.info().project.outputDir,
        `.auth/${id}.json`,
      );
      if (fs.existsSync(fileName)) return use(fileName); // 本 worker 已登录过，直接复用

      const page = await browser.newPage({ storageState: undefined }); // 干净环境登录
      const account = await acquireAccount(id); // 从账号池领第 id 个账号
      // ...UI 或 API 登录...
      await page.context().storageState({ path: fileName });
      await page.close();
      await use(fileName);
    },
    { scope: "worker" },
  ],
});
```

要点：`parallelIndex`（而非 `workerIndex`）保证失败重建的 worker 领回同一个账号；账号要**唯一到开发者**（多人同时跑 CI/本地不能互抢），实践中常用账号池服务或 `user-{开发者名}-{id}` 命名。TaskBoard lite 没走到这一步——它的账号级可变状态只有任务数据，uniqueTitle 已解决；但如果毕业项目（FlowOps）要测「修改自己的资料页」，这个模式就是标准答案。

## 7.5 更快的登录：绕过 UI 直接调 API

如果应用支持 API 登录，setup 可以不开浏览器页面，用 `request` fixture 直接发请求（官方「Authenticate with API request」）：

```ts
setup("authenticate", async ({ request }) => {
  await request.post("/api/login", {
    data: { email: "alice@taskboard.dev", password: "alice123" },
  });
  await request.storageState({ path: authFile }); // request 上下文同样能导出状态
});
```

快（无渲染开销）、稳（不受登录 UI 改版影响）。取舍原则和第 5 章「API 造数、UI 验证」一致：

- **登录流程本身的测试**（表单校验、错误提示、跳转）必须走 UI——那是用户旅程的一部分（example 的 `guest.spec.ts` 就在测登录失败路径）；
- **其余所有测试**的登录态，用 API setup 或 UI setup 均可；团队常保留一个 UI 登录测试守门，其余走快车道。

## 7.6 多角色：不同身份的测试怎么组织

真实应用几乎总有角色差异（admin/member、租户 A/B）。官方给出三个层级的做法，TaskBoard 全部用上了：

### 层级一：多个状态文件 + 按文件选择身份

setup 里为每个角色各存一份状态（`admin.json`、`user.json`），测试文件用 `test.use` 声明自己是谁：

```ts
// admin.spec.ts
test.use({ storageState: "playwright/.auth/admin.json" });
test("管理员能修改内部备注", async ({ page }) => {
  /* ... */
});

// 也可以 describe 粒度
test.describe("成员视角", () => {
  test.use({ storageState: "playwright/.auth/user.json" });
  test("成员不能修改内部备注", async ({ page }) => {
    /* ... */
  });
});
```

Carol（admin）在 TaskBoard 里的差异——任务详情对话框中「内部备注（仅管理员）」字段的可见性、PATCH notes 的 403——就适合这样组织（练习 2）。

### 层级二：单个测试里多角色同场

要测「A 的操作对 B 可见」这类协作/隔离场景，一个 `page` 不够用，直接开两个 context：

```ts
test("bob 在 Beta 创建的任务，alice 搜索不到", async ({ browser }) => {
  // bob：干净 context + UI 登录
  const bobContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const bobPage = await bobContext.newPage();
  // ...bob 登录、创建任务...

  // alice：注入已有登录态
  const aliceContext = await browser.newContext({
    storageState: "playwright/.auth/alice.json",
  });
  const alicePage = await aliceContext.newPage();
  // ...alice 搜索，断言一无所获...

  await bobContext.close();
  await aliceContext.close();
});
```

这正是 `tests/tenancy.spec.ts` 第 4 个测试（路线图练习 2「跨 workspace 越权」）的实现。规模大了以后，官方建议把每个角色封装成 POM + fixture（`adminPage`、`userPage`），测试体只写业务。

### 层级三：游客视角（重置登录态）

项目级配置给所有测试注入了 alice 登录态，个别测试想当游客，就地重置：

```ts
// tests/guest.spec.ts
test.use({ storageState: { cookies: [], origins: [] } }); // 空状态 = 未登录

test("未登录访问首页时只能看到登录表单", async ({ page }) => {
  /* ... */
});
```

配置层级（第 6.8 节）在这里发挥作用：文件级 `test.use` 覆盖项目级 `use.storageState`。

## 7.7 认证策略选择表

| 场景                                   | 方案                                   |
| -------------------------------------- | -------------------------------------- |
| 测试不碰账号级共享状态（绝大多数项目） | 7.3 setup 项目 + 共享账号              |
| 测试会改账号设置/资料，且并行执行      | 7.4 每 worker 一个账号                 |
| 登录慢/有验证码，但有 API 登录         | 7.5 API setup                          |
| 角色差异测试                           | 7.6 层级一（多状态文件 + test.use）    |
| 协作/租户隔离测试                      | 7.6 层级二（单测试多 context）         |
| 登录流程本身                           | UI 完整走一遍（独立 spec，不复用状态） |
| 未登录边界                             | 7.6 层级三（重置为空状态）             |

最后强调路线图的原话：「使用 API/setup 准备测试数据，但**真正的 E2E 仍要通过 UI 验证用户可观察行为**」。storageState 只是把「进入状态」的过程优化掉了，断言永远落在用户看得见的东西上。

---

## 常见错误

1. **把 `playwright/.auth/` 提交进仓库**：会话 cookie 泄漏。目录进 `.gitignore`，CI artifact 排除它。
2. **setup 里登录完立即导出，没等完成信号**：cookie 可能在重定向链后才种下；导出半登录状态，后续测试全部诡异失败。等一个「登录后可观察」的元素或 `waitForURL`。
3. **在业务测试里保留 UI 登录步骤「以防万一」**：两笔税都交了。信任 setup + storageState；登录流程有专门的测试守着。
4. **所有角色共用一份状态文件，在测试里手动登出再登另一个账号**：登出会使共享文件里的会话在服务端失效（TaskBoard 的 logout 就删 session），并行测试互相踢下线。多角色用多文件/多 context。
5. **`sessionStorage` 存登录态的应用直接套用 storageState**：sessionStorage 不在导出范围，需要官方文档的 addInitScript 片段。
6. **忘记 `dependencies: ['setup']`**：项目并行启动，业务测试可能在状态文件生成前就跑，报「文件不存在」或全员未登录。

## 练习

1. 运行 `npx playwright test --project=setup`，打开生成的 `playwright/.auth/alice.json`，对照 7.2 节解释每个字段的含义。
2. 把 `auth.setup.ts` 改造成 API 登录版（7.5 节），运行全量测试验证一切照常；再把等待信号删掉直接 `request.post` 后导出，思考为什么 API 版不需要「等可观察信号」。
3. 新增 `tests/admin.setup.ts` 为 Carol 生成 `playwright/.auth/carol.json`（记得 setup 项目的 testMatch 已覆盖 `*.setup.ts`），写一个 `admin.spec.ts`：`test.use({ storageState: 'playwright/.auth/carol.json' })`，验证 Carol 打开任务详情能看到「内部备注（仅管理员）」字段，而 alice 的视角看不到（提示：两个 describe + 各自 test.use，或层级二双 context）。
4. 实验多角色互踢：写一个测试，用 alice 的共享状态登录后，在另一个 context 里以 alice 身份走 UI 登录再登出，然后回到第一个 page 刷新——观察发生了什么，解释原因（提示：TaskBoard 的 logout 删除服务端 session，但两个 context 的 cookie 各自独立）。
5. 思考题：为什么官方建议 worker 级账号用 `parallelIndex` 而不是 `workerIndex` 做账号标识？

<details>
<summary>参考答案（要点）</summary>

1. `name/value`：会话 cookie 键值；`domain/path`：作用范围；`expires`：Unix 秒（Max-Age 28800 → 8 小时后）；`httpOnly: true`：JS 不可读；`sameSite: Lax`：跨站请求不携带（CSRF 防线之一）；`origins`：localStorage 快照，TaskBoard 不用故为空。
2. API 登录是同步的请求-响应：`request.post` 成功返回时 Set-Cookie 已被 request 上下文记录，`request.storageState()` 导出的必然是完整状态，不存在「渲染/重定向未完成」的时间窗。
3. 关键断言：admin 视角 `await expect(dialog.getByLabel('内部备注（仅管理员）')).toBeVisible()`；alice 视角 `toBeHidden()`。再各补一条 API 断言：PATCH notes，admin 200、alice 403（`{ error: { code: 'forbidden' } }`）。
4. 第一个 page 刷新后仍是登录态或掉登录态取决于服务端 session：TaskBoard 的 logout 只删「那次登出请求所带 cookie」对应的 session；两个 context 的 cookie 值不同（各自登录各自种），互不影响——如果实现是「按用户删所有 session」，第一个 page 就会被踢。这个实验的价值：理解 storageState 复用的前提是**服务端会话不被别的测试销毁**。
5. worker 失败重建时 `workerIndex` 会分配新值，而 `parallelIndex`（0..workers-1 的槽位号）保持不变——用 parallelIndex 才能让重建的 worker 找回自己的账号文件，避免重复登录或账号错乱。

</details>

## 本章验收清单

- [ ] 能说出 storageState 导出/注入的内容（cookies、localStorage；不含 sessionStorage）与安全红线；
- [ ] 能独立搭建 setup 项目 + dependencies + 项目级 storageState 的完整链路；
- [ ] 知道每 worker 一个账号的方案与 `parallelIndex` 的作用；
- [ ] 会做多角色测试：多状态文件 + test.use、单测试多 context、游客重置三种形态；
- [ ] 理解「API/setup 准备状态，UI 验证行为」的分工原则。

## 官方文档

- [Authentication](https://playwright.dev/docs/auth) — 本章主体：全部认证模式与 sessionStorage 片段
- [BrowserContexts](https://playwright.dev/docs/browser-contexts) — context 隔离与多身份原理
- [API testing](https://playwright.dev/docs/api-testing) — request fixture 的完整能力（第 8 章展开）

上一章：[playwright.config 逐项精讲](./06-configuration.md) ｜ 下一章：[网络、mock 与 API 测试](./08-network-and-api-testing.md)。
