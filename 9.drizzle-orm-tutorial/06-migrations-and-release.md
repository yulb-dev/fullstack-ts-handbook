# 第 6 章：迁移不是“把 schema 再运行一遍”

[上一章](./05-types-and-crud.md) · [目录](./README.md) · [下一章](./07-select-and-pagination.md)

开发时你可以重新创建一个空数据库，但生产数据库已经有客户、订单、索引和正在运行的请求。改变 TypeScript 文件不会改变那些数据；随便重新建表也不可接受。

本章用“给图书增加副标题”练习迁移，再讲数据回填、历史和生产发布。学完要能分辨三个状态：你希望的结构、本地记录的历史、实际数据库的结构。

## 6.1 generate 到底比较什么？

```text
当前 TypeScript schema
        │
        ├─ 与本地历史 snapshot 比较
        │
        ▼
新的 migration.sql + snapshot.json
```

`drizzle-kit generate` 主要根据本地 schema 与已有迁移快照生成差异，不是先把生产库每一张表拉回来。它可以在无需连接数据库的情况下生成 SQL；schema 文件本身不应混入连接副作用。

所以：线上有人手动加列后，你本地 `generate` 不会自动发现所有漂移。历史与实际数据库不一致时，必须调查并按团队流程协调，不能盲目追加“看似没有变更”的迁移。

## 6.2 migrate 又比较什么？

```text
本地 migration.sql 文件
        │
        ├─ 与数据库已应用迁移记录比较
        │
        ▼
执行尚未应用的迁移 → 记录成功历史
```

默认历史表是 `drizzle.__drizzle_migrations`。它不是保存每张业务表的数据，而是告诉迁移工具“哪些迁移已应用”。

本文 RC 版本的迁移按完整文件夹名称匹配，并会处理缺失的迁移；与旧版只根据时间戳挑后续迁移的逻辑不同。不要通过伪造时间、删历史表、改 applied 记录来强行让工具重跑。

`migrate` 不会从当前 schema 动态算出“真正应该修复的所有 SQL”。如果当前代码需要一个列，但没生成对应迁移，执行 migrate 仍可能什么都没做。

## 6.3 先做一个安全的小变更

本节是练习分支，配套最终工程没有增加 subtitle；在自己的练习工程跟做，不必去改最终示例的模型。

在 books 中加：

```ts
subtitle: text();
```

然后生成：

```bash
npx drizzle-kit generate --name=add_book_subtitle
```

打开新的 migration.sql，预期核心内容是：

```sql
ALTER TABLE "books" ADD COLUMN "subtitle" text;
```

因为它允许 NULL，旧行没有副标题也仍合法。检查 SQL 后：

```bash
npx drizzle-kit migrate
```

再用 `.select()` 读取：旧书应该包含 `subtitle: null`，新类型推断是 `string | null`。到这里，你已经完整做了一次“模型变更 → 历史生成 → 数据库执行 → 类型和结果确认”。

重复执行 migrate 通常不会重复添加此列，因为历史表记录了它；这和 `IF NOT EXISTS` 不是同一机制。

## 6.4 为什么生产中不能简单新增必填列？

假设你直接加：

```ts
subtitle: text().notNull();
```

旧行没有值，Postgres 无法凭空猜出副标题。生成 SQL 并不代表能安全应用。类似地：

- 新 UNIQUE 可能遇到旧重复值。
- 新 FK 可能遇到悬空引用。
- 新 CHECK 可能遇到已有非法值。
- 列类型收窄可能导致数据截断或转换失败。

工具知道你想把结构改成什么，不知道应该怎样修正旧业务数据。

## 6.5 正确演进：扩展、回填、收紧

以“必须有可显示副标题”为例：

### 第一阶段：扩展

先允许 NULL，加列。部署能读 `subtitle ?? title` 的兼容代码，新写入方开始写 subtitle。旧应用在短暂共存期仍能工作。

### 第二阶段：回填

为已有数据填写业务合理的值，例如教学中用 title 作为默认显示内容：

```sql
UPDATE books SET subtitle = title WHERE subtitle IS NULL;
```

生产大表不要直接照抄成一次超长 UPDATE。应按主键分批处理，记录进度、支持重试、观察锁和 WAL 压力，避免把回填变成整个系统的长事务。

还要处理旧实例持续写 NULL 的问题：回填完成前确保所有写入方已经兼容，或使用合适的默认/过渡策略。一次“空值数量为零”的检查不能阻止旧代码一分钟后再写入 NULL。

### 第三阶段：验证并收紧

确认写入方、空值、失败率和兼容期后，再设置 NOT NULL。较大表可以评估 `CHECK ... NOT VALID`、`VALIDATE CONSTRAINT` 等 PostgreSQL 分阶段验证策略，但不要在没理解锁行为时把它当作“免费无锁”。

这个过程就是 expand-contract：先让新旧代码都能工作，再迁移数据，最后删除旧兼容路径。

## 6.6 rename 不是 drop + add

如果把 `display_name` 改为 `name`，工具可能询问“新增列还是重命名”。你必须根据业务意图回答。

```sql
ALTER TABLE users RENAME COLUMN display_name TO name;
```

与：

```sql
ALTER TABLE users DROP COLUMN display_name;
ALTER TABLE users ADD COLUMN name text;
```

完全不同，后者会丢失原始名字。即使是正确 RENAME，旧应用还访问旧列时也会报错。滚动发布经常需要先增加新列、兼容双写、回填、切换读取，再删除旧列，而不是一次改名然后赌旧实例已经全部退出。

所以迁移审阅不仅检查“SQL 看起来对”，还要检查“它执行时哪个版本的程序还在运行”。

## 6.7 手写数据迁移如何进入历史？

Drizzle 允许生成 custom migration：

```bash
npx drizzle-kit generate --custom --name=backfill_subtitle
```

然后在新文件夹的 migration.sql 中写受控 SQL：

```sql
UPDATE "books" SET "subtitle" = "title" WHERE "subtitle" IS NULL;
```

再通过同一 migrate 流程执行。适合规模可控的数据修正和暂未直接支持的 DDL。并不是任何长时间导入作业都适合塞进 schema 迁移；规模大的回填通常是独立、可恢复的作业，完成后才应用收紧约束迁移。

本教程不依赖工具“自动执行任意 TS 数据迁移”这种尚不能假设稳定存在的能力。SQL 迁移和应用脚本要分别明确责任。

## 6.8 历史文件为什么要提交？

应版本控制的内容包括 schema、迁移 SQL、snapshot 和 lockfile；不应提交真实连接秘密。

RC 使用：

```text
drizzle/
  <时间戳>_init/
    migration.sql
    snapshot.json
  <时间戳>_next_change/
    migration.sql
    snapshot.json
```

旧稳定 0.x 常见 `0000_*.sql` + `meta/_journal.json` 及 snapshots。只有从旧 0.x 迁移历史升级到 v1 等元数据升级场景，才需要按官方流程使用 `drizzle-kit up` 转换结构并评估历史表变化；直接从本文 RC 开始的新项目不需要先执行它。`up` 是升级迁移元数据，不是“执行业务迁移”的同义词，也不是 rollback。

### 多人协作的基本规则

1. 生成前同步目标分支，了解另一个人改了什么。
2. 不修改已经在共享环境应用的迁移内容。
3. 有冲突时比较 schema、SQL 和 snapshot，不只是让 Git 文本合并无冲突。
4. 用 `npx drizzle-kit check` 检查本地迁移历史兼容性。
5. 在空数据库和带旧数据的数据库上都演练。

RC 的 check 能检查分支迁移的可交换性冲突，但它不是生产数据库漂移扫描，也不证明迁移不会阻塞、不会丢数据、不会破坏应用兼容性。

## 6.9 push、pull 与 generate/migrate 各自适合什么？

| 流程                      | 它做的事                             | 本文选择                   |
| ------------------------- | ------------------------------------ | -------------------------- |
| generate → 审阅 → migrate | 保存可审阅历史，再执行               | 正式学习与发布主线         |
| push                      | 从实时数据库与模型计算差异并直接同步 | 仅作为隔离原型库的可选工具 |
| pull                      | 从实际库 introspect 为 TS schema     | 接入已有数据库时有用       |
| export                    | 输出模型的 SQL DDL                   | 给其他工具消费时有用       |

官方不同页面对 push 的生产使用有不同语境；本教程选择有审阅历史的迁移流程，不把 push 当作新人生产发布默认动作。

本文 RC 的 push/pull 默认可管理所有 schemas。尤其 Supabase 有 auth、storage 等平台对象，必须限制 scope 并确认管理归属；不要把未在 TS 文件中定义的平台表当成应该删除的“多余结构”。`schemaFilter` 等过滤是 introspection/push 的边界，不是限制任意 migration.sql 能执行哪些对象的沙箱。

现有库接入不能直接把初始 CREATE TABLE 当成未执行迁移再运行；需要明确 baseline。`pull --init` 的 RC 流程有专门的初始化历史语义，必须先备份、测试并阅读对应文档，不能在真实库试错。

## 6.10 生产迁移应是独立发布步骤

推荐一条可理解的流水线：

```text
固定依赖版本
→ 类型检查 / 迁移历史检查
→ 空库迁移测试 / 旧数据升级演练
→ 人工或团队审阅 SQL、锁、兼容性
→ 备份和恢复方案确认
→ 单个受控迁移任务
→ 验证结构和关键业务
→ 部署兼容应用、观察
```

用单个任务，而不是每个 Pod、每个云函数冷启动、每次请求都运行 migrate。迁移历史表不能代替发布系统对同时迁移者的串行控制。

应用运行身份只需要业务读写权限；迁移身份持有 DDL 权限。Supabase 场景通常分别使用业务连接与 MIGRATION_DATABASE_URL。连接秘密通过发布环境注入，不放在命令行日志中。

在 RC 的程序化迁移接口中，可以写：

```ts
import { migrate } from "drizzle-orm/node-postgres/migrator";

await migrate(db, { migrationsFolder: "./drizzle" });
```

要把 SQL 文件随发布产物提供，并明确工作目录。本文检查过的程序化 PostgreSQL migrator 会把待应用业务 SQL 放在事务中执行，但迁移表初始化/升级等步骤在外面；不要宣称所有驱动和所有 Kit 版本都具有完全相同的原子边界。

## 6.11 事务不能包住所有 DDL：并发建索引是例外

PostgreSQL 的 `CREATE INDEX CONCURRENTLY` 不能在事务块中运行。Builder 可以声明 `.concurrently()`，不代表你的迁移执行器一定能在正确事务边界执行它。

生产大表要先评估迁移工具是否支持非事务步骤；本文基线不能当作自动兼容承诺。若使用 DBA/外部迁移工具执行并发建索引，必须组织 schema、迁移历史和实际对象的受控协调，不能既手工建了一遍，又让默认 migrator 重建一遍。

建索引失败还可能留下 invalid index，需要检查状态、处理后重试。并发建索引不是“不会耗资源、不会失败、无需验收”。

## 6.12 回滚要回答：你在回滚什么？

至少有三种：

1. **事务回滚**：未提交的 SQL 失败，数据库撤销事务内修改。
2. **应用回滚**：把程序切回旧版本，数据库结构未必改变。
3. **数据库变更回退**：逆向 DDL/补偿数据/恢复备份，需要另一个受控方案。

本教程没有假设 Drizzle Kit 提供通用自动 down/rollback 命令。不要编造 `drizzle-kit rollback`，也不要认为删掉迁移文件会撤销已执行 SQL。

如果刚加 nullable subtitle 导致应用问题，可以先回滚兼容应用；新增列留着通常更安全。之后确认没人使用它，再生成新的前向修复迁移。

如果 DROP 已提交并丢数据，逆向 ADD COLUMN 只能恢复空结构，不能恢复原来的内容。需要备份/PITR 与明确的数据恢复、业务写入丢失窗口评估。

前向修复也不是万能：删除、改类型和错误更新都可能不可逆。生产前应该写出恢复操作、负责人、验证方法和停止发布的条件，而不只写“失败就回滚”。

## 6.13 练习与验收

练习一：先加 nullable subtitle，生成迁移但不执行，然后写一个读取 subtitle 的脚本。会发生什么？

答案：TS 可能通过，因为它根据本地模型推断；数据库会报列不存在。类型系统不能证明迁移已经发布。

练习二：线上手工加了一个索引，本地没有对应历史。`generate` 是否保证会发现并完整对齐？

答案：不保证，它主要比较本地快照；要调查漂移并按选定流程协调。

练习三：为什么“旧应用回滚”前需要确认新数据库向后兼容？

答案：旧代码可能还读被重命名/删除的列或写已经不合法的旧值，代码回滚不自动撤销 DDL。

- [ ] 能解释 generate、migrate、snapshot 和数据库历史表四者关系。
- [ ] 能做一次小迁移并验证旧数据。
- [ ] 能安排新增必填列的分阶段发布。
- [ ] 不会修改已应用历史，不把 check 当生产安全证明。
- [ ] 能区分事务、应用和数据库回滚，并识别不可恢复的数据损失。

官方阅读：[Migrations](https://orm.drizzle.team/docs/migrations)、[Generate](https://orm.drizzle.team/docs/drizzle-kit-generate)、[Migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate)、[Custom Migrations](https://orm.drizzle.team/docs/kit-custom-migrations)、[v1 Changes](https://orm.drizzle.team/docs/v0-v1-changes)、[Postgres CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html)。
