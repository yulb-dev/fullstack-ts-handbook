-- 第 8、9 章：Data API 权限（grants）与行级安全策略（RLS）。
--
-- 两层检查的顺序：
--   1. grant 决定某个角色能不能对这张表执行某种操作（没有 → 42501 错误）；
--   2. RLS 策略决定这次操作能作用于哪些行（不匹配 → 读不到 / 改不到 / 写入被拒）。
-- 本迁移对两层都做显式声明，不依赖项目是否“自动暴露新表”。

-- ---------------------------------------------------------------------------
-- 1. RLS 辅助函数（放在不暴露的 private schema）
-- ---------------------------------------------------------------------------

-- 当前用户所属的全部组织。
-- security definer：函数内读取 memberships 时不再触发 memberships 自己的策略，避免策略互相递归。
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

-- 当前用户在某组织中是否拥有指定角色之一。
create function private.has_org_role(p_org_id uuid, p_roles public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.memberships
     where org_id = p_org_id
       and user_id = (select auth.uid())
       and role = any (p_roles)
  )
$$;

revoke all on function private.user_org_ids() from public;
revoke all on function private.has_org_role(uuid, public.org_role[]) from public;
grant usage on schema private to authenticated;
grant execute on function private.user_org_ids() to authenticated;
grant execute on function private.has_org_role(uuid, public.org_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Grants：先全部收回，再只授予应用真正需要的操作
--    anon（未登录访客）在本应用里什么都不能访问，因此不授予任何权限。
-- ---------------------------------------------------------------------------

-- profiles：只能读；只能改 display_name 这一列
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- organizations：seat_limit 只能由服务端（计费逻辑）修改，客户端只能改 name
grant select, insert, delete on public.organizations to authenticated;
grant update (name) on public.organizations to authenticated;

-- memberships：只允许修改 role
grant select, insert, delete on public.memberships to authenticated;
grant update (role) on public.memberships to authenticated;

-- projects：next_task_number 不在可更新列中，客户端无法篡改编号计数器
grant select, insert, delete on public.projects to authenticated;
grant update (name, archived_at) on public.projects to authenticated;

-- tasks：没有 delete 权限，客户端只能软删除（更新 deleted_at）；
-- 不能修改 org_id / project_id，因此无法把任务“搬”到别的组织。
grant select, insert on public.tasks to authenticated;
grant update (title, status, priority, assignee_id, due_on, deleted_at) on public.tasks to authenticated;

grant select, insert, delete on public.labels to authenticated;
grant update (name, color) on public.labels to authenticated;

grant select, insert, delete on public.task_labels to authenticated;

grant select, insert, delete on public.comments to authenticated;
grant update (body) on public.comments to authenticated;

grant select, insert, delete on public.attachments to authenticated;

-- service_role（secret key）会绕过 RLS，但仍然需要 grant。
grant select, insert, update, delete on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- 3. 策略：每种操作单独一条，并始终写 to authenticated
--    (select auth.uid()) 写成子查询，让优化器每条语句只计算一次。
-- ---------------------------------------------------------------------------

-- profiles ------------------------------------------------------------------
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
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- organizations -------------------------------------------------------------
-- created_by 条件让 insert ... returning（supabase-js 的 .insert().select()）能读回刚创建的组织
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

-- memberships ---------------------------------------------------------------
create policy "memberships: members read"
on public.memberships for select
to authenticated
using (org_id in (select private.user_org_ids()));

-- 管理员可以加人，但不能直接任命 owner（所有权转移走服务端流程）
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

-- 成员可以自己退出；管理员可以移除非 owner 成员
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

-- projects ------------------------------------------------------------------
create policy "projects: members read"
on public.projects for select
to authenticated
using (org_id in (select private.user_org_ids()));

create policy "projects: admins create"
on public.projects for insert
to authenticated
with check ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));

create policy "projects: admins update"
on public.projects for update
to authenticated
using ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])))
with check ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));

create policy "projects: owners delete"
on public.projects for delete
to authenticated
using ((select private.has_org_role(org_id, array['owner']::public.org_role[])));

-- tasks ---------------------------------------------------------------------
-- 注意：读取策略没有写 deleted_at is null。
-- 若写了，成员把任务软删除（UPDATE deleted_at）时，新行不再满足 SELECT 策略，UPDATE 会直接报错。
-- “回收站里的任务不在看板上显示”属于业务视图，交给 active_tasks 视图或查询条件（第 4、9 章）。
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

-- labels --------------------------------------------------------------------
create policy "labels: members read"
on public.labels for select
to authenticated
using (org_id in (select private.user_org_ids()));

create policy "labels: admins create"
on public.labels for insert
to authenticated
with check ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));

create policy "labels: admins update"
on public.labels for update
to authenticated
using ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])))
with check ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));

create policy "labels: admins delete"
on public.labels for delete
to authenticated
using ((select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[])));

-- task_labels ---------------------------------------------------------------
create policy "task_labels: members read"
on public.task_labels for select
to authenticated
using (org_id in (select private.user_org_ids()));

create policy "task_labels: members attach"
on public.task_labels for insert
to authenticated
with check (org_id in (select private.user_org_ids()));

create policy "task_labels: members detach"
on public.task_labels for delete
to authenticated
using (org_id in (select private.user_org_ids()));

-- comments ------------------------------------------------------------------
create policy "comments: members read"
on public.comments for select
to authenticated
using (org_id in (select private.user_org_ids()));

create policy "comments: members write as themselves"
on public.comments for insert
to authenticated
with check (
  org_id in (select private.user_org_ids())
  and author_id = (select auth.uid())
);

create policy "comments: authors edit"
on public.comments for update
to authenticated
using (author_id = (select auth.uid()))
with check (
  author_id = (select auth.uid())
  and org_id in (select private.user_org_ids())
);

create policy "comments: authors or admins delete"
on public.comments for delete
to authenticated
using (
  author_id = (select auth.uid())
  or (select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
);

-- attachments ---------------------------------------------------------------
create policy "attachments: members read"
on public.attachments for select
to authenticated
using (org_id in (select private.user_org_ids()));

create policy "attachments: members add as themselves"
on public.attachments for insert
to authenticated
with check (
  org_id in (select private.user_org_ids())
  and uploaded_by = (select auth.uid())
);

create policy "attachments: uploader or admins delete"
on public.attachments for delete
to authenticated
using (
  uploaded_by = (select auth.uid())
  or (select private.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
);

-- ---------------------------------------------------------------------------
-- 4. 业务视图：看板只显示未删除的任务
--    security_invoker = true：以查询者身份执行，底层 tasks 的 RLS 照常生效。
--    不加这个选项，视图会以创建者（postgres）身份读表，等于绕过 RLS。
-- ---------------------------------------------------------------------------
create view public.active_tasks
with (security_invoker = true)
as
select id, org_id, project_id, number, title, status, priority,
       assignee_id, created_by, due_on, created_at, updated_at
  from public.tasks
 where deleted_at is null;

revoke all on public.active_tasks from anon, authenticated;
grant select on public.active_tasks to authenticated, service_role;
