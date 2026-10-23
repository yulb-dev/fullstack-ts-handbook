# 第 12 章：环境隔离与部署——local / preview / production，凭据按环境分开

[上一章](./11-storage.md) · [目录](./README.md) · [下一章](./13-backup-restore-and-data-protection.md)

到这里，云端主线已经在独立教学项目中建立 Teamboard；可选本地路线则在电脑上的 Supabase 栈完成。本章把教学方式升级为长期可维护的开发和发布流程：开发、预览、预发（staging）、生产（production）**各自的数据、凭据、配置彼此隔离**，所有数据库变更通过同一组迁移文件、以同样的顺序到达每个环境。

使用托管云数据库不要求开发者电脑再安装一台数据库：开发环境可以是独立的云项目。需要本地重放与自动化测试时，也可以让 CI runner 运行容器，本机仍不必装 Docker。

## 12.1 环境矩阵

| 环境                  | 是什么                                       | 数据                               | 谁能访问               | 生命周期                            |
| --------------------- | -------------------------------------------- | ---------------------------------- | ---------------------- | ----------------------------------- |
| **local（可选）**     | 每个开发者电脑上的 CLI 本地栈                | 种子数据（虚构）                   | 开发者本人             | 随时本地 `db reset`                 |
| **cloud-development** | 本地应用连接的独立托管开发项目，不是生产项目 | 虚构测试数据；不能复制生产个人信息 | 开发团队               | 通过迁移推进；不把 reset 当日常更新 |
| **preview**           | 每个 PR 一个 Supabase 预览分支（Branching）  | 默认**没有数据**，可执行种子       | 团队                   | PR 合并或关闭时自动删除             |
| **staging**           | 独立项目或持久分支，结构与生产一致           | 虚构或脱敏数据                     | 团队、测试             | 长期                                |
| **production**        | 生产项目                                     | 真实用户数据                       | 用户；团队成员最小权限 | 长期                                |

每个环境之间**不共享**以下任何一项：

| 项                                                                    | 为什么必须分开                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------- |
| 项目 URL 与 project ref                                               | 不同的数据库                                                   |
| Publishable key                                                       | 本环境的前端使用                                               |
| Secret key                                                            | 泄露一个环境的 key 不能危及其他环境                            |
| 数据库密码 / 连接串                                                   | 同上                                                           |
| Auth 配置：`site_url`、重定向白名单、SMTP、OAuth 应用的 client secret | 预览环境的回调地址与生产不同；OAuth 应用最好每个环境各注册一个 |
| Edge Functions 的密钥（第三方 API key 等）                            | 测试环境用测试账号（例如支付平台的沙箱密钥）                   |
| Storage 中的文件                                                      | 生产文件包含用户数据                                           |

> 一条根本原则：**生产环境的凭据只存在于生产环境的部署平台与 CI 的生产密钥中。** 开发者的电脑上、预览环境里、本地 `.env` 文件中，都不应该出现生产的 secret key 和数据库密码。

## 12.2 在代码里如何区分环境

不要写这样的代码：

```ts
// ❌ 一个文件里同时存着多套凭据，靠条件判断选择
const key = process.env.NODE_ENV === "production" ? PROD_KEY : DEV_KEY;
```

正确的做法是：**代码只读取固定名字的变量（`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` ……），由运行环境注入对应的值。**

| 环境                  | 值从哪里来                                                                        |
| --------------------- | --------------------------------------------------------------------------------- |
| 本地栈                | `.env.local`（填入 `supabase status` 的本地输出，不提交）                         |
| 本地应用 + 云端开发库 | `.env.local` 或单独的 `.env.development`，填入独立云项目的 URL/key/连接串，不提交 |
| preview               | 部署平台的 Preview 环境变量 + 预览分支自己的 key                                  |
| staging               | 部署平台的 Staging 环境变量 / CI 的 staging 密钥                                  |
| production            | 部署平台的 Production 环境变量 / CI 的 production 密钥                            |

本教程的脚本用 Node 的 `--env-file` 显式指定读取哪个文件：

```bash
node --env-file=.env.local scripts/admin-report.mjs      # 本地
node --env-file=.env.staging scripts/admin-report.mjs    # 预发（文件只在有权限的人手里，不提交）
```

`.env.local` 中的“local”通常表示文件供本机开发读取，并不说明数据库也在本机；它完全可以指向独立的云端开发库。文件名不是安全检查，目标 URL 与 project ref 才能帮助确认要访问哪个环境。

对于有破坏性或只应在开发环境运行的脚本，**根据目标 URL/project ref 限制范围**，而不是只依赖 `APP_ENV`。本教程现有 `dev:users`、`demo:rls`、`demo:storage` 使用 `assertLocalSupabase` 严格只允许本地栈，不因云端学习而删除保护。专门的云端测试工具应另行设计开发项目 allowlist，并核对数据库与 Storage 是否属于同一环境。

### config.toml 与 env()

`config.toml` 管理本地栈，可以提交。其中需要秘密的字段用 `env()` 引用：

```toml
[auth.external.github]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET)"
```

CLI 会从项目根目录的 `.env` 读取这些变量。**`.env` 必须在 `.gitignore` 中**（配套工程的 `.gitignore` 忽略了所有 `.env*`，只保留 `.env.example`）。

## 12.3 两种多环境方案

### 方案 A：独立项目 + GitHub Actions（官方 Managing Environments 指南）

```text
feature 分支  ──► 独立开发云项目（或可选本地数据库）
develop 分支  ──► staging 项目      （push 后 CI 执行 supabase db push）
main 分支     ──► production 项目   （push 后 CI 执行 supabase db push）
```

官方这条从零搭建的流程要求 **staging 是干净的新项目**，直接通过迁移重建结构。已经手工改出相同结构、却没有对应迁移历史的项目，不能盲目 db push，否则会尝试重复建表。已有业务云项目应按第 3 章先核对原仓库或建立基线，而不是把本教程的 Teamboard 迁移混进去。

普通 `db push` 不执行开发 seed，也不把本地 config.toml 的端口、邮箱确认等设置自动同步到云端。CI 启动本地栈只为测试；staging/production 的部署任务分别选择自己的 project ref，生产不使用 `--include-seed`。

### 方案 B：Supabase Branching

Branching 为每个 PR 创建一个独立的预览分支，官方描述的要点：

- **每个分支是一个独立的环境，有自己的 Supabase 实例和 API 凭据**；
- **预览分支**是临时的，PR 合并或关闭时自动删除；**持久分支**适合 staging、QA 这类长期环境；
- 新分支从基础项目复制 Postgres 设置、连接池设置、Auth / Data API / Realtime / Storage 设置、SSL 与网络限制、已部署的 Edge Functions；
- **Auth 的秘密（OAuth 密钥、SMTP 密码）会被替换为占位值**，需要用分支密钥重新设置；
- **数据库结构不复制**：GitHub 集成的分支从仓库里的迁移构建结构；
- **默认不带数据**：新分支不包含基础项目的任何数据与 Storage 对象——为了保护生产中的敏感数据。需要数据时使用种子文件。

合并到基础项目时，部署流程依次是：Clone → Pull → Health → Configure（应用 `config.toml`）→ Migrate → Seed → Deploy（Edge Functions）。**父步骤失败，所有子步骤跳过**：迁移失败就不会执行种子和函数部署。

读取某个分支自己的 key：

```bash
npx supabase projects api-keys --project-ref <分支的 project ref>
```

持久分支的差异化配置写在 `config.toml` 的 `[remotes]` 中（`project_id` 必须是已存在的分支 ref）：

```toml
[remotes.staging]
project_id = "your-staging-branch-ref"

[remotes.staging.db.seed]
enabled = true
sql_paths = ["./seeds/staging.sql"]
```

分支的秘密用 CLI 设置，**每个分支要单独设置**：

```bash
npx supabase secrets set --env-file ./supabase/.env.staging   # 文件本身不提交
```

（官方也介绍了用 dotenvx 把加密后的 `.env.preview`、`.env.production` 提交到仓库、解密密钥单独保存的做法，适合需要在 Git 中管理多环境配置的团队。）

一个与迁移相关的限制（来自官方本地开发工作流文档）：**GitHub 集成部署时会把每个迁移放在事务里执行**，不认 pg-delta 的 `-- pg-delta: transaction=false` 指令。所以包含 `create index concurrently` 等不能在事务中执行的语句的迁移，在这种部署方式下会失败，需要另行处理（例如在低峰期通过直连手动执行，并用 `migration repair` 记录）。

**怎么选？** 小团队起步用方案 A 足够，概念简单、完全由你掌控；需要“每个 PR 一个可点击的完整预览环境”时引入 Branching。两种方案的核心相同：**迁移文件是唯一的结构来源。**

## 12.4 用 GitHub Actions 实现方案 A

CI 需要三个变量（官方说明）：

| 变量                    | 内容                                                                     | 存放                                                          |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | **范围受限的**个人访问令牌（scoped PAT），只授权给这个工作流要部署的项目 | GitHub Secrets                                                |
| `SUPABASE_DB_PASSWORD`  | 目标项目的数据库密码                                                     | 每个环境一个：`STAGING_DB_PASSWORD`、`PRODUCTION_DB_PASSWORD` |
| `SUPABASE_PROJECT_ID`   | 目标项目的 ref                                                           | 每个环境一个                                                  |

官方说明：工作流要执行 `supabase link`，令牌需要 **Project Settings、API Keys、API Key Secrets** 的读权限。

**`.github/workflows/ci.yml`**（每个 PR 运行，在支持 Docker 的 runner 上测试；开发者电脑不必运行容器）：

```yaml
name: CI
on:
  pull_request:
  workflow_dispatch:

jobs:
  database:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci # 使用 package.json 里锁定的 CLI 版本

      - name: Start local stack and apply all migrations + seed
        run: npx supabase start

      - name: Run pgTAP tests (RLS, constraints)
        run: npx supabase test db

      - name: Verify schema coverage (pg-delta projects)
        run: npx supabase db diff --strict-coverage

      - name: Verify generated types are committed
        run: |
          npx supabase gen types --lang typescript --local > database.types.ts
          git diff --exit-code database.types.ts
```

与官方示例相比，这里做了三处调整：用 `npm ci` 安装锁定版本的 CLI（官方示例用 `supabase/setup-cli` 的 `version: latest`，团队协作时锁定版本更可控）；启动完整本地栈以便运行 pgTAP；增加了 `supabase test db`。

**`.github/workflows/staging.yml`**：

```yaml
name: Deploy migrations to staging
on:
  push:
    branches: [develop]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: staging # GitHub Environment：密钥按环境隔离
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.STAGING_DB_PASSWORD }}
      SUPABASE_PROJECT_ID: ${{ secrets.STAGING_PROJECT_ID }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npx supabase link --project-ref "$SUPABASE_PROJECT_ID"
      - run: npx supabase migration list
      - run: npx supabase db push --dry-run
      - run: npx supabase db push
```

**`.github/workflows/production.yml`** 与 staging 相同，只是触发分支为 `main`、使用 `environment: production` 和 `PRODUCTION_*` 密钥。建议在 GitHub 的 production Environment 上开启**必需审批人**，让生产部署需要人工确认。

官方明确建议：**生产环境通过 CI/CD 部署迁移，而不是从开发者的电脑上直接 `db push`。** 这样每一次生产变更都有对应的提交、审阅记录和运行日志。

### 一次完整的变更流程

下面的 reset/test/types 命令是本地栈验证方式。纯云端开发者在独立开发项目测试新迁移与用户授权，提交后由上面的 CI 在隔离容器中重放和测试；不要将 `db reset` 换成 `db reset --linked` 来操作业务库。云端类型用第 3 章的 `gen types --project-id` 生成。

```bash
git checkout -b feat/task-watchers
npx supabase migration new add_task_watchers
# 编写迁移（表、约束、索引、RLS、grant 一起），以及 supabase/tests/task_watchers_rls.test.sql
npx supabase db reset           # 从零验证迁移链 + 种子
npx supabase test db            # RLS 测试
npm run db:types                # 重新生成类型
git add supabase/ database.types.ts && git commit -m "Add task watchers"
git push -u origin feat/task-watchers
# 开 PR → CI 通过 → 审阅 → 合并到 develop → 自动部署到 staging
# 在 staging 验证（第 13 章的检查清单）
# 开 develop → main 的 PR → 审批 → 自动部署到 production
```

## 12.5 生产迁移的安全写法

能在本地 `db reset` 成功，不代表能安全地在一个有数据、有流量的生产库上执行。第 7 章讲过锁队列，第 6 章讲过 `create index concurrently`，这里汇总成规则。

### 规则一：设置锁等待与语句超时

```sql
set lock_timeout = '5s';
set statement_timeout = '60s';
alter table public.tasks add column note text;
```

拿不到锁就快速失败，而不是让所有请求排在迁移后面。

### 规则二：知道哪些操作会重写或长时间锁表

| 操作                                                     | 风险                                            | 安全写法                                                                                                                                |
| -------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 添加带**常量**默认值的列                                 | Postgres 11+ 只改元数据，很快                   | 直接执行                                                                                                                                |
| 添加带**易变**默认值（`now()`、`gen_random_uuid()`）的列 | 重写整张表                                      | 先加可空列，分批回填，再设置默认值                                                                                                      |
| 给已有列加 `NOT NULL`                                    | 扫描全表并持有强锁                              | 先加 `check (col is not null) not valid`，再 `validate constraint`，最后 `set not null`（Postgres 12+ 可以利用已验证的 CHECK 跳过扫描） |
| 添加 CHECK / 外键约束                                    | 扫描全表验证已有数据                            | `add constraint ... not valid`，再单独 `validate constraint`（验证时只持有较弱的锁，不阻塞读写）                                        |
| 建索引                                                   | 阻塞写入                                        | `create index concurrently`，单独一个迁移                                                                                               |
| 修改列类型                                               | 通常重写表                                      | 新增列 + 回填 + 切换（见规则三）                                                                                                        |
| 删除列、删除表                                           | 需要 `ACCESS EXCLUSIVE`；应用代码还在用就会报错 | 先让应用停止使用，再删除（规则三）                                                                                                      |

```sql
-- 例：为大表添加约束而不长时间阻塞
alter table public.tasks
  add constraint tasks_title_trimmed check (title = btrim(title)) not valid;   -- 只检查新写入的行
alter table public.tasks validate constraint tasks_title_trimmed;             -- 检查已有行，不阻塞读写
```

### 规则三：扩展—收缩（expand–contract），永远不让新旧代码与结构冲突

部署时，**数据库迁移和应用代码不可能在同一瞬间切换**。总有一段时间旧代码在跑新结构，或新代码在跑旧结构。破坏性变更要拆成多个可以独立上线的步骤。

例：把 `tasks.due_on`（`date`）改为 `due_at`（`timestamptz`，支持具体时刻）：

| 步骤     | 迁移                                                                                       | 应用代码       | 回滚                       |
| -------- | ------------------------------------------------------------------------------------------ | -------------- | -------------------------- |
| 1 扩展   | 新增可空列 `due_at`                                                                        | 不变           | 删除新列即可               |
| 2 双写   | （可选）触发器把 `due_on` 的写入同步到 `due_at`                                            | 写两列，读旧列 | 回退代码                   |
| 3 回填   | 分批 `update ... set due_at = due_on::timestamptz where due_at is null and id between ...` | —              | —                          |
| 4 切换读 | 新索引（concurrently）                                                                     | 读新列         | 回退代码                   |
| 5 收缩   | 确认没有任何代码读写 `due_on` 之后，删除旧列和同步触发器                                   | —              | **不可回滚**，所以放在最后 |

每一步都是一个独立的迁移（或独立的代码发布），并且每一步上线后系统都完整可用。

### 规则四：没有“自动回滚”，只有向前修复

Supabase CLI 的迁移只向前执行，没有自动生成的 down 迁移。发现问题时：

1. 写一个新的迁移修复它（roll forward），走正常流程上线；
2. 数据被破坏时，使用备份 / PITR 恢复（第 13 章）——这是灾难恢复手段，代价高（停机、可能丢失恢复点之后的数据）。

所以发布前的验证（第 13 章）比事后补救重要得多。

## 12.6 防止“漂移”

漂移是指线上数据库的结构与迁移文件不一致，通常因为有人在 Dashboard 里直接改了生产库。后果：下一次 `db push` 失败，或者预发与生产行为不同。

- **规则**：生产（以及 staging）的结构只通过迁移修改；Dashboard 用于观察，不用于改结构。限制 Dashboard 成员在生产项目上的权限。
- **发现**：`npx supabase migration list` 对比两边的迁移历史；`npx supabase db diff --linked` 对比结构（在你链接的那个环境上执行，先确认链接的是哪个）。
- **修复**：用 `npx supabase db pull` 把漂移捕获成一个新迁移，审阅后提交，让历史重新一致；如果漂移是错误的改动，就写迁移把它改回去。

## 12.7 前端与其他服务的环境变量

部署平台（以 Vercel 为例）通常区分 Development / Preview / Production 三组环境变量：

| 变量                                             | Preview                    | Production                       |
| ------------------------------------------------ | -------------------------- | -------------------------------- |
| `VITE_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | 预览分支或 staging 的 URL  | 生产 URL                         |
| `VITE_SUPABASE_PUBLISHABLE_KEY`                  | 对应环境的 publishable key | 生产 publishable key             |
| `SUPABASE_SECRET_KEY`（仅服务端）                | 对应环境的 secret key      | 生产 secret key                  |
| `DATABASE_URL`（仅服务端）                       | 对应环境的连接串           | 生产连接串（按第 10 章选择模式） |

还要同步检查每个环境 Auth 的 **Site URL 与 Redirect URLs**：预览部署的域名必须在预览环境的白名单里，否则登录回调会失败；生产的白名单里**不应该**出现预览域名或 localhost。

Edge Functions 的密钥按项目设置：`npx supabase secrets set --env-file <对应环境的文件>`，并用 `npx supabase functions deploy <名字>` 部署到已链接的项目。

## 12.8 上线前检查清单

- [ ] 每个环境是独立的项目或分支，URL、key、数据库密码各不相同。
- [ ] 生产的 secret key 与数据库密码只在生产部署平台和 CI 生产密钥中；开发者电脑上没有。
- [ ] CI 使用范围受限的访问令牌；生产部署需要审批。
- [ ] `.env*` 文件（除 `.env.example`）都在 `.gitignore` 中，仓库历史里没有提交过秘密。
- [ ] `config.toml` 中的秘密都使用 `env()`。
- [ ] `[db] major_version` 与线上一致。
- [ ] 每个环境的 Auth Site URL / Redirect URLs、SMTP、OAuth 应用正确配置。
- [ ] 迁移在 CI 中通过 `supabase start` + `supabase test db`；`db push --dry-run` 的输出已审阅。
- [ ] 破坏性变更拆成扩展—收缩步骤；迁移设置了 `lock_timeout`；大表索引用 `concurrently`。
- [ ] 从未对生产执行 `db push --include-seed` 或 `db reset --linked`。
- [ ] 发布前确认备份 / PITR 可用（第 13 章）。

## 12.9 本章练习

1. 列出 Teamboard 在 staging 与 production 之间必须不同的配置与凭据（至少 8 项）。
2. 团队想把 `memberships.role` 新增一个值 `'viewer'`（只读成员），涉及 enum 修改与策略修改。设计上线步骤，说明顺序为什么重要。
3. CI 的 production 工作流失败了：`db push` 报“migration already applied”。可能的原因是什么？如何排查？
4. 预览分支默认没有数据，测试人员抱怨“每次都要手动造数据”。在不使用生产数据的前提下，给出两种方案。
5. 假设 `comments.author_id` 当初没有建外键，现在要给已有 5000 万行的 `comments` 表补上指向 `auth.users` 的外键。写出安全的 SQL。

### 参考答案

1. 项目 URL / ref；publishable key；secret key（每个后端组件各一个）；数据库密码与连接串；Auth Site URL 与 Redirect URLs；SMTP 凭据；OAuth 应用的 client id/secret；Edge Functions 的第三方密钥（如支付沙箱 vs 正式）；Storage 中的文件；CI 访问令牌的授权范围；Dashboard 成员权限；备份 / PITR 设置。
2. ① 迁移：`alter type public.org_role add value 'viewer';`（新增的枚举值在提交前不能在同一事务中使用，所以单独一个迁移）；② 迁移：更新相关策略，让 viewer 只能读（例如写入类策略改为检查 `has_org_role(..., array['owner','admin','member'])`），并更新 pgTAP 测试；③ 发布前端，增加 viewer 的界面；④ 最后才允许把成员设置为 viewer。顺序保证任何时刻都不会出现“数据里有 viewer，但策略还不认识它”或“代码引用了数据库还没有的枚举值”。
3. 远端的迁移历史与本地不一致：可能有人在别的地方（另一个分支、手工）执行过同版本的迁移，或者迁移文件被改名/修改。用 `supabase migration list` 对比两边；确认实际结构后，用 `supabase migration repair --status applied|reverted <版本>` 修正历史记录，再重新执行。不要为了“让它通过”而盲目 repair。
4. ① 在 `config.toml` 的种子配置中为分支启用一份专门的种子文件（虚构数据，可以比本地种子更丰富）；② 写一个只允许对非生产 URL 运行的脚本，通过 Auth 管理 API 和 Data API 生成测试账号与数据。两者都不涉及生产数据。
5. ```sql
   set lock_timeout = '5s';
   alter table public.comments
     add constraint comments_author_fk foreign key (author_id)
     references auth.users (id) on delete set null
     not valid;
   -- 单独执行（可以放在下一个迁移里）：
   alter table public.comments validate constraint comments_author_fk;
   ```
   `not valid` 只对新写入生效，几乎立刻完成；`validate` 扫描已有数据时使用较弱的锁，不阻塞正常读写。同时考虑 `author_id` 上是否需要索引（第 6 章）。

## 本章验收

- [ ] 能描述 local / preview / staging / production 四种环境的用途、数据来源与生命周期。
- [ ] 能列出必须按环境分开的凭据与配置，并说明生产凭据应该存放在哪里。
- [ ] 能用环境变量注入而不是代码分支来区分环境，知道 `config.toml` 中用 `env()` 引用秘密。
- [ ] 能比较“独立项目 + CI”与 Branching 两种方案，说出预览分支的默认行为（独立凭据、无数据、秘密为占位值）。
- [ ] 能写出 CI（测试）与部署（staging、production）工作流，知道 CI 令牌的权限范围。
- [ ] 能用 `lock_timeout`、`not valid` + `validate`、`concurrently`、扩展—收缩等方法安全地变更生产结构。
- [ ] 知道迁移只能向前修复，知道如何发现和处理漂移。

## 官方阅读

- [Supabase：Managing Environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [Supabase：Branching](https://supabase.com/docs/guides/deployment/branching)
- [Supabase：Branching configuration（remotes、分支密钥）](https://supabase.com/docs/guides/deployment/branching/configuration)
- [Supabase：Local development workflow（Pushing to a remote project、Troubleshooting）](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Supabase：Managing config and secrets](https://supabase.com/docs/guides/local-development/managing-config)
- [Supabase：Personal access tokens](https://supabase.com/docs/guides/platform/personal-access-tokens)
- [PostgreSQL：ALTER TABLE（NOT VALID、VALIDATE CONSTRAINT、锁级别）](https://www.postgresql.org/docs/current/sql-altertable.html)
