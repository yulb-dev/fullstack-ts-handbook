# 第 3 章：Supabase CLI、config.toml、迁移、种子数据与 reset

[上一章](./02-relational-model-and-constraints.md) · [目录](./README.md) · [下一章](./04-schema-design-and-normalization.md)

第 1 章已经能连接托管云数据库；可选本地练习还展示了“Studio 里建的表在 `db reset` 后消失”。无论使用哪条路径，本章解决同一个问题：**如何让数据库结构像代码一样被保存、审阅、复现和部署**。

云端用户先阅读 3.1–3.3 的原理，并按 3.8 节的云端流程应用迁移。3.4–3.6 中的 `db reset`、本地 seed 与 Studio diff 是可选的本地操作，不是使用托管数据库的必做步骤。

答案是**迁移（migration）**：一组带时间戳、按顺序执行的 SQL 文件。它们和应用代码放在同一个 Git 仓库里，任何人 clone 下来执行 `supabase db reset`，都能得到一模一样的数据库；部署时用 `supabase db push` 把尚未执行的迁移按顺序应用到线上。

本章结束时，你会完成 Teamboard 的第一份迁移、第一份种子数据，并理解从本地到远程的完整命令链。

## 3.1 为什么一定要用迁移

| 做法                                   | 问题                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| 在线上 Dashboard 直接改表              | 没有记录、没人审阅、无法在另一个环境重现；出了问题不知道改过什么                           |
| 在本地 Studio 改完，再到线上照着点一遍 | 人工同步必然遗漏；权限、策略、触发器这些看不见的东西最容易漏                               |
| 写一个“全量建表脚本”，每次删库重建     | 线上有数据，不能删库                                                                       |
| **迁移文件**                           | 每次变更是一个新文件；文件进 Git，经过代码审阅；每个环境记录自己执行到了哪一份，只执行新的 |

Supabase CLI 在每个数据库里维护一张表 `supabase_migrations.schema_migrations`，记录哪些迁移已经执行过。`db push` 就是靠它判断“哪些是新的”。

## 3.2 认识 config.toml

`supabase init` 生成的 `supabase/config.toml` 控制**本地栈**的行为。它很长，这里只讲本教程依赖的部分（完整示例见 [example/supabase/config.toml](./example/supabase/config.toml)）：

```toml
# 同一台机器上区分多个本地项目（容器名前缀），与云端 project ref 无关
project_id = "teamboard"

[api]
port = 54321
# 只有这里列出的 schema 会生成 REST/GraphQL 端点
schemas = ["public", "graphql_public"]
# 单次请求最多返回的行数，防止意外的超大查询
max_rows = 1000
# 新表不自动授权给 anon/authenticated/service_role，必须在迁移里显式 grant（第 8 章）
auto_expose_new_tables = false

[db]
port = 54322
shadow_port = 54320
# 必须与线上数据库的大版本一致：线上执行 show server_version; 确认
major_version = 17

[db.seed]
enabled = true
sql_paths = ["./seed.sql"]

[auth]
site_url = "http://127.0.0.1:5173"
additional_redirect_urls = ["http://localhost:5173"]

[auth.email]
enable_confirmations = false   # 本地为了方便关闭邮箱确认
```

几条要点：

1. **`config.toml` 可以提交到 Git**，因为它默认不含秘密。需要秘密（例如 GitHub OAuth 的 client secret）时，写成 `secret = "env(SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET)"`，真实值放在项目根目录的 `.env` 中，CLI 会自动替换。`.env` 必须加入 `.gitignore`。
2. **这些设置主要描述本地栈，普通 `db push` 只应用迁移，不会把整个 config.toml 同步到云端。** 云端的 Auth、Data API 设置要在目标项目 Dashboard 中配置；Branching 的配置同步是另一条明确支持的流程（第 12 章）。`major_version` 不会改变云数据库版本，`port = 54322` 也不是云连接端口。
3. **改了 config.toml 之后要 `supabase stop` 再 `supabase start` 才生效。**
4. `[db] major_version` 不一致会导致本地能跑、线上不能跑（或反过来），务必对齐。
5. `auto_expose_new_tables` 是较新的选项。云端新项目从 2026 年 5 月起默认不再自动向 Data API 角色授权，2026 年 10 月 30 日起该行为扩展到所有现有项目；把本地也设成 `false` 能让你在开发阶段就暴露“忘了 grant”的问题。即使你的 CLI 版本还不认识这个选项，本教程的迁移也会显式 `revoke` + `grant`，结果一致。

## 3.3 创建第一份迁移

Teamboard 的第一张业务表是 `profiles`：每个登录用户一行公开资料（昵称等）。用户本身由 Supabase Auth 管理，存在 `auth.users` 中，我们不改它，而是用外键引用它。

```bash
npx supabase migration new create_profiles
```

CLI 会创建一个空文件，文件名形如 `supabase/migrations/20261022090000_create_profiles.sql`。时间戳部分就是迁移的**版本号**，决定执行顺序。

把下面的内容写进去（与 [example 中的同名迁移](./example/supabase/migrations/20261022090000_create_profiles.sql) 一致）：

```sql
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
```

逐段理解：

**`private` schema**：Data API 只暴露 `config.toml` 里 `[api].schemas` 列出的 schema。把内部函数放在 `private`，它们就不会变成 `/rest/v1/rpc/...` 端点。Supabase 官方明确警告：不要把 `security definer` 函数放在暴露的 schema 里。

**`profiles.id` 同时是主键和外键**：一个用户最多一个 profile（一对一关系）。`on delete cascade`：用户被删除时，资料跟着删除——资料是用户的一部分，留着没有意义。

**启用 RLS + 收回权限**：现在还没讲到权限（第 8、9 章），但从第一张表开始就养成习惯：**表一创建就处于“谁都访问不了”的状态，之后再有意识地开放。** 反过来做（先开放、以后再收紧）是数据泄露最常见的原因。

**触发器函数**：

- `returns trigger`：这是一个触发器函数，`new` 代表刚插入的那一行（这里是 `auth.users` 的新行）。
- `security definer`：函数以**创建者**（迁移执行者 `postgres`）的权限运行。注册用户时，触发它的是 Auth 服务的内部角色，这个角色没有写 `public.profiles` 的权限；定义者权限让插入得以完成。
- `set search_path = ''`：函数内部所有对象都必须写全名（`public.profiles`）。否则调用者可以通过修改 `search_path` 让函数去操作一个同名的恶意对象，而函数又以高权限运行。**每个 `security definer` 函数都要这样写**，这是官方的硬性建议。
- `coalesce(a, b, c)` 返回第一个非 NULL 的参数；`nullif(x, '')` 把空字符串变成 NULL。合起来就是：优先用注册时传入的 `display_name`，否则用邮箱 `@` 前面的部分，再否则用“新用户”。`left(..., 50)` 保证不违反长度约束——**如果这个触发器出错，用户注册会直接失败**，所以要写得足够稳健。

## 3.4 可选本地操作：db reset 与 migration up

云端教学项目使用 3.8 节的 `db push` 追加迁移，不使用这里的 reset。已有业务项目必须先完成基线检查；绝不要把 reset 的目标改成它。

```bash
npx supabase db reset
```

`db reset` 做三件事：**删除本地数据库 → 按文件名顺序执行 `supabase/migrations/` 下的全部迁移 → 执行种子数据**。看到成功输出后，用 psql 检查：

```sql
\d public.profiles

select version, name from supabase_migrations.schema_migrations order by version;
--      version     |      name
-- -----------------+-----------------
--  20261022090000  | create_profiles
```

另一个命令 `npx supabase migration up` 只执行**尚未执行**的本地迁移，不清空数据。日常开发中两者的选择：

| 命令           | 适用场景                                          |
| -------------- | ------------------------------------------------- |
| `db reset`     | 默认选择。每次都从零验证“完整迁移链 + 种子”能跑通 |
| `migration up` | 本地已有不想丢的手工测试数据，只想追加新迁移      |

## 3.5 种子数据（seed）

种子数据让每个开发者 reset 之后立刻有可用的演示数据。下面的占位用户与演示数据只供本地栈或独立、可丢弃的教学云项目使用，不能写入已有业务或生产项目。**普通 `db push` 不会自动执行 seed.sql**，云端教学项目需要明确的数据初始化步骤（3.8 节），而生产绝不能加 `--include-seed`。按官方说明：

- 默认文件是 `supabase/seed.sql`，也可以在 `[db.seed] sql_paths` 里配置多个文件或通配符（按声明顺序执行，通配符匹配的文件按字典序）；
- **在首次 `supabase start` 和每次 `supabase db reset` 时，于全部迁移之后执行**；
- **只写数据，不写结构**——结构属于迁移。

此时只有 `profiles` 表，先创建 `supabase/seed.sql`，插入几个“占位用户”：

```sql
insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.test', '{"display_name": "Alice"}'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.test',   '{"display_name": "Bob"}'),
  ('33333333-3333-4333-8333-333333333333', 'carol@example.test', '{"display_name": "Carol"}'),
  ('44444444-4444-4444-8444-444444444444', 'dave@example.test',  '{"display_name": "Dave"}'),
  ('66666666-6666-4666-8666-666666666666', 'frank@example.test', '{"display_name": "Frank"}');
```

```bash
npx supabase db reset
```

```sql
select id, display_name from public.profiles order by display_name;
-- 5 行，全部由触发器自动生成
```

关于这些用户，有三点要说清楚：

1. **它们不能登录**。官方种子示例同样说明：这样插入的用户没有密码，只是为了让演示数据有合法的 `user_id` 可引用。需要能登录的本地用户，要通过 Auth 管理 API 创建（第 8 章的 `npm run dev:users`）。
2. **使用固定的 UUID**，这样种子数据、测试和文档里可以稳定地引用同一个人。
3. **全部是虚构数据**，邮箱用保留域名 `example.test`。**绝不要把线上用户数据导出来当种子**（第 13 章详细讨论）。

第 4 章建好全部业务表后，会把种子扩展成完整版本（[example/supabase/seed.sql](./example/supabase/seed.sql)）。

## 3.6 两种修改结构的方式

### 方式一：手写 SQL（推荐）

```bash
npx supabase migration new add_bio_to_profiles
# 编辑生成的文件
npx supabase db reset
```

### 方式二：在 Studio 里改，然后用 diff 生成迁移

在本地 Studio 里给 `profiles` 加一列，然后：

```bash
npx supabase db diff -f add_bio_to_profiles
```

`db diff` 会用你的迁移文件构建一个“影子数据库”（shadow database，端口 54320），再与当前本地数据库比较，把差异写成新的迁移文件。

**生成的 SQL 是草稿，必须人工审阅**。官方文档列出了常见的意外内容：

- 一长串 `grant` / `revoke` 语句（差异引擎把权限也当作结构的一部分）；
- `create extension` / `drop extension`：本地和远端启用的扩展不同时出现，`drop extension` 会在 `db reset` 时被静默执行；
- 数据修改（insert/update/delete）**永远不会**被捕获，包括 Storage 桶（它们是表里的行）；
- 某些对象（cast、operator 等）不被跟踪，只给出警告。

新版本 CLI 默认使用 `pg-delta` 差异引擎（`config.toml` 中 `[experimental.pgdelta] enabled = true`），旧项目可能还在用 `migra`。两者输出风格不同，但“生成的是草稿”这一原则不变。

> 官方还提供“声明式 schema”（在 `supabase/schemas/` 中描述目标状态，再用 `supabase db schema declarative sync` 生成迁移）。它是另一种工作流，**一个项目只选一种**。本教程使用最直观的手写迁移。

## 3.7 迁移的纪律

1. **已经推送到任何共享环境（预览、预发、生产）的迁移文件，永远不要修改。** 要改就写一个新迁移。原因：远端已经记录“这个版本执行过了”，你改了文件它也不会再执行，环境之间就此不一致。
2. **只存在于你本地、从未推送过的迁移可以继续修改**，改完 `db reset` 即可。本教程第 8、9 章就会这样逐步完善同一份迁移。
3. **一份迁移只做一件事**，命名说清楚做了什么（`add_bio_to_profiles`，而不是 `update`）。
4. **团队冲突**：同事先合并了一个时间戳更晚的迁移，而你的迁移时间戳更早但还没合并。官方建议的处理方式是把你的文件改名为一个新的、更晚的时间戳，再 `db reset` 验证。
5. **结构与权限放在一起**：建表的迁移里同时写 `enable row level security` 和 grant/revoke，不要“以后再补”。

## 3.8 云端主线：初始化、关联项目、追加迁移

### 先区分“用什么连接”与“工具在哪里运行”

以下按本文使用的 CLI Docker 工作流说明；实验性原生运行时是另一种可选方式，不能把它的能力默认套到每个版本。

| 操作                                               | 是否必须启动完整本地 Supabase 栈 | 工具前提与目标                                                                 |
| -------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------ |
| SQL Editor、psql、`pg`、supabase-js                | 否                               | 直接访问托管云服务；不需要 Docker                                              |
| `init`、`migration new`                            | 否                               | 创建本地配置/SQL 文件，不需要 Docker，不改云库                                 |
| `login`、`link`、`migration list`、`db push`       | 否                               | CLI 认证及远端访问；不要求先 `supabase start`，但 push 会改云库                |
| `gen types --lang typescript --project-id <ref>`   | 否                               | 登录后从云项目生成类型，不依赖本地栈                                           |
| `db pull`、`db diff`（包括远端比较）               | 不必启动完整栈，但需要临时环境   | 构建影子数据库/执行差异工具，Docker 工作流需要容器运行时                       |
| `db dump`（包括 `--linked` / `--db-url`）          | 否                               | Docker 工作流通过容器运行 pg_dump，仍需容器运行时；只装本机 pg_dump 是不同方案 |
| `db reset --local`、`test db`、`gen types --local` | 是                               | 本地路线；reset 重建本地数据                                                   |

**数据库托管在云端，不代表用于比较、备份和测试的每个 CLI 命令都没有本地依赖。** 不要为连接云库而启动本地栈，也不要因为命令有 `--linked` 就假设它不使用容器。

### 空的教学云项目：迁移作为唯一结构来源

先在 Dashboard 创建一个独立教学项目，确认里面没有你的业务表和真实数据；创建过程不需要 Docker。获取 project ref（Dashboard URL 中的项目标识），再在单独目录初始化：

```bash
mkdir teamboard-cloud
cd teamboard-cloud
npm init -y
npm install --save-dev --save-exact supabase@2.121.0
npx supabase init
npx supabase login
```

文件在电脑上，数据库在云端，这是正常的“本地应用代码 + 托管数据库”模式，不代表你本地也有一个 Postgres。

下面的 link 必须指向**教学项目**，不是你的已有业务项目。密码使用 CLI 提示输入，不写进命令或文档：

```bash
npx supabase login                          # 浏览器登录，获取访问令牌
npx supabase link --project-ref <project-ref>  # 把本地目录关联到某个云端项目（会提示输入数据库密码）
npx supabase migration list                 # 对比本地与远端各执行到了哪个版本
npx supabase db push --dry-run              # 只显示将要执行哪些迁移
npx supabase db push                        # 把远端尚未执行的迁移按顺序执行
```

`link` 只选择目标，不会创建业务表；`db push` 只执行尚未应用的迁移，不需要本地 reset。先完成章节里的 SQL 文件，再执行命令链。`--dry-run` 只是预览，不验证 SQL 在目标数据上一定成功。

云端跟做时，第 4 份 `grants_and_rls` 要先读完第 8、9 章、补齐策略再推送。它一旦执行到云端就不能像本地 reset 那样回头修改，后续调整必须写新迁移。其余建表、索引、Storage 定义按原有章节顺序编写。

需要第 4、5 章的固定查询结果时，只有在**这个独立教学项目**完成前两份迁移、确认目标和种子文件后，才可以显式初始化虚构数据：

```bash
# 仅限已确认的独立教学项目；不是已有业务库的跟做命令
npx supabase db push --include-seed
```

种子数据中的 auth.users 只是无密码的占位行，不是可登录用户。云端登录实验在教学项目中通过正常注册/确认邮件建立两个测试用户，见第 8 章；不要在生产创建教程账号。要重新回到种子状态，选择另一个干净教学项目重新应用迁移，或使用可选本地栈 reset，**不通过重置业务云数据库达成**。

### 已有云项目：先建立基线，不能直接套示例

1. 先在第 1 章的只读查询里了解已有表、版本、RLS；查明团队是否已有迁移仓库。有仓库就沿用它，不重新复制 Teamboard 的 5 份迁移。
2. 没有迁移历史而是一直通过 Dashboard 改表时，在**另一个空目录**执行 `init`、`login`、`link`。`migrations/` 必须尚未混入本教程的建表 SQL，否则影子库比较基线就是错的。
3. 按官方“Move an existing project to local development”流程，用 `db pull` 获取现有结构。此步骤构建影子数据库，需要本文 Docker 工作流的容器运行时；它不是普通的只读 SQL 查询。没有容器时，先继续用只读查询与现有数据访问代码，不贸然 push，也不要用一个完整 pg_dump 文件冒充已经对齐的迁移基线。
4. 审阅生成文件（包括扩展、授权、函数与 Storage 策略）。`db pull` 会询问是否把基线记为远端已应用；**接受会修改远端迁移历史**，应在理解和确认后进行，不随意加自动确认标志。
5. 在隔离环境重放基线，核对 `migration list`，之后才为实际业务需求创建增量迁移。基线文件不是要在原库重新执行的建表脚本，也不是用户数据备份。

用库名 `postgres` 或看到一张已有的 `profiles` 表，都不足以判断“这是空教学库”。项目用途、数据与迁移历史需要一起确认。

### 其他命令与安全边界

| 命令                     | 作用                                             | 警告                                                                                                          |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `db pull`                | 远端被人手工改过（“漂移”），把差异拉成一个新迁移 | 拉下来的文件同样要审阅                                                                                        |
| `db push --include-seed` | 推送迁移后再执行种子数据                         | **官方明确：绝不能用于生产库**                                                                                |
| `db reset --linked`      | 清空**远端**数据库并按本地迁移重建               | **会删除远端所有数据**，只能用于一次性的开发/预发项目；执行前用 `supabase projects list` 确认关联的是哪个项目 |
| `migration repair`       | 手工修正远端的迁移历史记录                       | 只在明确知道历史为什么不一致时使用                                                                            |

注意各命令的默认目标不同：`db diff`、`db reset` 默认针对本地（`--local`），而 `db pull`、`db push`、`db dump` 默认针对已关联的远端（`--linked`）。拿不准时显式写出参数。

## 3.9 生成 TypeScript 类型

云端主线（先登录，ref 必须属于目标环境）：

```bash
npx supabase gen types --lang typescript --project-id <project-ref> > database.types.ts
```

可选本地路线（需要本地栈已运行）：

```bash
npx supabase gen types --lang typescript --local > database.types.ts
```

`--local` 读取的是本地数据库，不是当前云项目；也不要把 `supabase status` 当成云端状态命令，它查看的是本地栈。

在前端使用：

```ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

// data 的类型会自动推断为 { id: string; display_name: string }[]
const { data } = await supabase.from("profiles").select("id, display_name");
```

每次结构变化都要重新生成。官方的 CI 示例会在 PR 中重新生成类型并与仓库里的文件比较，不一致就失败——这样可以防止“迁移改了，类型忘了更新”。

## 3.10 动手练习

云端主线：在独立教学项目写并推送一份新迁移，再写第二份迁移撤销这个变更，比较前后 `migration list`。已应用云端的 SQL 不能通过删本地文件来撤销。下面关于删除文件、diff 与 reset 的练习只在本地完成。

1. 新建迁移 `add_bio_to_profiles`，给 `profiles` 增加可空列 `bio text`，并限制长度不超过 280。执行 `db reset`，用 `\d public.profiles` 确认。
2. 用 `select * from supabase_migrations.schema_migrations;` 看看现在记录了几个版本。
3. 删除第 1 题的迁移文件（它从未推送过，可以删除），再 `db reset`，确认 `bio` 列消失。
4. 在 Studio 里给 `profiles` 加一列 `website text`，然后执行 `npx supabase db diff`（不加 `-f`，输出到终端），观察生成的 SQL；最后执行 `db reset` 丢弃这个改动。
5. 思考：如果第 1 题的迁移已经推送到了预发环境，第 3 题应该怎么做？

### 参考答案

1. ```sql
   alter table public.profiles
     add column bio text check (bio is null or char_length(bio) <= 280);
   ```
   其实 `char_length(NULL) <= 280` 的结果是 NULL，而 CHECK 把 NULL 视为“通过”，所以 `check (char_length(bio) <= 280)` 也能工作；显式写出 `bio is null or` 是为了让读者一眼看懂意图。
2. 两个：`create_profiles` 与 `add_bio_to_profiles`。
3. 删除后 `db reset` 只执行剩下的迁移，`bio` 不复存在。
4. 你会看到 `alter table ... add column "website" text` 之类的语句，可能还附带权限语句。这就是“diff 生成的是草稿”的含义。
5. 不能删除或修改已推送的迁移。应新建一个迁移 `drop_bio_from_profiles` 执行 `alter table public.profiles drop column bio;`，让所有环境沿着同一条历史前进。

## 本章验收

- [ ] 能说出迁移相对于“在控制台改表”的四个优势，以及远端如何记录已执行的迁移。
- [ ] 能解释 `config.toml` 中 `[api].schemas`、`max_rows`、`[db] major_version`、`[db.seed]`、`env()` 的作用，知道修改后要重启。
- [ ] 云端主线：能用 `migration new` 写文件、确认目标并用 `db push` 追加迁移；可选本地路线能用 reset 重放迁移链并解释 migration up 的区别。
- [ ] 能解释种子数据的执行时机，以及为什么它只能包含虚构数据。
- [ ] 能解释 `security definer` + `set search_path = ''` 的作用与必要性。
- [ ] 知道 `db diff` 生成的是需要审阅的草稿，知道它不会捕获数据变更。
- [ ] 能说出 `link`、`migration list`、`db push --dry-run`、`db push` 的作用，以及 `--include-seed` 和 `db reset --linked` 的风险。

## 官方阅读

- [Local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Database migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Managing config and secrets](https://supabase.com/docs/guides/local-development/managing-config)
- [CLI config reference](https://supabase.com/docs/guides/local-development/cli/config)
- [Seeding your database](https://supabase.com/docs/guides/local-development/seeding-your-database)
- [Breaking change：新表不再自动暴露给 Data API](https://github.com/orgs/supabase/discussions/45329)
- [PostgreSQL：CREATE FUNCTION（security definer 与 search_path）](https://www.postgresql.org/docs/current/sql-createfunction.html)
