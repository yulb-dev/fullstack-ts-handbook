# Drizzle ORM 从 0 到 1：先设计数据库，再建立类型化的数据访问层

你会 TypeScript，甚至能熟练写 React，但打开后端项目看到 `schema.ts`、外键、迁移和事务时，仍然不知道从哪里开始。这份教程就是为你准备的。

我们不按 API 名称罗列功能，而是从一家小书店的需求出发，一步步经历：设计表、连接 Postgres、建表、插入数据、查询作者与订单、处理库存并发、演进数据库、整理 Service 边界，最后完成能够运行和测试的数据访问层。

全书反复练习一个目标：**把 SQL 数据模型映射到类型化的数据访问层，并理解 ORM 不会替代数据库设计。**

## 先说明版本，避免把两代 API 混在一起

本次核对 npm 与官方文档时：

| 项目                          | 核对结果                                | 本教程使用           |
| ----------------------------- | --------------------------------------- | -------------------- |
| `drizzle-orm` 的 npm `latest` | `0.45.4`                                | 不作为本文代码基线   |
| `drizzle-kit` 的 npm `latest` | `0.31.11`                               | 不作为本文代码基线   |
| 两者的 npm `rc`               | `1.0.0-rc.4`                            | **锁定这个确切版本** |
| Drizzle 官方当前教程          | 使用 `@rc`、`defineRelations` 与 RQB v2 | 按此 API 编写并测试  |

**1.0 RC 是候选版本，不是稳定正式版。** 本教程选择它，是为了与已经更新的官方文档一致；这不等于建议你未经评估直接升级生产系统。

示例使用 Node.js 24、TypeScript 5.9、`pg` 8、Zod 4，以及 `drizzle-orm@1.0.0-rc.4` / `drizzle-kit@1.0.0-rc.4`。配套工程已包含 `package-lock.json`，使用 `npm ci` 可安装锁定的依赖；自己从零搭建时也要保留生成的 lockfile。不要安装无版本 `latest`，再复制本文的 `defineRelations`：那会把 0.x 包与 1.0 文档混用。

如果工作项目必须用稳定 0.x，先阅读第 2、8、6 章的版本提示，再按 0.x 对应 API 适配。特别注意：旧版的 `relations()`、`schema` 初始化、迁移 `meta/_journal.json`，与本文的新写法不同。

## 适合谁，以及不需要先学什么

- 需要会 JavaScript / TypeScript 的函数、对象、数组、Promise 和 `async/await`。
- 不要求你已熟练写 SQL；第 1 章会从表、行、列和 SQL 执行顺序开始。
- 不需要 Python，也不需要先选 Express、NestJS 或 Next.js。
- 本教程中的数据库代码运行在服务端 Node.js，**不是放进浏览器的 React 组件里**。

ORM、Postgres 和 HTTP 服务各自是一个独立学习对象。为了让你真正理解数据层，我们先把它写成可执行脚本与业务函数，不让登录界面、路由或 UI 样式干扰学习。

## 贯穿项目：Inkwell 小书店

书店需要管理顾客、作者、图书、订单和书评：

1. 一位作者能写多本书，一本书也可以由多位作者共同完成。
2. 顾客能创建订单；一张订单里有多个订单行。
3. 下单会扣库存，不能卖出不存在的库存；失败不能留下半张订单。
4. 图书改价后，历史订单仍保留下单时的价格。
5. 顾客支付后可写书评；每人每本书最多一条。
6. 重复点击下单不能生成重复订单；列表不能无限拉取所有数据。

这些要求分别驱动外键、连接表、快照字段、事务、唯一约束和分页。不是先看到 Drizzle 有某个 API，再强行给它找一个用途。

## 完整章节

| 章节                                                            | 本章要解决的实际问题                                                   |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [01 SQL 与 ORM 的心智模型](./01-sql-and-orm.md)                 | 从业务需求画出关系，理解数据库负责什么、ORM 负责什么                   |
| [02 环境搭建与第一条查询](./02-setup-and-first-query.md)        | 从空目录建立 Node + TS + Postgres 项目，生成和执行第一份迁移           |
| [03 Postgres 列与默认值](./03-columns-and-defaults.md)          | 从 SQL 类型映射到 column builders，分清 NULL、省略、默认值和运行时默认 |
| [04 约束、索引与完整数据模型](./04-constraints-and-modeling.md) | 做出七张业务表，解释主外键、复合键、unique、CHECK 和索引选择           |
| [05 类型推断与增删改](./05-types-and-crud.md)                   | 读懂 select/insert shape，实现写入、局部更新、删除和返回投影           |
| [06 迁移：从开发到生产](./06-migrations-and-release.md)         | 理解 schema diff、历史、数据回填、发布顺序和回滚边界                   |
| [07 查询、筛选与分页](./07-select-and-pagination.md)            | 写一个有投影、可选条件、排序和游标的真实列表函数                       |
| [08 关系查询与 SQL Join](./08-relations-and-joins.md)           | 一对多、多对多、连接表字段、嵌套查询，以及 Join 行展开问题             |
| [09 事务、并发与唯一冲突](./09-transactions-and-concurrency.md) | 推演超卖与重复下单，实现原子扣库存、事务回滚、幂等与有限重试           |
| [10 Raw SQL、安全与性能](./10-sql-safety-and-performance.md)    | 参数绑定、动态结构白名单、N+1、无界查询及 EXPLAIN 的使用               |
| [11 连接池、Supabase 与部署](./11-connections-and-supabase.md)  | 选择驱动和连接方式，处理 prepared statements、TLS 与 Serverless 限制   |
| [12 Repository、Service 与测试](./12-boundaries-and-testing.md) | 做有价值的分层，通过真实数据库语义检验业务行为                         |
| [13 综合实战与逐项验收](./13-capstone-and-acceptance.md)        | 完成“浏览 → 下单 → 支付模拟 → 书评”的闭环，逐项验证全部能力            |

建议按顺序跟做。每章都有解释、示例、错误推演、练习及参考答案；读完代码后先尝试预测它会生成什么 SQL，再执行确认。

## 如何运行配套工程

最终工程位于 [example](./example)。第 2 章提供从零搭建过程；这里只给已经读过第 2 章的读者快速入口。

```bash
cd drizzle-orm-tutorial/example
npm ci
npm run typecheck
npm test
```

以上测试使用 **PGlite（基于 Postgres 的嵌入式数据库）**，不要求先安装 Docker。

完整脚本需要一台 Postgres。在单独的本地教学数据库中配置 `.env`，然后运行：

```bash
npm run db:migrate
npm run seed
npm run demo
```

`demo` 会写入订单、扣库存和保存书评，每次使用新幂等键；重复运行会继续消费库存。`seed` 只允许空的教学数据库，不会清空已有数据。不要把这些脚本连接到真实业务库。

配套工程保留两份实际生成的迁移：初始模型与时间戳毫秒精度调整。你从零跟做时可能有更多迁移，这是正常的；不要为了凑相同文件名而改写已应用历史。

## 核心概念逐项验收地图

| 你的验收项                                                     | 教学章节 | 动手成果                                                 |
| -------------------------------------------------------------- | -------- | -------------------------------------------------------- |
| Postgres builders、nullable/default、PK/FK、unique/index/check | 03、04   | 独立设计图书、连接表和订单行，解释每条规则               |
| schema 与 inferred select/insert types，两个 shape 的差别      | 03、05   | 使用 `$inferSelect` / `$inferInsert`，解释字段必填与可选 |
| 关系定义与外键，一对多、多对多、relation query 与 join         | 04、08   | 一个详情查询的两种实现及其结果形状                       |
| CRUD、条件组合、排序分页、返回投影与推断                       | 05、07   | 类型化列表、更新、删除和 `returning`                     |
| transaction、批量写、边界、并发、唯一冲突                      | 09、12   | 不超卖、失败回滚、幂等重放的下单函数                     |
| generate/migrate、diff、历史、生产迁移与回滚                   | 06       | 一份可审阅迁移与 expand-contract 发布方案                |
| raw SQL、参数绑定、防注入、N+1、无界查询                       | 10       | 注入测试、查询次数核对与执行计划分析                     |
| 连接池、Supabase、prepared statements、部署限制                | 11       | 根据运行环境选择连接方式与驱动配置                       |
| Repository / Service 边界、不做无价值包装                      | 12       | 由 Service 持有事务、Repository 接收执行者               |

第 13 章还有更细的验收题和参考判断。把“能解释”与“能运行”都完成，才算学会。

## 官方依据与验证范围

内容基于 Drizzle 官方 [完整文本](https://orm.drizzle.team/llms-full.txt) 中的 PostgreSQL Schema、Column Types、Indexes & Constraints、Select/Insert/Update/Delete、Relations/RQB、SQL、Transactions、Migrations 和 Kit 页面；每章末尾都附上具体来源。

连接部分额外核对了 [Supabase 连接文档](https://supabase.com/docs/guides/database/connecting-to-postgres)、[Postgres.js 限制](https://supabase.com/docs/guides/database/postgres-js)、[node-postgres Pool](https://node-postgres.com/features/pooling) 和 PostgreSQL 官方并发/索引说明。

配套工程已通过 TypeScript 检查、Kit 历史检查和 10 个 PGlite 数据库测试。两个真实 Postgres 并发测试需要显式设置 `TEST_POSTGRES_URL`，默认跳过；不能把单进程 PGlite 测试当作多连接竞争的证明。未进行 Supabase 云端部署验证。

数据库设计、业务分层、生产发布和性能排查是基于上述机制组织的工程教学，不是声称 Drizzle 能自动替你完成这些工作。

准备好了，就从 [第 1 章](./01-sql-and-orm.md) 开始。
