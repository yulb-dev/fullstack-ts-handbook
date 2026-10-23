# 第 9 章：行级安全（RLS）——启用与否的区别、USING 与 WITH CHECK、按用户与按组织限制读写

[上一章](./08-api-keys-roles-and-grants.md) · [目录](./README.md) · [下一章](./10-connections-and-pooling.md)

第 8 章讲清了 `authenticated` 角色的表权限（GRANT），本章补上行级策略，让每个用户恰好只能看到、修改自己有权访问的行；然后用自动化测试证明它们确实如此。在可选本地路线中，你可以先只应用 grants 观察“有 grant 无策略”的中间状态；云端路线则先补齐本章策略，再整体推送第 4 份迁移，避免回头修改已应用文件。

## 9.1 RLS 是什么

官方的比喻：**一条策略相当于给每一条查询自动加上一个 WHERE 子句。**

```sql
create policy "tasks: members read"
on public.tasks for select
to authenticated
using (org_id in (select private.user_org_ids()));
```

当已登录用户执行 `select * from tasks` 时，数据库实际执行的效果相当于：

```sql
select * from tasks where org_id in (select private.user_org_ids());
```

关键在于：**这个条件是数据库强制加上的，客户端无法去掉。** 无论请求来自 supabase-js、curl，还是有人改了你的前端代码，规则都在数据库里执行。这就是为什么 publishable key 可以公开——真正的防线在这里。

## 9.2 启用与未启用：三种状态

| 状态                   | 有 grant 的角色访问时                 | 风险                                                                                        |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------- |
| **未启用 RLS**         | 所有行都可见、可改（只受 grant 限制） | 在暴露的 schema 中，等于整张表对所有有 grant 的角色公开——**最常见的 Supabase 数据泄露原因** |
| **启用 RLS，没有策略** | 默认拒绝：读到 0 行，写入被拒绝       | 安全，但功能不可用（第 8 章看到的状态）                                                     |
| **启用 RLS，有策略**   | 只能访问策略允许的行                  | 策略写错就会泄露或误拒，必须测试                                                            |

官方在 RLS 文档开头的警告原文意思是：**暴露 schema 中没有启用 RLS 的表，任何拥有 grant 的角色都可以读写。为暴露 schema 中的每一张表启用 RLS。**

此外还有几条“谁不受 RLS 约束”的规则（来自 PostgreSQL 文档）：

- **超级用户**和拥有 `BYPASSRLS` 属性的角色（Supabase 的 `service_role`）总是绕过 RLS；
- **表的所有者**通常也不受 RLS 约束（迁移由 `postgres` 执行，所以 `postgres` 是所有者）。所有者可以用 `alter table ... force row level security` 让自己也受约束；
- `TRUNCATE`、`REFERENCES` 等作用于整张表的操作不受 RLS 约束（这也是我们不给客户端这些权限的原因之一）。

检查你的数据库里有没有忘了启用 RLS 的表：

```sql
select n.nspname as schema, c.relname as table
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'r'
   and n.nspname = 'public'
   and not c.relrowsecurity;
-- 应该返回 0 行
```

Dashboard 的 **Security Advisor** 也会自动检查这类问题。

## 9.3 策略的结构

```sql
create policy "策略名"                -- 同一张表内唯一，写成人能读懂的句子
on 表名
as permissive                         -- 默认；restrictive 见 9.9
for select | insert | update | delete -- 不写就是 all，不推荐
to 角色                                -- 不写就是所有角色（public），不推荐
using ( 条件 )                         -- 针对“已有的行”
with check ( 条件 );                   -- 针对“写入后的新行”
```

官方的两条写法建议：

1. **每种操作单独写一条策略**。`for all` 让人看不出每条规则原本想覆盖哪种操作。
2. **永远写 `to` 子句**（通常是 `to authenticated`）。这样未登录请求在“角色不匹配”这一步就停止了，不会去执行策略里的函数。

## 9.4 USING 与 WITH CHECK

这是 RLS 最容易混淆的部分。一句话：**USING 决定“哪些已有的行能被看到/被操作”，WITH CHECK 决定“写进去的新行是否合法”。**

| 操作   | USING              | WITH CHECK                           | 不满足时                                                    |
| ------ | ------------------ | ------------------------------------ | ----------------------------------------------------------- |
| SELECT | 过滤可见的行       | —                                    | 静默过滤，返回更少的行                                      |
| INSERT | —                  | 检查要插入的新行                     | **报错** `42501 new row violates row-level security policy` |
| UPDATE | 过滤能被更新的旧行 | 检查更新后的新行（不写则沿用 USING） | 旧行不满足：静默跳过（更新 0 行）；新行不满足：**报错**     |
| DELETE | 过滤能被删除的行   | —                                    | 静默跳过（删除 0 行）                                       |

“静默过滤”这一点非常重要：**越权的 UPDATE/DELETE 不会报错，只是影响 0 行**。前端如果只检查 `error`，会以为操作成功了。需要确认结果时，用 `.select()` 让请求返回受影响的行，检查返回数量。

PostgreSQL 文档还规定了几种组合规则：

- 同一操作的多条 **permissive** 策略之间是 **OR**（满足任意一条即可）；
- **restrictive** 策略之间、以及它们与 permissive 的组合是 **AND**；
- UPDATE 和 DELETE 的 WHERE 子句（或 RETURNING）需要读取列时，**SELECT 策略也会参与**：你必须能“看到”一行，才能更新或删除它。对于 UPDATE，在这种情况下**更新后的新行也必须满足 SELECT 策略**，否则报错——9.8 节的软删除陷阱就来源于此。
- `INSERT ... RETURNING`（supabase-js 的 `.insert().select()`）要求新行满足 SELECT 策略，否则报错。

## 9.5 按用户限制：profiles

```sql
create policy "profiles: read self and teammates"
on public.profiles for select
to authenticated
using (
  id = (select auth.uid())
  or id in (
    select m.user_id
      from public.memberships m
     where m.org_id in (select private.user_org_ids())
  )
);

create policy "profiles: update self"
on public.profiles for update
to authenticated
using (id = (select auth.uid()))          -- 只能选中自己那一行
with check (id = (select auth.uid()));    -- 改完之后仍然必须是自己那一行
```

- 读取：自己，以及“与我同属某个组织的人”。
- 更新：配合第 8 章的列级 grant `update (display_name)`，用户只能改自己的昵称。
- 没有 INSERT 和 DELETE 策略：profile 由触发器创建，随用户删除而级联删除。

**为什么写成 `(select auth.uid())` 而不是 `auth.uid()`？** 官方的 RLS 性能建议：把函数调用包在 `select` 里，优化器会把它当作“每条语句只计算一次”的 initPlan，而不是对每一行都调用一次。前提是函数结果不依赖于行的数据——`auth.uid()` 正是如此。对于大表，这个写法的差别非常明显。

**`auth.uid()` 在未登录时返回 NULL。** `id = NULL` 的结果是 NULL（不是 true），所以未登录请求自然匹配不到任何行。官方建议要么显式写 `auth.uid() is not null and ...`，要么像这里一样用 `to authenticated` 让未登录请求根本不进入这条策略。

## 9.6 按组织限制：辅助函数与递归陷阱

多租户策略的核心问题是“当前用户属于哪些组织”，答案在 `memberships` 表里。直觉写法：

```sql
-- tasks 的策略
using (exists (
  select 1 from public.memberships m
   where m.org_id = tasks.org_id and m.user_id = (select auth.uid())
))
```

这能工作，但有两个问题：

1. **策略里的子查询本身也受 RLS 约束。** 读 `memberships` 会触发 `memberships` 的 SELECT 策略；如果那条策略又需要读某张表来判断……当两张表的策略互相读取对方时，Postgres 报错 `42P17 infinite recursion detected in policy for relation`，而且**对所有角色都失败**。官方文档给出的典型场景是“共享列表”：`lists` 的策略查 `list_members`，`list_members` 的策略查 `lists`。
2. **性能**：每张表的策略都重复同样的子查询。

官方推荐的解法是一个 `security definer` 函数：

```sql
create function private.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id
    from public.memberships
   where user_id = (select auth.uid())
$$;

create function private.has_org_role(p_org_id uuid, p_roles public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships
     where org_id = p_org_id
       and user_id = (select auth.uid())
       and role = any (p_roles)
  )
$$;
```

逐项解释：

- **`security definer`**：函数以所有者 `postgres` 的权限运行，而 Supabase 的 `postgres` 拥有 `bypassrls`，所以函数内部读取 `memberships` 时**不再执行 memberships 的策略**，递归链被打断。官方特别说明：只有当函数所有者能绕过 RLS 时这一招才有效；如果所有者没有 `bypassrls`，或者表设置了 `force row level security`，递归依然存在。
- **函数仍然只返回当前用户的数据**：因为它按 `auth.uid()` 过滤。“定义者权限”让它能读整张表，`where user_id = auth.uid()` 保证它只告诉你关于你自己的事实。
- **`set search_path = ''`**：所有 `security definer` 函数的必备项（第 3 章）。
- **`stable`**：同一条语句中，相同参数的调用结果不变，优化器可以减少调用次数。
- **放在 `private` schema**：官方警告，**`security definer` 函数如果位于暴露的 schema，就可以通过 Data API 以创建者权限被直接调用**。`private` 不在 `config.toml` 的 `[api].schemas` 中，所以不会出现在 `/rest/v1/rpc/` 下。
- **权限**：先 `revoke all ... from public`（函数默认对 PUBLIC 可执行），再只授予 `authenticated`，并授予 `private` schema 的 `usage`。策略里的表达式以调用者身份执行，调用者必须有权执行这些函数，否则查询会报权限错误。

## 9.7 Teamboard 的全部策略

如果第 8 章创建的 `..._grants_and_rls.sql` **尚未应用到云端或任何共享环境**，把以下策略追加到它的末尾，再整体推送（完整文件见 [example](./example/supabase/migrations/20261022093000_grants_and_rls.sql)）。若已经推送过，必须创建一份新的增量迁移，仅添加尚不存在的策略/视图，不能修改旧文件，也不能把完整迁移重复执行。

### organizations

```sql
create policy "organizations: members read"
on public.organizations for select
to authenticated
using (
  id in (select private.user_org_ids())
  or created_by = (select auth.uid())
);

create policy "organizations: users create as themselves"
on public.organizations for insert
to authenticated
with check (created_by = (select auth.uid()));

create policy "organizations: admins update"
on public.organizations for update
to authenticated
using ((select private.has_org_role(id, array['owner', 'admin']::public.org_role[])))
with check ((select private.has_org_role(id, array['owner', 'admin']::public.org_role[])));

create policy "organizations: owners delete"
on public.organizations for delete
to authenticated
using ((select private.has_org_role(id, array['owner']::public.org_role[])));
```

- 读取策略里多了 `or created_by = auth.uid()`：用户创建组织时，supabase-js 的 `.insert().select()` 会用 `INSERT ... RETURNING` 读回新行，而 RETURNING 要求新行满足 SELECT 策略。“创建者成为 owner”的触发器是 `after insert`，RETURNING 检查时成员关系可能还不可见，这个条件保证创建者总能读回自己刚创建的组织。
- 插入策略检查 `created_by = auth.uid()`：列默认值就是 `auth.uid()`，但客户端可以显式传一个别人的 id——WITH CHECK 拦下它，防止“以别人的名义创建组织并让对方成为 owner”。

### memberships

```sql
create policy "memberships: members read"
on public.memberships for select
to authenticated
using (org_id in (select private.user_org_ids()));

create policy "memberships: admins add"
on public.memberships for insert
to authenticated
with check (
  role <> 'owner'
  and (select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
);

create policy "memberships: admins change role"
on public.memberships for update
to authenticated
using (
  role <> 'owner'
  and (select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
)
with check (
  role <> 'owner'
  and (select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
);

create policy "memberships: leave or remove"
on public.memberships for delete
to authenticated
using (
  role <> 'owner'
  and (
    user_id = (select auth.uid())
    or (select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
  )
);
```

这里同时用到了 USING 和 WITH CHECK 来表达角色边界：

- 管理员可以添加成员，但不能直接任命 owner（WITH CHECK `role <> 'owner'`）；
- 管理员可以改别人的角色，但**选不中** owner 那一行（USING），**也不能把别人改成** owner（WITH CHECK）；
- 普通成员可以删除自己那一行（退出组织），管理员可以移除非 owner 成员。owner 的转让与删除走服务端流程。

### projects、labels

```sql
create policy "projects: members read"
on public.projects for select to authenticated
using (org_id in (select private.user_org_ids()));

create policy "projects: admins create"
on public.projects for insert to authenticated
with check ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));

create policy "projects: admins update"
on public.projects for update to authenticated
using ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])))
with check ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));

create policy "projects: owners delete"
on public.projects for delete to authenticated
using ((select private.has_org_role(org_id, array['owner']::public.org_role[])));
```

`labels` 的四条策略结构相同：成员可读，owner/admin 可增删改。

### tasks

```sql
create policy "tasks: members read"
on public.tasks for select
to authenticated
using (org_id in (select private.user_org_ids()));

create policy "tasks: members create as themselves"
on public.tasks for insert
to authenticated
with check (
  org_id in (select private.user_org_ids())
  and created_by = (select auth.uid())
);

create policy "tasks: members update"
on public.tasks for update
to authenticated
using (org_id in (select private.user_org_ids()))
with check (org_id in (select private.user_org_ids()));
```

注意读取策略**没有**写 `deleted_at is null`。原因见 9.8。

### task_labels、comments、attachments

```sql
create policy "task_labels: members read"   on public.task_labels for select to authenticated
using (org_id in (select private.user_org_ids()));
create policy "task_labels: members attach" on public.task_labels for insert to authenticated
with check (org_id in (select private.user_org_ids()));
create policy "task_labels: members detach" on public.task_labels for delete to authenticated
using (org_id in (select private.user_org_ids()));

create policy "comments: members read" on public.comments for select to authenticated
using (org_id in (select private.user_org_ids()));

create policy "comments: members write as themselves" on public.comments for insert to authenticated
with check (org_id in (select private.user_org_ids()) and author_id = (select auth.uid()));

create policy "comments: authors edit" on public.comments for update to authenticated
using (author_id = (select auth.uid()))
with check (author_id = (select auth.uid()) and org_id in (select private.user_org_ids()));

create policy "comments: authors or admins delete" on public.comments for delete to authenticated
using (
  author_id = (select auth.uid())
  or (select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
);
```

`attachments` 的三条策略结构与评论相同：成员可读；成员以自己的名义添加；上传者或管理员可删除。

为什么 `task_labels`、`comments`、`attachments` 都冗余存了 `org_id`？正是为了让策略可以直接写 `org_id in (...)`，而不必在策略里 JOIN `tasks`。第 4 章的复合外键保证了这个冗余值永远正确。

## 9.8 软删除与 RLS：一个真实的陷阱

假设把任务的读取策略写成“成员只能看到未删除的任务”：

```sql
create policy "tasks: members read (错误示范)"
on public.tasks for select to authenticated
using (org_id in (select private.user_org_ids()) and deleted_at is null);
```

看起来很合理。然后成员执行软删除：

```sql
update public.tasks set deleted_at = now() where id = 5;
-- ERROR:  new row violates row-level security policy for table "tasks"   (SQLSTATE 42501)
```

**软删除失败了**，即使 UPDATE 策略的 WITH CHECK 只检查 `org_id`。原因就是 9.4 节最后那条规则：UPDATE 的 WHERE 子句读取了列（`id`），于是 SELECT 策略也参与进来，而且**更新后的新行必须满足 SELECT 策略**——`deleted_at` 不再是 NULL，新行“不可见”，Postgres 选择报错而不是让行凭空消失。（作者在配套工程中验证了这个行为：去掉 `returning` 也一样报错。）

正确的分工：

- **RLS 只表达“授权”**：你是不是这个组织的成员。
- **“回收站里的不显示”是业务视图**，放在查询或视图里：

```sql
create view public.active_tasks
with (security_invoker = true)
as
select id, org_id, project_id, number, title, status, priority,
       assignee_id, created_by, due_on, created_at, updated_at
  from public.tasks
 where deleted_at is null;

revoke all on public.active_tasks from anon, authenticated;
grant select on public.active_tasks to authenticated, service_role;
```

前端看板查 `active_tasks`，回收站页面查 `tasks where deleted_at is not null`。

### 视图默认会绕过 RLS

上面的 `security_invoker = true` 必不可少。官方文档的警告是：**视图默认以创建者（`postgres`）的身份访问底层表，因此会绕过 RLS**——一个建在受保护表上的普通视图，会把策略本应隐藏的每一行都交出去。Postgres 15 起，设置 `security_invoker = true` 让视图以查询者身份执行，底层表的策略照常生效。

（旧版本的 Postgres 没有这个选项，只能收回 `anon`/`authenticated` 对视图的权限，或者把视图放在不暴露的 schema。）

## 9.9 其他常用模式

### restrictive 策略：额外的硬性条件

permissive 策略之间是 OR，restrictive 策略与其他策略是 AND。官方示例：要求通过多因素认证（`aal2`）才能修改资料：

```sql
create policy "Restrict updates."
on public.profiles
as restrictive
for update
to authenticated
using ((select auth.jwt() ->> 'aal') = 'aal2');
```

注意：**只有 restrictive 策略、没有 permissive 策略时，任何行都不可访问。**

### 使用 JWT 中的信息：app_metadata 与 user_metadata

`auth.jwt()` 返回整个 JWT。官方提醒两点：

- `raw_user_meta_data`（JWT 中的 `user_metadata`）**用户自己可以通过 `supabase.auth.updateUser()` 修改**，绝不能放授权信息；`raw_app_meta_data`（`app_metadata`）用户无法修改，可以放。
- **JWT 不总是最新的**：把用户移出团队后，如果策略依赖 `app_metadata` 里的团队列表，在用户刷新 token 之前，旧 token 仍然有效。

Teamboard 选择每次查询 `memberships` 表，移除成员**立即**生效；代价是每个请求都要查一次成员关系——这就是第 6 章给 `memberships (user_id)` 建索引的原因。

### 只允许读的公开数据

```sql
create policy "Anyone can read announcements"
on public.announcements for select
to anon, authenticated
using (true);
```

`to anon using (true)` 意味着每一个未登录的访问者都能读每一行。只用于确实应该公开的数据。

## 9.10 性能检查清单

1. 用 `(select auth.uid())`、`(select private.xxx())` 包裹不依赖行数据的函数调用（initPlan，每条语句计算一次）。
2. 写 `to authenticated`，让未登录请求不执行策略。
3. 为策略过滤的列建索引（第 6 章：`memberships (user_id)`、`tasks (org_id)`），并用 EXPLAIN 验证。
4. 查询时**同时写上**与策略相同的过滤条件（如 `.eq('org_id', orgId)`），帮助优化器选择更好的计划——策略是安全底线，不是查询条件的替代品。
5. 把跨表判断放进 `stable security definer` 函数，避免每张表重复子查询。

## 9.11 测试策略：pgTAP

官方的原话是：**在测试套件通过之前，你并不知道策略是否真的按你的意图工作。** 推荐流程是每张启用 RLS 的表一个测试文件，覆盖 `anon` 与 `authenticated` 在 select / insert / update / delete 上的允许与拒绝。

```bash
npx supabase test new tasks_rls.test     # 在 supabase/tests/ 下生成文件
npx supabase test db                     # 运行全部测试（需要本地栈已启动）
```

配套工程提供了两个测试文件：[tasks_rls.test.sql](./example/supabase/tests/tasks_rls.test.sql) 与 [memberships_rls.test.sql](./example/supabase/tests/memberships_rls.test.sql)。结构如下：

```sql
begin;
select plan(13);                 -- 声明将有 13 个断言

-- 1. 以 postgres 身份准备夹具：用户、组织、项目、任务（使用与种子数据不同的 UUID）
insert into auth.users (id, email, raw_user_meta_data) values (...);
insert into public.organizations (...) values (...);

-- 2. 结构断言
select ok((select relrowsecurity from pg_class where oid = 'public.tasks'::regclass), 'tasks 已启用 RLS');
select ok(not has_table_privilege('anon', 'public.tasks', 'select,insert,update,delete'), 'anon 没有任何 grant');

-- 3. 切换身份
set local role anon;
select throws_ok($$select * from public.tasks$$, '42501', null, 'anon 不能读 tasks');

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000002';

select results_eq(
  $$select title from public.tasks where org_id in (...)$$,
  array['A 项目的任务'],
  '成员只读到本组织的任务'
);
select is_empty(
  $$update public.tasks set title = '篡改' where org_id = '...B...' returning id$$,
  '更新别的组织的任务：匹配 0 行'
);

-- 4. 被拒绝的写入之后，以有权限的身份确认目标行完好
set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000003';
select results_eq($$select title from public.tasks where org_id = '...B...'$$, array['B 项目的任务'], '未被篡改');

select * from finish();
rollback;                        -- 一切回滚，不污染数据库
```

官方文档总结的断言选择规则：

| 被什么拒绝      | Postgres 的表现   | 用什么断言                                                   |
| --------------- | ----------------- | ------------------------------------------------------------ |
| 缺少 grant      | 报错 `42501`      | `throws_ok`                                                  |
| 违反 WITH CHECK | 报错 `42501`      | `throws_ok`                                                  |
| 被 USING 过滤   | 不报错，匹配 0 行 | 对带 `returning` 的语句用 `is_empty`，再读一次证明目标行完好 |

还有一条：**不要用 `lives_ok` 证明“允许的写入成功了”**——匹配 0 行时它也会通过。要加 `returning` 并断言返回的值（`results_eq`）。

一个写测试时的细节（配套测试文件里有注释）：切换到 `authenticated` 后，你**看不到**别的组织的项目，如果用子查询 `(select id from projects where key = 'TSTB')` 去取别人的项目 id，子查询会因为 RLS 返回 NULL，测到的就变成了另一种错误。正确做法是在切换身份**之前**把需要的 id 记下来（测试文件用 `set_config('test.project_b_id', ...)`）。

## 9.12 云端用户验证与可选本地脚本

云端教学项目按第 8.7 节注册两个独立账号，不需要本地栈。第一个账号创建组织与任务，记录 id；第二个账号查询该 org_id 应得到空数组，插入应违反 WITH CHECK，更新并 select 返回的数组应为空。切回第一个账号，读取目标任务确认没有被篡改；再用自己的账号软删除，确认 tasks 行仍在但 active_tasks 不显示它。

这才是在用户访问路径上验证 RLS；单纯用 postgres/SQL Editor 或 secret key 查询成功不能替代它。下面 npm 命令依赖本地栈及教程账号，属于可选本地路线，不通过删除 URL 保护让它们直跑现有云库。

```bash
npx supabase db reset
npm run dev:users
npm run demo:rls
```

预期输出（节选）：

```text
✗ 未登录读取 tasks：42501 permission denied for table tasks
✓ Erin 创建组织： {"id":"...","slug":"erin-...","created_by":"..."}
✓ Erin（owner）创建项目： {"id":...,"key":"DEMO"}
✓ Erin 创建两条任务（编号由数据库分配）： [{"number":1,...},{"number":2,...}]
✓ Grace 读取 Erin 组织的任务： []
✗ Grace 向 Erin 的组织插入任务：42501 new row violates row-level security policy for table "tasks"
✓ Grace 更新 Erin 的任务： []                       ← 静默影响 0 行
✗ Erin 修改 next_task_number：42501 permission denied for table projects
✗ Erin 修改 seat_limit：42501 permission denied for table organizations
✗ Erin 硬删除任务：42501 permission denied for table tasks
✓ Erin 软删除任务： [{"id":...,"deleted_at":"..."}]
✓ 看板（active_tasks）： [{"number":2,"title":"画交互稿"}]
```

逐行对照：哪些是 grant 拦下的（`permission denied`），哪些是 WITH CHECK 拦下的（`new row violates`），哪些是 USING 静默过滤的（`[]`）。

## 9.13 排错清单

| 现象                                          | 先查什么                                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `42501 permission denied for table x`         | grant（`\dp public.x` 或 `has_table_privilege`），**不是策略**                                                                            |
| 查询成功但没有数据                            | ① 表是否有 SELECT 策略；② 策略条件对当前用户是否成立（`select auth.uid()` 是否为预期值）；③ 是否用了 `to anon` 却以登录用户访问（或反之） |
| `new row violates row-level security policy`  | INSERT/UPDATE 的 WITH CHECK；或者 `RETURNING` / `.select()` 读回的新行不满足 SELECT 策略                                                  |
| UPDATE/DELETE 返回成功但没变化                | USING 过滤掉了；或者没有对应操作的策略                                                                                                    |
| UPDATE 必须有 SELECT 策略才能工作             | 官方文档的提示：执行 UPDATE 需要对应的 SELECT 策略                                                                                        |
| `42P17 infinite recursion detected in policy` | 两张表的策略互相读取，改用 `security definer` 辅助函数                                                                                    |
| 视图返回了不该看到的数据                      | 视图没有设置 `security_invoker = true`                                                                                                    |
| 服务端能看到所有数据                          | 用的是 secret key 或 `postgres` 直连，RLS 本来就不生效（第 8 章）                                                                         |

## 9.14 本章练习

1. 给 9.8 节“回收站”页面写一条查询，只显示当前组织在回收站里的任务，并说明为什么不需要额外的策略。
2. 新需求：普通成员只能修改**指派给自己**或**自己创建**的任务，管理员可以修改所有任务。改写 tasks 的 UPDATE 策略。
3. 为第 4 章练习中的 `task_watchers` 表写出 grant 与策略：成员可以关注/取消关注本组织的任务，只能看到自己的关注记录。
4. 为第 3 题写一个 pgTAP 测试，至少包含：anon 被拒、成员关注成功、非成员关注失败、成员看不到别人的关注。
5. 有人说“我们的接口都走后端，用 service_role，不需要 RLS”。指出这种做法的风险和适用前提。

### 参考答案

1. `select * from public.tasks where org_id = $1 and deleted_at is not null order by deleted_at desc;`——读取策略只要求是成员，不过滤 `deleted_at`，所以回收站里的任务本来就可见。
2. ```sql
   drop policy "tasks: members update" on public.tasks;
   create policy "tasks: assignee, creator or admin update"
   on public.tasks for update to authenticated
   using (
     org_id in (select private.user_org_ids())
     and (
       assignee_id = (select auth.uid())
       or created_by = (select auth.uid())
       or (select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
     )
   )
   with check (org_id in (select private.user_org_ids()));
   ```
   这是一个新迁移（原迁移若已推送就不能改）。WITH CHECK 保持宽松，否则成员把任务改指派给别人之后，新行“不再属于自己”，更新会被拒绝——想清楚这是不是你要的行为。
3. ```sql
   alter table public.task_watchers enable row level security;
   revoke all on public.task_watchers from anon, authenticated;
   grant select, insert, delete on public.task_watchers to authenticated;

   create policy "watchers: read own" on public.task_watchers for select to authenticated
   using (user_id = (select auth.uid()));
   create policy "watchers: watch as self" on public.task_watchers for insert to authenticated
   with check (user_id = (select auth.uid()) and org_id in (select private.user_org_ids()));
   create policy "watchers: unwatch own" on public.task_watchers for delete to authenticated
   using (user_id = (select auth.uid()));
   ```

4. 参照 `tasks_rls.test.sql`：夹具中创建组织、成员与非成员；`set local role anon` 后 `throws_ok(... '42501')`；成员 `results_eq(insert ... returning task_id, array[...])`；非成员插入 `throws_ok(... '42501')`；成员查询 `is_empty`（看别人的记录）。
5. 风险：数据隔离完全依赖每一个后端接口都写对权限检查，漏掉一个就是越权；一旦有人（或未来的你）在前端直接使用 supabase-js，表没有任何防护；secret key 泄露即全库泄露。适用前提：确实不开放 Data API（可以在 Dashboard 关闭 Data API，或者完全不授予 anon/authenticated 权限），并且仍然为表启用 RLS 作为纵深防御。

## 本章验收

- [ ] 能说出“未启用 RLS / 启用无策略 / 启用有策略”三种状态的行为，并能查询出未启用 RLS 的表。
- [ ] 知道哪些角色绕过 RLS（超级用户、BYPASSRLS、表所有者），以及 `force row level security` 的作用。
- [ ] 能解释 USING 与 WITH CHECK 在四种操作中的作用，以及“静默过滤”与“报错”的区别。
- [ ] 能写出按用户（profiles）和按组织（tasks 等）限制读写的策略，包括角色边界（owner/admin/member）。
- [ ] 能解释策略递归的原因，并用 `security definer` + `set search_path = ''` 的私有函数解决，知道为什么不能放在暴露的 schema。
- [ ] 能解释软删除与 SELECT 策略冲突的原因，并用 `security_invoker` 视图解决；知道普通视图会绕过 RLS。
- [ ] 能区分 app_metadata 与 user_metadata 的安全性，知道 JWT 的时效问题。
- [ ] 能写 pgTAP 测试，并按“grant 拒绝 / WITH CHECK 拒绝 / USING 过滤”选择断言。

## 官方阅读

- [Supabase：Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase：RLS performance](https://supabase.com/docs/guides/database/postgres/row-level-security-performance)
- [Supabase：Testing your database](https://supabase.com/docs/guides/database/testing)
- [Supabase：pgTAP 扩展测试](https://supabase.com/docs/guides/local-development/testing/pgtap-extended)
- [PostgreSQL：Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [PostgreSQL：CREATE POLICY（按命令类型应用策略的规则表）](https://www.postgresql.org/docs/current/sql-createpolicy.html)
- [PostgreSQL：CREATE VIEW（security_invoker）](https://www.postgresql.org/docs/current/sql-createview.html)
