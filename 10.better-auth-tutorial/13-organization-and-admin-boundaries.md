# 第 13 章：何时使用 Organization / Admin 插件，权限不能因此失去边界

[上一章](./12-workspace-rbac-and-ownership.md) · [目录](./README.md) · [下一章](./14-migrations-and-upgrades.md)

Harbor 已经有 workspace membership。Better Auth 也提供 Organization 与 Admin 插件。是不是应该马上再装一份？本章先判断职责，再做一个有边界的扩展练习，避免两套成员表和多个“admin”含义互相冲突。

本章插件代码是 **替换/扩展路线**，未默认启用在配套 Harbor 工程中。第 12 章的自有 membership 是完整主线，不需要安装插件才能学会租户授权。

## 13.1 三种 owner/admin 不要混用

| 身份                         | 能力范围                                              |
| ---------------------------- | ----------------------------------------------------- |
| Harbor workspace owner/admin | 当前 workspace 的业务资源                             |
| Organization owner/admin     | Organization 插件维护的组织管理资源及自定义声明的动作 |
| Admin 插件的全局 admin       | 管理用户、封禁、会话等平台级动作                      |

平台 admin 并不天然取得某条 task 的业务访问权。若产品要允许平台客服读取客户内容，应该建立显式高风险操作、理由、审计与最小权限，不在 task Service 中加一个隐藏的全局 bypass。

也不要把普通用户的 `name="admin"`、邮箱包含 admin、前端传 role，作为平台管理员身份。

## 13.2 什么需求适合 Organization 插件

当你需要标准组织创建、成员邀请、成员角色管理、团队等能力，Organization 插件可以减少自己实现安全流程的工作。

但只有一个简单的自有 workspace/member/task 模型时，不要求必须替换。选择标准插件意味着接受它的表结构、端点、角色语义与升级边界。

关键原则：**成员资格的事实来源只能有一个。**

错误做法：登录页认插件 member，task API 认自有 workspace_memberships；其中一套删了成员，另一套仍允许访问。

正确扩展应选择：

```text
主线 A：保留自有 memberships，按业务需求维护安全流程。
路线 B：Organization member 作为成员事实源，task 关联 organization，迁移自有关系。
```

临时迁移可能双写，但要有一致性校验和截止时间，不长期让两者各自说了算。

## 13.3 最小安装与客户端对应

服务端在原 auth 的 plugins 中加入：

```ts
import { organization } from "better-auth/plugins";

plugins: [organization()];
```

客户端对应：

```ts
import { createAuthClient } from "better-auth/client";
import { organizationClient } from "better-auth/client/plugins";

const authClient = createAuthClient({
  baseURL: "http://localhost:4000",
  fetchOptions: { credentials: "include" },
  plugins: [organizationClient()],
});
```

两侧都安装并使用匹配版本。加入插件后重新生成 schema、审查迁移并应用，不能仅复制 plugins 配置就上线。

生成结果通常新增 organization、member、invitation，以及对应配置启用的 team 等数据，session 也可能增加 activeOrganizationId 等字段。以 **你实际配置的生成输出** 为准。

## 13.4 默认角色不等于 Harbor 的角色表

官方默认 owner、admin、member 管理 organization/member/invitation 等资源。默认 member 没有创建、修改、删除管理资源的能力。

插件不会因为你恰好也有 `tasks` 表，就自动决定“editor 只能改自己的 task”。你必须定义 task 动作，并在业务资源层验证 scope 和 ownership。

可以建立自定义 access controller：

```ts
import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  ownerAc,
  adminAc,
  memberAc,
} from "better-auth/plugins/organization/access";

export const ac = createAccessControl({
  ...defaultStatements,
  task: ["read", "create", "updateOwn", "updateAny", "deleteOwn", "deleteAny"],
} as const);

export const roles = {
  owner: ac.newRole({
    ...ownerAc.statements,
    task: [
      "read",
      "create",
      "updateOwn",
      "updateAny",
      "deleteOwn",
      "deleteAny",
    ],
  }),
  admin: ac.newRole({
    ...adminAc.statements,
    task: [
      "read",
      "create",
      "updateOwn",
      "updateAny",
      "deleteOwn",
      "deleteAny",
    ],
  }),
  member: ac.newRole({ ...memberAc.statements, task: ["read"] }),
  editor: ac.newRole({ task: ["read", "create", "updateOwn", "deleteOwn"] }),
  viewer: ac.newRole({ task: ["read"] }),
};
```

再把 `{ ac, roles }` 同时传给 `organization(...)` 和 `organizationClient(...)`。

这里保留了默认组织管理权限；如果你要完全复制 Harbor“只有 owner 添加成员”的规则，还需明确重定义 admin 的 `member`/`invitation` 权限。不能因为 task 动作一样就宣布两套系统语义完全相同。

官方提醒：用自定义角色覆盖默认 owner/admin 时，默认权限不会自动合并，必须有意识地合并或重新声明。只给 admin 一个 task 数组可能意外丢失管理能力。

## 13.5 在后端按目标 organization 检查权限

```ts
const result = await auth.api.hasPermission({
  headers: authHeaders(request),
  body: {
    organizationId: targetOrganizationId,
    permissions: { task: ["create"] },
  },
});
if (!result.success) throw new HttpError(403, "FORBIDDEN");
```

即使插件检查通过，task SQL 仍要：

```text
WHERE task.id = :taskId
  AND task.organization_id = :targetOrganizationId
```

`updateOwn` 是你声明的权限名，不会自动把 SQL 限制到 `createdBy=actor.id`。你必须结合资源实际归属判断；`updateAny` 也只在目标组织内成立。

UI 的 `checkRolePermission` 适合决定按钮展示，不访问服务端，也不包含全部动态角色状态；它不是 API 授权。动态权限需要按官方 hasPermission 等服务器检查，并仍考虑资源 scope。

## 13.6 activeOrganizationId 是选择状态，不是独立授权证据

产品常让用户在侧栏选择当前组织。session 中的 `activeOrganizationId` 能表达选择，但权限验证还要读取当前成员和目标资源关系。

不要仅因为请求中的 active ID 与 task ID 一起出现，就认为 task 归属于该组织。也不要在多标签页并发切组织时，忽略请求显式目标：red tab 与 blue tab 的请求必须各自保留 scope。

需要使用 active organization 作为默认值时，按插件文档验证成员；关键业务接口建议明确指定目标 organizationId，并检查它与资源一致。

## 13.7 真正的邀请闭环

Organization 插件邀请不是“把邮箱 INSERT 到 member”。需要发邀请、接受身份、有效期限与授予规则。

服务端配置示意：

```ts
organization({
  requireEmailVerificationOnInvitation: true,
  sendInvitationEmail: async (data) => {
    dispatchMail(send, {
      to: data.email,
      subject: "Harbor 组织邀请",
      text: `${env.WEB_ORIGIN}/accept-invitation?id=${encodeURIComponent(data.id)}`,
    });
  },
});
```

然后创建实际 `/accept-invitation` 页面：读取 invitation ID，要求用户登录并满足邮箱验证政策，再调用：

```ts
await authClient.organization.acceptInvitation({ invitationId });
```

完整验收顺序：有权成员发邀请 → 指定邮箱收到真实邮件 → 正确用户接受 → 成员关系产生 → 新权限生效；另测错误账号接受、过期/取消邀请、重复接受、越权邀请 admin/owner。

不要在自有 API 根据前端传 `invitationId` 就直接发角色，而绕过插件的接受检查。链接携带 ID 也可能泄露，注意日志与邮件队列访问。

## 13.8 添加 Admin 插件前先列清楚能力

Admin 插件可管理用户、角色、封禁、撤销用户会话，及按配置提供 impersonation 等高风险能力。

最小启用为：

```ts
import { admin } from "better-auth/plugins";
plugins: [admin()];
```

但这不是完整运维方案。先明确谁可获得平台 admin、审批/撤销过程、MFA、新鲜认证、可访问数据范围与审计。Impersonation 尤其要有理由、可追溯身份与终止流程，不能当普通“调试方便”。

首次管理员可使用当前官方 `auth create-admin`。它要求 Admin 插件和持久数据库，通过受支持的服务器 API 创建并哈希密码；密码应安全输入，不出现在 shell history 或 CI 日志中。不在教程中提供一条把明文生产口令写到参数的命令。

普通注册不能自行设置全局角色。安全敏感 additionalFields 必须 `input:false`，并把“可返回”和“可输入”分别配置；不要因 mapper 在服务器运行就把 provider role 当成内部权限。

## 13.9 插件给注册反枚举带来的新测试

插件可能为 user 增加 role、banned、twoFactorEnabled 等字段。注册重复邮箱的 synthetic response 与真实新用户 response 如果不同，会再度暴露账号存在性。

当前文档提供 `customSyntheticUser` 来保持一致结构。每加入一个相关插件，都重新检查用户字段顺序、默认值、response shape 与状态；不能只断言“重复注册也是200”。

不要把默认 admin role 改成 admin 让所有新用户“方便进入管理页”。最小权限默认应是普通用户，没有角色授予就没有管理能力。

## 13.10 扩展练习与验收

练习：将 Harbor 改为 Organization member 事实源。先写迁移对照：workspace → organization、memberships → member、task.workspaceId → organizationId、各角色映射与访问测试。不要先启用两个插件再猜数据如何同步。

参考判断：保留 task 业务表与 ownership 规则；切换成员事实源后删除重复授权判断，按目标组织服务器验证，再验证 task scope。迁移期测试必须证明两套读取不会产生权限差异。

- [ ] 不混淆 workspace admin 与平台 admin。
- [ ] 插件与业务成员表只有一个权威事实来源。
- [ ] 自定义权限同时配置服务器与客户端。
- [ ] hasPermission 不替代 task 的 organization scope 与 ownership。
- [ ] 邀请、管理员创建、角色输入与审计都有真实流程边界。

官方阅读：[Organization](https://better-auth.com/docs/plugins/organization)、[Admin](https://better-auth.com/docs/plugins/admin)、[CLI](https://better-auth.com/docs/concepts/cli)、[Database](https://better-auth.com/docs/concepts/database)。本章扩展未被默认示例启用，不列入已运行的主线测试结果。
