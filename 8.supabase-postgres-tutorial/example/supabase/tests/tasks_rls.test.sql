-- supabase/tests/tasks_rls.test.sql
-- 运行：supabase test db（需要本地栈已启动）
-- 按官方建议：每张启用 RLS 的表一个测试文件；整个文件在事务中执行，最后回滚，不污染数据库。
-- 这里自建夹具数据（与 seed.sql 使用不同的 UUID），因此不依赖种子数据的内容。
begin;
select plan(13);

-- ---------------------------------------------------------------------------
-- 夹具（以 postgres 身份）：组织 A（u1 owner、u2 member），组织 B（u3 owner）
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'u1@test.example', '{"display_name":"U1"}'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'u2@test.example', '{"display_name":"U2"}'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'u3@test.example', '{"display_name":"U3"}');

insert into public.organizations (id, slug, name, created_by) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'test-org-a', 'A', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'test-org-b', 'B', 'aaaaaaaa-0000-4000-8000-000000000003');

insert into public.memberships (org_id, user_id, role) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000002', 'member');

insert into public.projects (org_id, key, name) values
  ('bbbbbbbb-0000-4000-8000-00000000000a', 'TSTA', 'A 项目'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'TSTB', 'B 项目');

insert into public.tasks (org_id, project_id, title, created_by)
select org_id, id, name || '的任务', 'aaaaaaaa-0000-4000-8000-000000000001'
  from public.projects where key = 'TSTA';
insert into public.tasks (org_id, project_id, title, created_by)
select org_id, id, name || '的任务', 'aaaaaaaa-0000-4000-8000-000000000003'
  from public.projects where key = 'TSTB';

-- 切换到 authenticated 后就看不到 B 的项目了，先把它的 id 记在事务级配置里
-- （用 do 块而不是 select，避免在 TAP 输出里多出一行普通结果）
do $$
begin
  perform set_config('test.project_b_id', id::text, true)
     from public.projects where key = 'TSTB';
end
$$;

-- ---------------------------------------------------------------------------
-- 结构性检查：RLS 已启用、grant 符合设计
-- ---------------------------------------------------------------------------
select ok(
  (select relrowsecurity from pg_class where oid = 'public.tasks'::regclass),
  'tasks 已启用 RLS'
);
select ok(
  not has_table_privilege('anon', 'public.tasks', 'select,insert,update,delete'),
  'anon 对 tasks 没有任何 grant'
);
select ok(
  not has_table_privilege('authenticated', 'public.tasks', 'delete'),
  'authenticated 没有 delete 权限（只能软删除）'
);

-- ---------------------------------------------------------------------------
-- anon：在任何策略执行之前就被 grant 拒绝
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from public.tasks$$, '42501', null, 'anon 不能读 tasks');

-- ---------------------------------------------------------------------------
-- u2（A 的成员）
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000002';

select results_eq(
  $$select title from public.tasks where org_id in ('bbbbbbbb-0000-4000-8000-00000000000a', 'bbbbbbbb-0000-4000-8000-00000000000b')$$,
  array['A 项目的任务'],
  '成员只读到本组织的任务'
);

select results_eq(
  $$insert into public.tasks (org_id, project_id, title)
    select org_id, id, '成员新建' from public.projects where key = 'TSTA'
    returning number$$,
  array[2],
  '成员可以新建任务，编号由触发器分配'
);

-- 必须用真实存在的项目 id：若用子查询去查，RLS 会让它返回 NULL，测到的就是另一种错误了
select throws_ok(
  $$insert into public.tasks (org_id, project_id, title)
    values ('bbbbbbbb-0000-4000-8000-00000000000b',
            current_setting('test.project_b_id')::bigint, '越权')$$,
  '42501',
  null,
  '不能向别的组织写任务（WITH CHECK）'
);

select is_empty(
  $$update public.tasks set title = '篡改'
     where org_id = 'bbbbbbbb-0000-4000-8000-00000000000b' returning id$$,
  '更新别的组织的任务：匹配 0 行'
);

select results_eq(
  $$update public.tasks set deleted_at = now()
     where org_id = 'bbbbbbbb-0000-4000-8000-00000000000a' and number = 1
    returning number$$,
  array[1],
  '成员可以软删除任务'
);

select results_eq(
  $$select count(*)::int from public.active_tasks where org_id = 'bbbbbbbb-0000-4000-8000-00000000000a'$$,
  array[1],
  'active_tasks 不再显示已软删除的任务'
);

select throws_ok(
  $$update public.projects set next_task_number = 1$$,
  '42501',
  null,
  '列级权限：不能改编号计数器'
);

select throws_ok(
  $$delete from public.tasks$$,
  '42501',
  null,
  '没有 delete grant：不能硬删除任务'
);

-- 被拒绝的写入只证明“匹配 0 行”，还要以有权限的身份确认目标行完好无损
set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000003';
select results_eq(
  $$select title from public.tasks where org_id = 'bbbbbbbb-0000-4000-8000-00000000000b'$$,
  array['B 项目的任务'],
  'B 组织的任务没有被篡改'
);

select * from finish();
rollback;
