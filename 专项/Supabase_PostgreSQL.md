---
title: "从 0 到 1 学会 Supabase 与 PostgreSQL"
subtitle: "一套可以边读边做的完整教程"
date: "2026-10-22"
lang: zh-CN
...

适合：会一点 JavaScript/后端概念，或者正准备做第一个有真实用户与数据的应用的人。不会假设你已经熟悉数据库。  
资料核对日期：2026-10-22。Supabase 和 PostgreSQL 会持续更新；上线前应再次核对本教程末尾的官方文档。

* * *

## 这份教程要帮你建立什么能力

学完以后，你应该能自己完成一条可靠的开发链路：设计关系型数据 → 写出正确 SQL → 保护每位用户的数据 → 在本地复现数据库 → 用 migration 记录结构变化 → 部署到隔离的测试环境 → 验证后发布到生产环境 → 做备份、恢复和故障处理。

最重要的观念先说清楚：**Supabase 不是“一个控制台加一个 JavaScript SDK”，而是托管 Postgres 加上一组围绕身份验证、文件、实时订阅、自动生成 API、函数和部署流程的能力。** Postgres 是数据的事实来源；Supabase 帮你把常见后端基础设施整合起来，但不会替你自动设计数据模型、决定谁可以读写数据、修复错误 SQL 或承担全部生产运维责任。

全书会使用一个贯穿例子：**团队任务应用**。用户可以加入组织、创建项目、在项目中写任务、给任务打标签，并上传头像或项目附件。它足够小，可以从零做出来；也足够真实，能暴露多租户、权限、索引、迁移和备份等实际问题。

## 学习环境与约定

你需要：

- 一个终端、Git 和一个代码编辑器。
- Docker Desktop 或可运行 Docker 的环境，因为 Supabase CLI 的本地栈通常由容器启动。
- Node.js/npm（如果你还要写 JavaScript/TypeScript 客户端）。只学习 SQL 时不是强制要求。
- 一个 Supabase 账号只用于后面远程部署。初学时先在本地练习，不要拿生产项目试错。

示例中的 `your-project-ref`、数据库密码、URL 和 key 都是占位符，不是可用凭据。不要把真正的密码、secret key 或数据库连接串提交到 Git。

教程中的命令会显式写 `--local` 或 `--linked`，因为“我以为它只改本地”是最昂贵的一类新手事故。执行有破坏性的命令前，先检查目标环境。

* * *

# 第 1 章：把 Supabase 想成一个以 Postgres 为中心的后端平台

## 1.1 先画出请求路径

一个典型的 Supabase 应用至少有几层：

1. **客户端**：浏览器、手机应用或你写的服务端程序。
2. **API 与身份验证层**：Supabase 的 Data API、Auth，以及客户端携带的访问令牌。
3. **Postgres**：真正保存业务数据、执行约束、事务和查询的关系型数据库。
4. **周边服务**：Storage 存文件；Realtime 将符合配置的数据库变化推送出去；Edge Functions 运行服务端逻辑。它们会与数据库配合，但不是同一种东西。
5. **开发与部署工具**：CLI、本地 Supabase 栈、migration、seed、环境配置和生产部署流程。

当你调用 `supabase.from('projects').select()` 时，浏览器里的 SDK 通常是在发起 Data API 请求，而不是从浏览器直接打开一个 PostgreSQL TCP 连接。这个 API 会结合 API key、用户 JWT、数据库角色授权和 RLS 决定哪些行可以访问。

当一个受信任的服务端使用 PostgreSQL 驱动连接 `DATABASE_URL` 时，它走的是数据库连接协议，使用连接串对应的 Postgres 角色及其权限。**这与浏览器 SDK 的权限路径不同。** 使用数据库所有者或高权限角色直连时，不能假设 RLS 一定能保护你；要根据实际数据库角色、表所有权和 `BYPASSRLS` 权限判断。

## 1.2 各项功能的责任边界

| 能力 | 它解决什么问题 | 它不会自动替你解决什么 |
|---|---|---|
| Postgres | 表、关系、约束、事务、SQL、索引和查询计划 | 业务规则是否设计正确、谁应该有权限 |
| Supabase Auth | 用户注册、登录、会话、JWT 等身份能力 | 不能仅凭“用户已经登录”就认定其有权读所有数据 |
| Data API / 客户端库 | 把受授权的数据库操作包装成 REST/客户端调用 | 不会替你补全缺失的 RLS policy |
| RLS | 在数据库行级控制读写范围 | 不能替代表权限、密钥保护、业务流程验证和安全测试 |
| Storage | 文件对象、bucket、上传下载及访问控制 | 数据库备份不等于文件对象备份 |
| CLI / migrations | 可重放、可审查、可协作的结构变更 | 不保证每条 migration 都安全、可逆或没有锁表风险 |
| 托管备份 | 提供恢复数据的基础能力 | 不能代替你演练恢复、确认恢复点和单独保护文件对象 |

## 1.3 第一个重要原则：数据库才是数据规则的最终防线

假设你的前端页面隐藏了“删除项目”按钮。用户仍可能手工调用 API。如果只有 UI 检查、没有数据库授权，按钮隐藏并不构成安全控制。

相反，如果数据库有正确的授权与 RLS，客户端就算尝试查询其他组织的项目，数据库也会限制结果。前端校验仍然有价值：它能提供更友好的错误提示；但它不能代替后端授权。

**本章验收**：能用自己的话解释“Supabase 是托管 Postgres 及其周边能力”，并说清以下两条路径的区别：浏览器 SDK → Data API → 带用户身份的数据库请求；受信任的服务端 → Postgres 连接串 → 数据库角色。

* * *

# 第 2 章：启动本地开发栈，认识 CLI 与配置文件

本章先把可反复摧毁和重建的实验环境建起来。这样以后所有结构变化都能先在本地验证。

## 2.1 安装与初始化

确保 Docker 正在运行，然后在你的应用仓库里执行：

```bash
# 如果你用 npm，可以把 CLI 固定为项目开发依赖：
npm install --save-dev supabase

# 初始化 Supabase 项目配置
npx supabase init

# 启动本地 Supabase 服务
npx supabase start
```

也可以依照 Supabase 官方支持的安装方式安装 CLI。团队项目通常更适合把 CLI 版本作为项目依赖固定下来，避免每个人因为版本差异得到不同结果。

首次启动会下载容器镜像，并启动本地 Postgres、Studio、Auth、Storage 和其他本地服务。成功后 CLI 会显示本地服务的 URL、端口以及用于开发的本地密钥。**这些是本地环境的值，不是云端生产项目的凭据。**

常用命令：

```bash
npx supabase status              # 查看本地服务状态
npx supabase stop                # 停止本地栈
npx supabase start               # 再次启动
npx supabase --help              # 查看 CLI 命令
npx supabase db --help           # 查看数据库子命令
```

不要盲目复制旧博客里的命令。CLI 的命令集会变化；遇到不确定的参数时，以当前 CLI 的 `--help` 和官方 CLI Reference 为准。

## 2.2 `supabase/` 目录里有什么

初始化后通常会看到类似结构：

```text
supabase/
  config.toml       # 本地栈配置
  migrations/       # 带时间戳的数据库迁移 SQL
  seed.sql          # 可重放的开发/测试初始数据
  .temp/            # CLI 内部临时状态，通常不提交
```

应该将 `config.toml`、migration 和可安全重放的 `seed.sql` 纳入版本控制。一般不要提交 `.temp/` 等 CLI 内部状态。配置文件默认不包含密钥；如果你添加 OAuth 凭据或其他敏感配置，应通过环境变量引用，而不是直接写入文件。

## 2.3 `config.toml` 是本地栈配置，不是生产密钥仓库

`supabase/config.toml` 负责描述本地 Supabase 栈的配置，例如数据库版本、端口、Auth 重定向、Storage、本地种子文件和其他服务选项。CLI 读取它来在本地重现一套可预测的开发环境。

新手常见误解是把它当作生产数据库的“总开关”。实际上：

- 它通常用于配置本地开发栈。
- 它应当与 migration、seed 一起提交，便于团队复现。
- 它不应该存放数据库密码、secret key、第三方 OAuth secret 等凭据。
- 云端项目仍有自己的设置、环境变量和凭据。不要认为改了本地 `config.toml` 就自动完成生产配置。

当需要修改本地端口或启用某项本地服务时，先查看当前生成的配置及官方配置参考，不要把不同 CLI 版本的配置片段胡乱拼在一起。

## 2.4 本地 Postgres 与云端项目的区别

本地栈是供开发和测试的独立环境。它能帮助你检查 migration、测试 RLS、跑 SQL、构建本地 Auth 用户及调试 Storage，不会自动与云端数据同步。

不要把“本地能运行”当作“生产就安全”。本地可能数据量很小、只有一个用户、网络简单；生产环境有并发请求、真实用户、服务端作业、备份要求以及环境隔离问题。

**本章练习**：运行 `npx supabase status`，在浏览器打开本地 Studio，找到 SQL Editor。随后停止并重启本地栈，确认本地数据和配置的行为符合预期。

**本章验收**：你能指出 `config.toml`、`migrations/`、`seed.sql` 各自的职责，并明确本地与云端是不同环境。

* * *

# 第 3 章：从关系模型设计任务应用的数据结构

数据库表不是随意摆放字段的电子表格。设计的重点是：一个事实应该存在哪里、它与其他事实之间是什么关系、数据库如何拒绝不合法状态。

## 3.1 先识别实体与关系

我们的应用有这些实体：

- **用户**：由 Supabase Auth 管理身份，身份主键在 `auth.users.id`。
- **组织**：多位用户可以加入同一个组织。
- **组织成员关系**：同一用户可以加入多个组织；每个组织里又有许多用户。
- **项目**：每个项目属于一个组织。
- **任务**：每项任务属于一个项目。
- **标签**：组织可以定义标签，一项任务可以有多个标签，一个标签也能用于多项任务。

从业务语言看，“用户属于组织”不是把 `organization_id` 硬塞进用户表就完事了，因为一个用户可以属于多个组织。如果一列只能保存一个值，那么它无法自然表示多组织关系。把关系独立建模，是关系型设计的基础。

## 3.2 行、列、主键与外键

一张表是一组同类型的行，每列描述一个属性。数据库里的行应当能被可靠地标识。

- **主键（PRIMARY KEY）**：唯一标识表中一行；不能重复，也不能为 NULL。
- **外键（FOREIGN KEY）**：要求引用值在被引用表里真实存在，维持引用完整性。
- **NOT NULL**：要求必须提供值。
- **UNIQUE**：不允许相同值组合重复。
- **CHECK**：让每一行必须满足一个业务条件。
- **DEFAULT**：省略字段时由数据库填写默认值。

这些不是文档注释，而是可执行的规则。应用程序可能有多个入口：浏览器、后台任务、脚本、管理工具。把能在数据库里表达的完整性条件放进约束，可以避免某个入口忘记校验。

## 3.3 第一个 schema migration

通过 CLI 生成 migration 文件：

```bash
npx supabase migration new create_task_app_schema
```

CLI 会在 `supabase/migrations/` 下生成一个带时间戳的 SQL 文件。把下面的 SQL 放进新文件中，再在本地验证。时间戳文件名由 CLI 生成，不要自行把文件名简化成一个不带版本的通用名字。

```sql
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner', 'admin', 'editor', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null
    references public.projects(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text,
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'done')),
  assignee_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.task_labels (
  task_id uuid not null
    references public.tasks(id) on delete cascade,
  label_id uuid not null
    references public.labels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, label_id)
);

-- 支持常见的反向查找和按用户列出组织
create index organization_members_user_id_idx
  on public.organization_members (user_id, organization_id);

create index projects_org_created_idx
  on public.projects (organization_id, created_at desc, id desc)
  where archived_at is null;

create index tasks_project_created_active_idx
  on public.tasks (project_id, created_at desc, id desc)
  where deleted_at is null;

create index task_labels_label_id_idx
  on public.task_labels (label_id);
```

这段 schema 有意使用多个完整性约束：

- `organizations.id` 和 `projects.id` 是稳定的主键。
- `organization_members` 的复合主键保证同一用户不能重复加入同一组织。
- `labels` 的唯一约束保证同一个组织不能创建两条同名标签，但不同组织可以各自拥有名为 `urgent` 的标签。
- `task_labels` 以 `(task_id, label_id)` 为主键，阻止重复添加同一个标签。
- `status` 的 CHECK 约束限制任务状态，不需要依赖每个前端都记住合法字符串。
- `ON DELETE CASCADE` 表示删除组织时一并删除成员关系、项目及其任务；这种选择会产生真实删除后果，必须理解后再用。

`created_by`、`assignee_id` 可为空。当用户被移除时，`ON DELETE SET NULL` 保留任务历史记录，但把对应身份引用置空。这只是一个示例策略。真实产品可能不允许直接删除用户，而是采用停用、匿名化或数据保留流程。

## 3.4 多对多关系为什么需要 join table

组织与用户是多对多关系：一个用户能加入多个组织，一个组织也能有多个用户。`organization_members` 就是 join table（关联表），一行表示一个用户加入一个组织，并且可以保存加入时间、角色等“关系自身的属性”。

标签和任务也是多对多关系，所以通过 `task_labels` 连接。逗号分隔字符串，因为数据库很难可靠地校验标签是否存在、避免重复、统计标签使用情况，或通过外键维护完整性。

**何时才需要第三张表？** 当两个实体之间的关系可能重复、需要属性，或者本身就是多对多时。例如 `organization_members` 的 `role` 属于“某用户在某组织中的角色”，而不是用户全局的角色。

## 3.5 外键的删除策略要和业务一致

常见策略如下：

- `ON DELETE CASCADE`：父记录删除时自动删除子记录。适合“子记录离开父记录就没有独立意义”的关系，例如项目下的任务（但是否真的应该物理删除，需要另外判断）。
- `ON DELETE SET NULL`：保留子记录，但清空它对父记录的引用。适合可选的指派人或作者引用。
- `RESTRICT` / `NO ACTION`：当仍有引用时拒绝删除，迫使应用先处理子记录。它们的检查时机存在细节区别，但初学时可先理解为“不能悄悄删掉仍被引用的核心记录”。

外键的**被引用列**必须是主键、唯一约束或满足条件的非部分唯一索引。另一个新手陷阱是：Postgres 不会因为你添加外键就自动为引用方列建立普通索引。所以，`tasks.project_id` 常常值得建索引，尤其当你频繁查询某个项目的所有任务，或删除项目时要查找其子任务。

## 3.6 软删除的成本

`deleted_at` 或 `archived_at` 表示“逻辑上不再显示”，而不是物理删除。

软删除的好处是能够撤销、留审计记录或保留关系；成本则包括：

- 每一个正常查询都必须正确过滤 `deleted_at is null`。
- 唯一性规则可能要改。例如一个已软删除的项目名能否被重新使用？如果可以，普通 `UNIQUE(organization_id, name)` 可能不满足需求，需要部分唯一索引。
- 外键不会因为子行被软删除而自动失效，逻辑删除传播要由业务设计负责。
- 备份、隐私删除请求和存储文件清理都更复杂。软删除不等于数据已经被真正删除。

部分唯一索引示例：

```sql
create unique index projects_active_name_unique
  on public.projects (organization_id, lower(name))
  where archived_at is null;
```

这意味着一个组织里，未归档项目名称按不区分大小写的规则不能重复；被归档的行不参与此索引的唯一性检查。应用需明确这个语义是否符合需求。

**本章练习**：解释为什么不能把 `labels` 保存为一个字符串列；解释删除组织时为什么要谨慎使用级联删除；试着给 `tasks` 加上预计完成时间 `due_at timestamptz`，并说明它是否应该允许 NULL。

**本章验收**：你能画出 `organizations → projects → tasks` 的一对多关系，`users ↔ organizations` 的多对多关系，以及 `tasks ↔ labels` 的多对多关系；能解释主键、外键、唯一约束、CHECK、NOT NULL 的作用。

* * *

# 第 4 章：用 SQL 查询真正的数据，而不是把表格当 API

SQL 查询通常按逻辑步骤工作：从哪儿取数据（FROM/JOIN），如何筛选行（WHERE），如何分组聚合（GROUP BY/HAVING），最后选择输出表达式（SELECT）、排序（ORDER BY）和限制结果数（LIMIT/OFFSET）。实际执行计划不一定严格按这个书写顺序执行，但这种思考顺序有助于写出正确查询。

## 4.1 SELECT、WHERE 和稳定排序

```sql
select id, title, status, created_at
from public.tasks
where status = 'todo'
  and deleted_at is null
order by created_at desc, id desc
limit 20;
```

这里有几个值得注意的习惯：

- 明确选择列，而不是在长期维护的 API 中习惯性 `select *`。表加列后，`*` 会悄悄改变响应体大小与数据暴露面。
- `WHERE` 用来筛选行。
- 软删除表必须根据业务语义过滤未删除行。
- `ORDER BY created_at DESC, id DESC` 不仅指定时间倒序，还用唯一的 `id` 打破同一时间戳的并列，让排序稳定。

**SQL 不保证自然顺序。** 没写 `ORDER BY`，就不能依赖数据“看起来一直按插入顺序返回”。查询计划、索引或数据布局变化都可能使返回顺序改变。

## 4.2 JOIN：根据关系取出需要的数据

取得每个任务及其项目名：

```sql
select
  t.id as task_id,
  t.title as task_title,
  t.status,
  p.id as project_id,
  p.name as project_name
from public.tasks as t
join public.projects as p on p.id = t.project_id
where p.organization_id = $1
  and t.deleted_at is null
order by t.created_at desc, t.id desc;
```

`JOIN` 默认指 `INNER JOIN`：只有连接条件匹配的行才出现。表别名 `t`、`p` 让 SQL 更短、更清晰；`$1` 表示由数据库驱动参数化传入的值，不要把用户输入直接拼接进 SQL 字符串。

左连接：如果希望列出所有项目，即使项目暂时没有任务，可以这样写：

```sql
select p.id, p.name, t.id as task_id, t.title
from public.projects p
left join public.tasks t
  on t.project_id = p.id
 and t.deleted_at is null
where p.organization_id = $1;
```

这里将 `t.deleted_at is null` 放在 `ON` 条件里，目的是保留没有符合任务的项目。如果把它放到 `WHERE` 中，`t` 为 NULL 的行会被过滤，查询结果可能退化成类似 inner join 的行为。

## 4.3 GROUP BY 与聚合

想统计每个项目未删除任务的数量：

```sql
select
  p.id,
  p.name,
  count(t.id) as task_count,
  count(t.id) filter (where t.status = 'done') as done_count
from public.projects p
left join public.tasks t
  on t.project_id = p.id
 and t.deleted_at is null
where p.organization_id = $1
  and p.archived_at is null
group by p.id, p.name
order by task_count desc, p.id;
```

`COUNT`、`SUM`、`AVG`、`MIN`、`MAX` 等是聚合函数。`GROUP BY` 把输入行分组后，每组输出一行。`COUNT(t.id)` 忽略 NULL，适合统计左连接中实际匹配的任务；如果写 `COUNT(*)`，即便项目没有任务，左连接产生的项目行也会被计为 1，这往往不是想要的结果。

`WHERE` 是分组之前的行过滤；`HAVING` 是分组完成后的组过滤。例如 `HAVING count(t.id) >= 5` 表示只保留任务数至少为 5 的项目。

## 4.4 子查询和 CTE：拆解较复杂的逻辑

子查询可作为条件：

```sql
select p.id, p.name
from public.projects p
where exists (
  select 1
  from public.tasks t
  where t.project_id = p.id
    and t.status = 'in_progress'
    and t.deleted_at is null
);
```

`EXISTS` 表示只关心是否存在符合条件的行，不需要真的返回这些行的内容。

CTE（Common Table Expression，常称 `WITH` 查询）给复杂查询起一个局部名字，让大查询可以按步骤书写：

```sql
with task_counts as (
  select
    p.id as project_id,
    p.name,
    count(t.id) filter (where t.deleted_at is null) as task_count,
    count(t.id) filter (
      where t.status = 'done' and t.deleted_at is null
    ) as done_count
  from public.projects p
  left join public.tasks t on t.project_id = p.id
  where p.organization_id = $1
  group by p.id, p.name
)
select
  project_id,
  name,
  task_count,
  done_count,
  round(100.0 * done_count / nullif(task_count, 0), 1) as completion_pct
from task_counts
order by completion_pct desc nulls last, project_id;
```

`NULLIF(task_count, 0)` 在数量为 0 时返回 NULL，防止除零错误。普通 CTE 是组织查询的可读性工具，并不意味着它必然比子查询快；现代 Postgres 会根据查询结构选择合适的计划，某些 CTE 也可以被内联或被显式物化。

## 4.5 窗口函数：保留每一行，同时计算排名或累计值

聚合通常把多行压成一行；窗口函数则在相关行集合上计算，同时保留当前行。比如为每个项目内的任务按创建时间排序并编号：

```sql
select
  t.project_id,
  t.id,
  t.title,
  t.created_at,
  row_number() over (
    partition by t.project_id
    order by t.created_at desc, t.id desc
  ) as row_in_project
from public.tasks t
where t.deleted_at is null;
```

- `PARTITION BY` 定义互相独立的窗口分组。
- 窗口内 `ORDER BY` 定义计算顺序，不一定等于最终输出顺序。
- `row_number()` 对每个窗口分组从 1 开始编号。

要查出每个项目最近的 3 项任务，可以把窗口结果放在子查询里再过滤：

```sql
with ranked_tasks as (
  select
    t.*,
    row_number() over (
      partition by t.project_id
      order by t.created_at desc, t.id desc
    ) as rn
  from public.tasks t
  where t.deleted_at is null
)
select project_id, id, title, created_at
from ranked_tasks
where rn <= 3
order by project_id, created_at desc, id desc;
```

窗口函数的计算阶段晚于 `WHERE`，所以不能直接在同层 `WHERE row_number() ...` 里过滤。使用 CTE 或子查询包一层即可。

## 4.6 NULL 不是空字符串，也不是零

`NULL` 表示缺失、未知或不适用的值。`NULL = NULL` 的结果不是 true，而是 unknown/NULL；所以检查空值要写：

```sql
where assignee_id is null
where assignee_id is not null
```

不要写 `assignee_id = NULL`。要把“是否不同”按将 NULL 当作一个可比较状态来判断时，可使用 `IS DISTINCT FROM` 或 `IS NOT DISTINCT FROM`。

聚合函数通常忽略 NULL（`COUNT(*)` 例外，因为它数行），所以统计“有多少任务已指派”可写 `COUNT(assignee_id)`，它统计非 NULL 的指派人值，而不是所有任务。

还有一个常见陷阱：`NOT IN (subquery)` 在子查询结果含有 NULL 时可能让判断得到 unknown，结果比想象更少。若业务含义是“不存在匹配行”，经常用 `NOT EXISTS` 更直接。

## 4.7 LIMIT/OFFSET 与稳定分页

基础分页可以写：

```sql
select id, title, created_at
from public.tasks
where project_id = $1 and deleted_at is null
order by created_at desc, id desc
limit 20 offset 40;
```

不过，当用户不断向列表插入新记录时，OFFSET 分页可能出现重复或跳过条目；很大的 OFFSET 也需要数据库跳过前面许多行。**稳定的顺序必须由唯一排序键保证，但它无法让 OFFSET 在高频变更下自动变成快且不漂移的分页。**

大列表常用 keyset/cursor 分页。把上一页最后一行的 `(created_at, id)` 作为游标：

```sql
select id, title, created_at
from public.tasks
where project_id = $1
  and deleted_at is null
  and (created_at, id) < ($2, $3)
order by created_at desc, id desc
limit 20;
```

在 `created_at DESC, id DESC` 的排序下，下一页只读取游标之后的记录。游标中的两个值必须取自上一页最后一条记录，并且排序、比较操作和索引的设计要匹配。若排序字段可为 NULL 或业务要求复杂混合排序，需要进一步仔细设计游标条件。

**本章练习**：自己写查询，分别得到“每个项目任务数”“每个组织完成率最高的三个项目”“每个项目最近三项任务”。给所有会分页的查询增加明确的唯一顺序。

**本章验收**：能解释 JOIN、LEFT JOIN、GROUP BY、HAVING、EXISTS、CTE、窗口函数和 NULL 的基本语义；能说出为什么分页查询不能省略 `ORDER BY`。

* * *
# 第 5 章：事务、隔离级别、锁与并发更新

单人开发时，很多代码看起来正确；多位用户同时操作时，才暴露竞态条件。Postgres 的事务与并发控制不是高级选修，它们是“避免数据偶尔错掉”的基本工具。

## 5.1 事务：多个动作作为一个整体提交

转账场景需要从一个账户扣钱，并给另一个账户加钱。如果扣款成功后，加款失败，数据库不能留下只扣款、不加款的中间状态。事务把一组 SQL 组织成全有或全无：

```sql
begin;

update accounts
set balance = balance - 100
where id = $1;

update accounts
set balance = balance + 100
where id = $2;

commit;
```

如果某一步失败，或业务判断要求放弃，可执行 `ROLLBACK`。Postgres 中单条 SQL 本身也在一个隐式事务里；`BEGIN` 用于将多条 SQL 组合起来。

真正的应用代码还需要验证账户存在、余额充足、两账户符合业务条件，并对失败回滚。例子只展示事务结构，不是完整的金融转账实现。

## 5.2 ACID 的直觉

- **原子性 Atomicity**：事务要么全部生效，要么不生效。
- **一致性 Consistency**：数据库从一种满足约束的状态转换到另一种满足约束的状态。数据库只能保障已表达出来的约束，业务规则若没有建模，不能指望 ACID 猜出来。
- **隔离性 Isolation**：并发事务之间的相互影响由隔离级别和锁机制控制。
- **持久性 Durability**：成功提交的数据按数据库承诺持久化。

## 5.3 PostgreSQL 的隔离级别

PostgreSQL 支持 SQL 标准的隔离级别名称，但 `READ UNCOMMITTED` 在 PostgreSQL 内部表现得像 `READ COMMITTED`。实际开发里，默认常是 `READ COMMITTED`。

| 隔离级别 | 直观含义 | 实践中需要记住的事 |
|---|---|---|
| Read Committed | 每条语句通常看到该语句开始时已提交的数据快照 | 同一事务里两次 SELECT 可能看到不同的已提交结果；常用默认级别 |
| Repeatable Read | 事务内使用稳定快照，能避免不可重复读；Postgres 实现也避免幻读 | 并发更新同一行时可能收到序列化失败；业务仍可能遇到序列化异常 |
| Serializable | 保证成功提交的并发事务等价于某种串行执行顺序 | 可能主动终止其中一个事务；应用必须准备重试整个事务 |

隔离级别越强并不意味着业务代码不需要处理错误。可串行化事务遇到序列化失败时，正确的恢复方式通常是**回滚并重试整笔事务**，而不是只重放失败的那一条 SQL，因为之前读到的判断可能已经过期。

## 5.4 并发更新的经典错误：读-改-写

假设库存是 1。两个请求几乎同时执行：

1. 请求 A 读取库存 1。
2. 请求 B 也读取库存 1。
3. A 判断库存足够，决定减 1。
4. B 也判断库存足够，决定减 1。
5. 如果业务逻辑只是把先前算出的值写回，就可能发生丢失更新或超卖。

尽量把简单的检查与更新合并成一条原子 SQL：

```sql
update inventory
set quantity = quantity - $2
where id = $1
  and quantity >= $2
returning quantity;
```

程序检查是否返回一行：返回一行表示扣减成功；没有返回行就表示该记录不存在或库存不够。若还需要跨多张表写订单、付款记录等操作，应把相关 SQL 放进同一事务，并考虑幂等性与并发请求重复提交。

另一个例子是计数器，优先写 `UPDATE counters SET value = value + 1 WHERE id = $1`，而不是先 `SELECT value` 到应用、加 1、再写回旧值。

## 5.5 行锁与 `SELECT ... FOR UPDATE`

更新或删除一行时，Postgres 会自动取得相应的行级锁，并通常持有到事务结束。同一行上的冲突写入会等待。

如果业务必须先读取一行、再根据读取结果决定后续更新，可以在一个较短的事务里锁定目标行：

```sql
begin;

select quantity
from inventory
where id = $1
for update;

-- 应用或存储过程在事务中检查数量，再执行相应更新
update inventory
set quantity = quantity - $2
where id = $1;

commit;
```

使用 `FOR UPDATE` 并不自动完成库存校验；它只是防止另一笔冲突写入在锁释放前同时修改该行。若 `quantity` 可能不足，仍需在事务内检查并处理。

行锁不会阻止普通 SELECT 读取已提交数据，但会影响同一行上的冲突写入和锁请求。锁持有期间越长，其他请求等待的机会就越多。因此不要在打开事务后等待用户输入、调用缓慢外部 API 或执行长时间网络请求。

## 5.6 死锁与重试

典型死锁：事务 A 先锁了行 1，再等行 2；事务 B 先锁行 2，再等行 1。彼此都无法继续。

降低风险的方法：

- 统一锁记录的顺序，例如总是按 id 从小到大更新。
- 缩短事务，尽早提交或回滚。
- 给业务更新写上准确的 WHERE 条件，避免无意锁住大量行。
- 对可重试的死锁、序列化失败，按数据库错误类型以有限次数和退避策略重试整个事务；确保外部副作用（发邮件、扣第三方款）不会因重试而重复执行。

不要把重试当作修复错误模型的万能药。如果逻辑在任意串行顺序下都不满足业务不变量，就算没有报错也会产生错误数据。

**本章练习**：在本地设计一个 `inventory` 表，用一条有条件的 UPDATE 防止库存低于零。写一个事务，让“创建订单”和“扣减库存”同时成功或同时失败。

**本章验收**：能解释事务、默认隔离级别、行锁、丢失更新和死锁；知道什么时候用原子 UPDATE，什么时候考虑 `FOR UPDATE`，以及为什么某些错误需要重试整个事务。

* * *

# 第 6 章：索引、查询计划与 EXPLAIN

索引的目的不是让每条 SQL 都变快，而是用额外存储空间与写入成本，换取某些查询更快地找到所需行。

## 6.1 B-tree 是默认起点

Postgres 普通 `CREATE INDEX` 默认创建 B-tree。它适合许多常见访问模式：

- 等值匹配：`where project_id = ...`
- 范围查询：`where created_at >= ... and created_at < ...`
- 适当的排序：`order by created_at desc`
- 唯一性：唯一 B-tree 索引可支持常见唯一约束。

索引不是免费午餐。新增索引会占磁盘，并且 INSERT/UPDATE/DELETE 时需要维护它；过多索引会放大写入工作、增加缓存压力和备份体积，也会让 schema 更难管理。先找出真实的慢查询，再判断索引。

其他索引类型用于特定场景：GIN 常见于 JSONB、数组和全文检索；GiST 可用于空间和范围等场景；BRIN 适合某些非常大的、物理存储顺序与数据值强相关的表。不要为“听起来高级”而选择索引类型。

## 6.2 复合索引的列顺序

我们的常用查询是：

```sql
select id, title, created_at
from public.tasks
where project_id = $1
  and deleted_at is null
order by created_at desc, id desc
limit 20;
```

候选索引：

```sql
create index tasks_project_created_active_idx
  on public.tasks (project_id, created_at desc, id desc)
  where deleted_at is null;
```

索引设计直接回应查询模式：先按 `project_id` 定位一个项目，再按时间和 id 的顺序读取未删除任务，适合 keyset 分页。由于该索引是部分索引，只收录 `deleted_at is null` 的行，减少归档/已删除数据对这个查询索引的占用。

B-tree 复合索引的经验规则是：**把经常作为等值筛选的列放在前面，再结合范围与排序设计后续列**。Postgres 对最左侧前缀的约束通常最敏感。这个经验不是绝对公式；真实效果还取决于数据分布、选择性、统计信息、查询条件是否一致以及优化器选择。

例如 `(project_id, status, created_at)` 很适合先筛项目与状态再按时间看任务，但对只按 `status` 查询、完全没有 `project_id` 条件的查询，它未必是合适索引。不要仅凭“这三列都经常用”就把它们随便排在一起。

## 6.3 外键不代表引用列一定已建立索引

`projects.organization_id` 和 `tasks.project_id` 是外键引用方。经常按这些列查数据时，通常应考虑建立索引。父表删除或更新时，数据库也需要检查子表是否仍引用该父行；没有合适索引时，这个检查可能很昂贵。

但别机械地为每一列都加索引。若某列选择性很低、表很小、查询常常读取大部分行，顺序扫描可能比走索引更快。最终要看实际查询与数据。

## 6.4 用 EXPLAIN 观察数据库如何做查询

```sql
explain
select id, title, created_at
from public.tasks
where project_id = '00000000-0000-0000-0000-000000000001'
  and deleted_at is null
order by created_at desc, id desc
limit 20;
```

`EXPLAIN` 显示优化器计划，例如：

- `Seq Scan`：顺序扫描表；表小或需要读大量行时可能完全合理。
- `Index Scan`：通过索引找到行，并按需取表数据。
- `Bitmap Index Scan` / `Bitmap Heap Scan`：常用于把索引命中集合整理后再访问表。
- `Sort`：需要进行排序；当排序数据量很大时值得关注。
- `Hash Join`、`Nested Loop`、`Merge Join`：不同连接算法，不代表某一种总是更好。

看计划时，重点比较估算行数与实际行数（实际行数需要 ANALYZE）、观察是否扫描了远多于预期的行、是否出现意外排序，以及 I/O 与执行时间是否在合理范围内。

在测试环境可以运行：

```sql
explain (analyze, buffers)
select id, title, created_at
from public.tasks
where project_id = '00000000-0000-0000-0000-000000000001'
  and deleted_at is null
order by created_at desc, id desc
limit 20;
```

`EXPLAIN ANALYZE` **会真正执行这条语句**。对 SELECT 一般是可接受的，但对 UPDATE/DELETE 会实际修改数据；若要分析写语句，可在隔离测试环境或可控事务中执行并回滚。不要在不理解影响的生产数据上随手跑高开销的 ANALYZE。

索引优化的标准流程：先记录真实慢查询与参数范围 → 在接近真实的数据规模上用 `EXPLAIN (ANALYZE, BUFFERS)` 观察 → 形成假设 → 添加或调整一个索引 → 比较延迟、扫描行数、写入成本与磁盘占用 → 保留有证据支持的改动。

**本章练习**：为“查询某项目最近 20 个未删除任务”设计一个索引；说明为什么只建 `created_at` 索引可能不够；对比加索引前后的查询计划。

**本章验收**：能解释 B-tree 的常见用途、复合索引顺序的基本规则、顺序扫描何时合理，以及 `EXPLAIN` 和 `EXPLAIN ANALYZE` 的区别。

* * *
# 第 7 章：RLS——让数据库按用户和组织限制数据

RLS（Row-Level Security，行级安全）对多租户应用尤其重要。仅有“用户登录成功”并不意味着用户可以看到任意行。策略应回答：**当前身份可以看到哪些现有行，以及允许创建或修改成什么样的行？**

## 7.1 启用和未启用 RLS 的区别

对通过 Supabase Data API 访问、且给了相应表权限的角色而言，如果表没有启用 RLS，SQL 的普通表权限可能允许它访问该表的全部可授权行。如果启用了 RLS 而没有任何允许该角色的 policy，那么相应角色通常看不到或不能修改任何行（默认拒绝）。

启用 RLS 不等于完成安全配置。你还需要检查：表级 `GRANT`、RLS 策略、视图/函数、数据库角色，以及访问路径使用的凭据。

对业务表启用 RLS：

```sql
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.labels enable row level security;
alter table public.task_labels enable row level security;
```

这段只是启用 RLS，尚未给客户端任何访问许可。应当继续定义清晰的 policy，并验证有权限和无权限的场景。

## 7.2 `auth.uid()` 是什么

当请求通过 Supabase Auth 用户会话访问 Data API 时，`auth.uid()` 可返回当前请求用户的 UUID。RLS 策略可以把行里的 `user_id` 与当前用户身份对比，而不是信任客户端随便传来的 `user_id`。

例如，一个用户只能读取自己的个人资料：

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

grant select, update on public.profiles to authenticated;

create policy "profile_select_own"
  on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "profile_update_own"
  on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
```

这里的 `USING` 用于限制当前语句能作用到哪些现有行；对 SELECT，它决定可见行。`WITH CHECK` 用来限制 INSERT 的新行，或 UPDATE 后的新行必须满足什么条件。更新通常同时需要有能力访问现有行与提交合法的新行。

比如只写 `USING (auth.uid() = id)` 仍不够完整地描述更新后行应当满足的规则。把相同约束写进 `WITH CHECK`，可以防止用户尝试把自身 profile 主键或所属关系改成其他用户。

## 7.3 组织成员策略：先定义最小可行的规则

本教程的组织成员表使用复合主键 `(organization_id, user_id)`。先让用户能够读取自己的成员关系：

```sql
grant select on public.organization_members to authenticated;

create policy "members_read_own_memberships"
  on public.organization_members
  for select to authenticated
  using ((select auth.uid()) = user_id);
```

这让用户能判断自己加入哪些组织。它没有授予客户端随意增加管理员、修改角色或把其他人踢出组织的权限。成员邀请/添加、角色变更、创建组织等操作应通过受控的服务端流程或经过仔细设计的数据库函数完成；不能简单地因为用户属于某组织，就允许他任意更新 `role`。

## 7.4 读取组织和项目：必须属于当前用户所在组织

首先允许组织成员读取组织基本信息：

```sql
grant select on public.organizations to authenticated;

create policy "organizations_select_for_members"
  on public.organizations
  for select to authenticated
  using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = organizations.id
        and m.user_id = (select auth.uid())
    )
  );
```

再允许成员读取项目：

```sql
grant select on public.projects to authenticated;

create policy "projects_select_for_members"
  on public.projects
  for select to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      where m.organization_id = projects.organization_id
        and m.user_id = (select auth.uid())
    )
  );
```

数据库对每一行检查条件。组织 A 的成员不会因为知道组织 B 的项目 UUID 就自动获得访问权限。这是多租户隔离的关键。

注意：子查询访问 `organization_members` 时也会受到该表的权限和 RLS 影响，所以要把相关表的授权逻辑设计成一致的；不要无意做出递归 RLS policy。在上面的简化方案中，成员表可读的是当前用户自己的行，正好足够检查当前用户是否有该组织成员记录。

## 7.5 写项目：USING 与 WITH CHECK 都要考虑

允许组织里的 owner/admin/editor 创建项目：

```sql
grant insert, update, delete on public.projects to authenticated;

create policy "projects_insert_for_editors"
  on public.projects
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.organization_members m
      where m.organization_id = projects.organization_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin', 'editor')
    )
  );

create policy "projects_update_for_editors"
  on public.projects
  for update to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      where m.organization_id = projects.organization_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin', 'editor')
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members m
      where m.organization_id = projects.organization_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin', 'editor')
    )
  );

create policy "projects_delete_for_admins"
  on public.projects
  for delete to authenticated
  using (
    exists (
      select 1
      from public.organization_members m
      where m.organization_id = projects.organization_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin')
    )
  );
```

更新策略同时验证原行与新行。否则用户可能试图把原本属于组织 A 的项目改成组织 B 的 `organization_id`，从而制造跨租户移动漏洞。生产设计还应明确是否允许项目转移组织；很多应用应该禁止，或者把转移做成由服务端执行的专门操作。

## 7.6 任务的读写权限

任务通过 `project_id` 归属于一个项目。下面的读取策略通过项目找到组织，再检查当前用户是否为成员：

```sql
grant select, insert, update, delete on public.tasks to authenticated;

create policy "tasks_select_for_members"
  on public.tasks
  for select to authenticated
  using (
    exists (
      select 1
      from public.projects p
      join public.organization_members m
        on m.organization_id = p.organization_id
      where p.id = tasks.project_id
        and m.user_id = (select auth.uid())
    )
    and tasks.deleted_at is null
  );
```

这会把逻辑删除的任务排除在普通客户端 SELECT 外。但请注意，这个策略也意味着客户端无法通过相同 SELECT 策略查询已删除记录；若管理界面必须查看回收站，要为具有相应角色的人设计专门的安全访问方式，而不是直接去掉所有过滤条件。

写入策略需要验证任务所在项目和用户角色。这里给出插入示例：

```sql
create policy "tasks_insert_for_editors"
  on public.tasks
  for insert to authenticated
  with check (
    deleted_at is null
    and exists (
      select 1
      from public.projects p
      join public.organization_members m
        on m.organization_id = p.organization_id
      where p.id = tasks.project_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin', 'editor')
    )
  );
```

还需要为更新和删除制定策略，否则即使前面授予了表级权限，没有相应的 RLS policy 时写操作仍会被拒绝。下面是一个基础范例：

```sql
create policy "tasks_update_for_editors"
  on public.tasks
  for update to authenticated
  using (
    deleted_at is null
    and exists (
      select 1
      from public.projects p
      join public.organization_members m
        on m.organization_id = p.organization_id
      where p.id = tasks.project_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin', 'editor')
    )
  )
  with check (
    exists (
      select 1
      from public.projects p
      join public.organization_members m
        on m.organization_id = p.organization_id
      where p.id = tasks.project_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin', 'editor')
    )
  );

create policy "tasks_delete_for_editors"
  on public.tasks
  for delete to authenticated
  using (
    exists (
      select 1
      from public.projects p
      join public.organization_members m
        on m.organization_id = p.organization_id
      where p.id = tasks.project_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin', 'editor')
    )
  );
```

这里的 UPDATE `WITH CHECK` 没有限制 `deleted_at` 必须为空，因此可以允许符合角色条件的用户软删除一项任务；但它仍要求更新后的任务留在当前用户可编辑的组织范围内。若产品选择物理删除，DELETE policy 的角色条件和审计要求应另行评估。

实际业务通常还要防止客户端把 `created_by` 改成另一个人，或者把任务 `assignee_id` 设置成不属于当前组织的用户。

这是一个值得认真理解的边界：**外键 `assignee_id references auth.users(id)` 只保证被指派的人是一个存在的用户，不保证他属于该任务的组织。** 组织成员资格是跨表业务不变量，需要在 RLS、受控 RPC/函数或其他合适的数据库约束机制中明确实施。

## 7.7 标签与关联表同样要有策略

`labels`、`task_labels` 也启用了 RLS，所以不能假设“只是关联表，不需要保护”。下方展示标签表的基本策略；关联表则同时检查任务和标签是否属于同一个组织。

```sql
grant select, insert, update, delete on public.labels to authenticated;
```

标签表实际策略如下：

```sql
create policy "labels_select_for_members"
  on public.labels
  for select to authenticated
  using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = labels.organization_id
        and m.user_id = (select auth.uid())
    )
  );

create policy "labels_insert_for_editors"
  on public.labels
  for insert to authenticated
  with check (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = labels.organization_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin', 'editor')
    )
  );

create policy "labels_update_for_editors"
  on public.labels
  for update to authenticated
  using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = labels.organization_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin', 'editor')
    )
  )
  with check (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = labels.organization_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin', 'editor')
    )
  );

create policy "labels_delete_for_admins"
  on public.labels
  for delete to authenticated
  using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = labels.organization_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin')
    )
  );
```

关联表只开放读取、新增和删除，通常不需要允许直接修改两个外键：

```sql
grant select, insert, delete on public.task_labels to authenticated;

create policy "task_labels_select_for_members"
  on public.task_labels
  for select to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      join public.organization_members m
        on m.organization_id = p.organization_id
      join public.labels l
        on l.id = task_labels.label_id
       and l.organization_id = p.organization_id
      where t.id = task_labels.task_id
        and m.user_id = (select auth.uid())
    )
  );

create policy "task_labels_insert_for_editors"
  on public.task_labels
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      join public.organization_members m
        on m.organization_id = p.organization_id
      join public.labels l
        on l.id = task_labels.label_id
       and l.organization_id = p.organization_id
      where t.id = task_labels.task_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin', 'editor')
    )
  );

create policy "task_labels_delete_for_editors"
  on public.task_labels
  for delete to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      join public.organization_members m
        on m.organization_id = p.organization_id
      where t.id = task_labels.task_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin', 'editor')
    )
  );
```

这些 policy 展示了设计思路，但不能跳过实际测试：引用表自身的 RLS 也会影响子查询的可见性。否则攻击者可能把其他组织的标签 ID 和任务 ID 混在一起，尝试构造跨组织关联。上面的关联表插入检查明确验证标签与任务同属一个组织；删除检查则需要按你的业务要求考虑是否还要验证标签当前仍可见。

给多表 RLS 编写规则时，一个好流程是：

1. 先写出一句业务规则，例如“组织成员可以读取本组织任务，只有编辑者可以新增任务”。
2. 找出检查规则需要的关联路径（task → project → organization → membership）。
3. 对 SELECT、INSERT、UPDATE、DELETE 分开思考；不要只开一个笼统的 `FOR ALL` 就认为完成安全设计。
4. 检查 policy 子查询本身是否受其他 RLS 影响、是否出现递归策略，以及是否有必要为安全访问创建更窄的函数。
5. 用两个不同组织的测试用户验证跨组织访问失败。

## 7.8 RLS 常见失败模式

- **表忘记启用 RLS**：这是最危险的配置之一。用生产检查清单逐表验收。
- **有 RLS policy 却没有表级权限**：请求仍可能被 `GRANT` 层拒绝。RLS 与传统 SQL 权限是两层检查，不是互相替代。
- **只在 UI 判断**：攻击者可以直接调用 API。
- **过度宽松的 `USING (true)`**：等于对该角色开放所有行，除非确实是刻意设计。
- **只写 `USING`、不考虑 `WITH CHECK`**：可能允许改写行的归属关系。
- **用高权限 secret key 进行常规用户请求**：会绕过本来希望生效的 RLS。
- **测试只用一个管理员用户**：管理员看得到所有东西，无法证明普通用户隔离正确。

**本章练习**：创建两个组织和两个用户；把用户 A 放入组织 A，用户 B 放入组织 B。尝试让 A 通过 Data API 查询 B 的项目，应当得不到项目行；再尝试用 A 插入属于 B 的 `organization_id`，应被拒绝。

**本章验收**：能说明 RLS 开关的效果、`USING` 与 `WITH CHECK` 的区别，并设计出按用户/组织隔离的 policy；知道授权还包括表级 GRANT、角色与实际访问路径。

* * *

# 第 8 章：客户端 API、服务端直连、密钥与权限模型

## 8.1 Publishable key 并不等于用户权限

当前 Supabase 项目可能显示新的 publishable/secret key；老项目或旧代码也可能看到 `anon` / `service_role` 这组 legacy key。

- **Publishable key**（旧项目里的 anon key）：用于标识项目并发起客户端请求。它可以出现在前端，但它本身不是某个用户的授权证明。数据库实际允许访问哪些行，还需要看请求身份、Postgres 角色授权和 RLS。
- **用户 access token / JWT**：在用户登录后代表具体用户的会话身份，Data API 会利用该身份上下文执行权限检查。
- **Secret key**（旧的 `service_role` key）：适合受信任的服务端管理操作，权限很高，会绕过 RLS 的关键保护。绝不能放在浏览器包、公开源代码、移动客户端或前端环境变量里。
- **Postgres 数据库密码/连接串**：连接数据库协议的凭据，与项目 API key 不是一回事。也必须只保存在安全的服务端环境。

Secret key 的一个细节：如果请求携带了已认证用户的 access token，某些 Supabase 请求仍会按该用户的 RLS 规则执行；不要据此把 secret key 用在前端，也不要对高权限路径做错误假设。最安全原则是：不需要绕过 RLS 的请求就不要使用 secret key。

## 8.2 浏览器通常通过 Data API 访问数据

典型前端初始化（环境变量名称因框架而异）：

```ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)
```

这里的 `NEXT_PUBLIC_` 是某些前端框架表示“会进入浏览器构建产物”的命名约定。只把公开的项目 URL 与 publishable key 放在可暴露的变量里。绝不要写：

```ts
// 错误示例：不要把 secret key 放入前端变量或浏览器代码
const supabase = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_SECRET_KEY!)
```

代码里的感叹号只是 TypeScript 非空断言，不是运行时验证。真正上线时，环境变量缺失应当在应用启动/构建阶段明确失败，不要把未定义值当成安全配置。

## 8.3 服务端直连何时有用

服务端使用 Postgres 驱动或 ORM 连接数据库，常见于：

- 需要复杂 SQL 或数据库事务的后端业务。
- 长时间运行的 worker、定时作业和管理脚本。
- 数据导入、migration、`pg_dump` 等运维任务。
- 需要使用特定 PostgreSQL 功能、Data API 无法直接表达的操作。

直接连接用的是连接串对应的 Postgres 角色。若使用 `postgres` 这类高权限角色，不应假设 RLS 能拦住所有误操作；RLS 默认对表所有者有特殊行为，`BYPASSRLS` 角色也可以绕过行级策略。为常规应用流量创建权限受限的数据库角色、只授予需要的 schema/table/sequence/function 权限，并在该路径上做安全测试。

浏览器不能安全地保存数据库密码，也不应直接建立受信任数据库连接。把数据库连接串给客户端就等于把数据库凭据交给用户。

## 8.4 一个实用的权限分层

- 前端普通查询：publishable key + 当前登录用户 JWT + RLS。
- 服务端的用户上下文请求：服务端 SDK，但保留用户身份并让 RLS 检查用户权限。
- 服务端管理员操作：仅在明确需要时使用 secret/service key；对输入做验证，限定操作范围，记录审计日志。
- 迁移与数据库维护：独立、受保护的数据库凭据；只给 CI/CD 或受信任开发环境使用，不给普通应用请求复用。

不要为了省事，在所有 API handler 中都使用 admin client。那会把数据库的最终安全边界从可审查的 RLS 移到每一个应用接口的手写判断里，大幅增加漏检风险。

**本章练习**：在仓库里搜索所有 `SUPABASE_SECRET_KEY`、`service_role`、`DATABASE_URL`，确保它们只出现在服务端或受控部署配置中。确认浏览器 bundle 中只有预期的 publishable key。

**本章验收**：能解释 publishable key、用户 JWT、secret/service_role key 与 Postgres 连接串的区别；知道客户端 SDK API 和服务器数据库直连具有不同的权限模型。

* * *
# 第 9 章：Migration、Seed、Reset 与远程部署

正确的数据库开发工作流，不是“在 Dashboard 点几下，确认能跑就算完成”。可维护的团队会把 schema 变更记录成 migration，使另一个开发者、CI 环境或全新项目都能重放这些变化。

## 9.1 什么是 migration

Migration 是描述数据库结构从一个版本演化到下一个版本的 SQL 文件。比如：创建项目表、给任务加 `due_at`、添加索引、增加一条 RLS policy。它应当是有顺序、有版本、能 review 的变更记录。

创建 migration：

```bash
npx supabase migration new add_task_due_at
```

然后编辑新建的 SQL 文件：

```sql
alter table public.tasks
  add column due_at timestamptz;

create index tasks_due_at_idx
  on public.tasks (due_at)
  where deleted_at is null and due_at is not null;
```

先在本地验证，再提交到版本控制。不要把所有结构变更都只留在远程 Dashboard 里。否则新同事从空环境重建项目时，可能无法得到一样的 schema。

## 9.2 Reset 的含义，以及为什么危险

```bash
# 只重置本地数据库：重新创建数据库结构、按顺序执行 migration，再应用 seed
npx supabase db reset --local
```

`db reset` 会丢弃并重建目标数据库的数据，再重放 migrations/seed。它在本地特别有用，因为它证明项目能从空数据库重建。它绝不是“修复一下但保留数据”的普通命令。

在执行之前必须确认：

1. 当前操作目标是 `--local` 还是远程项目。
2. 当前连接/CLI link 指向哪个 project ref。
3. 数据是否可丢弃，是否有经过验证的备份。

团队规范应该要求对有破坏性的命令显式指定目标。不要在生产终端里凭记忆执行 reset。

## 9.3 Seed：可重复的开发/测试数据

Seed 是在数据库结构建立之后载入的初始数据。通常文件是 `supabase/seed.sql`；CLI 配置可设置种子文件路径。默认工作流里，首次 `supabase start` 以及每次 `db reset` 会在 migrations 后执行 seed。

Seed 的最佳用途：

- 放测试场景所需、可以安全重建的虚构数据。
- 初始化非敏感的参考数据或本地 demo 数据。
- 让测试环境有稳定、可预测的输入。

不要把真实用户数据、个人资料、生产导出的订单或密钥直接塞进 seed。也不要把 schema DDL 与普通 fixture 数据混在一起；结构放 migration，种子数据放 seed。Auth 测试用户要么通过受支持的本地 Auth 流程建立，要么使用专门、清楚标注只供本地的 fixture 方法，不要把生产用户导入开发环境。

例如给仅供 demo 的非敏感参考数据插入固定 UUID 时，可以这样写：

```sql
insert into public.organizations (id, name)
values
  ('10000000-0000-0000-0000-000000000001', 'Local Demo Organization')
on conflict (id) do nothing;
```

真实应用中的组织创建与成员关系还需要用户身份和权限流程；上面的 seed 只是展示幂等插入方式，不是完整的多租户 fixture。

## 9.4 本地完整验证循环

每次修改 schema 时，都应该在本地走一个可复现的循环：

1. 用 `migration new` 新建 migration。
2. 编写 SQL，包含约束、索引、权限和 RLS 的对应改动。
3. 在本地执行 migration，或通过 `db reset --local` 验证所有迁移能从零重放。
4. 执行功能测试：插入合法行应该成功，违反约束的行应该失败，权限不够的访问应该失败。
5. 检查查询计划、响应行为和应用代码生成类型（如果项目使用生成类型）。
6. 将 migration、测试和应用代码一起提交 Git。

若项目已有 Dashboard 上的手工改动，先核对远程 schema 与 migration 历史，必要时用官方支持的 `db pull` / `db diff` 工作流把变化纳入版本管理。不要在远程生产 schema 与本地 migration 之间悄悄保持长期分叉。

## 9.5 连接远程项目并部署 migration

在 Supabase Dashboard 建立独立的开发/预览项目。然后：

```bash
npx supabase login

# 把本地项目关联到一个明确的远程 Supabase 项目
npx supabase link --project-ref your-project-ref

# 推送本地尚未应用的 migration 到该远程项目
npx supabase db push --linked
```

不同版本 CLI 会有额外的选项，例如指定数据库密码或跳过 pooler。使用前请先核实 `npx supabase db push --help` 和官方参考。首次 link 或远程数据库已有历史结构时，可能需要先用 `db pull` 对齐迁移历史，而不是直接推送。

`db push --linked` 会对关联的远程数据库执行未应用的迁移。它不是模拟运行；执行前需要审查 migration 并确认 link 的项目 ref。**不要把生产项目当成第一次实验 `db push` 的地方。**

## 9.6 生产变更必须考虑锁表与兼容性

数据库变更会与正在处理的请求并发发生。某些 DDL 可能需要强锁或重写大量数据。举例来说，给大表新增非空列、加检查约束、创建索引，具体风险依命令与 Postgres 版本而不同。

生产变更应采取分步兼容的做法：

- 先增加可空列，发布能同时兼容旧 schema 与新 schema 的应用代码。
- 回填旧数据，观察锁等待、CPU、IO 与业务请求。
- 验证数据完整后，再根据业务要求加约束或默认值。
- 删除旧字段要等所有应用版本都不再读写它后再执行。
- 对大型索引创建、长事务与 lock timeout 做额外设计；必要时采用官方支持的并发索引创建策略，并确认 migration 工具是否允许该语句的事务模式。

不要把“migration 文件只是一段 SQL”理解为“它对生产的影响很小”。它可能改变数据、阻塞请求、耗尽磁盘或使旧应用不兼容。

## 9.7 Preview / Staging / Production 环境隔离

至少应有以下逻辑环境：

- **Local**：开发者机器上的本地 Supabase 栈，随时可重置。
- **Preview / Staging**：远程隔离测试环境，用于集成测试、验收迁移和预发布验证。若使用 Supabase Branching，可以给 pull request 创建独立预览环境；是否可用取决于项目计划和当前产品能力。
- **Production**：真实用户数据和服务；只由受控的发布流程修改。

每个远程环境都要有自己的项目 URL、publishable key、secret key、数据库密码、第三方凭据和回调 URL。不要把生产 `DATABASE_URL` 复制到本地 `.env.local`，也不要让预览部署指向生产数据库。

建议使用：

- `.env.local`：只供本地应用开发，加入 `.gitignore`。
- CI/CD 的受保护环境变量或 secrets store：用于 preview、staging、production。
- 分环境部署配置：确保构建产物引用当前环境正确的 URL 与 publishable key。
- 独立的测试用户与虚构数据：避免预览环境里的测试动作触碰真实客户资料。

公开的 publishable key 可以进入前端，但不同环境仍应使用各自项目的 key，以避免误连错库；secret key 和数据库密码始终只在受信任服务端保存。

**本章练习**：新建一个 migration 增加 `tasks.priority` 和 CHECK 约束；执行 `db reset --local`，确认从空库重建成功；将同一 migration 推到一个独立的测试项目，再用 SQL 验证约束生效。

**本章验收**：能解释 migration/seed/reset/db push 的区别；能从空数据库重建应用；能在不触碰生产数据的情况下完成一次远程测试部署。

* * *

# 第 10 章：连接池、Direct Connection 与 Transaction Pooler

Postgres 使用连接处理请求，但数据库可用连接数有限。大量短命的 serverless 请求如果每个都创建新连接，很容易耗尽连接资源。所以 Supabase 提供直连与连接池等不同连接方式。

## 10.1 Direct connection（直接连接）

直接连接通常适合长时间运行的后端，例如常驻 VM 或容器里的服务。它绕过池化代理，与数据库建立连接。优点是会话语义完整，适合 migration、`pg_dump`、恢复、复制等需要单一数据库会话或原生 Postgres 工具的任务。

网络限制也很重要：Supabase 直接数据库连接的 IPv4/IPv6 可达性取决于当前项目/套餐和是否配置 IPv4 选项。如果运行环境只能通过 IPv4 访问，而 direct endpoint 不能从 IPv4 到达，就应该选择支持 IPv4 的 pooler 或按平台要求配置网络能力。

## 10.2 Session pooler（会话池）

会话模式在客户端会话期间把客户端绑定到一个后端数据库连接，适合需要 IPv4 连接的常驻应用、数据库 GUI 或需要预备语句等会话特性的客户端。它能缓解客户端连接数压力，但池化仍有连接和容量限制。

## 10.3 Transaction pooler（事务池）

事务池在每个事务结束后把底层连接交还池中。因此客户端不能假设下一笔事务还使用同一条数据库会话。

重要限制包括：

- 事务池模式不支持某些预备语句行为；使用的驱动/ORM 通常需要关闭 prepared statements 或使用其兼容配置。
- 依赖会话状态的功能，如跨事务的临时表、某些 `SET` 状态、会话级 advisory lock、`LISTEN/NOTIFY`，不能假设会在下一笔事务保留。
- 游标等机制可能只在单个事务里有效。
- 客户端连接池太大时，很多 serverless 实例乘以每实例连接数，仍可能迅速消耗数据库连接资源。

对 serverless / edge function 的短请求来说，transaction pooler 经常更合适。应用端的连接池也应设置得保守；把池大小设为 10 乘以很多个 warm instance，可能造成连接总数失控。具体设置应依驱动文档与 Supabase 当前连接指南调整。

## 10.4 如何选

| 场景 | 常见起点 | 为什么 |
|---|---|---|
| 浏览器前端 | Data API / Supabase 客户端库 | 浏览器不应持有 Postgres 密码；RLS 控制访问 |
| Serverless / Edge Function | Transaction pooler | 短连接密集，需要减少底层连接占用 |
| 常驻后端服务，支持数据库 endpoint 的网络 | Direct connection 或合适的 pooler | 长寿命连接可承受；依赖会话语义时直连更简单 |
| 只能走 IPv4 的持久服务或数据库 GUI | Session pooler | 在网络兼容的前提下使用连接池 |
| Migration、`pg_dump`、恢复、复制任务 | Direct connection（符合项目网络条件时） | 这些任务常需要稳定的数据库会话或原生工具行为 |

最终要从 Supabase Dashboard 的 Connect 面板复制当前项目的实际 host、port、user 与 connection string；不要根据网上某个项目的主机名拼出自己的连接串。

## 10.5 连接安全与容量

- 连接串里的数据库密码是秘密，不能发给前端或提交到 Git。
- 生产连接启用 TLS/SSL，并按驱动文档配置证书验证/`sslmode`。
- serverless 驱动通常应复用模块级客户端，不要在每次请求里无限创建新的连接池。
- 查看实际活跃连接数、排队时间、数据库连接上限与应用实例数，而不是一味扩大池大小。
- 事务要短，不要在一个事务里等待外部 API 响应。

**本章练习**：写出你自己的三个运行环境（浏览器、serverless function、常驻 worker）各自使用什么连接方式，并说明原因。阅读当前驱动的 prepared statements 配置，确保它与选定 pooler 模式兼容。

**本章验收**：能解释 direct、session pooler、transaction pooler 的不同；知道 transaction pooler 下哪些会话状态假设不再可靠；能根据运行环境选择连接方式。

* * *
# 第 11 章：Storage、Bucket、权限、生命周期与签名 URL

Postgres 适合存结构化元数据，Storage 适合存文件对象。两者配合，不代表文件字节和数据库行处于同一个事务或同一套备份机制内。

## 11.1 Bucket 的访问模型

Supabase Storage 中通常有两种桶：

- **Private bucket**：默认应优先考虑。下载和其他操作通过授权与 `storage.objects` 的 RLS policy 检查，或通过限时签名 URL 分享访问。
- **Public bucket**：文件读取/提供服务会绕过私有对象访问控制。知道或猜到对象 URL 的人就可能读取文件；其他操作（例如上传、删除）仍受相应权限控制。

适合公开桶的例子：公开博客封面、公开营销素材、无敏感信息的头像。适合私有桶的例子：合同、医疗/财务文件、私密项目附件、仅组织成员可访问的资料。

公开桶不是“更容易配置的私有桶”。它是公开读取模型。不要把私有资料放进去后，再指望数据库 RLS 把文件隐藏起来。

## 11.2 文件访问需要对象级授权

文件权限不仅仅是数据库元数据访问。你需要区分：

- 用户是否能列出某个 bucket 的文件；
- 用户是否能上传到某个路径；
- 用户是否能下载特定对象；
- 用户是否能覆盖、移动或删除对象。

可以在 `storage.objects` 上为上传、读取、删除分别设计 RLS policy。路径命名可体现租户边界，例如 `organization_id/user_id/...`，但路径名本身并不是权限验证。**知道某个组织 ID 或文件路径不应自动赋予访问权限。** 策略必须验证当前身份确实属于相应组织，并且拥有该操作权限。

不要只按 `owner_id` 判断“谁都可以访问自己的对象”就结束设计。对于组织共享文件，还要验证对象的组织范围；对于上传路径，必须避免用户把对象写入另一个组织的目录。

## 11.3 Signed URL 适合限时分享

私有文件的一种常见做法，是先验证当前用户有权下载对象，再生成短时效签名 URL：

```ts
const { data, error } = await supabase.storage
  .from('private-documents')
  .createSignedUrl('organization-a/contracts/contract.pdf', 60 * 10)

if (error) throw error
// 把 data.signedUrl 返回给符合业务授权的用户
```

上例有效期为 10 分钟。签名 URL 应当像 bearer credential 一样看待：拿到链接的人在有效期内可能可以访问资源。不要把它永久存到公开页面或日志里。对高度敏感的文件，使用较短期限，并在签发前重新检查对象权限。

签名 URL 不是“随时都能立即撤销”的通用授权体系；根据 Supabase 当前文档，它的有效期内不一定能通过旋转 Auth key 使其立刻失效。因此要谨慎设置期限、控制传播渠道、避免记录完整 URL。

## 11.4 上传限制、生命周期与清理

Bucket 可以设置最大文件尺寸、允许的内容类型等限制，帮助拒绝明显不符合要求的上传。客户端扩展名不可信；生产端还应根据威胁模型考虑 MIME 验证、恶意文件扫描、图片重新编码、下载响应头、存储成本和配额。

生命周期不是仅靠 `deleted_at` 字段就能完成的。要明确：

- 何时将文件标记为不再使用；
- 什么时候真正删除对象；
- 是否需要保留一段时间用于恢复；
- 对象对应的业务数据库记录被删除或归档时，如何处理文件；
- 失败的上传、孤立对象和引用丢失如何被发现与清理。

删除 Storage 对象要通过 Storage API 或官方支持的方法执行。**不要直接 DELETE `storage.objects` 数据库记录来代替删除文件**：实际文件对象可能仍留在 Storage 中，造成 orphaned object。数据库里的对象元数据与储存的文件字节是分开的。

## 11.5 数据库与 Storage 的一致性不是自动事务

设想创建一个任务，然后上传附件：数据库 INSERT 成功但文件上传失败；或者文件上传成功但数据库记录写入失败。不要假设 Postgres 事务可以回滚 Storage 对象。

实际设计可以用状态字段和补偿流程：先建立 `pending` 记录，上传成功后改成 `ready`；失败时重试或清理孤儿对象。或者先上传到临时路径，验证后再登记引用。选择取决于你的应用对残留文件、可恢复性和用户体验的要求。

**本章练习**：为“组织内部的项目附件”创建一个 private bucket；设计读取、上传和删除规则，保证组织 A 的成员不能读取组织 B 的文件；再讨论附件记录删除后文件应保留多久。

**本章验收**：能解释 public/private bucket、签名 URL、Storage RLS 及生命周期清理；知道数据库备份不包含实际 Storage 对象。

* * *

# 第 12 章：备份、恢复、迁移前后验证与线上数据保护

备份不是控制台里看到一个绿色状态就结束的事情。只有在你能确定恢复点、能恢复到可用环境、并知道数据库和文件哪些被恢复时，备份才具有实际价值。

## 12.1 先分清备份覆盖的是什么

Supabase 的数据库备份覆盖 Postgres 数据库相关内容。**Storage API 的实际文件对象不包含在数据库备份里**；数据库中的 storage 元数据与文件字节是两个层面。恢复数据库到旧时间点，不会自动把这之后删除的文件对象重新恢复出来。

因此一个完整的恢复计划通常要分别考虑：

- 数据库 schema 与业务数据；
- Storage 文件对象；
- 需要重新设置的自定义角色密码/机密；
- Edge Function 的部署与密钥；
- 应用本身与环境变量；
- 外部系统状态，例如支付服务的交易、邮件提供商记录等。

## 12.2 托管备份、逻辑导出和 PITR

Supabase 当前文档说明，Pro、Team、Enterprise 计划项目会有每日数据库备份；备份保留范围依计划而不同，Point-in-Time Recovery（PITR）则提供更细粒度的恢复能力并有对应的资格和资源要求。免费项目应主动创建逻辑导出并放到项目之外的安全位置。计划、价格和保留期限会变化，上线前以当前官方页面为准。

逻辑导出是一个独立可保存的 SQL/数据备份；它便于迁移或选择性恢复，但不等同于完整物理恢复，也不应假设一个默认导出同时包含所有 Supabase 管理的 schema、角色和数据。使用 CLI 时要阅读导出模式与选项。

例如从链接的远程项目导出 schema：

```bash
npx supabase link --project-ref your-project-ref
npx supabase db dump --linked -f supabase/schema-backup.sql
```

官方 CLI 的 `db dump` 默认是结构导出，不包含所有数据行或自定义角色。需要数据或角色时，应按当前 CLI 文档指定相应选项，并安全存放结果。导出可能包含业务 schema 定义和其他敏感信息，所以备份文件也需要访问控制与加密。

如果用 `pg_dump` 直接对数据库做备份，先确认当前连接方式与工具版本的兼容性；数据库密码应通过受保护的凭据渠道提供，而不是硬编码在脚本或命令历史中。不要把生产备份提交到 Git。

## 12.3 恢复要真正演练

推荐定期在隔离项目里做 restore drill：

1. 选择一个备份或明确的恢复时间点。
2. 恢复到独立、隔离的环境，而不是覆盖真实生产来做第一次试验。
3. 验证 schema、关键表行数、关键关系、最近交易/事件与关键业务不变量。
4. 确认自定义角色和凭据的恢复后处理步骤。
5. 单独验证 Storage 文件是否存在、路径能否访问，并确定数据库记录与对象字节是否匹配。
6. 测试应用能否连接、登录、读取/写入关键数据。
7. 记录恢复用了多久、可能丢失多少数据、遇到了什么手工步骤，并据此改进 runbook。

恢复整个托管项目可能有中断，执行前要理解该恢复动作会覆盖什么、影响哪些服务、是否需要重新配置复制/订阅等能力。不要把“有备份”误认为“恢复无需停机”。

## 12.4 迁移前检查清单

每个可能影响真实数据的 migration 上线前，应确认：

- 目标 project ref 是正确的环境，当前命令明确指向 `--local` 或目标项目。
- 已审查完整 SQL，而不仅是 migration 文件名。
- 已在本地从零重放 migrations 并通过功能测试。
- 已在 staging/preview 上使用接近真实的结构与合理的数据规模测试。
- 新旧应用版本对 schema 变更兼容，发布顺序明确。
- 大表 DDL、索引建立、回填和约束验证的锁与资源影响可接受。
- 有可用备份，且团队知道恢复的实际步骤与数据损失窗口。
- 相关 RLS、GRANT、Storage policy 和生成类型已一起更新。

## 12.5 迁移后验证清单

数据库结构成功更新，不等于应用正确。迁移后至少做以下验证：

- schema：确认新列/约束/index/policy 已存在。
- 数据：行数、NULL 比例、重复项、外键完整性和关键聚合正确。
- 权限：匿名用户、普通用户、不同组织用户、管理员分别测试允许与拒绝场景。
- 应用：关键查询、写操作、分页、上传下载和 Auth 流程通过。
- 性能：重点查询计划、连接使用情况、数据库错误、锁等待与响应时间没有明显恶化。
- 监控：检查数据库日志、平台监控、Performance Advisor/Security Advisor 提示和应用错误追踪。
- 数据恢复：若变更不可逆或风险高，明确回滚策略。很多数据迁移不是简单执行 `down` 就能无损反向还原。

## 12.6 保护真实个人数据

- 测试尽可能使用合成数据，而不是生产用户数据。
- 若确需复制生产数据到 staging，应有授权、脱敏方案、访问限制、留存期限和删除流程。
- 备份和导出是敏感数据副本；不能因为文件名叫 `backup.sql` 就默认安全。
- 应用日志不要写出 access token、数据库连接串、签名 URL、个人文件内容或完整的敏感请求体。
- 软删除不等于隐私删除完成。真实删除可能涉及主表、子表、Storage 对象、外部系统和备份保留规则；应明确合法/业务保留要求以及备份生命周期。
- 定期练习“误删数据”“误推 migration”“密钥泄露”“某用户越权读取”的事故响应流程，而不只是写一份没人用过的文档。

**本章练习**：建立一个 staging 项目，做一次数据库逻辑导出并在隔离环境恢复。对照数据和关键查询确认恢复结果；另外选择一个 Storage 测试文件，验证数据库恢复后文件对象是否也被恢复——你应该能观察到二者并非自动同步恢复。

**本章验收**：能解释日备份、逻辑导出、PITR 的差异，知道数据库备份不包含 Storage 文件字节；具备迁移前后验证清单和至少一次恢复演练记录。

* * *
# 第 13 章：把整套知识串起来，完成一次小型上线

到这里，我们有了关系模型、SQL、事务、索引、RLS、Storage 和部署流程。最后用一份端到端交付流程把它们连起来。

## 13.1 第一次交付的目标

实现一个团队任务应用的最小可靠版本：

1. 用户能注册和登录。
2. 每个用户只能看到自己所属组织的项目。
3. 有编辑权限的成员才能创建/修改任务。
4. 数据模型有主键、外键、唯一约束、CHECK 与合理的删除策略。
5. 常用列表有明确排序与分页，且有相匹配的索引。
6. 私有附件放在 private bucket，通过 Storage RLS 或短时签名 URL 访问。
7. 本地一条命令能从 migration 重建数据库。
8. 测试环境部署经过验证；生产环境的凭据与数据完全隔离。
9. 有数据库和 Storage 文件对象各自的备份/恢复方案。

## 13.2 推荐实施顺序

**第一步：本地初始化。** 初始化 CLI，运行本地栈，确认 Studio 和 SQL Editor 可用。提交安全的本地配置文件。

**第二步：写 schema migration。** 创建 organizations、organization_members、projects、tasks、labels、task_labels；为字段加上适当约束，明确删除策略。先不要把精力放在所有边缘功能，优先把基本数据完整性做正确。

**第三步：编写查询。** 先用 SQL 写出项目列表、任务列表、任务统计和标签查询。在数据库里看结果是否正确，再将稳定的查询接入应用。不要让前端承担本来应当由数据库约束或查询完成的工作。

**第四步：设计 RLS。** 针对 SELECT、INSERT、UPDATE、DELETE 分别写规则。验证未登录用户、组织成员、编辑者和管理员的读写行为。不要仅用管理员账号测试。

**第五步：接入 Auth 与 Data API。** 浏览器使用 publishable key 和用户会话；所有业务表确保 RLS 与表级权限都符合预期。服务端的管理任务与用户请求分开使用不同的权限路径。

**第六步：做性能基线。** 记录核心列表和统计查询，查看 EXPLAIN。只为真实的常用查询增加合适索引。给分页选择唯一排序键；如果列表不断增长，用 cursor/keyset 分页而不是无限增加 OFFSET。

**第七步：接入 Storage。** 给头像等公开媒体和项目私有附件选择不同 bucket。实现上传/删除规则，制定对象生命周期、孤儿对象清理和备份方案。

**第八步：让本地可重建。** 用 `db reset --local` 从零执行 migration 和 seed，重新运行测试。如果只有某个开发者的数据库能工作，说明工程还没有可复现。

**第九步：远程 Preview/Staging。** 创建独立项目，设置独立环境变量，把 migration 推上去。测试真实网络条件、Auth 回调、Storage、RLS、连接池与迁移行为。

**第十步：生产发布。** 审查迁移与回滚策略，确认备份与恢复流程、监控与警报、环境和密钥隔离。执行受控发布并进行上线后验证。

## 13.3 上线前的可勾选验收表

- [ ] 所有暴露给客户端的业务表都已评估并启用适当的 RLS。
- [ ] 每个 RLS policy 都能对应到明确的业务规则，不存在无意的 `USING (true)`。
- [ ] `USING` 和 `WITH CHECK` 的职责被正确区分，更新操作不能越权改变组织归属。
- [ ] GRANT、角色和 RLS 一起检查；测试使用真实的普通用户身份，而不是只用高权限凭据。
- [ ] publishable key 与 secret key 区分清楚；secret/service_role key、数据库密码和连接串不在前端或 Git 历史里。
- [ ] schema 变更由 migration 记录，能够从空数据库重建；seed 不包含真实客户数据。
- [ ] `reset` 只在确认可丢弃的环境运行；部署命令明确指向正确 project ref。
- [ ] 生产 schema 改动经过 staging 验证，并考虑锁、数据回填、兼容性与失败恢复。
- [ ] 热门 SQL 有观察依据与合理索引，没有为了保险建立大量索引。
- [ ] 查询分页有稳定的唯一排序；大列表有清晰的 cursor 方案或对 OFFSET 成本有认识。
- [ ] 数据库连接方式与运行环境匹配；transaction pooler 的限制与驱动配置已验证。
- [ ] private bucket 保护私有文件；签名 URL 有短时效；文件删除通过 Storage API；有 orphan cleanup 策略。
- [ ] 数据库备份与 Storage 文件备份分别设计；至少演练过一次恢复。
- [ ] 生产数据没有被随意复制到本地或 preview；日志与备份有访问限制。
- [ ] 有上线后检查项目：错误率、慢查询、连接数、锁等待、RLS/安全检查、文件访问和业务关键操作。

## 13.4 最终自测：你是否真正掌握了基础

不看前文，试着回答这些问题。无法解释的地方，就是下一轮复习的目标。

1. 为什么 `organization_members` 要用复合主键？
2. 外键和普通索引分别解决什么问题？外键引用方列一定自动有索引吗？
3. 为什么多对多关系通常需要关联表？
4. 为什么 `NULL = NULL` 不能用来查空值？
5. 为什么分页 `ORDER BY created_at DESC` 还可能不稳定？
6. `GROUP BY` 与窗口函数有什么区别？
7. Postgres 的默认 Read Committed 下，两条 SELECT 为什么可能看到不同结果？
8. 为什么用一条带条件的 UPDATE 扣库存，往往比应用端读-改-写更安全？
9. `EXPLAIN ANALYZE` 会不会真正执行 SQL？
10. 打开 RLS 后没有 policy，会发生什么？`USING` 与 `WITH CHECK` 分别检查什么？
11. 为什么隐藏按钮不是授权？publishable key 为什么不等于用户权限？
12. 为什么 secret key 和 Postgres 数据库连接串都不能进入浏览器？
13. 为什么 serverless 常使用 transaction pooler？该模式为什么影响 prepared statements 与会话状态？
14. 为什么公开 Storage bucket 不适合私密附件？签名 URL 应注意什么？
15. `db reset --local`、`db push --linked` 分别可能改变什么环境？
16. 为什么恢复数据库备份后，Storage 文件不一定恢复？
17. 为什么 migration 上线前要先在 staging 测试？
18. 如果删除用户，会怎样影响 profile、任务作者、成员关系、Storage 文件和备份？这些行为由什么规则定义？

如果你能基于自己的小项目回答上述问题，并用两个不同组织的测试用户证明 RLS 的允许/拒绝行为，再完成一次本地 reset、测试环境 migration 发布和恢复演练，就不只是“会点 Supabase 控制台”了，而是已经掌握了可靠使用托管 Postgres 的关键实践。

* * *

# 附录 A：官方资料索引

本教程主要依据以下 Supabase 与 PostgreSQL 官方文档的主题构建。命令、计划限制、密钥产品形态以及连接端点都可能变化；实际部署前应打开对应页面核对。

## Supabase 官方文档

1. [Database Overview](https://supabase.com/docs/guides/database/overview) — Supabase 数据库的 Postgres 基础与整体架构。
2. [Local Development & CLI](https://supabase.com/docs/guides/local-development) — 本地栈与 CLI 工作方式。
3. [Local Development Workflow](https://supabase.com/docs/guides/local-development/cli-workflows) — `config.toml`、migration、seed 与本地/远程目标说明。
4. [Database Migrations](https://supabase.com/docs/guides/local-development/database-migrations) — 创建和应用迁移。
5. [Seeding Your Database](https://supabase.com/docs/guides/local-development/seeding-your-database) — seed 文件和执行时机。
6. [Database Migrations for Deployment](https://supabase.com/docs/guides/deployment/database-migrations) — 数据库迁移部署流程。
7. [Deployment & Branching](https://supabase.com/docs/guides/deployment) — 环境与发布工作流。
8. [Branching](https://supabase.com/docs/guides/deployment/branching) — preview branch 及隔离环境。
9. [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) — RLS、`USING`、`WITH CHECK` 与权限绕过。
10. [Securing Your Data](https://supabase.com/docs/guides/database/secure-data) — Data API、publishable key、secret/service role key 与直连的安全模型。
11. [Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres) — direct connection、session 与 transaction pooler。
12. [Connection Pooling and Limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits) — 连接池、连接限制与容量。
13. [Storage Buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals) — public/private bucket 的访问模型。
14. [Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control) — Storage RLS 策略。
15. [Serving Assets / Downloads](https://supabase.com/docs/guides/storage/serving/downloads) — 公共对象、私有对象和签名 URL。
16. [Delete Objects](https://supabase.com/docs/guides/storage/management/delete-objects) — 使用 Storage API 删除对象。
17. [Database Backups](https://supabase.com/docs/guides/platform/backups) — 每日备份、PITR、逻辑导出以及 Storage 文件不包含在数据库备份中的边界。
18. [Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod) — 生产安全、性能、部署和监控验收。
19. [CLI Reference](https://supabase.com/docs/reference/cli) — 查找当前 `db dump`、`db reset`、`db push` 等命令与选项。

## PostgreSQL 官方文档

1. [Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html) — 主键、外键、唯一约束、CHECK 与删除策略。
2. [Transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html) — 事务的全有或全无语义。
3. [Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html) — Read Committed、Repeatable Read、Serializable。
4. [Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html) — 行锁与显式锁定。
5. [Multicolumn Indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html) — 复合索引与最左列规则。
6. [Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html) — 查询计划及 `EXPLAIN ANALYZE`。
7. [Window Functions](https://www.postgresql.org/docs/current/tutorial-window.html) — 窗口函数入门。
8. [WITH Queries / CTE](https://www.postgresql.org/docs/current/queries-with.html) — CTE 与递归查询。
9. [Sorting Rows](https://www.postgresql.org/docs/current/queries-order.html) — `ORDER BY` 和结果顺序。
10. [LIMIT and OFFSET](https://www.postgresql.org/docs/current/queries-limit.html) — 分页及稳定排序。
11. [Comparison Functions and Operators](https://www.postgresql.org/docs/current/functions-comparison.html) — NULL 比较与 `IS DISTINCT FROM`。

* * *

# 附录 B：新手最容易犯的 12 个错误

1. 把 Supabase 当成一个前端 SDK，而不理解它最终围绕 Postgres 的权限与数据模型运行。
2. 在表已经暴露给客户端时，忘记启用并验证 RLS。
3. 以为“用户已登录”就能看所有数据，没按用户/组织边界检查。
4. 把 `service_role`/secret key 放进浏览器环境变量或公开仓库。
5. 让多个环境共享一个生产数据库密码或把 preview 指向生产数据库。
6. 只在 Dashboard 手工改 schema，不写 migration，导致本地和生产结构漂移。
7. 不区分 seed 与真实数据，把生产数据放入测试种子。
8. 以为外键会自动为引用方列创建索引，或者反过来为所有列盲目加索引。
9. 使用不带稳定 `ORDER BY` 的分页，或者在大表上无限扩大 OFFSET。
10. 用应用层先读再写实现计数器/库存，而不处理并发问题。
11. 把公开 bucket 用来存私密附件，或以为删除数据库行就会删除真实文件字节。
12. 认为有自动数据库备份就等于有完整灾难恢复能力，而从不演练恢复、不单独备份 Storage 文件。

把这 12 个错误当作 code review 的检查表，往往比记住几十条 CLI 命令更有价值。
