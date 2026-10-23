# 第 4 章：表设计与范式——多对多、唯一约束、外键删除策略与软删除的代价

[上一章](./03-cli-migrations-and-seed.md) · [目录](./README.md) · [下一章](./05-sql-queries.md)

这一章把 Teamboard 的完整数据模型设计出来，写成第二份迁移。重点不是“表长什么样”，而是**每一个设计决定背后的理由**：为什么拆成这几张表，为什么这里用连接表，为什么这个外键是 `cascade` 而那个是 `set null`，为什么软删除没有看上去那么简单。

云端跟做：按第 3 章在**空教学项目**中推送第二份迁移，再显式初始化虚构 seed，后面的查询结果才可对照。已有业务项目可能使用同名表、函数和触发器，不能直接套用这套初始模型。本章出现的 `db reset` 是本地路线；云端改为追加迁移，不重置业务库。

## 4.1 从需求到实体

Teamboard 是一个多团队的任务协作工具。需求如下：

1. 用户可以创建**组织**（团队），组织有唯一的短名称 `slug`（用于 URL），有付费席位上限。
2. 一个用户可以加入多个组织，在每个组织中有一个**角色**：owner / admin / member。
3. 组织下有多个**项目**，每个项目有一个组织内唯一的大写缩写 `key`，如 `WEB`。
4. 项目下有**任务**，任务在项目内按 `WEB-1、WEB-2……` 连续编号；有状态、优先级、截止日期，可以指派给本组织的一名成员。
5. 组织可以定义**标签**，一个任务可以打多个标签，一个标签可以用于多个任务。
6. 任务下有**评论**和**附件**（文件存 Storage，第 11 章）。
7. 删除任务先进入**回收站**，30 天后彻底删除。
8. 用户只能看到自己所在组织的数据（第 9 章用 RLS 实现）。

从名词里找实体，从“一个……有多个……”里找关系：

```text
auth.users ─1───1─ profiles

auth.users ─N───M─ organizations        （通过 memberships，带 role）
organizations ─1───N─ projects ─1───N─ tasks
organizations ─1───N─ labels
tasks ─N───M─ labels                    （通过 task_labels）
tasks ─1───N─ comments
tasks ─1───N─ attachments ──► Storage 中的文件
```

## 4.2 范式：用“消除重复”来理解

范式理论有很多形式化定义。对日常开发，记住这一句就够了：

> **每一个事实只存一次，存在“它真正依赖的那个键”所在的表里。**

看几个反例，体会“同一事实存多次”会带来什么。

**反例一：标签存成逗号分隔的字符串（违反第一范式：值不可再分）**

```text
tasks
 id | title        | labels
----+--------------+----------------
  1 | 修复菜单遮挡  | bug,紧急
```

- 想查“所有打了 bug 标签的任务”，只能用字符串模糊匹配，还会误中 `debug`；
- 标签改名，要扫描所有任务替换字符串；
- 无法保证 `bug` 这个标签真实存在（没有外键）。

**反例二：任务表里存组织名和项目名（违反第三范式：依赖于非键列）**

```text
tasks
 id | project_id | project_name | org_name       | title
----+------------+--------------+----------------+---------
  1 |          7 | 官网改版      | Acme 设计工作室 | ...
  2 |          7 | 官网改版      | Acme 设计工作室 | ...
```

`project_name` 依赖的是 `project_id`，不是任务本身。项目改名时要更新它下面所有任务，漏掉一行就出现“同一个项目两个名字”——这叫**更新异常**。

**正确做法**：项目名只存在 `projects` 表里，需要时 JOIN（第 5 章）。

### 什么时候可以“反范式”

范式不是教条。两种常见的合理例外：

1. **历史快照**：订单里记录“下单时的价格”，因为它本来就是另一个事实（当时的价格），不是商品现价的副本。
2. **为约束或性能有意冗余，并且有机制保证它不会不一致**。Teamboard 的 `tasks.org_id` 就是例子：理论上可以从 `project_id` 推出组织，但我们把它冗余存下来，因为 RLS 策略需要按组织快速过滤（第 9 章）。**关键是 4.5 节的复合外键保证它永远和项目的组织一致**——没有保证机制的冗余就是 bug 的温床。

## 4.3 一对多与多对多

**一对多**：在“多”的一方放外键。`projects.org_id → organizations.id`，`tasks.project_id → projects.id`。

**多对多**：两边都不能放外键（一个任务有多个标签，你没法在任务行里放“多个 label_id”），需要一张**连接表（join table）**，每一行表示“一对关系”：

```sql
create table public.task_labels (
  org_id uuid not null,
  task_id bigint not null,
  label_id bigint not null,
  primary key (task_id, label_id),
  ...
);
```

- 主键 `(task_id, label_id)` 保证同一个标签不会在同一个任务上挂两次；
- 当关系本身有属性时，连接表就是存放它的地方。`memberships`（用户 ↔ 组织）就带着 `role` 和 `joined_at`——角色既不属于用户（他在不同组织角色不同），也不属于组织，它属于“这段关系”。

为什么不用 Postgres 的数组列 `label_ids bigint[]`？数组元素不能有外键，删除标签后会留下指向不存在标签的 id；“哪些任务用了这个标签”也很难高效查询和建索引。**数组适合“没有独立身份的小列表”，不适合表达实体之间的关系。**

## 4.4 唯一约束就是业务规则

把需求里的“唯一”逐条翻译成约束：

| 需求                                 | 约束                              | 说明                                       |
| ------------------------------------ | --------------------------------- | ------------------------------------------ |
| 组织 slug 全局唯一                   | `unique (slug)`                   | 出现在 URL 里                              |
| 项目 key 在组织内唯一                | `unique (org_id, key)`            | 不同组织都可以有 `WEB`                     |
| 任务编号在项目内唯一                 | `unique (project_id, number)`     | 就算编号逻辑有 bug，也不会出现两个 `WEB-3` |
| 标签名在组织内唯一                   | `unique (org_id, name)`           |                                            |
| 一个用户在一个组织里只有一条成员关系 | `primary key (org_id, user_id)`   |                                            |
| 同一个标签不在同一任务上重复         | `primary key (task_id, label_id)` |                                            |
| 同一个附件路径只登记一次             | `unique (object_path)`            |                                            |

**唯一约束是并发安全的最后防线**。应用代码里“先查有没有重名、没有再插入”在并发下一定会失败（两个请求同时查到“没有”，然后都插入）；唯一约束让第二个插入直接报 `23505`，前端据此提示“名称已被占用”。

几个变体，先认识，按需使用：

```sql
-- 大小写不敏感的唯一：唯一索引可以建在表达式上
create unique index organizations_slug_lower_key on public.organizations (lower(slug));

-- 部分唯一：只对满足条件的行要求唯一（软删除时非常有用，见 4.7）
create unique index labels_org_name_active_key on public.labels (org_id, name) where deleted_at is null;
```

（Teamboard 的 slug 已经用 CHECK 限制为小写，所以不需要第一种；第二种在 4.7 解释。）

## 4.5 多租户的完整性：复合外键

Teamboard 是多租户系统：每条业务数据都属于一个组织。一个隐蔽的风险是**跨租户引用**：如果只有 `task_labels.task_id → tasks` 和 `task_labels.label_id → labels` 两个普通外键，那么把 A 组织的标签挂到 B 组织的任务上，数据库不会阻止。

解法是让外键**连同 org_id 一起引用**：

```sql
-- 被引用方提供 (id, org_id) 的唯一约束（外键只能引用唯一列组合）
alter table public.tasks  add constraint tasks_id_org_key  unique (id, org_id);
alter table public.labels add constraint labels_id_org_key unique (id, org_id);

-- 连接表的两个外键共用同一个 org_id 列
constraint task_labels_task_fk  foreign key (task_id, org_id)  references public.tasks  (id, org_id),
constraint task_labels_label_fk foreign key (label_id, org_id) references public.labels (id, org_id)
```

现在一行 `task_labels` 只有一个 `org_id`，它必须同时与任务的组织、标签的组织相同——跨组织关联在结构上就不可能发生。同样的手法用在：

- `tasks (project_id, org_id) → projects (id, org_id)`：任务的冗余 `org_id` 必须与项目一致；
- `comments`、`attachments` 的 `(task_id, org_id) → tasks (id, org_id)`；
- `tasks (org_id, assignee_id) → memberships (org_id, user_id)`：**负责人必须是本组织成员**。

这类规则如果靠应用代码检查，任何一条绕过后端的写入路径（Data API、SQL 编辑器、数据修复脚本）都可能破坏它；写成约束，就再也不用担心。

## 4.6 外键删除策略：逐个决定

每个外键都要回答：**父行被删除时，子行应该怎样？** 下面是 Teamboard 的决定和理由：

| 外键                                        | 策略                                       | 理由                                     |
| ------------------------------------------- | ------------------------------------------ | ---------------------------------------- |
| `profiles.id → auth.users`                  | `cascade`                                  | 资料是用户的一部分                       |
| `organizations.created_by → auth.users`     | `set null`                                 | 创建者注销了，组织还在被其他人使用       |
| `memberships.org_id → organizations`        | `cascade`                                  | 组织没了，成员关系没有意义               |
| `memberships.user_id → auth.users`          | `cascade`                                  | 用户没了，成员关系没有意义               |
| `projects.org_id → organizations`           | `cascade`                                  | 删除租户 = 删除租户的全部数据            |
| `tasks (project_id, org_id) → projects`     | `cascade`                                  | 任务属于项目                             |
| `tasks (org_id, assignee_id) → memberships` | `set null (assignee_id)`                   | 成员离开组织，任务保留，只是变成“未指派” |
| `tasks.created_by → auth.users`             | `set null`                                 | 保留任务，作者显示为“已注销用户”         |
| `labels.org_id → organizations`             | `cascade`                                  |                                          |
| `task_labels → tasks / labels`              | `cascade`                                  | 关系行随任何一端消失                     |
| `comments (task_id, org_id) → tasks`        | `cascade`                                  |                                          |
| `comments.author_id → auth.users`           | `set null`                                 | 讨论记录对团队仍有价值                   |
| `attachments (task_id, org_id) → tasks`     | **`restrict`**（第 11 章演进为 `cascade`） | 见下文                                   |

总结出三条经验：

1. **组合关系（子是父的一部分）用 `cascade`**：订单行之于订单、成员关系之于组织。
2. **引用一个“可选的参与者”用 `set null`**：负责人、作者、创建者。
3. **删除会产生数据库之外的后果时，用 `restrict`（或默认的 `no action`），强制先显式处理**。附件元数据对应着 Storage 里的文件，**数据库删掉元数据并不会删掉文件**——文件会变成没人知道的“孤儿”，继续占用空间和计费。在第 11 章建好“清理队列”之前，我们宁可让删除任务失败，也不要静默制造孤儿文件。

`set null (assignee_id)` 这种**带列清单的写法是 Postgres 15 新增的**。外键是 `(org_id, assignee_id)` 两列，如果只写 `set null`，Postgres 会把两列都置空，而 `org_id` 是 `not null`，删除就会失败。列清单让它只清空 `assignee_id`。

### cascade 的风险

`cascade` 很方便，也很危险：删除一个组织会沿着外键链删除项目、任务、标签、评论……可能是几十万行，在一个事务里完成，持有大量锁并产生大量 WAL。所以：

- **只在“确实应该一起消失”的关系上用 `cascade`**；
- 删除大租户这类操作应该由后台任务**分批**执行，而不是用户点一下按钮同步完成；
- Supabase 官方的数据删除指南建议：执行前确认有近期备份、先在预发环境测试、设置 `lock_timeout` 与 `statement_timeout`、选择低峰时段。

## 4.7 软删除的代价

需求 7 说“删除先进回收站”。最常见的实现是加一列：

```sql
deleted_at timestamptz   -- NULL 表示正常；非 NULL 表示在回收站里
```

“删除”变成 `update tasks set deleted_at = now() where id = ?`，“恢复”就是把它设回 NULL。看起来很简单，但它的成本会渗透到每个角落。**在决定使用软删除之前，逐条确认你能承担这些代价**：

| 代价                       | 具体表现                                                                           | Teamboard 的处理                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 每个查询都要记得过滤       | 漏写 `where deleted_at is null`，回收站里的任务就出现在看板上                      | 提供 `active_tasks` 视图（第 9 章），前端默认查视图                                       |
| 唯一约束与“已删除”的行冲突 | 若标签也软删除：删掉 `bug` 后想再建一个 `bug`，被 `unique (org_id, name)` 拦住     | 用部分唯一索引 `... where deleted_at is null`；Teamboard 只对任务做软删除，标签直接硬删除 |
| 外键与级联不再生效         | 软删除任务不会触发评论、标签关系的级联删除；它们仍然“活着”，可能被其他查询统计进去 | 查询子表时连带检查父任务状态；最终由清理任务硬删除时再级联                                |
| 与 RLS 的冲突              | 若在读取策略里写 `deleted_at is null`，用户执行软删除的那条 `UPDATE` 会直接报错    | 第 9 章详细演示并解决                                                                     |
| 索引与表膨胀               | 回收站的行仍占空间、仍在索引里                                                     | 常用查询使用部分索引 `where deleted_at is null`（第 6 章）                                |
| 数据保护                   | 用户“删除”的内容其实还在，包括其中的个人信息                                       | 明确保留期（30 天），到期由定时任务硬删除（第 11、13 章）                                 |

替代方案：**硬删除 + 归档表**（删除前把行复制到 `archived_tasks`）或**审计日志**。如果需求只是“误删可以找回”，PITR 备份（第 13 章）也能兜底，但那是灾难恢复手段，不是产品功能。

## 4.8 枚举、查找表还是 CHECK？

| 方案                 | 示例                                                        | 适合                                                                                       |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `enum` 类型          | `create type task_status as enum ('todo', 'doing', 'done')` | 取值稳定、代码逻辑依赖具体值；增加新值容易（`alter type ... add value`），删除和重命名困难 |
| `check (x in (...))` | `check (status in ('draft', 'published'))`                  | 取值少、可能调整；修改只需替换约束                                                         |
| 查找表 + 外键        | `labels` 表                                                 | 取值由用户维护、有额外属性（颜色）                                                         |

Teamboard：角色和任务状态用 enum（代码里的权限判断依赖它们），标签用表（用户自定义）。

## 4.9 用触发器守护跨行规则

有些规则无法用单行约束表达，Teamboard 有四个：

1. **`updated_at` 自动刷新**：每次 UPDATE 前把它设为 `now()`，不依赖客户端传值。
2. **项目内连续编号**：插入任务时从项目行的 `next_task_number` 取号并加一。必须在数据库里原子完成，第 7 章分析为什么。
3. **席位上限**：加成员之前统计当前人数，超过 `seat_limit` 就拒绝。同样涉及并发，第 7 章分析。
4. **创建组织时自动成为 owner**：否则新组织没有任何成员，创建者自己都看不到它（第 9 章的 RLS）。

为什么放在触发器而不是前端或后端代码里？因为 Supabase 有多条写入路径（浏览器经 Data API、服务端、SQL 编辑器、数据修复脚本）。**必须对所有写入者都成立的不变量，就应该由数据库执行。** 反过来，发送邮件、调用第三方 API 这类有外部副作用的逻辑，不应该写进触发器。

## 4.10 写出第二份迁移

```bash
npx supabase migration new core_schema
```

完整内容见 [example/supabase/migrations/20261022091000_core_schema.sql](./example/supabase/migrations/20261022091000_core_schema.sql)。下面分段说明其中的关键部分。

### 组织与成员关系

```sql
create type public.org_role as enum ('owner', 'admin', 'member');
create type public.task_status as enum ('todo', 'doing', 'done');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null check (char_length(name) between 1 and 80),
  seat_limit integer not null default 5 check (seat_limit between 1 and 1000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint organizations_slug_key unique (slug),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$')
);

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
```

`default auth.uid()`：`auth.uid()` 是 Supabase 提供的函数，返回当前请求用户的 id（来自 JWT）。前端插入组织时不必传 `created_by`，数据库自动填上；第 9 章的策略会再检查它确实等于当前用户，防止伪造。在迁移和种子数据里（没有登录用户），它返回 NULL，所以种子数据显式提供该列。

`slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'`：`~` 是正则匹配。这样 slug 一定是 3–40 位小写字母、数字或连字符，可以安全地放进 URL。

### 项目与任务

```sql
create table public.projects (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null check (key ~ '^[A-Z]{2,6}$'),
  name text not null check (char_length(name) between 1 and 80),
  next_task_number integer not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  constraint projects_org_key_key unique (org_id, key),
  constraint projects_id_org_key unique (id, org_id)
);

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
  deleted_at timestamptz,
  constraint tasks_project_fk foreign key (project_id, org_id)
    references public.projects (id, org_id) on delete cascade,
  constraint tasks_assignee_member_fk foreign key (org_id, assignee_id)
    references public.memberships (org_id, user_id) on delete set null (assignee_id),
  constraint tasks_project_number_key unique (project_id, number),
  constraint tasks_id_org_key unique (id, org_id)
);
```

注意 `assignee_id` 可以为 NULL（未指派）。复合外键的默认匹配方式是 `MATCH SIMPLE`：**只要外键列中有一个是 NULL，就不检查这个外键**，所以“未指派”的任务不受影响。

### 标签、评论、附件

```sql
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
  constraint task_labels_task_fk foreign key (task_id, org_id)
    references public.tasks (id, org_id) on delete cascade,
  constraint task_labels_label_fk foreign key (label_id, org_id)
    references public.labels (id, org_id) on delete cascade
);

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

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  task_id bigint not null,
  object_path text not null,
  file_name text not null check (char_length(file_name) between 1 and 200),
  content_type text,
  size_bytes bigint check (size_bytes >= 0),
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint attachments_object_path_key unique (object_path),
  constraint attachments_path_in_org check (split_part(object_path, '/', 1) = org_id::text),
  constraint attachments_task_fk foreign key (task_id, org_id)
    references public.tasks (id, org_id) on delete restrict
);
```

`attachments_path_in_org`：文件路径的第一段必须是本组织 id。第 11 章 Storage 的访问策略按路径第一段判断组织，这个约束保证数据库记录与存储路径的约定一致。

### 触发器

```sql
-- 更新时刷新 updated_at（普通触发器函数，不需要 security definer）
create function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function private.set_updated_at();

-- 原子地分配项目内编号
create function private.assign_task_number()
returns trigger language plpgsql security definer set search_path = '' as $$
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
```

`before insert` 触发器可以修改即将插入的行（给 `new.number` 赋值）。`security definer` 的原因：第 8 章会禁止客户端修改 `next_task_number` 这一列，只有这个函数（以 postgres 身份）能改它。

席位上限与“创建者成为 owner”两个触发器的代码见迁移文件，第 7 章讲解席位检查中的 `for no key update`。

### 最后：启用 RLS 并收回权限

```sql
alter table public.organizations enable row level security;
-- ……其余 7 张表同样启用
revoke all on table
  public.organizations, public.memberships, public.projects, public.tasks,
  public.labels, public.task_labels, public.comments, public.attachments
from anon, authenticated;
```

## 4.11 完整的种子数据

把 `supabase/seed.sql` 替换为 [example/supabase/seed.sql](./example/supabase/seed.sql) 的内容。它创建：

- 5 个占位用户（Alice、Bob、Carol、Dave、Frank）；
- 两个组织：`acme`（Alice 是 owner，Carol 是 admin，Bob 与 Frank 是 member，席位 5）与 `globex`（Dave 是 owner，Bob 是 member，席位 3）；
- 三个项目 `WEB`、`APP`（acme）、`API`（globex），14 条任务（其中一条已在回收站），标签与评论若干。

种子数据里有两个值得注意的写法：

```sql
-- 不写死自增 id，而是通过业务键（组织 slug、项目 key）查找
insert into public.tasks (org_id, project_id, title, ...)
select p.org_id, p.id, v.title, ...
  from (values (...), (...)) as v(ord, org_slug, project_key, title, ...)
  join public.organizations o on o.slug = v.org_slug
  join public.projects p on p.org_id = o.id and p.key = v.project_key
 order by v.ord;
```

- `values (...) as v(列名...)` 构造一个临时的“内联表”，再 JOIN 出真实 id；
- 编号由触发器分配，种子数据不提供 `number`。

```bash
npx supabase db reset
```

## 4.12 动手验证约束

在 psql 中逐条执行，先预测结果再看输出：

```sql
-- 1. 重复 slug → 23505
insert into public.organizations (slug, name) values ('acme', '重名');

-- 2. 非法 slug → 23514
insert into public.organizations (slug, name) values ('Bad Slug', 'x');

-- 3. 把 globex 的标签挂到 acme 的任务上 → 23503（复合外键）
insert into public.task_labels (org_id, task_id, label_id)
select 'a0000000-0000-4000-8000-000000000001', t.id, l.id
  from public.tasks t, public.labels l
 where t.org_id = 'a0000000-0000-4000-8000-000000000001'
   and l.org_id = 'a0000000-0000-4000-8000-000000000002'
 limit 1;

-- 4. 把 acme 的任务指派给不是 acme 成员的 Dave → 23503
update public.tasks set assignee_id = '44444444-4444-4444-8444-444444444444'
 where org_id = 'a0000000-0000-4000-8000-000000000001' and number = 1;

-- 5. 在事务里移除 Bob 的 acme 成员身份，观察他的任务
begin;
delete from public.memberships
 where org_id = 'a0000000-0000-4000-8000-000000000001'
   and user_id = '22222222-2222-4222-8222-222222222222';
select count(*) from public.tasks
 where org_id = 'a0000000-0000-4000-8000-000000000001'
   and assignee_id = '22222222-2222-4222-8222-222222222222';   -- 0：只是变成未指派
select count(*) from public.tasks where org_id = 'a0000000-0000-4000-8000-000000000001';  -- 仍是 10
rollback;

-- 6. 查看每个项目的编号与计数器
select p.key, array_agg(t.number order by t.number) as numbers, p.next_task_number
  from public.tasks t join public.projects p on p.id = t.project_id
 group by p.key, p.next_task_number
 order by p.key;
--  key |    numbers    | next_task_number
-- -----+---------------+------------------
--  API | {1,2,3,4}     |                5
--  APP | {1,2,3,4}     |                5
--  WEB | {1,2,3,4,5,6} |                7
```

本书的配套工程把这些检查都写进了自动化脚本（`npm run verify:offline`，见 README），你也可以照着把它们改写成第 9 章的 pgTAP 测试。

## 4.13 本章练习

1. 新增“关注任务”功能：用户可以关注任务以接收通知。设计 `task_watchers` 表，说明主键、外键及删除策略。
2. 如果标签也要支持软删除，并允许删除后重建同名标签，约束应该怎么改？
3. 同事建议：“`tasks.org_id` 是冗余的，删掉它，需要时 JOIN projects 就行。”给出支持和反对的理由。
4. 为什么 `attachments` 的外键现在选择 `restrict`？如果选 `cascade`，删除任务时会发生什么？

### 参考答案

1. ```sql
   create table public.task_watchers (
     org_id uuid not null,
     task_id bigint not null,
     user_id uuid not null,
     created_at timestamptz not null default now(),
     primary key (task_id, user_id),
     foreign key (task_id, org_id) references public.tasks (id, org_id) on delete cascade,
     foreign key (org_id, user_id) references public.memberships (org_id, user_id) on delete cascade
   );
   ```
   关注者必须是组织成员（复合外键指向 memberships），离开组织时关注关系自动消失；任务删除时同样消失。还要记得启用 RLS、收回权限，并为反向查询“我关注的任务”建 `(user_id)` 索引（第 6 章）。
2. 增加 `deleted_at`，删除 `labels_org_name_key` 约束，改为 `create unique index labels_org_name_active_key on public.labels (org_id, name) where deleted_at is null;`。注意 `labels_id_org_key` 要保留（复合外键依赖它）。
3. 支持删除：消除冗余、少一个需要维护的列。反对：RLS 策略需要按组织过滤每一行，没有 `org_id` 就得在策略里 JOIN `projects`，更慢也更复杂；复合外键已经消除了不一致的风险。Teamboard 选择保留。
4. 删除数据库行不会删除 Storage 里的文件。`cascade` 会让附件元数据静默消失，文件变成无人引用的孤儿，持续占用存储并计费，还可能包含用户希望被删除的个人数据。`restrict` 强迫调用方先显式处理文件；第 11 章引入“清理队列”后，删除元数据会自动登记待删文件，才安全地改为 `cascade`。

## 本章验收

- [ ] 能用“每个事实只存一次”解释范式，举出更新异常的例子，并说出两种合理的反范式。
- [ ] 能为多对多关系设计连接表，知道何时把属性放在连接表上，以及为什么不用数组列。
- [ ] 能把业务中的“唯一”翻译成单列、多列、表达式、部分唯一约束。
- [ ] 能用复合外键阻止跨租户引用。
- [ ] 能为每个外键选择 `cascade` / `set null` / `restrict` 并给出理由，知道 `set null (列)` 的用途与 `cascade` 的风险。
- [ ] 能列出软删除的至少五项代价及对应的处理方法。
- [ ] 能说明哪些规则适合放进触发器，哪些不适合。

## 官方阅读

- [PostgreSQL：Constraints（外键动作、MATCH、唯一与 NULL）](https://www.postgresql.org/docs/current/ddl-constraints.html)
- [PostgreSQL：Unique Indexes / Partial Indexes](https://www.postgresql.org/docs/current/indexes-partial.html)
- [PostgreSQL：Enumerated Types](https://www.postgresql.org/docs/current/datatype-enum.html)
- [PostgreSQL：Trigger Functions（PL/pgSQL）](https://www.postgresql.org/docs/current/plpgsql-trigger.html)
- [Supabase：Deleting data and dropping objects safely（软删除、分批删除）](https://supabase.com/docs/guides/database/postgres/data-deletion)
- [Supabase：Safe cascading deletes](https://supabase.com/docs/guides/database/postgres/cascade-deletes)
