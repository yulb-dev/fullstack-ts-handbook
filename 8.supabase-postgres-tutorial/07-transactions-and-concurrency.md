# 第 7 章：事务、隔离级别、锁与并发更新的风险

[上一章](./06-indexes-and-explain.md) · [目录](./README.md) · [下一章](./08-api-keys-roles-and-grants.md)

单个用户点击按钮时一切正常，两个用户**同时**点击时数据就错了——这类 bug 最难复现，也最容易在上线后才暴露。本章用两个 psql 窗口亲手制造并发冲突，理解 Postgres 的隔离级别和锁，最后解释第 4 章两个触发器（任务编号、席位上限）为什么那样写。

## 7.1 准备两个会话

云端主线也可以用两个 psql 连接学习锁，不需要 Docker，但这里会修改任务、禁用触发器并制造死锁，**只能在独立的实验项目中执行**。按第 1 章用该实验项目的 Direct 或 Session 端点连接，密码使用提示输入。不要在已有业务或生产项目中重现。

可选本地路线则打开两个终端，都连接本地数据库：

```bash
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
```

下文用 **A>** 和 **B>** 区分两个窗口。时间从上往下推进，**严格按顺序**在对应窗口执行。

本地路线先 `npx supabase db reset` 得到干净种子；云端使用已初始化 Teamboard 及虚构数据的实验项目。每一轮实验结束，按对应会话执行 commit/rollback 并断开连接，恢复禁用过的触发器；不要为了重做实验重置业务云数据库。A> / B> 是标记，不要把它们输入 SQL Editor，SQL Editor 的多次运行也不能代替两个持续的 psql 会话。

## 7.2 MVCC：读不阻塞写，写不阻塞读

Postgres 使用多版本并发控制（MVCC）：更新一行时并不原地覆盖，而是写入一个新版本；每个事务根据自己的**快照**决定看到哪个版本。结果是：

- 普通 `select` 不会被写操作阻塞，也不会阻塞写操作；
- 两个事务**修改同一行**时，后来者必须等待先来者提交或回滚——这就是行锁。

```text
A> begin;
A> update public.tasks set title = '改名中' where id = 1;
B> select title from public.tasks where id = 1;      -- 立即返回旧标题：看不到 A 未提交的修改
B> update public.tasks set title = 'B 也想改' where id = 1;   -- 卡住，等待 A
A> commit;                                           -- B 的 update 随即完成
B> select title from public.tasks where id = 1;      -- 'B 也想改'
```

## 7.3 第一个风险：丢失更新（lost update）

假设任务编号不是由触发器分配，而是由应用代码“读出计数器 → 加一 → 写回”：

```text
A> begin;
A> select next_task_number from public.projects where key = 'WEB';   -- 7
B> begin;
B> select next_task_number from public.projects where key = 'WEB';   -- 7
A> update public.projects set next_task_number = 8 where key = 'WEB';  -- 应用算出 7 + 1
B> update public.projects set next_task_number = 8 where key = 'WEB';  -- 卡住，等待 A 的行锁
A> commit;
B> commit;                                   -- B 的更新完成，计数器是 8
```

两个事务都认为自己拿到了编号 7。如果它们接着各插入一条 `number = 7` 的任务，第二条会撞上唯一约束 `tasks_project_number_key`（幸好有它）；如果这是一个没有唯一约束保护的计数器（点赞数、库存），**其中一次 +1 就静默丢失了**。

问题的根源：**读和写是两条语句，两者之间别人已经改了数据，而你的写入基于过期的读取结果。** 修复方法有四种。

### 方法一：原子更新（首选）

让数据库在一条语句里完成“读-改-写”：

```text
A> begin;
A> update public.projects set next_task_number = next_task_number + 1
     where key = 'WEB' returning next_task_number - 1 as my_number;   -- 7
B> begin;
B> update public.projects set next_task_number = next_task_number + 1
     where key = 'WEB' returning next_task_number - 1 as my_number;   -- 卡住
A> commit;
B>                                                                    -- 返回 8
B> commit;
```

为什么 B 拿到的是 8？官方文档对默认隔离级别 Read Committed 的描述是：`UPDATE` 发现目标行正在被另一个事务修改时会等待；对方提交后，**它会基于这一行的最新版本重新计算 `WHERE` 条件和 `SET` 表达式**。所以 B 的 `next_task_number + 1` 是在 8 的基础上算的。

这就是第 4 章 `private.assign_task_number()` 的写法：一条 `update ... returning ... into new.number`。

### 方法二：先锁再读（SELECT ... FOR UPDATE）

当“计算新值”的逻辑复杂、无法写成一条 UPDATE 时，先把行锁住再读：

```sql
begin;
select next_task_number from public.projects where key = 'WEB' for update;  -- 其他想锁这一行的事务会等待
-- ……任意复杂的计算……
update public.projects set next_task_number = 8 where key = 'WEB';
commit;
```

### 方法三：乐观并发控制（版本号）

不加锁，写入时检查数据有没有被别人改过：

```sql
update public.projects
   set name = '新名字', version = version + 1
 where id = 42 and version = 3;      -- 3 是之前读到的版本
-- 影响 0 行 → 说明被别人改过，提示用户刷新后重试
```

适合用户在表单里编辑一段时间后才提交的场景（不能让锁持续几分钟）。`updated_at` 也可以充当版本号。

### 方法四：更高的隔离级别 + 重试

见 7.5 节。

## 7.4 Read Committed：每条语句一个快照

Postgres 的**默认隔离级别是 Read Committed**：

- 每条语句开始时取一个快照，只能看到在此之前**已提交**的数据（永远看不到别人未提交的数据，即没有“脏读”）；
- 同一个事务里的两条 `select` 可能看到不同的数据（别人在两条语句之间提交了）——这叫**不可重复读**。

```text
A> begin;
A> select count(*) from public.tasks where project_id = (select id from public.projects where key = 'WEB');  -- 6
B> insert into public.tasks (org_id, project_id, title, created_by)
   select org_id, id, '并发插入', '11111111-1111-4111-8111-111111111111' from public.projects where key = 'WEB';
A> select count(*) from public.tasks where project_id = (select id from public.projects where key = 'WEB');  -- 7
A> commit;
```

对大多数 Web 请求来说这完全够用，**前提是你不在应用代码里做“读了再根据读到的值写”**——那正是 7.3 的丢失更新。

## 7.5 Repeatable Read 与 Serializable

| 隔离级别               | 快照                         | 防止                                                  | 你需要做的                           |
| ---------------------- | ---------------------------- | ----------------------------------------------------- | ------------------------------------ |
| Read Committed（默认） | 每条语句一个                 | 脏读                                                  | 用原子更新或锁避免丢失更新           |
| Repeatable Read        | 整个事务一个（第一条语句时） | 脏读、不可重复读、幻读（Postgres 的实现比标准更严格） | **准备好重试**：并发修改同一行会报错 |
| Serializable           | 同上，并检测所有串行化异常   | 以上全部 + 写偏斜等一切“无法按某种先后顺序解释”的结果 | **准备好重试**                       |

（标准中的 Read Uncommitted 在 Postgres 里与 Read Committed 行为相同。）

### Repeatable Read：并发修改同一行会失败

```text
A> begin isolation level repeatable read;
A> select next_task_number from public.projects where key = 'WEB';   -- 7
B> update public.projects set next_task_number = next_task_number + 1 where key = 'WEB';  -- 自动提交
A> select next_task_number from public.projects where key = 'WEB';   -- 仍然是 7（同一个快照）
A> update public.projects set next_task_number = next_task_number + 1 where key = 'WEB';
-- ERROR:  could not serialize access due to concurrent update   (SQLSTATE 40001)
A> rollback;
```

官方文档的要求很明确：**收到这个错误后，应用应当中止当前事务，并从头重试整个事务。** 重试时新事务的快照里已经包含了 B 的修改。只读事务永远不会遇到这种冲突。

### 写偏斜：每个人读到的都合法，合起来却违规

席位上限是写偏斜的典型场景。acme 的 `seat_limit` 是 5，目前有 4 个成员。两个管理员同时邀请新成员，应用代码都是“先数一下人数，没满就插入”。

为了观察问题本身，我们先**临时禁用**第 4 章的席位触发器（只在本地这样做，实验结束后恢复），并准备两个不属于 acme 的占位用户：

```sql
-- 在任意一个窗口执行
insert into auth.users (id, email) values
  ('77777777-7777-4777-8777-777777777777', 'gina@example.test'),
  ('88888888-8888-4888-8888-888888888888', 'hank@example.test');
alter table public.memberships disable trigger memberships_enforce_seat_limit;
```

```text
A> begin;
A> select count(*) from public.memberships where org_id = 'a0000000-0000-4000-8000-000000000001';   -- 4，没满
B> begin;
B> select count(*) from public.memberships where org_id = 'a0000000-0000-4000-8000-000000000001';   -- 4，没满
A> insert into public.memberships (org_id, user_id) values ('a0000000-0000-4000-8000-000000000001', '77777777-7777-4777-8777-777777777777');
B> insert into public.memberships (org_id, user_id) values ('a0000000-0000-4000-8000-000000000001', '88888888-8888-4888-8888-888888888888');
A> commit;
B> commit;
```

两个事务修改的是**不同的行**，没有任何行锁冲突，结果 acme 有了 6 个成员，超过上限。Read Committed 和 Repeatable Read 都无法阻止它。

**用 Serializable 检测它**：先删除刚插入的两条成员关系，再把两个窗口的 `begin;` 换成 `begin isolation level serializable;` 重做一遍。第二个提交的事务会失败：

```text
ERROR:  could not serialize access due to read/write dependencies among transactions   (SQLSTATE 40001)
```

Serializable 发现“A 读到的人数被 B 的插入改变了，B 读到的也被 A 改变了”，不存在任何一种先后顺序能解释这个结果，于是中止其中一个。应用重试时会读到 5，拒绝邀请。

实验结束，恢复触发器：

```sql
alter table public.memberships enable trigger memberships_enforce_seat_limit;
```

（或者直接 `npx supabase db reset`。）

### Teamboard 的选择：用行锁把“先查后写”串行化

Serializable 很强大，但要求**所有相关事务**都使用它，并且应用要为所有写操作实现重试。对于 Data API 发起的请求（每个请求一个 Read Committed 事务），这不现实。Teamboard 的席位触发器用了另一种办法——**让所有“给同一个组织加人”的操作在一行锁上排队**：

```sql
create function private.enforce_seat_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
  v_count integer;
begin
  select seat_limit into v_limit
    from public.organizations
   where id = new.org_id
   for no key update;               -- ① 锁住组织这一行

  select count(*) into v_count      -- ② 拿到锁之后再计数
    from public.memberships
   where org_id = new.org_id;

  if v_count >= v_limit then
    raise exception 'organization % has reached its seat limit of %', new.org_id, v_limit
      using errcode = 'P0001', hint = 'Remove a member or raise seat_limit.';
  end if;
  return new;
end;
$$;
```

触发器启用时，重复上面的实验（Read Committed）：

```text
A> begin;
A> insert into public.memberships (org_id, user_id) values ('a000...0001', '7777...7777');   -- 触发器锁住 acme 行，计数 4，通过
B> begin;
B> insert into public.memberships (org_id, user_id) values ('a000...0001', '8888...8888');   -- 卡在 ①，等待 A
A> commit;
B>   -- 拿到锁，② 计数：5 ≥ 5
-- ERROR:  organization a0000000-... has reached its seat limit of 5
```

两个细节：

1. **第 ② 步为什么能看到 A 刚提交的行？** 在 Read Committed 下，PL/pgSQL 函数（默认是 `volatile`）中的每条 SQL 语句都会取新的快照。B 等到锁时 A 已提交，所以计数是 5。如果把函数声明成 `stable`，函数内会沿用调用时的快照，这个保护就失效了。
2. **为什么是 `for no key update` 而不是 `for update`？** 往子表插入引用该组织的行（新项目、新标签）时，外键检查会对组织行加 `FOR KEY SHARE` 锁。根据官方的行锁冲突表，`FOR UPDATE` 与 `FOR KEY SHARE` 冲突，而 `FOR NO KEY UPDATE` 不冲突。用后者，“加成员”只会和“加成员”（以及修改组织本身）排队，不会挡住同组织里的其他写入。

## 7.6 行锁一览

| 锁                  | 怎么获得                                                    | 阻塞谁                                        |
| ------------------- | ----------------------------------------------------------- | --------------------------------------------- |
| `FOR UPDATE`        | `select ... for update`；`delete`；更新可被外键引用的唯一列 | 所有其他行锁与修改                            |
| `FOR NO KEY UPDATE` | `select ... for no key update`；普通 `update`               | 除 `FOR KEY SHARE` 以外的行锁与修改           |
| `FOR SHARE`         | `select ... for share`                                      | 修改，以及 `FOR UPDATE` / `FOR NO KEY UPDATE` |
| `FOR KEY SHARE`     | 外键检查自动获得                                            | 删除、修改键值，以及 `FOR UPDATE`             |

两个实用的修饰：

- `nowait`：拿不到锁立刻报错（`55P03`），不等待。
- `skip locked`：跳过已被锁住的行。这是用数据库实现**任务队列**的标准写法，多个 worker 可以并行领取不同的任务：

  ```sql
  begin;
  select id, object_path
    from private.storage_cleanup_queue
   order by id
   limit 100
     for update skip locked;
  -- ……处理……
  delete from private.storage_cleanup_queue where id = any(...);
  commit;
  ```

  代价是处理期间事务一直打开。第 11 章的清理脚本只运行一个实例，因此没有使用它。

**行锁只读是看不到的**：普通 `select` 不会被行锁阻塞，行锁只阻塞其他写入者和加锁者。行锁在事务结束时释放。

## 7.7 死锁

```text
A> begin;
A> update public.tasks set priority = 1 where id = 1;
B> begin;
B> update public.tasks set priority = 1 where id = 2;
A> update public.tasks set priority = 1 where id = 2;   -- 等待 B
B> update public.tasks set priority = 1 where id = 1;   -- 等待 A → 互相等待
-- 约 1 秒后其中一个事务报错：
-- ERROR:  deadlock detected   (SQLSTATE 40P01)
```

Postgres 会自动检测死锁并中止其中一个事务（哪一个无法预测）。官方给出的防御方法：

1. **所有代码以相同的顺序获取锁**（例如批量更新前按 id 排序）；
2. 一开始就获取需要的最强锁；
3. 对 `40P01` 做重试。

## 7.8 表级锁与迁移：最容易被忽视的线上事故

大多数 DDL（`alter table`、`drop table`、不带 concurrently 的 `create index` 等）需要表级锁。其中 `ACCESS EXCLUSIVE` 与所有锁冲突——**连普通 select 都会被它阻塞**。

更危险的是**锁队列**：

```text
A> begin;
A> select * from public.tasks limit 1;            -- 拿到 ACCESS SHARE，事务一直不结束（比如应用代码忘了提交）
B> alter table public.tasks add column note text; -- 需要 ACCESS EXCLUSIVE，排队等待 A
C> select count(*) from public.tasks;             -- 也卡住了！它排在 B 后面
```

C 只是一条普通查询，本来与 A 毫不冲突，却因为排在等待中的 B 之后而被阻塞。线上环境里，这意味着一次“只是加个列”的迁移，可能让所有读写这张表的请求全部挂起。

在第四个窗口观察谁在等谁：

```sql
select pid, state, wait_event_type, left(query, 60) as query
  from pg_stat_activity
 where datname = 'postgres' and pid <> pg_backend_pid();
```

或者用 CLI：

```bash
npx supabase inspect db locks
npx supabase inspect db blocking
```

防御：**在迁移里设置锁等待超时**，宁可迁移失败重试，也不要让整个应用排队：

```sql
set lock_timeout = '5s';
alter table public.tasks add column note text;
```

拿不到锁 5 秒后报错 `55P03`，队列随之解除。Supabase 官方的数据删除指南也建议在删除列、删除表时使用 `lock_timeout` 和 `statement_timeout`。第 12 章会把它纳入发布清单。

A 窗口执行 `rollback;` 结束实验。

## 7.9 Supabase 中的事务边界

把本章结论映射到 Supabase：

1. **每个 Data API 请求就是一个事务**（Read Committed）。一次 `supabase.from('tasks').insert([...])` 插入多行是原子的；**但两次 supabase-js 调用是两个事务。**
2. 需要多步原子操作时，有三种选择：
   - 写成一条 SQL（原子更新、CTE 链式写入）；
   - 触发器（Teamboard 的编号、席位、创建者成为 owner）；
   - 数据库函数，前端通过 `.rpc()` 调用，函数体在一个事务里执行。
3. **不要在事务里做慢事情**：调用第三方 API、等待用户输入、上传文件都不应该夹在 `begin` 与 `commit` 之间。长事务持有锁、阻止 VACUUM 清理旧版本，在连接池场景下还占着连接（第 10 章）。
4. **identity / 序列取值不会回滚**（第 2 章）：任务编号之所以存在 `projects.next_task_number` 里，而不是用序列，就是因为编号要求“回滚后不留空洞”——计数器所在的 UPDATE 会随事务一起回滚。

## 7.10 在服务端代码里重试

直连数据库的服务端代码（第 10 章）使用 Repeatable Read / Serializable，或者可能遇到死锁时，需要一个重试包装：

```ts
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});
const RETRYABLE = new Set(["40001", "40P01"]); // 串行化失败、死锁

export async function inTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  { isolation = "read committed", retries = 3 } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query(`begin isolation level ${isolation}`);
      const result = await fn(client);
      await client.query("commit"); // serializable 下 commit 本身也可能报 40001
      return result;
    } catch (error: any) {
      await client.query("rollback").catch(() => {});
      if (RETRYABLE.has(error.code) && attempt < retries) {
        await new Promise((r) =>
          setTimeout(r, 2 ** attempt * 50 + Math.random() * 50),
        );
        continue; // 从头重做整个事务，而不是只重试失败的那条语句
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
```

要点：

- `isolation` 只能来自代码里的固定值，不能来自用户输入（它被拼进了 SQL）；
- **重试的是整个事务函数**，因为前面读到的数据都可能已经过期；
- 退避时间加随机抖动，避免冲突的事务同时重试再次冲突；
- `23505`（唯一冲突）通常**不应**重试：它表示业务上的重复，应该返回给用户。
- 如果 `commit` 时网络断开，你无法知道事务是否已提交。对“创建订单”这类操作，用客户端生成的幂等键（唯一约束）保证重试不会重复执行。

## 7.11 本章练习

1. 在两个窗口里同时为 `WEB` 项目插入任务（使用触发器的正常路径），观察第二个插入是否等待、最终编号是多少。
2. 把 7.3 节的“丢失更新”改用 `select ... for update` 修复，在两个窗口验证。
3. 某接口实现“给任务点赞”：`const n = (await select likes) ; await update likes = n + 1`。指出问题并给出一条 SQL 的修复。
4. 一个迁移要给 `tasks` 加一个带默认值的 `not null` 列，在一个繁忙的生产库上应该注意什么？
5. 为什么说“把所有事务都设为 Serializable 就安全了”并不是免费的？

### 参考答案

1. 第二个窗口的插入会等待（触发器要更新同一个项目行）；第一个提交后，第二个拿到下一个编号。如果第一个回滚，第二个拿到的就是原本第一个的编号——没有空洞。
2. ```sql
   begin;
   select next_task_number from public.projects where key = 'WEB' for update;   -- B 会卡在这里
   update public.projects set next_task_number = 8 where key = 'WEB';
   commit;
   ```
   B 拿到锁后读到的是 8，算出 9。
3. 丢失更新。修复：`update public.tasks set likes = likes + 1 where id = $1 returning likes;`。若还要防止同一用户重复点赞，用一张 `(task_id, user_id)` 主键的点赞表，靠唯一约束保证。
4. 设置 `lock_timeout`，避免锁队列拖垮整个应用；Postgres 11 起添加带**常量**默认值的列只修改元数据、不重写表，但默认值是 `now()`、`gen_random_uuid()` 这类易变函数时会重写整张表；低峰期执行，并先在有生产量级数据的预发环境演练。第 12 章有完整的“扩展—收缩”发布方法。
5. Serializable 会让更多事务因冲突失败，所有写路径都必须实现重试；它还需要额外的谓词锁开销，顺序扫描会产生整表级别的谓词锁，提高失败率（官方文档列出了一系列性能注意事项）。对于 Data API 的请求，你也无法为每个请求单独设置隔离级别和重试。针对性的原子更新、唯一约束和行锁往往更简单可靠。

## 本章验收

- [ ] 能用两个会话演示丢失更新，并给出原子更新、`for update`、版本号、提高隔离级别四种修复方式。
- [ ] 能说出 Read Committed、Repeatable Read、Serializable 的快照范围、防止的异常，以及后两者必须重试的原因。
- [ ] 能解释写偏斜，并说明 Teamboard 席位触发器如何用 `for no key update` 防止超卖，为什么不用 `for update`。
- [ ] 能说出四种行锁的用途，知道 `nowait` 与 `skip locked`。
- [ ] 能制造并解释死锁，知道预防方法。
- [ ] 能解释 DDL 的锁队列问题，并在迁移里使用 `lock_timeout`。
- [ ] 知道 supabase-js 的每次调用是一个独立事务，知道多步原子操作应放在哪里。
- [ ] 能写出只对 `40001`、`40P01` 重试整个事务的代码。

## 官方阅读

- [PostgreSQL：Concurrency Control 全章](https://www.postgresql.org/docs/current/mvcc.html)
- [PostgreSQL：Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [PostgreSQL：Explicit Locking（表锁、行锁、死锁、咨询锁）](https://www.postgresql.org/docs/current/explicit-locking.html)
- [PostgreSQL：SELECT 的锁定子句（FOR UPDATE / SKIP LOCKED）](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)
- [PostgreSQL：lock_timeout 等客户端参数](https://www.postgresql.org/docs/current/runtime-config-client.html)
- [Supabase：Deleting data and dropping objects safely（锁与超时）](https://supabase.com/docs/guides/database/postgres/data-deletion)
