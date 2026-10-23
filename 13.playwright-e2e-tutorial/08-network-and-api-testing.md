# 第 8 章：网络、mock 与 API 测试

> 本章目标：掌握 Playwright 的两组网络能力——「主动发请求」的 `request` fixture（造数、断言 API 契约）与「拦截改请求」的 `page.route`（注入故障、mock 第三方）；并建立清晰的边界感：E2E 里什么该 mock、什么绝不能 mock。
>
> 对应总目标：**使用 API/setup 准备测试数据，但真正的 E2E 仍要通过 UI 验证用户可观察行为；网络失败、权限失败的测试。**

---

## 8.1 两条通道：发请求 vs 拦请求

Playwright 测试里的网络能力分两组，方向相反，别混：

```
① request fixture（APIRequestContext）
   测试代码 ──HTTP──▶ 服务器          测试自己当客户端发请求（带页面同款 cookie）

② page.route / context.route
   页面 ──HTTP──▶ [拦截点] ──▶ 服务器   拦截「页面发出的」请求，可篡改/伪造/掐断
```

## 8.2 request fixture：测试自己的 API 客户端

第 5 章埋的伏笔在这里揭晓：`request` fixture 是独立于页面的 HTTP 客户端，**默认继承 baseURL 与 storageState**——alice 的页面登录了，`request` 发的请求自动带 alice 的 cookie。这让它成为造数与 API 断言的利器。

### 用法一：测试前造数（快）

```ts
// tests/fixtures.ts —— example 的 seed fixture（第 5 章已见）
createTask: async ({ title, status = 'todo' }) => {
  const res = await request.post('/api/tasks?workspaceId=ws-alpha', {
    data: { title, status },        // JSON body；表单用 form: {...}
  });
  expect(res.status(), '造数接口应当返回 201').toBe(201);
  return (await res.json()).task;
},
```

对比走 UI 造数（打开页面、填表、点按钮、等列表刷新，约 2~5 秒），API 造数只要几十毫秒。**前置数据不是被测对象时，永远走 API。**

### 用法二：UI 操作后断言持久化结果（真）

```ts
// tests/journey.spec.ts —— 对话框改名后，用 API 复核数据真的落库了
const check = await page.request.get(`/api/tasks/${task.id}`);
expect(check.ok()).toBeTruthy();
const body = await check.json();
expect(body.task.title).toBe(`${title}（已改名）`);
```

UI 断言证明「用户看到了新标题」，API 断言证明「服务端状态确实变了」。两者互补：只测 UI，可能断言的是前端本地状态的假象；只测 API，又没证明界面正确渲染。

### 用法三：直接测 API 层的权限与契约

E2E 套件里允许少量「纯 API 测试」，专门覆盖「绕过 UI 直接打接口」的越权路径——这本来就是攻击者的视角：

```ts
// tests/tenancy.spec.ts
test("带 cookie 直接请求他人工作区的任务列表会得到 403", async ({
  request,
}) => {
  const res = await request.get("/api/tasks?workspaceId=ws-beta");
  expect(res.status()).toBe(403);
  const body = await res.json();
  expect(body.error.code).toBe("forbidden");
});
```

常用 API 一览（完整见 APIRequestContext 文档）：

```ts
await request.get(url, { params, headers });
await request.post(url, { data | form | multipart });
await request.fetch(urlOrRequest, { ...override });   // 通用：可基于已有 Request 改
const res = ...;
res.status(); res.ok(); await res.json(); await res.text(); res.headers();
```

## 8.3 page.route：拦截、伪造、掐断

`page.route(pattern, handler)` 在页面与网络栈之间设卡。handler 拿到 `route` 对象后三选一：

| 方法                                                    | 语义                       |
| ------------------------------------------------------- | -------------------------- |
| `route.fulfill({ status, body, ... })`                  | 不发真实请求，直接伪造响应 |
| `route.continue({ headers?, postData? })`               | 放行（可顺手改请求头/体）  |
| `route.abort('failed' \| 'connectionrefused' \| ...)`)` | 掐断，页面收到网络错误     |

### 注入故障：E2E 测试错误处理的唯一正道

「服务器 500 时页面显示什么？」——你不可能让真服务器配合演出，`route.fulfill` 就是导演：

```ts
// tests/resilient.spec.ts —— 列表接口伪装 500
test("列表接口 500 时展示错误提示，重试后可恢复", async ({ page }) => {
  await page.route("**/api/tasks?**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "internal", message: "服务器开小差了" },
      }),
    }),
  );

  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "加载任务失败：服务器开小差了",
  );

  await page.unroute("**/api/tasks?**"); // 解除拦截
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("alert")).toBeHidden(); // 恢复真实数据
});
```

`route.abort()` 则模拟断网：

```ts
await page.route("**/api/tasks?**", (route) => route.abort());
// 页面的 fetch 会抛 TypeError: Failed to fetch —— 前端错误分支被迫现身
```

**关键原则：故障注入的对象是「你不拥有/不可控」的部分**——第三方 API、支付网关、真实的服务器错误。你自己的后端在 E2E 里应当真实运行（否则测的是什么「端到端」？），错误场景用 route 精确导演，而不是把整个后端 mock 掉。

### 延迟与「只拦一次」

慢网络、加载态也能导演。route handler 是普通异步函数，可以延时；handler 内部调用 `page.unroute` 即可实现「只拦第一个请求」：

```ts
// tests/resilient.spec.ts —— 第一个任务列表请求延迟 500ms，用于观察 loading
await page.route("**/api/tasks?**", async (route) => {
  await page.unroute("**/api/tasks?**"); // 后续请求放行
  await new Promise((resolve) => setTimeout(resolve, 500));
  await route.continue(); // 放行这一个（延迟后）
});
```

### 修改真实响应：route.fetch + fulfill

不想全伪造、只想在真实响应上改个字段：

```ts
await page.route("**/api/tasks?**", async (route) => {
  const response = await route.fetch(); // 真实请求
  const body = await response.json();
  body.items = body.items.map((t) => ({ ...t, status: "done" })); // 篡改
  await route.fulfill({ response, body: JSON.stringify(body) }); // 其余字段沿用真实响应
});
```

### glob 模式的坑

route/waitForResponse 的 URL 匹配用的是简化 glob，规则与直觉略有出入：

- `*` 不跨 `/`，`**` 跨；`?` 只匹配字面问号；`{a,b}` 匹配列表；
- **模式必须匹配完整 URL**（含协议域名）——所以常用 `**/api/tasks?**` 而不是 `/api/tasks`；
- 复杂条件直接上 RegExp 或谓词函数：`page.route(/\/api\/tasks\?/, ...)`。

### 两个高级事实（官方文档明示，避免踩坑）

1. **有些请求头你改不了**：`Cookie`、`Host`、`Content-Length`、`Sec-Fetch-*` 等由网络栈在发送前最后一刻附加（HttpOnly cookie 对页面不可见是同一安全边界）。`route.continue({ headers })` 里传 cookie 会被无视——想换身份请换 storageState；
2. **路由与重定向**：一个请求及其重定向链只调用 handler 一次（对原始请求）；fulfill 一个 3xx 不会给你二次拦截的机会。

### context.route vs page.route

`context.route` 对该 context 里所有页面（含弹窗、后续新开的标签页）生效；`page.route` 只管当前页面。跨页面的拦截（如 OAuth 弹窗流）用前者。`page.unroute` 可传原 handler 精确解除。

## 8.4 监听网络：page.on 与 waitForResponse

不拦截、只观察——断言「点击后确实发出了正确的请求」：

```ts
// 事件监听（收集用）
page.on("request", (req) => console.log(">>", req.method(), req.url()));
page.on("response", (res) => console.log("<<", res.status(), res.url()));

// 等待特定响应（断言用）——牢记「先挂 promise，再触发动作」
const responsePromise = page.waitForResponse(
  (res) => res.url().includes("/api/tasks") && res.status() === 200,
);
await page.getByRole("button", { name: "重试" }).click();
const response = await responsePromise;
expect((await response.json()).items.length).toBeGreaterThan(0);
```

`waitForResponse` 适合「UI 动作 → 请求 → 响应内容」链路的白盒断言；但优先用 UI 可观察结果做断言（黑盒），网络断言作为补充——否则测试会耦合 API 形状，接口重构（契约升级）时 UI 没坏测试却红了。

## 8.5 mock 的边界：E2E 里什么该 mock

把本章与第 1 章的金字塔合起来，得到 E2E 的 mock 决策表：

| 对象                                  | mock？                  | 理由                                                   |
| ------------------------------------- | ----------------------- | ------------------------------------------------------ |
| 自己的后端                            | **否**                  | E2E 的定义就是全链路真实；后端行为用 API 集成测试覆盖  |
| 自己的数据库                          | 否                      | 同上；用种子数据 + 唯一命名解决数据问题（第 5 章）     |
| 第三方服务（支付、短信、地图）        | **是**                  | 你控制不了它：花钱、限流、内容变化、隐私               |
| 难以稳定复现的故障（500、超时、断网） | 是（route 注入）        | 这是唯一能可靠测试错误处理的方式                       |
| 登录态                                | 是（storageState 注入） | 第 7 章                                                |
| OAuth 外部跳转                        | 通常 mock/测试模式      | 官方最佳实践「Avoid testing third-party dependencies」 |

官方最佳实践的原话值得贴在工位上：**「Only test what you control.」** 反过来也成立：**你能控制的，就不要 mock**——每 mock 一层，E2E 与真实世界的差距就大一分，「所有测试通过但系统无法运行」的风险就高一分（这正是路线图 Vitest 阶段「过度 mock」警告在 E2E 层的对应物）。

### 与 MSW 等 Service Worker mock 工具的关系

如果前端项目用 Mock Service Worker 做开发期 mock，注意：SW 会接管网络请求，令 `page.route` 看不到它们。官方建议二选一：E2E 里用 Playwright 原生 route（并可 `serviceWorkers: 'block'`），或保留 MSW 但接受 route 失效。不要让两套 mock 机制在同一层打架。

## 8.6 HAR：录制与回放（了解）

`page.routeFromHAR()` 可以把一轮真实流量录成 HAR 文件，之后离线回放——适合对第三方依赖「录制一次、永久可测」：

```ts
// 录制（一次性）
await page.routeFromHAR("har/github.har", { update: true, url: "**/api/**" });
// 回放（日常测试）
await page.routeFromHAR("har/github.har", {
  url: "**/api/**",
  notFound: "abort",
});
```

HAR 里是真实响应快照（含 token 等敏感头，入库前必须脱敏），且会随接口演化过时。定位是「第三方依赖的稳定替身」，不是自家后端的 mock 方案。

---

## 常见错误

1. **用自己的后端 mock 跑 E2E**：全绿但什么都没证明。E2E 的后端必须真实。
2. **`route.fulfill` 忘了 `contentType`**：默认按 body 猜测；JSON 响应不写 `contentType: 'application/json'`，前端 `res.json()` 可能解析异常，测出的是「假的 bug」。
3. **glob 写了半截 URL**（`'/api/tasks'`）：必须匹配完整 URL，用 `'**/api/tasks?**'` 或正则。
4. **route 装了忘记拆**：同文件后续测试继续被拦截，出现「只有这个测试之后的测试挂了」的连锁谜案。用 `page.unroute`，或把 route 放进只影响单测试的位置（每测试新 context 会自动清理 page 级 route，但 context 级不会跨测试共享——记住 route 的生效范围）。
5. **在 route handler 里 `await route.continue()` 之后又 fulfill**：一个 route 只能被处置一次，二次调用抛错。
6. **用 `waitForResponse` 却先点击后监听**：竞争条件，响应早于监听到达就永远等不到（第 4 章同款陷阱）。
7. **试图用 `route.continue({ headers: { cookie: ... } })` 换身份**：cookie 由浏览器 cookie 商店管理，此路不通；换 storageState 或开新 context。

## 练习

1. 给 TaskBoard 写一个测试：用 `route.fulfill` 伪造「任务列表返回 3 条固定数据」，断言页面渲染出且仅出这 3 条（提示：伪造的 id 用 `t-fake-*`，验证渲染不依赖真实数据）。
2. 用 `route.fetch + fulfill` 把真实列表里所有任务的状态篡改为 `done`，断言页面所有徽标显示「已完成」。
3. 写一个测试：拦截 `POST **/api/tasks?**` 使其返回 429（限流），在 UI 上创建任务，断言错误提示出现。观察前端把 `error.message` 透传给了用户——如果你的应用不透传，这就是 E2E 发现的真实体验问题。
4. 用 `waitForResponse` 改写「搜索触发筛选」的断言：按下回车后等待 `/api/tasks?q=...` 响应，并断言响应体 `total === 1`。
5. 思考题：`guest.spec.ts` 的「未登录调 API 得 401」测试里用的是 `request` fixture 而不是 `page.request`，两者在此场景下有区别吗？（提示：storageState 重置发生在哪个层级？）

<details>
<summary>参考答案（要点）</summary>

1. 核心：

```ts
await page.route("**/api/tasks?**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      items: fake3,
      page: 1,
      pageSize: 5,
      total: 3,
      totalPages: 1,
    }),
  }),
);
await page.goto("/");
await expect(page.getByRole("listitem")).toHaveCount(3);
```

2. handler 里 `const res = await route.fetch(); const body = await res.json(); body.items = body.items.map(t => ({...t, status:'done'})); await route.fulfill({ response: res, body: JSON.stringify(body) });`，断言 `toHaveText('已完成')` × 3（或对 listitem 逐个 filter）。
3. `route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 'rate_limited', message: '操作太频繁' } }) })`，断言 `getByRole('alert')).toContainText('操作太频繁')`。
4.

```ts
const p = page.waitForResponse(
  (r) => r.url().includes("/api/tasks") && r.url().includes("q="),
);
await page.getByLabel("搜索标题").press("Enter");
const body = await (await p).json();
expect(body.total).toBe(1);
```

5. 有区别。`test.use({ storageState: { cookies: [], origins: [] } })` 同时作用于 `request` fixture 与页面 context，所以两者都未登录、都能测出 401；但如果只重置了页面（如手动 clearCookies），`request` fixture 仍可能持有项目级 storageState 的 cookie——写权限类 API 测试时要确认用的是哪个客户端、带的是谁的身份。

</details>

## 本章验收清单

- [ ] 能区分 request fixture（主动发）与 page.route（拦截改）两组能力的方向与用途；
- [ ] 会用 API 造数 + UI 断言的组合，并能解释「为什么前置数据走 API、行为验证走 UI」；
- [ ] 会用 fulfill / continue / abort / fetch+fulfill 四种处置，知道 glob 的完整 URL 规则；
- [ ] 牢记 mock 决策表：自己的后端不 mock，第三方与故障注入才 mock；
- [ ] 知道 cookie 等网络栈头不可经 route 覆盖、waitForResponse 的挂载顺序。

## 官方文档

- [Network](https://playwright.dev/docs/network) — route、事件、glob、请求拦截原理（headers/重定向）
- [API mocking](https://playwright.dev/docs/mock) — fulfill/fetch/HAR/WebSocket mock
- [API testing](https://playwright.dev/docs/api-testing) — request fixture 与 APIRequestContext
- [APIRequestContext reference](https://playwright.dev/docs/api/class-apirequestcontext) / [Route reference](https://playwright.dev/docs/api/class-route)
- [Best Practices · Avoid testing third-party dependencies](https://playwright.dev/docs/best-practices)

上一章：[认证与 storageState](./07-authentication-and-storage-state.md) ｜ 下一章：[常见交互场景实战](./09-common-scenarios.md)。
