-- supabase/tests/memberships_rls.test.sql
-- 覆盖：创建组织自动成为 owner、角色边界、席位上限、退出组织、profiles 可见性。
begin;
select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('cccccccc-0000-4000-8000-000000000001', 'owner@test.example',    '{"display_name":"Owner"}'),
  ('cccccccc-0000-4000-8000-000000000002', 'admin@test.example',    '{"display_name":"Admin"}'),
  ('cccccccc-0000-4000-8000-000000000003', 'member@test.example',   '{"display_name":"Member"}'),
  ('cccccccc-0000-4000-8000-000000000004', 'outsider@test.example', '{"display_name":"Outsider"}');

-- ---------------------------------------------------------------------------
-- 以“新用户”身份通过 RLS 创建组织
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000001';

select results_eq(
  $$insert into public.organizations (id, slug, name, seat_limit)
    values ('dddddddd-0000-4000-8000-000000000001', 'test-team', '测试团队', 3)
    returning slug$$,
  array['test-team'],
  '登录用户可以创建组织，并能读回刚创建的行'
);

select results_eq(
  $$select role::text from public.memberships
     where org_id = 'dddddddd-0000-4000-8000-000000000001'
       and user_id = 'cccccccc-0000-4000-8000-000000000001'$$,
  array['owner'],
  '创建者自动成为 owner'
);

select results_eq(
  $$insert into public.memberships (org_id, user_id, role) values
      ('dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002', 'admin'),
      ('dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003', 'member')
    returning role::text$$,
  array['admin', 'member'],
  'owner 可以添加管理员与成员'
);

select throws_ok(
  $$insert into public.memberships (org_id, user_id)
    values ('dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000004')$$,
  'P0001',
  null,
  '席位已满（3/3）时拒绝加人'
);

-- ---------------------------------------------------------------------------
-- 管理员的边界
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000002';

select throws_ok(
  $$update public.organizations set seat_limit = 100
     where id = 'dddddddd-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  '客户端不能修改 seat_limit（没有该列的 update 权限）'
);

select is_empty(
  $$delete from public.memberships
     where org_id = 'dddddddd-0000-4000-8000-000000000001'
       and user_id = 'cccccccc-0000-4000-8000-000000000001'
    returning user_id$$,
  '管理员不能移除 owner'
);

-- ---------------------------------------------------------------------------
-- 普通成员
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000003';

select results_eq(
  $$delete from public.memberships
     where org_id = 'dddddddd-0000-4000-8000-000000000001'
       and user_id = 'cccccccc-0000-4000-8000-000000000003'
    returning role::text$$,
  array['member'],
  '成员可以自己退出组织'
);

-- ---------------------------------------------------------------------------
-- 局外人
-- ---------------------------------------------------------------------------
set local request.jwt.claim.sub = 'cccccccc-0000-4000-8000-000000000004';

select results_eq(
  $$select display_name from public.profiles
     where id in ('cccccccc-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000004')
     order by display_name$$,
  array['Outsider'],
  '局外人只看得到自己的 profile'
);

select is_empty(
  $$select id from public.organizations where id = 'dddddddd-0000-4000-8000-000000000001'$$,
  '局外人看不到别人的组织'
);

select * from finish();
rollback;
