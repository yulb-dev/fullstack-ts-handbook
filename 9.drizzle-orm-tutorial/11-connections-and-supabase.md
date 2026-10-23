# 第 11 章：连接池、Supabase 和部署环境的真实限制

[上一章](./10-sql-safety-and-performance.md) · [目录](./README.md) · [下一章](./12-boundaries-and-testing.md)

本地查询成功不代表部署后就能工作。常见生产失败不是 SQL 写错，而是连接数量超限、网络只支持 IPv4、连接池模式不保留会话、prepared statements 不兼容，或 SSL 配置不完整。

本章先解释驱动与连接池，再把 Supabase 的连接方式对应到运行环境。不要只复制一条 DATABASE_URL；主机、端口、用户名、TLS和连接模式一起决定实际行为。

## 11.1 ORM、驱动、应用池与服务端池是不同层

```text
Service
  → Drizzle
  → node-postgres Pool（应用侧连接池）
  → 直接 Postgres / Supavisor / PgBouncer（可能还有服务端池）
  → PostgreSQL 后端连接
```

应用池管理你这个进程持有的连接。服务端 pooler 能把很多短暂客户端连接复用到更少后端连接，但它不能让无限的客户端连接、无限并发SQL和无限内存变成免费。

两种本文相关驱动：

| 驱动          | 安装包     | Drizzle 入口                | 特点                                                  |
| ------------- | ---------- | --------------------------- | ----------------------------------------------------- |
| node-postgres | `pg`       | `drizzle-orm/node-postgres` | 明确的 Pool、默认普通查询不必命名 prepare，本文主线   |
| Postgres.js   | `postgres` | `drizzle-orm/postgres-js`   | 内置连接池、默认自动 prepared，有不同 pipelining 行为 |

它们都可以访问 PostgreSQL，但配置项不同。`prepare: false` 是 Postgres.js 的参数，不是 node-postgres Pool 通用开关。

## 11.2 一个进程复用一个 Pool

本文生产侧实例沿用：

```ts
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { relations } from "./relations";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});
pool.on("error", (error) => console.error("空闲连接错误", error));
export const db = drizzle({ client: pool, relations });
```

在模块级创建，不是在每次 HTTP 请求里创建。创建 Pool 本身并不意味着立即建立 max条连接；连接会根据需求使用和维护。

如果自己 `pool.connect()` 借客户端，必须在 finally release；使用 ORM事务时让它管理事务连接，不要混杂自己借出的另一个客户端。

脚本最终 `pool.end()`。长驻服务在优雅关机时停止接收新请求、等待在途业务后再关池。Serverless 热实例通常保留模块级池，不应每次调用末尾把共享池关闭，否则下一次复用的是已经结束的对象。

## 11.3 max 不是“越大越快”

假设数据库最多可承受 100 个连接，需要给迁移、运维和其他系统留 20个，那么剩下80个才是应用预算。10 个应用实例每个 max=10，潜在就有100个应用连接，已经超预算。

粗略预算：

```text
实例数 × 每实例池上限 + 其他连接需求 ≤ 可用连接容量
```

这只是起点，真实还需要看数据库并发处理能力、查询时长、事务时长和等待时间。

Serverless 的热实例可能快速增长。Supabase 当前建议从每热实例 `max: 1` 开始，确认单实例内并发请求排队成为瓶颈后，再基于数据调整；不是因为一条连接“性能永远最好”。

还要观察 `pool.waitingCount`、活跃/空闲连接、慢事务与数据库端连接数。连接池满不一定因为 max 太小，也可能是事务里调用外部服务或泄漏连接。

## 11.4 Supabase：先选方式，再复制连接串

从项目 Dashboard 的 **Connect** 面板选择模式并复制 URI，不要靠地区名拼主机，也不要只把 5432改成6543猜一个端点。

| 运行场景                      | 通常选择                          | 主要原因                                  |
| ----------------------------- | --------------------------------- | ----------------------------------------- |
| 长驻后端，网络支持直连地址    | Direct connection                 | 保留正常 Postgres 会话能力                |
| 长驻后端，但网络只有 IPv4     | Shared pooler / Session mode      | 解决直连 IPv6 可达性限制                  |
| Serverless，很多短连接实例    | Shared pooler / Transaction mode  | 适合短事务复用后端连接                    |
| 迁移、备份、恢复、replication | 优先 Direct；不可达时评估 Session | 单会话/原生命令，不依赖事务池的跨事务状态 |
| 浏览器前端                    | Supabase Data API + RLS           | 不持有数据库密码，也不是 pg TCP 直连      |

示意 URI（真实值应从 Connect复制）：

```text
Direct：
postgresql://postgres:<密码>@db.<项目>.supabase.co:5432/postgres

Shared Session：
postgresql://postgres.<项目>:<密码>@<pooler-host>:5432/postgres

Shared Transaction：
postgresql://postgres.<项目>:<密码>@<pooler-host>:6543/postgres
```

直连与共享池用户名不同。pooler主机中的集群索引不是地区名的一部分，不能手工推导。真实密码要 URL 编码保留字符，不把占位符当成密码。

直连默认常是 IPv6，付费 IPv4 add-on 的行为要按项目设置确认；共享池可用于 IPv4 网络。付费专用池（Dedicated pooler）与 Shared不是同一个端点，且当前专用池主要是 transaction mode。以你项目的官方 Connect结果为准。

## 11.5 Session 与 Transaction 模式究竟不同在哪？

Session 模式在客户端会话期间保留对应后端会话。Transaction 模式在一笔事务结束后回收后端连接，下一笔事务可能换到另一后端连接。

所以你不能跨事务假设下面状态仍然存在：

- 命名 prepared statement。
- session-level SET 和临时状态。
- 跨事务 cursor、临时表使用、会话 advisory lock。
- 长期 LISTEN 会话。

不是说 transaction pooler 不支持数据库 transaction。恰恰相反，它会在一笔正常事务期间保持所需后端，支持本文的短事务下单。限制的是**跨事务的会话身份和状态**。

需要设置当前事务的参数时，考虑 `SET LOCAL` 或 `set_config(..., true)`，并且在同一个 tx中使用。不要在普通 pool.query 上 SET一次，然后以为后续所有请求都继承同样状态。

## 11.6 参数绑定和 prepared statement不是一个开关

“关闭 prepared 是不是又会有 SQL injection？”不会。普通参数化查询也能安全绑定值。

三个概念：

1. 参数绑定：SQL结构与参数值分别发送，是安全边界。
2. Drizzle查询构建：生成 SQL、结果映射等客户端工作。
3. 服务端命名 prepared statement：缓存特定会话上的解析/计划，依赖连接状态。

在 node-postgres 中指定 query name 会使用服务端 named prepare。Drizzle RC的：

```ts
const prepared = db
  .select({ id: books.id })
  .from(books)
  .where(eq(books.id, sql.placeholder("id")))
  .prepare("book_by_id");
const rows = await prepared.execute({ id: 1 });
```

适合已确认支持的连接环境，不应盲目在 Supabase transaction模式使用。本文 RC中 `.prepare()` 即使省略名字也会自动生成名字，因此“去掉 prepare 的字符串参数”不是禁用服务端 prepared的方法。

本文主线直接 `await db.select()...`，node-postgres 普通查询保持参数绑定但不主动命名 prepared。这也是它适合我们教学主线的原因之一。

Prepared优化的是部分构建、解析/计划成本，不会把全表扫描变成索引查询。首先处理数据模型、查询边界和执行计划，再用性能数据决定是否预编译。

## 11.7 Postgres.js 的 prepare: false 与额外限制

如果你的项目采用 Postgres.js，官方 Supabase示例是：

```ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { relations } from "./relations";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("缺少 DATABASE_URL");

const client = postgres(url, {
  max: 1,
  prepare: false,
  ssl: "require",
});
export const db = drizzle({ client, relations });
```

这段需要另安装 `postgres`，配套主工程只安装了 `pg`。`ssl: 'require'` 要求加密，但不等于完整服务端证书验证，下一节说明。

当前 Supabase Postgres.js官方文档还明确提示：Postgres.js 默认 query pipelining 与 Shared transaction pooler组合可能导致挂起或结果错配；没有可直接假设有效的关闭开关，`max_pipeline: 0` 还可能破坏 `sql.begin()`。

因此 `prepare: false` **只解决 prepared兼容问题，不是所有部署限制都解决了**。不要把 max_pipeline=0 当作万能修复。采用该组合前确认上游/供应商最新说明，在同一部署环境测试事务与并发；必要时选择本文 node-postgres 路线或适合运行时的其他驱动。

## 11.8 TLS：加密与验证身份要分清

本地 localhost教学数据库可不启用 TLS，跨网络生产连接应使用 TLS。`sslmode=require` / Postgres.js `ssl:'require'` 要求加密，但是否验证服务端身份取决于驱动的模式，不能一概当成 verify-full。

node-postgres显式传可信 CA的示意：

```ts
import { readFileSync } from "node:fs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  ssl: {
    rejectUnauthorized: true,
    ca: readFileSync(process.env.DB_CA_PATH!, "utf8"),
  },
});
```

证书从可信来源/供应商 Dashboard取得并随部署提供。还要确保驱动按正确主机名校验，不是随便指向一个IP。URI中的 `sslmode` / `sslrootcert` 等参数可能影响或覆盖程序化 ssl配置；不要把两套冲突配置同时塞进去再猜哪套有效。

出现证书错误时检查 CA链、主机名和驱动解析方式。不要把 `rejectUnauthorized:false` 当作生产通用解决方案；它削弱了服务端身份验证。

## 11.9 Serverless与 Edge并不是同一个环境

Node Serverless通常有 Node API，但热实例会冻结、连接可能陈旧，也有严格执行时间。模块级 Pool复用有帮助，仍需 timeout、错误恢复和数据库端观测。

Edge环境的 TCP、TLS、Node兼容 API取决于平台。不能因为 Drizzle支持 Edge，就认为 `pg` 在所有 Edge平台都能原样运行。HTTP/WebSocket等专用驱动还可能有不同事务和 batch能力，必须按照其官方支持矩阵设计。

本教程选择 Node运行时，不提供未经验证的跨平台驱动替换承诺。Supabase的 DB不是因为你换成“HTTP驱动”就自然提供任意 HTTP SQL端点。

超时也要分层：

- connectionTimeout：建连/等待可用连接的预算。
- statement timeout：数据库语句运行预算。
- HTTP deadline：业务请求总预算。

只用 Promise.race返回超时不一定取消实际数据库查询；后台查询可能还占用连接或提交。取消、连接错误和未知提交结果，需要明确的驱动处理与幂等策略。

## 11.10 Supabase RLS与服务端直连的权限边界

浏览器 supabase-js通常发送 JWT走 Data API；RLS根据身份决定能访问哪些行。服务端拿 postgres身份直接连接是另一条路径：数据库只看到连接角色，不会自动把每个HTTP用户变成 auth.uid()。

表 owner、具有 BYPASSRLS / superuser 权限等角色可能绕过 RLS。具体取决于实际角色、表 owner、FORCE RLS等配置。不能声称“开了RLS，admin直连也自动只能查当前用户”。

安全选择通常是：

- 服务端验证用户身份，在业务查询明确加入用户/租户scope，并采用最小权限角色。
- 或设计受控的RLS连接路径，在事务里设置已验证的claims/角色，并验证权限行为。

JWT decode只是读内容，不是验证签名、过期和签发方。客户端传来的role绝不能直接用于 `SET ROLE` 的 raw拼接。RLS完整接入超出本教程主线，但你应知道哪里需要进一步设计，而不是把官方样例片段不加审计就当认证系统。

迁移还有额外风险：Supabase包含平台管理的 auth/storage等对象。不要默认让push/pull管理所有schema；明确设置 scope和对象归属，迁移身份与业务身份分开。

## 11.11 动手练习：为三种部署作选择

1. 一台支持IPv6的长驻Node服务器。
2. 一个只有IPv4网络的长驻后台。
3. 很多短暂热实例的Node云函数。

参考：1优先Direct，2可用Shared Session，3评估Shared Transaction +小应用池；第三种禁用named prepared并核对driver/pipelining能力。

把同一查询普通await和prepare各执行一次，再在允许的环境检查差异。不要把生产数据库作为“看看会不会报错”的练习场。

- [ ] 能分清应用侧池与供应商pooler。
- [ ] 能按实例数预算连接，不在每请求创建/结束共享池。
- [ ] 能选择Supabase Direct / Session / Transaction并解释限制。
- [ ] 能区分参数绑定与prepared，以及加密与证书校验。
- [ ] 知道Node/Edge、PGlite/云部署、RLS/直连各自的边界。

官方阅读：[Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql)、[Drizzle Supabase](https://orm.drizzle.team/docs/connect-supabase)、[Supabase Connecting](https://supabase.com/docs/guides/database/connecting-to-postgres)、[Postgres.js](https://supabase.com/docs/guides/database/postgres-js)、[关闭prepared](https://supabase.com/kb/troubleshooting/disabling-prepared-statements-qL8lEL)、[node-postgres Pooling](https://node-postgres.com/features/pooling)。
