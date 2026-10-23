# 第 12 章：版本、弃用、分页与序列化规范

> 本章目标：契约不是写一次就完的东西，它会演进。本章制定 TaskFlow 的「契约规范」：什么改动是兼容的、什么是破坏性的；怎样弃用一个接口；分页响应长什么样；日期、时区、枚举、数字和 `null` 怎样序列化——并把每一条落到代码和测试里。
>
> 对应核心概念：**⑦ API 版本兼容、弃用策略、分页响应契约、日期/时区与枚举的序列化规范。**

---

## 12.1 为什么「前后端同时发布」是个错觉

在 monorepo 里，前后端在同一个提交里修改，很容易让人以为它们「同时上线」。现实是：

- 用户的浏览器里可能还开着**昨天加载的旧版前端**，它会继续调用新版 API，直到用户刷新；
- CDN 缓存的旧 JS 包可能还会被分发几分钟甚至几小时；
- 滚动发布期间，一部分服务器是新版本、一部分是旧版本，同一个用户的两次请求可能打到不同版本；
- 如果将来有移动端，旧版 App 会在用户手机上存活几个月甚至几年。

所以每一次契约变更，都要回答：**旧客户端 + 新服务端能不能工作？新客户端 + 旧服务端呢？**

---

## 12.2 兼容性规则

### 兼容（非破坏性）的变更

| 变更                            | 为什么兼容                   | 注意                              |
| ------------------------------- | ---------------------------- | --------------------------------- |
| 新增接口                        | 旧客户端不会调用它           | —                                 |
| 响应里新增字段                  | 旧客户端忽略不认识的字段     | 客户端不能做「严格校验响应」      |
| 请求里新增**可选**字段          | 旧客户端不传，服务端用默认值 | **服务端必须先上线**（见下文）    |
| 放宽请求校验（120 字 → 200 字） | 旧客户端发的仍然合法         | —                                 |
| 新增错误码                      | 客户端按状态码兜底           | 需要客户端已经实现兜底（第 6 章） |
| 响应枚举新增值                  | 客户端对未知值兜底           | 需要客户端已经实现兜底（12.7 节） |

### 破坏性的变更

| 变更                                                    | 谁会坏                          |
| ------------------------------------------------------- | ------------------------------- |
| 删除或重命名字段（请求或响应）                          | 读这个字段 / 发这个字段的客户端 |
| 改变字段类型（`number` → `string`、ID 从整数改为 UUID） | 所有使用者                      |
| 可选字段变必填（请求）                                  | 不传这个字段的旧客户端          |
| 收紧请求校验（200 字 → 120 字）                         | 发 150 字的旧客户端             |
| 删除枚举值                                              | 发送或依赖这个值的客户端        |
| 修改 URL、方法、`operationId`                           | 所有调用者、代码生成器          |
| 改变状态码语义（创建从 200 改成 201、404 改成 403）     | 按状态码分支的客户端            |
| 改变默认值、排序、分页方式                              | 依赖旧行为的客户端              |
| 新增**必填**请求头（如突然要求 `Idempotency-Key`）      | 所有旧客户端                    |

### 一个容易被忽略的不对称：`additionalProperties: false`

我们的请求 schema 都写了 `additionalProperties: false`（拒绝多余字段，第 5 章）。这带来一个**部署顺序**约束：

```
新前端（会发送新字段 estimate）+ 旧后端（不认识 estimate）→ 400 ❌
旧前端（不发 estimate）+ 新后端（estimate 可选）→ 201 ✅
```

所以**新增请求字段时，服务端必须先上线**，确认稳定后再发布使用这个字段的前端。响应方向则相反：服务端新增响应字段，旧前端会忽略它，任何顺序都可以。

---

## 12.3 版本策略

### URL 中的主版本号

TaskFlow 的所有接口都在 `/api/v1` 下：

```ts
await app.register(
  async (v1) => {
    /* 所有路由 */
  },
  { prefix: "/api/v1" },
);
```

规则：

- **`/v1` 只有在不得不做破坏性变更时才会变成 `/v2`**。绝大多数演进应该是兼容的，`v1` 可以存活很多年；
- 出现 `v2` 时，`v1` 和 `v2` **并存**一段时间（同一个服务里注册两套路由，共享 Service 层），给客户端迁移的时间；
- 不要「每个接口单独一个版本号」——客户端将不得不记住 `/v1/tasks` 配 `/v3/projects`，复杂度爆炸。

另外两种常见做法：版本放在请求头里（`Accept: application/vnd.taskflow.v2+json`），或者按日期版本化（Stripe 的 `Stripe-Version: 2026-10-01`）。它们更灵活，但对浏览器调试、缓存、文档都不如 URL 版本直观。对大多数团队，URL 主版本 + 兼容演进已经足够。

### 文档版本号

OpenAPI 的 `info.version`（我们是 `1.3.0`）是**契约文档的版本**，和 URL 的 `/v1` 是两回事：

| 变更                   | `info.version` | URL           |
| ---------------------- | -------------- | ------------- |
| 修正文档描述           | 1.3.0 → 1.3.1  | 不变          |
| 新增接口、新增可选字段 | 1.3.0 → 1.4.0  | 不变          |
| 破坏性变更             | 2.0.0          | `/v1` → `/v2` |

---

## 12.4 「扩展-迁移-收缩」：不中断地重命名字段

假设我们当初把截止日期命名为 `dueAt`（时间点），后来发现它其实是日历日期，想改名为 `dueDate`。直接改名是破坏性的。用「扩展-迁移-收缩」（expand-migrate-contract，也叫 parallel change）三步完成：

**① 扩展**：新增 `dueDate`，同时保留 `dueAt`。服务端两个都读、两个都写：

```ts
// 契约
dueAt: Type.Optional(Type.Union([DateTime, Type.Null()], { deprecated: true, description: "已弃用，请使用 dueDate" })),
dueDate: Type.Optional(Type.Union([CalendarDate, Type.Null()])),
```

**② 迁移**：前端（以及所有其他客户端）改用 `dueDate`。通过日志统计还有多少请求在用 `dueAt`。

**③ 收缩**：确认没有调用方后（或在 `/v2` 里），删除 `dueAt`。

每一步都是兼容的。这个模式同样适用于数据库列的重命名，两者经常一起进行。

---

## 12.5 弃用一个接口

TaskFlow 有一个早期接口 `GET /api/v1/me`，功能已经被 `GET /api/v1/auth/session` 覆盖。我们要弃用它，而不是直接删除。

**弃用要通过三个渠道同时宣告**（**`apps/api/src/routes/auth.ts`**）：

```ts
// 已弃用接口示例：仍可用，但在契约与响应头里都宣告了退场时间
app.get(
  "/me",
  {
    schema: {
      operationId: "getMe",
      tags: ["auth"],
      summary: "【已弃用】读取当前用户，请改用 GET /api/v1/auth/session",
      deprecated: true, // ① 契约
      response: { 200: ref(User), ...errorResponses(401, 500) },
    },
  },
  async (request, reply) => {
    const auth = requireAuth(request);
    reply.headers({
      // ② 响应头
      deprecation: "@1793491200", // 2026-11-01T00:00:00Z 起弃用（RFC 9745）
      sunset: "Mon, 01 Feb 2027 00:00:00 GMT", // 之后可能下线（RFC 8594）
      link: '</api/v1/auth/session>; rel="successor-version"',
    });
    return auth.user;
  },
);
```

**① 契约里的 `deprecated: true`**：生成的前端类型会带上 `@deprecated` 标记：

```ts
"/api/v1/me": {
  /**
   * 【已弃用】读取当前用户，请改用 GET /api/v1/auth/session
   * @deprecated
   */
  get: operations["getMe"];
};
```

VS Code 等编辑器会给使用这个接口的代码画上删除线，开发者写代码时就能看到。

**② 响应头**：运行时告诉所有调用者（包括你看不到代码的第三方）：

| 头                              | 标准     | 含义               | 格式              |
| ------------------------------- | -------- | ------------------ | ----------------- |
| `Deprecation`                   | RFC 9745 | 从什么时候开始弃用 | `@` + Unix 时间戳 |
| `Sunset`                        | RFC 8594 | 之后可能停止服务   | HTTP 日期         |
| `Link: rel="successor-version"` | RFC 8288 | 替代接口在哪       | 链接              |

（跨源部署时，这些头需要在 CORS 的 `exposedHeaders` 里，第 8 章已经加上。）

**③ 日志与监控**：在弃用期内，统计还有谁在调用这个接口（按 requestId 关联到前端版本、按 User-Agent 区分客户端），确认调用量归零后再删除。

测试：

```ts
describe("弃用接口", () => {
  it("仍然可用，但带 Deprecation / Sunset / Link 头", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: alice.cookies,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.deprecation).toMatch(/^@\d+$/);
    expect(res.headers.sunset).toBeTruthy();
    expect(res.headers.link).toContain("successor-version");
  });
});
```

弃用的完整生命周期：

```
标记弃用（契约 + 响应头 + 通知）→ 观察调用量下降 → Sunset 日期到达 → 删除（或返回 410 Gone）
```

---

## 12.6 在 CI 里检测破坏性变更

第 4 章的 CI 里有一个 `breaking-changes` 任务，用 [oasdiff](https://github.com/oasdiff/oasdiff) 比较「主分支的契约」和「当前 PR 的契约」：

```yaml
- name: Extract base contract
  run: git show origin/${{ github.base_ref }}:packages/api-client/openapi.json > base-openapi.json
- name: Detect breaking changes
  uses: oasdiff/oasdiff-action/breaking@main
  with:
    base: base-openapi.json
    revision: packages/api-client/openapi.json
    fail-on: ERR
    review: false
```

它能识别的典型问题：

- 删除了接口、或删除了响应里的字段；
- 请求里新增了必填参数 / 必填字段；
- 把字段类型从 `string` 改成了 `integer`；
- 收紧了 `maxLength`、删除了枚举值；
- 删除了一个没有先标记 `deprecated` 的接口。

这就是「契约变更会在 CI 中暴露」的另一层含义：第 4 章的漂移检查保证**生成物与代码一致**，类型检查保证**调用方与契约一致**，而 breaking 检查保证**新契约与旧契约兼容**。

> 有意为之的破坏性变更（比如发布 `/v2`）怎么办？oasdiff 支持忽略列表（`err-ignore`），把经过评审的变更加进去。关键是：**破坏性变更必须是一个显式的、被评审的决定，而不是一个意外。**

---

## 12.7 分页响应契约

### 契约

```ts
/** 游标分页：items + nextCursor；nextCursor 为 null 表示没有下一页 */
export function CursorPage<T extends TSchema>(item: T, id: string) {
  return Type.Object(
    {
      items: Type.Array(item),
      nextCursor: Type.Union([Type.String(), Type.Null()], {
        description: "不透明游标。原样传回 ?cursor=，不要解析或拼接",
      }),
    },
    { $id: id, additionalProperties: false },
  );
}

export const PageLimit = Type.Integer({
  minimum: 1,
  maximum: 100,
  default: 20,
  description: "每页条数，默认 20，最大 100",
});

export const ListTasksQuery = Type.Object({
  limit: Type.Optional(PageLimit),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  status: Type.Optional(ref(TaskStatus)),
});
```

请求：`GET /api/v1/projects/{projectId}/tasks?limit=20&cursor=…&status=todo`
响应：`{ "items": [...], "nextCursor": "WyIyMDI2LTEwLTIy…" }`，最后一页 `"nextCursor": null`。

### 为什么用游标而不是页码

页码分页（`?page=3&pageSize=20` → `OFFSET 40 LIMIT 20`）有两个问题：

**① 数据变动时会重复或遗漏。** 用户在看第 1 页时，有人新建了一个任务。按创建时间倒序，新任务排在最前面，所有任务往后挪了一位。用户点「下一页」，第 2 页的第一条是刚才第 1 页的最后一条——**重复了**。删除时则会**遗漏**。

**② 越往后越慢。** `OFFSET 10000` 要求数据库先找出前 10000 行再丢掉。

游标分页（keyset pagination）记住「上一页最后一条的位置」，下一页从这个位置之后开始取：

```sql
SELECT * FROM tasks
WHERE project_id = $1
  AND (created_at, id) < ($2::timestamptz, $3::uuid)   -- 上一页最后一条
ORDER BY created_at DESC, id DESC
LIMIT 21;                                               -- 多取一条判断是否有下一页
```

新增、删除数据都不会影响「从这个位置之后」的结果，配合 `(project_id, created_at DESC, id DESC)` 索引，每一页都是一次索引范围扫描，第 1 页和第 1000 页一样快。

### 实现要点

**`apps/api/src/services/task-service.ts`**：

```ts
interface Cursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.createdAt, c.id])).toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  const invalid = () =>
    new AppError(400, "VALIDATION_FAILED", "分页游标无效，请从第一页重新加载", {
      fields: [
        { in: "query", path: "cursor", rule: "format", message: "游标无效" },
      ],
    });
  try {
    const value: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      !Number.isNaN(Date.parse(value[0])) &&
      typeof value[1] === "string" &&
      /^[0-9a-f-]{36}$/i.test(value[1])
    ) {
      return { createdAt: value[0], id: value[1] };
    }
  } catch {
    // 落到下面统一报错
  }
  throw invalid();
}

export async function listTasks(
  db: Db,
  userId: string,
  projectId: string,
  query: { limit?: number; cursor?: string; status?: Task["status"] },
): Promise<TaskPage> {
  await assertCanRead(db, projectId, userId);
  const limit = query.limit ?? 20;

  const conditions: SQL[] = [eq(tasks.projectId, projectId)];
  if (query.status) conditions.push(eq(tasks.status, query.status));
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    // 行值比较 (a, b) < (x, y)：与 ORDER BY created_at DESC, id DESC 严格对应
    conditions.push(
      sql`(${tasks.createdAt}, ${tasks.id}) < (${c.createdAt}::timestamptz, ${c.id}::uuid)`,
    );
  }

  // 多取一条，用来判断「还有没有下一页」，不需要额外 count(*)
  const rows = await db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(desc(tasks.createdAt), desc(tasks.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toTaskDto),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}
```

逐条解释契约里的承诺：

| 规范                           | 实现                              | 为什么                                                                                                    |
| ------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 游标是**不透明**字符串         | base64url 编码                    | 客户端不应该解析或构造游标。将来换编码方式（比如加签名、换排序键）不影响客户端                            |
| 排序**稳定且唯一**             | `created_at DESC, id DESC`        | 只按 `created_at` 排序时，同一毫秒创建的两个任务顺序不确定，翻页时可能重复或遗漏。`id` 作为决胜键保证全序 |
| 游标与排序**严格对应**         | 行值比较 `(created_at, id) < (…)` | 等价于 `created_at < x OR (created_at = x AND id < y)`，且能用上复合索引                                  |
| `limit` 有上下限               | 契约 `1..100`，默认 20            | 防止 `limit=100000` 拖垮数据库                                                                            |
| 判断是否有下一页**不靠 count** | 多取一条                          | `count(*)` 在大表上很慢                                                                                   |
| 非法游标 → 400                 | `decodeCursor` 校验格式           | 游标来自客户端，不可信；`fields[].in = "query"`                                                           |

### 为什么不返回总数（`total`）？

`SELECT count(*)` 在大表上需要扫描所有匹配行，而且在游标分页里「总共多少页」没有太大意义（用户是「加载更多」而不是「跳到第 37 页」）。如果产品确实需要（「共 1,234 个任务」），可以：提供独立的计数接口，按需调用、可以缓存；或者返回估算值。**不要让每一次翻页都付出计数的代价。**

### 精度：一个隐蔽的坑

第 2 章的时间列都用了 `precision: 3`（毫秒）。为什么？

Postgres 的 `timestamptz` 默认精度是**微秒**，而 JavaScript 的 `Date` 只有**毫秒**。假设上一页最后一条的 `created_at` 是 `08:30:00.123456`，读到 JS 里变成 `08:30:00.123`，编码进游标。下一页查询 `(created_at, id) < ('08:30:00.123', …)`：那些创建于 `.123000` 到 `.123456` 之间、本该出现在下一页的任务，因为「不小于 .123」而被**跳过了**。精度不对齐会导致翻页**遗漏**，而且只在「同一毫秒内有多条数据」时才出现——本地几乎永远复现不了，线上批量导入时却会发生。

把数据库精度定为毫秒，与 JS 和 ISO 字符串完全一致，游标往返没有任何损失。

### 测试：不重不漏

```ts
it("游标翻页不重不漏，最后一页 nextCursor 为 null", async () => {
  const seen = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  do {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/projects/${ctx.projectId}/tasks`,
      query: { limit: "3", ...(cursor ? { cursor } : {}) },
      cookies: alice.cookies,
    });
    expect(res.statusCode).toBe(200);
    const page: { items: { id: string }[]; nextCursor: string | null } =
      res.json();
    assertMatchesSchema("TaskPage", page);
    for (const t of page.items) {
      expect(seen.has(t.id)).toBe(false); // 不重
      seen.add(t.id);
    }
    cursor = page.nextCursor;
    pages++;
  } while (cursor && pages < 50);
  const [row] = await ctx.db.select({ n: count() }).from(tasks);
  expect(seen.size).toBe(row?.n); // 不漏
});

it("limit 越界与伪造游标 → 400", async () => {
  const tooBig = await ctx.app.inject({
    method: "GET",
    url: `/api/v1/projects/${ctx.projectId}/tasks?limit=1000`,
    cookies: alice.cookies,
  });
  expect(tooBig.json().error.fields[0]).toMatchObject({
    in: "query",
    path: "limit",
  });
  const forged = await ctx.app.inject({
    method: "GET",
    url: `/api/v1/projects/${ctx.projectId}/tasks?cursor=not-a-cursor`,
    cookies: alice.cookies,
  });
  expect(forged.statusCode).toBe(400);
  expect(forged.json().error.fields[0]).toMatchObject({
    in: "query",
    path: "cursor",
  });
});
```

### 前端

`useInfiniteQuery` 天然适配游标分页（第 7 章已展示）：

```ts
initialPageParam: null as string | null,
// 游标是不透明字符串：原样回传，绝不自己拼
getNextPageParam: (lastPage) => lastPage.nextCursor,
```

`nextCursor` 为 `null` 时 `hasNextPage` 自动变为 `false`，「加载更多」按钮消失。

---

## 12.8 日期与时区

日期是 API 里最容易出错的数据类型。先分清三种「时间」：

| 种类                    | 例子                  | 契约格式                                                               | 数据库类型       | 展示                       |
| ----------------------- | --------------------- | ---------------------------------------------------------------------- | ---------------- | -------------------------- |
| **时间点**（instant）   | 任务创建于某一刻      | `date-time`，UTC，带 `Z`：`2026-10-22T08:30:00.000Z`                   | `timestamptz(3)` | 转换到**用户所在时区**     |
| **日历日期**            | 截止日 10 月 30 日    | `date`：`2026-10-30`                                                   | `date`           | **原样**展示，不做时区转换 |
| **本地时间 / 重复规则** | 「每天早上 9 点提醒」 | 时间 + IANA 时区名：`{ "time": "09:00", "timeZone": "Asia/Shanghai" }` | `time` + `text`  | 按该时区计算               |

本项目用到了前两种。

### 时间点：一律 UTC

服务端的唯一出口是 `toTaskDto` 里的 `toISOString()`，它总是输出 UTC 并带 `Z`。规则：

- 契约里的 `date-time` **必须带时区信息**，统一用 `Z`。不要输出 `2026-10-22 16:30:00`（没有时区，接收方只能猜）；
- 数据库用 `timestamptz`（带时区），而不是 `timestamp`（不带时区）。`timestamptz` 实际存的是 UTC 时间点，读写时根据连接的时区转换；
- **展示**时才转换到用户时区（**`apps/web/src/lib/dates.ts`**）：

```ts
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatInstant(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}
```

`Intl.DateTimeFormat` 的第一个参数 `undefined` 表示使用浏览器的语言和时区。同一个 `2026-10-22T08:30:00.000Z`，在上海显示为下午 4:30，在纽约显示为凌晨 4:30——这是正确的，因为它们是同一个时刻。

### 日历日期：不要让它碰到时区

截止日「10 月 30 日」对全世界的用户来说都是 10 月 30 日。但下面这行代码会出问题：

```ts
new Date("2026-10-30"); // ⚠️ 规范规定：仅日期的 ISO 字符串按 UTC 零点解析
// 在 UTC-5 的纽约：Thu Oct 29 2026 19:00:00 GMT-0500 → 显示成 10 月 29 日！
```

正确做法是按年月日拆开，构造**本地**日期：

```ts
/**
 * ⚠️ 不要写 new Date("2026-10-30")：它会被当成 UTC 零点，
 * 在 UTC-5 的用户那里显示成 10 月 29 日。日历日期要按年月日拆开构造本地日期。
 */
export function formatCalendarDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(y, m - 1, d),
  );
}
```

整条链路上，日历日期都保持为 `YYYY-MM-DD` 字符串：

```
<input type="date"> 的值 "2026-10-30"
  → Zod: z.iso.date()
  → 请求体 "dueDate": "2026-10-30"
  → Ajv: format "date"
  → Drizzle: date({ mode: "string" })   ← 不经过 JS Date
  → Postgres: date
  → 响应 "dueDate": "2026-10-30"
  → formatCalendarDate()
```

服务端测试里有一行验证往返：`expect(task).toMatchObject({ dueDate: "2026-10-30" })`。

> 「是否逾期」这类判断要用**用户所在时区的今天**去比较：上海用户的 10 月 30 日比纽约用户早结束 12 小时。如果逾期判断在服务端做（比如发提醒邮件），服务端需要知道用户的时区——这又是一个需要进契约的字段。

---

## 12.9 枚举

### 规范

1. **枚举值用小写字符串**（`"todo"`），不用数字（`0`）。数字枚举在日志、数据库、调试时都不可读，而且插入新值时容易错位；
2. **契约枚举与数据库枚举分开定义**。契约的 `TaskStatus` 和数据库的 `pgEnum("task_status")` 是两份声明——它们服务于不同的演进节奏（数据库枚举的 `ALTER TYPE … ADD VALUE` 和删除值都有限制）。两者的一致性**由类型系统检查**：第 4.7 节加 `urgent` 的实验里，Drizzle 的类型立刻指出了契约和数据库的不一致；
3. **响应中的枚举可能新增值，客户端必须兜底**。这条规则写进了契约描述（`"新增取值属于契约变更，客户端需对未知值兜底"`），前端实现在 `label()`：

```ts
/** 服务端将来新增的枚举值，旧前端不认识：显示原值，而不是崩溃或显示空白 */
function label<T extends string>(map: Record<T, string>, value: T): string {
  return (map as Record<string, string>)[value] ?? value;
}
```

并且有测试（第 10 章 `TaskList.test.tsx`：服务端返回 `status: "blocked"`，界面显示 `blocked`）。

### 新增一个枚举值的正确顺序

以「任务状态新增 `blocked`」为例：

```
① 数据库迁移：ALTER TYPE task_status ADD VALUE 'blocked'
② 服务端：契约 TaskStatus 加上 blocked，但暂时不产生这个值
   → 旧前端：不受影响
③ 前端：重新生成类型 → STATUS_LABEL 编译失败 → 加上「受阻」标签 → 发布
④ 服务端：开始产生 blocked 状态
   → 还没刷新的旧前端：显示原值 "blocked"（兜底），不会崩溃
```

请求方向的枚举是另一回事：服务端**接受**的枚举值新增一个，对旧客户端完全兼容（它们不会发送新值）；**删除**一个接受的值则是破坏性的。

---

## 12.10 数字、金额与 null

### 数字

- **超过 2^53 的整数用字符串传输**。JSON 本身不限制数字大小，但 JavaScript 的 `number` 只能精确表示到 `2^53 - 1`。`9007199254740993` 解析后会变成 `9007199254740992`。数据库的 `bigint` 主键、雪花 ID 都要以字符串形式出现在契约里；
- **金额用整数（分）或十进制字符串**，不用浮点数。`0.1 + 0.2 !== 0.3`。《Drizzle ORM》用的是「分」存整数（`priceCents`）；
- 我们的 `version` 是普通整数，`limit` 有上限，都在安全范围内。

### null 与「不存在」

| 位置           | 规范                                    | TaskFlow 中的体现                             |
| -------------- | --------------------------------------- | --------------------------------------------- |
| **响应**       | 字段**总是存在**；没有值用 `null`       | `Task.description: string \| null`，必填      |
| **创建请求**   | 可以省略（用默认值），也可以显式 `null` | `CreateTaskBody.description?: string \| null` |
| **PATCH 请求** | **省略 = 不修改**，**`null` = 清空**    | `UpdateTaskBody` 全部可选                     |

响应字段总是存在，前端就不需要区分 `undefined` 和 `null` 两种「空」。PATCH 的语义则依赖「省略」和「`null`」的区别：

```json
{ "title": "新标题" }                 // 只改标题，描述不动
{ "description": null }              // 清空描述
{ "dueDate": "2026-11-15" }          // 修改截止日
```

服务端实现靠 `...patch` 展开：JSON 里没有出现的键在对象里就不存在，Drizzle 的 `.set()` 只更新出现的字段。

> 前端表单的空值（`""`）在 `toCreateTaskBody` 里被转换成 `null`（第 5 章），这就是「表单形状 → 契约形状」的一部分。

---

## 12.11 把规范写下来：TaskFlow 契约规范

把本章和前面各章的约定汇总成一份团队规范，放进仓库（比如 `docs/api-guidelines.md`），评审契约变更时逐条对照：

| 领域         | 规范                                                                             | 自动检查                     |
| ------------ | -------------------------------------------------------------------------------- | ---------------------------- |
| 权威来源     | `apps/api/src/contract` 中的 TypeBox schema；`openapi.json` 和前端类型都是生成物 | `contract:check`             |
| 依赖方向     | `apps/web` 只依赖 `@taskflow/api-client`                                         | `boundaries:check`           |
| 命名         | 路径小写复数名词；字段 camelCase；`operationId` 动词开头且唯一                   | 契约元测试                   |
| ID           | UUID 字符串                                                                      | schema `format: uuid`        |
| 时间点       | `date-time`，UTC，带 `Z`，毫秒精度                                               | 契约测试                     |
| 日历日期     | `date`，`YYYY-MM-DD`，全程不经过 `Date`                                          | 往返测试                     |
| 枚举         | 小写字符串；响应枚举可能新增，客户端必须兜底                                     | `satisfies Record`；兜底测试 |
| 大整数、金额 | 字符串 / 整数分                                                                  | 评审                         |
| null         | 响应字段总是存在；PATCH 省略=不改、null=清空                                     | schema                       |
| 错误         | 统一 `ErrorResponse`；每个接口声明所有错误状态码；500 不含内部细节               | 契约元测试；500 测试         |
| 分页         | `{ items, nextCursor }`；不透明游标；`limit` 1~100；稳定排序                     | 翻页测试                     |
| 写请求       | CSRF 头；创建类按业务决定幂等键；更新用 `If-Match`                               | 安全方案；测试               |
| 演进         | 默认兼容演进；破坏性变更需评审并走 `/v2` 或「扩展-迁移-收缩」                    | oasdiff                      |
| 弃用         | `deprecated: true` + `Deprecation` / `Sunset` / `Link` 头 + 监控调用量           | 测试                         |

---

## 12.12 本章练习

1. **判断兼容性**：下列变更哪些是破坏性的？(a) `Task` 新增 `assigneeId: string | null`；(b) `CreateTaskBody.priority` 从可选改为必填；(c) `title` 上限从 120 改为 200；(d) `TaskStatus` 删除 `doing`；(e) 列表默认排序从创建时间倒序改为正序。
2. **体验精度问题**：把 `schema.ts` 里 `createdAt` 的 `precision: 3` 去掉，生成迁移；在测试里用**一个事务**插入 10 条任务（同一事务内 `now()` 相同，而且大概率不是整毫秒），用 `limit=3` 翻页，观察第二页为什么是空的。做完记得恢复。
3. **时区实验**：在浏览器开发者工具里把时区模拟为 `America/New_York`，对比 `new Date("2026-10-30").toLocaleDateString()` 和 `formatCalendarDate("2026-10-30")` 的输出。
4. **弃用一个字段**：用「扩展-迁移-收缩」把 `Task.description` 改名为 `Task.notes`，写出三个阶段各自的契约和代码改动。

---

## 12.13 本章验收清单

- [ ] 能解释为什么「同时发布」是错觉，以及新旧客户端/服务端的四种组合；
- [ ] 能区分兼容与破坏性变更，知道 `additionalProperties: false` 带来的部署顺序约束；
- [ ] 知道 URL 主版本与 `info.version` 的区别，会用「扩展-迁移-收缩」完成重命名；
- [ ] 弃用接口：契约 `deprecated`、`Deprecation`/`Sunset`/`Link` 响应头、监控调用量；
- [ ] CI 中有 oasdiff 破坏性变更检测；
- [ ] 分页契约：`{ items, nextCursor }`、不透明游标、稳定唯一排序、`limit` 上限、无 count、非法游标 400，并有「不重不漏」测试；
- [ ] 能说明时间列为什么要毫秒精度；
- [ ] 能区分时间点、日历日期、本地时间，并知道 `new Date("YYYY-MM-DD")` 的陷阱；
- [ ] 枚举用字符串，契约与数据库分开定义但由类型检查保持一致，客户端对未知值兜底；
- [ ] 大整数和金额的传输规范；响应字段总是存在，PATCH 区分省略与 `null`；
- [ ] 团队有一份书面的契约规范，并尽可能自动化检查。

---

上一章：[← 第 11 章：幂等键与并发更新](./11-idempotency-and-concurrency.md) ｜ 下一章：[第 13 章：综合实战与逐项验收 →](./13-capstone-and-acceptance.md)
