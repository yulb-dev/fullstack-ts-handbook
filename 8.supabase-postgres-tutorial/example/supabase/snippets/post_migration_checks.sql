-- supabase/snippets/post_migration_checks.sql
-- 第 13 章：迁移前后的验证查询。每一段都应该返回 0 行（第 9 段除外，它输出行数快照用于前后对比）。
-- 本地：psql "$DATABASE_URL" -f supabase/snippets/post_migration_checks.sql
-- 线上：用只读心态执行（这些查询只读），连接方式见第 10 章。

\echo '1. public 中没有启用 RLS 的表（应为 0 行）'
select c.relname as table_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind in ('r', 'p')
   and not c.relrowsecurity;

\echo '2. public 中没有设置 security_invoker 的视图（应为 0 行）'
select c.relname as view_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'v'
   and not coalesce('security_invoker=true' = any (c.reloptions), false);

\echo '3. anon 在 public 中拥有的表权限（本应用应为 0 行）'
select table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
  from information_schema.role_table_grants
 where grantee = 'anon'
   and table_schema = 'public'
 group by table_name;

\echo '4. 暴露的 schema 中的 security definer 函数（应为 0 行）'
select n.nspname as schema, p.proname as function_name
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'graphql_public')
   and p.prosecdef;

\echo '5. 没有固定 search_path 的 security definer 函数（应为 0 行）'
select n.nspname as schema, p.proname as function_name
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where p.prosecdef
   and n.nspname in ('public', 'private')
   and not exists (
     select 1 from unnest(coalesce(p.proconfig, '{}')) as cfg where cfg like 'search_path=%'
   );

\echo '6. 无效索引（create index concurrently 失败留下的，应为 0 行）'
select i.indexrelid::regclass as index_name, i.indrelid::regclass as table_name
  from pg_index i
  join pg_class c on c.oid = i.indrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'private', 'storage')
   and not i.indisvalid;

\echo '7. 尚未验证的约束（not valid 之后忘了 validate，应为 0 行）'
select conrelid::regclass as table_name, conname as constraint_name
  from pg_constraint
 where connamespace in ('public'::regnamespace, 'private'::regnamespace)
   and not convalidated;

\echo '8. 业务不变量（应为 0 行）'
-- 8a 超出席位上限的组织
select o.slug, count(*) as members, o.seat_limit
  from public.organizations o
  join public.memberships m on m.org_id = o.id
 group by o.id, o.slug, o.seat_limit
having count(*) > o.seat_limit;

-- 8b 没有 owner 的组织
select o.slug
  from public.organizations o
 where not exists (
   select 1 from public.memberships m where m.org_id = o.id and m.role = 'owner'
 );

-- 8c 编号计数器落后于已有编号的项目
select p.key, p.next_task_number, max(t.number) as max_number
  from public.projects p
  join public.tasks t on t.project_id = p.id
 group by p.id, p.key, p.next_task_number
having p.next_task_number <= max(t.number);

-- 8d 数据库登记了、但 Storage 中不存在的附件
select a.object_path
  from public.attachments a
  left join storage.objects o
    on o.bucket_id = 'task-attachments' and o.name = a.object_path
 where o.id is null;

\echo '9. 行数快照（迁移前后各执行一次并对比）'
select 'organizations' as table_name, count(*) as row_count from public.organizations
union all select 'memberships', count(*) from public.memberships
union all select 'projects',    count(*) from public.projects
union all select 'tasks',       count(*) from public.tasks
union all select 'labels',      count(*) from public.labels
union all select 'task_labels', count(*) from public.task_labels
union all select 'comments',    count(*) from public.comments
union all select 'attachments', count(*) from public.attachments
order by table_name;
