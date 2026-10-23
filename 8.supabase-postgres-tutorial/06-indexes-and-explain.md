# 第 6 章：索引与 EXPLAIN——B-tree 的用途、复合索引的顺序，以及“索引不是越多越好”

[上一章](./05-sql-queries.md) · [目录](./README.md) · [下一章](./07-transactions-and-concurrency.md)

种子数据只有十几行，任何查询都是瞬间完成的，你感觉不到索引的存在。本章先往本地数据库里灌入 10 万条任务，然后用 `EXPLAIN` 观察数据库**到底是怎么执行一条查询的**；再根据观察结果添加索引，写成第三份迁移。

核心原则只有一句：**索引服务于具体的查询。先有查询和执行计划，再有索引。**

云端跟做：EXPLAIN 和索引属于 Postgres，本身不需要 Docker。在已有业务云库先看不带 ANALYZE 的 SELECT 计划；大量造数、建删实验索引以及 EXPLAIN ANALYZE 都放到可丢弃的独立实验项目，并考虑计算/存储消耗。`bulk_tasks.sql` 固定依赖 Teamboard 种子里的 Alice/Bob，不是任意云库上的压测脚本。下面的 localhost、migration up 与 reset 是本地路线；云端按第 1、3 章选择实验项目的端点和增量迁移。

## 6.1 索引是什么

把表想象成一本没有目录的书，行按插入顺序散落在各页（Postgres 把表数据叫做 heap，“堆”）。找“负责人是 Bob 的任务”只能一页一页翻——这叫**顺序扫描（Seq Scan）**。

B-tree 索引是一份**按某列排好序的目录**：每个条目是“列的值 → 这行在哪一页”。因为有序，查找某个值只需要沿着树往下走几层，然后顺着叶子节点往后读，就能拿到所有匹配的行，**而且结果天然按该列有序**。

代价是：每插入、删除一行，或修改被索引的列，数据库都要同步维护这份目录。

## 6.2 B-tree 能做什么、不能做什么

Postgres 默认的索引类型就是 B-tree（`create index ... on t (col)` 不写类型时就是它）。它支持：

| 能用索引的写法 | 例子                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| 等值           | `where assignee_id = $1`                                                   |
| 范围           | `where due_on < '2026-11-01'`、`between`                                   |
| 集合           | `where status in ('todo', 'doing')`                                        |
| 空值判断       | `where deleted_at is null`                                                 |
| 排序           | `order by created_at desc`（索引顺序与查询顺序一致或完全相反）             |
| 前缀匹配       | `where slug like 'ac%'`（需要 `C` 排序规则或 `text_pattern_ops` 操作符类） |

通常**用不上**普通 B-tree 索引的写法：

| 写法                                    | 原因                                    | 对策                                                                   |
| --------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| `where lower(email) = $1`               | 索引存的是 `email`，不是 `lower(email)` | 表达式索引：`create index on t (lower(email))`                         |
| `where title like '%菜单%'`             | 前面是通配符，有序目录帮不上忙          | 全文检索或 `pg_trgm` 扩展的 GIN 索引                                   |
| `where created_at::date = '2026-10-01'` | 对列做了转换                            | 改写成范围：`created_at >= '2026-10-01' and created_at < '2026-10-02'` |
| `where status <> 'done'`                | “不等于”通常要扫大部分数据              | 换成 `in (...)`，或部分索引                                            |

### 哪些索引会自动创建

- **主键、唯一约束**：自动创建唯一 B-tree 索引；
- **外键：不会**。被引用的一侧一定有（它必须是主键或唯一列），**引用的一侧（子表）不会自动建**（第 2 章提过）。

查看一张表现有的索引：

```sql
\d public.tasks
-- 或者
select indexname, indexdef from pg_indexes where tablename = 'tasks';
```

此刻 `tasks` 已经有 4 个索引：主键 `tasks_pkey`、`tasks_project_number_key (project_id, number)`、`tasks_id_org_key (id, org_id)`，都来自约束。

## 6.3 准备实验数据

把 [example/supabase/snippets/bulk_tasks.sql](./example/supabase/snippets/bulk_tasks.sql) 复制到你的项目中同样的位置，然后执行：

```bash
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -f supabase/snippets/bulk_tasks.sql
```

它创建一个压测组织 `bigco`（Alice 是 owner，Bob 是 member）、20 个项目（`PAA`…`PAT`），并用 `generate_series` 生成 10 万条任务：状态与优先级循环分布，20% 未指派，其余在 Alice 和 Bob 之间交替，10% 在回收站里。最后执行 `analyze` 更新统计信息。

> 这个文件**不在** `seed.sql` 里：日常 `db reset` 不需要 10 万行数据。下一次 `db reset` 会把它们清掉。**永远不要在任何共享环境执行这类脚本。**

## 6.4 读懂 EXPLAIN

`EXPLAIN` 显示规划器（planner）为查询选择的**执行计划**，不执行查询；`EXPLAIN ANALYZE` 会**真的执行**，并显示每一步的实际行数和耗时。

> **警告**：`EXPLAIN ANALYZE` 会真的执行语句。分析 `insert/update/delete` 时，要包在事务里并回滚：
>
> ```sql
> begin;
> explain analyze delete from public.tasks where ...;
> rollback;
> ```

先看一条“看板第一页”的查询（`PAC` 是压测项目之一）：

```sql
explain analyze
select id, number, title, status, created_at
  from public.tasks
 where project_id = (select id from public.projects where key = 'PAC')
   and deleted_at is null
 order by created_at desc, id desc
 limit 20;
```

为了让计划更好读，下面把子查询替换成具体的项目 id（你本地的 id 可能不同，先用 `select id from public.projects where key = 'PAC';` 查出来）。作者实测的输出（删去了与本节无关的行，你机器上的数字会不同）：

```text
Limit  (cost=2191.49..2191.54 rows=20 width=43) (actual time=5.636..5.647 rows=20 loops=1)
  ->  Sort  (cost=2191.49..2202.65 rows=4465 width=43) (actual time=5.633..5.637 rows=20 loops=1)
        Sort Key: created_at DESC, id DESC
        Sort Method: top-N heapsort  Memory: 19kB
        ->  Bitmap Heap Scan on tasks  (cost=122.71..2072.67 rows=4465 width=43) (actual time=0.700..3.503 rows=5000 loops=1)
              Recheck Cond: (project_id = 6)
              Filter: (deleted_at IS NULL)
              Heap Blocks: exact=1887
              ->  Bitmap Index Scan on tasks_project_number_key  (cost=0.00..121.60 rows=4957 width=0) (actual time=0.469..0.470 rows=5000 loops=1)
                    Index Cond: (project_id = 6)
Planning Time: 0.336 ms
Execution Time: 5.695 ms
```

**从最里层往外读**，每一层叫一个节点：

1. `Bitmap Index Scan on tasks_project_number_key`：用唯一约束带来的索引 `(project_id, number)` 找到这个项目的 5000 行在哪里。它能用，是因为 `project_id` 是这个索引的**第一列**（6.6 节解释为什么这很重要）。
2. `Bitmap Heap Scan`：按页的物理顺序把这 5000 行从表里读出来（读了 1887 个数据页），再用 `Filter` 去掉回收站里的行。
3. `Sort ... top-N heapsort`：为了 `order by created_at desc, id desc`，把 4500 行左右排序，只保留前 20。
4. `Limit`：返回 20 行。

括号里的数字：

| 字段                     | 含义                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `cost=启动..总计`        | 规划器估算的成本，**单位是抽象的**（大致以“读一个数据页”为 1），只用于比较不同计划，不是毫秒 |
| `rows`（cost 里）        | **估计**该节点输出的行数                                                                     |
| `width`                  | 估计每行字节数                                                                               |
| `actual time=首行..末行` | 实际耗时（毫秒），只有 ANALYZE 才有                                                          |
| `rows`（actual 里）      | **实际**输出行数                                                                             |
| `loops`                  | 该节点执行了几次（嵌套循环里的内层节点会执行多次，实际总量要乘以 loops）                     |

**估计行数和实际行数差距很大，是规划器选错计划最常见的原因**，通常是统计信息过期，执行 `analyze 表名;` 后再看。Postgres 18 的输出会把行数显示成带两位小数的形式，还会多出 `Index Searches`、默认显示 `Buffers` 等行；Supabase 目前是 Postgres 17，你看到的格式与上面基本一致。

这条查询花了 5.7 ms。对一条查询来说不算慢——但它为了返回 20 行读了 5000 行、排序了 4500 行。数据再增长十倍，或者每秒有几百个用户刷新看板，这个代价就会显现。

再看“分配给 Bob 的未完成任务，按截止日期排序”：

```sql
explain analyze
select id, title, due_on
  from public.tasks
 where assignee_id = '22222222-2222-4222-8222-222222222222'
   and status <> 'done' and deleted_at is null
 order by due_on
 limit 50;
```

```text
Limit  (cost=4184.81..4184.93 rows=50 width=31) (actual time=19.800..19.818 rows=50 loops=1)
  ->  Sort  (cost=4184.81..4244.76 rows=23980 width=31) (actual time=19.799..19.805 rows=50 loops=1)
        Sort Key: due_on
        Sort Method: top-N heapsort  Memory: 22kB
        ->  Seq Scan on tasks  (cost=0.00..3388.21 rows=23980 width=31) (actual time=0.013..13.820 rows=26672 loops=1)
              Filter: ((deleted_at IS NULL) AND (status <> 'done'::task_status) AND (assignee_id = '2222...'::uuid))
              Rows Removed by Filter: 73342
Execution Time: 19.833 ms
```

`Seq Scan`：读了全部 10 万行，丢掉 7.3 万行（`Rows Removed by Filter`），再排序。没有任何索引能帮它。

## 6.5 先说一句公道话：Seq Scan 不一定是坏事

- **小表**：几百、几千行的表，顺序读完比走索引还快。种子数据上你看到的几乎全是 Seq Scan，这完全正确。
- **要读大部分行时**：如果条件匹配了表中 30% 的行，按索引一行一行跳着读，反而比顺序读整张表慢。规划器会根据统计信息自动选择。

所以，**不要看到 Seq Scan 就加索引**。要问的是：这条查询是否高频？返回的行数是否远小于扫描的行数？耗时是否成为瓶颈？

## 6.6 复合索引：列的顺序决定能服务哪些查询

复合（多列）B-tree 索引按第一列排序，第一列相同再按第二列，依此类推——就像电话簿按“姓、名”排序。

为看板查询设计的索引：

```sql
create index tasks_project_active_created_idx
  on public.tasks (project_id, created_at desc, id desc)
  where deleted_at is null;
```

它能完美服务 `where project_id = ? ... order by created_at desc, id desc limit 20`：先定位到 `project_id = 6` 的那一段，这一段内本来就是按 `created_at desc, id desc` 排好序的，**顺序读出前 20 条就结束**，不需要排序，也不需要读其他行。

设计复合索引的经验顺序：

1. **等值条件的列放最前面**（`project_id = ?`）；
2. **然后是排序列或范围条件列**（`created_at`），排序方向与查询一致；
3. **再加上让排序唯一的列**（`id`），这样游标分页的 `(created_at, id) < (?, ?)` 也能直接在索引上定位。

反过来看，这个索引**服务不了**：

| 查询                                                 | 原因                                                     |
| ---------------------------------------------------- | -------------------------------------------------------- |
| `where created_at > '2026-06-01'`（不带 project_id） | 索引先按 project_id 排序，全表范围内的 created_at 是乱的 |
| `where project_id = ? and deleted_at is not null`    | 部分索引只包含 `deleted_at is null` 的行                 |
| `where project_id = ? order by priority`             | 段内是按 created_at 排序的，不是 priority                |

同理，第 9 章的官方 RLS 文档专门提醒：**一个列只有在 B-tree 索引中处于第一列时，才算被“索引了”**。`memberships` 的主键是 `(org_id, user_id)`，它对“按 user_id 查我加入了哪些组织”几乎没有帮助。

> **Postgres 18 的 skip scan**：Postgres 18 引入了 B-tree 跳跃扫描。当复合索引的前导列取值很少时，规划器可以对每个前导值分别搜索，从而用上非前导列。作者在 Postgres 18 上用索引 `(assignee_id, due_on)` 查询 `where due_on = ?`（`assignee_id` 只有 3 种取值），计划中出现了 `Index Searches: 6`。官方文档同时说明：前导列取值很多时，规划器通常仍会选择顺序扫描。Supabase 当前是 Postgres 17，没有这个能力。**设计索引时依然按“前导列”原则来。**

官方文档还有一句值得记住的话：**多列索引应谨慎使用；多数情况下单列索引就足够了，超过三列的索引很少有用，除非表的使用方式非常固定。**

## 6.7 部分索引

上面的索引带了 `where deleted_at is null`，这是**部分索引**：只为满足条件的行建立条目。

- 回收站里的 10% 行不进入索引，索引更小；
- 查询的 WHERE 必须**包含**（或能推出）同样的条件，规划器才会使用它。所以看板查询里的 `deleted_at is null` 不能省略——或者直接查 `active_tasks` 视图，它自带这个条件。

这正是第 4 章“软删除的代价”的一种缓解手段。

## 6.8 根据查询添加索引：第三份迁移

把常用查询列出来，逐个决定：

| 查询                                                                           | 由谁发起                                 | 索引                                                                    |
| ------------------------------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------- |
| 我加入了哪些组织：`memberships where user_id = auth.uid()`                     | **每一个**请求的 RLS 辅助函数（第 9 章） | `memberships (user_id)`                                                 |
| 看板：某项目未删除任务按时间倒序分页                                           | 前端高频                                 | `tasks (project_id, created_at desc, id desc) where deleted_at is null` |
| 我的任务：按截止日期排序；也服务“移除成员时把其任务的 assignee 置空”的外键查找 | 前端高频 + 外键                          | `tasks (assignee_id, due_on)`                                           |
| RLS 按 `org_id` 过滤任务                                                       | 没有其他条件缩小范围的查询               | `tasks (org_id)`                                                        |
| 任务详情的评论列表；删除任务时级联查找评论                                     | 前端 + 外键                              | `comments (task_id, created_at, id)`                                    |
| 打了某标签的任务；删除标签时级联                                               | 前端 + 外键                              | `task_labels (label_id)`                                                |
| 任务的附件；删除任务时外键检查                                                 | 前端 + 外键                              | `attachments (task_id)`                                                 |

也有**不加**索引的决定，同样要有理由：

| 没加的索引                                   | 理由                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `projects (org_id)`                          | 唯一约束 `(org_id, key)` 已经以 org_id 开头，再建就是**冗余索引**           |
| `labels (org_id)`                            | 同上，`(org_id, name)`                                                      |
| `tasks (created_by)`、`comments (author_id)` | 只在删除用户（`set null`）时用到，非常罕见；删除用户可以接受慢一点          |
| `comments (org_id)`                          | 评论总是先按 `task_id` 定位，RLS 的 org_id 条件只在少量行上作为 Filter 执行 |

最后一条要多说一句：Supabase 官方建议“为策略中用于过滤的每一列建索引”，这是一个很好的**起点**。但如果查询总是先用另一个高选择性的条件把行缩小到几十行，策略条件只是在这几十行上做检查，额外的索引就收益很小。**用 EXPLAIN 验证，而不是机械地照做。**

创建迁移：

```bash
npx supabase migration new query_indexes
```

内容见 [example/supabase/migrations/20261022092000_query_indexes.sql](./example/supabase/migrations/20261022092000_query_indexes.sql)：

```sql
create index memberships_user_id_idx on public.memberships (user_id);

create index tasks_project_active_created_idx
  on public.tasks (project_id, created_at desc, id desc)
  where deleted_at is null;

create index tasks_assignee_due_idx on public.tasks (assignee_id, due_on);
create index tasks_org_id_idx on public.tasks (org_id);
create index comments_task_created_idx on public.comments (task_id, created_at, id);
create index task_labels_label_id_idx on public.task_labels (label_id);
create index attachments_task_id_idx on public.attachments (task_id);
```

这一次用 `migration up` 而不是 `db reset` 应用它——我们想保留刚灌入的 10 万行数据：

```bash
npx supabase migration up
```

```sql
analyze public.tasks;
```

## 6.9 再看执行计划

看板查询：

```text
Limit  (cost=0.42..34.00 rows=20 width=43) (actual time=0.022..0.036 rows=20 loops=1)
  ->  Index Scan using tasks_project_active_created_idx on tasks  (cost=0.42..7714.10 rows=4594 width=43) (actual time=0.020..0.029 rows=20 loops=1)
        Index Cond: (project_id = 6)
Execution Time: 0.050 ms
```

- 没有 `Sort` 节点了：索引本身就是有序的；
- 没有 `Filter: deleted_at IS NULL` 了：部分索引里只有未删除的行；
- `Index Scan` 的估计总成本是 7714（读完整个项目的话），但 `Limit` 只需要前 20 行，实际只读了 20 行就停止；
- 5.7 ms → 0.05 ms。

我的任务：

```text
Limit  (cost=0.29..15.88 rows=50 width=31) (actual time=0.023..0.070 rows=50 loops=1)
  ->  Index Scan using tasks_assignee_due_idx on tasks  (cost=0.29..7550.73 rows=24224 width=31) (actual time=0.022..0.057 rows=50 loops=1)
        Index Cond: (assignee_id = '22222222-2222-4222-8222-222222222222'::uuid)
        Filter: ((deleted_at IS NULL) AND (status <> 'done'::task_status))
Execution Time: 0.084 ms
```

注意这里仍然有 `Filter`：`status` 和 `deleted_at` 不在索引里，要读出行之后再检查。因为符合条件的行很多、`limit 50` 很快就凑满了，这没有问题。如果某个用户的绝大部分任务都已完成，这个 Filter 会丢掉很多行，那时再考虑把条件放进部分索引。**这就是“根据数据分布和执行计划迭代”的含义。**

## 6.10 索引不是越多越好

每多一个索引，都有实实在在的成本：

1. **写入变慢**：每次 `insert` 要往每个索引里插一个条目；`delete` 和更新被索引的列也一样。
2. **更新失去 HOT 优化**：Postgres 有一种“堆内更新”（HOT）优化——如果更新的列都不在任何索引里，新版本行可以不修改索引。给经常更新的列（如 `updated_at`、`status`）加索引会让这个优化失效。
3. **占用空间与内存**：索引要和表数据争夺缓存。作者的实验里，`tasks` 表数据约 20 MB，而加上 5 个“看起来有用”的额外索引之后，所有索引合计 34 MB——**索引比表本身还大**。
4. **规划器的选择变多**，计划更难预测；**备份、恢复、VACUUM 也更慢**。

找出没用的索引：

```sql
select indexrelname as index,
       pg_size_pretty(pg_relation_size(indexrelid)) as size,
       idx_scan
  from pg_stat_user_indexes
 where relname = 'tasks'
 order by pg_relation_size(indexrelid) desc;
```

`idx_scan` 是该索引被使用的次数。在线上环境运行一段时间后，`idx_scan = 0` 且不是用于约束的索引，就是删除的候选。Supabase CLI 也提供了现成的检查：

```bash
npx supabase inspect db index-stats   # 索引使用情况
npx supabase inspect db bloat         # 表与索引膨胀
```

Dashboard 的 Query Performance 页面可以找出最慢、最频繁的查询——从那里开始优化，而不是凭感觉。

## 6.11 在生产环境建索引

普通的 `create index` 会给表加 `SHARE` 锁：建索引期间**所有写入都被阻塞**。大表上可能是几分钟。生产环境应该使用：

```sql
create index concurrently tasks_assignee_due_idx on public.tasks (assignee_id, due_on);
```

`concurrently` 不阻塞写入，代价是：

- 更慢（要扫描两次表）；
- **不能在事务块里执行**。Supabase CLI 会识别迁移中的 `create index concurrently` 并单独执行它；但也意味着如果它失败，同一个迁移文件里前面的语句不会回滚。**把 concurrently 建索引单独放在一个迁移里。**
- 失败时会留下一个标记为 `INVALID` 的索引，需要 `drop index concurrently` 后重试。

第 7 章会解释锁的细节，第 12 章会把它纳入生产发布清单。

## 6.12 本章练习

1. 为第 5 章“打了某标签的所有任务”这条查询写 EXPLAIN，确认它用到了 `task_labels_label_id_idx`。
2. 有人提议给 `tasks.title` 加索引来支持搜索框 `where title like '%菜单%'`。你怎么回应？
3. “我的任务”查询改成只查未完成任务、并且绝大部分任务都已完成。设计一个更合适的索引。
4. 解释为什么 `(project_id, created_at desc, id desc)` 和 `(created_at desc, project_id, id desc)` 对看板查询的效果完全不同。
5. 删除第 3 题创建的索引。在生产环境应该怎样删除？

### 参考答案

1. 在压测数据上 `explain analyze select t.id from public.tasks t join public.task_labels tl on tl.task_id = t.id where tl.label_id = 1;` 能看到对 `task_labels_label_id_idx` 的 Index Scan（种子数据量太小时可能仍是 Seq Scan，这是正常的）。
2. 前导通配符的 LIKE 用不上 B-tree 索引，加了只会增加写入成本。真正的搜索需求应使用 Postgres 全文检索（`tsvector` + GIN 索引）或 `pg_trgm` 扩展的三元组索引。
3. ```sql
   create index tasks_assignee_open_due_idx
     on public.tasks (assignee_id, due_on)
     where status <> 'done' and deleted_at is null;
   ```
   部分索引只包含未完成、未删除的行，又小又不需要 Filter；查询条件必须包含同样的谓词。之后检查原来的 `tasks_assignee_due_idx` 是否还被别的查询（以及外键）需要，再决定是否保留。
4. 前者先定位到项目，再在段内按时间顺序读取前 20 行；后者整个索引按时间排序，要找某个项目的行只能从最新开始扫描所有项目的数据，直到凑够 20 个属于该项目的行——项目越多越慢。等值条件的列应放在最前面。
5. 本地直接 `drop index ...`。生产环境用 `drop index concurrently if exists tasks_assignee_open_due_idx;`（同样不能放在事务里），并且通过一个新迁移完成，而不是修改已执行过的迁移。

## 本章验收

- [ ] 能说出 B-tree 支持的条件类型，以及表达式、前导通配符、类型转换为何用不上普通索引。
- [ ] 知道主键和唯一约束自动建索引、外键引用列不会。
- [ ] 能读懂 `EXPLAIN ANALYZE` 的节点、cost、估计与实际行数、loops，知道 ANALYZE 会真的执行语句。
- [ ] 能解释为什么小表上 Seq Scan 是合理的。
- [ ] 能按“等值列 → 排序/范围列 → 唯一决胜列”设计复合索引，并说出它服务不了哪些查询。
- [ ] 能使用部分索引，并知道查询必须包含相同的条件。
- [ ] 能列出索引的四类成本，用 `pg_stat_user_indexes` 和 `supabase inspect db index-stats` 找出无用索引。
- [ ] 知道生产环境使用 `create index concurrently` 及其限制。

## 官方阅读

- [PostgreSQL：Indexes 全章](https://www.postgresql.org/docs/current/indexes.html)
- [PostgreSQL：Multicolumn Indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html)
- [PostgreSQL：Partial Indexes](https://www.postgresql.org/docs/current/indexes-partial.html)
- [PostgreSQL：Indexes on Expressions](https://www.postgresql.org/docs/current/indexes-expressional.html)
- [PostgreSQL：Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)
- [PostgreSQL：CREATE INDEX（CONCURRENTLY）](https://www.postgresql.org/docs/current/sql-createindex.html)
- [Supabase：Managing indexes](https://supabase.com/docs/guides/database/postgres/indexes)
- [Supabase：RLS performance（为策略列建索引）](https://supabase.com/docs/guides/database/postgres/row-level-security#add-indexes)
- [Supabase CLI：inspect db](https://supabase.com/docs/reference/cli/supabase-inspect-db-index-stats)
