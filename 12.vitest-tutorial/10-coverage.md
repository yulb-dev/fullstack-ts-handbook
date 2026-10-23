# 第 10 章：Coverage 覆盖率——读懂信号，别迷信数字

> 路线图要求：「Coverage 的 statements/branches/functions/lines 含义；覆盖率只是信号，不等于质量」，以及练习 4：「跑一次 coverage，找出分支漏测并解释为什么补的每条测试有价值」。这一章用配套工程的真实报告完成这两项。

## 10.1 四个指标分别在数什么

Vitest 通过 v8（默认，Node 引擎原生覆盖 + AST 重映射）或 istanbul（源码插桩）两种 provider 收集覆盖率。报告里的四列：

| 指标                      | 数的是什么                                                         | 漏测时意味着                             |
| ------------------------- | ------------------------------------------------------------------ | ---------------------------------------- |
| **% Stmts（statements）** | 每条语句是否执行过                                                 | 有代码从没跑过                           |
| **% Branch（branches）**  | 每个分支的两侧是否都走过（if/else、`?.`、`??`、三元、switch case） | **最值钱的一列**：错误路径、边界条件没测 |
| **% Funcs（functions）**  | 每个函数是否被调用过                                               | 有死代码或漏测的入口                     |
| **% Lines（lines）**      | 每行是否执行过（与 Stmts 常接近，统计口径略不同）                  | 同 Stmts                                 |

关键认知：**Branch 是四者中唯一直接指向「行为的另一种可能」的指标**。语句覆盖 100% 而分支覆盖 60%，意味着大量「如果……会怎样」的路径从未被验证——而 bug 恰恰住在这些路径里（第 4 章的边界值思维就是在手动提升分支覆盖的质量）。

## 10.2 生成与阅读报告

安装与 vitest 同版本的 provider（第 2 章已装）：

```bash
npm i -D @vitest/coverage-v8
```

`package.json` 加脚本并运行：

```json
{ "scripts": { "coverage": "vitest run --coverage" } }
```

```bash
npm run coverage
```

终端输出按目录聚合（配套工程实测节选）：

```text
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
 api               |   95.91 |   87.09  |  100    |   95.91 |
  app.ts           |   88.23 |   88.88  |  100    |   88.23 | 50-52
  routes.ts        |   100   |    50    |  100    |   100   | 27-39
 db                |   84.21 |    80    |   83.33 |   82.35 |
  ...repository.ts |   83.33 |   76.47  |   88.88 |   81.48 | 17,50,69-71
 domain            |   100   |   100    |  100    |   100   |
 services          |    92.5 |   92.85  |   88.88 |   95.77 |
  task-service.ts  |   96.77 |   96.29  |  100    |   100   | 28
 ui                |   67.44 |   65.51  |   70    |   66.66 |
  api-client.ts    |     0   |    0     |    0    |    0    | 11-43
-------------------|---------|----------|---------|---------|-------------------
```

阅读方法（顺序很重要）：

1. **先看 `Uncovered Line #s` 列**，它直接给出未覆盖行号；
2. 打开 HTML 报告逐行看：`coverage/index.html`（`reporter: ["text", "html"]` 已在配置里），红/黄底色标出未执行的语句与只走了单侧的分支，比数字直观得多；
3. 对每一处未覆盖问三个问题：**这段代码重要吗？可测吗？值得测吗？**——三个都是才补测试。

配置要点（[example/vitest.config.ts](./example/vitest.config.ts)）：

```ts
coverage: {
  provider: "v8",
  include: ["src/**"],                              // 统计范围：只算源码
  exclude: ["src/api/server.ts", "src/ui/main.tsx"], // 纯组装入口，无分支可测
  reporter: ["text", "html"],
}
```

`include` 尤其重要：默认只统计「测试运行中 import 过的文件」，一个**完全没被测过的模块根本不会出现在报告里**——覆盖率虚高的最常见来源。显式 `include: ["src/**"]` 让漏测模块以 0% 现身（上面的 `api-client.ts` 就是这么暴露的：它被 vi.mock 替换了，真实代码从未执行，第 6 章讲过这是有意的边界选择）。

## 10.3 练习 4 实战：找出分支漏测并解释每条补测的价值

按上面的流程读配套工程的报告，`db/task-repository.ts` 的 Branch 只有 76%，翻 HTML 报告找到三处黄色分支，逐一判断：

**漏测 1：`isUniqueViolation` 的 cause 链循环走不到「深度耗尽」与「非对象」分支。**
值得补吗？值得——这个函数是 409 与 500 的分界线，走错分支用户就看到「服务器内部错误」。补法：直接单测这个纯函数（把它 export 或经由 `repo.insert` 喂一个 `new Error("无关错误")`，断言错误原样上抛而**不是** TaskConflictError）。这条测试的价值陈述：_证明非 23505 的数据库错误不会被误报成业务冲突，运维能凭 500 + requestId 查到真实故障。_

**漏测 2：`findById` 的 `rows[0]` 为 undefined 的分支（未命中路径）。**
已被 `findById 未命中返回 null` 测试覆盖？翻报告确认——如果仍黄，说明 `noUncheckedIndexedAccess` 生成的可选链 `row ? toRecord(row) : null` 的某一侧没走到。价值陈述：_未命中是高频真实路径（404 的来源），必须钉住返回 null 而非抛错。_

**漏测 3：`findPage` 不带 status 过滤的 where=undefined 分支。**
检查后发现已有测试覆盖两侧（带过滤/不带过滤各一条）——若报告显示仍缺一侧，补一条不带 status 的调用即可。价值陈述：_列表页默认视图就是「无过滤」，它坏了影响所有用户的第一屏。_

补完再跑 `npm run coverage`，确认 Branch 上升、且**每条新测试你都能说出它防住的事故**。说不出事故场景的覆盖，就是为了数字好看——那不如不补。

`api-client.ts` 的 0% 则做相反的决定：**不补**。它的真实实现只是 fetch 包装，组件测试有意 mock 了它（第 6 章），要测它应该用 MSW 之类的网络层 mock 或干脆在 e2e 层覆盖。把它加进 `coverage.exclude` 或留着 0% 作为「此模块由更高层负责」的显式记录，都比硬凑单测诚实。

## 10.4 阈值：防倒退的棘轮，不是攀比的 KPI

`coverage.thresholds` 可以让覆盖率不达标时直接退出码非零（CI 红灯）：

```ts
coverage: {
  thresholds: {
    statements: 80,
    branches: 75,
    functions: 80,
    lines: 80,
    // 更精细：按 glob 给不同目录不同要求
    "src/domain/**": { branches: 95 },  // 业务规则层要求更高
  },
}
```

使用纪律：

- **阈值设在当前实际值略下方**，作用是「棘轮」：只许涨不许跌。一上来设 100% 只会逼出无断言的垃圾测试。
- 优先给**高风险目录**（domain、services）设高阈值，UI 入口类目录放宽。
- 覆盖率涨了之后把阈值跟着上调，让它单调递增。

## 10.5 为什么 100% 覆盖率也可能没质量

回到第 1 章的判断标准——「删掉所有断言还剩什么」。三个 100% 覆盖但零价值的例子：

```ts
// 1. 无断言测试：执行了所有语句，什么都没验证
it("covers everything", async () => {
  await service.createTask(member, { title: "t" });
});

// 2. 同义反复断言：验证 mock 自己
const repo = { findById: vi.fn().mockResolvedValue(task) };
expect(await repo.findById("1")).toEqual(task); // 测的是 vi.fn 的实现

// 3. 实现细节断言：重构即碎，行为不变也碎
expect(serviceInternalCallCount).toBe(3); // 用户不关心内部调了几次
```

覆盖率回答的是「代码**被执行**过吗」，测试质量回答的是「行为**被验证**了吗」。前者是后者的必要条件、廉价代理指标，仅此而已。代码评审时值得问的问题永远是：_这条测试失败时，对应什么用户可见的 bug？_

最后一个 v5 冷知识：Vitest 检测到运行在 AI 编码代理环境里时，会自动给 text reporter 加 `skipFull`（100% 的文件不打印）并追加 text-summary——官方在文档里专门写了「Coverage in Agent Environments」一节。覆盖率报告的「读者」也包括自动化代理，这侧面说明 text-summary 这种紧凑格式值得进你的 CI 配置。

## 10.6 排除代码的注释语法（谨慎使用）

确实不可测的代码（如防御性的 `default` 分支）可以用注释排除：

```ts
/* v8 ignore next -- @preserve */
default:
  throw new Error("unreachable");
```

注意 `-- @preserve` 是必需的：TypeScript 经 esbuild 转换会剥掉普通注释，带 `@preserve` 的合法注释才能活到覆盖率收集阶段。滥用 ignore 注释和滥用阈值是同一种病——数字好看了，信号没了。

## 练习

1. 在配套工程跑 `npm run coverage`，打开 `coverage/index.html`，找到 `services/task-service.ts` 的未覆盖行（第 28 行附近），解释它是什么分支、为什么难触发（提示：`canCreateTask` 恒为 true，`PermissionDeniedError` 分支在当前权限模型下不可达——这类「防御性死代码」该删、该测、还是该 ignore？给出你的决定和理由）。
2. 给 `src/domain/**` 配置 95% 的 branches 阈值，跑 `npm run coverage` 验证通过；然后把 `dates.test.ts` 里分段边界的 `it.each` 删掉两组，观察阈值红灯与报错格式。
3. 写一条「无断言测试」把某个 0% 文件的覆盖率刷到 80%，然后在代码评审视角下自我陈述：它防住了什么事故？（这道题的目的是让你亲身体会 10.5。）

## 本章来源

- Vitest 官方文档：[Coverage](https://vitest.dev/guide/coverage)（v8/istanbul provider 对比、`coverage.include/exclude`、thresholds、`@preserve` 注释语法、HTML reporter、Agent 环境的输出调整）
- 四指标含义与「棘轮阈值」实践为基于上述机制的工程教学组织

下一章：[11 稳定性与 CI](./11-stability-and-ci.md) —— 乱序、并发、flaky 排查与失败定位。
