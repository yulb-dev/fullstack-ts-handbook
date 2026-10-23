# 第 1 章：先分清“你是谁”“如何记住你”“你能做什么”

[目录](./README.md) · [下一章](./02-setup-and-first-instance.md)

假设你正在写一个协作工具。用户登录后能进入 workspace，在里面创建 task。你熟悉 React，于是先做了一个登录页：输入邮箱、密码，请求成功后把 `isLoggedIn` 放进 Zustand，再显示工作台。

界面似乎好了。但如果有人不打开你的页面，直接发送 `PATCH /api/workspaces/b/tasks/a`，服务器应该相信谁？浏览器上的 `isLoggedIn` 能证明身份吗？用户 A 登录成功后，可以修改 workspace B 的任务吗？

这三个问题，是本教程真正的起点。我们将从空项目做出 **Harbor 协作工具**，把认证接进 Fastify 与 Postgres，同时亲手阻止跨 workspace 访问。不是先背 API 名称，再猜如何组合。

## 1.1 认证回答“你是谁”

Authentication 是验证身份声明。例如来访者说：“我是邮箱 alice@example.com 对应的用户。”

只交一个邮箱不能证明这件事。服务器需要验证凭证：

- 邮箱密码：检查输入密码是否与服务器保存的密码哈希匹配。
- OAuth / OIDC 登录：通过受保护的协议流程，从可信提供方获得身份信息。
- Passkey 等：使用对应协议验证持有的密钥。

认证成功后的结果是一个稳定身份，例如 `user.id = "u_alice"`。不是“这个用户已经成为所有组织的管理员”。邮箱和显示名可能改变，因此资源归属通常引用稳定 `user.id`，不要用显示名关联任务。

Better Auth 帮我们实现认证流程、凭证处理、用户与账户数据、会话管理等。它是放在你的服务端的 TypeScript 库；不是把密码交给浏览器自行判断，也不意味着所有运维工作被托管了。

## 1.2 会话回答“这次请求是否仍由已认证的来访者发出”

HTTP 请求彼此独立。服务器不能仅因上一条请求成功登录，就知道下一条请求来自谁。

会话 Session 把多条请求关联起来：

```text
1. 浏览器提交邮箱和密码。
2. Better Auth 验证凭证。
3. 服务器保存 session：关联 userId、到期时间等。
4. 响应 Set-Cookie，浏览器保存一个会话标识。
5. 后续请求自动携带 Cookie。
6. 服务器验证 Cookie 和会话有效性，得到 user.id。
```

这里的 Cookie 是凭证载体；服务器上的 session 是会话状态。本教程使用 Postgres 持久化会话，不使用无数据库的 stateless 模式。

把 cookie 想成旅馆房卡更容易理解：卡片不是你的完整履历；接待系统根据有效卡片找到对应住客。卡片过期、撤销，或者根本不是系统签发的，就不能继续使用。

重要区别：**客户端有 Cookie，不代表服务器会话仍有效。** Cookie 可以尚未被浏览器清理，但服务器记录已经过期或被撤销。反过来，服务器仍有记录，浏览器没发 Cookie，这次请求也不能自动获得身份。

## 1.3 授权回答“你能对这个对象做这个动作吗”

Authorization 必须带上对象和动作。只问“是不是管理员”往往还不够。

```text
主体：Alice
动作：修改 task
资源：task-7
资源所在租户：workspace-red
当前成员关系：Alice 是 workspace-red 的 viewer
结论：拒绝
```

Alice 可以正常登录，但 viewer 是只读角色。登录成功不改变这一规则。

再看 Bob：他是 workspace-blue 的 admin。Bob 对 workspace-blue 拥有管理能力；这不能自动让他访问 workspace-red。

权限判定可以写成心智模型：

```text
允许 = 会话有效
    AND 当前仍是该 workspace 的成员
    AND 当前角色允许这个动作
    AND 资源确实属于请求中的 workspace
    AND 满足资源归属等额外规则
```

任何一项不成立，就拒绝。稍后我们用真实 SQL 和测试实现它，不把这句话停留在标语上。

## 1.4 我们要做出的完整业务闭环

Harbor 的规则固定如下，避免写到后面临时猜权限：

1. 邮箱密码注册后必须验证邮箱，再登录。
2. 用户可创建 workspace；创建者得到该 workspace 的 `owner` 成员记录。
3. 一个用户可以属于多个 workspace，在每个 workspace 有不同角色。
4. `viewer` 可以读任务，不能新增、修改、删除。
5. `editor` 可以创建任务，只能修改或删除自己创建的任务。
6. `admin`、`owner` 可以修改、删除该 workspace 的所有任务。
7. `owner` 可以添加成员；本文不开放角色变更、owner 转让与删除 workspace 的业务入口。
8. 不是成员时，对 workspace 内部资源返回 404，避免泄露存在性。
9. 管理员不跨租户绕过规则。平台运维管理员与 workspace admin 是两种身份。
10. 每条业务请求重新验证会话并读取成员关系，不相信客户端传来的角色。

角色不是有大小顺序的整数。我们会逐项列出允许的动作，而不是写 `role >= 2`。这使添加一个新角色时默认不会意外获得权限。

## 1.5 从前端视角理解服务端边界

下面的三段代码都不能当作安全措施：

```ts
// 这是 UI 状态，不是身份凭证。
if (store.isLoggedIn) showWorkspace();

// 这是交互体验，不是后端授权。
if (role !== "admin") hideDeleteButton();

// 这是攻击者能修改的输入，不是可信 userId。
fetch("/api/tasks", { body: JSON.stringify({ userId, role: "admin" }) });
```

隐藏按钮仍有价值：减少误操作，让只读用户理解限制。但后端必须在不依赖页面的情况下独立拒绝请求。

我们采取这样的流向：

```text
浏览器 UI
  → 带 Cookie 的 HTTP 请求
  → Fastify：解析与校验请求
  → Better Auth：验证会话
  → 业务 Service：以可信 user.id 检查成员、角色、归属
  → Drizzle：执行带 scope 的参数化 SQL
  → Postgres：维护外键、唯一约束与事务
```

UI、认证库、业务层、ORM、数据库各做一段工作。没有任何一层可以包办全部安全。

## 1.6 认识四个容易混淆的词

| 词         | 本文含义                                  | 不是什么                       |
| ---------- | ----------------------------------------- | ------------------------------ |
| User       | Harbor 中的稳定用户身份                   | 每登录一次就新建的对象         |
| Account    | 用户关联的登录方式，如 credential、GitHub | workspace 成员记录             |
| Session    | 一次登录建立的可到期、可撤销状态          | 永久权限列表                   |
| Membership | 用户与特定 workspace 的当前关系和角色     | “邮箱后缀相同，所以自动是成员” |

一个 User 可以有多个 Account，也可以有多个 Session。Membership 独立于它们：从 workspace 移除用户，不一定需要把他的整个账号删除；他可能还属于另外一个 workspace。

## 1.7 为什么本教程不先发 JWT？

Cookie 与 JWT 不是同一维度：Cookie 是浏览器保存和发送数据的机制，JWT 是一种 token 格式。JWT 完全可以放在 Cookie 里。

本项目的需求是浏览器访问同一产品的后端，需要撤销会话，并希望成员关系的变化及时生效。数据库会话是容易解释与验证的起点。Better Auth 默认的主会话 Cookie 是不透明的、经过签名的会话标识，不是让你自己解码并拿出 `role` 的业务 JWT。

后面会说明 cookie cache 的取舍；我们起步时关闭它。这样，被撤销的 session 在下一条受保护请求中从数据库验证失败，不会因为缓存里的旧状态继续通过。

## 1.8 第一份练习：判断谁来负责

尝试先回答，再看下面的参考判断。

1. 密码错误，谁拒绝？
2. session 已过期，但客户端仍显示工作台，谁拒绝 API？
3. session 有效，task 属于另一 workspace，谁拒绝？
4. 创建 workspace 时插入 workspace 成功、插入 owner 失败，谁保证不留下半成品？
5. 用户在浏览器改 `role`，为什么不能生效？

参考判断：

1. Better Auth 的认证流程拒绝凭证。
2. 服务端每请求验证会话；UI 应处理 401 并更新状态，但 UI 不是裁判。
3. 业务层验证租户 scope 与资源关系。
4. Service 使用数据库事务，Postgres 保证共同提交或回滚。
5. 角色来自数据库成员记录，不来自请求体；输入白名单也不接受角色伪造。

## 1.9 本章验收

- [ ] 能不用“token”这个词解释认证、会话、授权分别解决什么。
- [ ] 能解释为何“Bob 是 admin”缺少租户范围。
- [ ] 能画出一条受保护请求的完整信任链。
- [ ] 知道前端登录状态与隐藏按钮不构成服务器授权。

官方阅读：[Introduction](https://better-auth.com/docs/introduction)、[Basic Usage](https://better-auth.com/docs/basic-usage)、[Session Management](https://better-auth.com/docs/concepts/session-management)、[Database](https://better-auth.com/docs/concepts/database)。Harbor 的权限规则是本教程的业务设计，不是 Better Auth 自动赋予的规则。
