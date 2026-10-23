# 第 5 章：SQL 查询——JOIN、聚合、子查询与 CTE、窗口函数、NULL、排序与稳定分页

[上一章](./04-schema-design-and-normalization.md) · [目录](./README.md) · [下一章](./06-indexes-and-explain.md)

数据模型建好了，现在学习如何把拆散在多张表里的数据重新组合成页面需要的样子。本章所有查询都基于第 4 章的种子数据，**你可以在 psql 里逐条执行并核对结果**。

云端用户：在独立教学项目通过 SQL Editor 或 psql 执行同样的 SQL，不需要 Docker。未初始化 seed 时，空结果不能拿来对照种子输出；已有业务表也不一定与本章结构相同。涉及 `active_tasks` 的查询依赖第 9 章视图，未建视图时按文中的说明改查 tasks 并过滤 deleted_at。

建议先执行（下面的 `\x auto` 只在 psql 中执行，SQL Editor 跳过它）：

```sql
set timezone = 'Asia/Shanghai';   -- 让时间按北京时间显示
\x auto                           -- 宽结果自动竖排
```

为了少写重复的 uuid，记住两个组织：acme = `a0000000-0000-4000-8000-000000000001`，globex = `a0000000-0000-4000-8000-000000000002`。

## 5.1 先理解 SQL 的“执行顺序”

SQL 的书写顺序和逻辑执行顺序不同：

```text
书写顺序：SELECT → FROM → JOIN → WHERE → GROUP BY → HAVING → ORDER BY → LIMIT
逻辑顺序：FROM/JOIN → WHERE → GROUP BY → HAVING → SELECT（含窗口函数）→ DISTINCT → ORDER BY → LIMIT/OFFSET
```

这解释了很多“为什么不行”：

```sql
select title, priority * 10 as score from public.tasks where score > 20;
-- ERROR:  column "score" does not exist   (SQLSTATE 42703)
```

`WHERE` 在 `SELECT` 之前执行，那时 `score` 这个别名还不存在。而 `ORDER BY` 在 `SELECT` 之后，所以 `order by score` 是可以的。

## 5.2 JOIN：把拆开的表拼回来

### INNER JOIN：只保留两边都匹配的行

“acme 组织里未删除的任务，带上项目编号和负责人名字”：

```sql
select p.key || '-' || t.number as code, t.title, t.status, pr.display_name as assignee
  from public.tasks t
  join public.projects p on p.id = t.project_id
  join public.profiles pr on pr.id = t.assignee_id
 where t.org_id = 'a0000000-0000-4000-8000-000000000001'
   and t.deleted_at is null
 order by p.key, t.number;
```

```text
 code  |       title       | status | assignee
-------+-------------------+--------+----------
 APP-1 | 登录页 UI 走查     | done   | Carol
 APP-2 | 推送通知权限引导   | doing  | Alice
 APP-4 | 崩溃率统计接入     | todo   | Bob
 WEB-1 | 梳理首页信息架构   | done   | Alice
 WEB-2 | 设计导航栏组件     | doing  | Carol
 WEB-3 | 首页首屏性能优化   | todo   | Bob
 WEB-5 | 补充 404 页面文案  | todo   | Bob
(7 rows)
```

acme 有 9 条未删除的任务，这里只有 7 条——`APP-3` 和 `WEB-4` **没有负责人**，`assignee_id` 是 NULL，和 `profiles` 匹配不上，于是被 INNER JOIN 丢掉了。这是一个非常常见的“数据莫名少了”的原因。

### LEFT JOIN：左边全保留，右边没有就补 NULL

```sql
select p.key || '-' || t.number as code, t.title, t.status, pr.display_name as assignee
  from public.tasks t
  join public.projects p on p.id = t.project_id
  left join public.profiles pr on pr.id = t.assignee_id
 where t.org_id = 'a0000000-0000-4000-8000-000000000001'
   and t.deleted_at is null
 order by p.key, t.number;
```

```text
 code  |       title        | status | assignee
-------+--------------------+--------+----------
 APP-1 | 登录页 UI 走查      | done   | Carol
 APP-2 | 推送通知权限引导    | doing  | Alice
 APP-3 | 暗色模式适配        | todo   |
 APP-4 | 崩溃率统计接入      | todo   | Bob
 WEB-1 | 梳理首页信息架构    | done   | Alice
 WEB-2 | 设计导航栏组件      | doing  | Carol
 WEB-3 | 首页首屏性能优化    | todo   | Bob
 WEB-4 | 修复移动端菜单遮挡  | todo   |
 WEB-5 | 补充 404 页面文案   | todo   | Bob
(9 rows)
```

选择规则：**右表的数据“可能没有”时，用 LEFT JOIN**。`tasks → projects` 一定存在（`project_id not null` + 外键），用 JOIN；`tasks → profiles`（负责人）可能为空，用 LEFT JOIN。

### LEFT JOIN 的陷阱：条件写在 WHERE 还是 ON

需求：“列出任务，负责人不是 Bob 的显示名字”。新手常这样写：

```sql
... left join public.profiles pr on pr.id = t.assignee_id
 where t.org_id = '...' and t.deleted_at is null
   and pr.display_name <> 'Bob';
```

结果只剩 4 行：`APP-1 Carol`、`APP-2 Alice`、`WEB-1 Alice`、`WEB-2 Carol`。不仅 Bob 的任务消失了，**没有负责人的任务也消失了**——因为对它们来说 `pr.display_name` 是 NULL，`NULL <> 'Bob'` 的结果是 NULL（不是 true），被 WHERE 过滤掉。这时 LEFT JOIN 实际上退化成了 INNER JOIN。

把条件移到 `ON` 里，意思就变成“只把不是 Bob 的资料拼上来”，任务一行不少：

```sql
... left join public.profiles pr on pr.id = t.assignee_id and pr.display_name <> 'Bob'
```

```text
 code  | assignee
-------+----------
 APP-1 | Carol
 APP-2 | Alice
 APP-3 |
 APP-4 |            ← Bob 的任务还在，只是没拼上名字
 WEB-1 | Alice
 ...（共 9 行）
```

**规则：对 LEFT JOIN 右表的过滤条件，写在 `ON` 里是“过滤要拼接的数据”，写在 `WHERE` 里是“过滤结果行”。** 两者语义不同，根据需求选择。

## 5.3 聚合：COUNT、SUM、GROUP BY、HAVING、FILTER

“每个项目的任务总数、完成数、已指派数、完成率”：

```sql
select p.key,
       count(*) as total,
       count(*) filter (where t.status = 'done') as done,
       count(t.assignee_id) as assigned,
       round(100.0 * count(*) filter (where t.status = 'done') / count(*), 1) as done_pct
  from public.tasks t
  join public.projects p on p.id = t.project_id
 where t.deleted_at is null
 group by p.key
 order by p.key;
```

```text
 key | total | done | assigned | done_pct
-----+-------+------+----------+----------
 API |     4 |    1 |        3 |     25.0
 APP |     4 |    1 |        3 |     25.0
 WEB |     5 |    1 |        4 |     20.0
```

要点：

- `count(*)` 数行数；`count(列)` 只数**该列不为 NULL** 的行——所以 `assigned` 比 `total` 少。
- `filter (where ...)` 是 Postgres 支持的标准写法，比 `sum(case when ... then 1 else 0 end)` 清楚。
- `100.0 * ...`：先乘一个小数，避免整数除法 `1 / 4 = 0`。
- `GROUP BY` 之后，`SELECT` 里只能出现分组列和聚合函数。

`HAVING` 过滤的是**分组之后**的结果：“未完成任务不少于 2 条的负责人”：

```sql
select pr.display_name, count(*) as open_tasks
  from public.tasks t
  join public.profiles pr on pr.id = t.assignee_id
 where t.status <> 'done' and t.deleted_at is null      -- 分组前：过滤行
 group by pr.display_name
having count(*) >= 2                                    -- 分组后：过滤组
 order by open_tasks desc;
```

```text
 display_name | open_tasks
--------------+------------
 Bob          |          4
```

## 5.4 多对多查询与“扇出”陷阱

把每个任务的标签收集成数组：

```sql
select p.key || '-' || t.number as code, t.title,
       coalesce(array_agg(l.name order by l.name) filter (where l.id is not null), '{}') as labels
  from public.tasks t
  join public.projects p on p.id = t.project_id
  left join public.task_labels tl on tl.task_id = t.id
  left join public.labels l on l.id = tl.label_id
 where t.org_id = 'a0000000-0000-4000-8000-000000000001' and t.deleted_at is null
 group by t.id, p.key, t.number, t.title
 order by code;
```

```text
 code  |       title        |   labels
-------+--------------------+------------
 APP-1 | 登录页 UI 走查      | {设计}
 APP-2 | 推送通知权限引导    | {}
 APP-3 | 暗色模式适配        | {}
 APP-4 | 崩溃率统计接入      | {bug}
 WEB-1 | 梳理首页信息架构    | {}
 WEB-2 | 设计导航栏组件      | {设计}
 WEB-3 | 首页首屏性能优化    | {紧急}
 WEB-4 | 修复移动端菜单遮挡  | {bug,紧急}
 WEB-5 | 补充 404 页面文案   | {}
```

`filter (where l.id is not null)` 去掉没有标签时 LEFT JOIN 产生的那一个 NULL；`coalesce(..., '{}')` 让“没有标签”显示为空数组而不是 NULL——前端处理起来更省心。

### 扇出（fan-out）：同时 JOIN 两个一对多，计数会翻倍

“每个任务有几个标签、几条评论”，直觉写法：

```sql
select p.key || '-' || t.number as code,
       count(tl.label_id) as label_count,
       count(c.id) as comment_count
  from public.tasks t
  join public.projects p on p.id = t.project_id
  left join public.task_labels tl on tl.task_id = t.id
  left join public.comments c on c.task_id = t.id
 where t.deleted_at is null
 group by p.key, t.number
having count(tl.label_id) > 0 or count(c.id) > 0
 order by code;
```

```text
 code  | label_count | comment_count
-------+-------------+---------------
 API-2 |           4 |             4      ← 实际是 2 个标签、2 条评论
 APP-1 |           1 |             0
 APP-4 |           1 |             0
 WEB-2 |           1 |             0
 WEB-3 |           1 |             2
 WEB-4 |           2 |             2      ← 实际是 2 个标签、1 条评论
```

`API-2` 有 2 个标签、2 条评论，JOIN 之后变成 2 × 2 = 4 行，两个计数都被放大。**同时 JOIN 两个（或更多）“一对多”关系，行数会相乘。** 修复方法是分别计算，再拼到一起：

```sql
select p.key || '-' || t.number as code,
       (select count(*) from public.task_labels tl where tl.task_id = t.id) as label_count,
       (select count(*) from public.comments c where c.task_id = t.id) as comment_count
  from public.tasks t
  join public.projects p on p.id = t.project_id
 where t.deleted_at is null
   and (exists (select 1 from public.task_labels tl where tl.task_id = t.id)
        or exists (select 1 from public.comments c where c.task_id = t.id))
 order by code;
```

```text
 code  | label_count | comment_count
-------+-------------+---------------
 API-2 |           2 |             2
 APP-1 |           1 |             0
 APP-4 |           1 |             0
 WEB-2 |           1 |             0
 WEB-3 |           1 |             2
 WEB-4 |           2 |             1
```

也可以用 CTE 分别聚合再 JOIN（5.6 节）。用 `count(distinct ...)` 有时能“凑对”，但对 `sum` 之类无效，而且掩盖了问题，不推荐。

## 5.5 子查询

子查询就是嵌在另一条查询里的查询。按返回什么分为三种：

**标量子查询**（返回一个值，可以放在 SELECT 里）：

```sql
select o.slug,
       (select count(*) from public.memberships m where m.org_id = o.id) as members,
       o.seat_limit
  from public.organizations o
 order by o.slug;
```

```text
  slug  | members | seat_limit
--------+---------+------------
 acme   |       4 |          5
 globex |       2 |          3
```

子查询里引用了外层的 `o.id`，这叫**相关子查询**：对外层每一行执行一次（优化器常常能改写成 JOIN）。

**IN 子查询**（返回一列，用于集合判断）：“打了 bug 标签的任务”：

```sql
select title from public.tasks
 where id in (
   select tl.task_id
     from public.task_labels tl
     join public.labels l on l.id = tl.label_id
    where l.name = 'bug'
 )
 order by title;
```

**EXISTS / NOT EXISTS**（只关心“有没有”）：“没有被指派任何任务的人”：

```sql
select display_name
  from public.profiles pr
 where not exists (select 1 from public.tasks t where t.assignee_id = pr.id);
```

```text
 display_name
--------------
 Frank
```

### NOT IN 遇到 NULL：一个必须记住的陷阱

同样的需求，用 NOT IN 写：

```sql
select display_name from public.profiles
 where id not in (select assignee_id from public.tasks);
-- (0 rows)
```

**一行都没有！** 因为 `tasks.assignee_id` 里有 NULL。`x not in (a, b, NULL)` 等价于 `x <> a and x <> b and x <> NULL`，最后一项永远是 NULL（未知），整个表达式就不可能为 true。

**规则：“不在另一个集合里”一律用 `NOT EXISTS`。** 如果非用 `NOT IN`，子查询里必须加 `where assignee_id is not null`。

## 5.6 CTE（WITH）：给中间结果起名字

当查询有多个步骤时，用 `WITH` 把每一步命名，比层层嵌套的子查询好读得多。

“找出未完成任务数高于本组织平均水平的成员”：

```sql
with open_tasks as (
  select org_id, assignee_id, count(*) as n
    from public.tasks
   where status <> 'done' and deleted_at is null and assignee_id is not null
   group by org_id, assignee_id
),
org_avg as (
  select org_id, avg(n) as avg_n
    from open_tasks
   group by org_id
)
select o.slug, pr.display_name, ot.n, round(oa.avg_n, 2) as org_avg
  from open_tasks ot
  join org_avg oa using (org_id)
  join public.organizations o on o.id = ot.org_id
  join public.profiles pr on pr.id = ot.assignee_id
 where ot.n > oa.avg_n
 order by o.slug, ot.n desc;
```

```text
 slug | display_name | n | org_avg
------+--------------+---+---------
 acme | Bob          | 3 |    1.67
```

几点说明：

- `using (org_id)` 是 `on ot.org_id = oa.org_id` 的简写，适用于两边列名相同。
- 从 Postgres 12 起，只被引用一次、没有副作用的 CTE 会被优化器“内联”，性能与子查询相同；需要强制先算出结果时可以写 `as materialized`。
- CTE 还能包含 `insert/update/delete ... returning`，在一条语句里完成多步写入，并且它们在同一个事务里。

## 5.7 窗口函数：分组计算，但不合并行

`GROUP BY` 会把一组行压成一行。窗口函数则**保留每一行**，同时让你看到“这一行在它那一组里的位置或汇总”。语法核心是 `OVER (PARTITION BY ... ORDER BY ...)`：

- `PARTITION BY`：按什么分组（像 GROUP BY，但不合并）；
- `ORDER BY`：组内按什么排序。

### 组内排名

“每个项目内，未完成任务按优先级（1 最高）和截止日期排序”：

```sql
select p.key, t.number, t.title, t.priority, t.due_on,
       row_number() over w as rn,
       rank()       over w as rnk
  from public.tasks t
  join public.projects p on p.id = t.project_id
 where t.deleted_at is null and t.status <> 'done'
window w as (partition by t.project_id order by t.priority, t.due_on nulls last)
 order by p.key, rn;
```

```text
 key | number |         title          | priority |   due_on   | rn | rnk
-----+--------+------------------------+----------+------------+----+-----
 API |      2 | 订单查询接口慢查询排查   |        1 | 2026-10-23 |  1 |   1
 API |      3 | 限流中间件              |        2 |            |  2 |   2
 API |      4 | OpenAPI 文档生成        |        3 | 2026-11-05 |  3 |   3
 APP |      2 | 推送通知权限引导        |        2 | 2026-10-28 |  1 |   1
 APP |      4 | 崩溃率统计接入          |        2 | 2026-10-30 |  2 |   2
 APP |      3 | 暗色模式适配            |        3 | 2026-11-15 |  3 |   3
 WEB |      3 | 首页首屏性能优化        |        1 | 2026-10-24 |  1 |   1
 WEB |      4 | 修复移动端菜单遮挡      |        1 |            |  2 |   2
 WEB |      2 | 设计导航栏组件          |        2 | 2026-10-25 |  3 |   3
 WEB |      5 | 补充 404 页面文案       |        4 |            |  4 |   4
```

`window w as (...)` 定义了一个可复用的窗口；每到一个新项目，编号重新从 1 开始。

三个排名函数的区别（排序值相同时）：

| 函数           | 并列时                                       | 例：分数 9, 7, 7, 5 |
| -------------- | -------------------------------------------- | ------------------- |
| `row_number()` | 强行分出先后（顺序不确定，除非排序完全唯一） | 1, 2, 3, 4          |
| `rank()`       | 并列同名次，后面跳号                         | 1, 2, 2, 4          |
| `dense_rank()` | 并列同名次，后面不跳号                       | 1, 2, 2, 3          |

### 每组前 N 名

“每个项目最紧急的 2 条任务”——窗口函数最常见的用途。窗口函数不能直接写在 WHERE 里（它在 WHERE 之后计算），所以包一层：

```sql
select key, number, title, priority
  from (
    select p.key, t.number, t.title, t.priority,
           row_number() over (
             partition by t.project_id
             order by t.priority, t.due_on nulls last, t.id   -- 最后加 id，保证排序唯一
           ) as rn
      from public.tasks t
      join public.projects p on p.id = t.project_id
     where t.deleted_at is null and t.status <> 'done'
  ) ranked
 where rn <= 2
 order by key, rn;
```

```text
 key | number |         title          | priority
-----+--------+------------------------+----------
 API |      2 | 订单查询接口慢查询排查   |        1
 API |      3 | 限流中间件              |        2
 APP |      2 | 推送通知权限引导        |        2
 APP |      4 | 崩溃率统计接入          |        2
 WEB |      3 | 首页首屏性能优化        |        1
 WEB |      4 | 修复移动端菜单遮挡      |        1
```

### 累计、占比与“上一行”

```sql
-- 每天新建了几条任务、累计多少、距上一个有新任务的日子隔了几天
select created_at::date as day,
       count(*) as created,
       sum(count(*)) over (order by created_at::date) as running_total,
       created_at::date - lag(created_at::date) over (order by created_at::date) as gap_days
  from public.tasks
 where org_id = 'a0000000-0000-4000-8000-000000000001'
 group by created_at::date
 order by day;
```

```text
    day     | created | running_total | gap_days
------------+---------+---------------+----------
 2026-09-10 |       1 |             1 |
 2026-09-18 |       1 |             2 |        8
 2026-09-20 |       1 |             3 |        2
 2026-09-21 |       1 |             4 |        1
 2026-09-22 |       2 |             6 |        1
 2026-09-23 |       1 |             7 |        1
 2026-09-25 |       1 |             8 |        2
 2026-09-26 |       1 |             9 |        1
 2026-09-27 |       1 |            10 |        1
```

- 窗口函数可以作用在聚合结果上：`sum(count(*)) over (...)`。
- `lag(x)` 取上一行的值，`lead(x)` 取下一行。
- 注意 `created_at::date` 依赖会话时区（本章开头设置成了上海时间）；UTC 下 9 月 22 日 14:30（北京时间）仍是同一天，但凌晨的数据就可能被分到前一天。按“用户所在时区的日期”统计时，应写 `(created_at at time zone 'Asia/Shanghai')::date`。

占比：`round(100.0 * count(*) / sum(count(*)) over (), 1)`——空的 `over ()` 表示“整个结果集是一个窗口”：

```text
 key | tasks |  pct
-----+-------+------
 API |     4 | 30.8
 APP |     4 | 30.8
 WEB |     5 | 38.5
```

## 5.8 NULL：三值逻辑

在 SQL 里，比较的结果有三种：true、false、**NULL（未知）**。

```sql
select null = null           as eq,           -- NULL（不是 true！）
       null is null          as is_null,      -- true
       null <> 1             as ne,           -- NULL
       null is distinct from 1 as distinct_from,  -- true
       coalesce(null, '默认') as c;            -- '默认'
```

```sql
select count(*) from public.tasks where due_on = null;    -- 0：永远匹配不到
select count(*) from public.tasks where due_on is null;   -- 4
```

NULL 规则清单：

| 场景                       | 行为                                                     |
| -------------------------- | -------------------------------------------------------- |
| `WHERE 条件`               | 只保留条件为 **true** 的行，NULL 和 false 一样被过滤     |
| `CHECK 约束`               | 条件为 NULL 时视为**通过**                               |
| `= NULL`                   | 永远是 NULL，判断空值要用 `IS NULL` / `IS NOT NULL`      |
| “不等于且把 NULL 当普通值” | `a is distinct from b`                                   |
| 聚合函数                   | `count(列)`、`sum`、`avg` 等忽略 NULL；`count(*)` 不忽略 |
| `NOT IN` 子查询含 NULL     | 结果永远为空（5.5 节）                                   |
| `UNIQUE`                   | 默认多个 NULL 不冲突（第 2 章）                          |
| 排序                       | 升序时 NULL 排在**最后**，降序时排在**最前**             |

最后一条经常导致“截止日期最晚的任务”列表里，排在最前面的却是没有截止日期的任务：

```sql
select title, due_on from public.active_tasks
 where org_id = 'a0000000-0000-4000-8000-000000000001'
 order by due_on desc limit 3;
--  修复移动端菜单遮挡 |              ← NULL 排在了最前面（两条 NULL 之间谁先谁后也不确定）
--  补充 404 页面文案   |
--  暗色模式适配        | 2026-11-15

select title, due_on from public.active_tasks
 where org_id = 'a0000000-0000-4000-8000-000000000001'
 order by due_on desc nulls last limit 3;
--  暗色模式适配     | 2026-11-15
--  崩溃率统计接入   | 2026-10-30
--  推送通知权限引导 | 2026-10-28
```

（`active_tasks` 是第 9 章创建的视图，等价于 `tasks where deleted_at is null`；如果你还没做到第 9 章，把它换成 `public.tasks` 并加上 `and deleted_at is null`。）

## 5.9 排序与稳定分页

### 没有 ORDER BY，就没有顺序

PostgreSQL 官方文档原话的意思是：**使用 LIMIT 时，必须用 ORDER BY 把结果约束成唯一的顺序，否则得到的是不可预测的子集**；而且优化器会根据 LIMIT/OFFSET 的值选择不同的执行计划，不同页之间可能重复或遗漏。这不是 bug，而是 SQL 本来就不承诺顺序。

### 排序列有重复值时，也不稳定

种子数据里，`WEB-3` 和 `WEB-4` 的 `created_at` 完全相同（都是 9 月 22 日 14:30）。如果只按 `created_at desc` 排序，它们俩谁先谁后是不确定的。每页 2 条时，可能出现 `WEB-4` 在第 1 页出现、到第 2 页又出现一次，而 `WEB-3` 从未出现。

**解决：在排序末尾加一个唯一的列作为“决胜列”**，通常是主键：

```sql
order by created_at desc, id desc
```

### OFFSET 分页的两个问题

```sql
-- 第 2 页（每页 2 条）
select number, title from public.active_tasks
 where project_id = (select id from public.projects where key = 'WEB')
 order by created_at desc, id desc
 limit 2 offset 2;
```

1. **越往后越慢**：`offset 10000` 意味着数据库要先算出并丢弃 1 万行（官方文档：被 OFFSET 跳过的行仍然要在服务器内部计算）。
2. **数据变化时会重复或遗漏**：用户看第 1 页时，有人新建了一条任务，所有行往后挪了一位，第 2 页的第一条就是第 1 页的最后一条。

### 游标分页（keyset pagination）

思路：不说“跳过多少条”，而是说“从上一页最后一条之后继续”。

```sql
-- 第一页
select id, number, title, created_at from public.active_tasks
 where project_id = (select id from public.projects where key = 'WEB')
 order by created_at desc, id desc
 limit 2;
--  id | number |       title        |       created_at
-- ----+--------+--------------------+------------------------
--   5 |      5 | 补充 404 页面文案   | 2026-09-23 09:15:00+08
--   4 |      4 | 修复移动端菜单遮挡  | 2026-09-22 14:30:00+08   ← 记住这一行的 (created_at, id)

-- 下一页：严格“小于”上一页最后一行
select id, number, title, created_at from public.active_tasks
 where project_id = (select id from public.projects where key = 'WEB')
   and (created_at, id) < ('2026-09-22 14:30:00+08', 4)
 order by created_at desc, id desc
 limit 2;
--   3 |      3 | 首页首屏性能优化   | 2026-09-22 14:30:00+08   ← 同一时刻的另一条，没有被跳过
--   2 |      2 | 设计导航栏组件     | 2026-09-21 10:00:00+08
```

`(created_at, id) < (x, y)` 是**行比较**：先比 `created_at`，相等时再比 `id`，正好与排序规则一致。配合第 6 章的索引 `(project_id, created_at desc, id desc)`，无论翻到第几页，数据库都只读取需要的那几行。

（上面输出中的 id 取决于种子数据的插入顺序，你本地的值可能不同，以实际查询结果为准。）

游标分页的代价：只能“下一页/上一页”，不能直接跳到第 50 页。对信息流、无限滚动、任务列表来说正合适；需要页码的后台表格，在数据量不大时用 OFFSET 也可以接受。

### 在 supabase-js 里分页

```ts
// OFFSET 分页：range(from, to) 两端都包含
const { data } = await supabase
  .from("active_tasks")
  .select("id, number, title, created_at")
  .eq("project_id", projectId)
  .order("created_at", { ascending: false })
  .order("id", { ascending: false }) // 决胜列
  .range(20, 39); // 第 2 页，每页 20 条

// 游标分页：用 or() 表达 (created_at, id) < (cursor.createdAt, cursor.id)
const { data: next } = await supabase
  .from("active_tasks")
  .select("id, number, title, created_at")
  .eq("project_id", projectId)
  .or(
    `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
  )
  .order("created_at", { ascending: false })
  .order("id", { ascending: false })
  .limit(20);
```

注意：

- Data API 的 `max_rows`（`config.toml` 中默认 1000）限制单次最多返回的行数；**即使你不写 limit，也拿不到全部数据**，所以永远显式分页。
- `or()` 里的值如果包含逗号、括号等特殊字符需要加引号。游标值来自上一页结果的时间戳与 id，格式可控；如果条件变得复杂，更好的做法是写一个数据库函数，通过 `.rpc()` 调用。

## 5.10 什么时候不该在前端拼查询

supabase-js 的 `.select('number, title, projects(key), task_labels(labels(name))')` 会由 PostgREST 根据外键自动生成 JOIN，非常方便（第 8 章的演示脚本里有完整示例）。但以下情况应该把逻辑放进数据库：

| 需求                                 | 做法                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------- |
| 复杂聚合报表（本章的 CTE、窗口函数） | 建一个视图（记得 `security_invoker = true`，第 9 章），前端像查表一样查它 |
| 多步写入必须原子完成                 | 写一个数据库函数，前端用 `.rpc('函数名', 参数)` 调用                      |
| 复杂的游标分页                       | 数据库函数，参数为游标                                                    |

## 5.11 本章练习

1. 列出 globex 组织每个成员的姓名、角色，以及他在 globex 里未完成的任务数（没有任务的显示 0）。
2. 找出“有评论但没有标签”的任务。
3. 对每个任务，显示它最新的一条评论（没有评论的任务不显示）。提示：Postgres 的 `DISTINCT ON`，或窗口函数。
4. 下面的查询想统计“每个组织的成员数和项目数”，为什么结果不对？怎样改？

   ```sql
   select o.slug, count(m.user_id) as members, count(p.id) as projects
     from public.organizations o
     left join public.memberships m on m.org_id = o.id
     left join public.projects p on p.org_id = o.id
    group by o.slug;
   ```

5. 为“我的任务”页面设计游标分页：按截止日期升序（没有截止日期的排最后），写出第一页和下一页的 SQL。

### 参考答案

1. ```sql
   select pr.display_name, m.role,
          count(t.id) filter (where t.status <> 'done' and t.deleted_at is null) as open_tasks
     from public.memberships m
     join public.profiles pr on pr.id = m.user_id
     left join public.tasks t on t.org_id = m.org_id and t.assignee_id = m.user_id
    where m.org_id = 'a0000000-0000-4000-8000-000000000002'
    group by pr.display_name, m.role
    order by open_tasks desc, pr.display_name;
   ```
   ```text
    display_name |  role  | open_tasks
   --------------+--------+------------
    Bob          | member |          1
    Dave         | owner  |          1
   ```
   条件 `t.org_id = m.org_id` 必须写在 ON 里：Bob 在 acme 也有任务，不能算进来；而写在 WHERE 里又会丢掉没有任务的人。把组织换成 acme 试试，Frank 会以 0 出现。
2. ```sql
   select t.id, t.title from public.tasks t
    where exists (select 1 from public.comments c where c.task_id = t.id)
      and not exists (select 1 from public.task_labels tl where tl.task_id = t.id);
   ```
   种子数据中结果为空：有评论的 WEB-3、WEB-4、API-2 都打了标签。自己插入一条评论到 `WEB-1` 再试。
3. ```sql
   select distinct on (c.task_id)
          p.key || '-' || t.number as code, c.body, c.created_at
     from public.comments c
     join public.tasks t on t.id = c.task_id
     join public.projects p on p.id = t.project_id
    order by c.task_id, c.created_at desc, c.id desc;
   ```
   `DISTINCT ON (x)` 对每个 x 只保留排序后的第一行，所以 `ORDER BY` 必须以 x 开头。结果是 WEB-3、WEB-4、API-2 各一条最新评论。
4. 扇出：成员和项目同时 JOIN，行数相乘。acme 有 4 个成员、2 个项目，两个计数都会变成 8。改为标量子查询：`(select count(*) from public.memberships m where m.org_id = o.id)`，项目同理；或者先在 CTE 里分别聚合再 JOIN。
5. 第一页：
   ```sql
   select id, title, due_on from public.active_tasks
    where assignee_id = :me
    order by due_on asc nulls last, id asc
    limit 20;
   ```
   下一页需要区分上一页最后一行的 `due_on` 是否为 NULL：
   ```sql
   -- 上一页最后一行 due_on 不为 NULL（值为 :d，id 为 :i）
   ... where assignee_id = :me
         and (due_on > :d or (due_on = :d and id > :i) or due_on is null)
   -- 上一页最后一行 due_on 已经是 NULL（id 为 :i）
   ... where assignee_id = :me and due_on is null and id > :i
   ```
   NULL 让行比较 `(due_on, id) > (:d, :i)` 无法直接使用——这正是“排序列尽量 NOT NULL”的又一个理由。

## 本章验收

- [ ] 能写出 SQL 的逻辑执行顺序，并用它解释别名、WHERE 与 HAVING 的差异。
- [ ] 能根据“右表数据是否可能不存在”选择 JOIN 或 LEFT JOIN，并解释条件写在 ON 与 WHERE 的区别。
- [ ] 能使用 `count(*)`、`count(列)`、`filter`、`group by`、`having` 写统计查询。
- [ ] 能识别并修复同时 JOIN 两个一对多关系造成的扇出。
- [ ] 能使用标量子查询、IN、EXISTS/NOT EXISTS，并解释 NOT IN 遇到 NULL 的问题。
- [ ] 能用 CTE 拆分多步查询。
- [ ] 能用窗口函数实现组内排名、每组前 N、累计值、占比、上一行比较，说清三种排名函数的区别。
- [ ] 能解释三值逻辑以及 NULL 在 WHERE、CHECK、聚合、排序中的行为。
- [ ] 能解释为什么分页必须有唯一的排序，写出游标分页，并说明它相对 OFFSET 的优缺点。

## 官方阅读

- [PostgreSQL：Queries（SELECT 全章）](https://www.postgresql.org/docs/current/queries.html)
- [PostgreSQL：LIMIT and OFFSET](https://www.postgresql.org/docs/current/queries-limit.html)
- [PostgreSQL：WITH Queries (CTE)](https://www.postgresql.org/docs/current/queries-with.html)
- [PostgreSQL：Window Functions 教程](https://www.postgresql.org/docs/current/tutorial-window.html)
- [PostgreSQL：Comparison Functions and Operators（IS DISTINCT FROM、行比较）](https://www.postgresql.org/docs/current/functions-comparison.html)
- [PostgreSQL：Aggregate Expressions（FILTER）](https://www.postgresql.org/docs/current/sql-expressions.html#SYNTAX-AGGREGATES)
- [Supabase：JavaScript 查询修饰符（order、range、limit）](https://supabase.com/docs/reference/javascript/order)
