# 第 11 章：稳定性与 CI——让测试值得被信任

> 路线图通过标准：「测试不依赖执行顺序」「能用测试快速定位回归」。一个偶尔误报的测试套件比没有测试更糟——团队会开始无视红灯。这一章解决顺序无关、并发、flaky 排查、失败定位，最后给出 CI 的最低配置与日常工作流。

## 11.1 顺序无关是纪律，shuffle 是检验

「测试不依赖执行顺序」不靠自觉，靠两样东西：**隔离设计**（第 7、9 章：新建优于清理）与**乱序检验**。

Vitest 默认按文件内声明顺序执行测试。`sequence.shuffle` 把顺序打乱：

```bash
# CLI 方式（配套工程的 npm run test:shuffle）
npx vitest run --sequence.shuffle

# 或写进配置（也可只在 CI 里开）
test: {
  sequence: { shuffle: true },
}
```

shuffle 能暴露的问题类型：

- 测试 B 依赖测试 A 创建的数据（共享仓储/数据库没清）；
- 测试依赖「上一个测试留下的 mock 实现」（Vitest 5 的 `clearMocks` 默认清记录但**不清实现**，`mockReturnValue` 会跨测试存活——需要时开 `mockReset`）；
- `test.each` 参数组之间有隐式时序。

建议把 shuffle 跑进 CI 的独立步骤：本地开发保持默认顺序（失败可复现、好排查），CI 每天/每 PR 乱序跑一次抓隐藏依赖。配套工程 `npm run test:shuffle` 连跑三次应当全绿——现在就试。

## 11.2 并发的三个层级，别混为一谈

| 层级             | 机制                                      | 默认   | 注意                                                                                   |
| ---------------- | ----------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| 文件之间         | 多 worker 进程（`pool`，默认 forks）      | ✓ 并行 | 文件级隔离由 Vitest 保证；共享**外部**资源（同一个真实数据库文件、同一个端口）仍会互踩 |
| 同文件内测试之间 | `test.concurrent` / `describe.concurrent` | ✗ 串行 | 显式开启才并行；共享文件内状态的测试千万别开                                           |
| 分片（多机器）   | `--shard=1/2` + `--merge-reports`         | ✗      | 大仓库 CI 提速用，本教程规模用不到                                                     |

`test.concurrent` 适合「纯计算、无共享状态」的测试提速；一旦测试里有 module 级变量、数据库写入、fake timers，并发就是自找 flaky。Vitest 5 移除了 `test.sequential` 写法，需要显式退出并发时用 `concurrent: false` 选项。并发测试里断言必须用测试上下文的 `expect`（`it.concurrent("...", async ({ expect }) => ...)`），否则失败会记错测试。

对配套工程的现实建议：三个 projects 的文件级并行已经让全量测试跑进 3 秒，**不需要**再开测试级并发。并发是优化工具，不是默认美德。

## 11.3 flaky（偶发失败）排查清单

同一个 commit，时红时绿，就是 flaky。纪律：**先找根因，最后才考虑 retry**——`test.retry` 会把症状盖住，让真正的竞态长到生产环境。按命中率排查：

1. **真实时间**：断言里出现 `Date.now()`、`new Date()` 与固定值比较？→ 注入 clock 或 fake timers（第 5 章）。特别注意「跨分钟/跨天/跨时区」时刻跑 CI 才复现的 flaky——那是日期边界 bug 的信号，不是测试问题。
2. **真实网络**：测试打到了真实 API？→ mock 到网络边界（第 6 章）或起本地替身。
3. **共享可变状态**：单跑绿、全量跑红？→ 第 7 章清单过一遍（QueryClient、store、模块级变量、数据库数据）。
4. **异步等待不足**：`waitFor` 超时边缘？先问「生产环境这个操作要多久」——如果测试里的等待时间在真实延迟的边缘，加大超时只是缓兵之计，检查是不是断言了错误的中间状态。
5. **执行顺序**：shuffle 跑三次能复现吗？能 → 顺序依赖，回到第 7 章。
6. **worker 间外部资源**：两个测试文件写同一个临时文件/端口/数据库文件？→ 每文件独立资源（第 9 章的每文件独立库）。

排查工具：`npx vitest run --reporter=verbose` 看每个测试耗时找异常值；失败后**只重跑失败测试**（watch 模式按 `f`）确认稳定复现路径；`--bail=1` 让第一个失败立刻停下，保护现场。

## 11.4 失败定位：一次只修一个根因

测试红了，按这个流程走（第 2 章练过读输出，这里是完整流程）：

1. **读断言 diff，不是读堆栈开头**。`expected false to be true // Object.is equality` 告诉你期望与实际的差；对象断言的 `+`/`-` diff 直接指出哪个字段变了。
2. **判断三段**：Arrange 里就挂 → 环境/依赖问题；Act 里抛意外异常 → 被测代码或 mock 配置问题；Assert 挂 → 行为与承诺不符（可能是测试错了，也可能是代码真的回归了——先看 git diff）。
3. **最小复现**：`npx vitest run test/unit/pagination.test.ts -t "上限"` 只跑目标文件里名字匹配的测试。注意 v5 的 `-t` 按 `describe > it` 全名匹配（分隔符是 `>`，旧版是空格；跨段模式用 `-t "math.*adds"` 更稳）。
4. **一次只改一处**，改完重跑确认，再看下一个失败。多个测试同红通常是一个根因（比如你刚改了 schema），先修公共依赖。
5. 修不了就**诚实标记**：`it.fails("已知 bug #123：...", ...)`（预期失败，修好后它会反过来提醒你摘标记）或 `it.skip` + issue 链接。禁止无注释的 skip 进主干。

## 11.5 资源清理纪律汇总

全书出现过的「必须清理」清单，集中在这里当 checklist：

```ts
afterEach(() => {
  vi.useRealTimers(); // fake timers（5.6）
  vi.unstubAllGlobals(); // stubGlobal（5.5，或配置 unstubGlobals: true）
  vi.unstubAllEnvs(); // stubEnv（同上）
});

afterEach(async () => {
  await app.close(); // Fastify 实例（8.3）
});

afterAll(async () => {
  await close(); // PGlite 数据库（9.2）
});

// setup 文件里统一处理：RTL cleanup（3.4）
// restoreMocks：用了 spyOn 又 mockImplementation 的项目建议开（5.5）
```

判断标准：**测试创建的每一个「会活过测试结束」的东西，都要有对称的关闭/还原**。进程不退、端口占用、下个文件读到脏数据，都是漏关的症状。Vitest 对未处理错误很敏感（unhandledRejection / uncaughtException 默认都会报出来并影响退出码）——「测试都绿但退出码非零」时，先找漏掉的 Promise 拒绝和没关的资源。

## 11.6 CI 最低配置

GitHub Actions 示例（可直接放进 `.github/workflows/ci.yml`，与本仓库 [API 契约教程](../11.api-contract-tutorial/README.md) 的 CI 思路一致）：

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24 # ≥ 22.12，Vitest 5 硬要求
          cache: npm
          cache-dependency-path: 12.vitest-tutorial/example/package-lock.json
      - name: Install
        run: npm ci
        working-directory: 12.vitest-tutorial/example
      - name: Typecheck
        run: npm run typecheck
        working-directory: 12.vitest-tutorial/example
      - name: Test (with coverage)
        run: npm run coverage
        working-directory: 12.vitest-tutorial/example
      - name: Shuffle run（抓顺序依赖）
        run: npm run test:shuffle
        working-directory: 12.vitest-tutorial/example
      - name: Upload coverage report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: 12.vitest-tutorial/example/coverage
```

要点：

- **typecheck 与 test 分开两步**：类型错误和测试失败的排查思路不同，混在一步里输出难读；
- **`npm ci` 而不是 `npm install`**：锁定 lockfile，CI 与本地依赖完全一致；
- **coverage 失败也上传报告**（`if: always()`），失败排查不用重跑；
- CI 环境存在 `process.env.CI`，`vitest` 自动按 run 模式执行，不会挂在 watch 上；
- 测试规模大了以后再加 `--shard` 分片与 `--merge-reports` 合并，现阶段不需要。

## 11.7 日常工作流建议

写新功能时的循环（小步 TDD 变体）：

1. `npm run test:watch` 挂着，只跑相关文件（watch 模式按模块图自动筛选，或手动指定路径）；
2. 先写一条会失败的测试（描述这次要加的行为）→ 看它红；
3. 写最少的代码让它绿 → 重构（测试保持绿是重构的安全网）；
4. 提交前：`npm run typecheck && npm test`；
5. 每天/每 PR：CI 跑 coverage + shuffle（11.6）。

哪些测试不该追求「秒级以内」：数据库集成测试（建库 + 迁移的固定成本）、未来的 e2e。它们该追求的是**确定性**（同输入同结果）与**并行度**（文件级 worker），而不是把每个测试都压进 10ms——把慢而确定的测试放高层，快而多的测试放低层，正是第 1 章金字塔的成本逻辑。

## 练习

1. 连跑三次 `npm run test:shuffle`，确认全绿；然后故意在 `task-service.test.ts` 里把 `makeService()` 提到 describe 外变成共享实例，再 shuffle 跑——观察「同名任务 → TaskConflictError」测试如何因为上一个测试留下的数据而随机会话失败。复原代码。
2. 给 CI 配置加 `--bail=1`（`vitest run --bail=1`），解释它适合 PR 快速反馈还是 nightly 全量跑。（要点：快速反馈——第一个失败就停，省下排队时间；nightly 要完整失败清单。）
3. 用 `-t` 只跑「并发插入同名任务」这一个测试，写出你的命令。（参考：`npx vitest run --project=integration -t "并发插入"`。）
4. 思考题：为什么「测试全绿但进程不退出」通常是漏了 `app.close()` 或 PGlite 的 `close()`？Vitest 会怎么报告这种情况？（要点：活跃 handle 让事件循环无法结束；Vitest 超时会强杀并提示，退出码非零。）

## 本章来源

- Vitest 官方文档：[Features](https://vitest.dev/guide/features)（watch 模式与模块图重跑、CI 环境自动 run、pool/threads 与 `--no-isolate`、`it.concurrent` 与 Test Context expect、Sharding `--shard`/`--merge-reports`、Unhandled Errors 的默认捕获）
- Vitest 官方文档：[CLI](https://vitest.dev/guide/cli)（`--bail`、`--sequence.shuffle`、`--reporter`、`-t` 过滤）、[Test Filtering](https://vitest.dev/guide/filtering)
- Vitest 官方文档：[Migrating to Vitest 5.0](https://vitest.dev/guide/migration.html)（移除 `test.sequential` 改用 `concurrent: false`、`testNamePattern` 的 `>` 连接）
- flaky 排查清单与 CI 工作流为基于上述机制的工程教学组织

下一章：[12 综合实战与逐项验收](./12-capstone-and-acceptance.md) —— 对照路线图阶段 12 完成最终验收。
