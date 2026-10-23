# Supabase + PostgreSQL 从 0 到 1：把 Supabase 当作“托管 Postgres + 开发部署工具链”来掌握

你会写 React，用过 `supabase.from('todos').select()`，也许还在 Dashboard 里点出过几张表。但当你被问到下面这些问题时，可能还说不清楚：

- 为什么 anon key 可以公开，service role key 却不能？数据库到底靠什么拦住越权？
- 两个用户同时点“加入团队”，为什么席位会超卖？
- 线上为什么不能在 Dashboard 里改表？迁移、种子、reset、push 各管什么？
- Serverless 部署后为什么连接数爆了？连接串到底选哪一条？
- 文件放公开桶“文件名随机就没人能猜到”，问题在哪里？
- 数据库被误删了，能恢复到几分钟前吗？要停机多久？

这份教程就是为你准备的。它不是 API 手册，也不是大纲，而是一条**从连接托管云数据库开始，到设计、权限、部署和恢复**的学习路径。使用 Supabase 托管云数据库时，不需要为了日常开发先在电脑上运行另一套数据库；本地 Supabase 栈作为可选的隔离练习与自动化测试环境保留。

全书贯穿一个目标：**把 Supabase 理解为“一台托管的 PostgreSQL + 建立在它之上的服务 + 把数据库当作代码来开发和部署的工具链”，而不仅仅是一个控制台或 SDK。**

## 先说明版本与时效

本教程编写时依据 Supabase 与 PostgreSQL 的官方文档，并核对了以下版本：

| 项目                              | 版本          | 说明                                                                                            |
| --------------------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| Supabase CLI（npm 包 `supabase`） | `2.121.0`     | 作为项目 devDependency 锁定版本                                                                 |
| `@supabase/supabase-js`           | `2.118.0`     |                                                                                                 |
| `pg`（node-postgres）             | `8.23.1`      | 服务端直连示例                                                                                  |
| 示例本地 PostgreSQL               | 17            | `[db] major_version` 只选择本地版本；云端版本以 `show server_version;` 为准，本地练习时与之对齐 |
| PostgreSQL 官方文档               | 18（current） | 涉及版本差异处（如 PG18 的 B-tree skip scan）均有标注                                           |
| Node.js                           | 20.6+         | 通过 npm 运行 CLI 需要 20+；示例脚本使用 `node --env-file`                                      |

两项**有截止日期的平台变化**，请在阅读第 8 章前留意：

1. **旧版 `anon` / `service_role` key 正在被弃用**（官方说明：2026 年底前），新代码应使用 `sb_publishable_...` 与 `sb_secret_...`。网上以 `eyJ` 开头的长 key 示例是旧写法。
2. **新表不再自动暴露给 Data API**：新项目从 2026 年 5 月 30 日起默认如此，**2026 年 10 月 30 日起对所有现有项目生效**（已有表保留原权限）。本教程的迁移始终显式 `revoke` + `grant`，不受这一变化影响。

CLI 发版频繁，`supabase init` 生成的文件内容会随版本变化；遇到与本文不一致的输出，以你所用版本的官方文档为准。

## 适合谁，需要什么基础

- 会 JavaScript / TypeScript，理解 `async/await`；不要求会 SQL——第 2、5 章从表、行、列和查询的执行顺序讲起。
- **不需要 Python**。所有脚本都是 Node.js。
- **云端主线不要求 Docker、OrbStack 或 Docker Desktop。** 浏览器、Node.js 服务端、psql 和数据库 GUI 都可以直接访问托管服务；先按第 1 章的云端步骤连接。
- 涉及建表、种子数据、故意报错、死锁或批量造数的练习，只在独立的教学项目中执行。已有业务云数据库先做只读检查，不直接套用 Teamboard 迁移。
- 本地 Supabase 栈是可选路线，需要 Docker 兼容运行时。`db pull`、`db diff`、`db dump` 等 CLI 工具在本文的 Docker 工作流中也可能需要本地容器；“操作远端”不等于“工具没有容器依赖”。详见第 3 章。

## 先选择跟做路径

| 你现在的情况                       | 从哪里开始                                                        | 不要做什么                                                       |
| ---------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| 已有 Supabase 托管云数据库         | 第 1 章 1.5 的云端连接与只读检查，再阅读第 3 章的已有项目基线说明 | 不对现有业务库运行示例迁移、seed、reset、清理任务或并发破坏实验  |
| 想在云端从零跟做 Teamboard         | 建一个独立、可丢弃的教学项目，按第 3 章的云端迁移流程推进         | 不把教学项目和生产项目的凭据混用；不删除脚本的本地保护来试生产库 |
| 想练习 reset、自动化测试与本地容器 | 第 1 章 1.6–1.11 的可选本地路线                                   | 不把本地默认密码、地址和配置当成云端配置                         |

云端主线仍按 1–14 章阅读，不省略任何概念：第 2、4、5 章的 SQL 在教学云项目中运行；第 6、7 章的造数与竞争实验使用独立实验环境；第 8–11 章用云项目的 URL、用户登录态和 key 学习授权与 Storage；第 12、13 章完成环境隔离、部署与恢复。第 14 章分别给出云端与本地的验收路径。

## 贯穿项目：Teamboard 团队任务协作

| 需求                                                     | 驱动的知识点                                              |
| -------------------------------------------------------- | --------------------------------------------------------- |
| 用户可以创建组织（团队），组织有唯一 slug 和付费席位上限 | 唯一约束、CHECK、并发下的席位超卖（写偏斜）               |
| 一个用户可以加入多个组织，并有 owner/admin/member 角色   | 多对多连接表、关系属性、按角色的 RLS                      |
| 项目下的任务按 `WEB-1、WEB-2` 连续编号                   | 丢失更新、原子更新、行锁                                  |
| 任务可打多个标签，可指派给本组织成员                     | 多对多、复合外键防止跨租户引用、`ON DELETE SET NULL (列)` |
| 看板分页、我的任务、统计报表                             | JOIN、聚合、CTE、窗口函数、稳定分页、索引与 EXPLAIN       |
| 删除先进回收站，30 天后彻底删除                          | 软删除的代价、软删除与 RLS 的冲突、分批清理               |
| 任务附件与用户头像                                       | Storage 公开/私有桶、对象策略、签名 URL、文件生命周期     |
| 用户只能看到自己组织的数据                               | GRANT、RLS、`security definer` 辅助函数、pgTAP 测试       |
| 本地开发、预览、预发、生产                               | CLI、迁移、种子、环境隔离、CI 部署                        |
| 误删恢复、发布验证、个人数据保护                         | 备份、PITR、恢复演练、验证查询、脱敏                      |

## 完整章节

| 章节                                                                                    | 本章要解决的实际问题                                                                    |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [01 Supabase 心智模型、云端连接与可选本地环境](./01-supabase-mental-model-and-setup.md) | Supabase 由什么组成、请求怎么走；先连接托管云数据库，再按需选择本地栈                   |
| [02 关系模型、主外键与约束](./02-relational-model-and-constraints.md)                   | 表/行/列/键的思维方式；类型选择；NOT NULL、CHECK、UNIQUE、外键；事务的原子性            |
| [03 CLI、config.toml、迁移、种子与 reset](./03-cli-migrations-and-seed.md)              | 让数据库结构像代码一样被保存、审阅、复现；第一份迁移；本地到远程的命令链                |
| [04 表设计与范式](./04-schema-design-and-normalization.md)                              | 从需求到实体；连接表；唯一约束；复合外键；逐个决定外键删除策略；软删除的代价            |
| [05 SQL 查询](./05-sql-queries.md)                                                      | JOIN 与 LEFT JOIN 陷阱、聚合与扇出、子查询与 NOT IN 陷阱、CTE、窗口函数、NULL、稳定分页 |
| [06 索引与 EXPLAIN](./06-indexes-and-explain.md)                                        | 灌入 10 万行，读懂执行计划；B-tree 用途；复合索引顺序；部分索引；索引的成本             |
| [07 事务、隔离级别、锁与并发](./07-transactions-and-concurrency.md)                     | 两个会话制造丢失更新、写偏斜、死锁、锁队列；隔离级别；行锁；重试                        |
| [08 API Key、角色与 GRANT](./08-api-keys-roles-and-grants.md)                           | 五条访问路径的权限模型；publishable 与 secret key；GRANT 与列级权限；服务端三种访问方式 |
| [09 行级安全（RLS）](./09-row-level-security.md)                                        | 启用与否的区别；USING 与 WITH CHECK；按用户、按组织的策略；递归与软删除陷阱；pgTAP 测试 |
| [10 连接方式与连接池](./10-connections-and-pooling.md)                                  | 直连、会话池、事务池、专用池的差异；按运行环境选择；Serverless 配置；SSL                |
| [11 Storage](./11-storage.md)                                                           | 公开与私有桶；对象策略；签名 URL；文件与数据库的一致性；发件箱模式的文件生命周期        |
| [12 环境隔离与部署](./12-environments-and-deployment.md)                                | local / preview / staging / production；凭据按环境分开；CI 部署；生产迁移的安全写法     |
| [13 备份、恢复、验证与数据保护](./13-backup-restore-and-data-protection.md)             | 平台备份的边界；逻辑备份与恢复；恢复演练；迁移前后检查；种子与脱敏；个人数据保护        |
| [14 综合实战与逐项验收](./14-capstone-and-acceptance.md)                                | 从零跑通全部内容；独立完成“任务关注者”功能；逐项自测                                    |

请按顺序学习。每章都有讲解、可执行的示例与真实输出、错误演示、练习与参考答案，以及本章验收清单。**建议先预测结果，再执行验证。**

## 核心概念逐项验收地图

| 验收项                                                               | 主要章节     | 动手成果                                                             |
| -------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------- |
| 目标：把 Supabase 理解为托管 Postgres 及周边开发/部署能力            | 1、8、10、12 | 能画出三条访问路径并标出每段的身份与检查点                           |
| Postgres：关系模型、主外键、约束、事务与隔离级别、锁与并发更新风险   | 2、7         | 触发全部约束错误；两个会话演示丢失更新、写偏斜、死锁、锁队列及其修复 |
| 表设计与范式：连接表、唯一约束、外键删除策略、软删除的成本           | 4            | Teamboard 的 8 张业务表，每个外键都有书面理由                        |
| 索引：B-tree 用途、复合索引顺序、EXPLAIN；索引不是越多越好           | 6            | 建索引前后的执行计划对比；无用索引排查                               |
| SQL：JOIN、聚合、子查询/CTE、窗口函数、NULL、排序与稳定分页          | 5            | 看板、统计、每组前 N、游标分页查询                                   |
| CLI、本地栈、config.toml、migration、seed、reset 与远程部署流程      | 1、3、12     | 5 份迁移、种子数据、CI 工作流                                        |
| 环境隔离：local / preview / production，凭据按环境分开               | 12           | 各环境变量清单；按环境的 CI 密钥；本地脚本的 URL 保护                |
| RLS：启用与未启用、USING / WITH CHECK、按用户/组织限制读写           | 9            | 全部表的策略 + 两个 pgTAP 测试文件（22 个断言）                      |
| Data API / 客户端直连与服务端直连的权限模型；secret key 只能放服务器 | 8            | 客户端、secret key、直连三个演示脚本                                 |
| 连接池、直连、事务池的差异与选择                                     | 10           | 各运行环境的连接选择表与客户端配置                                   |
| Storage：桶、文件权限、生命周期、签名 URL；公开桶不是私有存储        | 11           | 私有/公开桶与策略；上传-登记-签名下载演示；清理队列与清理任务        |
| 备份、恢复、迁移前后验证、种子与个人/线上数据保护                    | 13           | 备份命令、恢复演练步骤、验证查询脚本、脱敏方案                       |

第 14 章对每一项给出了“能解释”的问题和“能做到”的操作。

## 配套工程

最终工程位于 [example](./example)：

```text
example/
├── package.json                 # 锁定 CLI / supabase-js / pg 版本，npm scripts
├── .env.example                 # 环境变量模板（复制为 .env.local）
├── .gitignore                   # 忽略所有 .env*（模板除外）与备份文件
├── supabase/
│   ├── config.toml              # 本地栈配置
│   ├── migrations/              # 5 份迁移：profiles → 核心模型 → 索引 → 权限与 RLS → Storage 与生命周期
│   ├── seed.sql                 # 虚构的种子数据
│   ├── tests/                   # pgTAP：tasks_rls、memberships_rls
│   └── snippets/                # bulk_tasks.sql（性能实验）、post_migration_checks.sql（发布验证）
└── scripts/
    ├── lib/env.mjs              # 读取环境变量、本地 URL 保护
    ├── create-dev-users.mjs     # 通过 Auth 管理 API 创建可登录的本地用户
    ├── rls-demo.mjs             # 客户端视角：grant 与 RLS
    ├── admin-report.mjs         # 服务端 secret key（绕过 RLS）
    ├── pg-direct.mjs            # 服务端直连，以及在事务内扮演用户
    ├── storage-demo.mjs         # 私有桶上传、签名 URL、越权访问
    ├── storage-cleanup.mjs      # 回收站清理 + Storage 清理队列
    └── verify-sql-offline.mjs   # 无 Docker 时的离线 SQL 自检（PGlite）
```

### 云端用户先看这里

第 1 章提供不需要容器的连接步骤和只读查询。`DATABASE_URL` 只放服务器；前端使用 `SUPABASE_URL` 与 publishable key。**本书不会保存任何读者的真实密码、token 或项目凭据。**

配套工程的脚本是教学夹具，不是通用云端运维工具：

| 脚本或命令                              | 云端使用边界                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `dev:users`、`demo:rls`、`demo:storage` | 包含写操作且保留本地 URL 检查；不能仅换云端 `.env` 就运行，不应移除保护去试业务库 |
| `demo:pg`                               | 不写业务数据，但依赖 Teamboard 表及固定 Bob 身份；不能当成已有云库的连通性探针    |
| `demo:admin`                            | 查询依赖 Teamboard 结构；secret key 绕过 RLS，返回的是业务数据，不是通用诊断      |
| `job:cleanup`                           | **永久删除过期任务与文件**，不是只读检查                                          |
| `post_migration_checks.sql`             | 只适用于已安装 Teamboard 模型的环境；普通业务库使用第 1 章的通用查询              |

只想连接已有云库时，不必先安装整个 example 的依赖。它包含用于本地路线的 Supabase CLI 与 PGlite，不是使用托管服务的前提。

### 可选：运行完整本地示例（需要容器运行时）

```bash
cd supabase-postgres-tutorial/example
npm install                     # 首次安装后提交生成的 package-lock.json
npx supabase start
npx supabase db reset
npx supabase test db
cp .env.example .env.local      # 填入 npx supabase status 显示的 Publishable / Secret
npm run dev:users
npm run demo:rls
npm run demo:storage
```

没有容器运行时，也可以先做离线 SQL 自检：

```bash
npm run verify:offline
```

它用 PGlite（以 WebAssembly 运行的 Postgres）加上一个**最小化的 Supabase 桩**（三个 API 角色、`auth.users`、`auth.uid()`、`storage` 的两张表与辅助函数），执行全部迁移和种子数据，并检查约束、触发器、grant、RLS 策略、Storage 策略、清理逻辑，最后用简化版 pgTAP 函数运行 `supabase/tests/` 中的测试文件。它**不能替代**真实的本地栈。

## 验证范围（诚实说明）

**已经验证的：**

- 5 份迁移与种子数据在 PostgreSQL 18（PGlite 0.5.11）上执行成功；`verify:offline` 的 43 项检查全部通过，其中包括两个 pgTAP 测试文件（通过简化版 pgTAP 函数运行）。第 14 章“任务关注者”的参考迁移及其测试也在同样的环境中单独运行通过。
- 第 2、5、6 章展示的查询结果与执行计划来自作者在上述环境中的实际运行（执行计划已删去与讲解无关的行；你机器上的数字会不同，PG17 与 PG18 的输出格式略有差异）。
- 第 9 章“软删除与 SELECT 策略冲突”的报错行为、第 8 章“有 grant 无策略”的行为、`post_migration_checks.sql` 在种子数据上全部返回 0 行。

**没有验证的：**

- 编写环境中没有容器运行时，且 npm 镜像拦截了 `supabase` CLI 包的下载，因此**没有实际运行** Supabase CLI 与本地栈；书中的 CLI 命令、`supabase start` 输出、`config.toml` 内容均依据官方文档整理。
- `scripts/` 下使用 supabase-js 与 node-postgres 的演示脚本已通过语法检查，但**没有对真实的本地栈执行**；书中这些脚本的“预期输出”是根据官方文档描述的行为写出的，个别错误文案可能与实际不同。
- 第 7 章的多会话并发实验需要两个真实连接，PGlite 只有一个连接，**没有在本书环境中执行**；其预期结果依据 PostgreSQL 官方文档对隔离级别与锁的描述。
- 云端连接与跟做路径已补入相关章节，但未使用读者的云项目执行任何连接、查询、迁移、部署或备份恢复；Branching 也未进行实际操作。

请在你的环境中按章节执行，遇到与书中不一致的地方，以实际结果和对应版本的官方文档为准。

## 官方依据

各章末尾列出了具体的官方页面。主要来源：

**Supabase**

- [Architecture](https://supabase.com/docs/guides/getting-started/architecture)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)、[Local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows)、[Database migrations](https://supabase.com/docs/guides/deployment/database-migrations)、[Seeding](https://supabase.com/docs/guides/local-development/seeding-your-database)、[Managing config and secrets](https://supabase.com/docs/guides/local-development/managing-config)
- [API keys](https://supabase.com/docs/guides/api/api-keys)、[Securing your API](https://supabase.com/docs/guides/api/securing-your-api)、[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres)、[Timeouts](https://supabase.com/docs/guides/database/postgres/timeouts)
- [Storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)、[Storage access control](https://supabase.com/docs/guides/storage/security/access-control)、[Serving assets](https://supabase.com/docs/guides/storage/serving/downloads)
- [Managing environments](https://supabase.com/docs/guides/deployment/managing-environments)、[Branching](https://supabase.com/docs/guides/deployment/branching)
- [Database backups](https://supabase.com/docs/guides/platform/backups)、[Backup and restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Deleting data and dropping objects safely](https://supabase.com/docs/guides/database/postgres/data-deletion)
- [Breaking change：新表不再自动暴露给 Data API](https://github.com/orgs/supabase/discussions/45329)

**PostgreSQL**

- [Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)、[Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)、[CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html)
- [Queries](https://www.postgresql.org/docs/current/queries.html)、[LIMIT and OFFSET](https://www.postgresql.org/docs/current/queries-limit.html)、[Window Functions](https://www.postgresql.org/docs/current/tutorial-window.html)
- [Indexes](https://www.postgresql.org/docs/current/indexes.html)、[Multicolumn Indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html)、[Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)
- [Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)、[Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html)

准备好了，就从 [第 1 章](./01-supabase-mental-model-and-setup.md) 的云端连接步骤开始；需要完整本地栈时再进入同章的可选路线。
