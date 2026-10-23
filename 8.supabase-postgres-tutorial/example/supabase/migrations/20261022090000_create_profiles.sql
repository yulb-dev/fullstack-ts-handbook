-- 第 3 章：第一份迁移。
-- 目标：建立“不对 Data API 暴露”的内部 schema，以及与 Supabase Auth 用户一一对应的 profiles 表。

-- private schema 不在 config.toml 的 [api].schemas 中，因此不会生成 REST 端点。
-- 安全相关的内部函数都放在这里，而不是 public。
create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 50),
  created_at timestamptz not null default now()
);

comment on table public.profiles is '每个 Auth 用户一行的公开资料；由 auth.users 插入触发器自动创建。';

-- 一张新表从诞生起就启用 RLS，并收回客户端角色的权限。
-- 第 8、9 章再按需授予权限并编写策略；在那之前，Data API 访问不到它。
alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;

-- 新用户注册时自动创建 profile。
-- security definer：以函数所有者（postgres）的权限执行，因此可以写 public.profiles。
-- set search_path = ''：函数内所有对象都必须写全 schema，防止调用方劫持同名对象。
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        '新用户'
      ),
      50
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
