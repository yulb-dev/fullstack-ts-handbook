# 第 12 章：综合实战与逐项验收

> 最后一章不引入新概念，做三件事：把全书串成一条质量链、逐项对照路线图阶段 12 的验收清单自检、给出常见报错的排查索引与下一阶段的方向。

## 12.1 一条完整的质量链：改动如何被层层守卫

假设产品需求变更：「done 状态的任务允许直接归档」（当前状态机禁止 done → archived）。跟着这个改动走一遍全书的测试层次，体会每层的分工：

1. **domain 单元测试先红**（第 4 章）：`task-flow.test.ts` 的「done 只能重新打开，不能直接归档」与 4×4 穷举矩阵立刻失败——改动第一秒就有反馈，定位耗时约 3ms。
2. **改状态机表**：`ALLOWED_TRANSITIONS.done` 加上 `"archived"`。domain 测试转绿；`nextStatuses` 与 `canTransition` 的交叉验证测试保证两张「表」不会失配。
3. **service 单元测试**（第 5 章）：`transitionStatus` 的非法迁移测试仍绿（用的是 todo → done 的例子），补一条「done → archived 现在合法且通知器发出 transitioned 事件」——副作用契约同步更新。
4. **API 集成测试**（第 8 章）：「非法迁移 → 422」的矩阵里 done → archived 的用例需要迁移到成功路径断言（200 + 状态正确 + envelope 结构不变）。HTTP 契约的变化被显式审查。
5. **数据库集成测试**（第 9 章）：不需要改——status 是 text 列，约束在应用层。但要意识到这一点本身就是分层的好处：存储层没有重复编码业务规则。
6. **组件测试**（第 6 章）：如果 UI 按 `nextStatuses` 渲染按钮，归档按钮会出现在 done 任务上——补一条「done 任务展示归档按钮并可点击」的 RTL 测试。
7. **覆盖率**（第 10 章）：新分支被上述测试覆盖，`npm run coverage` 确认 branches 没有下降。
8. **稳定性**（第 11 章）：`npm run test:shuffle` 三连绿，CI 全量通过。

整条链上，**每一层只为自己职责内的变化报警**：状态机规则变 → domain 红；HTTP 映射变 → API 红；渲染逻辑变 → 组件红。这就是「快速定位回归」的具体含义。

## 12.2 路线图阶段 12 逐项验收

对照路线图的「核心概念清单」，逐项自检。每项都给出验证方法——**能解释 + 能演示**才算过：

| ☐   | 验收项                                                                        | 怎么验证自己过关                                                                           | 章节       |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------- |
| ☐   | 测试层级 unit / component / integration 及各自成本                            | 说出配套工程三个 project 各自测什么、为什么分页边界不上集成层测                            | 01、03     |
| ☐   | Vitest 配置、environment、setupFiles、mock、vi.fn/spyOn、fake timers、cleanup | 不看文档写出：node/jsdom 双环境配置、setup-component.ts 的两个职责、三种 vi 工具的适用场景 | 03、05、06 |
| ☐   | AAA、边界值、参数化测试、异步断言、错误路径                                   | 现场为一个新纯函数写出含边界与 it.each 的测试，全部断言异步用 await                        | 04         |
| ☐   | RTL 按 role/label/用户可见行为查询                                            | 解释 getBy/queryBy/findBy 的选择规则；指认 TaskForm 测试里为什么没有 testid                | 06         |
| ☐   | 测试隔离：各自的 QueryClient、store、数据集                                   | 演示 A/B 指认测试；说出「新建优于清理」的三条理由                                          | 07、09     |
| ☐   | Fastify app.inject 覆盖请求/响应与插件行为                                    | 说出 inject 与真实监听的差别；演示 hook 行为（401）如何被测试                              | 08         |
| ☐   | mock 边界：mock 外部依赖但不 mock 业务逻辑                                    | 画出 9.4 的三层图；解释为什么组件测试 mock api-client 而不 mock useCreateTask              | 05、09     |
| ☐   | coverage 四指标含义；覆盖率只是信号                                           | 读一次 HTML 报告找出一个 branch 漏测；举一个 100% 覆盖但零价值的测试例子                   | 10         |
| ☐   | 运行稳定性、随机顺序/并发、依赖清理、失败定位                                 | shuffle 三连绿；背出 11.5 的清理清单；用 -t 精确重跑单个失败测试                           | 11         |

「必须完成的动手练习」验收：

| ☐   | 练习                                                               | 完成位置                                                            |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| ☐   | 1. 为 Zod schema、权限判断、分页参数、日期转换、状态迁移写边界测试 | 第 4 章练习 + `test/unit/` 全部 5 个文件（61 个测试）               |
| ☐   | 2. 为表单组件测试必填错误、提交成功、服务器拒绝与 disabled 状态    | 第 6 章练习 + `test/component/task-form.test.tsx`（7 个测试）       |
| ☐   | 3. 为 Fastify API 测试验证错误、响应 schema、鉴权和统一错误处理    | 第 8 章练习 + `test/integration/api-in-memory.test.ts`（19 个测试） |
| ☐   | 4. 跑一次 coverage，找出分支漏测并解释每条补测的价值               | 第 10 章 10.3 节实战                                                |

「通过标准」验收：

| ☐   | 标准                                                    | 验证命令/方法                                                                  |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| ☐   | 测试不依赖执行顺序、不因共享 Query cache/store 互相污染 | `npm run test:shuffle` 三连绿；第 7 章 A/B 指认测试存在                        |
| ☐   | 重要错误分支和权限规则有明确断言                        | 数一数：401/403/404/409/422/400 每条至少一个测试；越权测试含「状态不变」双断言 |
| ☐   | 能用测试快速定位回归，避免过度 mock                     | 走一遍 12.1 的改动演练；能说出内存替身与真库两层如何互为校验                   |

最终的全量验证：

```bash
cd example
npm ci
npm run typecheck     # 零错误
npm test              # 10 files / 105 tests 全绿（unit 61、component 15、integration 29）
npm run coverage      # 报告生成，domain 层 100%
npm run test:shuffle  # 乱序全绿
```

## 12.3 常见报错排查索引

按报错信息检索，跳回对应章节：

| 症状                                                      | 根因                                                             | 处方                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| `document is not defined`                                 | node 环境跑了 DOM 代码                                           | environment 配 jsdom / 检查 projects include（3.2）       |
| `toBeInTheDocument is not a function`                     | jest-dom 匹配器没注册                                            | setupFiles 导入 `@testing-library/jest-dom/vitest`（3.4） |
| 单跑绿、全量红                                            | 共享状态污染                                                     | 第 7 章清单 + shuffle 复现（11.1）                        |
| `Found multiple elements with role...`                    | 上个测试 DOM 残留                                                | setup 文件注册 cleanup（3.4）                             |
| 异步断言有时不生效/警告                                   | `.rejects`/`.resolves` 没 await                                  | v5 直接失败，补 await（4.6）                              |
| `vi.mock` 报「defined outside of the module's top level」 | mock 写在 describe/it 里                                         | 移到顶层；动态场景用 doMock（5.4）                        |
| spyOn 没记录到调用                                        | spy 挂晚了或代码解构了原引用                                     | 调用前挂 spy；别解构被测依赖（5.3）                       |
| mock 调用次数比预期多                                     | v4 → v5 升级后 clearMocks 默认 true 的行为差异，或文件内多次调用 | 理解 clear 语义（5.5）                                    |
| 测试全绿但进程不退                                        | app/db 没 close、挂起的 Promise                                  | 11.5 清理清单                                             |
| Fastify 测试偶发端口错误                                  | 有人用了真 listen                                                | 一律 inject（8.1）                                        |
| 数据库测试报 23505 却没翻译成 409                         | Drizzle rc 错误包在 cause 链里                                   | isUniqueViolation 沿 cause 找（9.3）                      |
| `ERESOLVE ... effect` 装不上依赖                          | drizzle rc 的可选 peer 范围触发 npm bug                          | `.npmrc` legacy-peer-deps（2.2）                          |
| coverage 报告里缺整个文件                                 | 没配 coverage.include，未 import 的文件不统计                    | include: ["src/**"]（10.2）                               |

## 12.4 毕业检查：脱离教程重做一遍

路线图的总规则是「只是跟着教程敲出结果但不能脱离教程重做，不算通过」。合上教程，在空目录里完成以下任务（约 2~4 小时），全部做到即视为掌握阶段 12：

1. 初始化一个 TS 工程，配好 vitest + jsdom + 三个 projects（unit/component/integration）与 `@` 别名；
2. 写一个含至少三条业务规则的纯函数模块（自选：折扣计算 / 排班冲突检测 / 购物车合计），为它写边界值 + 参数化测试；
3. 写一个依赖注入的 service（至少一个端口接口），用 `vi.fn` 与手写内存替身各测一类行为；
4. 用 RTL 测一个带校验的表单组件的四个场景（必填、成功、服务器拒绝、pending disabled）；
5. 起一个最小 Fastify app（一个 POST + 一个 GET），用 inject 测出 200/400/401/404 四种状态与统一错误 envelope；
6. 跑 coverage，找到一个 branch 漏测，补测试并用一句话写下它的价值；
7. `--sequence.shuffle` 三连绿，`afterEach` 清理完备（贴出你的清理清单）。

## 12.5 下一步

- **阶段 13｜Playwright 端到端测试**：本教程验证了「部件与接缝」，e2e 从真实浏览器验证「完整用户旅程」。jsdom 测不到的真实渲染、跨页导航、真实网络延迟都在那里；本仓库对应的教程完成后，TaskDesk Lite 的 `npm run dev` + `npm run api` 组合（vite proxy 已配好）就是现成的 e2e 靶场。
- **Vitest Browser Mode**：把组件测试升级进真实浏览器（第 6 章 6.5 的讨论），学完 Playwright 后成本大幅降低——驱动是同一套。
- **进阶专题**：`expect-type` 类型测试（钉住公共 API 的类型契约）、`bench` 基准测试（性能回归）、快照测试（谨慎使用，第 10 章的同款警告适用：快照 diff 被无脑 accept 时它就不再是测试）、MSW 网络层 mock（替代 `vi.mock(api-client)`，让组件测试吃到真实的 fetch 路径）。

## 本章来源

- 路线图阶段 12 全部验收项与练习要求：[fullstack_tech_stack_learning_roadmap](../docs/roadmap/fullstack_tech_stack_learning_roadmap.pdf)
- Vitest 官方文档：[API](https://vitest.dev/api/)（type testing、bench、快照）、[Guides](https://vitest.dev/guide/)（Browser Mode）
- 排查索引汇总自全书各章实测记录

回到 [教程目录](./README.md)。
