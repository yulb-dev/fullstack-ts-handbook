# 第 12 章：在业务层落实 workspace 隔离、RBAC 与资源归属

[上一章](./11-passwords-rate-limits-and-security-events.md) · [目录](./README.md) · [下一章](./13-organization-and-admin-boundaries.md)

现在认证链、安全 Cookie、邮件与限流都具备了。但如果 task API 只要已登录就返回所有任务，系统仍然有严重漏洞。本章完成 Harbor 的业务授权，是本教程从“登录演示”变成“安全接入”的关键一步。

## 12.1 先把权限写成表

| 动作                        | viewer | editor | admin | owner |
| --------------------------- | ------ | ------ | ----- | ----- |
| 读当前 workspace 任务       | 允许   | 允许   | 允许  | 允许  |
| 新建任务                    | 拒绝   | 允许   | 允许  | 允许  |
| 修改/删除自己的任务         | 拒绝   | 允许   | 允许  | 允许  |
| 修改/删除他人的任务         | 拒绝   | 拒绝   | 允许  | 允许  |
| 添加已有用户为成员          | 拒绝   | 拒绝   | 拒绝  | 允许  |
| 在另一 workspace 重用本角色 | 拒绝   | 拒绝   | 拒绝  | 拒绝  |

非成员全部拒绝。未登录先401；有效会话非成员返回404；有效成员没有动作权限返回403。404是产品的信息泄露政策，不是不用授权。

本文没有开放 owner 转让、成员角色变更、成员删除和 workspace 删除。这些动作需另外设计“不能删最后一个 owner”“不能自行提升权限”等约束，不从现有表结构推断它们已经安全实现。

## 12.2 为什么角色必须放在 membership 上

错误模型：

```text
user.role = admin
```

它回答不出 Alice 是 red 的 admin、blue 的 viewer 这类需求。

正确模型：

```text
workspace_memberships(workspace_id, user_id, role)
```

每个用户与 workspace 的关系有自己的角色。会话只提供 user.id，Service 再读取当前 membership。

认证账户、session 和 workspace 成员生命周期独立：移除 Alice 的 red 成员关系不一定撤销她登录 Harbor 的全部会话，她仍可能有 blue 的权限。

## 12.3 建立完整业务 schema

在 `src/db/app-schema.ts` 写：

```ts
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  boolean,
  timestamp,
  primaryKey,
  check,
  index,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const memberships = pgTable(
  "workspace_memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    check(
      "membership_role_check",
      sql`${t.role} in ('owner','admin','editor','viewer')`,
    ),
    index("membership_user_idx").on(t.userId),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    done: boolean("done").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("task_workspace_created_idx").on(t.workspaceId, t.createdAt, t.id),
  ],
);
```

逐条解释：

- 复合主键保证同一用户在同一 workspace 只有一条当前成员记录。
- FK 防止不存在的用户/工作区引用，不自动检查请求者是否有权。
- CHECK 限制存储角色集合；新增角色要显式迁移与政策变更。
- task 必须归属一个 workspace，不能依赖前端当前选中菜单。
- task.createdBy 引用稳定 user.id。此教程生成认证 user.id 是 text，不能擅自把 FK 改 uuid。
- 删除 task 创建者使用 restrict，要求先设计转交/保留策略；不因删账号把别人协作数据一并静默删除。

应用层授权和数据库约束互补，FK 不能判断“viewer 不能写”。

从零到本章后，重新 `drizzle-kit generate`，审阅新增业务表迁移并 migrate。配套工程已将它们纳入初始迁移。

## 12.4 第一步：每请求得到可信 actor

路由中：

```ts
const actor = await requireIdentity(req, reply);
const { workspaceId, taskId } = taskParams.parse(req.params);
const { done } = z.object({ done: z.boolean() }).strict().parse(req.body);
return svc.updateTask(actor.id, workspaceId, taskId, done);
```

`actor.id` 来自 Better Auth 验证，不接收请求体的 actorUserId。

`workspaceId`、`taskId` 仍是用户输入。UUID 格式校验只说明它们格式合法，不说明当前用户拥有它们。攻击者可以使用完全合法的 UUID。

`strict()` 让请求携带 `role`、`createdBy`、`workspaceId` 等额外更新字段时被拒绝。避免 `set(request.body)` 造成 mass assignment。

添加成员时 request.body.userId 是 **目标用户**，不是 actor。只有经过 owner 检查后才能使用它进行授予，两个角色不能混淆。

## 12.5 第二步：查询当前成员关系

完整 [services.ts](./example/src/services.ts) 有：

```ts
async function requireMember(
  db: Db,
  actorId: string,
  workspaceId: string,
  lock = false,
) {
  const query = db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, actorId),
        eq(memberships.workspaceId, workspaceId),
      ),
    );
  const [member] = await (lock ? query.for("share") : query);
  if (!member) throw new HttpError(404, "NOT_FOUND");
  const role = roleSchema.safeParse(member.role);
  if (!role.success) throw new HttpError(403, "FORBIDDEN");
  return role.data;
}
```

我们在业务层再次解释 role 值。未知角色默认拒绝，不写“不是 viewer 就可写”。数据库约束若因未来迁移变化，授权逻辑也不能自动赋权。

不从 session 里永久缓存 membership；否则管理员刚移除成员，旧会话可能继续有权。

## 12.6 第三步：把资源 scope 放进 SQL

不安全的流程：

```ts
const task = await findTaskById(taskId);
// 只检查 actor 在 URL 给定 workspace 是成员，没检查 task 在那个 workspace。
```

Alice 可以是 red 的 editor，却把 blue 的 taskId 填进 red URL。

正确条件：

```ts
const scope = and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, taskId));
```

读、更新、删除都带这个 scope。不是只有查找时带，更新时又只剩 id。

参数化条件还避免把 ID 拼进 SQL。随机 UUID 只是降低猜测，不替代权限检查。

## 12.7 第四步：RBAC 加 ownership

```ts
export function canEditTask(role: string, actorId: string, createdBy: string) {
  if (role === "owner" || role === "admin") return true;
  if (role === "editor") return actorId === createdBy;
  return false;
}
```

这个函数只表达已确认 workspace 成员之后的动作规则。不能把它单独应用到任意 task，然后忘记成员检查。

ownership 也不能变成万能通行证：viewer 即使是历史任务创建者仍不可写；被移除成员即使 createdBy 仍是自己也不能进入 workspace。

## 12.8 完成一个真正安全的修改事务

```ts
async function updateTask(
  actorId: string,
  workspaceId: string,
  taskId: string,
  done: boolean,
) {
  return db.transaction(async (tx) => {
    const role = await requireMember(tx, actorId, workspaceId, true);
    const scope = and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, taskId));
    const [task] = await tx.select().from(tasks).where(scope).for("update");
    if (!task) throw new HttpError(404, "NOT_FOUND");
    if (!canEditTask(role, actorId, task.createdBy)) {
      throw new HttpError(403, "FORBIDDEN");
    }
    const [updated] = await tx
      .update(tasks)
      .set({ done })
      .where(scope)
      .returning();
    return updated;
  });
}
```

这里 requireMember 的 `FOR SHARE` 使成员关系在该业务事务完成前不被并发 UPDATE/DELETE 改掉；task 的 `FOR UPDATE` 保护读取与修改的关系。所有操作传同一个 tx，不偷偷用全局 db。

它不等于绝对消除所有竞争：session 验证在业务事务前，系统级撤销不自动取消正在进行的操作。高风险流程可追加事务内状态检查/重新认证。

锁的设计也要一致：以后新增角色修改、资源转交等动作，应按统一锁顺序协调，避免死锁。PGlite 单进程测试能验证 SQL 与拒绝语义，不证明真实多连接锁竞争行为。

## 12.9 创建 workspace：不能留下没有 owner 的空壳

```ts
return db.transaction(async (tx) => {
  const [workspace] = await tx.insert(workspaces).values({ name }).returning();
  if (!workspace) throw new Error("workspace 写入失败");
  await tx.insert(memberships).values({
    workspaceId: workspace.id,
    userId: actorId,
    role: "owner",
  });
  return workspace;
});
```

owner 由可信业务流程赋予，不从注册 body 中接受。成员插入失败时 workspace 一起回滚。

创建 task 同样先验证当前成员，viewer 被拒绝；`createdBy=actorId`、`workspaceId=URL 验证后的 scope` 都由服务端设置，不允许前端传归属。

## 12.10 列表也必须授权

越权不只发生在 update。列表、搜索、统计、附件下载、导出都可能泄露租户数据。

列表核心：

```ts
return db
  .select({
    id: tasks.id,
    title: tasks.title,
    done: tasks.done,
    createdBy: tasks.createdBy,
  })
  .from(tasks)
  .innerJoin(
    memberships,
    and(
      eq(memberships.workspaceId, tasks.workspaceId),
      eq(memberships.userId, actorId),
    ),
  )
  .where(eq(tasks.workspaceId, workspaceId))
  .orderBy(desc(tasks.createdAt), desc(tasks.id))
  .limit(50);
```

前置 requireMember 能为非成员返回404；JOIN 在实际读数据时再次限定当前成员，避免“检查后成员被删除”的读窗口仍返回旧列表。

教学列表最多50条且顺序稳定，不是完整生产分页 UI。扩展游标分页时，游标也不能覆盖 workspace 条件；查询 key、导出任务参数、统计缓存都需要包含租户 scope。

## 12.11 添加成员不是自助加入

本文只有 owner 能向自己的 workspace 添加一个 **已经存在的 user ID**，目标 role 限定 `admin/editor/viewer`，不通过此入口创建另一个 owner。

这个接口没有邀请 token、发送邮箱、接收确认与过期流程。它是学习“授予必须由有权者执行”的入口，不是生产邮件邀请系统。下一章讲 Organization 插件时会说明如何替换。

“我在表单里填写了 workspaceId”不能成为加入理由。也不能允许普通用户发 `role:"owner"` 自己升级。

## 12.12 把这些规则接回全部 API

最终 [app.ts](./example/src/app.ts) 的每条业务路由都调用 requireIdentity，并把 actor.id 传给 Service。完成后开放：

```text
GET    /api/me
GET    /api/workspaces
POST   /api/workspaces
GET    /api/workspaces/:workspaceId/tasks
POST   /api/workspaces/:workspaceId/tasks
PATCH  /api/workspaces/:workspaceId/tasks/:taskId
DELETE /api/workspaces/:workspaceId/tasks/:taskId
POST   /api/workspaces/:workspaceId/members
```

接入其他调用入口（队列、脚本、管理后台）时也不能绕开 Service 授权。某个内部任务确实需要系统身份，就单独定义受控操作、审计与 scope，而不是伪装成任意用户 ID。

## 12.13 练习：手工证明管理员没有跨租户特权

Alice 创建 red，Bob 创建 blue。Alice 把 Bob 加进 red 为 admin。Bob 能改 red 中 Alice 的任务，这符合规则。

然后把 blue 的 taskId 放进 red URL，用 Bob session 修改。必须404，且 blue task 不改变。再用 Alice session 请求 blue 的真实 URL，也必须404。

这个案例同时验证：角色的租户范围、URL 参数组合、资源归属与管理员行为。只测“admin 可以更新”不够。

## 12.14 本章验收

- [ ] 成员角色按 workspace 保存，已登录不自动有权。
- [ ] actor ID 来自每请求会话验证，不来自 body。
- [ ] 每条资源 SQL 有 workspace scope。
- [ ] editor ownership 与 viewer 拒绝符合权限表。
- [ ] 非成员、换 workspaceId、管理员跨租户都被拒绝。
- [ ] 创建 workspace 与 owner 是一个事务。

官方阅读：[Organization Access Control](https://better-auth.com/docs/plugins/organization)、[Database Additional Fields](https://better-auth.com/docs/concepts/database)、[API](https://better-auth.com/docs/concepts/api)。SQL 与事务补充：[Drizzle Select](https://orm.drizzle.team/docs/select)、[Transactions](https://orm.drizzle.team/docs/transactions)。本章的 workspace 表、权限矩阵与 Service 是应用负责的业务授权，不由 Better Auth 自动生成。
