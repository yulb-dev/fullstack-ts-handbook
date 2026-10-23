// 离线 SQL 自检：在没有 Docker 的环境里，用 PGlite（WASM 版 Postgres）验证本教程的
// 迁移、种子数据、约束、触发器与 RLS 策略是否按预期工作。
//
// 重要：这里的 auth / storage / 角色只是“最小化的桩”，用于让 SQL 能在普通 Postgres 中运行。
// 它不等于真实的 Supabase 本地栈，不能替代 `supabase db reset` 与 `supabase test db`。
// 也不能验证多连接并发（PGlite 只有一个连接），并发实验请按第 7 章在本地栈中用两个 psql 会话完成。
//
// 运行：npm run verify:offline

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase')

const ALICE = '11111111-1111-4111-8111-111111111111'
const BOB = '22222222-2222-4222-8222-222222222222'
const CAROL = '33333333-3333-4333-8333-333333333333'
const DAVE = '44444444-4444-4444-8444-444444444444'
const ERIN = '55555555-5555-4555-8555-555555555555'
const ACME = 'a0000000-0000-4000-8000-000000000001'
const GLOBEX = 'a0000000-0000-4000-8000-000000000002'

// 与 Supabase 行为相近的最小桩：三个 API 角色、auth.users、auth.uid()、storage 两张表与辅助函数
const supabaseStub = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text unique,
  raw_user_meta_data jsonb not null default '{}',
  raw_app_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner_id text,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
`

const db = new PGlite()
let passed = 0

function ok(name) {
  passed += 1
  console.log(`  ✓ ${name}`)
}

async function scalar(sql, params = []) {
  const { rows } = await db.query(sql, params)
  return rows[0] ? Object.values(rows[0])[0] : undefined
}

// 在一个事务里以某个身份执行，结束时总是回滚，互不污染
async function as(role, userId, fn) {
  await db.exec('begin')
  try {
    await db.exec(`set local role ${role}`)
    if (userId) await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
    return await fn()
  } finally {
    await db.exec('rollback')
  }
}

async function expectError(promise, code, name) {
  try {
    await promise
  } catch (error) {
    assert.equal(error.code, code, `${name}: expected ${code}, got ${error.code} (${error.message})`)
    ok(`${name} → ${code}`)
    return
  }
  assert.fail(`${name}: expected error ${code}, but it succeeded`)
}

console.log('1. 应用桩、迁移与种子数据')
await db.exec(supabaseStub)
const migrations = readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()
for (const file of migrations) {
  await db.exec(readFileSync(join(root, 'migrations', file), 'utf8'))
  ok(`migration ${file}`)
}
await db.exec(readFileSync(join(root, 'seed.sql'), 'utf8'))
ok('seed.sql')

console.log('2. 触发器与约束（以 postgres 身份）')
assert.equal(await scalar('select count(*)::int from public.profiles'), 5)
ok('每个 auth.users 自动生成 profile')
assert.equal(await scalar(`select role::text from public.memberships where org_id = $1 and user_id = $2`, [ACME, ALICE]), 'owner')
ok('组织创建者自动成为 owner')
const numbers = await db.query(`
  select p.key, array_agg(t.number order by t.number) as nums, max(p.next_task_number) as next
    from public.tasks t join public.projects p on p.id = t.project_id
   group by p.key order by p.key`)
assert.deepEqual(numbers.rows.map((r) => [r.key, r.nums, r.next]), [
  ['API', [1, 2, 3, 4], 5],
  ['APP', [1, 2, 3, 4], 5],
  ['WEB', [1, 2, 3, 4, 5, 6], 7],
])
ok('任务编号按项目连续分配，计数器同步前进')

await expectError(db.query(`insert into public.organizations (slug, name) values ('acme', '重名')`), '23505', '重复 slug')
await expectError(db.query(`insert into public.organizations (slug, name) values ('Bad Slug', 'x')`), '23514', '非法 slug 格式')
await expectError(
  db.query(`insert into public.task_labels (org_id, task_id, label_id)
            select $1, t.id, l.id from public.tasks t, public.labels l
             where t.org_id = $1 and l.org_id = $2 limit 1`, [ACME, GLOBEX]),
  '23503', '跨组织挂标签被复合外键拒绝')
await expectError(
  db.query(`update public.tasks set assignee_id = $1 where org_id = $2 and number = 1`, [DAVE, ACME]),
  '23503', '负责人必须是本组织成员')
await expectError(
  db.query(`insert into public.tasks (org_id, project_id, title)
            select $1, id, 'x' from public.projects where key = 'API'`, [ACME]),
  '23503', '任务所属组织与项目不一致')

await db.exec('begin')
await db.query(`delete from public.memberships where org_id = $1 and user_id = $2`, [ACME, BOB])
assert.equal(await scalar(`select count(*)::int from public.tasks where org_id = $1 and assignee_id = $2`, [ACME, BOB]), 0)
assert.ok((await scalar(`select count(*)::int from public.tasks where org_id = $1`, [ACME])) === 10)
await db.exec('rollback')
ok('移除成员：只把其任务的 assignee_id 置空，任务本身保留')

await db.exec('begin')
await db.query(`update public.organizations set seat_limit = 3 where id = $1`, [ACME])
await expectError(
  db.query(`insert into public.memberships (org_id, user_id) values ($1, $2)`, [ACME, DAVE]),
  'P0001', '超出席位上限')
await db.exec('rollback')

const before = await scalar(`select updated_at::text from public.tasks where number = 2 and org_id = $1 and project_id = (select id from public.projects where key = 'WEB')`, [ACME])
await db.exec('begin')
await db.query(`update public.tasks set status = 'done' where number = 2 and org_id = $1 and project_id = (select id from public.projects where key = 'WEB')`, [ACME])
const after = await scalar(`select updated_at::text from public.tasks where number = 2 and org_id = $1 and project_id = (select id from public.projects where key = 'WEB')`, [ACME])
await db.exec('rollback')
assert.notEqual(before, after)
ok('updated_at 由触发器刷新')

console.log('3. Grants 与 RLS（模拟 Data API 角色）')
await as('anon', null, () =>
  expectError(db.query('select * from public.tasks'), '42501', 'anon 没有 grant，直接报权限错误'))

await as('authenticated', ALICE, async () => {
  assert.equal(await scalar('select count(*)::int from public.tasks'), 10)
  assert.equal(await scalar(`select count(*)::int from public.tasks where org_id = $1`, [GLOBEX]), 0)
  assert.equal(await scalar('select count(*)::int from public.active_tasks'), 9)
  ok('Alice 只看到 Acme 的 10 条任务；active_tasks 视图隐藏回收站中的 1 条')
})

await as('authenticated', BOB, async () => {
  assert.equal(await scalar('select count(*)::int from public.tasks'), 14)
  assert.equal(await scalar('select count(*)::int from public.profiles'), 5)
  ok('Bob 同属两个组织，看到 14 条任务和所有队友的 profile')
})

await as('authenticated', DAVE, async () => {
  assert.equal(await scalar('select count(*)::int from public.profiles'), 2)
  ok('Dave 只看到自己与同组织队友（Bob）的 profile')
})

await as('authenticated', ALICE, async () => {
  const { affectedRows } = await db.query(`update public.tasks set title = 'hacked' where org_id = $1`, [GLOBEX])
  assert.equal(affectedRows, 0)
  ok('跨组织 UPDATE：USING 过滤掉目标行，影响 0 行且不报错')
})

const apiProjectId = await scalar(`select id from public.projects where key = 'API'`)
await as('authenticated', ALICE, () =>
  expectError(
    db.query(`insert into public.tasks (org_id, project_id, title) values ($1, $2, '越权')`, [GLOBEX, apiProjectId]),
    '42501', '向别的组织插入任务被 WITH CHECK 拒绝'))

await as('authenticated', ALICE, () =>
  expectError(
    db.query(`insert into public.tasks (org_id, project_id, title, created_by)
              select org_id, id, '冒名', $2 from public.projects where org_id = $1 limit 1`, [ACME, BOB]),
    '42501', '冒充他人 created_by 被 WITH CHECK 拒绝'))

await as('authenticated', BOB, async () => {
  const { rows } = await db.query(`
    insert into public.tasks (org_id, project_id, title)
    select org_id, id, '成员新建的任务' from public.projects where key = 'WEB'
    returning number, created_by`)
  assert.deepEqual(rows, [{ number: 7, created_by: BOB }])
  ok('成员插入任务：编号由触发器分配，created_by 默认为 auth.uid()')
})

await as('authenticated', BOB, async () => {
  const { rows } = await db.query(`
    update public.tasks set deleted_at = now()
     where org_id = $1 and number = 5 and project_id = (select id from public.projects where key = 'WEB')
    returning id`, [ACME])
  assert.equal(rows.length, 1)
  ok('软删除（UPDATE deleted_at ... RETURNING）不会被 SELECT 策略拦下')
})

await as('authenticated', BOB, () =>
  expectError(db.query(`update public.projects set next_task_number = 1`), '42501', '列级权限：客户端不能改 next_task_number'))
await as('authenticated', BOB, () =>
  expectError(db.query(`update public.tasks set org_id = $1`, [GLOBEX]), '42501', '列级权限：不能把任务搬到别的组织'))
await as('authenticated', BOB, () =>
  expectError(db.query(`delete from public.tasks`), '42501', '客户端没有 tasks 的 delete 权限（只能软删除）'))

await as('authenticated', BOB, async () => {
  const { affectedRows } = await db.query(`delete from public.memberships where user_id = $1 and org_id = $2`, [CAROL, ACME])
  assert.equal(affectedRows, 0)
  ok('普通成员不能移除别人（USING 过滤，影响 0 行）')
})

await as('authenticated', CAROL, () =>
  expectError(
    db.query(`insert into public.memberships (org_id, user_id, role) values ($1, $2, 'owner')`, [ACME, DAVE]),
    '42501', '管理员不能直接任命 owner'))

await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'erin@example.test', '{"display_name":"Erin"}')`, [ERIN])
await as('authenticated', ERIN, async () => {
  const { rows } = await db.query(`
    insert into public.organizations (slug, name) values ('erin-lab', 'Erin 的实验室') returning id, created_by`)
  assert.equal(rows[0].created_by, ERIN)
  const role = await scalar(`select role::text from public.memberships where org_id = $1`, [rows[0].id])
  assert.equal(role, 'owner')
  ok('新用户创建组织：insert ... returning 能读回，且自动成为 owner')
})

await as('authenticated', ERIN, () =>
  expectError(
    db.query(`insert into public.organizations (slug, name, created_by) values ('fake-org', 'x', $1)`, [ALICE]),
    '42501', '不能以他人名义创建组织'))

console.log('4. Storage 策略（storage.objects 桩）')
await as('authenticated', BOB, async () => {
  await db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('task-attachments', $1, $2)`, [`${ACME}/1/spec.pdf`, BOB])
  ok('成员可上传到自己组织的目录')
})
await as('authenticated', DAVE, () =>
  expectError(
    db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('task-attachments', $1, $2)`, [`${ACME}/1/x.pdf`, DAVE]),
    '42501', '非成员不能上传到别的组织目录'))
await as('authenticated', DAVE, () =>
  expectError(
    db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('task-attachments', 'not-a-uuid/x.pdf', $1)`, [DAVE]),
    '42501', '任意路径不会因类型转换报错，只是被策略拒绝'))
await db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('task-attachments', $1, $2)`, [`${ACME}/1/design.png`, ALICE])
await as('authenticated', DAVE, async () => {
  assert.equal(await scalar(`select count(*)::int from storage.objects where bucket_id = 'task-attachments'`), 0)
  ok('非成员看不到别的组织的附件对象')
})
await as('authenticated', BOB, async () => {
  const { affectedRows } = await db.query(`delete from storage.objects where name = $1`, [`${ACME}/1/design.png`])
  assert.equal(affectedRows, 0)
  ok('只能删除自己上传的附件对象')
})
await as('authenticated', ALICE, () =>
  expectError(
    db.query(`insert into storage.objects (bucket_id, name, owner_id) values ('avatars', $1, $2)`, [`${BOB}/avatar.png`, ALICE]),
    '42501', '头像只能写自己的目录'))

console.log('5. 文件生命周期与回收站清理')
await db.exec('begin')
const taskId = await scalar(`select id from public.tasks where org_id = $1 and number = 1 and project_id = (select id from public.projects where key = 'WEB')`, [ACME])
await db.query(`insert into public.attachments (org_id, task_id, object_path, file_name, uploaded_by)
                values ($1, $2, $3, 'design.png', $4)`, [ACME, taskId, `${ACME}/${taskId}/design.png`, ALICE])
await expectError(
  db.query(`insert into public.attachments (org_id, task_id, object_path, file_name) values ($1, $2, $3, 'x')`, [ACME, taskId, `${GLOBEX}/${taskId}/x`]),
  '23514', '附件路径第一段必须是自己的 org_id')
await db.exec('rollback')

await db.exec('begin')
await db.query(`insert into public.attachments (org_id, task_id, object_path, file_name, uploaded_by)
                values ($1, $2, $3, 'design.png', $4)`, [ACME, taskId, `${ACME}/${taskId}/design.png`, ALICE])
await db.query(`update public.tasks set deleted_at = now() - interval '40 days' where id = $1`, [taskId])
const purged = await scalar(`select private.purge_deleted_tasks('30 days')`)
assert.equal(purged, 2) // 种子里本来就有一条 2026-09-15 软删除的任务
assert.equal(await scalar(`select count(*)::int from private.storage_cleanup_queue`), 1)
await db.exec('rollback')
ok('清理回收站：级联删除附件元数据，文件路径进入清理队列')

console.log('6. 用简化版 pgTAP 函数跑 supabase/tests/*.test.sql')
// 只实现了测试文件用到的几个函数，失败时直接抛异常；真实环境请用 supabase test db。
await db.exec(`
create function public.plan(integer) returns text language sql as $$ select '1..' || $1 $$;
create function public.finish() returns setof text language sql as $$ select null::text where false $$;
create function public.ok(boolean, text) returns text language plpgsql as $$
begin
  if not coalesce($1, false) then raise exception 'not ok: %', $2; end if;
  return 'ok - ' || $2;
end $$;
create function public.throws_ok(text, text, text, text) returns text language plpgsql as $$
begin
  begin
    execute $1;
  exception when others then
    if sqlstate = $2 then return 'ok - ' || $4; end if;
    raise exception 'not ok: % (got %: %)', $4, sqlstate, sqlerrm;
  end;
  raise exception 'not ok: % (no error raised)', $4;
end $$;
create function public.results_eq(text, anyarray, text) returns text language plpgsql as $$
declare got text;
begin
  execute format(
    'with q as (%s) select coalesce(array_agg(v), ''{}'')::text from (select (to_jsonb(q) ->> (select k from jsonb_object_keys(to_jsonb(q)) k limit 1)) as v from q) s',
    $1) into got;
  if got is distinct from (select array_agg(e::text)::text from unnest($2) e) then
    raise exception 'not ok: % (got %, expected %)', $3, got, $2;
  end if;
  return 'ok - ' || $3;
end $$;
create function public.is_empty(text, text) returns text language plpgsql as $$
declare n integer;
begin
  execute format('with q as (%s) select count(*) from q', $1) into n;
  if n <> 0 then raise exception 'not ok: % (% rows)', $2, n; end if;
  return 'ok - ' || $2;
end $$;
`)
for (const file of readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.test.sql')).sort()) {
  await db.exec(readFileSync(join(root, 'tests', file), 'utf8'))
  ok(`tests/${file}`)
}

console.log(`\n全部 ${passed} 项检查通过。`)
await db.close()
