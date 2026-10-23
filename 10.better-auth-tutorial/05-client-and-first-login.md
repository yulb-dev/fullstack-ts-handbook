# 第 5 章：做出注册、验证、登录、退出的第一条完整请求链

[上一章](./04-fastify-handler-and-request-boundary.md) · [目录](./README.md) · [下一章](./06-session-lifecycle-and-revocation.md)

本章站回浏览器一侧。我们不自己保存 token，而是让 Better Auth 客户端与浏览器 Cookie 机制协作。完成后，你应该能观察一次登录的完整网络过程，解释刷新页面后为什么仍然能识别身份。

## 5.1 建立最小前端，不先引入界面复杂度

配套工程使用 Vite + 普通 TypeScript，文件是 [index.html](./example/web/index.html)、[main.ts](./example/web/main.ts)。不要求先写 React Router、表单库或全局 store。最后也给出 React 用法。

从零项目加上：

```bash
npm install -D --save-exact vite@7.3.7
```

在 `package.json` 加 `"web": "vite web --host 127.0.0.1 --port 5173 --strictPort"`，创建 `web/`，按链接建立这两个完整文件。后端与网页使用两个终端：

```bash
npm run dev
```

```bash
npm run web
```

在浏览器打开 **http://localhost:5173**。虽然开发服务器绑定本机回环地址，页面 origin 要和 `.env` 中的 `WEB_ORIGIN` 一致。不要直接双击 HTML 用 `file://` 打开，也不要临时使用 `127.0.0.1:5173`。

## 5.2 只在客户端创建 authClient

```ts
import { createAuthClient } from "better-auth/client";

const authClient = createAuthClient({
  baseURL: "http://localhost:4000",
  fetchOptions: { credentials: "include" },
});
```

`authClient` 是发起 HTTP 请求的客户端。`auth` 是服务端持有配置、数据库连接的实例。二者不能互相替代，更不能把服务端 `auth.ts` import 到 Vite 入口。

如果前后端分成两个项目，双方都安装匹配版本的 Better Auth。前端只需要公开 API 地址，不需要 secret、数据库 URL 或 GitHub client secret。

默认认证路径是 `/api/auth`。如果你改了服务端 basePath，客户端也必须匹配；官方允许使用包含自定义路径的完整 baseURL。本文保持默认路径，先减少变量。

## 5.3 注册时只传用户可写的信息

```ts
const { data, error } = await authClient.signUp.email({
  name: "Alice",
  email: "alice@example.com",
  password: "我自己选择的足够长的口令",
  callbackURL: "http://localhost:5173",
});
```

`name` 是显示名，`email` 是地址，`password` 经 HTTPS 在真实部署中送到服务端。客户端不预先做一层 SHA256 来“替代 HTTPS”：那层结果可能直接成为可重放凭证，仍然需要传输安全与服务器密码哈希。

`callbackURL` 是验证完成后返回的页面，不是发邮件地址，也不是 OAuth 提供方回调。

本文配置 `autoSignIn: false` 与 `requireEmailVerification: true`。所以注册响应成功 **不代表已经登录**。新账号创建后，显示“请查看验证邮件”，不要立即设置 `isLoggedIn=true`。

另外，重复邮箱注册会走反枚举响应，`data.user` 也不能拿来作为“这一定是真实新用户”的依据。主体身份只能在后端完成会话验证后确定。

## 5.4 第一次本地验证邮箱

`MAIL_MODE=local` 时，API 终端显示仅限开发的邮件预览，其中包括验证 URL。

跟做顺序：

1. 用一个新的测试邮箱注册。
2. 不验证，先尝试登录，应得到验证相关拒绝。
3. 在 API 终端找到该邮箱的验证邮件预览。
4. 打开邮件里的 **完整 URL**，不要自己拼 token 或截掉 query。
5. Better Auth 完成验证后跳回 5173 页面。
6. 再次提交正确密码，才应登录成功。

本地预览没有向真实邮箱发邮件，不能当作邮件交付成功的证据。第 9 章将切换到真实提供方并检查退信、域名和回调。

默认不在验证后自动登录，便于你看清“邮箱验证状态”和“建立会话”是两步。产品需要时可评估 `autoSignInAfterVerification`，不能只改 UI 假装已经有 Cookie。

## 5.5 登录后的响应和后续请求

```ts
const result = await authClient.signIn.email({
  email,
  password,
  rememberMe: true,
});
if (result.error) {
  // 显示脱敏错误；不要把输入密码写日志。
  return;
}
```

成功后立即请求自己的业务接口：

```ts
const response = await fetch("http://localhost:4000/api/me", {
  credentials: "include",
});
```

打开浏览器 Network / Application 面板进行观察：

- 登录请求 body 包含邮箱密码，但页面和业务日志不应该继续保存它。
- 响应有 `Set-Cookie`，Cookie 应由浏览器保存。
- `/api/me` 请求包含 Cookie。
- `/api/me` 返回当前用户的 ID、name、email，不是另一人的信息。
- 刷新页面后，不靠 localStorage 也能通过 `/api/me` 获取身份。

如果你看到登录 200、随后 `/api/me` 401，按第 7 章的链路排查 Cookie；不要先给所有业务接口开匿名访问。

## 5.6 credentials 是每个 fetch 的设置，不是全局魔法

Better Auth SDK 的 fetch 配置只影响它自己的请求。你直接调用 `fetch` 的 task API 仍然需要正确 credentials。

```ts
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`http://localhost:4000${path}`, {
    method,
    credentials: "include",
    ...(method === "GET"
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}
```

这是配套 [main.ts](./example/web/main.ts) 的请求包装核心；完整文件还会在 401 后清理个人与租户数据。

浏览器 Cookie 仍受 SameSite、Domain、Secure 与第三方 Cookie 限制。`credentials: "include"` 只是请求发送模式，不能强迫浏览器接受原本不合法的 Cookie。

## 5.7 React 项目怎样显示会话状态

如果你已有 React：

```tsx
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: "http://localhost:4000",
  fetchOptions: { credentials: "include" },
});

export function AccountArea() {
  const { data, isPending, error } = authClient.useSession();
  if (isPending) return <p>正在确认身份……</p>;
  if (error) return <p>暂时无法确认身份，请重试。</p>;
  if (!data) return <p>请登录。</p>;
  return <p>你好，{data.user.name}</p>;
}
```

“暂时无法确认身份”和“已确认未登录”不同。网络出错时直接显示“未登录”，可能造成抖动与错误重定向。

这个 hook 是 UI 数据源，不是服务器授权。用户移除某 workspace 后，UI 可能还短暂显示旧菜单，但业务请求应立即拒绝。不要把 `data.user` 序列化到 localStorage 后作为长期安全凭据。

若你使用 TanStack Query：查询 key 必须包含 workspace scope；退出或切换用户时取消正在进行的个人请求并清理用户专属缓存，避免新用户看到上一用户的结果。Cookie Session 管登录状态，Query 管服务器数据，两者职责不同。

## 5.8 退出不是把页面切回登录

```ts
const result = await authClient.signOut();
if (result.error) {
  // 服务器退出失败，不应声称会话已撤销。
  return;
}
```

正常退出会终止当前会话并通过响应清理相关 Cookie。然后 UI 清理用户与 workspace 数据。

只做 `store.user=null` 或删除 localStorage，攻击者保留的旧 Cookie 可能仍能使用。反过来，服务器撤销后，UI 缓存还可能显示用户名；这不意味着它还能调用业务 API。

当前版本 sign-out 在部分数据库失败路径会记录错误但仍清理浏览器 Cookie。对高风险“全部设备退出”与事故处置，不应只看页面提示；应验证服务端撤销结果与旧凭证重放行为。第 6、11 章解释撤销验收。

## 5.9 表单和页面也有自己的安全边界

配套页面使用 `textContent` 显示任务与用户资料，避免把用户输入作为 HTML 插入。HttpOnly 不能防止 XSS 代用户发请求，因此展示层仍要防注入。

密码输入使用合适 autocomplete，提交结束后清空；不把密码写入全局 store、URL query、控制台或分析事件。

表单按钮在提交期间禁用，降低重复注册与重复发送的概率。但并发与滥用防护仍必须在服务端完成。不能把按钮 disabled 当成限流。

## 5.10 练习与验收

练习：移除 **业务 fetch** 的 credentials，保留 SDK credentials。预测登录是否成功、`/api/me` 是否成功，再在本地验证。

参考：登录 SDK 仍可能成功；跨 origin 的直接业务请求默认不带该 Cookie，因此 `/api/me` 401。修复后再测。

- [ ] 能完成注册 → 本地邮件验证 → 登录 → 刷新身份 → 退出。
- [ ] 不把注册 200 当成已登录。
- [ ] 客户端与服务端实例没有互相导入。
- [ ] 没有把 token、密码、secret 放进 localStorage 或公开包。
- [ ] 会区分 pending、网络错误、未登录与已登录。

官方阅读：[Client](https://better-auth.com/docs/concepts/client)、[Basic Usage](https://better-auth.com/docs/basic-usage)、[Email & Password](https://better-auth.com/docs/authentication/email-password)。
