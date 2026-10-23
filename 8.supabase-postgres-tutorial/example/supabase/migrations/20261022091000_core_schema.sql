-- 第 4 章：Teamboard 的核心数据模型。
-- 读这份迁移时，请对照第 4 章的“每条规则为什么存在”。

-- ---------------------------------------------------------------------------
-- 枚举：取值集合稳定、由代码逻辑依赖的字段
-- ---------------------------------------------------------------------------
create type public.org_role as enum ('owner', 'admin', 'member');
create type public.task_status as enum ('todo', 'doing', 'done');

-- ---------------------------------------------------------------------------
-- 组织（租户）
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null check (char_length(name) between 1 and 80),
  seat_limit integer not null default 5 check (seat_limit between 1 and 1000),
  -- 创建者被删除时保留组织，只把这一列置空
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint organizations_slug_key unique (slug),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$')
);

-- ---------------------------------------------------------------------------
-- 成员关系：users 与 organizations 的多对多连接表，同时携带“角色”这个关系属性
-- ---------------------------------------------------------------------------
create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 项目
-- ---------------------------------------------------------------------------
create table public.projects (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (key ~ '^[A-Z]{2,6}$'),
  name text not null check (char_length(name) between 1 and 80),
  -- 下一个任务编号；只能由触发器修改（第 8 章用列级权限禁止客户端改它）
  next_task_number integer not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  constraint projects_org_key_key unique (org_id, key),
  -- 供子表做“同组织”复合外键使用
  constraint projects_id_org_key unique (id, org_id)
);

-- ---------------------------------------------------------------------------
-- 任务
-- ---------------------------------------------------------------------------
create table public.tasks (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  project_id bigint not null,
  number integer not null,
  title text not null check (char_length(title) between 1 and 200),
  status public.task_status not null default 'todo',
  priority smallint not null default 3 check (priority between 1 and 4),
  assignee_id uuid,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  due_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 软删除标记：非空表示“在回收站里”
  deleted_at timestamptz,
  -- 复合外键：任务的 org_id 必须与所属项目的 org_id 一致
  constraint tasks_project_fk foreign key (project_id, org_id)
    references public.projects (id, org_id) on delete cascade,
  -- 负责人必须是本组织成员；成员被移除时，只把 assignee_id 置空（Postgres 15+ 语法）
  constraint tasks_assignee_member_fk foreign key (org_id, assignee_id)
    references public.memberships (org_id, user_id) on delete set null (assignee_id),
  constraint tasks_project_number_key unique (project_id, number),
  constraint tasks_id_org_key unique (id, org_id)
);

-- ---------------------------------------------------------------------------
-- 标签与任务-标签（多对多）
-- ---------------------------------------------------------------------------
create table public.labels (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  color text not null default '#64748b' check (color ~ '^#[0-9a-f]{6}$'),
  constraint labels_org_name_key unique (org_id, name),
  constraint labels_id_org_key unique (id, org_id)
);

create table public.task_labels (
  org_id uuid not null,
  task_id bigint not null,
  label_id bigint not null,
  primary key (task_id, label_id),
  -- 两个复合外键共享同一个 org_id：不可能把 A 组织的标签挂到 B 组织的任务上
  constraint task_labels_task_fk foreign key (task_id, org_id)
    references public.tasks (id, org_id) on delete cascade,
  constraint task_labels_label_fk foreign key (label_id, org_id)
    references public.labels (id, org_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- 评论
-- ---------------------------------------------------------------------------
create table public.comments (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  task_id bigint not null,
  author_id uuid default auth.uid() references auth.users (id) on delete set null,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  constraint comments_task_fk foreign key (task_id, org_id)
    references public.tasks (id, org_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- 附件元数据（文件本体在 Storage，第 11 章）
-- ---------------------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  task_id bigint not null,
  -- 在 task-attachments 桶中的对象路径：{org_id}/{task_id}/{随机名}
  object_path text not null,
  file_name text not null check (char_length(file_name) between 1 and 200),
  content_type text,
  size_bytes bigint check (size_bytes >= 0),
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint attachments_object_path_key unique (object_path),
  constraint attachments_path_in_org check (split_part(object_path, '/', 1) = org_id::text),
  -- 暂时 restrict：数据库删除元数据并不会删除 Storage 里的文件。
  -- 第 11 章引入清理队列后，再把它演进为 cascade。
  constraint attachments_task_fk foreign key (task_id, org_id)
    references public.tasks (id, org_id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- 触发器函数
-- ---------------------------------------------------------------------------

-- 每次更新任务都刷新 updated_at
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function private.set_updated_at();

-- 原子地分配“项目内递增编号”，例如 WEB-1、WEB-2。
-- 一条 UPDATE ... RETURNING 同时完成读和写，并对项目行加锁；
-- 同一项目的并发插入会在这一行上排队，不会拿到相同编号（第 7 章）。
create function private.assign_task_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.projects
     set next_task_number = next_task_number + 1
   where id = new.project_id
     and org_id = new.org_id
  returning next_task_number - 1 into new.number;

  if new.number is null then
    raise exception 'project % does not belong to organization %', new.project_id, new.org_id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

create trigger tasks_assign_number
  before insert on public.tasks
  for each row execute function private.assign_task_number();

-- 席位上限：先锁住组织行，再计数。
-- 同一组织的并发“加人”会在锁上排队，因此“先查后写”不会超卖席位（第 7 章）。
create function private.enforce_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  select seat_limit into v_limit
    from public.organizations
   where id = new.org_id
   for no key update;

  select count(*) into v_count
    from public.memberships
   where org_id = new.org_id;

  if v_count >= v_limit then
    raise exception 'organization % has reached its seat limit of %', new.org_id, v_limit
      using errcode = 'P0001', hint = 'Remove a member or raise seat_limit.';
  end if;

  return new;
end;
$$;

create trigger memberships_enforce_seat_limit
  before insert on public.memberships
  for each row execute function private.enforce_seat_limit();

-- 创建组织后，把创建者加为 owner。
create function private.add_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.memberships (org_id, user_id, role)
    values (new.id, new.created_by, 'owner');
  end if;
  return null;
end;
$$;

create trigger organizations_add_owner
  after insert on public.organizations
  for each row execute function private.add_creator_as_owner();

-- ---------------------------------------------------------------------------
-- 所有表：启用 RLS，并收回客户端角色的默认权限（第 8、9 章再精确授予）
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.labels enable row level security;
alter table public.task_labels enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;

revoke all on table
  public.organizations,
  public.memberships,
  public.projects,
  public.tasks,
  public.labels,
  public.task_labels,
  public.comments,
  public.attachments
from anon, authenticated;
