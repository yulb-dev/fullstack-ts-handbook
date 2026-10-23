# 第 7 章：取消请求与网络重试

> 本章目标：让「不再需要的请求」被真正取消；分清「取消」和「撤销」；为查询和写操作分别制定重试策略——哪些错误值得重试、重试几次、间隔多久、什么时候绝对不能重试。
>
> 对应核心概念：**④ 取消请求与网络重试策略。**

---

## 7.1 为什么要取消请求

三个常见场景：

**场景 1：竞态（race condition）。** 用户在任务列表里快速切换筛选：「全部」→「待办」→「已完成」。三个请求几乎同时发出，但网络不保证顺序：

```
t=0ms    请求 A（全部）    发出
t=50ms   请求 B（待办）    发出
t=100ms  请求 C（已完成）  发出
t=300ms  响应 C 到达 → 显示「已完成」✅
t=800ms  响应 A 到达 → 显示「全部」❌（用户明明选的是「已完成」）
```

**场景 2：组件已卸载。** 用户打开详情页又马上返回，详情请求还在路上。结果到了也没人用，白白占用带宽和服务器资源。

**场景 3：用户主动放弃。** 一个慢查询（导出报表），用户点了「取消」。

TanStack Query 已经用 query key 解决了场景 1 的「显示错乱」（每个筛选条件是不同的缓存条目，响应只会写进自己的条目）。但请求本身仍然在跑。**取消**能把它们真正停下来。

---

## 7.2 AbortSignal 全链路

取消靠的是 Web 标准的 `AbortController` / `AbortSignal`。在我们的架构里，它要穿过四层：

```
TanStack Query                     创建 AbortController，把 signal 传给 queryFn
   │  queryFn: ({ signal }) => …
   ▼
features/tasks/api.ts              把 signal 原样交给生成的客户端
   │  api.GET(path, { params, signal })
   ▼
openapi-fetch                      new Request(url, { signal, … })
   │
   ▼
fetch                              signal 被触发 → 中止网络请求 → 抛出 DOMException("AbortError")
   │
   ▼
api-client 中间件 onError           isAbortError → 原样抛出（不包装成 NetworkError）
   │
   ▼
TanStack Query                     识别为「自己发起的取消」，静默处理，不进入 error 状态
```

**`apps/web/src/features/tasks/api.ts`**（列表查询）：

```ts
export function useTaskList(projectId: string, status?: TaskStatus) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: taskKeys.list(projectId, status),
    // signal：组件卸载 / key 变化时，TanStack Query 会中止还在路上的请求
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET("/api/v1/projects/{projectId}/tasks", {
          params: {
            path: { projectId },
            query: {
              limit: 20,
              ...(pageParam ? { cursor: pageParam } : {}),
              ...(status ? { status } : {}),
            },
          },
          signal,
        }),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}
```

关键只有一行：**解构出 `signal` 并传下去**。TanStack Query v5 的行为是：只要你在 `queryFn` 里**读取了** `signal`，当查询变得不再需要（没有组件订阅它了）时，进行中的请求就会被中止。

> 如果你没有用 `signal`，TanStack Query 依然能保证缓存正确（场景 1 不会显示错乱），只是请求不会被真正中止。

### 为什么中间件要放过 AbortError

**`packages/api-client/src/client.ts`**：

```ts
onError({ error }) {
  // 主动取消（AbortController / TanStack Query 取消）原样抛出，不当作网络故障
  if (isAbortError(error)) return;
  return new NetworkError("网络连接失败，请检查网络后重试", { cause: error });
},
```

如果把取消也包装成 `NetworkError`：

1. 页面会弹出「网络连接失败」——但用户只是切换了一下筛选；
2. 重试策略会认为「网络错误可以重试」，于是**重新发起刚被取消的请求**。

`onError` 返回 `undefined` 表示「我不处理」，openapi-fetch 会把原始的 `AbortError` 继续抛出，TanStack Query 认得它。

---

## 7.3 取消不等于撤销

这是本章最重要的一句话：**取消的是「等待响应」，不是「服务器上已经发生的事」。**

```
浏览器                              服务器
  │ POST /tasks ──────────────────▶ │ 收到请求
  │                                  │ 开始事务
  │ （用户关掉页面 / abort()）         │ INSERT …
  │ ✗ 不再等待响应                    │ COMMIT ✅  任务已经创建了！
  │                                  │ 发送响应 → 没人接收
```

对于 GET 请求，这没什么问题——读取不改变任何东西。但对写操作：

- **不要给 mutation 加「取消」按钮**，除非服务端真的支持「撤销」这个业务操作（那是另一个接口，比如 `DELETE`）；
- **超时、断网后，你不知道服务器到底有没有执行**。这就是第 11 章幂等键存在的根本原因：让「不知道成没成功」的请求可以安全地重发。

本项目的 mutation 都不传 `signal`，提交出去就让它跑完。

---

## 7.4 超时：一种特殊的取消

`fetch` 本身没有超时。如果服务器一直不响应，请求可能挂几分钟（取决于浏览器和网络设备）。你可以用 `AbortSignal.timeout()` 给单个请求加一个上限，并用 `AbortSignal.any()` 与 TanStack Query 的 signal 合并：

```ts
queryFn: ({ signal }) =>
  unwrap(
    api.GET("/api/v1/projects", {
      // 任一信号触发都会中止：组件卸载（signal）或 10 秒超时
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    }),
  ),
```

超时触发时，抛出的是 `DOMException`，但 `name` 是 **`"TimeoutError"`** 而不是 `"AbortError"`。我们的中间件只放过 `AbortError`，所以超时会被包装成 `NetworkError`——这正是我们想要的：**超时是一种网络故障，可以重试；主动取消不是。**

编写本教程时用一个永不响应的假 `fetch` 实际验证过：

```
AbortSignal.timeout(50) 触发  → NetworkError（cause.name = "TimeoutError"）
controller.abort() 触发       → AbortError
```

> 超时时间怎么定？看接口的 P99 延迟，留出余量。读接口通常 10~30 秒；写接口要更谨慎——超时后客户端会重试，如果服务端只是慢、并没有失败，没有幂等保护就会重复执行。

---

## 7.5 重试：哪些错误值得再试一次

重试的前提是：**同样的请求，换个时间发，结果可能不同。** 按这个标准给错误分类：

| 错误                                        | 换个时间会好吗           | 查询（GET）重试     | 写操作重试     |
| ------------------------------------------- | ------------------------ | ------------------- | -------------- |
| `NetworkError`（断网、DNS、连接重置、超时） | 可能                     | ✅                  | 仅当有幂等保障 |
| `AbortError`（主动取消）                    | —                        | ❌ 绝不             | ❌             |
| 400 / 422 参数错误                          | 不会                     | ❌                  | ❌             |
| 401 未登录                                  | 不会（要先登录）         | ❌                  | ❌             |
| 403 / 404                                   | 不会                     | ❌                  | ❌             |
| 409 / 412 冲突                              | 不会（要先处理冲突）     | ❌                  | ❌             |
| 429 限流                                    | 会（等一会儿）           | ✅ 按 `Retry-After` | 仅当有幂等保障 |
| 500                                         | 通常不会（多是代码 bug） | ❌                  | ❌             |
| 502 / 503 / 504                             | 可能（网关、部署、过载） | ✅                  | 仅当有幂等保障 |

几个容易想错的地方：

- **500 不重试**：500 通常意味着代码 bug，重试只会产生更多相同的错误日志，还会让「一个用户遇到 bug」变成「三倍的错误告警」。502/503/504 不同，它们多是暂时性的基础设施问题；
- **4xx 一律不重试**：TanStack Query 的默认策略是**所有失败都重试 3 次**，包括 403、404。这意味着一个 404 页面要等 1+2+4 = 7 秒才显示「不存在」——这是很多项目里「为什么错误要转半天」的原因；
- **写操作默认不重试**：TanStack Query 对 mutation 的默认 `retry` 就是 0，这是正确的。只有我们确认某个写接口是幂等的，才单独为它打开。

### 查询的重试策略

**`apps/web/src/lib/query-client.ts`**：

```ts
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError, NetworkError } from "@taskflow/api-client";

/**
 * 查询（GET）的重试策略：只重试「换个时间可能就好了」的错误。
 * - 网络错误、429、502/503/504：重试；
 * - 4xx（参数错、没权限、不存在）：重试一百次也一样，立刻失败；
 * - 500：通常是代码 bug，重试只会放大日志噪音。
 */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= 3) return false;
  if (error instanceof NetworkError) return true;
  if (error instanceof ApiError)
    return [429, 502, 503, 504].includes(error.status);
  return false;
}

/** 指数退避 + 抖动；服务端给了 Retry-After 就听服务端的 */
export function retryDelay(attempt: number, error: unknown): number {
  if (error instanceof ApiError && error.retryAfterMs !== null) {
    return Math.min(error.retryAfterMs, 30_000);
  }
  const base = Math.min(1000 * 2 ** attempt, 10_000);
  return base / 2 + Math.random() * (base / 2);
}
```

### 指数退避与抖动

`retryDelay` 体现了三个原则：

**① 指数退避**：第 1 次等约 1 秒，第 2 次约 2 秒，第 3 次约 4 秒，上限 10 秒。服务器过载时，越来越长的间隔给它恢复的时间。

**② 抖动（jitter）**：`base / 2 + random * base / 2`，实际等待时间在 `[base/2, base]` 之间随机。为什么？想象服务器重启的那一刻，一万个客户端同时失败。如果它们都在精确的 1 秒后重试，服务器刚起来就会被一万个请求同时打垮（「惊群效应」）。随机抖动把这些请求分散开。

**③ 尊重 `Retry-After`**：429 和 503 响应可以带 `Retry-After` 头（秒数或 HTTP 日期），这是服务器明确告诉你「什么时候再来」。第 6 章的 `toApiError` 已经把它解析成 `retryAfterMs`，这里直接使用（并设 30 秒上限，避免服务器给出一个离谱的值让界面卡死）。

### 组装 QueryClient

```ts
export function createQueryClient(handlers: { onUnauthenticated: () => void }) {
  // 任何请求遇到 401：会话失效，统一回到登录态，而不是每个组件各自处理
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401)
      handlers.onUnauthenticated();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: { retry: shouldRetryQuery, retryDelay, staleTime: 30_000 },
      // 写操作默认不重试：除非这个接口有幂等保障（见 useCreateTask）
      mutations: { retry: false },
    },
  });
}
```

---

## 7.6 有幂等保障的写操作：可以重试，但只重试网络错误

创建任务的接口要求 `Idempotency-Key`（第 11 章），同一个键重复提交只会创建一次。有了这个保障，「网络错误后重试」就变得安全了：

**`apps/web/src/features/tasks/api.ts`**：

```ts
export function useCreateTask(projectId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["createTask", projectId],
    mutationFn: ({ body, idempotencyKey }: CreateTaskVariables) =>
      unwrap(
        api.POST("/api/v1/projects/{projectId}/tasks", {
          params: {
            path: { projectId },
            header: { "idempotency-key": idempotencyKey },
          },
          body,
        }),
      ),
    // 有幂等键兜底，「不知道服务器收没收到」的网络错误才敢自动重试；4xx 绝不重试
    retry: (failureCount, error) =>
      failureCount < 2 && error instanceof NetworkError,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: taskKeys.lists(projectId) }),
  });
}
```

注意**幂等键是 mutation 的变量（`variables`）**，不是在 `mutationFn` 里临时生成的。TanStack Query 重试时会用**相同的 variables** 再次调用 `mutationFn`，所以重试请求携带的是同一个键。如果写成：

```ts
// ❌ 每次重试都生成新键——幂等保障完全失效
mutationFn: (body) =>
  api.POST(path, { params: { header: { "idempotency-key": crypto.randomUUID() } }, body }),
```

第一次请求其实已经成功创建（只是响应在回来的路上丢了），重试带着新键过去，服务器会再创建一条。

这一点有组件测试保证（**`apps/web/src/features/tasks/CreateTaskForm.test.tsx`**）：

```ts
it("网络错误自动重试，且重试复用同一个幂等键", async () => {
  let calls = 0;
  const { requests, user } = setup(() => {
    calls++;
    if (calls === 1) throw new TypeError("Failed to fetch");
    return json(201, task);
  });
  await user.type(screen.getByLabelText("标题"), "弱网提交");
  await user.click(screen.getByRole("button", { name: "创建任务" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  const keys = requests.map((r) => r.req.headers.get("idempotency-key"));
  expect(keys[0]).toBe(keys[1]);
});
```

键在什么时候换新、什么时候保留，是第 11 章的重点。

---

## 7.7 401 的全局处理

401 很特殊：它不是某个组件的错误，而是**整个会话失效了**。如果每个组件各自处理 401，你会看到五个错误横幅同时弹出。

我们在 `QueryCache` / `MutationCache` 的 `onError` 里统一处理（上面 `createQueryClient` 的代码），具体动作在 **`apps/web/src/main.tsx`**：

```ts
const queryClient = createQueryClient({
  onUnauthenticated: () => {
    // 会话失效：清空所有服务端缓存，回到登录页
    csrf.set(null);
    queryClient.clear();
    queryClient.setQueryData(sessionKey, null);
  },
});
```

`queryClient.clear()` 很重要：会话失效后，缓存里的数据属于「上一个身份」。如果不清空，换一个账号登录后可能短暂看到前一个用户的任务。

有一个查询需要例外处理——**读取会话本身**。未登录时，`GET /auth/session` 返回 401 是正常状态，不是错误。如果它也触发 `onUnauthenticated`，而 `onUnauthenticated` 又让会话查询重新执行……就会形成循环。所以会话查询把 401 转换成 `null`（**`apps/web/src/features/auth/session.ts`**）：

```ts
export function useSession() {
  const api = useApi();
  return useQuery({
    queryKey: sessionKey,
    queryFn: async ({ signal }): Promise<Session | null> => {
      try {
        const session = await unwrap(
          api.GET("/api/v1/auth/session", { signal }),
        );
        csrf.set(session.csrfToken);
        return session;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          csrf.set(null);
          return null; // 未登录是正常状态，不是错误
        }
        throw error;
      }
    },
    staleTime: Infinity,
  });
}
```

---

## 7.8 服务端视角：客户端取消了，服务端知道吗？

浏览器中止请求时，TCP 连接会被关闭，但 **Fastify 的 handler 不会自动停止**——它会继续执行完，把响应写给一个已经关闭的连接。对大多数短请求（几十毫秒）这无所谓。

对于耗时的读操作（复杂报表、大文件导出），可以监听连接关闭来提前结束：

```ts
app.get("/reports/heavy", async (request, reply) => {
  const controller = new AbortController();
  request.raw.on("close", () => {
    if (!reply.sent) controller.abort(); // 客户端已断开，且我们还没回复
  });
  return buildHeavyReport({ signal: controller.signal }); // 业务代码定期检查 signal
});
```

而对于写操作，**通常不应该**因为客户端断开就中止——事务进行到一半被打断，要么回滚（客户端以为可能成功了），要么提交（客户端以为失败了），都会让状态更难推理。让它完成，配合幂等键让客户端安全重试，才是更简单可靠的模型。

---

## 7.9 测试重试策略

重试策略是纯函数，可以直接单元测试（**`apps/web/src/lib/errors.test.ts`** 节选）：

```ts
describe("查询重试策略", () => {
  it("只重试网络错误与可恢复的状态码，且最多 3 次", () => {
    expect(shouldRetryQuery(0, new NetworkError("x"))).toBe(true);
    expect(shouldRetryQuery(0, apiError(503))).toBe(true);
    expect(shouldRetryQuery(0, apiError(429))).toBe(true);
    for (const status of [400, 401, 403, 404, 409, 500]) {
      expect(shouldRetryQuery(0, apiError(status)), String(status)).toBe(false);
    }
    expect(shouldRetryQuery(3, new NetworkError("x"))).toBe(false);
  });

  it("优先遵守 Retry-After，否则指数退避且有上限", () => {
    const limited = new ApiError(429, "RATE_LIMITED", "x", null, [], 5000);
    expect(retryDelay(0, limited)).toBe(5000);
    expect(retryDelay(10, new NetworkError("x"))).toBeLessThanOrEqual(10_000);
  });
});
```

在组件测试里，为了不真的等待几秒，可以给测试用的 QueryClient 设置 `retryDelay: 0`：

```ts
const queryClient = new QueryClient({
  defaultOptions: { mutations: { retryDelay: 0 } },
});
```

`useCreateTask` 只覆盖了 `retry`，没有覆盖 `retryDelay`，所以测试里会使用这里的 0。

---

## 7.10 常见坑

| 现象                           | 原因                                        | 解决                                             |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------ |
| 404 页面要转好几秒才显示       | TanStack Query 默认重试所有错误 3 次        | 自定义 `retry`，4xx 不重试                       |
| 切换筛选时弹出「网络错误」     | 把 AbortError 包装成了 NetworkError         | 中间件放过 AbortError                            |
| 弱网下创建了两条任务           | 写操作重试时生成了新幂等键 / 没有幂等键     | 键放在 variables 里；只对幂等接口开启重试        |
| 服务器重启后瞬间又被打挂       | 所有客户端同时重试                          | 指数退避 + 抖动                                  |
| 限流后客户端更疯狂地请求       | 忽略了 `Retry-After`                        | 解析并遵守 `Retry-After`                         |
| 登录页无限刷新                 | 会话查询的 401 触发全局登出，又重新查询会话 | 会话查询把 401 转成 `null`                       |
| 用户点了取消，任务还是被创建了 | 取消 ≠ 撤销                                 | 不给 mutation 做「取消」；需要撤销就设计撤销接口 |
| 换账号后看到上一个人的数据     | 401 / 登出后没清缓存                        | `queryClient.clear()`                            |

---

## 7.11 本章验收清单

- [ ] 能举出需要取消请求的三个场景；
- [ ] 能画出 AbortSignal 从 TanStack Query 到 fetch 的全链路，并解释中间件为何放过 AbortError；
- [ ] 能解释「取消不等于撤销」，以及它和幂等键的关系；
- [ ] 会用 `AbortSignal.timeout` + `AbortSignal.any` 加超时，知道超时是 `TimeoutError`；
- [ ] 能按「换个时间会不会好」给错误分类，说出 500 和 502/503/504 为什么区别对待；
- [ ] 实现了指数退避 + 抖动 + `Retry-After`；
- [ ] 写操作默认不重试；有幂等键的创建接口只重试网络错误，且重试复用同一个键；
- [ ] 401 被全局处理，会话查询不会造成循环。

---

上一章：[← 第 6 章：统一错误 envelope 与 requestId](./06-error-envelope-and-request-id.md) ｜ 下一章：[第 8 章：Cookie、CORS、预检、CSRF 与代理 →](./08-cookies-cors-csrf.md)
