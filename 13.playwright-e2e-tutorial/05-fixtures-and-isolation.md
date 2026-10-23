# 第 5 章：fixture 与测试隔离

> 本章目标：理解 Playwright Test 的核心组织单元——fixture：内置 fixture 从哪来、自定义 fixture 怎么写、和 `beforeEach` 怎么选；掌握测试隔离的完整语义（浏览器状态、测试数据、并行执行），以及 `test.describe`、hooks、`test.step` 的正确用法。
>
> 对应总目标：**Fixture、beforeEach/afterEach、测试隔离、稳定的测试数据与并行执行。**

---

## 5.1 测试函数的真实签名

每个测试都是一个异步函数，Playwright 给它注入两样东西：

```ts
test("标题", async ({ page, request }, testInfo) => {
  //              ^^^^^^^^^^^^^^^^  ^^^^^^^^
  //              fixture 对象（解构）  当前测试的元信息
});
```

- **第一个参数是 fixture 对象**：你在解构里写什么名字，运行器就为你准备什么。`{ page }` 背后的完整流程是：启动/复用 browser → 新建 BrowserContext → 新建 Page → 测试结束后销毁 context。这一切发生在你的函数体执行之前；
- **第二个参数是 `testInfo`**：`testInfo.testId`（稳定唯一 id）、`testInfo.outputPath(...)`（本测试专属的产物目录）、`testInfo.parallelIndex` / `workerIndex`、`testInfo.attach(...)`（往报告里挂附件）等。

这个「按需声明、由框架装配」的模式就是 fixture。它和 Jest 的 `beforeEach` 世界观不同：**Jest 让你控制「什么时候执行」，Playwright 让你声明「需要什么」**。

## 5.2 describe、hooks 与 test.use

组织多个测试用 `test.describe`；组内共享准备动作用 hooks：

```ts
import { test, expect } from "@playwright/test";

test.describe("游客边界", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/"); // 每个测试前都执行——注意 page 每次都是新的
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      console.log("失败现场 URL：", page.url());
    }
  });

  test("未登录只能看到登录表单", async ({ page }) => {
    /* ... */
  });
  test("错误密码有明确提示", async ({ page }) => {
    /* ... */
  });
});
```

要点：

- hooks 能拿到 fixture（`beforeEach` 里的 `page` 和测试体里的 `page` 是同一个——同一测试内 fixture 只装配一次）；
- `beforeAll` / `afterAll` 每个 **worker** 执行一次，只能拿到 worker 级 fixture（如 `browser`），**拿不到 `page`**——因为 page 是测试级的；
- `test.use({ ... })` 在文件/describe 粒度覆盖配置项（第 6 章），比如 `guest.spec.ts` 开头那句 `test.use({ storageState: { cookies: [], origins: [] } })`；
- describe 可以嵌套；`test.skip()` / `test.fixme()` / `test.slow()` 等注解可以按条件跳过或放宽。

**hooks 的边界**：`beforeEach` 适合「每个测试都需要的、与测试内容无关的通用准备」（如统一 goto）。一旦准备逻辑开始分叉（「A 测试要登录态、B 测试要管理员态、C 测试不要登录」），hooks 就会演变成 describe 嵌套地狱——这正是 fixture 要解决的问题。

## 5.3 内置 fixture 一览

| fixture                            | 作用域     | 说明                                                                                              |
| ---------------------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `page`                             | test       | 本测试独享的 Page（连同它独享的 context）                                                         |
| `context`                          | test       | 本测试独享的 BrowserContext；`page` 属于它                                                        |
| `browser`                          | **worker** | 浏览器进程，worker 内共享（启动贵，复用它）                                                       |
| `browserName`                      | worker     | `chromium` / `firefox` / `webkit`                                                                 |
| `request`                          | test       | APIRequestContext：**默认继承本测试的 storageState**，即和页面共享 cookie（第 7、8 章的关键伏笔） |
| `context.request` / `page.request` | test       | 绑定到 context 的请求客户端，同样共享 cookie                                                      |

注意 `browser` 与 `page` 作用域的差异解释了第 1 章的层级图：浏览器进程被 worker 里的测试们复用（省启动成本），但 context 每测试全新（保隔离）。**隔离的边界画在 context，而不是 browser。**

## 5.4 自定义 fixture：test.extend

`test.extend` 创建一个新的 `test` 对象，往 fixture 池里添加（或覆盖）条目。fixture 函数接收「它依赖的其他 fixture」，调用 `use(value)` 把值交给测试；`use` 之前的代码是 setup，之后的是 teardown：

```ts
// tests/fixtures.ts —— example 工程的真实代码（有删节）
import { test as base, expect } from "@playwright/test";

type Seed = {
  uniqueTitle(prefix: string): string;
  createTask(input: {
    title: string;
    status?: "todo" | "doing" | "done";
  }): Promise<Task>;
};

export const test = base.extend<{ seed: Seed }>({
  seed: async ({ request }, use, testInfo) => {
    // ---- setup：本测试独享的造数工具 ----
    await use({
      // 标题带上 testId：并行测试永不碰撞（5.6 节）
      uniqueTitle: (prefix) => `${prefix}-${testInfo.testId}`,
      // 通过 API 造数：快，且 request 自带 alice 的登录 cookie
      createTask: async ({ title, status = "todo" }) => {
        const res = await request.post("/api/tasks?workspaceId=ws-alpha", {
          data: { title, status },
        });
        expect(res.status(), "造数接口应当返回 201").toBe(201);
        return (await res.json()).task;
      },
    });
    // ---- teardown（本例无需清理，见下文说明） ----
  },
});

export { expect };
```

测试文件从这里导入 `test`，就能解构出 `seed`：

```ts
// tests/journey.spec.ts
import { test, expect } from "./fixtures";

test("任务详情对话框可以修改标题与状态", async ({ page, seed }) => {
  const title = seed.uniqueTitle("重构登录模块");
  const task = await seed.createTask({ title }); // API 造数，1 秒内就绪

  await page.goto("/");
  await page.getByLabel("搜索标题").fill(title);
  // ...UI 验证...
});
```

fixture 相对 hooks 的优势（官方总结）：

1. **setup 和 teardown 写在同一个函数里**——`beforeEach` 建的东西要配一个 `afterEach` 拆，两者相隔几十行还容易漏；
2. **跨文件复用**——定义一次，处处 import；hooks 只管本文件；
3. **按需装配**——声明 10 个 fixture，测试只解构 2 个，就只跑那 2 个的 setup；
4. **可组合**——fixture 之间可以互相依赖（`seed` 依赖 `request`）；
5. **让 describe 回归语义分组**——不再为了共享准备逻辑而被迫把测试塞进同一个 describe。

关于 teardown 的一个工程决策：`seed` 创建的测试任务**没有**在 teardown 里删除。因为 TaskBoard 数据在内存里、服务器由 webServer 管理，且每条测试用 `uniqueTitle` 保证互不干扰——残留数据影响不到任何断言。**teardown 不是仪式，只在「不清理就会影响别人」时才写。**（如果是共享的持久化数据库，就必须清理，或用第 8 章的事务/专用数据策略。）

## 5.5 worker fixture、auto fixture 与执行顺序

### worker 作用域：每个进程装配一次

tuple 语法 + `{ scope: 'worker' }`。适合「装配一次、本 worker 所有测试共享」的资源：起一个服务、建一个数据库用户、登录一个账号（第 7 章的 per-worker 认证就是它）：

```ts
export const test = base.extend<{}, { account: Account }>({
  //                      ^^ test 级 fixture 类型    ^^ worker 级 fixture 类型
  account: [
    async ({ browser }, use, workerInfo) => {
      const username = "user" + workerInfo.workerIndex; // 每 worker 唯一
      // ...创建并登录账号...
      await use({ username, password });
      // worker 退出时才执行 teardown
    },
    { scope: "worker" },
  ],
});
```

### auto fixture：不用解构也生效

`{ auto: true }` 的 fixture 对每个测试自动装配——等价于「全局 beforeEach/afterEach」，但保持 fixture 的所有优点：

```ts
export const test = base.extend<{ saveLogs: void }>({
  saveLogs: [
    async ({}, use, testInfo) => {
      const logs: string[] = [];
      debug.log = (...args) => logs.push(args.map(String).join(""));
      await use(); // ← 测试在这里执行
      if (testInfo.status !== testInfo.expectedStatus) {
        // 失败时才附日志
        const logFile = testInfo.outputPath("logs.txt");
        await fs.promises.writeFile(logFile, logs.join("\n"), "utf8");
        testInfo.attachments.push({
          name: "logs",
          contentType: "text/plain",
          path: logFile,
        });
      }
    },
    { auto: true },
  ],
});
```

### 覆盖内置 fixture

extend 同名 fixture 即覆盖，还可以「包装」原实现（解构出原 fixture 再加工）。官方的经典例子——让 `page` 自动先打开首页：

```ts
export const test = base.extend({
  page: async ({ baseURL, page }, use) => {
    await page.goto(baseURL); // 所有测试免写 goto
    await use(page);
  },
});
```

### 执行顺序（一图流）

```
worker 启动
 ├─ worker 级 auto fixture setup
 ├─ beforeAll
 ├─ 测试 1
 │   ├─ test 级 auto fixture setup
 │   ├─ 被解构的 fixture setup（依赖的先装配：browser → context → page → request → seed）
 │   ├─ beforeEach → 测试体 → afterEach
 │   └─ fixture teardown（逆序）＋ context 销毁
 ├─ 测试 2（同上，一切重来）
 ├─ afterAll
 └─ worker fixture teardown、browser 关闭
```

规则：被依赖者先 setup 后 teardown；非 auto fixture 惰性装配（没人解构就不跑）；**测试失败后 worker 会被销毁重建**，保证后续测试拿到纯净环境——所以别指望用模块级变量在测试间传状态。

## 5.6 测试隔离：三个层面

路线图说的「测试隔离」在 Playwright 里是三层机制的叠加，每层对付一种泄漏：

### 层面一：浏览器状态（框架自动保证）

每个测试全新的 BrowserContext ⇒ cookie、localStorage、IndexedDB、内存缓存零共享。测试 A 登录了、测试 B 打开还是未登录状态；测试 A 写坏的 localStorage 不会传染。**这层不需要你做任何事**——除非你主动用 `browser.newContext()` 之外的方式共享状态（比如把 page 存进模块级变量，见 5.5 的 worker 重建规则）。

### 层面二：服务端数据（你要负责）

浏览器隔离了，但**数据库/服务端内存是所有测试共享的**。两个测试同时创建同名任务、一个测试删了另一个测试要用的数据——这类泄漏框架管不了。标准解法是让每个测试的数据**可识别、不碰撞**：

```ts
// 用 testId 派生唯一名称（example 的 seed.uniqueTitle 就是这么做的）
const title = `发布说明-${testInfo.testId}`;
```

`testInfo.testId` 对「同一测试的重试」也是稳定的，对「不同测试」必然不同——比 `Math.random()` 好在可追溯（数据残留时能看出是哪个测试留下的）。

断言同样要「只认自己的数据」：不要断言「列表共 12 条」（别的并行测试会加数据），而是造专属数据 + 搜索后断言唯一命中（journey.spec.ts 的模式）。

### 层面三：执行顺序（默认即隔离，别自己破坏）

Playwright 默认**文件之间并行、文件之内按声明顺序串行**。这意味着：

- 任何测试都可能与别的文件的测试**同时**执行；
- 单文件内的顺序也只在默认模式下有保证。

破坏隔离的典型写法与替代品：

```ts
// ❌ 模块级变量跨测试传状态：并行/重试/单跑任何一个都会碎
let createdTaskId: string;
test('创建', async () => { createdTaskId = ...; });
test('使用', async () => { /* 依赖上一个测试跑过 */ });

// ✅ 每个测试自给自足：需要什么就在自己体内（或 fixture 里）准备
test('使用', async ({ seed }) => {
  const task = await seed.createTask({ title: seed.uniqueTitle('x') });
  // ...
});
```

官方对 serial 模式（`test.describe.configure({ mode: 'serial' })`，一个失败全组跳过、整组一起重试）的态度是**不推荐**：「It is usually better to make your tests isolated」。确实存在共享资源不能并发访问的场景（如全局账号设置），1.6x 新增了**测试锁**作为精准替代：

```ts
// 不同文件、不同项目里，同名 lock 的测试永不并发；其余测试照常并行
test("update user settings", { lock: "user-settings" }, async ({ page }) => {
  /* ... */
});
test("rename user", { lock: "user-settings" }, async ({ page }) => {
  /* ... */
});
```

### 并行度的控制开关

| 需求             | 做法                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------ |
| 单文件内也并行   | 文件头 `test.describe.configure({ mode: 'parallel' })`，或全局 `fullyParallel: true` |
| 降低总并发       | `workers: 4`（配置）或 `--workers=4`（命令行）；CI 建议收紧（第 11 章）              |
| 完全串行         | `workers: 1`                                                                         |
| 多机分片         | `--shard=2/3`（第 11 章）                                                            |
| 失败太多提前止损 | `maxFailures: 10` 或 `--max-failures=10`                                             |

example 工程的立场：**不开 `fullyParallel`**（文件内串行足够快、心智负担小），靠 uniqueTitle + 只认自己数据实现并行安全。你可以通过 `npx playwright test --workers=4` 反复运行验证：整套测试任意顺序、任意并发都能过——这正是路线图通过标准「测试数据相互隔离，可重复执行」的含义。

## 5.7 test.step：给长测试加上目录

一条旅程测试动辄二三十行，`test.step` 把动作分组成带名字的步骤，显示在报告、UI Mode 和 trace 里（失败时直接指出挂在哪一步）：

```ts
test("创建 → 改状态 → 搜索 → 登出", async ({ page, seed }) => {
  await test.step("创建任务", async () => {
    await page.getByLabel("任务标题").fill(title);
    await page.getByRole("button", { name: "新建任务" }).click();
  });

  await test.step("修改状态为已完成", async () => {
    await item.getByLabel(`修改「${title}」的状态`).selectOption("done");
    await expect(item.getByText("已完成")).toBeVisible();
  });
  // ...
});
```

step 不改变任何执行语义，纯粹是可读性与可诊断性投资。对超过一屏的测试建议默认使用；对十几行的小测试则不必强加。

---

## 常见错误

1. **在 `beforeAll` 里解构 `page`**：beforeAll 是 worker 级，page 是 test 级，直接报错。需要「每 worker 一次的页面操作」就自己 `browser.newPage()` 并记得关闭。
2. **模块级变量共享测试状态**：并行、重试、单跑三种场景各碎一次（5.6 层面三）。
3. **断言全局数量**（`toHaveCount(12)`）：并行测试会改变全局数据。造专属数据、搜索、断言唯一命中。
4. **fixture 的 teardown 里做耗时清理但不需要**：teardown 计入测试时长；只清理「会污染他人」的资源。
5. **每个测试都在 beforeEach 里走一遍 UI 登录**：能跑，但每条测试多花几秒，且登录 UI 一改全挂——这是第 7 章 storageState 要解决的问题。
6. **给 `test.extend` 的 fixture 起 `page`、`request` 这类内置名却不知情**：同名即覆盖。想包装先在参数里解构原 fixture（5.5）。
7. **依赖单文件内的执行顺序写「步骤式测试」**：默认模式今天保得住，开 `fullyParallel` 或 shard 之后立刻碎。每测试自足是唯一可迁移的写法。

## 练习

1. 在 example 的 `tests/fixtures.ts` 里给 `seed` 增加一个 `deleteTask(id)` 方法（提示：`request.delete`），再给 `journey.spec.ts` 的「删除任务」测试加上 teardown：如果测试结束时任务还在，就通过 API 删掉它。思考：这个 teardown 在什么情况下真正生效？
2. 把 `tests/journey.spec.ts` 的第一个测试用 `test.step` 重组成五个步骤，跑一次并在 HTML 报告里观察步骤展示。
3. 写一个 auto fixture，在每个测试失败时把 `page.url()` 和当前时间写入 `testInfo.outputPath('failure-context.txt')` 并 attach 到报告（参考 5.5 的 saveLogs）。
4. 实验：把 `seed.uniqueTitle` 改成返回固定字符串 `'固定标题'`，然后 `npx playwright test --workers=4` 多跑几轮，观察哪些测试开始互相干扰、失败信息长什么样。改回来并总结教训。
5. 解释：为什么「测试失败后 worker 销毁重建」会让「用模块级缓存加速」的优化失效？

<details>
<summary>参考答案（要点）</summary>

1. teardown 只在「UI 删除动作没发生/没成功」时生效（正常路径任务已删，API 再删一次幂等无害——DELETE 对不存在 id 返回 204）。价值：测试半途失败时不留脏数据。
2. 略。报告中该测试展开后是五个可折叠步骤，失败步骤高亮。
3. 关键骨架：`[async ({ page }, use, testInfo) => { await use(); if (testInfo.status !== testInfo.expectedStatus) { ...writeFile + testInfo.attachments.push(...) } }, { auto: true }]`。
4. 会出现：多条测试创建同名任务 → 搜索后 `toHaveCount(1)` 变成 2+ 而失败；删除测试可能删掉别人造的同名任务。失败信息里能看到 locator 匹配到了多个元素。教训：唯一性是并行安全的前提，`testInfo.testId` 是免费的唯一来源。
5. 失败 → worker 进程整个销毁 → 模块级变量随之消失 → 下一个测试在新 worker 里重新 import 模块，缓存永远是冷的。把「昂贵且可共享」的资源放进 worker fixture，框架才会在 worker 存活期内正确复用（并在重建时正确重建）。

</details>

## 本章验收清单

- [ ] 能解释 fixture 与 hooks 的分工，以及 fixture 的五大优势；
- [ ] 会写 test 级 fixture（含 setup/teardown）、worker 级 fixture、auto fixture，会覆盖/包装内置 fixture；
- [ ] 能说出内置 fixture 的作用域（哪些 worker 级、哪些 test 级）及 `request` 与页面共享 cookie 的事实；
- [ ] 掌握三层隔离：context 自动隔离、服务端数据靠唯一命名、执行顺序不依赖；
- [ ] 会用 `test.step` 组织长测试；知道 serial 不推荐、test lock 是精准替代；
- [ ] 理解「失败重建 worker」对状态共享的影响。

## 官方文档

- [Fixtures](https://playwright.dev/docs/test-fixtures) — 自定义/覆盖/worker/auto/执行顺序
- [Parallelism](https://playwright.dev/docs/test-parallel) — worker、fullyParallel、serial、locks、shard、数据隔离
- [Test API reference](https://playwright.dev/docs/api/class-test) — test/describe/hooks/step/注解全量
- [Best Practices · Make tests as isolated as possible](https://playwright.dev/docs/best-practices)

上一章：[自动等待与断言](./04-auto-waiting-and-assertions.md) ｜ 下一章：[playwright.config 逐项精讲](./06-configuration.md)。
