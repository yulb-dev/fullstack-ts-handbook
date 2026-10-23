# 第 1 章：Supabase 到底是什么——心智模型、云端连接与可选本地环境

[目录](./README.md) · [下一章](./02-relational-model-and-constraints.md)

很多人第一次接触 Supabase，是在网页控制台里点几下建一张表，然后在 React 里写一行 `supabase.from('todos').select()`，数据就出来了。这种体验很好，但它容易让人得出一个错误结论：**Supabase 是一个“带控制台的云端 SDK”**。

这个结论会在之后不断坑你：

- 你以为“控制台里改表”就是开发流程，结果线上和本地结构对不上；
- 你以为 `supabase-js` 的每次调用都是“安全的 API”，结果没开 RLS，整张表被任何人读写；
- 你以为 Supabase 有自己的权限系统，其实一切权限最终都落在 Postgres 的角色、授权和行级策略上；
- 你以为连接数据库就是“复制一条连接串”，结果 Serverless 部署后连接数爆满。

本章先建立正确的心智模型，再连接 Supabase 托管云数据库。云端数据库已经由平台运行，日常访问不需要安装 OrbStack 或 Docker Desktop。1.5 节先给出云端步骤；1.6–1.11 节保留完整的可选本地路线，供你练习 reset、隔离实验与自动化测试。

## 1.1 一句话定义

> **Supabase = 一台由平台托管的 PostgreSQL 数据库 + 一组直接建立在这台数据库之上的服务 + 一套把数据库当作代码来开发和部署的工具链。**

拆开来看：

| 层     | 是什么                                                                                        | 你需要掌握的                                  |
| ------ | --------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 核心   | 一台完整的 PostgreSQL（不是“兼容 Postgres 的某种东西”）                                       | 表设计、约束、SQL、索引、事务、锁、角色与权限 |
| 服务   | Data API（PostgREST）、Auth（GoTrue）、Storage、Realtime、Edge Functions、连接池（Supavisor） | 每个服务以什么身份访问数据库、权限怎么生效    |
| 工具链 | Supabase CLI、本地开发栈、迁移、种子数据、类型生成、分支与部署                                | 怎样让本地、预览、生产三套环境的结构保持一致  |
| 控制台 | Studio（Dashboard）                                                                           | 观察和排查工具，而不是“唯一的开发方式”        |

官方架构文档说得很直接：Postgres 是 Supabase 的核心，平台**不对 Postgres 做抽象**，你可以以完整权限访问并使用它；其他工具都是为了让 Postgres 更容易用。

## 1.2 一张图看懂请求怎么走

```text
                ┌──────────────────────────────────────────────────────────┐
  浏览器 / App   │                    Supabase 项目                          │
  ───────────►  │  API 网关                                                 │
  publishable   │   ├─ /rest/v1     → PostgREST（Data API）  ─┐              │
  key + 用户JWT  │   ├─ /auth/v1     → Auth（GoTrue）          │              │
                │   ├─ /storage/v1  → Storage API ───────┐    │              │
                │   ├─ /realtime/v1 → Realtime            │    │              │
                │   └─ /functions/v1→ Edge Functions      │    │              │
                │                                          ▼    ▼              │
  你的服务器      │   连接池（Supavisor / PgBouncer） ──►  ┌──────────────┐     │
  ───────────►  │   直连 db.<ref>.supabase.co:5432  ──►  │  PostgreSQL   │     │
  数据库连接串     │                                        │  public schema│     │
                │                                        │  auth schema  │     │
                │                                        │  storage schema│    │
                │                                        └──────────────┘     │
                │   S3 兼容对象存储（文件本体） ◄── Storage API                  │
                └──────────────────────────────────────────────────────────┘
```

把这张图记住，后面所有章节都在解释其中某一段：

1. **Data API（PostgREST）** 把 Postgres 的表、视图、函数直接变成 REST 接口。`supabase.from('tasks').select()` 最终会变成一条 SQL，在数据库里以某个**数据库角色**执行。
2. **Auth** 管理用户，签发 JWT。用户信息存在同一台 Postgres 的 `auth` schema 里。JWT 里的用户 id，在数据库里可以通过 `auth.uid()` 读到。
3. **Storage** 把文件本体放在对象存储里，但**文件的元数据（哪个桶、路径、所有者）存在 Postgres 的 `storage` schema**，访问控制也是在这些表上写 RLS 策略。
4. **你的服务器** 可以绕开 Data API，像连接任何 Postgres 一样直接连接（或者经过连接池）。
5. 所有道路的终点都是同一台 Postgres。这就是为什么本教程花大量篇幅讲 Postgres 本身：**Supabase 的安全、性能、可靠性，最终都是 Postgres 的安全、性能和可靠性。**

## 1.3 三条访问路径，三种权限模型（先有印象）

第 8、9、10 章会展开，这里先建立直觉：

| 路径                                              | 谁在用               | 数据库里的身份                                  | 谁来保证“只能看自己的数据”               |
| ------------------------------------------------- | -------------------- | ----------------------------------------------- | ---------------------------------------- |
| 浏览器 → Data API（publishable key + 用户登录态） | 前端                 | `anon`（未登录）或 `authenticated`（已登录）    | **数据库里的 grant + RLS 策略**          |
| 服务器 → Data API（secret key）                   | 你的后端、定时任务   | `service_role`，**绕过 RLS**                    | **你的服务端代码**                       |
| 服务器 → Postgres 连接串                          | 你的后端、迁移、备份 | 连接串里的用户（通常是 `postgres`，表的所有者） | **你的服务端代码**（RLS 默认对它不生效） |

只要记住一条：**前端拿到的任何东西都等于公开**。publishable key 会被打包进浏览器代码，所以真正的防线只能在数据库里——这就是 RLS 存在的意义。

## 1.4 常见误解与真实情况

| 误解                              | 真实情况                                                                               | 在哪一章解决 |
| --------------------------------- | -------------------------------------------------------------------------------------- | ------------ |
| “在 Dashboard 里点出表结构就行了” | 控制台改动无法复现、无法审阅、无法回滚；正式流程是迁移文件 + CLI                       | 3、12        |
| “Supabase 帮我管权限”             | 权限 = Postgres 角色 + GRANT + RLS 策略，需要你写进迁移                                | 8、9         |
| “anon key 是密钥，要藏好”         | publishable/anon key 本来就是公开的；真正要藏的是 secret/service_role key 和数据库密码 | 8            |
| “开了 RLS 就安全了”               | 开了 RLS 但策略写错、视图绕过、grant 过宽、服务端用了 secret key，都会泄露             | 9            |
| “连接串复制过来就能用”            | 直连、会话池、事务池适用不同运行环境，行为也不同                                       | 10           |
| “文件放进 Storage 就是私有的”     | 公开桶的文件任何人拿到 URL 都能下载                                                    | 11           |
| “平台会自动备份，我不用管”        | 免费项目没有自动备份；数据库备份不包含 Storage 文件；恢复要演练                        | 13           |

## 1.5 云端主线：先连接你的托管数据库

### 第一步：区分“已有业务项目”和“教学项目”

已经有云数据库，不代表它适合做所有实验。已有项目可能已经有 `profiles`、触发器、RLS 和应用数据，直接执行后续建表脚本会冲突，甚至改变正在使用的权限。先只读检查；从第 2 章开始的建表、插种子、禁用触发器、死锁、清理与造数，只在独立且可丢弃的教学云项目或本地栈中执行。

如果暂时只有一个业务项目，可以先在它上面完成下面的只读步骤，并继续阅读原理；不要为了跟做去清空它。

### 第二步：找对两种地址和凭据

在目标项目 Dashboard 顶部的 **Connect** 面板复制地址：

| 用途                                 | 地址与凭据                                            | 放在哪里                                   |
| ------------------------------------ | ----------------------------------------------------- | ------------------------------------------ |
| 浏览器调用 Auth / Data API / Storage | `https://<project-ref>.supabase.co` + publishable key | 前端可以使用，访问范围由 GRANT 和 RLS 决定 |
| Node.js 服务端、ORM、psql 访问 SQL   | PostgreSQL 连接串 + 数据库密码                        | 只在服务器或受控的管理工具中使用           |

**API key 不是数据库密码。** `createClient()` 接受的是 HTTPS 项目 URL 与 API key，不接受 `postgresql://...`；`pg.Pool` 则需要 PostgreSQL 连接串，不接受 API key。

长驻服务、psql 或 ORM 可以选 Direct connection（常用端口 5432）。Direct 默认使用 IPv6，网络只有 IPv4 时选择 **Session pooler** 并复制整条新连接串，主机和用户名都可能不同。不要只改端口来猜端点。Serverless 的事务池选择见第 10 章。

数据库版本由云项目决定，执行 `show server_version;` 查看。`config.toml` 的 `[db] major_version` 只控制可选的本地数据库，改它不会升级云数据库。

### 第三步：在 Dashboard 做通用只读检查

不必安装任何客户端，也不必安装 CLI，先在目标项目的 SQL Editor 执行：

```sql
begin transaction read only;
set local statement_timeout = '5s';

select current_database(), current_user, version();

-- 只查表的名称，不读取业务行
select table_schema, table_name
  from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE'
 order by table_name;

-- 观察业务表是否启用 RLS
select c.relname as table_name, c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')
 order by c.relname;

rollback;
```

预期：第一条查询返回当前角色与版本，后面两条返回表名与 RLS 状态；新项目可以没有业务表。不要按教程假定你的数据库一定是 Postgres 17。`READ ONLY` 防止这个事务写入普通表，`rollback` 结束事务；它不隐藏查询结果，仍不要把用户数据或凭据输出到日志里。

**SQL Editor 使用管理身份。** 在这里查到数据，不代表浏览器也能查到；这里验证的是数据库与结构，用户权限还要在第 8、9 章用 publishable key + 用户会话验证。

### 第四步：从电脑连接云端（可选 psql）

安装 `psql` 是安装客户端，不是安装数据库服务器，也不需要 Docker。macOS 可以安装 `libpq` 或使用已有的数据库 GUI。

把 Connect 面板中的主机、用户名、端口填入下面的连接参数，**不把真实密码写进命令**，`-W` 会提示输入：

```bash
psql -W "host=db.<project-ref>.supabase.co port=5432 user=postgres dbname=postgres sslmode=require"
```

Session pooler 则使用面板给出的 pooler 主机及 `postgres.<project-ref>` 用户名。`sslmode=require` 要求加密，但不保证服务器身份校验；在受控或生产连接中，从 Database Settings 下载根证书并配置 `sslmode=verify-full sslrootcert=/你的证书路径`。详见第 10 章。

连接成功后执行第三步的同一组只读 SQL。psql 的 `\d`、`\dn` 等命令也能检查云数据库；它们不是 SQL Editor 支持的 SQL。

### 第五步：让 Node.js 服务端使用云数据库

已有后端项目只需安装驱动，不必先安装整个 example：

```bash
npm install --save-exact pg@8.23.1
```

在服务端项目的 `.env` 中保存 `DATABASE_URL`（从 Connect 复制，密码中的保留字符要 URL 编码）以及 `DB_CA_PATH`（可信根证书的本地路径）。先把 `.env` 加入 `.gitignore`。`DB_CA_PATH` 是下面示例自行约定的变量，Supabase 不会自动生成它。连接串不要同时放入与程序化 `ssl` 配置冲突的 `sslmode` 等参数。

创建 `check-cloud.mjs`：

```js
import pg from "pg";
import { readFileSync } from "node:fs";

if (!process.env.DATABASE_URL || !process.env.DB_CA_PATH) {
  throw new Error("请配置 DATABASE_URL 与 DB_CA_PATH，不要输出连接串");
}
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 5000,
  ssl: {
    rejectUnauthorized: true,
    ca: readFileSync(process.env.DB_CA_PATH, "utf8"),
  },
});
try {
  const { rows } = await pool.query(
    "select current_database() as database, current_user as role, current_setting('server_version') as version",
  );
  console.log(rows); // 仅输出库名、角色和版本，不读取业务数据
} finally {
  await pool.end();
}
```

```bash
node --env-file=.env check-cloud.mjs
```

不要打印 `DATABASE_URL`，不要将它命名为 `VITE_DATABASE_URL` 或 `NEXT_PUBLIC_DATABASE_URL`。数据库密码、secret key 和带 token 的 URL 都不应出现在教程、Git、日志或聊天里；若已经暴露，应先轮换再使用。

### 可选：准备本地 Supabase 栈

| 工具                                  | 用途                                               | 说明                                                                                                    |
| ------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Node.js 20 或更高                     | 运行 Supabase CLI（npm 方式安装时）和示例脚本      | 官方说明：通过 npm/npx 运行 CLI 需要 Node.js 20+。示例脚本用到 `node --env-file`，需要 20.6+            |
| Docker 兼容的容器运行时（仅本地路线） | 本地 Supabase 栈的每个服务都跑在容器里             | macOS 上官方推荐 OrbStack；也可以用 Docker Desktop、Rancher Desktop、Podman、colima。给它至少 7 GB 内存 |
| psql（可选，但强烈推荐）              | 命令行 SQL 客户端，第 7 章的并发实验需要开两个会话 | macOS：`brew install libpq`，按提示把 `psql` 加入 PATH；或使用 Postgres.app 自带的 psql                 |
| 一个代码编辑器                        | 编辑 SQL 迁移和脚本                                | VS Code 等均可                                                                                          |

> 本教程不需要 Python。所有脚本都是 Node.js。

检查：

```bash
node -v          # v20.6 或更高
docker info      # 仅本地路线需要；云端连接可跳过
psql --version   # 可选
```

### 关于版本

本教程编写时核对的版本：

- Supabase CLI：`2.121.0`（npm 包名 `supabase`）
- `@supabase/supabase-js`：`2.118.0`
- 示例本地栈的 Postgres 大版本：17；云端版本先用 `show server_version;` 查询，再让可选的本地栈与它对齐。

CLI 发版很频繁，`supabase init` 生成的文件内容会随版本变化。**把 CLI 作为项目的 devDependency 并锁定版本**，可以保证团队里每个人、以及 CI 用的是同一个版本——这也是官方推荐的做法。

## 1.6 可选本地路线：创建项目目录并初始化

如果已经按 1.5 节连接云数据库，可以直接继续第 2 章；以下完整保留本地实践，用于隔离实验。云端迁移只需要初始化 CLI 文件，不必执行 1.7 的 `supabase start`。

```bash
mkdir teamboard && cd teamboard
npm init -y
npm install --save-dev supabase@2.121.0
npx supabase --version
```

> 以后所有 `supabase <命令>` 在本教程中都可以写成 `npx supabase <命令>`。如果你用 Homebrew 全局安装了 CLI（`brew install supabase/tap/supabase`），直接写 `supabase` 即可。官方文档统一写作 `supabase <command>`。

初始化：

```bash
npx supabase init
```

它只在本地创建文件，**不会登录、也不会连接任何云端项目**。完成后目录是这样的：

```text
teamboard/
├── package.json
└── supabase/
    ├── config.toml        # 本地栈配置（端口、Auth、Storage、种子数据……）
    └── ...                # 不同 CLI 版本可能还会生成其他文件
```

随着教程推进，`supabase/` 下会出现：

| 路径                   | 作用                                | 是否提交到 Git                          |
| ---------------------- | ----------------------------------- | --------------------------------------- |
| `config.toml`          | 本地栈配置                          | 是（默认不含秘密；秘密用 `env()` 引用） |
| `migrations/`          | 带时间戳的 SQL 迁移文件，按顺序执行 | 是                                      |
| `seed.sql`             | 本地/测试数据，在迁移之后执行       | 是（只含虚构数据）                      |
| `tests/`               | pgTAP 数据库测试                    | 是                                      |
| `.temp/`、`.branches/` | CLI 内部状态                        | 否                                      |

## 1.7 启动本地 Supabase 栈

先确认容器运行时已经启动，然后：

```bash
npx supabase start
```

第一次运行会下载整套镜像，需要几分钟。完成后会打印类似这样的信息（不同版本格式略有差异）：

```text
Started supabase local development setup.

╭──────────────────────────────────────╮
│ 🔧 Development Tools                 │
├─────────┬────────────────────────────┤
│ Studio  │ http://127.0.0.1:54323     │
│ Mailpit │ http://127.0.0.1:54324     │
│ MCP     │ http://127.0.0.1:54321/mcp │
╰─────────┴────────────────────────────╯
╭──────────────────────────────────────────────────────╮
│ 🌐 APIs                                              │
├────────────────┬─────────────────────────────────────┤
│ Project URL    │ http://127.0.0.1:54321              │
│ REST           │ http://127.0.0.1:54321/rest/v1      │
│ GraphQL        │ http://127.0.0.1:54321/graphql/v1   │
│ Edge Functions │ http://127.0.0.1:54321/functions/v1 │
╰────────────────┴─────────────────────────────────────╯
╭───────────────────────────────────────────────────────────────╮
│ ⛁ Database                                                    │
├─────┬─────────────────────────────────────────────────────────┤
│ URL │ postgresql://postgres:postgres@127.0.0.1:54322/postgres │
╰─────┴─────────────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────────────────╮
│ 🔑 Authentication Keys                                       │
├─────────────┬────────────────────────────────────────────────┤
│ Publishable │ sb_publishable_...                             │
│ Secret      │ sb_secret_...                                  │
╰─────────────┴────────────────────────────────────────────────╯
```

逐项理解：

| 输出                  | 对应图中的哪一块                                            | 你什么时候会用                                 |
| --------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| Project URL `:54321`  | API 网关，前面挂着 REST、Auth、Storage、Realtime、Functions | 前端和脚本里的 `SUPABASE_URL`                  |
| Database URL `:54322` | Postgres 本体，用户名/密码都是 `postgres`                   | psql、迁移、服务端直连                         |
| Studio `:54323`       | 本地版控制台                                                | 浏览表、跑 SQL、看策略                         |
| Mailpit `:54324`      | 本地邮件收件箱                                              | 注册确认、魔法链接邮件都在这里，不会真的发出去 |
| Publishable / Secret  | 本地栈自己生成的两把钥匙                                    | 第 8 章                                        |

两个非常重要的事实：

1. **本地 key 与云端项目的 key 毫无关系**。本地 key 永远打不开线上数据。
2. **本地栈只用于开发**。官方明确说明它没有 TLS、没有限流、使用默认凭据，绝不能暴露给外部流量。

随时可以用 `npx supabase status` 再次查看这些信息。

## 1.8 第一次连接数据库：psql 与 Studio

### 用 psql

```bash
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
```

进入后试试：

```sql
select version();
show server_version;
select current_user, current_database(), now();
```

`\dn` 列出所有 schema（schema 可以理解为数据库里的“命名空间/文件夹”）：

```text
postgres=> \dn
```

你会看到一长串，其中最需要认识的是：

| schema                                   | 属于谁           | 你可以做什么                                                                           |
| ---------------------------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| `public`                                 | 你的应用         | 建你的业务表、视图、函数                                                               |
| `auth`                                   | Supabase Auth    | 读取 `auth.users`、在上面建外键和触发器；**不要修改它的结构**                          |
| `storage`                                | Supabase Storage | 在 `storage.objects` 上写 RLS 策略、加索引；**把表当只读，文件操作一律走 Storage API** |
| `extensions`                             | 扩展函数         | 启用的扩展大多安装在这里                                                               |
| `supabase_migrations`                    | CLI              | 记录哪些迁移已执行；不要手工改                                                         |
| `graphql_public`、`realtime`、`vault` 等 | 各自的服务       | 按对应文档使用                                                                         |

再看看 Auth 的用户表长什么样（现在是空的）：

```sql
\d auth.users
select count(*) from auth.users;
```

这说明了 1.2 节的观点：**用户就是一张 Postgres 表里的行**，后面我们会让业务表通过外键引用它。

常用 psql 命令速查：

| 命令                   | 作用                         |
| ---------------------- | ---------------------------- |
| `\dt public.*`         | 列出 public 下的表           |
| `\d 表名` / `\d+ 表名` | 查看表结构、约束、索引、策略 |
| `\df private.*`        | 列出函数                     |
| `\x`                   | 切换竖排显示，宽表更好读     |
| `\timing`              | 显示每条语句耗时             |
| `\q`                   | 退出                         |

### 用 Studio

浏览器打开 `http://127.0.0.1:54323`，进入 SQL Editor，执行同样的 `select version();`。

Studio 在本地适合用来观察和试验。但请从现在开始养成习惯：**Studio 里做的结构修改，最终都要变成迁移文件**（第 3 章会讲 `db diff` 如何把它们捕获下来）。

## 1.9 本地栈的生命周期命令

| 命令                            | 做什么                                             | 数据会怎样                                                              |
| ------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| `npx supabase start`            | 启动所有容器；首次启动会执行迁移和种子数据         | —                                                                       |
| `npx supabase stop`             | 停止容器                                           | **保留**，下次 start 还在                                               |
| `npx supabase status`           | 查看地址和 key                                     | —                                                                       |
| `npx supabase db reset`         | 删掉本地数据库，按顺序重放全部迁移，再执行种子数据 | **本地数据全部重建**                                                    |
| `npx supabase stop --no-backup` | 停止并删除数据卷                                   | **本地数据彻底删除**（升级 CLI 前官方建议这样做，但要先保存需要的改动） |

`db reset` 是**本地路线**最常用的命令，不是云数据库的连接或更新步骤。它的价值在于：**只要 reset 能成功，就证明“从零开始，仅凭仓库里的文件，就能重建出完全一致的数据库”。** 这是多人协作和多环境部署的基础。

## 1.10 常见问题

| 现象                                  | 原因与处理                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `Cannot connect to the Docker daemon` | 容器运行时没有启动                                                                    |
| 容器健康检查失败                      | 给 Docker 分配的内存太少（官方建议至少 7 GB）；先 `supabase stop` 再 `supabase start` |
| `port is already allocated`           | 另一个本地 Supabase 项目正在占用默认端口：去那个目录执行 `supabase stop`              |
| `npx supabase` 无法运行               | Node.js 版本低于 20                                                                   |
| psql 提示 `connection refused`        | 栈没启动，或端口不是 54322（看 `supabase status`）                                    |

## 1.11 本章练习

云端主线：完成 1.5 节的只读查询，说明为什么 `current_user = postgres` 时查询成功不能证明 RLS 正确。下面第 2、3 题只适用于可选的本地栈，不在已有业务云项目上重现。

1. 用 `\d auth.users` 找出用户邮箱存在哪一列，主键是什么类型。
2. 执行 `npx supabase stop`，再 `npx supabase start`，确认刚才 psql 里能看到的东西都还在。
3. 在 Studio 的 Table Editor 里随手建一张表 `scratch`，然后用 psql 的 `\dt public.*` 找到它；再执行 `npx supabase db reset`，看它是否还在。
4. 用自己的话回答：为什么说“publishable key 被别人看到没关系，但 RLS 写错了有关系”？

### 参考答案

1. `email` 列；主键 `id` 是 `uuid`。
2. `stop` 只停止容器，数据卷保留，所以都还在。
3. 不在了。`db reset` 只依据 `supabase/migrations/` 和种子数据重建数据库，而 `scratch` 不在任何迁移里——这正是“控制台改动无法复现”的直观演示。
4. publishable key 只表明“这是哪个应用在调用”，本来就会出现在前端代码里；真正决定能看到哪些行的是数据库里的 grant 和 RLS 策略。策略写错，任何拿到公开 key 的人都能越权。

## 本章验收

- [ ] 能用一句话说明 Supabase 由哪三部分组成，并指出它们都建立在同一台 Postgres 上。
- [ ] 能说出 Data API、Auth、Storage 各自把数据存在哪个 schema。
- [ ] 能说出浏览器、服务器（secret key）、服务器（连接串）三条路径在数据库中分别是什么身份。
- [ ] 云端主线：能用 SQL Editor 或 psql 查到云数据库的角色、版本与表名，分清 HTTPS 项目 URL、API key、数据库连接串和密码。
- [ ] 可选本地路线：本地栈已运行，能连接并理解 `stop`、`db reset`、`stop --no-backup` 对本地数据的影响。

## 官方阅读

- [Architecture](https://supabase.com/docs/guides/getting-started/architecture)
- [Supabase CLI：安装与运行本地栈](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows)
- [PostgreSQL 文档首页](https://www.postgresql.org/docs/current/index.html)
