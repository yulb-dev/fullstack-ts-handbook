# 第 10 章：连接方式与连接池——Data API、直连、会话池、事务池，按运行环境选择

[上一章](./09-row-level-security.md) · [目录](./README.md) · [下一章](./11-storage.md)

使用 Supabase 托管云数据库时，连接串来自 Dashboard 的 **Connect** 面板；你的应用可以在自己电脑上运行、数据库仍然在云端，**无需先启动本地 Supabase 栈**。可选本地栈才使用 `127.0.0.1:54322` 与默认密码 `postgres`，这些不是云端的连接配置。

Connect 面板里有好几种连接方式，它们的主机、端口、用户名都不同，行为也不同。选错了，常见的后果是：

- Serverless 函数一上量就报 `too many connections`；
- 服务器所在网络只支持 IPv4，直连地址根本连不上；
- 换成事务池之后，ORM 偶尔报 `prepared statement "s1" already exists`；
- 在连接上 `SET` 了一个参数，下一个请求莫名其妙继承了它（或者没继承到）。

本章先解释“为什么连接是稀缺资源”，再逐一讲清每种连接方式，最后按运行环境给出选择。

## 10.1 为什么数据库连接是稀缺资源

Postgres 为每个客户端连接启动一个独立的后端进程，每个进程都占用内存。数据库能同时承载的连接数由 `max_connections` 决定，而在 Supabase 上它取决于你的计算规格（compute size）——**小规格实例的连接数上限可能只有几十到几百**。

应用侧还有一个常被忽略的乘法：

```text
潜在连接数 = 应用实例数 × 每个实例的连接池上限
```

一台长期运行的服务器、连接池上限 10，没问题。但 Serverless 平台会根据流量启动几十、上百个“热实例”，**实例数量不由你控制**；如果每个实例的连接池默认 10 个连接（Postgres.js 的默认值），几十个实例就足以耗尽数据库的连接。

所以需要两层“池”：

| 层                     | 是什么                                                    | 解决什么                                       |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------------- |
| 应用侧连接池           | 你代码里的 `new pg.Pool({ max })`、ORM 的连接池           | 一个进程内复用连接，避免每次请求都新建         |
| 服务端连接池（pooler） | Supabase 运行的 Supavisor（共享池）或 PgBouncer（专用池） | 把**大量客户端连接**复用到**少量数据库连接**上 |

## 10.2 五种连接方式

官方连接文档列出的方式（主机名、端口以你项目 Connect 面板为准）：

| 方式                               | 地址形式                                   | 端口 | IP 协议                             | 说明                                                |
| ---------------------------------- | ------------------------------------------ | ---- | ----------------------------------- | --------------------------------------------------- |
| **Data API**                       | `https://<ref>.supabase.co`                | 443  | —                                   | HTTP，不需要数据库连接串；必须配合 RLS              |
| **直连（Direct）**                 | `db.<ref>.supabase.co`                     | 5432 | IPv6（购买 IPv4 附加组件后为 IPv4） | 不经过任何池，完整的 Postgres 会话                  |
| **共享池·会话模式（Session）**     | `aws-<index>-<region>.pooler.supabase.com` | 5432 | 仅 IPv4                             | 经过 Supavisor，客户端连接期间独占一个数据库连接    |
| **共享池·事务模式（Transaction）** | 同上                                       | 6543 | 仅 IPv4                             | 经过 Supavisor，每个事务结束就把数据库连接还回池里  |
| **专用池（Dedicated，付费计划）**  | `db.<ref>.supabase.co`                     | 6543 | IPv6（或 IPv4 附加组件）            | PgBouncer，与数据库同机，延迟更低；**只有事务模式** |

几个容易出错的细节（全部来自官方文档）：

1. **用户名不同**：直连和专用池用 `postgres`；共享池用 `postgres.<project-ref>`（自定义角色则是 `角色名.<project-ref>`）。
2. **共享池主机名里的 `<index>` 是池集群编号，不是地区名的一部分**，同一地区可能有多个，所以**不能根据地区自己拼主机名**，一律从 Connect 面板复制。
3. **端口决定模式**：5432 → 直连或会话模式；6543 → 事务模式（共享或专用）。不要以为“把 5432 改成 6543”就能从直连切换到事务池——主机名和用户名也不同。
4. **密码中的特殊字符**（`&`、`#`、`?`、空格等）要做百分号编码。
5. **IPv4 附加组件不是双栈**：开启后项目的直连地址从 IPv6 换成 IPv4，只能通过 IPv4 访问。

示意（真实值请从 Connect 面板复制）：

```text
直连：     postgresql://postgres:[密码]@db.[REF].supabase.co:5432/postgres
会话模式： postgresql://postgres.[REF]:[密码]@aws-0-[REGION].pooler.supabase.com:5432/postgres
事务模式： postgresql://postgres.[REF]:[密码]@aws-0-[REGION].pooler.supabase.com:6543/postgres
```

## 10.3 会话模式与事务模式的本质区别

**会话模式**：你的客户端连接存在多久，它就占着同一个数据库连接多久。行为与直连完全相同，只是多了一层转发（以及 IPv4 可达性）。

**事务模式**：一个事务结束，数据库连接立刻还回池里，你的下一个事务**可能在另一个数据库连接上执行**。这让少量数据库连接可以服务大量短暂的客户端，非常适合 Serverless，但也意味着**一切依赖“会话状态”的东西都不能跨事务使用**。官方列出了四类：

| 受影响的功能                                                         | 表现                                                                                   | 处理                                                           |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **预编译语句（prepared statements）**                                | 在 A 连接上准备的语句，下次请求落到 B 连接上就不存在了；或者名字冲突                   | 在驱动中关闭（见下表）                                         |
| **会话级状态**：`SET`/`RESET`、会话级咨询锁、`LISTEN/NOTIFY`、临时表 | 下一个事务看不到，或者“泄漏”给别的客户端                                               | 只在事务内使用（`SET LOCAL`），或改用会话模式/直连             |
| **游标**                                                             | 只能在单个事务内使用；`WITH HOLD` 游标不能跨事务                                       | 同上                                                           |
| **查询流水线（pipelining）**                                         | 池在看到一个事务的回复结束时就收回连接，客户端已排队的后续查询可能挂起或拿到错乱的结果 | 关闭流水线；Postgres.js 默认开启，官方专门提示了这个组合的风险 |

**注意：事务模式并不是“不支持事务”**。恰恰相反，在一个事务内部，你会一直使用同一个数据库连接——`begin ... commit` 之间的所有语句、`set local`、事务内的游标都正常工作。第 8 章“在事务里扮演用户”（`set local role` + `set_config(..., true)`）之所以安全，正是因为它们只活在当前事务里。

关闭预编译语句的方法（官方表格）：

| 驱动                                     | 设置                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| Postgres.js、Drizzle（使用 postgres-js） | `prepare: false`                                                              |
| Prisma                                   | 连接串加 `pgbouncer=true`                                                     |
| asyncpg                                  | `statement_cache_size=0`                                                      |
| JDBC                                     | `prepareThreshold=0`                                                          |
| node-postgres（`pg`）                    | 默认的 `pool.query(sql, params)` 不使用命名预编译语句；**不要**传 `name` 选项 |

**参数化查询 ≠ 预编译语句**。关闭预编译语句之后，`pool.query('... where id = $1', [id])` 依然把 SQL 与参数分开发送，依然防 SQL 注入。不要因为“关了 prepare”就开始拼接字符串。

## 10.4 按运行环境选择

官方的选择表：

| 代码运行在哪里                                          | 使用                | 原因                                                 |
| ------------------------------------------------------- | ------------------- | ---------------------------------------------------- |
| 前端应用（浏览器、移动端）                              | **Data API**        | 不需要 Postgres 客户端，不持有数据库密码；必须有 RLS |
| Serverless / Edge 函数                                  | **共享池·事务模式** | 这些环境会打开大量短暂的连接                         |
| 长期运行的后端，网络支持 IPv6（或购买了 IPv4 附加组件） | **直连**            | 中间没有池                                           |
| 长期运行的后端，网络只有 IPv4                           | **共享池·会话模式** | 共享池在所有计划中都是 IPv4                          |
| 第三方工具（BI、数据库 GUI）                            | **共享池·会话模式** | 可以从你不控制的网络通过 IPv4 访问，并支持预编译语句 |
| 付费计划上的高性能应用                                  | **专用池**          | 与数据库同机，延迟比共享池低                         |
| 迁移、`pg_dump`、备份恢复、复制                         | **直连**            | 单一会话、Postgres 原生命令                          |

再补充 CLI 相关的两条（来自本地开发工作流文档）：

- `db pull` / `db diff` 使用 `--db-url` 时，优先用直连，让差异引擎读取完整的系统目录；只有 IPv4 网络时用会话模式；**不要用事务模式**。
- `db dump` 和 `psql`：会话模式是安全的默认选择。

连接方式与工具依赖是两个维度。`psql`、`pg` 或 ORM 直接连接云库不需要 Docker；但本文 CLI 的 `db pull` / `db diff` 构建影子数据库，`db dump` 通过容器运行 pg_dump，因此不能仅因目标是远端就断言不需要容器。无容器备份方案见第 13 章。

如果你已经拿到 Direct connection，按第 1 章的只读步骤测试角色与版本即可；只用数据库驱动的后端不用额外配置 publishable/secret key。不要用依赖固定 Bob 用户的 `demo:pg` 当作现有业务库的通用测试。

把 Teamboard 的组件对号入座：

| 组件                                                                    | 连接方式                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| 浏览器端看板                                                            | Data API + publishable key                                    |
| 部署在 Vercel 的 API 路由（服务端组件、route handler）                  | 代表用户访问 → Data API 转发用户会话；需要直连 SQL → 事务模式 |
| 夜间清理任务（`storage-cleanup.mjs`，运行在一台长期运行的 IPv4 机器上） | 会话模式（或直连 + IPv4 附加组件）                            |
| CI 中执行 `supabase db push`                                            | CLI 通过 `link` 获取连接信息                                  |
| 备份脚本 `supabase db dump`                                             | 会话模式或直连                                                |

## 10.5 正确配置客户端

官方针对 Serverless 函数给出的四条：

1. **在模块顶层创建一次客户端**，不要每个请求创建；
2. **连接池上限设为 1**。这个客户端被该热实例上的所有调用共享，所以它限制的是“每个实例”，不是“每个请求”。只有当你有证据表明同一实例上的并发调用在排队等待连接时，才调高；
3. **关闭预编译语句**（事务模式不支持）；
4. **SSL 设为 `require`**，拒绝明文连接。

Postgres.js 的官方示例：

```ts
import postgres from "postgres";

export const sql = postgres(process.env.DATABASE_URL!, {
  max: 1,
  prepare: false,
  ssl: "require",
});
```

node-postgres（本教程示例使用的驱动）的等价写法：

```ts
import pg from "pg";

// 模块顶层：每个进程/热实例只创建一次
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1, // Serverless：每个热实例 1 个连接
  connectionTimeoutMillis: 5_000, // 等待连接的上限
  idleTimeoutMillis: 30_000,
  ssl: { rejectUnauthorized: true, ca: process.env.SUPABASE_DB_CA }, // 见 10.6
});

pool.on("error", (err) => console.error("idle client error", err));

export async function getTask(id: number) {
  const { rows } = await pool.query(
    "select id, title from public.tasks where id = $1",
    [id],
  );
  return rows[0];
}
```

长期运行的服务器上，`max` 可以大一些，但要做预算：

```text
所有实例的 max 之和 + 迁移/运维/其他服务预留 ≤ 数据库可用连接数
```

例如数据库允许 60 个连接，预留 10 个给迁移、Dashboard 和定时任务，剩下 50 个；如果后端部署 5 个实例，每个实例的 `max` 不应超过 10。还要注意：**池满了不一定是 `max` 太小**——更常见的原因是连接泄漏（`pool.connect()` 之后没有 `release()`），或者事务里做了慢操作（调用外部 API）一直占着连接。

## 10.6 SSL：加密与验证身份是两回事

官方说明：大多数驱动默认是 `prefer`——加密失败时**退回明文**。要设为 `require`（连接串上是 `sslmode=require`），驱动才会拒绝明文连接。

但 `require` **只加密、不验证服务器身份**，挡不住中间人攻击。要同时验证：

1. 在 Dashboard 的 Database Settings 下载服务器根证书；
2. **告诉驱动使用它**：连接串上用 `sslmode=verify-full&sslrootcert=证书路径`，或在驱动选项里传入 CA（如上例 node-postgres 的 `ssl.ca`）。只下载证书什么也不会改变。

同一页面还有一个开关可以拒绝所有非 SSL 连接。

避免把连接串里的 `sslmode` 参数与代码里的 `ssl` 选项同时设置成互相矛盾的值；也不要把 `rejectUnauthorized: false` 当成通用的“修复证书错误”的办法——它关掉的正是身份验证。

## 10.7 Serverless 的额外问题

- **冻结与陈旧连接**：Serverless 平台会在两次请求之间冻结函数，池里的 TCP 连接可能已经失效。官方的排障文档专门讨论了 `CONNECT_TIMEOUT` 和查询挂起的问题；设置合理的超时、处理连接错误。
- **超时要分层**：`connectionTimeoutMillis`（等连接）、数据库的 `statement_timeout`（单条语句）、HTTP 请求的总时限。用 `Promise.race` 在应用层“超时返回”并不会取消数据库里正在执行的查询。
- **Edge 运行时**：是否支持 TCP、TLS 与 Node API 取决于平台。官方有专门的 Serverless drivers 文档；最简单的方式通常是走 Data API。

Supabase 也为各角色设置了默认的语句超时（官方 Timeouts 文档）：`anon` 3 秒、`authenticated` 8 秒；`service_role` 未单独设置时沿用 `authenticator` 的 8 秒；`postgres` 受全局上限 2 分钟约束。Dashboard 与客户端（Data API）查询最多可配置到 60 秒，更长的任务应该走会话池或直连。注意：会话级的 `set statement_timeout = ...` 只对会话模式和直连有效，在事务模式（端口 6543）下不起作用——正是 10.3 节讲的“会话状态”问题。

## 10.8 观察连接

```sql
-- 按用户、应用、状态统计当前连接
select usename, application_name, state, count(*)
  from pg_stat_activity
 where datname = current_database()
 group by 1, 2, 3
 order by 4 desc;
```

重点关注 `state = 'idle in transaction'`：**开了事务却什么都不做**的连接。它占着连接、可能持有锁、还阻止 VACUUM 清理旧数据版本。它几乎总是应用代码的 bug（忘了 commit/rollback、出错时没释放连接）。

在服务端代码里给连接设置 `application_name`（连接串加 `?application_name=teamboard-api`），出问题时可以一眼看出是哪个服务。

CLI 也有对应的检查命令：

```bash
npx supabase inspect db locks
npx supabase inspect db blocking
```

## 10.9 可选本地实验：事务模式丢失会话状态

云端用户可以继续使用 Connect 提供的 Direct/Session/Transaction 端点，不必为“使用连接池”安装本地运行时。以下 config.toml 只启用本地的实验池，不会改变云端项目的 pooler；会话状态实验只在教学云项目或本地栈执行。

本地栈默认不启用连接池。在 `config.toml` 里打开它：

```toml
[db.pooler]
enabled = true
port = 54329
pool_mode = "transaction"
```

`npx supabase stop && npx supabase start` 之后，用 `npx supabase status` 确认池的连接串（本地池的实现与用户名格式可能与云端不同，以 status 输出为准）。分别用直连与池连接执行：

```sql
set application_name = 'session-state-test';   -- 单独一条语句 = 单独一个事务
show application_name;                          -- 下一个事务：经过事务池时可能落在另一个后端连接上，看不到上面的设置
select pg_backend_pid();                        -- 多执行几次：经过事务池时，后端进程 id 可能变化
```

直连时，`pg_backend_pid()` 始终不变，`SET` 一直有效；经过事务池时，每条自动提交的语句都是一个独立事务，可能落在不同的后端连接上。这就是“会话级状态不能跨事务使用”的直观表现。实验后把 `enabled` 改回 `false`。

> 本地池用于理解概念；**云端共享池（Supavisor）的具体行为以官方文档和你在预发环境的实测为准**，尤其是驱动与事务模式的兼容性，部署前一定要在预发环境验证。

## 10.10 每个环境一套连接凭据

- 本地、预发、生产是**不同的项目**，各有自己的数据库密码、连接串和 API key（第 12 章）。
- 数据库密码只存在于部署平台的密钥管理和 CI 密钥中，不进仓库、不进前端、不进日志。
- 连接串里含有密码，所以 **`DATABASE_URL` 本身就是秘密**。
- 迁移使用的身份（拥有 DDL 权限）与业务运行使用的身份最好分开（第 8 章）。

## 10.11 本章练习

1. 你的 Next.js 应用部署在 Vercel，API 路由需要执行一条复杂的统计 SQL。选择连接方式，写出 node-postgres 的配置，并说明每个选项的理由。
2. 一台只支持 IPv4 的公司内网服务器需要每晚运行 `supabase db dump` 做备份。应该用哪个连接串？
3. 同事在事务模式下写了：`await pool.query("set timezone = 'Asia/Shanghai'")`，然后执行查询。会发生什么？怎样改？
4. 数据库允许 90 个连接。你有 3 个长期运行的后端实例（各 `max: 20`），一个每 5 分钟运行一次的任务（`max: 5`），以及 Dashboard 与迁移的预留 10 个。预算是否合理？
5. 为什么前端永远不应该拿到 `DATABASE_URL`，即使数据库开启了 RLS？

### 参考答案

1. 共享池事务模式（端口 6543，从 Connect 面板复制）；模块顶层 `new pg.Pool({ max: 1, connectionTimeoutMillis, ssl })`；不使用命名预编译语句；需要用户身份时在事务内 `set local role` + `set_config(..., true)`，或者把统计做成 `security_invoker` 视图/函数通过 Data API 调用。
2. 共享池会话模式（IPv4、5432 端口、用户名 `postgres.<ref>`）。官方的备份恢复文档同样建议默认使用会话池连接串，网络支持 IPv6 时再用直连。
3. `SET` 是会话级状态。事务模式下这条语句是一个独立事务，结束后连接回到池里；下一条查询可能落在另一个连接上（时区仍是默认），也可能落在同一个连接上（于是这个设置“泄漏”给了之后使用该连接的其他客户端）。改为在事务内使用 `set local`，或者直接在 SQL 里写 `at time zone 'Asia/Shanghai'`。
4. 3 × 20 + 5 + 10 = 75 ≤ 90，表面上合理；但要考虑滚动发布时新旧实例同时存在（可能短时间变成 6 个实例 → 135），以及每个实例是否真的需要 20 个连接。更稳妥的做法是降低每实例 `max`，或者让后端也经过连接池。
5. 连接串里的身份（`postgres`）是表的所有者并拥有 `bypassrls`，RLS 对它不生效；任何人拿到它就能读写、删除整个数据库，还能修改策略本身。前端只能使用 Data API + publishable key。

## 本章验收

- [ ] 能解释为什么数据库连接是稀缺资源，以及“实例数 × 池上限”的乘法。
- [ ] 能区分应用侧连接池与服务端 pooler。
- [ ] 能说出直连、会话模式、事务模式、专用池的地址、端口、IP 协议与用户名差异，知道要从 Connect 面板复制而不是自己拼。
- [ ] 能列出事务模式下失效的四类会话状态，知道事务内的 `set local` 仍然有效，知道参数化查询不等于预编译语句。
- [ ] 能根据运行环境（浏览器、Serverless、长期服务器、IPv4 网络、BI 工具、迁移与备份）选择连接方式。
- [ ] 能为 Serverless 正确配置客户端（模块级、`max: 1`、关闭预编译、SSL），能做连接预算。
- [ ] 能区分 `sslmode=require` 与 `verify-full`。
- [ ] 能用 `pg_stat_activity` 发现 `idle in transaction` 等问题。

## 官方阅读

- [Supabase：Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase：Connection pooling and limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits)
- [Supabase：Serverless drivers](https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers)
- [Supabase：Postgres.js 指南（pipelining 风险）](https://supabase.com/docs/guides/database/postgres-js)
- [Supabase：Disabling prepared statements](https://supabase.com/kb/troubleshooting/disabling-prepared-statements-qL8lEL)
- [Supabase：IPv4 address add-on](https://supabase.com/docs/guides/platform/ipv4-address)
- [Supabase：Timeouts](https://supabase.com/docs/guides/database/postgres/timeouts)
- [node-postgres：Pooling](https://node-postgres.com/features/pooling)
- [PostgreSQL：libpq SSL 支持（sslmode）](https://www.postgresql.org/docs/current/libpq-ssl.html)
- [PostgreSQL：pg_stat_activity](https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW)
