# 第 4 章：编写高质量测试

> 这一章是全书的「基本功」：AAA 结构、断言选型、边界值思维、参数化测试、异步与错误路径。所有示例都来自配套工程 `test/unit/` 下真实通过的测试。路线图的第一个必做练习（为纯逻辑写边界测试）在本章布置。

## 4.1 AAA：让每个测试只讲一件事

AAA 指 **Arrange（准备）→ Act（执行）→ Assert（断言）** 三段结构。它不只是注释模板，而是一种约束：**一个测试只驱动一次行为、只验证一个主题**。看配套工程 [test/unit/task-service.test.ts](./example/test/unit/task-service.test.ts) 里的真实例子：

```ts
it("成功路径：写入仓储、发出通知、返回完整记录（AAA 三段清晰）", async () => {
  // Arrange：把被测对象和它的依赖准备好
  const { service, repo, events } = makeService();

  // Act：驱动一次行为
  const task = await service.createTask(member, {
    title: "  发布 v2  ",
    dueDate: "2026-04-01",
  });

  // Assert：返回值、副作用、持久化状态各验一处
  expect(task).toEqual({
    /* ...完整字段... */
  });
  expect(await repo.findById(task.id)).toEqual(task);
  expect(events).toEqual([{ type: "created", taskId: task.id }]);
});
```

AAA 的价值在失败时体现：测试挂了，你能立刻从「哪一段」定位问题性质——Arrange 挂了是环境问题，Act 挂了是被测代码抛了意外异常，Assert 挂了是行为与承诺不符。

两条推论：

- **一个测试里出现两次 Act 通常应该拆成两个测试**。「创建成功后再迁移状态」不是一个行为，是两个；把它们拆开，失败信息才精确。例外是「行为链本身就是被测对象」的场景（第 8 章有一个 todo → in_progress → done 的完整旅程测试，它验证的正是链路本身）。
- **Assert 可以多处，但应围绕同一主题**。上面例子断言了返回值、仓储、通知三处，但都在回答同一个问题：「创建成功时该发生的都发生了吗？」

## 4.2 测试命名：独立可读的行为描述

测试名会出现在失败输出、CI 报告、watch 界面里，它是给人读的文档。三个规则：

```ts
// 规则 1：描述行为与条件，而不是描述函数名
it("works"); // ✗ 什么都没说
it("member 不能改别人的任务（越权路径必须有明确断言）"); // ✓

// 规则 2：错误路径写清「输入 → 预期结果」
it("pageSize 上限：100 合法，101 拒绝"); // ✓ 边界一目了然

// 规则 3：describe 分组承担上下文，it 不必重复主语
describe("parsePagination", () => {
  it("缺省时返回第 1 页、每页 20 条"); // ✓ 输出显示为 parsePagination > 缺省时…
});
```

Vitest 输出里测试的完整路径是 `describe 名 > it 名`。顺带一个 v5 变化：CLI 的 `-t` 过滤参数现在按 `>` 连接的全名匹配（`vitest -t "math > adds"`），旧版是空格连接——跨段匹配的老命令要改写。

## 4.3 断言选型：toBe / toEqual / toMatchObject 与错误断言

Vitest 的 `expect` 内置 Chai 并兼容 Jest 的匹配器 API。新手最常用的几个及其精确语义：

```ts
// toBe：Object.is 严格相等。用于原始值与「同一个引用」
expect(parsePagination().page).toBe(1);
expect(NaN).toBe(NaN); // Object.is 认为 NaN 等于自身

// toEqual：递归深度相等，忽略 undefined 属性。用于对象/数组的「值相等」
expect(parsePagination({})).toEqual({
  page: 1,
  pageSize: 20,
  offset: 0,
  limit: 20,
});

// toMatchObject：只断言子集。用于「大对象里我关心的字段」
expect(task).toMatchObject({ title: "写周报", status: "todo" });

// toContainEqual / toContain：数组包含（值相等 / 引用或字符串包含）
expect(events).toContainEqual({ type: "created", taskId: task.id });

// 不对称匹配器：嵌入在 toEqual 里做局部宽松匹配
expect(task).toEqual({
  id: expect.stringMatching(/^task_test_\d+$/), // ID 是随机的，只断言形状
  title: "发布 v2",
  // ...
});
```

选择原则：**默认用最严格的可行断言**。`toEqual` 全量对比整个对象，能抓住「多返回了一个不该有的字段」；只在字段确实不可预测（随机 ID、时间戳）时降级为 `toMatchObject` 或混入 `expect.any()` / `expect.stringMatching()`。滥用 `toMatchObject` 的测试抓不住字段泄漏。

错误断言的三种形态（都来自配套工程）：

```ts
// 1) 同步抛错：包一层箭头函数
expect(() => parsePagination({ page: 0 })).toThrow(ZodError); // 按类型
expect(() => parsePagination({ pageSize: 101 })).toThrow(ZodError);
expect(() => relativeTimeLabel(future, now)).toThrow(RangeError);

// 2) 断言错误消息（子串匹配）
expect(() => createTaskSchema.parse({ title: "a".repeat(81) })).toThrow(
  "标题不能超过 80 个字符",
);

// 3) 异步拒绝：.rejects（必须 await，见 4.6）
await expect(service.createTask(member, { title: "   " })).rejects.toThrow(
  ZodError,
);
await expect(service.transitionStatus(member, id, "done")).rejects.toThrow(
  InvalidTransitionError,
);
```

`toThrow` 收字符串时按**子串**匹配。一个 v5 行为变化要留意：`toThrow("")` 现在匹配任何错误（空串是所有字符串的子串），旧版曾把它特殊处理成「消息为空」；要断言消息恰好为空得写 `toThrow(/^$/)`。

需要检查错误的多个属性时，用 try/catch + `expect.unreachable` 的组合（[test/unit/pagination.test.ts](./example/test/unit/pagination.test.ts)）：

```ts
it("非数字字符串拒绝，错误里带字段路径", () => {
  try {
    parsePagination({ page: "abc" });
    expect.unreachable("应当抛出 ZodError"); // 没抛错时在这里失败
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
    expect((error as ZodError).issues[0]?.path).toEqual(["page"]);
  }
});
```

## 4.4 边界值：别只测「看起来正常」的中间值

bug 藏在边界上。系统化的做法是对每个约束条件问三个问题：**刚好合法的值是什么？刚好非法的值是什么？约束之间的组合呢？**

以 `parsePagination` 的约束（`page ≥ 1`、`1 ≤ pageSize ≤ 100`、必须整数）为例，配套工程的边界测试是这么组织的：

```ts
// 上限：刚好合法 + 刚好非法
it("pageSize 上限：100 合法，101 拒绝", () => {
  expect(parsePagination({ pageSize: MAX_PAGE_SIZE }).pageSize).toBe(100);
  expect(() => parsePagination({ pageSize: MAX_PAGE_SIZE + 1 })).toThrow(
    ZodError,
  );
});

// 下限
it("page 下限：1 合法，0 与负数拒绝", () => {
  /* ... */
});

// 类型边界：整数 vs 小数、数字 vs 字符串数字 vs 非数字
it("非整数拒绝：1.5 页不存在", () => {
  expect(() => parsePagination({ page: 1.5 })).toThrow(ZodError);
  expect(() => parsePagination({ pageSize: "10.5" })).toThrow(ZodError);
});
```

日期函数是另一个边界密集区。`relativeTimeLabel` 按「分钟/小时/天」分段，每一段的切换点都要测两侧（[test/unit/dates.test.ts](./example/test/unit/dates.test.ts)）：

```ts
it.each([
  [0, "刚刚"],
  [59_999, "刚刚"], // 59.999 秒仍是「刚刚」
  [60_000, "1 分钟前"], // 恰好 1 分钟进入下一段
  [59 * 60_000, "59 分钟前"],
  [60 * 60_000, "1 小时前"],
  [24 * 60 * 60_000, "1 天前"],
])("距现在 %i ms → %s", (ms, label) => {
  expect(relativeTimeLabel(new Date(NOW.getTime() - ms), NOW)).toBe(label);
});
```

还有一类容易被忽略的边界：**定义域的「不可能输入」**。状态机有 4×4 = 16 种迁移组合，与其挑几个代表，不如穷举交叉验证两张导出表的一致性：

```ts
it("nextStatuses 与 canTransition 对同一张表负责（穷举交叉验证）", () => {
  for (const from of TASK_STATUSES) {
    for (const to of TASK_STATUSES) {
      expect(canTransition(from, to)).toBe(nextStatuses(from).includes(to));
    }
  }
});
```

组合数不大时（几十个以内），穷举比抽样更便宜也更彻底——这正是单元测试层的优势。

## 4.5 参数化测试：test.each 与 test.for

当多个用例共享同一套「输入 → 期望输出」结构，用参数化消除重复。Vitest 提供两个 API：

```ts
// test.each：数组的每一项展开成一个测试
// %i 数字、%s 字符串、%o 对象、%# 用例序号、%% 转义
it.each([
  [0, "刚刚"],
  [60_000, "1 分钟前"],
])("距现在 %i ms → %s", (ms, label) => {
  /* ... */
});

// test.for：更现代的写法，参数自动解构，标题可用 $ 占位符
test.for([
  { from: "todo", to: "in_progress", ok: true },
  { from: "todo", to: "done", ok: false },
  { from: "archived", to: "todo", ok: false },
])("$from → $to 应为 $ok", ({ from, to, ok }) => {
  expect(canTransition(from, to)).toBe(ok);
});
```

选择建议：简单元组用 `it.each`；参数是对象、想在标题里引用字段名时用 `test.for`（`$id` 占位符比 `%s` 的位置对应更不易错）。

一个 v5 变化：`test.for` 标题里插值的字符串**不再带引号**（v4 生成 `case 'a1'`，v5 生成 `case a1`），插值截断长度由新选项 `taskTitleValueFormatTruncate` 控制（默认 40 字符）。如果你的 CI 按测试名过滤，升级 v5 后检查一下模式。

参数化的纪律：**每个参数组仍然是独立的测试**，共享的只是代码模板，不是状态。不要把「第 3 组依赖第 2 组执行过」这种隐式顺序塞进参数化测试——那会在 shuffle 模式下原形毕露（第 11 章）。

## 4.6 异步测试与「必须 await」纪律

异步断言是新手翻车重灾区。核心规则只有一条：**返回 Promise 的断言必须 await**。

```ts
// ✓ 正确
await expect(service.createTask(member, input)).rejects.toThrow(ZodError);
await expect(promise).resolves.toBe(42);

// ✗ 忘了 await —— Vitest 4 只是警告并自动兜底；Vitest 5 直接判测试失败
expect(promise).resolves.toBe(42);
```

v5 把「未 await 的异步断言」从警告升级为失败，是好事：没被 await 的断言可能在测试结束后才执行，失败会记到别的测试头上，甚至被静默吞掉。如果你升级 v5 后一批老测试突然失败并报「assertion was not awaited」，逐条补 `await` 即可，不要回退配置。

异步断言的完整工具箱：

```ts
// resolves / rejects：断言 Promise 的落点
await expect(repo.findById("task_1")).resolves.toMatchObject({
  title: "唯一标题",
});
await expect(service.transitionStatus(member, missing, "done")).rejects.toThrow(
  TaskNotFoundError,
);

// 轮询直到成立（或超时失败）：适合「最终一致」的异步状态
await expect
  .poll(() => store.getState().status, { timeout: 1000 })
  .toBe("ready");
```

`expect.poll` 在 v5 也有行为收紧：**超时未成立现在会失败**（旧版可能在截止后的迟到成功仍然放行），且回调能收到 `AbortSignal` 用于取消未完成的工作。组件测试里更常用 React Testing Library 的 `findBy*` / `waitFor`（它们内部就是轮询 + act 包装，第 6 章）。

超时本身也是断言对象的一部分：默认单测超时 5 秒；确需更长的操作（建库、迁移）在第 3 章的 integration 项目里统一放宽到 30 秒，而不是给单个测试开特例。

## 4.7 生命周期钩子的正确用途

`beforeEach` / `afterEach` / `beforeAll` / `afterAll` 的使用纪律：

- **`beforeEach` 放「每个测试都需要的全新状态」**：新建内存仓储、重置 store（第 7 章）。宁可每个测试重建一次廉价对象，也不要共享一个可变对象再手动清理。
- **`afterEach` 放「必须执行的资源释放」**：`vi.useRealTimers()`（第 5 章）、`app.close()`（第 8 章）、`cleanup()`（setup 文件里已统一处理）。
- **`beforeAll`/`afterAll` 只放真正昂贵且只读的资源**：如 PGlite 建库 + 迁移（第 9 章的顶层 `await` 是它的等价形态）。一旦 `beforeAll` 里创建的对象会被测试修改，隔离性就开始腐烂。
- 钩子里**不要放断言**：钩子失败会把整组测试全部标红，掩盖真正原因。

## 4.8 路线图练习 1：为纯逻辑写边界测试

> 路线要求：「为 Zod schema、权限判断、分页参数、日期转换、状态迁移等纯逻辑写边界测试。」

配套工程已给出完整示范（`test/unit/` 下 5 个文件、61 个测试）。现在轮到你独立补全，全部在 unit 层完成，不需要数据库和网络：

1. **分页**：为 `parsePagination` 补一个测试——`page` 传布尔值 `true` 时的行为（提示：`z.coerce.number()` 会把 `true` coerce 成 `1`，先预测再验证，把实际行为钉进测试）。
2. **权限**：`canUpdateTask` 在「actor 既是 owner 又是 assignee」时只应有一次判断成本——行为上与「只是 owner」无异，补一条防回归测试。
3. **日期**：`dueLabel` 对闰日边界（2028-02-28 → 2028-02-29 → 2028-03-01）给出正确天数。
4. **状态机**：用 `test.for` 重写 4×4 迁移矩阵中所有 `false` 的组合（共 10 个），标题用 `$from → $to 非法`。
5. **Zod schema**：`createTaskSchema` 对 `dueDate: "2026-13-45"`（不存在的月份日期）的行为——先预测：`z.coerce.date()` 会拒绝还是会滚动进位？写完测试验证你的预测。

完成标准：新增测试全部通过、`npm run test:shuffle` 乱序后仍全绿、每条测试名独立可读。

## 练习参考答案要点

1. `z.coerce.number()` 走 `Number(true)` → `1` → 合法。这类「宽容 coercion」正是需要测试钉住的行为：它合理吗？如果业务上不合理，应该在 schema 里显式 `z.number()`（拒绝布尔）而不是依赖 coerce。
2. 测试形如 `expect(canUpdateTask({ id: "u1", role: "member" }, { ownerId: "u1", assigneeId: "u1" })).toBe(true)`——价值不在结果（显然为 true），在于将来有人把 `||` 改成互斥判断时会报警。
3. `dueLabel(new Date("2028-02-29T12:00:00Z"), new Date("2028-02-28T12:00:00Z"))` 应为 `"还有 1 天"`；跨到 3 月同理。日历天差值用 `Date.UTC(y, m, d)` 归零时分秒再相减，天然处理闰日。
4. 10 个非法组合：todo→todo、todo→done；in_progress→in_progress；done→done、done→todo、done→archived；archived→全部 4 个。
5. `new Date("2026-13-45")` 是 Invalid Date，`z.coerce.date()` 会拒绝它（已实测）；同理 `dueDate: ""` 也会被拒绝，因为 `new Date("")` 同样是 Invalid Date，而 `.nullish()` 只放行 `undefined`/`null`。「13 月滚动进位」只发生在 `new Date(2026, 12, ...)` 这类构造器路径上，与字符串解析路径行为不同，值得各钉一条测试。

## 本章来源

- Vitest 官方文档：[Test API](https://vitest.dev/api/)（`describe`/`it`/`test.each`/`test.for`、生命周期钩子、`expect.poll`、`expect.unreachable`）
- Vitest 官方文档：[Assertions](https://vitest.dev/api/expect)（`toBe`/`toEqual`/`toMatchObject`、不对称匹配器、`toThrow` 子串语义）
- Vitest 官方文档：[Migrating to Vitest 5.0](https://vitest.dev/guide/migration.html)（未 await 异步断言直接失败、`expect.poll` 超时失败与 AbortSignal、`toThrow("")` 语义、`testNamePattern` 的 `>` 连接、`test.for` 标题格式变化）

下一章：[05 Mock：隔离而不造假](./05-mocking-with-vi.md) —— `vi.fn` / `vi.spyOn` / `vi.mock` 与 mock 边界。
