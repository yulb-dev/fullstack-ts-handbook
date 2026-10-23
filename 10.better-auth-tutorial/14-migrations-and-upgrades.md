# 第 14 章：认证表与业务表的边界，升级不能只改 package.json

[上一章](./13-organization-and-admin-boundaries.md) · [目录](./README.md) · [下一章](./15-testing-capstone-and-acceptance.md)

认证系统上线后，插件会增加表，版本可能改变列或索引，你自己也会加 task 字段。把所有 schema 文件塞到一个目录不会自动产生清晰边界。本章建立可审查的迁移链，并演练一次升级检查。

## 14.1 两种所有权，一条迁移历史

本教程约定：

```text
Better Auth 配置与官方 generator
  → 定义 auth-schema.ts 中所需认证模型

应用业务设计
  → 定义 app-schema.ts 中的 workspace/member/task

两者统一导出到 schema.ts
  → Drizzle Kit 生成 SQL
  → 同一条 Drizzle 迁移历史应用到 Postgres
```

“认证模型由 Better Auth 驱动”不等于“另一个工具也能偷偷改它”。本项目只用 Drizzle Kit 应用认证/业务表变更。

当然可以使用独立 schema namespace、独立迁移链等高级设计，但必须有清晰表所有权、执行顺序与跨 schema FK 规则。初学主线选一条历史，减少隐式竞争。

## 14.2 为什么生成文件单独放

如果把自己写的 task 表混进 Better Auth CLI 的 output 文件，重新 generate 时可能覆盖它。

如果在生成 user 表里随意加一个 NOT NULL 没默认值的业务列，Better Auth 注册时不写该列，就可能失败。

正确选择：

- 真正的认证 additionalFields 在 Better Auth 配置中声明，然后生成。
- workspace 业务数据放自有表，通过 user.id 引用。
- 有理由定制表名/列名时，在 adapter schema mapping 与 auth config 中保持一致。
- 生成结果经过代码审阅，不认为 generator 输出免于工程审查。

数据库默认值、JS `$onUpdate` 与 Better Auth additionalFields.defaultValue 不全是同一种机制。不要仅因 TypeScript 看起来有默认就认为外部 SQL INSERT 会自动填值。

## 14.3 记住三条不同证据

| 检查                 | 能证明                                    | 不能证明                             |
| -------------------- | ----------------------------------------- | ------------------------------------ |
| TypeScript typecheck | 源码类型与当前 API 基本匹配               | 数据库真实结构已更新                 |
| `auth check schema`  | adapter 配置的模型能容纳 Better Auth 写入 | Drizzle 的真实数据库迁移已应用       |
| 迁移与数据库集成测试 | 实际 schema/运行行为                      | 生产代理、邮件、浏览器和全部故障场景 |

当前运行时 schema validation 默认启用。Kysely 读真实元数据；Drizzle 校验配置的 schema 对象；Prisma 校验客户端模型。Drizzle 本地对象正常时，线上缺列仍可能请求失败。

因此不能因为 `auth:check` 成功就省略 db:migrate，也不能把启动打印正常当成 CI 的全部验收。

## 14.4 升级前先留下比较基线

在升级分支记录：

1. `better-auth`、同步官方 adapter 包、`auth` CLI 的确切版本。
2. 已启用插件与 provider 配置。
3. 生成 schema 与迁移历史，生产已应用到哪份迁移。
4. 当前会话与 Cookie cache/secondary storage 策略。
5. 目标版本的官方升级文档与安全公告。
6. 可恢复备份与已演练的恢复流程。

不要在生产进程启动时自动下载 `auth@latest` 并迁移。构建、审核、迁移执行与应用运行应是受控阶段。

## 14.5 生成到独立候选文件

例如审查当前 1.7.12 配置重新生成的结果：

```bash
npx auth@1.7.12 generate --config ./src/auth-schema.config.ts --output ./src/db/auth-schema.next.ts --yes
```

比较 `auth-schema.next.ts` 与现有 `auth-schema.ts`，确认新增列、索引、FK、relations 与自定义映射。

这个候选文件不要从统一 `schema.ts` 再导出一遍，否则 Kit 可能看到重复表对象。审查后用候选定义更新正式生成文件，再由 Kit 创建新 migration。候选文件最终移出参与构建/生成的路径，保留审查记录即可。

配套脚本 `auth:generate` 直接更新正式生成文件，适合初建；升级审阅先用上面的独立 output 流程，不盲目覆盖。

在新目标版本升级时，把命令版本改为已批准且与库匹配的目标版本，同时更新同步发布的官方包。不要把当前 CLI 生成结果拿去给不匹配的旧运行库使用。

## 14.6 审阅 SQL：不要只看“新增了一个文件”

执行 `drizzle-kit generate` 后检查：

- 有没有意外 DROP、rename 被识别成删建。
- 新 NOT NULL 列是否需要回填，已有数据能否通过。
- 新 unique 索引是否存在历史重复。
- 用户 ID 与所有 FK 是否一致，不能突然从 text 改成 uuid 而漏掉业务引用。
- 日期精度、时区与 defaults 是否变化。
- 插件新增权限字段是否允许用户输入。
- 执行锁定时间、索引构建方式与应用兼容顺序。

很多迁移不是“执行一个 SQL 文件就完事”。大表回填、并发索引、分步约束需要按 Postgres 机制拆成受控操作，不在日常启动流里一并执行。

## 14.7 一个真实版本教训：1.7.0—1.7.2 的 account issuer

官方 1.7 升级文档说明：1.7.0—1.7.2 曾要求 account 的 issuer 列；1.7.3 移除了这一要求，身份仍由 providerId/accountId 识别。

如果你真正跑过那几版迁移，数据库可能保留了一个运行时不再填写的 NOT NULL issuer，导致注册或关联失败。只升级库并重新生成当前 schema，不代表这段历史自动清理好了。

根据你的物理映射做元数据检查。本文使用 snake_case 列：

```sql
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'account'
ORDER BY ordinal_position;
```

没有 issuer 就不用执行它的特殊清理；有则按官方版本范围和迁移历史审查 constraint/index 处理。不要对所有用户执行一份“不管存不存在都删列”的脚本。

升级还应检查重复身份键：

```sql
SELECT provider_id, account_id, count(*)
FROM account
GROUP BY provider_id, account_id
HAVING count(*) > 1;
```

用你自己的表/列名。出现重复时不能随意把不同用户合并；先识别 provider 命名冲突与历史数据原因。当前框架对歧义身份查询的拒绝不等于它已经替你安全修复了历史重复。

## 14.8 发布顺序：先考虑新旧应用共存

新增可兼容列/表通常可以先迁移，再发布应用；破坏性变化需要 expand-contract：

```text
expand：新增兼容结构，旧应用仍能运行
migrate：受控回填数据，并校验数量与约束
switch：新应用读写新结构，观察错误与安全行为
contract：确认不再有旧实例后清理旧结构
```

如果插件/协议升级要求参与服务同时切换，必须按官方要求协调，不仅考虑 SQL。OAuth state 加密格式、代理 payload、SSO 等可能在登录流程尚未完成时跨版本不兼容。

计划中写清楚：是否允许旧会话继续、是否要求重新登录、pending callback 是否要重启流程。不能对用户承诺“所有登录中流程无影响”却没检查密钥与格式变化。

## 14.9 回滚应用不等于回滚数据库

新应用已经写入新结构后，退回旧二进制可能不认识数据；删除列也可能永久丢失信息。遇到失败优先有明确的 forward fix 与恢复策略，不认为 ORM 会生成安全逆操作。

认证数据尤其要保护：恢复旧备份可能恢复已经撤销的 session、旧密码/绑定数据、已消费恢复 token。这可能产生安全倒退。

恢复之后需要重新评估会话、密钥、验证 token、审计与用户通知政策。备份恢复既是可靠性问题，也是认证安全问题。

## 14.10 Relations v1 与 v2 的边界

本文使用稳定 Drizzle 0.45.4 + 默认 adapter，生成 `relations()`。

如果改用 Drizzle 1.0 RC / Relations v2，当前官方路线为：

```ts
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
```

生成 v2 auth relations 后，按官方说明把 auth relation parts 放在应用完整 relations 后合并：

```ts
const db = drizzle({
  client,
  relations: { ...appRelations, ...authRelations },
});
```

这只是说明目标路线，不是让你在本文 .45.4 上复制它。切换关系表示本身不一定改变物理表，但仍要审查 schema diff；“无 SQL 变化”与“运行时代码完全兼容”不是同一结论。

RC 是候选版，不是稳定正式版；在生产切换时单独评估。不要把不同版本关系代码拼在一起，再通过 any 消除类型错误。

## 14.11 数据库权限与迁移执行者

运行应用的数据库角色不应长期拥有建表/删表等所有 DDL 权限。部署阶段用受控迁移角色执行，运行角色只得到必要数据访问权。

这样能减少事故面，但不取代业务授权：应用的数据库角色可能能读多个 workspace，Service 仍必须带 scope。若使用 Postgres RLS 做额外防线，也要明确每请求租户上下文、连接池状态与 ORM/认证访问路径，不声称“用了 Postgres 就自动有 RLS”。

连接池、TLS、数据库备份与可观测设置都属于接入工作，不由 schema generate 完成。

## 14.12 升级演练与验收

在临时分支给认证用户加一个普通 locale 字段，设置允许输入与默认值；生成候选 schema、检查 diff、创建迁移、在空库和已有学习数据的库上应用，再测试注册/登录/权限。

随后把权限敏感字段作为反例：若加 platformRole，应 `input:false`，不让注册或 provider profile 写入。比较这两种字段的输入职责。

- [ ] 认证生成文件与业务 schema 分开，迁移事实源明确。
- [ ] 升级先比较 generator 输出，再审查 SQL。
- [ ] 类型检查与本地 schema check 不被误当成线上迁移证明。
- [ ] 检查历史重复、NOT NULL、ID/FK 与协议兼容。
- [ ] 备份恢复与回滚考虑会话/恢复 token 的安全倒退。

官方阅读：[CLI](https://better-auth.com/docs/concepts/cli)、[Database](https://better-auth.com/docs/concepts/database)、[Drizzle Adapter](https://better-auth.com/docs/adapters/drizzle)、[1.7 Upgrade Guide](https://better-auth.com/docs/guides/1-7-upgrade-guide)、[Security](https://better-auth.com/docs/reference/security)。
