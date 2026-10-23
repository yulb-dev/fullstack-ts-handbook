# Vitest 从 0 到 1：为纯函数、React 组件、API 与数据库建立可靠的测试层

你会写 TypeScript，能搭 React 页面，也能用 Fastify 提供 API——但每次改动心里都没底：「这次会不会把别的功能改坏？」这份教程就是来消除这种不确定感的。

我们不罗列 Vitest 的 API 清单，而是围绕一个贯穿项目 **TaskDesk Lite**（迷你任务管理应用），从「为什么测、测什么」出发，一步步建立：纯函数单元测试 → mock 与依赖注入 → React 组件测试 → 测试隔离 → Fastify API 测试 → 真实数据库集成测试 → 覆盖率与稳定性，最后完成综合实战与逐项验收。

本教程对应[全栈技术栈学习路线图](../docs/roadmap/fullstack_tech_stack_learning_roadmap.pdf)的 **阶段 12｜Vitest**，覆盖其全部核心概念清单、四个动手练习与通过标准；完成后可衔接阶段 13（Playwright 端到端测试）。

## 先说明版本基线

编写并验证本教程时的环境（配套工程已通过全部 105 个测试）：

| 项目                     | 版本                | 说明                                                                    |
| ------------------------ | ------------------- | ----------------------------------------------------------------------- |
| Node.js                  | v24（最低 ≥ 22.12） | Vitest 5 的硬性要求                                                     |
| `vitest`                 | 5.0.5               | npm `latest`，本教程代码基线                                            |
| `@vitest/coverage-v8`    | 5.0.5               | 与 vitest 同版本安装                                                    |
| React / React DOM        | 19.x                | 组件测试对象                                                            |
| `@testing-library/react` | 16.x                | 配合 jsdom                                                              |
| Fastify                  | 5.x                 | API 测试对象（`app.inject`）                                            |
| `drizzle-orm`            | 1.0.0-rc.4          | 数据库层，与 [Drizzle 教程](../9.drizzle-orm-tutorial/README.md) 同基线 |
| `@electric-sql/pglite`   | 0.5.x               | WASM 版 Postgres，免安装数据库                                          |

**Vitest 5 有几个与 v3/v4 不同的默认行为**（`clearMocks` 默认开启、未 await 的异步断言直接失败、`vi.mock` 必须在顶层等），网上大量教程仍基于旧版本。本教程全部按 v5 行为编写，遇到版本差异会显式标注。跟做时请锁定 `vitest@^5`，不要混用旧文档的写法。

## 适合谁，需要先会什么

- 需要会：TypeScript 基础（函数、接口、泛型、`async/await`）、npm 基本操作。
- 最好学过本仓库的 [Fastify 教程](../7.fastify-api-tutorial/README.md)与 [Drizzle 教程](../9.drizzle-orm-tutorial/README.md)——第 9、10 章直接测试这两类代码；没学过也能跟，正文会补齐必要背景。
- 不需要：Jest 经验（会顺带讲清 Vitest 与 Jest 的兼容关系）、真实 Postgres、Docker。

## 贯穿项目：TaskDesk Lite

一个单表任务管理应用，规模刚好覆盖全栈测试的所有典型场景：

1. **domain 纯函数**：任务状态机（todo → in_progress → done / archived）、RBAC 权限、分页解析、日期换算、Zod schema——边界值密集，适合单元测试。
2. **service 业务层**：创建任务（查重、截止日期规则）、状态迁移（权限 + 状态机）、列表分页——依赖通过「端口」注入，适合演示 mock 与真实替身的取舍。
3. **Fastify API**：统一错误 envelope、requestId、鉴权 hook——用 `app.inject()` 不占端口测完整个 HTTP 边界。
4. **React 表单**：React Hook Form + Zod 校验、提交中 disabled、服务器错误展示——用 React Testing Library 按用户可见行为测试。
5. **Postgres 数据库**：唯一约束、事务回滚、并发竞态——用 PGlite 跑真实 SQL 语义，这些是 mock 永远测不到的。

## 完整章节

| 章节                                                        | 本章要解决的实际问题                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [01 为什么要测试，测试什么](./01-why-testing-and-vitest.md) | 建立测试思维：验证可观察的承诺；unit / component / integration 三层各自证明什么、成本如何  |
| [02 环境搭建与第一个测试](./02-setup-and-first-test.md)     | 从空目录到 `npm test` 跑绿：安装、文件命名约定、watch 模式、读懂测试输出                   |
| [03 配置与测试环境](./03-config-and-environments.md)        | `vitest.config.ts`、environment（node/jsdom）、setupFiles 与 globalSetup、多 projects 分层 |
| [04 编写高质量测试](./04-writing-tests.md)                  | AAA 结构、断言选型、边界值、`test.each` 参数化、异步与错误路径断言                         |
| [05 Mock：隔离而不造假](./05-mocking-with-vi.md)            | `vi.fn` / `vi.spyOn` / `vi.mock`、mock 清理纪律、fake timers、时间依赖注入                 |
| [06 React Testing Library](./06-react-testing-library.md)   | 按 role/label 查询、user-event 交互、测试必填错误 / 提交成功 / 服务器拒绝 / disabled       |
| [07 测试隔离](./07-test-isolation.md)                       | 每个测试自己的 QueryClient、状态 store、数据集；识别并消除跨测试污染                       |
| [08 Fastify app.inject](./08-fastify-inject.md)             | app factory、不监听端口测请求/响应、鉴权 hook、统一错误处理、并发竞态                      |
| [09 数据库集成测试](./09-database-integration.md)           | PGlite + 真实迁移、唯一约束、事务回滚、清表隔离；mock 边界怎么划                           |
| [10 Coverage 覆盖率](./10-coverage.md)                      | 四个指标的含义、生成与解读报告、阈值的正确用法、为什么 100% ≠ 质量                         |
| [11 稳定性与 CI](./11-stability-and-ci.md)                  | 顺序无关、乱序检验、并发、flaky 排查、失败定位、CI 最低配置                                |
| [12 综合实战与逐项验收](./12-capstone-and-acceptance.md)    | 路线图四个动手练习逐一完成，对照阶段 12 验收清单自检，衔接阶段 13                          |

建议按顺序跟做：每章的正文代码都出自配套工程 [example](./example) 的对应文件，章末有练习；先自己写，再看参考思路。

## 如何运行配套工程

最终工程位于 [example](./example)，已包含全部章节的成品代码与 105 个测试。

```bash
cd 12.vitest-tutorial/example
npm ci
npm test          # 10 个测试文件、105 个测试，全部通过
npm run coverage  # 覆盖率报告
npm run test:shuffle  # 乱序执行，验证测试互相独立
```

数据库测试使用内存 PGlite，不需要安装 Postgres 或 Docker。

## 核心概念逐项验收地图（对照路线图阶段 12）

| 路线图验收项                                                                  | 教学章节   | 动手成果                                                |
| ----------------------------------------------------------------------------- | ---------- | ------------------------------------------------------- |
| 测试层级 unit / component / integration 及各自成本                            | 01、03     | 三个 Vitest projects 分层运行，解释每层证明什么         |
| Vitest 配置、environment、setupFiles、mock、vi.fn/spyOn、fake timers、cleanup | 03、05、06 | 完整的 `vitest.config.ts` + setup 文件 + 各类 mock 实战 |
| AAA、边界值、参数化测试、异步断言、错误路径                                   | 04         | 分页/日期/状态机的边界测试，`test.each` 全矩阵          |
| React Testing Library：role/label/用户可见行为优先                            | 06         | TaskForm 的七个行为测试，不碰实现细节                   |
| 测试隔离：各自的 QueryClient、store、数据集                                   | 07、09     | 污染演示 + 隔离方案；数据库清表与独立库                 |
| Fastify `app.inject` 覆盖请求/响应与插件行为                                  | 08         | 19 个 API 测试：鉴权、校验、越权、并发、requestId       |
| Mock 边界：mock 外部依赖而非业务逻辑                                          | 05、09     | service 单测用替身，集成测试保留真实数据库              |
| Coverage 四指标含义；覆盖率只是信号                                           | 10         | 跑通报告、找出分支漏测、解释每条补充测试的价值          |
| 运行稳定性、随机顺序/并发、依赖清理、失败定位                                 | 11         | shuffle 全绿、资源清理纪律、flaky 排查清单              |

**四个必做练习**（路线要求）分别在第 4、6、8、9、10 章布置，第 12 章汇总验收。

## 官方依据与验证范围

内容基于 Vitest 官方文档（vitest.dev）的 Getting Started、Features、Configuring Vitest、Mocking、Coverage、Browser Mode / Component Testing 与 **Migrating to Vitest 5.0** 页面，以及 React Testing Library、Fastify、Drizzle ORM 各自官方文档；每章末尾附具体来源。

配套工程在 Node v24.21 / npm 11 环境实测：`tsc --noEmit` 零错误，105 个测试（unit 55 / component 15 / integration 35）全部通过，coverage 与 `--sequence.shuffle` 均验证可运行。未在浏览器模式（Browser Mode）与真实多连接 Postgres 下验证——第 6、9 章会说明这两处的边界与替代方案。

准备好了，就从 [第 1 章](./01-why-testing-and-vitest.md) 开始。
