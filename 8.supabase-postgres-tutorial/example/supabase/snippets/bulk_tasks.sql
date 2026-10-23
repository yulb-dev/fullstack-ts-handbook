-- supabase/snippets/bulk_tasks.sql
-- 第 6 章性能实验：在“本地”数据库里生成 10 万条任务。
-- 只在本地栈执行：psql "$LOCAL_DB_URL" -f supabase/snippets/bulk_tasks.sql
-- 它不在 seed.sql 里，因此不会拖慢日常的 db reset；下次 db reset 时这些数据会被清掉。

begin;

insert into public.organizations (id, slug, name, seat_limit, created_by)
values ('b0000000-0000-4000-8000-00000000000b', 'bigco', '压测组织', 1000,
        '11111111-1111-4111-8111-111111111111');

insert into public.memberships (org_id, user_id, role)
values ('b0000000-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'member');

-- 20 个项目：PAA、PAB ... PAT
insert into public.projects (org_id, key, name)
select 'b0000000-0000-4000-8000-00000000000b',
       'PA' || chr(65 + g),
       '压测项目 ' || g
  from generate_series(0, 19) as g;

with ps as (
  select id, org_id, row_number() over (order by id) - 1 as idx
    from public.projects
   where org_id = 'b0000000-0000-4000-8000-00000000000b'
)
insert into public.tasks (org_id, project_id, title, status, priority, assignee_id,
                          created_by, due_on, created_at, deleted_at)
select ps.org_id,
       ps.id,
       '压测任务 #' || g,
       (array['todo', 'doing', 'done'])[1 + g % 3]::public.task_status,
       1 + g % 4,
       case when g % 5 = 0 then null
            else (array['11111111-1111-4111-8111-111111111111',
                        '22222222-2222-4222-8222-222222222222'])[1 + g % 2]::uuid
       end,
       '11111111-1111-4111-8111-111111111111',
       date '2026-10-01' + (g % 90),
       timestamptz '2026-01-01 00:00:00+08' + make_interval(mins => g),
       case when g % 10 = 0 then timestamptz '2026-10-01 00:00:00+08' end
  from generate_series(1, 100000) as g
  join ps on ps.idx = g % 20;

commit;

-- 让规划器拿到最新的统计信息（autovacuum 迟早也会做，但实验时不要等）
analyze public.tasks;
