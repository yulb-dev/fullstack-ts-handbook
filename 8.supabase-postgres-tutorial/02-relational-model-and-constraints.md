# 第 2 章：关系模型、主键外键与约束——让数据库替你守住规则

[上一章](./01-supabase-mental-model-and-setup.md) · [目录](./README.md) · [下一章](./03-cli-migrations-and-seed.md)

前端开发者最熟悉的数据形态是 JSON：一个对象里嵌套数组，数组里又是对象。关系数据库的思路完全不同——它把数据拆成多张“扁平”的表，再用**键**把它们连起来，并用**约束**保证数据永远合法。

本章在独立的教学云数据库或可选本地栈中开一个实验用的 `lab` schema，亲手触发每一种约束错误。你会看到：**约束不是可有可无的装饰，而是数据库替你做的、任何客户端都绕不过去的校验。** 这一点在 Supabase 里尤其重要，因为浏览器可以直接通过 Data API 写库，你无法假设所有写入都经过了你的后端校验。

> 本章的 `lab` 只是练习场，不写进迁移；只在可丢弃的教学项目中创建和删除，不在已有业务云库里做清理实验。从第 3 章开始，所有正式结构都通过迁移文件创建。SQL 可在云端 SQL Editor 执行；`\d`、`\q` 等反斜杠命令则只属于 psql。

## 2.1 关系模型的几个基本词

| 术语                     | 直观理解                         | 前端类比                         |
| ------------------------ | -------------------------------- | -------------------------------- |
| 表（table / relation）   | 同一类事物的集合，例如“所有作者” | 一个 `Author[]` 数组             |
| 行（row / tuple）        | 一个具体事物                     | 数组里的一个对象                 |
| 列（column / attribute） | 事物的一个属性，有固定类型       | 对象的一个字段（并且是强类型的） |
| 主键（primary key）      | 唯一标识一行的列                 | React 列表里的 `key`             |
| 外键（foreign key）      | 指向另一张表主键的列             | 对象里存的 `authorId`            |
| 约束（constraint）       | 写入时强制检查的规则             | 运行时校验，但在数据库里执行     |

两个与 JSON 思维不同的关键点：

1. **表是集合，没有天然顺序**。你不写 `ORDER BY`，数据库返回的顺序就没有任何保证（第 5 章会反复强调）。
2. **不嵌套**。一篇文章的作者信息不复制进文章行，而是存一个 `author_id` 指向作者表。需要时用 JOIN 拼起来。这样作者改名只需要改一处。

打开 psql，建一个练习用的 schema：

```sql
create schema lab;
```

## 2.2 选对列的类型

类型本身就是第一道约束：`integer` 列里放不进字符串。常用类型的选择建议：

| 需求                       | 推荐                           | 避免                              | 原因                                                   |
| -------------------------- | ------------------------------ | --------------------------------- | ------------------------------------------------------ |
| 文本                       | `text`                         | 随意的 `varchar(255)`             | Postgres 中两者性能相同；长度规则用 `check` 表达更清楚 |
| 整数 id、计数              | `bigint` / `integer`           | —                                 | 自增主键用 `bigint`，避免将来溢出                      |
| 金额、需要精确的小数       | `numeric(12,2)`                | `real` / `double precision`       | 浮点数有二进制误差                                     |
| 时间点                     | `timestamptz`                  | `timestamp`（不带时区）           | `timestamptz` 存的是绝对时刻，展示时按会话时区换算     |
| 日期（无时刻）             | `date`                         | 字符串                            | 可以比较、做日期运算                                   |
| 是/否                      | `boolean`                      | `0/1` 整数、`'Y'/'N'`             | 语义清晰                                               |
| 全局唯一 id                | `uuid`                         | 字符串                            | 16 字节、可比较、有内置生成函数 `gen_random_uuid()`    |
| 半结构化、字段不固定的数据 | `jsonb`                        | 把本该有固定列的业务数据塞进 JSON | JSON 里的字段没有类型、外键和约束                      |
| 固定取值集合               | `enum` 或 `check (x in (...))` | 自由文本                          | 第 4 章比较两者                                        |

亲手验证两个最常见的坑：

```sql
-- 浮点误差
select 0.1::float8 + 0.2::float8 = 0.3 as float_eq,
       0.1::numeric + 0.2::numeric = 0.3 as numeric_eq;
--  float_eq | numeric_eq
-- ----------+------------
--  f        | t

select 0.1::float8 + 0.2::float8;
-- 0.30000000000000004
```

```sql
-- timestamptz 存的是同一个时刻，只是按会话时区显示
set timezone = 'Asia/Shanghai';
select timestamptz '2026-10-22 09:00:00+08';   -- 2026-10-22 09:00:00+08

set timezone = 'UTC';
select timestamptz '2026-10-22 09:00:00+08';   -- 2026-10-22 01:00:00+00

-- 不带时区的 timestamp 会直接丢掉 +08 这个信息
select timestamp '2026-10-22 09:00:00+08';     -- 2026-10-22 09:00:00
```

最后一行就是很多“时间差了 8 小时”问题的来源：一旦用了 `timestamp`，数据库就不知道这个时间是哪个时区的。**存时间点一律用 `timestamptz`**，前端用 ISO 字符串（带时区）收发即可。

> Supabase 云端数据库的默认时区是 UTC。不要依赖数据库时区做业务计算，按需在查询里用 `at time zone 'Asia/Shanghai'` 转换。

## 2.3 主键：每一行的身份证

建两张表：作者与文章。

```sql
create table lab.authors (
  id bigint generated always as identity primary key,
  email text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);
```

逐个解释：

- `generated always as identity`：由数据库自动生成递增编号。这是 SQL 标准写法，比老式的 `serial` 更推荐。`always` 表示**不允许手动指定值**。
- `primary key`：等价于 `unique` + `not null`，并且会自动创建一个 B-tree 索引。
- `default now()`：插入时不提供该列就用默认值。

试一试：

```sql
insert into lab.authors (email, name)
values ('ann@example.test', 'Ann'), ('ben@example.test', 'Ben')
returning id, email;
--  id |      email
-- ----+------------------
--   1 | ann@example.test
--   2 | ben@example.test

insert into lab.authors (id, email, name) values (100, 'dan@example.test', 'Dan');
-- ERROR:  cannot insert a non-DEFAULT value into column "id"   (SQLSTATE 428C9)
```

`returning` 让 `insert`/`update`/`delete` 把受影响的行直接返回，省去再查一次。supabase-js 的 `.insert(...).select()` 底层就是它。

### bigint 自增还是 uuid？

|                    | `bigint generated always as identity` | `uuid default gen_random_uuid()`               |
| ------------------ | ------------------------------------- | ---------------------------------------------- |
| 大小               | 8 字节                                | 16 字节                                        |
| 可读性             | 好（`#42`）                           | 差                                             |
| 可猜测性           | 能从 id 推测数据量、遍历相邻记录      | 随机，无法猜测                                 |
| 客户端能否预先生成 | 不能                                  | 能（离线创建、幂等重试很方便）                 |
| 索引局部性         | 好（总在末尾追加）                    | 随机 UUID 插入位置分散，大表写入时索引页更分散 |

本教程的做法：**对外暴露、跨系统引用的实体（组织）用 uuid；内部、量大的实体（任务、评论）用 bigint**。没有绝对的对错，关键是想清楚理由。Supabase Auth 的用户 id 是 uuid，所以所有“指向用户”的列都是 uuid。

### 序列值不会回滚

```sql
begin;
insert into lab.authors (email, name) values ('eve@example.test', 'Eve') returning id;  -- 比如得到 5
rollback;

insert into lab.authors (email, name) values ('fay@example.test', 'Fay') returning id;  -- 得到 6，而不是 5
```

官方文档特别强调：序列（以及基于它的 identity 列）的取值**对其他事务立即可见，事务回滚也不会归还**。失败的插入同样会消耗编号。所以：**自增 id 会有空洞，绝不能拿它当“连续编号”**。如果业务需要“WEB-1、WEB-2、WEB-3”这种无空洞编号，要自己设计（第 4、7 章会实现）。

## 2.4 NOT NULL 与 DEFAULT

`NULL` 表示“未知”或“不适用”，**它不是空字符串，也不是 0**。

```sql
insert into lab.authors (email) values ('cat@example.test');
-- ERROR:  null value in column "name" of relation "authors" violates not-null constraint  (SQLSTATE 23502)
```

经验法则：**默认给每一列加 `not null`，只有当“这个值确实可能不存在”时才允许 NULL**，并且能说清楚 NULL 代表什么。例如 `published_at` 为 NULL 表示“尚未发布”，这是一个有意义的状态。

## 2.5 外键：让引用永远有效

```sql
create table lab.posts (
  id bigint generated always as identity primary key,
  author_id bigint not null references lab.authors (id),
  title text not null check (char_length(title) between 1 and 100),
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  constraint posts_published_needs_time
    check (status = 'draft' or published_at is not null)
);
```

`references lab.authors (id)` 声明了外键：`posts.author_id` 的每个值都必须在 `authors.id` 中存在。

```sql
insert into lab.posts (author_id, title) values (999, '孤儿文章');
-- ERROR:  insert or update on table "posts" violates foreign key constraint "posts_author_id_fkey"
-- DETAIL:  Key (author_id)=(999) is not present in table "authors".   (SQLSTATE 23503)

insert into lab.posts (author_id, title) values (1, '第一篇草稿') returning *;
-- 成功

delete from lab.authors where id = 1;
-- ERROR:  update or delete on table "authors" violates foreign key constraint "posts_author_id_fkey" on table "posts"
-- DETAIL:  Key (id)=(1) is still referenced from table "posts".   (SQLSTATE 23503)
```

外键在两个方向上起作用：

- **写子表时**：不能引用不存在的父行；
- **删/改父表时**：如果还有子行引用它，默认拒绝。这个“默认”就是 `ON DELETE NO ACTION`。

`ON DELETE` 的五种策略：

| 策略                | 删除父行时                     | 典型用途                                   |
| ------------------- | ------------------------------ | ------------------------------------------ |
| `NO ACTION`（默认） | 报错（检查可以延迟到事务末尾） | 绝大多数情况的安全默认                     |
| `RESTRICT`          | 立即报错，不能延迟             | 明确禁止删除                               |
| `CASCADE`           | 一并删除所有子行               | “子行是父行的一部分”，例如订单与订单行     |
| `SET NULL`          | 把子行的外键列置为 NULL        | “引用的是一个可选的对象”，例如任务的负责人 |
| `SET DEFAULT`       | 把子行的外键列置为默认值       | 少见                                       |

第 4 章会为 Teamboard 的每一个外键逐一选择策略并说明理由。

关于外键还有两条**官方文档明确写出、但新手常常不知道**的事实：

1. 外键只能引用**主键或唯一约束**的列，所以被引用的一侧天然有索引。
2. **外键的引用一侧（子表那一列）不会自动建索引。** 删除父行时，数据库要去子表里找“还有没有人引用我”，没有索引就只能全表扫描。是否需要建索引要看查询和删除频率，第 6 章会具体分析。

## 2.6 CHECK 约束：把业务规则写进表

上面 `posts` 表里有三个 `check`：

- `char_length(title) between 1 and 100`：标题长度；
- `status in ('draft', 'published')`：状态只能是两者之一；
- `status = 'draft' or published_at is not null`：**跨列规则**——已发布的文章必须有发布时间。

```sql
insert into lab.posts (author_id, title, status) values (1, '已发布但没有时间', 'published');
-- ERROR:  new row for relation "posts" violates check constraint "posts_published_needs_time"  (SQLSTATE 23514)

insert into lab.posts (author_id, title, status, published_at) values (1, 'x', 'archived', now());
-- ERROR:  new row for relation "posts" violates check constraint "posts_status_check"  (SQLSTATE 23514)
```

给约束起一个有意义的名字（`constraint 名字 check (...)`），出错时一眼就能看出违反了哪条规则。前端可以根据约束名把数据库错误翻译成用户能看懂的提示。

CHECK 的边界（官方文档的警告）：**CHECK 只能检查“当前这一行”**。不要在 CHECK 里调用查询其他行或其他表的函数——它在简单测试里看起来能工作，但无法保证一致性，还会导致备份恢复失败。跨行、跨表的规则应该用 `UNIQUE`、外键、排他约束，或者触发器（第 4 章）。

## 2.7 UNIQUE：唯一性与 NULL 的特殊规则

`email text not null unique` 保证邮箱不重复，并自动创建唯一索引：

```sql
insert into lab.authors (email, name) values ('ann@example.test', 'Ann 2');
-- ERROR:  duplicate key value violates unique constraint "authors_email_key"
-- DETAIL:  Key (email)=(ann@example.test) already exists.   (SQLSTATE 23505)
```

一个反直觉的规则：**默认情况下，多个 NULL 不算重复**。

```sql
create table lab.handles (handle text unique);
insert into lab.handles values (null), (null);   -- 成功！
select count(*) from lab.handles;               -- 2

-- Postgres 15+ 可以改变这个行为
create table lab.handles2 (handle text unique nulls not distinct);
insert into lab.handles2 values (null), (null);
-- ERROR:  duplicate key value violates unique constraint "handles2_handle_key"
-- DETAIL:  Key (handle)=(null) already exists.
```

唯一约束也可以覆盖多列：`unique (org_id, name)` 表示“同一个组织内名字不重复”，不同组织可以重名。第 4 章大量使用这种写法。

## 2.8 事务：要么全部成功，要么全部不发生

转账是最经典的例子：

```sql
create table lab.accounts (
  id int primary key,
  owner text not null,
  balance numeric(12, 2) not null check (balance >= 0)
);
insert into lab.accounts values (1, 'Ann', 100), (2, 'Ben', 50);

begin;
update lab.accounts set balance = balance - 80 where id = 1;
update lab.accounts set balance = balance + 80 where id = 2;
commit;

select * from lab.accounts order by id;
--  id | owner | balance
-- ----+-------+---------
--   1 | Ann   |   20.00
--   2 | Ben   |  130.00
```

再转一次 80，这次 Ann 的余额不够：

```sql
begin;
update lab.accounts set balance = balance + 80 where id = 2;   -- 先给 Ben 加钱，成功
update lab.accounts set balance = balance - 80 where id = 1;   -- Ann 变成 -60，违反 check
-- ERROR:  new row for relation "accounts" violates check constraint "accounts_balance_check"

select * from lab.accounts;
-- ERROR:  current transaction is aborted, commands ignored until end of transaction block  (SQLSTATE 25P02)

rollback;
select * from lab.accounts order by id;   -- 仍然是 20.00 和 130.00，给 Ben 加的钱也撤销了
```

这一段包含了事务最重要的三个事实：

1. **原子性**：`begin` 与 `commit` 之间的所有修改要么一起生效，要么一起撤销。Ben 那 80 元没有凭空出现。
2. **出错后事务进入“中止”状态**：之后的任何语句都会被拒绝（25P02），直到你执行 `rollback`。应用代码里要确保出错时一定回滚并归还连接。
3. **不写 `begin` 时，每条语句自己就是一个事务**（自动提交）。所以“先扣钱、再加钱”如果写成两次独立调用，中间失败就会出现钱凭空消失。

> **与 Supabase 的关系**：supabase-js 的每一次 `.from(...).insert/update/...` 调用都是一个独立的 HTTP 请求、一个独立的事务。**连续调用两次 supabase-js 并不在同一个事务里。** 需要原子性的多步操作，要放进一条 SQL、一个数据库函数（通过 `.rpc()` 调用）或者触发器里。第 4、7 章会用到这个原则。

事务的另外两个字母——隔离性（多个事务并发时互相看到什么）和由此产生的锁与并发问题——是第 7 章的主题。现在只需要知道：**默认隔离级别是 Read Committed，每条语句看到的是它开始时已提交的数据。**

## 2.9 错误码速查表

Postgres 的错误都有 5 位 SQLSTATE 码。前端从 supabase-js 拿到的 `error.code` 往往就是它，值得记住这几个：

| SQLSTATE | 含义                      | 常见原因                                         |
| -------- | ------------------------- | ------------------------------------------------ |
| `23502`  | not_null_violation        | 必填列没给值                                     |
| `23503`  | foreign_key_violation     | 引用了不存在的行，或删除了仍被引用的行           |
| `23505`  | unique_violation          | 重复数据                                         |
| `23514`  | check_violation           | 违反 CHECK 规则                                  |
| `428C9`  | generated_always          | 给 `generated always` 列手动赋值                 |
| `25P02`  | in_failed_sql_transaction | 事务已出错但还没回滚                             |
| `42501`  | insufficient_privilege    | 没有权限，或违反 RLS 的 WITH CHECK（第 8、9 章） |
| `40001`  | serialization_failure     | 隔离级别冲突，需要重试整个事务（第 7 章）        |
| `40P01`  | deadlock_detected         | 死锁，其中一个事务被中止（第 7 章）              |

## 2.10 清理

```sql
drop schema lab cascade;
```

`cascade` 会连同 schema 里的所有对象一起删除。**在真实数据库上执行任何 `cascade` 之前都要停下来想一想**——这里只是练习场。

## 2.11 本章练习

1. 给 `lab.authors` 增加一个规则：`name` 去掉首尾空格后不能为空字符串。
2. 设计一张 `lab.follows` 表表示“作者关注作者”：同一对关系不能重复，也不能关注自己。
3. 下面的转账为什么危险？如何修复？

   ```js
   await supabase
     .from("accounts")
     .update({ balance: a - 80 })
     .eq("id", 1);
   await supabase
     .from("accounts")
     .update({ balance: b + 80 })
     .eq("id", 2);
   ```

4. 有人建议“用 `timestamp` 吧，反正我们只在中国用”。你怎么回应？

### 参考答案

1. `alter table lab.authors add constraint authors_name_not_blank check (char_length(trim(name)) > 0);`
2. ```sql
   create table lab.follows (
     follower_id bigint not null references lab.authors (id) on delete cascade,
     followee_id bigint not null references lab.authors (id) on delete cascade,
     created_at timestamptz not null default now(),
     primary key (follower_id, followee_id),
     constraint follows_not_self check (follower_id <> followee_id)
   );
   ```
   复合主键同时保证了“不重复”和“非空”。
3. 两次调用是两个独立事务：第二次失败时第一次已经提交；而且 `a - 80` 是在客户端算的，并发时会覆盖别人的修改（第 7 章的“丢失更新”）。修复：写一个数据库函数，在一个事务里用 `balance = balance - 80` 这样的原子更新完成两步，前端通过 `.rpc()` 调用；余额规则继续由 CHECK 兜底。
4. 存储的是“时刻”，与用户在哪里无关：服务器、云数据库默认 UTC，日志、定时任务、第三方系统都可能使用不同时区，夏令时地区的用户也可能加入。`timestamptz` 没有额外成本，却消除了一整类 bug。

## 本章验收

- [ ] 能解释表、行、列、主键、外键分别是什么，以及“关系表不嵌套”的意义。
- [ ] 能为金额、时间点、日期、id 选择合适的类型并说明理由。
- [ ] 能写出 NOT NULL、DEFAULT、CHECK（含跨列）、UNIQUE（含多列）、外键，并预测违反时的错误码。
- [ ] 知道外键引用一侧不会自动建索引，知道 `ON DELETE` 的五种策略。
- [ ] 能用 `begin/commit/rollback` 演示原子性，知道出错后必须回滚。
- [ ] 知道 supabase-js 的多次调用不在同一个事务里。

## 官方阅读

- [PostgreSQL：Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
- [PostgreSQL：Data Types](https://www.postgresql.org/docs/current/datatype.html)
- [PostgreSQL：Transactions 教程](https://www.postgresql.org/docs/current/tutorial-transactions.html)
- [PostgreSQL：Error Codes](https://www.postgresql.org/docs/current/errcodes-appendix.html)
- [PostgreSQL：Transaction Isolation（序列值不回滚的说明）](https://www.postgresql.org/docs/current/transaction-iso.html)
