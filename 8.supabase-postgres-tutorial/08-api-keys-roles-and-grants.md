# 第 8 章：API Key、数据库角色与 GRANT——客户端直连与服务端直连的权限模型

[上一章](./07-transactions-and-concurrency.md) · [目录](./README.md) · [下一章](./09-row-level-security.md)

前面通过云端 SQL Editor 或 psql 操作时，通常使用管理角色 `postgres`。真实应用里，请求来自浏览器、来自你的服务器、来自定时任务，它们在数据库里分别是**谁**？各自能做什么？谁负责拦住越权？

本章回答这些问题，并写出第四份迁移的前半部分：**GRANT**。第 9 章再补上后半部分：**RLS 策略**。

## 8.1 一张总图：五条访问路径

```text
① 浏览器/App ──publishable key（未登录）──────────► Data API ──► 角色 anon
② 浏览器/App ──publishable key + 用户 JWT ─────────► Data API ──► 角色 authenticated（auth.uid() = 用户 id）
③ 你的服务器 ──secret key ───────────────────────► Data API ──► 角色 service_role（BYPASSRLS）
④ 你的服务器 ──publishable key + 转发用户 JWT ─────► Data API ──► 角色 authenticated（以该用户身份）
⑤ 你的服务器 ──数据库连接串（postgres 或自建角色）──► Postgres ──► 连接串里的角色
```

| 路径 | 第一道检查                         | 第二道检查                              | 谁负责“只能看自己的数据”         |
| ---- | ---------------------------------- | --------------------------------------- | -------------------------------- |
| ① ②  | GRANT                              | RLS 策略                                | **数据库**                       |
| ③    | GRANT（是的，service_role 也需要） | **无**：`service_role` 拥有 `BYPASSRLS` | **你的服务端代码**               |
| ④    | GRANT                              | RLS 策略                                | **数据库**（服务端只是代为转发） |
| ⑤    | GRANT（表所有者天然拥有全部权限）  | 表所有者默认不受 RLS 约束               | **你的服务端代码**               |

记住结论：**能绕过 RLS 的凭据（secret key、数据库密码）只能存在于你完全控制的服务器上**；凡是会被发到用户设备上的东西，都默认已经公开。

## 8.2 API Key：标识“哪个应用在调用”

官方的表述是：API key 标识的是**调用方是什么**（网页、App、服务器、Edge Function），Supabase Auth 才标识**调用方是谁**（哪个用户）。

| 类型                 | 格式                       | 权限         | 放在哪里                                                  |
| -------------------- | -------------------------- | ------------ | --------------------------------------------------------- |
| Publishable key      | `sb_publishable_...`       | 低           | 可以公开：网页、移动/桌面 App、CLI、开源代码              |
| Secret key           | `sb_secret_...`            | 高，绕过 RLS | **只能**在服务器、Edge Function、定时任务、管理后台的后端 |
| `anon`（旧）         | 长期有效的 JWT（`eyJ...`） | 低           | 旧版 publishable key                                      |
| `service_role`（旧） | 长期有效的 JWT（`eyJ...`） | 高           | 旧版 secret key                                           |

几个关键事实（均来自官方 API Keys 文档）：

1. **Supabase 正在弃用旧的 `anon` 与 `service_role` key**，新项目应使用 publishable 与 secret key。网上的教程、AI 生成的代码如果让你复制一个以 `eyJ` 开头的长 key，那是旧写法。
2. 新旧两套 key 可以同时生效，旧 key 要在 Dashboard 的 Settings > API Keys 里单独停用。
3. **Secret key 在浏览器里不可用**：Supabase 会根据 `User-Agent` 识别浏览器请求并返回 401。但这只是防误用，攻击者用其他工具照样能用泄露的 key，所以它**不是**安全边界。
4. 每个 key 对应一个内置 Postgres 角色：

   | key         | 用户是否已登录                    | 数据库角色      |
   | ----------- | --------------------------------- | --------------- |
   | Publishable | 否                                | `anon`          |
   | Publishable | 是（请求携带用户的 access token） | `authenticated` |
   | Secret      | 不适用                            | `service_role`  |

5. 官方特别注明：**即使客户端用 secret key 初始化，只要请求携带了用户的 access token，就会以该用户身份执行并受 RLS 约束。**

### 云端项目的 key

在目标云项目 Dashboard 的 Connect 或 Settings > API Keys 获取 HTTPS 项目 URL 与 publishable key。只有需要管理 API 的服务器才配置 secret key；单纯使用 `pg`/ORM 访问 SQL，不需要 secret key。数据库密码则来自 Database Settings/Connect 的数据库连接配置，不能把它当成 API key。

在应用自己的环境变量中填写目标环境的值，不在文档里保存真实凭据。**`supabase status` 查看的是本地栈，不是云项目**；`config.toml` 不会替你把云端 key 注入应用。前端开发服务器跑在 localhost，也完全可以调用云端 Supabase，这时不需要本地数据库。

### 可选：本地栈的 key

`npx supabase start` / `npx supabase status` 输出的 Publishable 与 Secret 是本地栈自己生成的，和任何云端项目无关。把它们填进 `.env.local`：

```bash
cp .env.example .env.local
# 编辑 .env.local，填入 supabase status 显示的 Publishable 和 Secret
```

[`.env.example`](./example/.env.example) 是可以提交的模板，真实的 `.env.*` 文件都在 `.gitignore` 里。

## 8.3 Supabase 的数据库角色

| 角色                | 是什么                                                                    | 能否登录              |
| ------------------- | ------------------------------------------------------------------------- | --------------------- |
| `anon`              | 未登录的 Data API 请求                                                    | 否（由 API 切换过来） |
| `authenticated`     | 已登录用户的 Data API 请求                                                | 否                    |
| `service_role`      | secret key 的请求；拥有 `BYPASSRLS`                                       | 否                    |
| `authenticator`     | Data API 用来连接数据库的角色，收到请求后切换（`set role`）到上面三者之一 | 是（仅供平台）        |
| `postgres`          | 你在 Dashboard SQL 编辑器、迁移、直连时使用的管理角色；你创建的表的所有者 | 是                    |
| `supabase_admin` 等 | 平台内部角色                                                              | 不供你使用            |

用户的 JWT 内容会被放进当前事务的配置项 `request.jwt.claims`。`auth.uid()` 就是从这里读出 `sub`（用户 id），`auth.jwt()` 返回整个 claims。这就是为什么第 9 章的策略可以写 `user_id = auth.uid()`。

## 8.4 GRANT：第一道闸门

Postgres 的权限检查分两步，**顺序很重要**：

1. **GRANT**：这个角色能不能对这张表执行这种操作（select / insert / update / delete）？不能 → 立即报错 `42501 permission denied`，策略根本不会执行。
2. **RLS 策略**：能执行的话，作用于哪些行？不匹配的行被静默过滤（读不到、改不到），或者写入被拒绝。

官方因此总结了一条调试规则：**请求被拒绝时先检查 grant，再检查策略。** 两者的症状不同：

| 症状                                               | 原因                                                            |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `42501 permission denied for table tasks`          | 缺少 grant                                                      |
| 查询成功但返回空数组                               | grant 有，但策略没有匹配任何行（或者表开了 RLS 却没有任何策略） |
| `42501 new row violates row-level security policy` | 写入的新行不满足 `WITH CHECK`                                   |

### “默认授权”的历史与变化

过去，Supabase 项目在 `public` 中新建的表会**自动**把所有权限授予 `anon`、`authenticated`、`service_role`——建表即暴露。官方文档的警告是：**新表一旦在暴露的 schema 中且没开 RLS，任何拥有 grant 的角色都可以读写它**，而“加了策略”并不会收回那些 grant。

平台正在把这个默认行为改为“显式授权”：2026 年 4 月起可以在建项目时选择关闭“自动暴露新表”，5 月 30 日起成为新项目的默认值，**2026 年 10 月 30 日起对所有现有项目生效**（已有的表保留原来的权限）。变更后，新表在你写出 `grant` 之前，Data API 完全看不到它，PostgREST 会返回带提示的错误：

```json
{
  "code": "42501",
  "message": "permission denied for table your_table",
  "hint": "Grant the required privileges to the current role with: GRANT SELECT ON public.your_table TO anon;"
}
```

查看你的项目对新对象会授予什么（官方提供的查询）：

```sql
select
  case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' end as object_type,
  a.grantee::regrole as role,
  string_agg(a.privilege_type, ', ' order by a.privilege_type) as privileges
from pg_default_acl d
cross join lateral aclexplode(d.defaclacl) a
where d.defaclrole = 'postgres'::regrole
  and d.defaclnamespace = 'public'::regnamespace
  and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
group by 1, 2
order by 1, 2;
```

返回空结果表示新对象不会自动授予任何权限。

**Teamboard 的策略：不管平台默认是什么，每一张表都在迁移里先 `revoke all`、再精确 `grant`。** 这样无论新旧项目、无论本地还是云端，结果都一致，而且权限的每一处变化都能在代码审阅中看到。

## 8.5 写出第四份迁移：GRANT 部分

```bash
npx supabase migration new grants_and_rls
```

先写两部分：RLS 辅助函数（第 9 章细讲，这里先建好）和 grants。完整文件见 [example/supabase/migrations/20261022093000_grants_and_rls.sql](./example/supabase/migrations/20261022093000_grants_and_rls.sql)。

```sql
-- 1. RLS 辅助函数（第 9 章解释）
create function private.user_org_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.memberships where user_id = (select auth.uid())
$$;

create function private.has_org_role(p_org_id uuid, p_roles public.org_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships
     where org_id = p_org_id and user_id = (select auth.uid()) and role = any (p_roles)
  )
$$;

revoke all on function private.user_org_ids() from public;
revoke all on function private.has_org_role(uuid, public.org_role[]) from public;
grant usage on schema private to authenticated;
grant execute on function private.user_org_ids() to authenticated;
grant execute on function private.has_org_role(uuid, public.org_role[]) to authenticated;

-- 2. Grants
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

grant select, insert, delete on public.organizations to authenticated;
grant update (name) on public.organizations to authenticated;

grant select, insert, delete on public.memberships to authenticated;
grant update (role) on public.memberships to authenticated;

grant select, insert, delete on public.projects to authenticated;
grant update (name, archived_at) on public.projects to authenticated;

grant select, insert on public.tasks to authenticated;
grant update (title, status, priority, assignee_id, due_on, deleted_at) on public.tasks to authenticated;

grant select, insert, delete on public.labels to authenticated;
grant update (name, color) on public.labels to authenticated;

grant select, insert, delete on public.task_labels to authenticated;

grant select, insert, delete on public.comments to authenticated;
grant update (body) on public.comments to authenticated;

grant select, insert, delete on public.attachments to authenticated;

-- service_role 会绕过 RLS，但仍然需要 grant
grant select, insert, update, delete on all tables in schema public to service_role;
```

逐条理解设计意图：

**`anon` 什么也没有。** Teamboard 没有任何面向未登录访客的数据。“未登录能看什么”应该是一个有意识的决定，而不是默认结果。

**列级 UPDATE 权限**是 RLS 做不到的事（RLS 管“哪些行”，不管“哪些列”）：

| 表              | 客户端**不能**改的列                           | 原因                                                             |
| --------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `organizations` | `seat_limit`、`slug`、`created_by`             | 席位由计费逻辑（服务端）决定；slug 出现在 URL 中，不允许随意变更 |
| `projects`      | `next_task_number`、`org_id`、`key`            | 编号计数器只能由触发器修改，否则可以把它改回 1 制造编号冲突      |
| `tasks`         | `org_id`、`project_id`、`number`、`created_by` | 不能把任务“搬”到别的组织，也不能伪造作者                         |
| `comments`      | 除 `body` 以外的全部                           |                                                                  |

**tasks 没有 DELETE 权限**：客户端只能软删除（更新 `deleted_at`），硬删除只由服务端的清理任务执行（第 11 章）。

**为什么插入不需要授予序列权限？** `identity` 列的序列由 Postgres 在插入时内部使用，只需要表的 INSERT 权限（老式 `serial` 才需要额外授予序列的 USAGE）。

**`service_role` 的 grant**：在“不再自动授权”的项目里，连 secret key 也访问不了没有 grant 的表。官方原话是：缺少 grant 时返回权限错误，**包括 `service_role`**。

保存后：

```bash
npx supabase db reset
```

## 8.6 观察：有 grant、没有策略

现在每张表都：启用了 RLS、对 `authenticated` 有 grant、**还没有任何策略**。PostgreSQL 文档说明，启用 RLS 而没有策略时使用“默认拒绝”：看不到任何行，也不能修改任何行。

在 psql 里模拟两种角色（第 9 章会把这种写法用于自动化测试）：

```sql
begin;
set local role anon;
select * from public.tasks;
-- ERROR:  permission denied for table tasks          ← 没有 grant：报错
rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';   -- 扮演 Alice
select count(*) from public.tasks;
--  0                                                 ← 有 grant，没有策略：空结果
insert into public.tasks (org_id, project_id, title)
select org_id, id, 'x' from public.projects where key = 'WEB';
-- INSERT 0 0                                         ← projects 也读不到任何行，于是插入了 0 行
rollback;
```

`set local role` 只在当前事务内切换身份；`request.jwt.claim.sub` 就是 `auth.uid()` 读取的值。

## 8.7 创建能登录的测试用户：云端注册与可选本地脚本

### 云端教学项目：走正常 Auth 注册与登录

种子数据中 Alice、Bob 等占位行没有密码，不能拿它们直接登录。先完成第 9 章的迁移与策略，再在**独立教学项目**中用自己控制的测试邮箱注册两个账号；不要把占位行当作已有可登录用户，也不要在生产批量创建教程用户。

使用第 8.8 节初始化的浏览器客户端：

```ts
// email、password 来自表单；不要把密码写进源码
const signup = await supabase.auth.signUp({ email, password });
if (signup.error) throw signup.error;
// 若项目开启邮箱确认，signup.data.session 可能为 null，先完成邮箱中的确认

const login = await supabase.auth.signInWithPassword({ email, password });
if (login.error) throw login.error;
```

云端邮件真实发送，不会出现在本地 Mailpit 中；使用真实受控的测试邮箱并检查项目的 SMTP/发送限制，不发送给无关人员。保留邮箱确认设置，配置目标云项目的 Site URL 与 Redirect URLs，使回调能返回你的前端开发地址。单纯改本地 config.toml 不会修改这些云端设置。

登录后可在教学项目执行一个实际闭环（以下都是**写操作**）：

```ts
const orgResult = await supabase
  .from("organizations")
  .insert({ slug: `learn-${Date.now().toString(36)}`, name: "教学团队" })
  .select("id")
  .single();
if (orgResult.error) throw orgResult.error;

const projectResult = await supabase
  .from("projects")
  .insert({ org_id: orgResult.data.id, key: "LEARN", name: "学习项目" })
  .select("id")
  .single();
if (projectResult.error) throw projectResult.error;

const taskResult = await supabase
  .from("tasks")
  .insert({
    org_id: orgResult.data.id,
    project_id: projectResult.data.id,
    title: "第一条云端任务",
  })
  .select("id, number, title");
if (taskResult.error) throw taskResult.error;
```

这证明注册用户创建组织、触发器加 owner、按组织授权及任务编号的组合能工作。再用另一个账号的独立浏览器会话查询同一个 org_id，结果应为空；跨组织插入应被策略拒绝（第 9 章）。不要共享同一个客户端的登录态来同时假装两个用户。

### 可选本地路线：管理 API 创建用户

种子数据里的用户没有密码。为了从“客户端视角”测试，我们通过 **Auth 管理 API** 创建两个可登录的用户。管理 API 需要 secret key，所以这是一个服务端脚本：

```js
// scripts/create-dev-users.mjs（节选）
import {
  assertLocalSupabase,
  requireEnv,
  serverClient,
  DEV_USERS,
} from "./lib/env.mjs";

assertLocalSupabase(requireEnv("SUPABASE_URL")); // 地址不是 127.0.0.1/localhost 就拒绝执行
const admin = serverClient(requireEnv("SUPABASE_SECRET_KEY"));

for (const user of DEV_USERS) {
  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { display_name: user.displayName },
  });
  if (error?.code === "email_exists") continue;
  if (error) throw error;
}
```

```bash
npm install          # 安装 @supabase/supabase-js 与 pg（见 example/package.json）
npm run dev:users    # 创建 erin@example.test 与 grace@example.test
```

注意 `assertLocalSupabase`：**检查的是 URL 本身，而不是 `APP_ENV` 之类的变量。** 变量可能写错，地址指向哪里才是事实。这个习惯在第 12 章会扩展成“按环境隔离凭据”的完整做法。

## 8.8 客户端代码：publishable key + 用户会话

浏览器里（以 Vite 为例）：

```ts
// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, // VITE_ 前缀的变量会被打包进浏览器代码
);
```

```ts
await supabase.auth.signInWithPassword({ email, password });

// 之后的每个请求都会自动携带用户的 access token → 数据库角色是 authenticated
const { data, error } = await supabase
  .from("active_tasks")
  .select("id, number, title, status")
  .eq("project_id", projectId);
```

**环境变量前缀就是安全边界**：Vite 只把 `VITE_` 开头的变量打包进前端，Next.js 是 `NEXT_PUBLIC_`。官方 API Keys 文档的 `.env` 示例里专门注释了：服务端变量**不要**加这些前缀，否则打包工具会把 key 发给浏览器。

| 变量                       | 可以有公开前缀吗 |
| -------------------------- | ---------------- |
| `SUPABASE_URL`             | 可以             |
| `SUPABASE_PUBLISHABLE_KEY` | 可以             |
| `SUPABASE_SECRET_KEY`      | **绝对不可以**   |
| `DATABASE_URL`（含密码）   | **绝对不可以**   |

## 8.9 服务端代码：三种方式，三种责任

### 方式 A：secret key（service_role，绕过 RLS）

```js
// scripts/admin-report.mjs（节选）
const admin = serverClient(requireEnv("SUPABASE_SECRET_KEY"));

const { data } = await admin
  .from("organizations")
  .select("slug, seat_limit, memberships(count), projects(key, tasks(count))");
```

它能看到**所有组织**的数据。适用于：跨租户的运营报表、计费系统修改 `seat_limit`、定时任务、数据修复。**数据库不再替你检查权限**，在调用之前，你的代码必须自己确认“这个操作是被允许的”。官方建议：每个后端组件使用**单独**的 secret key，泄露时只需轮换那一个。

### 方式 B：代表用户调用（转发 JWT，RLS 照常生效）

你的服务端接口收到前端请求，需要“以这个用户的身份”读写数据——最安全的做法是**把用户的 token 转发给 Data API**，让 RLS 继续把关：

```ts
import { createClient } from "@supabase/supabase-js";

export async function listMyTasks(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  // 需要在服务端使用用户身份做判断时，先验证 token 的签名
  const { data: claims, error } = await supabase.auth.getClaims(token);
  if (error || !claims) return new Response("Unauthorized", { status: 401 });

  const { data } = await supabase.from("active_tasks").select("id, title"); // 仍然受 RLS 约束
  return Response.json(data);
}
```

在服务端判断“当前用户是谁”时，官方的服务端认证文档有一条硬性规定：**永远不要在服务端代码里信任 `supabase.auth.getSession()`**——它只是从 cookie 里读出会话，不重新验证，任何人都可以伪造 cookie。要用 `supabase.auth.getClaims()`，它每次都会验证 token 签名。Next.js、SvelteKit 等框架使用 `@supabase/ssr` 的 `createServerClient` 管理 cookie，同样遵循这条规则。

### 方式 C：直连 Postgres（第 10 章详述）

```js
// scripts/pg-direct.mjs（节选）
const pool = new pg.Pool({
  connectionString: requireEnv("DATABASE_URL"),
  max: 2,
});
await pool.query("select current_user, count(*) from public.tasks group by 1");
// → postgres，能看到所有数据
```

以 `postgres` 连接时，你是表的所有者，RLS 默认不生效。两种负责任的用法：

1. **在服务端代码中显式加上租户条件**（`where org_id = $1`），并且 `$1` 来自已验证的身份；
2. **在事务内切换到用户身份**，让 RLS 生效：

   ```js
   await client.query("begin");
   await client.query("set local role authenticated");
   await client.query(`select set_config('request.jwt.claims', $1, true)`, [
     JSON.stringify({ sub: verifiedUserId, role: "authenticated" }),
   ]);
   // ……此后的查询受 RLS 约束……
   await client.query("commit");
   ```

   `set local` 与 `set_config(..., true)` 都只在当前事务内有效，事务结束自动失效，因此在事务模式连接池下也不会“串”到其他请求。**`verifiedUserId` 必须来自你已验证签名的 JWT**，绝不能直接取自请求参数，否则任何人都能冒充任何人。

更进一步的做法是为应用服务器创建一个**专用的最小权限数据库角色**（只授予它需要的表和操作，不是表的所有者、没有 `BYPASSRLS`），而不是让应用使用 `postgres`。这属于进阶话题，原则是：**迁移用的身份与业务运行用的身份分开。**

### Edge Functions

在 Supabase Edge Functions 里，官方建议使用 `@supabase/server` SDK（`withSupabase({ auth: 'secret' }, ...)`），由它校验调用方并提供特权客户端，而不是自己从环境变量读取 secret key。注意：仅靠函数的 `verify_jwt` 设置**不能**认证一个只携带 API key 的调用方。

## 8.10 可选本地路线：运行客户端演示

`npm run demo:rls` 会写入教学数据且检查本地 URL，云端用户按 8.7 的注册闭环与第 9 章的权限断言操作，不通过删除这个保护来运行业务云库。

```bash
npm run demo:rls
```

此刻（还没有策略）你会看到：未登录请求报 `42501`；Erin 登录后创建组织失败——因为 `organizations` 没有任何 INSERT 策略，默认拒绝。这正是预期的：**grant 只是打开了门，RLS 决定能进哪个房间。** 第 9 章写完策略后再运行一次，所有步骤都会按设计成功或被拒绝。

## 8.11 Secret key 的安全规则

官方 API Keys 文档列出的规则，按“错误类型”整理：

**绝不能出现在**：网页、公开文档、源代码、打包后的移动/桌面/CLI 程序；任何浏览器中，**包括 localhost**。

**绝不能这样传递**：聊天、邮件、短信；URL 或查询参数（会被记录到日志）；在没有日志脱敏之前放进请求头；明文 HTTP；发往 Supabase 项目以外的地址。

**绝不能写进**：日志（即使看起来是无效的 key）。如需记录，最多保留前缀后随机部分的 6 个字符，或记录其 SHA256 哈希。

**存储与共享**：只在你完全控制的机器上使用；不进源码仓库（包括 CI 脚本），使用 CI 的密钥存储；通过密码管理器的加密分享功能传递，或者干脆让对方自己去 Dashboard 读取。

**降低泄露的损失**：每个后端组件单独一个 secret key。

**泄露后的处理顺序**（不要慌，先修复泄露的根源）：

1. 在 Settings > API Keys 创建新的 secret key；
2. 在所有使用的地方替换为新 key；
3. 确认所有组件都已切换；
4. 删除泄露的 key（删除不可撤销，所以一定要在第 3 步之后）。旧版 `service_role` 泄露时，停用旧版 key（可以重新启用）。

**数据库密码**与 secret key 同等重要：它同样绕过 RLS。泄露后在 Dashboard 的 Database Settings 重置。

## 8.12 决策表：这个操作该走哪条路？

| 场景                                  | 路径                                                  |
| ------------------------------------- | ----------------------------------------------------- |
| 用户在页面上查看/编辑自己组织的任务   | ② 浏览器 + publishable key                            |
| 公开的营销页数据（例如价格表）        | ① anon，并只对那张表授予 `select` 和 `to anon` 的策略 |
| Next.js 服务端组件渲染用户的看板      | ④ 服务端转发用户会话（`@supabase/ssr`），RLS 生效     |
| 支付回调后提升组织席位                | ③ secret key，回调验签后执行                          |
| 夜间清理回收站、删除 Storage 孤儿文件 | ⑤ 直连 + ③ secret key（第 11 章）                     |
| 运行迁移、备份                        | ⑤ 直连（第 10、13 章）                                |

## 8.13 本章练习

1. 新增一个面向未登录访客的 `public.changelog` 表（只读）。写出 grant 与（下一章才会讲的）策略的思路。
2. 同事在 Next.js 项目里写了 `NEXT_PUBLIC_SUPABASE_SECRET_KEY=...`，说“反正 secret key 在浏览器里会被拒绝”。指出至少两个问题。
3. 某个后台接口用 secret key 实现“删除评论”：`admin.from('comments').delete().eq('id', req.body.id)`。问题在哪？怎样修？
4. 为什么 `profiles` 只授予 `update (display_name)` 而不是 `update`？

### 参考答案

1. `revoke all on public.changelog from anon, authenticated; grant select on public.changelog to anon, authenticated;`，启用 RLS 并创建 `for select to anon, authenticated using (true)` 的策略（第 9 章）；不授予任何写权限，内容由服务端维护。
2. ① 带 `NEXT_PUBLIC_` 前缀的变量会被打包进浏览器代码，任何人都能从 JS 文件里读到；② “浏览器中被拒绝”只是根据 User-Agent 的误用防护，攻击者用 curl 等工具照样可以使用它，绕过所有 RLS；③ 此时 key 已经泄露，需要按 8.11 的步骤轮换。
3. service_role 绕过 RLS，任何能调用这个接口的人都可以删除任何组织的任何评论。修复：改为方式 B（转发用户 token，由第 9 章的“作者或管理员可删除”策略把关）；或者在服务端先验证身份，再查询该评论所属组织与作者，确认权限后才删除。
4. 若授予整表 UPDATE，用户就能修改自己那一行的 `created_at`，而“不能把 `id` 改成别人”就完全依赖 RLS 的 `WITH CHECK` 是否写对。列级 grant 把可修改范围缩小到真正需要的那一列，RLS 再限制“只能改自己那一行”——两层互为备份，即纵深防御。

## 本章验收

- [ ] 能画出五条访问路径，说出每条路径在数据库中的角色，以及谁负责数据隔离。
- [ ] 能区分 publishable key、secret key 与旧版 anon/service_role key，说出它们对应的数据库角色。
- [ ] 能解释 GRANT 与 RLS 的检查顺序，并根据症状（报错 / 空结果 / new row violates）判断问题在哪一层。
- [ ] 知道“自动暴露新表”的默认行为变化与时间点，能查询项目的默认权限，坚持在迁移里显式 revoke + grant。
- [ ] 能使用列级 grant 保护 RLS 管不到的列。
- [ ] 能写出浏览器端、服务端转发 JWT、secret key、直连四种代码，并知道服务端必须用 `getClaims()` 而不是 `getSession()` 验证用户。
- [ ] 能说出 secret key 与数据库密码的存放、传递、记录规则和泄露处理步骤。

## 官方阅读

- [Supabase：API keys](https://supabase.com/docs/guides/api/api-keys)
- [Supabase：Securing your API（grants、默认权限、专用 schema）](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase：Postgres Roles](https://supabase.com/docs/guides/database/postgres/roles)
- [Supabase：Creating a server-side client（getClaims）](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Supabase：Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [Breaking change：新表不再自动暴露给 Data API](https://github.com/orgs/supabase/discussions/45329)
- [PostgreSQL：GRANT](https://www.postgresql.org/docs/current/sql-grant.html)
- [PostgreSQL：Privileges](https://www.postgresql.org/docs/current/ddl-priv.html)
