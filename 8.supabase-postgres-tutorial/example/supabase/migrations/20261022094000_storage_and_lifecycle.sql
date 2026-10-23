-- 第 11 章：Storage 桶、对象访问策略，以及“文件生命周期”所需的清理队列。

-- ---------------------------------------------------------------------------
-- 1. 桶（bucket）是 storage.buckets 表里的行，属于数据（DML），db diff 不会自动捕获，
--    因此显式写进迁移；on conflict 让它在任何环境重复执行都安全。
-- ---------------------------------------------------------------------------

-- 私有桶：任务附件。下载必须经过 RLS 或短期签名 URL。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments',
  'task-attachments',
  false,
  10485760, -- 10 MiB
  array['image/png', 'image/jpeg', 'application/pdf', 'text/plain']
)
on conflict (id) do nothing;

-- 公开桶：头像。任何拿到 URL 的人都能下载，只放“本来就打算公开”的内容。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  1048576, -- 1 MiB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. storage.objects 上的策略
--    路径约定：task-attachments/{org_id}/{task_id}/{随机文件名}
--              avatars/{user_id}/{文件名}
--    storage.foldername(name) 返回目录数组，[1] 是第一层目录。
--    这里一律用文本比较，不把路径强转 uuid：任意字符串强转失败会让整条查询报错。
-- ---------------------------------------------------------------------------

create policy "attachments bucket: members read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'task-attachments'
  and (storage.foldername(name))[1] in (
    select org_id::text from private.user_org_ids() as org_id
  )
);

create policy "attachments bucket: members upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'task-attachments'
  and (storage.foldername(name))[1] in (
    select org_id::text from private.user_org_ids() as org_id
  )
);

create policy "attachments bucket: uploader deletes"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'task-attachments'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] in (
    select org_id::text from private.user_org_ids() as org_id
  )
);

-- 头像：只能写自己的目录。公开桶的下载不经过 SELECT 策略；
-- 这里的 SELECT 策略是为了 upsert 覆盖（需要 SELECT + UPDATE）以及只列出自己的文件。
create policy "avatars bucket: owner reads own folder"
on storage.objects for select
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "avatars bucket: owner uploads to own folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "avatars bucket: owner updates own folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "avatars bucket: owner deletes own folder"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- ---------------------------------------------------------------------------
-- 3. 文件生命周期：数据库事务无法调用 Storage API 删除文件。
--    做法是“发件箱”：删除 attachments 行时，在同一事务里登记待删除路径；
--    服务端任务（scripts/storage-cleanup.mjs）通过直连读取队列，
--    用 secret key 调用 Storage API 删除文件，成功后再出队。
-- ---------------------------------------------------------------------------
create table private.storage_cleanup_queue (
  id bigint generated always as identity primary key,
  bucket_id text not null,
  object_path text not null,
  enqueued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  constraint storage_cleanup_queue_object_key unique (bucket_id, object_path)
);

-- 普通成员删除附件时也要能入队，但他们对 private 里的队列没有任何权限，
-- 所以这个触发器函数需要 security definer。
create function private.enqueue_attachment_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.storage_cleanup_queue (bucket_id, object_path)
  values ('task-attachments', old.object_path)
  on conflict (bucket_id, object_path) do nothing;
  return old;
end;
$$;

create trigger attachments_enqueue_cleanup
  after delete on public.attachments
  for each row execute function private.enqueue_attachment_cleanup();

-- 有了清理队列，删除任务时就可以级联删除附件元数据（文件随后由清理任务删除）。
-- 这是一次“约束演进”：先删旧约束，再加同名新约束，放在同一份迁移（同一事务）里完成。
alter table public.attachments
  drop constraint attachments_task_fk,
  add constraint attachments_task_fk foreign key (task_id, org_id)
    references public.tasks (id, org_id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 4. 回收站清理：硬删除软删除超过保留期的任务（分批，避免长事务与长时间持锁）。
--    不授予任何客户端角色；由服务端通过直连（postgres 角色）调用，或交给 pg_cron 定时执行。
-- ---------------------------------------------------------------------------
create function private.purge_deleted_tasks(p_older_than interval, p_batch_size integer default 500)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.tasks
   where id in (
     select id
       from public.tasks
      where deleted_at is not null
        and deleted_at < now() - p_older_than
      order by deleted_at
      limit p_batch_size
   );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function private.purge_deleted_tasks(interval, integer) from public;
revoke all on table private.storage_cleanup_queue from anon, authenticated, service_role;
