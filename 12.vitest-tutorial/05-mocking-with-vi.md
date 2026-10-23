# 第 5 章：Mock：隔离而不造假

> mock 是测试里最强也最危险的工具：用对了，毫秒级隔离外部世界；用错了，造出「所有测试通过但系统无法运行」的假象（路线图原文）。这一章按 `vi.fn` → `vi.spyOn` → `vi.mock` → 清理纪律 → fake timers 的顺序，把每个工具的能力与代价讲清楚，最后给出 mock 边界的判断法则。

## 5.1 先分清三种「测试替身」

日常口语里都叫 mock，严格说有三种，Vitest 对它们的支持方式不同：

| 替身                 | 是什么                                 | Vitest 工具                                 | 配套工程示例                                    |
| -------------------- | -------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| **stub（桩）**       | 只提供假返回值，不关心是否被调用       | 手写对象 / `vi.fn().mockResolvedValue(...)` | 内存仓储 `createInMemoryTaskRepository()`       |
| **spy（间谍）**      | 记录调用参数/次数/返回值，可选替换实现 | `vi.fn()`、`vi.spyOn()`                     | 通知器 `vi.fn(async (_task: TaskRecord) => {})` |
| **mock（模块替身）** | 整个模块被替换                         | `vi.mock()`                                 | 替换 `@/domain/id.js` 的随机 ID 生成            |

第一个判断：**能用手写的真实替身（如内存仓储），就不要用 mock 函数**。内存仓储有真实行为（查重、排序、分页都算真的），测出来的置信度远高于「`mockResolvedValue` 喂什么返回什么」。`vi.fn()` 适合的是「纯交互验证」场景：只关心这个函数有没有被调用、参数对不对（比如通知器）。

## 5.2 vi.fn()：可观察的函数替身

```ts
import { expect, it, vi } from "vitest";

// 创建：可以带默认实现
const taskCreated = vi.fn(async (_task: TaskRecord) => {});

// 交给被测代码使用（依赖注入，见 5.7）
const service = createTaskService({
  repo,
  notifier: { taskCreated, taskTransitioned: vi.fn() },
});
await service.createTask(member, { title: "通知测试" });

// 断言交互
expect(taskCreated).toHaveBeenCalledTimes(1);
expect(taskCreated).toHaveBeenCalledWith(
  expect.objectContaining({ title: "通知测试" }),
);
expect(taskCreated.mock.calls[0]?.[0]?.id).toBe(task.id); // 直接翻调用记录
```

`vi.fn` 记录的一切都挂在 `.mock` 属性上：`mock.calls`（每次调用的参数数组）、`mock.results`（每次的返回/抛出）、`mock.lastCall`。断言匹配器（`toHaveBeenCalledWith` 等）本质是这些记录的语法糖。

定制返回值/实现的阶梯：

```ts
const fn = vi.fn();
fn.mockReturnValue(42); // 固定返回
fn.mockReturnValueOnce(1).mockReturnValueOnce(2); // 前两次分别返回 1、2（按调用顺序消耗）
fn.mockImplementation((x: number) => x * 2); // 真实逻辑
fn.mockResolvedValue({ ok: true }); // 返回 Promise
fn.mockRejectedValue(new Error("boom")); // 返回拒绝的 Promise
fn.mockResolvedValueOnce(a).mockRejectedValueOnce(new Error("第二次失败")); // 先成功后失败
```

`mockResolvedValueOnce` 是测试「重试」「先失败后成功」这类时序行为的利器，第 6 章组件测试用它模拟「服务器拒绝一次」。

TypeScript 细节：`vi.fn()` 的类型参数是**函数类型**（`vi.fn<(v: string) => void>()`），不是参数元组 + 返回值的两个参数——那是旧版签名，v5 会直接报「应有 0-1 个类型参数」。更省事的做法是给实现函数标注类型让 TS 自动推导：`vi.fn(async (_task: TaskRecord) => {})`。

## 5.3 vi.spyOn()：观察真实对象，必要时替换

`vi.spyOn(obj, "method")` 把对象上已存在的方法包成间谍：**默认保留原实现**，只是记录调用；需要时才 `mockImplementation` 替换。

配套工程用它验证「service 传给仓储的参数」而不破坏仓储的真实行为（[test/unit/task-service.test.ts](./example/test/unit/task-service.test.ts)）：

```ts
const repo = createInMemoryTaskRepository(seed);
const findPage = vi.spyOn(repo, "findPage"); // 真实内存仓储照常工作
const { service } = makeService({ repo });

const result = await service.listTasks(member, { page: "2", pageSize: "2" });

expect(result.items).toHaveLength(2); // 行为断言：结果对
expect(findPage).toHaveBeenCalledWith({ offset: 2, limit: 2 }); // 交互断言：参数对
```

这个「行为 + 交互」双断言模式，回答的是两个不同问题：结果对不对？service 有没有正确地把分页参数**翻译**成仓储的语言？只测其一都有盲区。

spyOn 的两个经典陷阱：

- **spy 必须在调用发生前挂上**。`vi.spyOn(repo, "findPage")` 替换的是 `repo` 对象上的属性引用；如果被测代码在别处早已解构（`const { findPage } = repo`），spy 不会生效——这也是第 14 章 FAQ「spyOn 没有记录调用」的最常见根因。
- **spyOn 改的是对象，不是模块**。想替换整个模块的导出用 `vi.mock`（下一节）。

## 5.4 vi.mock()：替换整个模块

`vi.mock(path, factory)` 声明「任何 import 这个路径的代码，拿到的都是 factory 返回的对象」。配套工程用它替换随机 ID 生成器，让断言可预测：

```ts
// test/unit/task-service.test.ts 顶部
vi.mock("@/domain/id.js", () => {
  let n = 0;
  return { generateTaskId: () => `task_test_${++n}` };
});
```

三条铁律：

**1. `vi.mock` 会被提升到文件顶部，先于所有 import 执行。** 这是 ESM 静态 import 与「运行时替换模块」能共存的机制：Vitest 转换代码时把 `vi.mock` 调用挪到文件最前面。推论是 factory 里**不能引用文件里声明的普通变量**（提升后那些变量还没初始化）——需要共享变量时用 `vi.hoisted()`：

```ts
const { mockNow } = vi.hoisted(() => ({ mockNow: new Date("2026-03-10") }));
vi.mock("@/domain/id.js", () => ({
  generateTaskId: () => `id_${mockNow.getTime()}`,
}));
```

**2. Vitest 5 起，`vi.mock` / `vi.unmock` / `vi.hoisted` 必须写在模块顶层。** 塞在 `describe` 或 `it` 回调里会直接抛错（旧版只是警告）。原因还是提升：写在嵌套位置会让读者误以为它在那里执行。确实需要「在测试中途才替换模块」的场景，用不提升的 `vi.doMock()` + 动态 `await import()`。

**3. mock 的范围是「模块的导入出口」，不是模块内部调用。** 如果 `a.ts` 内部函数 `foo()` 调用了同文件的 `bar()`，你 `vi.mock("./a.js")` 只替换了外部导入者看到的 `bar`，`foo` 内部调的仍是真实 `bar`。想只替换模块的一部分导出，用 `importOriginal`：

```ts
vi.mock(import("@/domain/id.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, generateTaskId: () => "task_fixed" }; // 其余导出保持真实
});
```

（`vi.mock(import("..."))` 的写法还能获得路径的类型检查与自动补全，官方推荐。）

第 6 章组件测试将用 `vi.mock` 替换整个 `api-client` 模块——那是「组件世界与网络世界」的边界，也是 mock 的正确站位。

## 5.5 清理纪律：clear / reset / restore 与 Vitest 5 的默认值

三个动词含义不同，官方文档专门警告「测试间必须清理 mock 状态」：

| 方法                   | 清空调用记录 | 清空 Once 队列与实现      | 还原 spyOn 前的原函数     |
| ---------------------- | ------------ | ------------------------- | ------------------------- |
| `vi.clearAllMocks()`   | ✓            | ✗                         | ✗                         |
| `vi.resetAllMocks()`   | ✓            | ✓（实现变回 `undefined`） | ✗                         |
| `vi.restoreAllMocks()` | ✓            | ✓                         | ✓（只对 `vi.spyOn` 生效） |

对应的配置项是 `clearMocks` / `mockReset` / `restoreMocks`（设为 true 即每个测试前自动执行）。

**Vitest 5 的默认值变化：`clearMocks` 现在默认为 `true`**——每个测试开始前自动执行 `vi.clearAllMocks()`，调用记录不再跨测试累计（v4 默认不清，老测试里 `toHaveBeenCalledTimes(2)` 依赖上个测试的残留调用，升级 v5 后会变 1）。配套工程专门写了一个测试钉住这个行为：

```ts
it("Vitest 5 默认 clearMocks：上一个测试的调用记录不会带进这一个", async () => {
  const taskCreated = vi.fn(async (_task: TaskRecord) => {});
  const { service } = makeService({
    notifier: { taskCreated, taskTransitioned: vi.fn() },
  });

  await service.createTask(member, { title: "第一个" });
  expect(taskCreated).toHaveBeenCalledTimes(1);
  await service.createTask(member, { title: "第二个" });
  expect(taskCreated).toHaveBeenCalledTimes(2); // 测试内部的调用都保留；跨测试才会被清
});
```

注意 `clearMocks` 只清**记录**，不清实现：`mockReturnValue` 设定的返回值跨测试仍然生效。所以配套工程仍然遵守两条手动纪律：

- 用了 `vi.spyOn` 的文件，配置或显式调用 `restoreMocks`，避免被 spy 的真实对象带着假实现进入下一个测试；
- 用了 fake timers 的文件，`afterEach(() => vi.useRealTimers())`（见 5.6）。

全局变量与 env 的替身同理：`vi.stubGlobal("__VERSION__", "1.0")` 和 `vi.stubEnv("VITE_ENV", "staging")` **不会自动还原**，要么开 `unstubGlobals` / `unstubEnvs` 配置，要么手动 `vi.unstubAllGlobals()` / `vi.unstubAllEnvs()`。

## 5.6 Fake timers：时间不是常量，是依赖

涉及 `setTimeout`、`Date.now()` 的代码，测试时有两条路：

**路线 A：fake timers（替换全局时钟）**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

describe("fake timers", () => {
  afterEach(() => {
    vi.useRealTimers(); // 必须还原，否则污染同文件后续测试
  });

  it("setSystemTime 冻结 Date，advanceTimersByTime 推进定时器", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
    expect(new Date().toISOString()).toBe("2026-03-10T12:00:00.000Z");

    const spy = vi.fn();
    setTimeout(spy, 60_000);
    vi.advanceTimersByTime(59_999);
    expect(spy).not.toHaveBeenCalled(); // 还差 1ms
    vi.advanceTimersByTime(1); // 恰好触发
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

`vi.useFakeTimers()` 替换的是 `setTimeout`/`setInterval`/`Date` 等一组全局 API（v5 起还包括 `Temporal`）。`vi.advanceTimersByTime` 是同步的——「等 60 秒」的测试瞬间跑完，这就是 fake timers 的价值。相关 API 还有 `vi.runAllTimers()`（跑到没有待执行定时器）、`vi.advanceTimersToNextTimerAsync()`（配合微任务队列的异步版本）。

**路线 B：依赖注入时钟（不碰全局）**

配套工程的 domain 日期函数全部把 `now` 作为参数（[example/src/domain/dates.ts](./example/src/domain/dates.ts)），service 接受 `clock` 依赖：

```ts
// src/services/task-service.ts
export interface TaskServiceDeps {
  repo: TaskRepository;
  notifier: NotificationPort;
  clock?: () => Date; // 默认 () => new Date()，测试注入固定时间
}
```

```ts
// 测试里：既不需要 fake timers，也不需要 afterEach 还原
const service = createTaskService({ repo, notifier, clock: () => FIXED_NOW });
```

两条路线的取舍：**自己写的新代码优先路线 B**（显式依赖，测试零全局副作用，第 4 章的日期边界测试因此能同时跑几十个固定时间点）；**测第三方代码或深度依赖 `Date.now()` 的存量代码用路线 A**。配套工程两条都演示了——包括在同一个测试文件里用 fake timers 验证「不传 clock 时 service 默认读系统时间」的行为（`vi.setSystemTime` + 默认 clock）。

## 5.7 Mock 边界法则：mock 外部依赖，不 mock 被测逻辑

回到路线图的警告：「mock 外部依赖但不要把被测业务逻辑全部 mock 掉」。配套工程的分层给出了可操作的判断：

```text
                    ┌──────────────────────────────────────────┐
被测对象             │ createTaskService（业务规则：查重/权限/状态机）│ ← 永远测真实实现
                    └──────────────────────────────────────────┘
                       ↓ 依赖（端口接口）           ↓ 依赖
测试替身             TaskRepository               NotificationPort
                    ├─ 单元测试：内存仓储（有真实行为）或 vi.fn（纯交互）
                    └─ 集成测试：Drizzle + PGlite（真数据库，第 9 章）
```

三条法则：

1. **mock 站在信任边界上**：网络（fetch/api-client）、随机数/时间（id、clock）、消息通知、第三方服务——这些是你「不信任也不需要验证」的外部世界。边界内侧的代码（service、domain）一律跑真的。
2. **被测对象本身永远不 mock**。如果你发现测试里 `vi.mock` 了被测函数所在的模块，说明测试对象选错了层。
3. **每往下一层，换一种替身策略**：service 单测用内存替身（快、可控），集成测试换真数据库（第 9 章验证内存替身模拟的唯一约束和真 Postgres 行为一致）。两层互为校验，避免「mock 写错了但测试全绿」。

一个反面教材帮你校准直觉：

```ts
// ✗ 过度 mock：把被测逻辑全 mock 了，这个测试只证明 mock 框架能工作
vi.mock("@/services/task-service.js", () => ({
  createTaskService: () => ({
    createTask: vi.fn().mockResolvedValue({ id: "1" }),
  }),
}));
it("createTask works", async () => {
  const service = createTaskService({});
  await expect(service.createTask(member, input)).resolves.toEqual({ id: "1" });
});
```

## 练习

1. 在 `task-service.test.ts` 里给 `transitionStatus` 补一个交互断言：用 `vi.spyOn(repo, "updateStatus")` 验证迁移成功后仓储恰好被调用一次、参数是 `(taskId, "in_progress")`。
2. 写一个测试证明 `mockRejectedValueOnce` 的时序：第一次调用 reject、第二次 resolve，被测函数（自己写一个带重试的 `withRetry`）最终成功。
3. 破坏性实验：把 `vi.mock("@/domain/id.js", ...)` 移到 `describe` 回调内部，运行观察 Vitest 5 的报错信息（顶层强制），再移回顶层。
4. 思考题：为什么通知器适合用 `vi.fn()` 而仓储适合用内存实现？如果反过来（仓储用 `vi.fn()` 喂假数据），哪些真实 bug 会漏网？（要点：仓储的查重/分页/排序行为本身参与业务规则——`createTask` 的 409 依赖 `findByTitle` 的真实语义；`vi.fn` 喂假数据时，「查重逻辑写错」这类 bug 完全测不出来。）

## 本章来源

- Vitest 官方文档：[Mocking](https://vitest.dev/guide/mocking.html)（Cheat Sheet、`vi.mock` 提升与 `importOriginal` 部分替换、spyOn 缓存模式、`vi.stubGlobal`/`vi.stubEnv` 不自动还原、`vi.setSystemTime`）
- Vitest 官方文档：[Mock Functions](https://vitest.dev/guide/mocking-functions)、[Mocking Timers](https://vitest.dev/guide/mocking-timers)（fake timers API 族）
- Vitest 官方文档：[Migrating to Vitest 5.0](https://vitest.dev/guide/migration.html)（`clearMocks` 默认 true、hoisted mocking 必须顶层、fake timers 覆盖 Temporal、类 mock 保留原型方法）
- mock 边界三法则为基于上述机制的工程教学组织

下一章：[06 React Testing Library](./06-react-testing-library.md) —— 按用户可见行为测试 TaskForm。
