# 第 13 章：备份、恢复、迁移前后的验证、种子数据与个人数据保护

[上一章](./12-environments-and-deployment.md) · [目录](./README.md) · [下一章](./14-capstone-and-acceptance.md)

前面的章节都在“防止出错”。这一章处理“已经出错”和“不能出错”的部分：

- 数据库被误删、被错误的迁移破坏时，**能恢复到什么时间点，要停机多久**？
- 每次发布迁移之前和之后，**用什么证明它是安全的**？
- 开发和测试需要数据，**怎样做到既有数据可用、又不接触真实用户的个人信息**？

## 13.1 Supabase 的备份到底包含什么

根据官方 Database Backups 文档：

| 项                 | 事实                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 自动每日备份       | **Pro、Team、Enterprise** 计划的项目每天自动备份；可访问的天数分别为 7、14、最多 30 天                                                                                           |
| 免费计划           | **没有自动备份**。官方建议免费项目定期用 `supabase db dump` 导出数据，并保存在异地                                                                                               |
| PITR（时间点恢复） | Pro 及以上计划可购买的附加功能，需要至少 Small 计算规格；基于物理备份 + WAL 归档，最坏情况下的恢复点目标（RPO）约 **2 分钟**，可恢复到秒级的时间点。启用 PITR 后不再生成每日备份 |
| **Storage 文件**   | **不包含**。数据库只存文件的元数据；恢复旧备份不会恢复备份之后删除的文件                                                                                                         |
| 自定义角色的密码   | 每日备份**不保存**，恢复后需要重设                                                                                                                                               |
| 删除项目           | **同时永久删除它的所有备份**，不可撤销                                                                                                                                           |
| 恢复过程           | 恢复期间项目**不可访问**，停机时长取决于数据库大小                                                                                                                               |
| 订阅与复制槽       | 使用了逻辑复制订阅或复制槽的项目，恢复前要删除、恢复后重建（Realtime 使用的槽由平台处理）                                                                                        |

两个重要的推论：

1. **“平台有备份”不等于“你有备份”**：免费项目没有；项目被删除时备份一起消失；Storage 文件不在其中。关键业务应当有一份**你自己控制的**、存放在 Supabase 之外的备份。
2. **恢复是有代价的操作**：整库回到过去意味着停机，并且丢失恢复点之后的所有写入。它是灾难恢复手段，不是“撤销按钮”。

## 13.2 恢复目标：先回答两个问题

| 指标                | 问题                           | Teamboard 的回答（示例）                |
| ------------------- | ------------------------------ | --------------------------------------- |
| RPO（恢复点目标）   | 最多能接受丢失多长时间的数据？ | 1 天 → 每日备份够用；几分钟 → 需要 PITR |
| RTO（恢复时间目标） | 最多能接受停机多久？           | 必须通过演练测量，而不是估计            |

只有回答了这两个问题，才能决定计划、是否购买 PITR、自建备份的频率。

## 13.3 云端备份：CLI 与不依赖容器的客户端方案

备份的是云端数据库，**不要求先启动完整的本地 Supabase 栈**。但本文 Docker 工作流中的 `supabase db dump` 会在容器中运行 pg_dump，需要运行它的机器有容器运行时（可以是 CI 或备份服务器，不一定是开发者电脑）。目标是远端和工具在本地使用容器并不矛盾。

### Supabase CLI 的项目备份

逻辑备份（`pg_dump` 格式的 SQL）可以下载、离线保存，也可以恢复到另一个项目。下面在有容器运行时的受控机器上，从 CLI 项目目录执行。`DB_URL` 由密钥管理注入，选择 Direct 或 Session 端点并配置 TLS，不把带真实密码的 URL 直接输入 shell 历史。官方的备份步骤把它分成三个文件：

```bash
# DB_URL 已安全注入；保留 CLI 项目目录，不切到备份子目录
mkdir -p backups

npx supabase db dump --db-url "$DB_URL" -f backups/roles.sql --role-only
npx supabase db dump --db-url "$DB_URL" -f backups/schema.sql
npx supabase db dump --db-url "$DB_URL" -f backups/data.sql --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"
```

| 文件         | 内容                                      |
| ------------ | ----------------------------------------- |
| `roles.sql`  | 自定义数据库角色（不含平台角色）          |
| `schema.sql` | 表、函数、策略、触发器等结构              |
| `data.sql`   | 数据（`--use-copy` 使用 COPY 格式，更快） |

如果项目已经 `supabase link`，也可以用 `--linked` 代替 `--db-url`（`db dump` 默认作用于已链接的项目）。

**备份文件本身就是最敏感的数据**：它包含所有用户的邮箱、个人信息、业务数据。

- 绝不提交到 Git（配套工程的 `.gitignore` 已忽略 `backups/` 与 `*.dump`）；
- 加密后存放在访问受控的位置（例如开启服务端加密、限制访问权限的对象存储桶）；
- 设定保留期并自动清理过期备份——备份里的数据也受“用户要求删除”的约束（13.9）；
- 记录谁、何时访问过备份。

### 不安装容器：使用本机 pg_dump

只需安装 PostgreSQL **客户端工具**（pg_dump、pg_restore、psql），不必安装数据库服务器。pg_dump 客户端大版本不能低于被备份服务器；先按第 1 章查询云端版本。

下面是 **Teamboard 应用 schema 的选择性备份**。主机、用户名来自 Connect；密码由 `-W` 提示输入，TLS 使用可信根证书：

```bash
mkdir -p backups
PGSSLMODE=verify-full PGSSLROOTCERT="/你的根证书路径" \
  pg_dump -W --host="<Connect中的主机>" --port=5432 \
  --username="<Connect中的用户名>" --dbname=postgres \
  --schema=public --schema=private --format=custom --no-owner --no-acl \
  --file=backups/application.dump
```

`pg_restore --list backups/application.dump` 可以查看归档内容，**但不是恢复演练**。文件名不要反复覆盖唯一备份，正式任务使用带时间戳的目录与受控保留期。

这个选择性备份不含 auth 用户、Storage 文件、平台配置、角色或迁移历史，且示例的 `--no-acl` 不保留授权。它不是完整 Supabase 项目的替代备份，也不能单独恢复一套可登录的 Teamboard。完整恢复要结合平台备份或官方项目迁移流程，分别处理跨 schema 的依赖、授权、用户身份和文件；不能把全库 pg_dump 不经审阅直接灌进另一个托管项目的 auth/storage 管理对象。

### Storage 文件的备份

数据库备份不包含文件。需要备份文件时，可以通过 Supabase Storage 的 **S3 兼容协议**，用 AWS CLI 等工具把桶同步到你自己的存储（S3 凭据在 Dashboard 的 Storage 设置中生成，endpoint 形如 `https://<ref>.supabase.co/storage/v1/s3`）：

```bash
aws s3 sync s3://task-attachments ./backups/files/task-attachments \
  --profile supabase-s3 \
  --endpoint-url https://<project-ref>.supabase.co/storage/v1/s3 \
  --region <your-region>
```

S3 凭据与 secret key 同等敏感，只放在执行备份的服务器上。

## 13.4 恢复

### 方式一：Dashboard 恢复（每日备份 / PITR）

在 Database > Backups 中选择备份（或 PITR 的时间点）。官方建议：**选择早于目标时间点、且最接近它的备份**。恢复期间项目不可访问。

### 方式二：恢复到一个新项目

官方提供“Restore to a new project”（复制项目）功能，适合：

- 演练恢复流程而不影响生产；
- 只需要找回**部分**数据（例如某个组织被误删）：先恢复到新项目，从中导出需要的行，再导入生产。这比把整个生产库回退到过去代价小得多。

### 方式三：从逻辑备份恢复（官方步骤）

1. 创建新项目；如果旧项目使用了数据库 Webhooks、非默认扩展，先在新项目中启用；
2. 获取新项目的连接串（默认会话池，支持 IPv6 时可用直连）；
3. 以下是恢复操作，不是只读检查，只对确认好的新恢复项目执行。文件参数应指向备份目录中的实际文件；示例假设当前位于保存 roles.sql、schema.sql、data.sql 的目录（若仍在应用目录，把参数改为 backups/roles.sql 等）：

```bash
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file roles.sql \
  --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "$NEW_DB_URL"
```

- `--single-transaction` + `ON_ERROR_STOP=1`：任何一步失败就整体回滚，不会留下“恢复了一半”的数据库；
- `session_replication_role = replica`：导入数据时禁用触发器。对 Teamboard 来说这很重要——否则导入 `tasks` 时 `assign_task_number` 触发器会重新分配编号，导入 `auth.users` 时会重复创建 profile。

官方列出的特殊情况：

| 情况                                                   | 处理                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 使用了 Vault 或列加密                                  | 在**旧项目还处于活动状态时**，通过 Management API 把根加密密钥复制到新项目；旧项目暂停或删除后就取不回来了 |
| 想保留迁移历史                                         | 单独导出、导入 `supabase_migrations` schema（否则新项目的 `migration list` 与仓库不一致）                  |
| 对 `auth`、`storage` schema 做过自定义（触发器、策略） | 单独恢复；它们应该本来就在你的迁移文件里                                                                   |
| 自定义 LOGIN 角色                                      | 恢复后用 `alter user ... with password` 重设密码                                                           |
| 恢复时报 `supabase_admin` 相关权限错误                 | 按官方说明注释掉 `schema.sql` 中 `ALTER ... OWNER TO "supabase_admin"` 等行                                |

### 演练，而不是相信

**没有演练过的备份不能算备份。** 建议每季度做一次：

1. 按 13.3 导出（或使用 Dashboard 的恢复到新项目）；
2. 恢复到一个**临时项目**（绝不是生产）；
3. 运行 13.6 的验证查询与行数对比；
4. 把应用的预发环境指向临时项目，做冒烟测试（登录、看板、上传附件）；
5. **记录整个过程花了多长时间**——这就是你真实的 RTO；
6. 删除临时项目，并销毁演练过程中产生的本地备份副本。

## 13.5 迁移之前：检查清单

| 检查                                    | 方法                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 有可用的恢复点                          | Dashboard 确认最近一次每日备份时间或 PITR 窗口；免费计划先手动 `db dump`                                       |
| 将要执行哪些迁移                        | `supabase migration list`、`supabase db push --dry-run`                                                        |
| SQL 已逐行审阅                          | 重点找：`drop`、`truncate`、`delete`/`update` 没有 WHERE、`drop extension`、意外的 `grant`/`revoke`、`cascade` |
| 已在 staging 用接近生产规模的数据执行过 | 记录耗时与锁等待                                                                                               |
| 影响范围已知                            | 对数据修改语句，先用相同 WHERE 条件 `select count(*)`                                                          |
| 有锁保护                                | 迁移里设置了 `lock_timeout`（第 7、12 章）                                                                     |
| 应用兼容                                | 新结构与**当前线上运行的应用代码**兼容（扩展—收缩，第 12 章）                                                  |
| 记录基线                                | 执行 13.6 的第 9 段，保存迁移前的行数快照                                                                      |
| 选择时间                                | 低峰时段；有人值守                                                                                             |

## 13.6 迁移之后：验证

配套工程提供了一组只读的验证查询：[example/supabase/snippets/post_migration_checks.sql](./example/supabase/snippets/post_migration_checks.sql)。

```bash
psql "$DATABASE_URL" -f supabase/snippets/post_migration_checks.sql
```

它依赖 Teamboard 的全部表、函数、约束和文件路径约定；**已有的普通业务云库不能直接套这个脚本**。先用第 1 章的通用只读检查，再为自己实际的表建立类似验证。脚本没有读到任何行只证明该项检查没有发现问题，不证明整个库一定安全。

它检查：

| 段  | 检查内容                                                                                     | 期望                               |
| --- | -------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | public 中没有启用 RLS 的表                                                                   | 0 行                               |
| 2   | public 中没有 `security_invoker` 的视图（会绕过 RLS）                                        | 0 行                               |
| 3   | `anon` 拥有的表权限                                                                          | 本应用 0 行                        |
| 4   | 暴露 schema 中的 `security definer` 函数                                                     | 0 行                               |
| 5   | 没有固定 `search_path` 的 `security definer` 函数                                            | 0 行                               |
| 6   | 无效索引（`concurrently` 失败遗留）                                                          | 0 行                               |
| 7   | `not valid` 之后尚未验证的约束                                                               | 0 行                               |
| 8   | 业务不变量：超出席位、没有 owner 的组织、编号计数器落后、数据库登记但 Storage 中不存在的附件 | 0 行                               |
| 9   | 各表行数快照                                                                                 | 与迁移前对比，差异能被迁移内容解释 |

以第 1 段为例：

```sql
select c.relname as table_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind in ('r', 'p')
   and not c.relrowsecurity;
```

在种子数据上运行时，第 1–8 段都返回 0 行（作者已在配套工程中验证）。

除了 SQL 检查，还要：

- `supabase migration list`：远端与本地的迁移历史一致；
- Dashboard 的 **Security Advisor** 与 **Performance Advisor**：没有新的告警；
- 应用冒烟测试：登录、核心页面、写入、上传；
- 观察日志与错误率一段时间（尤其是 `42501` 权限错误激增，通常意味着 grant 或策略出了问题）。

把这些步骤写进团队的发布清单，每次照做。

## 13.7 种子数据：只用虚构数据

第 3 章已经确立了规则，这里补全原因与做法：

| 规则                                                                      | 原因                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 种子数据只包含虚构数据，邮箱使用保留域名（`example.test`、`example.com`） | 开发者电脑、CI 日志、预览环境都不是存放个人信息的地方；虚构域名保证测试邮件不会发给真人          |
| 种子文件只写数据，不写结构                                                | 结构属于迁移                                                                                     |
| **绝不对生产执行 `db push --include-seed`**                               | 官方明确警告；种子数据会混入真实数据                                                             |
| 预览分支默认没有数据                                                      | 官方设计如此，就是为了保护生产中的敏感数据                                                       |
| 官方提到的“从远端导出数据作为种子”（`db dump --data-only`）必须先清洗     | 官方原话：提交之前删除生产用户数据、秘密、个人信息和任何敏感内容，只保留开发所需的代表性测试数据 |

需要大量、逼真的数据时，用脚本**生成**（第 6 章的 `generate_series`，或官方提到的社区工具 Snaplet Seed），而不是**复制**。

## 13.8 需要接近真实的数据时：脱敏

某些问题只有在“像生产一样”的数据上才能复现（数据分布、数据量、奇怪的历史数据）。如果确实需要从生产数据派生 staging 数据，**脱敏必须在一个隔离的副本上完成，脱敏之前的数据不能离开受控环境**：

1. 恢复到一个临时的、访问受控的项目（13.4 方式二）；
2. 在**那个项目里**执行脱敏 SQL；
3. 从脱敏后的项目导出，导入 staging；
4. 删除临时项目。

脱敏示例（根据你的表结构完整覆盖所有个人信息列）：

```sql
begin;

-- 认证信息：邮箱、手机、密码、元数据
update auth.users
   set email = 'user-' || left(id::text, 8) || '@example.test',
       phone = null,
       encrypted_password = null,
       raw_user_meta_data = jsonb_build_object('display_name', 'User ' || left(id::text, 8));

-- 业务表中的个人信息与自由文本
update public.profiles set display_name = 'User ' || left(id::text, 8);
update public.comments set body = '[已脱敏的评论 #' || id || ']';
update public.attachments set file_name = 'file-' || left(id::text, 8);

commit;
```

注意：

- **自由文本是最难脱敏的**：任务标题、评论、文件名里可能出现手机号、地址、客户名称。最稳妥的是整体替换。
- 认证相关的其他表（第三方登录身份、会话、刷新令牌等）也包含个人信息或凭据，需要一并清理；具体以你项目中 `auth` schema 的实际表为准。
- Storage 文件**不随数据库复制**，这反而是好事：staging 不应该有生产文件。附件元数据指向的文件不存在，界面上显示“文件不可用”即可。
- 脱敏后再运行一次 13.6 的检查，确认不变量仍然成立。

## 13.9 个人数据保护：贯穿全书的清单

| 原则                   | 在 Teamboard 中的体现                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| **最小化收集**         | `profiles` 只有昵称；不收集不需要的字段                                                            |
| **访问控制**           | RLS 保证用户只能看到同组织的数据（第 9 章）；`anon` 没有任何权限；Storage 附件在私有桶（第 11 章） |
| **最小权限的人员访问** | Dashboard 成员按需授权；生产数据库密码与 secret key 只在部署平台；组织账户开启多因素认证           |
| **凭据分离**           | 每个环境、每个后端组件独立的 key（第 8、12 章）                                                    |
| **日志**               | 不记录 key、token、签名 URL；避免把个人信息写进日志                                                |
| **保留期**             | 回收站 30 天后硬删除，附件文件随之删除（第 11 章）；备份按保留期过期                               |
| **删除请求**           | 见下文                                                                                             |

### 当用户要求删除账号

通过 Auth 管理 API（服务端，secret key）删除用户：`supabase.auth.admin.deleteUser(userId)`。Teamboard 的外键设计决定了接下来发生什么：

| 数据                                   | 结果                                    | 依据（第 4 章）                                      |
| -------------------------------------- | --------------------------------------- | ---------------------------------------------------- |
| `profiles`                             | 删除                                    | `on delete cascade`                                  |
| `memberships`                          | 删除；他负责的任务变为未指派            | `cascade` + `set null (assignee_id)`                 |
| 他创建的任务、写的评论、上传的附件     | 保留，作者列置空                        | `set null`                                           |
| 他上传的头像文件                       | 需要服务端显式删除 `avatars/{user_id}/` | Storage 不受外键约束                                 |
| 评论正文、任务标题中提到的他的个人信息 | **仍然存在**                            | 需要业务层面的决定（例如提供“删除我的所有评论”功能） |
| 备份中的数据                           | 直到备份过期才消失                      | 在隐私政策中说明保留期                               |

这张表说明了为什么**外键删除策略是隐私设计的一部分**，而不仅仅是技术细节。

## 13.10 事故处理速查

| 事故                   | 立即行动                                                            | 之后                                                       |
| ---------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| secret key 泄露        | 按第 8 章的四步轮换：创建新 key → 替换 → 确认 → 删除旧 key          | 查明泄露源；检查日志中是否有异常访问                       |
| 数据库密码泄露         | Dashboard 的 Database Settings 重置密码；更新所有使用它的部署与 CI  | 同上；考虑启用网络限制                                     |
| 误删了一个组织的数据   | **不要**急着整库回退；先评估影响范围                                | 恢复到新项目（或 PITR 到新项目），导出该组织的行，导入生产 |
| 错误的迁移破坏了数据   | 停止继续发布；评估是否能用新迁移修复（向前修复）                    | 无法修复时，权衡停机与数据丢失后执行恢复                   |
| 公开桶中发现了敏感文件 | 立即把文件移到私有桶或删除；把桶改为私有（如果整个桶都不应公开）    | 已被下载或被 CDN 缓存的内容无法收回，按数据泄露流程处理    |
| 签名 URL 泄露          | 删除或移动该文件（签名 URL 无法单独撤销，必要时联系 Supabase 支持） | 缩短签名 URL 有效期                                        |

## 13.11 本章练习

1. 你的项目在免费计划上。设计一个每天执行的备份方案：命令、存放位置、加密、保留期、谁能访问。
2. 某天 10:32 有人误执行了 `delete from public.comments where org_id = '...'`（漏写了 task 条件），10:50 才发现。项目开启了 PITR。给出恢复方案，尽量减少对其他组织的影响。
3. 为“新增 `tasks.description` 列”这次迁移写出发布前后的检查步骤。
4. 测试同学想要“和生产一样多”的数据来做性能测试。给出不接触真实个人信息的方案。
5. 为什么恢复逻辑备份时要设置 `session_replication_role = replica`？如果忘了会怎样？

### 参考答案

1. 由一台受控服务器（或 CI 定时任务）每天执行 13.3 的三条 `db dump` 命令（会话池连接串，密码来自密钥管理）；用 `gpg` 或对象存储的服务端加密保存到 Supabase 之外的存储桶，桶设置访问控制与生命周期规则（例如保留 30 天）；只有运维负责人能读取；每季度按 13.4 演练恢复。需要文件备份时另外用 S3 协议同步 Storage 桶。
2. 不要把生产整库 PITR 回到 10:31——那会丢失所有组织 10:31 之后的写入。正确做法：用 PITR 恢复到一个**新项目**的 10:31 时间点（或“恢复到新项目”功能），从中导出该组织 `comments` 的行（`copy (select * from public.comments where org_id = '...') to stdout`），导入生产；导入时注意 identity 列（使用 `overriding system value`）与外键依赖；完成后运行 13.6 的检查。
3. 发布前：确认备份/PITR；`db push --dry-run` 审阅；确认是可空列或常量默认值（只改元数据）；迁移设置 `lock_timeout`；记录行数快照。发布后：`migration list` 一致；运行验证查询（RLS、grant、不变量）；确认第 8 章的列级 grant 是否需要把 `description` 加入 `tasks` 的 update 列清单（否则客户端无法编辑，会出现 42501）；更新类型文件；冒烟测试。
4. 用 `generate_series` 或数据生成工具，按生产的**统计特征**（每个组织的平均任务数、状态分布、文本长度分布）生成虚构数据；统计特征可以从生产用聚合查询得到（只取计数和分布，不取明细）。
5. 导入数据时禁用触发器。忘了的话，Teamboard 的触发器会在导入时再次执行：`tasks` 的编号被重新分配（与导入的值冲突或被覆盖）、`auth.users` 的插入会尝试重复创建 profile（主键冲突导致整个恢复失败）、`updated_at` 被改成恢复时的时间、附件删除触发器可能写入清理队列。

## 本章验收

- [ ] 能说出 Supabase 每日备份与 PITR 的适用计划、保留期、RPO，以及“免费计划无自动备份、删除项目删除备份、不含 Storage 文件、不含自定义角色密码”。
- [ ] 能用 `supabase db dump` 做逻辑备份，知道备份文件的保管要求，知道如何备份 Storage 文件。
- [ ] 能描述三种恢复方式及各自的代价，能按官方步骤从逻辑备份恢复，并解释 `--single-transaction` 与 `session_replication_role`。
- [ ] 能执行一次恢复演练并测量 RTO。
- [ ] 能列出迁移前检查清单，并用验证查询完成迁移后检查。
- [ ] 能解释种子数据只用虚构数据的理由，能在隔离副本上完成脱敏。
- [ ] 能说明删除用户时各类数据的去向，以及外键策略与隐私设计的关系。

## 官方阅读

- [Supabase：Database Backups（每日备份、PITR）](https://supabase.com/docs/guides/platform/backups)
- [Supabase：Backup and restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase：Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)
- [Supabase：Seeding your database](https://supabase.com/docs/guides/local-development/seeding-your-database)
- [Supabase：Storage S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication)
- [Supabase：Delete a user（Auth Admin API）](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser)
- [PostgreSQL：Backup and Restore](https://www.postgresql.org/docs/current/backup.html)
- [PostgreSQL：session_replication_role](https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-SESSION-REPLICATION-ROLE)
