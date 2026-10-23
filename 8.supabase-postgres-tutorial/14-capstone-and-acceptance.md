# 第 14 章：综合实战与逐项验收

[上一章](./13-backup-restore-and-data-protection.md) · [目录](./README.md)

这一章不再引入新概念。你将：

1. 从一个空目录出发，按顺序把 Teamboard 完整跑一遍；
2. 独立完成一个新功能（任务关注者），走完“设计 → 迁移 → 索引 → 权限 → 测试 → 发布 → 验证”的全流程；
3. 对照最初的学习目标，逐项自测。每一项都包含“能解释”的问题和“能做到”的操作，两者都通过才算掌握。

## 14.1 两条跟做路线：云端主线与可选本地栈

### 云端主线：托管数据库，不要求本机 Docker

| 步骤             | 实际操作                                                               | 验收                                                         |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1 连接           | 第 1 章 SQL Editor/psql/Node 只读查询                                  | 知道云数据库的版本与角色，不打印密码，也不读取无关用户数据   |
| 2 选择环境       | 建立独立教学云项目；已有业务项目只读观察并查明基线                     | 教学与生产的 project ref、URL、key、数据库密码分开           |
| 3 建模           | 按第 3 章初始化、关联教学项目，按第 3/4/6/8/9/11 章填写完整迁移        | preview 后 db push 追加结构；不通过云端 reset 跟做           |
| 4 准备查询数据   | 只在教学项目显式执行虚构 seed                                          | 第 5 章的统计与分页结果能对照；占位用户不是登录账号          |
| 5 验证用户路径   | 第 8.7 节用两个真实受控测试邮箱注册/确认/登录                          | 第一个账号能建组织/项目/任务，第二个读不到其组织且写入被拒绝 |
| 6 验证 Storage   | 第 11 章在教学项目用登录客户端上传私有文件并生成短期签名 URL           | 同组织可读，其他账号不可读，公开地址不能下载私有文件         |
| 7 类型与结构检查 | 第 3 章 `gen types --project-id`；按第 13 章运行适用于本模型的只读检查 | 类型来自教学云项目，迁移历史与结构对应                       |
| 8 部署与恢复     | 第 12/13 章用隔离 staging、CI、备份与临时恢复项目                      | 不给开发机生产写凭据，不把教学数据部署到生产                 |

第 6、7 章的批量造数、禁用触发器、死锁等实验不是业务库的验收项，只在独立实验库进行。`db pull`/`db diff`/CLI `db dump` 的容器依赖见第 3 章；可以放在 CI 或受控工具机上，本机日常开发仍然直连云服务。

**不要把现有 `.env` 简单换成云端值后运行所有 npm demo。** `dev:users`、`demo:rls`、`demo:storage` 保留只允许本地 URL 的保护；`demo:pg` 依赖固定 Bob 身份，`job:cleanup` 会永久删除数据和文件。云端用上述章节的明确流程，不删保护来试现有云库。

### 可选本地路线：完整可重复示例

以下命令在本地栈执行，保留原有实验与自动化测试能力；它们不是云端数据库的连接步骤。

```bash
# 0. 准备：Node 20.6+、容器运行时（至少 7 GB 内存）、psql
mkdir teamboard && cd teamboard
npm init -y
npm install --save-dev supabase@2.121.0
npm install @supabase/supabase-js@2.118.0 pg@8.23.1

# 1. 初始化与启动（第 1 章）
npx supabase init
npx supabase start

# 2. 迁移与种子（第 3、4、6、8、9、11 章）
#    依次创建并填写 5 个迁移，或直接复制 example/supabase/migrations/ 下的文件
npx supabase migration new create_profiles
npx supabase migration new core_schema
npx supabase migration new query_indexes
npx supabase migration new grants_and_rls
npx supabase migration new storage_and_lifecycle
#    复制 example/supabase/seed.sql、config.toml、tests/、snippets/
npx supabase db reset

# 3. 数据库测试（第 9 章）
npx supabase test db

# 4. 客户端与服务端演示（第 8、9、11 章）
cp .env.example .env.local        # 填入 npx supabase status 显示的 Publishable / Secret
npm run dev:users
npm run demo:rls
npm run demo:admin
npm run demo:pg
npm run demo:storage
npm run job:cleanup

# 5. 性能实验（第 6 章）
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -f supabase/snippets/bulk_tasks.sql

# 6. 发布前后检查（第 13 章）
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' -f supabase/snippets/post_migration_checks.sql

# 7. 类型生成（第 3 章）
npx supabase gen types --lang typescript --local > database.types.ts
```

（npm scripts 的定义见 [example/package.json](./example/package.json)。从空目录自行搭建时，还需要复制该文件中的 scripts、example/scripts 下的代码与 .env.example；否则 npm run demo 等命令尚不存在。不要同时创建 5 个空迁移又复制 5 个完整同内容迁移，应选择自己填写或复制现有文件其中一种方式。）

以下是**可选本地路线**各脚本的预期结果；云端主线按上表与真实注册账号验收，不假设云项目中一定有 Alice/Bob 或本地 Mailpit。

| 步骤                        | 成功的标志                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `db reset`                  | 5 个迁移全部执行，种子数据无报错                                                                                                   |
| `test db`                   | 两个测试文件、22 个断言全部 ok                                                                                                     |
| `demo:rls`                  | 未登录 42501；Erin 的组织/项目/任务创建成功；Grace 读到 `[]`、插入被拒、更新 `[]`；列级权限与硬删除被拒；软删除成功；看板只剩 1 条 |
| `demo:admin`                | 列出所有组织（包括 Erin 创建的），说明 secret key 绕过了 RLS                                                                       |
| `demo:pg`                   | 直连身份看到全部任务；“扮演 Bob”时只看到 Bob 所在组织的任务                                                                        |
| `demo:storage`              | 上传、登记、签名 URL 下载成功；公开地址、Grace 下载、Grace 签名、可执行文件上传均失败                                              |
| `job:cleanup`               | 回收站中超过 30 天的任务（种子里有 1 条）被硬删除                                                                                  |
| `post_migration_checks.sql` | 第 1–8 段全部 0 行                                                                                                                 |

## 14.2 综合任务：为任务增加“关注者”

需求：

- 组织成员可以关注本组织的任务，关注后在“我关注的任务”列表中看到它；
- 每个人只能看到、修改自己的关注记录；
- 成员离开组织时，他的关注记录自动消失；任务被硬删除时同理；
- “我关注的任务”列表按任务最近更新时间倒序，支持游标分页。

请独立完成，再对照下面的参考实现。云端在独立教学项目或实际业务的开发环境创建**新迁移**，不在现有生产项目直接粘贴整段 SQL；pgTAP 夹具可以在隔离本地栈或 CI 中验证，不为执行测试去给生产补装测试数据。

### 参考实现

**① 迁移 `add_task_watchers`（表、约束、索引、权限、策略放在同一个迁移里）**

```sql
create table public.task_watchers (
  org_id uuid not null,
  task_id bigint not null,
  user_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (task_id, user_id),
  constraint task_watchers_task_fk foreign key (task_id, org_id)
    references public.tasks (id, org_id) on delete cascade,
  constraint task_watchers_member_fk foreign key (org_id, user_id)
    references public.memberships (org_id, user_id) on delete cascade
);

-- 主键以 task_id 开头；“我关注的任务”按 user_id 查，需要反向索引（第 6 章）
create index task_watchers_user_id_idx on public.task_watchers (user_id);

alter table public.task_watchers enable row level security;
revoke all on public.task_watchers from anon, authenticated;
grant select, insert, delete on public.task_watchers to authenticated;
grant select, insert, update, delete on public.task_watchers to service_role;

create policy "watchers: read own"
on public.task_watchers for select to authenticated
using (user_id = (select auth.uid()));

create policy "watchers: watch as self"
on public.task_watchers for insert to authenticated
with check (
  user_id = (select auth.uid())
  and org_id in (select private.user_org_ids())
);

create policy "watchers: unwatch own"
on public.task_watchers for delete to authenticated
using (user_id = (select auth.uid()));
```

设计决定回顾：

| 决定                                                   | 理由                                                     | 章节 |
| ------------------------------------------------------ | -------------------------------------------------------- | ---- |
| 连接表、复合主键 `(task_id, user_id)`                  | 多对多；同一人不能重复关注                               | 4    |
| 冗余 `org_id` + 两个复合外键                           | 防跨组织引用；关注者必须是成员；策略可直接按 org_id 过滤 | 4、9 |
| 两个外键都 `cascade`                                   | 关注关系是“附属”数据，随任务或成员关系消失               | 4    |
| `user_id` 索引                                         | 主键的前导列是 `task_id`                                 | 6    |
| 只授予 select/insert/delete                            | 关注记录没有可编辑的属性                                 | 8    |
| 三条策略、都 `to authenticated`、`(select auth.uid())` | 每种操作一条；性能写法                                   | 9    |

**② “我关注的任务”查询（游标分页）**

```sql
select t.id, t.number, t.title, t.updated_at
  from public.task_watchers w
  join public.active_tasks t on t.id = w.task_id
 where w.user_id = (select auth.uid())
   and (t.updated_at, t.id) < ($1, $2)       -- 第一页去掉这一行
 order by t.updated_at desc, t.id desc
 limit 20;
```

通过 supabase-js 调用时，可以做成一个 `security_invoker` 视图，或一个 `stable` 的 SQL 函数用 `.rpc()` 调用（第 5 章）。

**③ pgTAP 测试 `supabase/tests/task_watchers_rls.test.sql`**

```sql
begin;
select plan(6);

insert into auth.users (id, email) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'w1@test.example'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'w2@test.example'),
  ('eeeeeeee-0000-4000-8000-000000000003', 'outsider@test.example');
insert into public.organizations (id, slug, name, created_by) values
  ('ffffffff-0000-4000-8000-000000000001', 'watch-org', 'W', 'eeeeeeee-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id) values
  ('ffffffff-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000002');
insert into public.projects (org_id, key, name) values
  ('ffffffff-0000-4000-8000-000000000001', 'WCH', 'W 项目');
insert into public.tasks (org_id, project_id, title, created_by)
select org_id, id, '被关注的任务', 'eeeeeeee-0000-4000-8000-000000000001'
  from public.projects where key = 'WCH';
do $$
begin
  perform set_config('test.task_id', id::text, true) from public.tasks where title = '被关注的任务';
end
$$;

set local role anon;
select throws_ok($$select * from public.task_watchers$$, '42501', null, 'anon 不能读');

set local role authenticated;
set local request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000001';
select results_eq(
  $$insert into public.task_watchers (org_id, task_id)
    values ('ffffffff-0000-4000-8000-000000000001', current_setting('test.task_id')::bigint)
    returning user_id::text$$,
  array['eeeeeeee-0000-4000-8000-000000000001'],
  '成员可以关注任务'
);

set local request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000002';
select is_empty($$select * from public.task_watchers$$, '其他成员看不到别人的关注');
select results_eq(
  $$insert into public.task_watchers (org_id, task_id)
    values ('ffffffff-0000-4000-8000-000000000001', current_setting('test.task_id')::bigint)
    returning user_id::text$$,
  array['eeeeeeee-0000-4000-8000-000000000002'],
  '另一个成员也可以关注'
);

set local request.jwt.claim.sub = 'eeeeeeee-0000-4000-8000-000000000003';
select throws_ok(
  $$insert into public.task_watchers (org_id, task_id)
    values ('ffffffff-0000-4000-8000-000000000001', current_setting('test.task_id')::bigint)$$,
  '42501', null, '非成员不能关注'
);

-- 成员离开组织 → 关注记录级联消失（以 postgres 身份检查）
reset role;
delete from public.memberships
 where org_id = 'ffffffff-0000-4000-8000-000000000001'
   and user_id = 'eeeeeeee-0000-4000-8000-000000000002';
select results_eq(
  $$select count(*)::int from public.task_watchers
     where user_id = 'eeeeeeee-0000-4000-8000-000000000002'$$,
  array[0],
  '离开组织后关注记录被级联删除'
);

select * from finish();
rollback;
```

想一想“非成员不能关注”这个断言：外部用户的插入会先被**外键**（`task_watchers_member_fk`，`23503`）拦下，还是先被 **WITH CHECK**（`42501`）拦下？Postgres 先检查 RLS 的 WITH CHECK，再执行约束检查，所以这里是 `42501`。如果你的测试结果不同，以实际运行结果为准，并想清楚原因——这正是写测试的意义。

**④ 发布**

1. `npx supabase db reset && npx supabase test db`；
2. `npm run db:types`，提交迁移、测试与类型文件；
3. PR → CI → 合并到 develop → staging 自动部署 → 在 staging 运行 `post_migration_checks.sql` 和冒烟测试；
4. develop → main → 审批 → production 部署 → 再次运行验证查询（第 13 章）。

## 14.3 逐项验收

对每一项：先**不看答案**回答“能解释”的问题，再完成“能做到”的操作。

### 目标：把 Supabase 理解为托管 Postgres 及周边开发/部署能力

**能解释**：

- Supabase 由哪三部分组成？Data API、Auth、Storage 的数据分别存在 Postgres 的哪个 schema？
- 为什么说“Supabase 的安全最终是 Postgres 的安全”？

**能做到**：画出浏览器、服务端（secret key）、服务端（连接串）三条路径到数据库的完整链路，标出每一段的身份与检查点。

<details><summary>参考要点</summary>

托管的 PostgreSQL + 建立在它之上的服务（PostgREST、Auth、Storage、Realtime、Edge Functions、Supavisor）+ CLI 与部署工具链。Data API 直接读写你的 schema（通常 `public`）；Auth 的用户在 `auth`；Storage 的元数据在 `storage`。所有访问最终都落到数据库角色、GRANT 与 RLS 上。（第 1、8 章）

</details>

### Postgres：关系模型、主外键、约束、事务与隔离级别、锁与并发更新风险

**能解释**：

- 外键引用一侧会不会自动建索引？`ON DELETE` 有哪五种？
- CHECK 约束能不能查询其他表？为什么？
- Read Committed、Repeatable Read、Serializable 各防止什么？后两者为什么必须重试？
- 什么是丢失更新和写偏斜？各举一个 Teamboard 中的例子。
- 为什么一个“加列”的迁移可能让整个应用卡住？

**能做到**：

- 在 psql 中触发 23502、23503、23505、23514 四种错误；
- 用两个会话演示丢失更新，并用原子更新修复；
- 演示席位上限在禁用触发器时被突破、启用后被正确拦截；
- 制造一次死锁。

<details><summary>参考要点</summary>

不会；NO ACTION、RESTRICT、CASCADE、SET NULL、SET DEFAULT。CHECK 只能检查当前行，跨行规则用唯一约束、外键或触发器。三种隔离级别的快照范围与防止的异常见第 7 章表格；RR/Serializable 在冲突时报 40001，必须从头重试事务。丢失更新：应用层“读编号 +1 写回”；写偏斜：两个管理员同时加人超出席位。DDL 需要 ACCESS EXCLUSIVE，排队时阻塞后续所有查询，迁移要设 `lock_timeout`。（第 2、7 章）

</details>

### 表设计与范式：连接表、唯一约束、外键删除策略、软删除的成本

**能解释**：

- 用“每个事实只存一次”解释范式，并说明 `tasks.org_id` 这一冗余为什么可以接受。
- 为什么多对多不用数组列？
- 列举软删除的至少五项代价。

**能做到**：

- 为一个新的多对多关系设计连接表、主键、复合外键和删除策略（14.2 已完成）；
- 为“软删除的标签允许重建同名标签”写出部分唯一索引。

<details><summary>参考要点</summary>

冗余被复合外键保护，不会不一致，且服务于 RLS 性能。数组元素不能有外键、难以反查与建索引。软删除代价：每个查询都要过滤、唯一约束冲突、级联不生效、与 RLS SELECT 策略冲突、表与索引膨胀、个人数据仍然存在。部分唯一索引：`create unique index ... on labels (org_id, name) where deleted_at is null`。（第 4 章）

</details>

### 索引：B-tree 常见用途、复合索引顺序、EXPLAIN；索引不是越多越好

**能解释**：

- 哪些写法用不上普通 B-tree 索引？
- 复合索引 `(project_id, created_at desc, id desc)` 能服务哪些查询，不能服务哪些？
- 为什么小表上 Seq Scan 是正确的？
- 索引有哪四类成本？

**能做到**：

- 用 `explain analyze` 对比建索引前后的看板查询，指出 Sort 节点为何消失；
- 用 `pg_stat_user_indexes` 找出从未使用的索引；
- 写出生产环境建索引的安全语句。

<details><summary>参考要点</summary>

对列做函数/类型转换、前导通配符 LIKE、多数“不等于”。等值列在前、排序列其次、唯一决胜列最后；不带前导列的条件、不同的排序、部分索引之外的行都不能服务。成本：写放大、失去 HOT、空间与缓存、规划与维护开销。生产用 `create index concurrently`，单独一个迁移。（第 6 章）

</details>

### SQL：JOIN、聚合、子查询/CTE、窗口函数、NULL、排序与稳定分页

**能解释**：

- LEFT JOIN 的右表条件写在 ON 与 WHERE 有什么不同？
- 为什么同时 JOIN 两个一对多会让计数翻倍？
- 为什么 `NOT IN` 子查询遇到 NULL 会返回空？
- `row_number`、`rank`、`dense_rank` 的区别？
- 为什么分页必须有唯一的排序？OFFSET 有什么问题？

**能做到**：写出“每个项目最紧急的 2 条任务”、“每个任务最新一条评论”、“看板的游标分页”三条查询，并用 supabase-js 写出游标分页。

<details><summary>参考要点</summary>

见第 5 章各节；游标分页用 `(created_at, id) < ($1, $2)` 并以 `order by created_at desc, id desc` 排序。

</details>

### Supabase CLI、本地栈、config.toml、migration、seed、reset 与远程部署流程

**能解释**：

- `db reset` 与 `migration up` 的区别？种子数据什么时候执行？
- 为什么已推送的迁移不能修改？
- `db diff` 生成的迁移需要审阅哪些内容？
- `db push --include-seed` 和 `db reset --linked` 的风险？

**能做到**：从空目录初始化项目、写迁移、`db reset` 验证、生成类型；写出 link → migration list → db push --dry-run → db push 的命令链；写出 CI 工作流。

<details><summary>参考要点</summary>

见第 3、12 章。

</details>

### 项目环境隔离：local / preview / production，环境变量与数据库凭据按环境分开

**能解释**：

- 哪些配置与凭据必须按环境分开？生产凭据应该存在哪里？
- 预览分支默认有哪些东西、没有哪些东西？
- 为什么用环境变量注入而不是代码里 `if (prod)`？

**能做到**：为 local、staging、production 写出各自的环境变量清单；配置 CI 的按环境密钥；用 URL 检查保护只能在本地运行的脚本。

<details><summary>参考要点</summary>

见第 12 章 12.1、12.2、12.3。

</details>

### RLS：启用与未启用、USING / WITH CHECK、按用户/组织限制读写

**能解释**：

- 未启用 RLS、启用但无策略、启用且有策略三种状态的行为？谁会绕过 RLS？
- USING 与 WITH CHECK 在四种操作中的作用？哪些情况静默过滤，哪些情况报错？
- 策略递归是怎么发生的？`security definer` 辅助函数为什么能解决它，为什么必须放在不暴露的 schema？
- 为什么不能在 SELECT 策略里写 `deleted_at is null`？为什么视图要 `security_invoker`？

**能做到**：为一张新表写出 grant + 四种操作的策略 + pgTAP 测试，并用 `supabase test db` 通过（14.2 已完成）。

<details><summary>参考要点</summary>

见第 9 章。

</details>

### 数据库 API / 客户端直连与服务端直连的权限模型；secret key 只能放服务器

**能解释**：

- publishable key、secret key 分别对应哪个数据库角色？
- GRANT 与 RLS 的检查顺序？“报错”和“空结果”分别说明什么？
- 服务端代表用户访问时，为什么推荐转发用户 JWT？为什么服务端验证用户要用 `getClaims()` 而不是 `getSession()`？
- 直连数据库时 RLS 为什么不生效？如何在事务内让它生效？
- secret key 泄露后的处理顺序？

**能做到**：运行 `demo:rls`、`demo:admin`、`demo:pg`，并解释每一行输出由哪一层（grant / USING / WITH CHECK / BYPASSRLS）决定。

<details><summary>参考要点</summary>

见第 8 章。

</details>

### 连接池、direct connection、transaction pooler 的差异与选择

**能解释**：

- 直连、会话模式、事务模式、专用池的端口、IP 协议、用户名差异？
- 事务模式下哪四类会话状态会失效？为什么事务内的 `set local` 仍然安全？
- 参数化查询和预编译语句是一回事吗？

**能做到**：为浏览器、Serverless 函数、IPv4 长期服务器、备份脚本分别选择连接方式，并写出 Serverless 的 node-postgres 配置；用 `pg_stat_activity` 找出 `idle in transaction` 的连接。

<details><summary>参考要点</summary>

见第 10 章 10.2–10.5。

</details>

### Storage：桶、文件权限、生命周期、签名 URL；不要把公开桶当私有存储

**能解释**：

- 公开桶与私有桶在下载、上传、删除上的区别？为什么“UUID 文件名”不能让公开桶变私有？
- 上传、覆盖、下载、生成签名 URL、删除分别需要哪些策略？
- 签名 URL 能不能撤销？有效期应该怎么定？
- 为什么不能用 SQL 删除 `storage.objects`？数据库备份包含文件吗？

**能做到**：运行 `demo:storage` 并解释每一行；运行清理任务；写出孤儿文件扫描查询。

<details><summary>参考要点</summary>

见第 11 章。

</details>

### 备份、恢复、迁移前后验证、数据种子与个人/线上数据保护

**能解释**：

- 免费计划、Pro 计划、PITR 的备份差异？哪些东西不在数据库备份里？
- 从逻辑备份恢复时，`--single-transaction` 与 `session_replication_role = replica` 的作用？
- 误删一个组织的数据时，为什么不应该把生产整库回退？
- 为什么种子数据只能是虚构的？需要真实分布时怎么办？

**能做到**：执行一次 `db dump` 三件套备份；在临时项目完成一次恢复演练并记录耗时；对一次迁移执行完整的前后检查（`post_migration_checks.sql`）。

<details><summary>参考要点</summary>

见第 13 章。

</details>

## 14.4 最常见的十个错误

| 错误                                          | 后果                                                | 正确做法                                                | 章节    |
| --------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------- | ------- |
| 在暴露的 schema 建表却没开 RLS                | 任何拥有 grant 的角色（包括未登录访客）可读写整张表 | 建表迁移里同时 `enable row level security` + 显式 grant | 3、8、9 |
| secret key 带着 `NEXT_PUBLIC_` / `VITE_` 前缀 | key 被打包进浏览器，全库泄露                        | 只在服务端变量中使用，泄露后立即轮换                    | 8       |
| 在线上 Dashboard 直接改表                     | 环境漂移，下一次部署失败                            | 一切结构变更走迁移                                      | 3、12   |
| 修改已推送的迁移文件                          | 各环境历史不一致                                    | 写新迁移向前修复                                        | 3       |
| 应用层“先查后写”                              | 并发下丢失更新、超卖                                | 原子更新、唯一约束、行锁                                | 7       |
| 分页没有唯一排序                              | 翻页时重复或遗漏                                    | 加决胜列，使用游标分页                                  | 5       |
| 视图没有 `security_invoker`                   | 绕过 RLS 泄露数据                                   | 所有暴露的视图设置 `security_invoker = true`            | 9       |
| Serverless 使用直连 + 默认池大小              | 连接耗尽                                            | 事务模式 + 每实例 `max: 1` + 关闭预编译                 | 10      |
| 敏感文件放公开桶                              | 拿到 URL 的人都能下载，无法撤销                     | 私有桶 + RLS + 短期签名 URL                             | 11      |
| 只依赖平台备份、从不演练                      | 需要时才发现没有备份或恢复太慢                      | 自建异地备份 + 定期恢复演练                             | 13      |

## 14.5 下一步

本教程覆盖了从 0 到 1 所需的核心能力。继续深入可以沿着这些方向：

- **Auth 深入**：OAuth 提供商、多因素认证、自定义 access token hook（把组织角色放进 `app_metadata` 时要注意 JWT 时效）；
- **Realtime**：订阅数据库变更时，Realtime 同样遵守 RLS；
- **Edge Functions**：用 `@supabase/server` 处理 webhook（例如支付回调里提升 `seat_limit`）；
- **全文检索**：`tsvector` + GIN 索引，或 `pg_trgm`，解决第 6 章练习里的模糊搜索；
- **可观测性**：Query Performance、日志浏览器、`supabase inspect db` 系列命令；
- **PostgreSQL 官方文档**：第 5 章（DDL）、第 7 章（查询）、第 11 章（索引）、第 13 章（并发控制）、第 14 章（性能）是最值得通读的部分。

祝你构建顺利。
