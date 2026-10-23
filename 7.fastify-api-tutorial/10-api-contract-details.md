# 第 10 章：API 契约细节——方法与状态码、分页排序、请求 ID、并发控制

[上一章](./09-error-model.md) · [目录](./README.md) · [下一章](./11-openapi-with-fastify-swagger.md)

一个 API 能不能被放心使用，往往取决于许多“小约定”：创建成功返回什么？列表怎么翻页？两次翻页之间有人新增了数据会怎样？出了问题怎么定位？本章把 TaskHub 在这些问题上的约定逐一写清楚，并说明背后的理由。

## 10.1 资源、方法与状态码

TaskHub 遵循常见的 REST 风格：URL 表示**资源**（名词、复数），HTTP 方法表示**动作**。

| 操作     | 方法与路径                 | 成功状态码 | 响应体          | 关键响应头     |
| -------- | -------------------------- | ---------- | --------------- | -------------- |
| 列表     | `GET /v1/tasks`            | 200        | `TaskList`      | —              |
| 详情     | `GET /v1/tasks/:taskId`    | 200        | `Task`          | `ETag`         |
| 创建     | `POST /v1/tasks`           | **201**    | 新建的 `Task`   | **`Location`** |
| 部分修改 | `PATCH /v1/tasks/:taskId`  | 200        | 修改后的 `Task` | `ETag`         |
| 删除     | `DELETE /v1/tasks/:taskId` | **204**    | 无              | —              |

几个约定的理由：

- **创建返回 201 + `Location`**：告诉客户端新资源的地址，客户端不用自己拼 URL。TaskHub 用 `app.prefix` 拼出 `/v1/tasks/<id>`，版本前缀不写死在业务代码里。同时返回完整的新资源，客户端拿到服务端生成的 `id`、`createdAt` 后不必再查一次。
- **PATCH 而不是 PUT**：PUT 的语义是“用请求体整体替换资源”，客户端必须传全部字段；PATCH 是“只改我传的字段”。TaskHub 的修改是部分的，所以用 PATCH，schema 里所有字段都是 `Optional`，再用 `minProperties: 1` 要求至少传一个。
- **删除返回 204**：没有需要返回的内容。
- **幂等性**：`GET`、`PUT`、`DELETE` 按 HTTP 语义应当是幂等的（重复执行结果相同）；`POST` 不是。TaskHub 的 DELETE 第二次调用会得到 404——资源状态仍然是“不存在”，这符合幂等的定义（幂等说的是服务端状态，不是响应完全相同）。网络重试 POST 可能创建出重复任务；“同名任务冲突”规则恰好在这里也起了保护作用，更通用的做法是支持 `Idempotency-Key` 请求头（见第 15 章练习）。

### 字段的约定

- **时间**：一律 ISO 8601、UTC，如 `2026-01-05T09:00:00.000Z`，schema 中为 `format: 'date-time'`。不要返回时间戳数字或本地时间字符串，让客户端自己按时区展示。
- **ID**：UUID 字符串。不要用自增整数暴露数据量，也避免客户端把 ID 当数字处理导致精度问题。
- **`null` 与“不存在”**：TaskHub 的响应中，可空字段**始终出现**，值为 `null`（如 `"assigneeId": null`），schema 中它们都在 `required` 里。客户端不用区分“字段缺失”和“值为空”。请求中则相反：PATCH 里**不传**表示“不修改”，传 `null` 表示“清空”。
- **枚举**：小写字符串（`todo`/`doing`/`done`），而不是数字代码。

## 10.2 分页契约

“返回列表”看似简单，实则必须回答一串问题。TaskHub 的契约如下：

**请求**（`GET /v1/tasks`）

| 参数         | 类型    | 默认         | 约束            | 说明                       |
| ------------ | ------- | ------------ | --------------- | -------------------------- |
| `page`       | integer | 1            | ≥ 1             | 页码，从 1 开始            |
| `pageSize`   | integer | 20           | 1~100           | 每页条数，超过上限返回 400 |
| `sort`       | enum    | `-createdAt` | 6 个可选值      | 排序字段，`-` 前缀表示降序 |
| `status`     | enum    | —            | todo/doing/done | 按状态筛选                 |
| `assigneeId` | uuid    | —            | —               | 按负责人筛选               |

未知参数会被移除（`additionalProperties: false`），不会报错。

**响应**

```json
{
  "items": [{ "id": "...", "title": "...", "...": "..." }],
  "page": { "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 }
}
```

### 为什么要有上限？

没有上限的列表接口，等于给了任何人一个“让数据库一次读出全部数据”的按钮。哪怕客户端是你自己写的前端，也可能因为一个 bug 传了 `pageSize=100000`。上限写在 schema 里，超出时在进入 handler 之前就被拒绝，而且上限值会出现在 API 文档中。

### 为什么要有稳定的排序？

假设按 `createdAt` 排序，而有两条任务的 `createdAt` 完全相同。数据库不保证它们之间的相对顺序，第 1 页的最后一条和第 2 页的第一条可能**是同一条**，或者某一条**永远不会出现**。

TaskHub 的规则是：主排序字段相同时，按 `id` 升序作为**第二排序键**：

```ts
// src/data/memory-store.ts
function compareTasks(sort: TaskSort) {
  const descending = sort.startsWith("-");
  const field = (descending ? sort.slice(1) : sort) as
    | "createdAt"
    | "priority"
    | "title";
  return (a: TaskRecord, b: TaskRecord): number => {
    let result: number;
    if (field === "priority")
      result = priorityRank[a.priority] - priorityRank[b.priority];
    else result = a[field].localeCompare(b[field]);
    if (descending) result = -result;
    // 主排序字段相同的时候按 id 排，保证翻页时顺序稳定、不会重复或漏数据
    return result !== 0 ? result : a.id.localeCompare(b.id);
  };
}
```

换成 SQL 就是 `ORDER BY created_at DESC, id ASC`。配套测试逐页翻完所有数据，断言既不重复也不遗漏：

```ts
it("querystring 中的数字字符串会被转换成整数，翻页时不重复不遗漏", async () => {
  const app = await appWithTasks(5);
  const seen: string[] = [];
  for (const page of ["1", "2", "3"]) {
    const response = await app.inject({
      url: "/v1/tasks",
      query: { page, pageSize: "2", sort: "title" },
      headers: bearer("alice"),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.page.page).toBe(Number(page)); // 是数字，不是字符串
    seen.push(...body.items.map((task: { title: string }) => task.title));
  }
  expect(seen).toEqual([
    "任务 01",
    "任务 02",
    "任务 03",
    "任务 04",
    "任务 05",
    "准备周会材料",
  ]);
});
```

### 为什么排序字段要用白名单？

排序字段来自 URL，如果服务端把它直接拼进 SQL（`ORDER BY ${sort}`），就是一个 SQL 注入点；即使用 ORM，也可能让客户端按一个没有索引的字段、甚至一个内部字段（如 `internalNote`）排序，间接探测数据。`sort` 用 `Type.Enum` 声明了六个合法值，其他值一律 400：

```ts
it("pageSize 超过上限、sort 不在白名单时返回 400", async () => {
  // ...
  const badSort = await app.inject({
    url: "/v1/tasks?sort=internalNote",
    headers: bearer("alice"),
  });
  expect(badSort.statusCode).toBe(400);
  expect(badSort.json().details[0]).toMatchObject({
    field: "/sort",
    rule: "enum",
  });
});
```

### 筛选与权限的关系

列表接口最容易出现的安全问题，是**筛选条件替代了权限条件**。例如客户端传 `assigneeId=<别人的 ID>`，如果服务端只按这个条件查询，就会列出别人的任务。TaskHub 的 service 先根据调用者身份加上可见性条件（成员只能看到自己创建或被指派的），**再**叠加客户端的筛选条件：

```ts
const { items, total } = await db.tasks.list({
  ...(actor.role === "admin" ? {} : { visibleTo: actor.id }),
  ...(query.status ? { status: query.status } : {}),
  ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
  sort: query.sort ?? DEFAULT_TASK_SORT,
  page,
  pageSize,
});
```

客户端的筛选只能**缩小**范围，不能扩大。

### 页码分页 vs 游标分页

TaskHub 用的是**页码（offset）分页**：`page=3&pageSize=20` 对应 SQL 的 `LIMIT 20 OFFSET 40`。它的优点是简单，能跳到任意页、能显示总页数；缺点有两个：

1. 页码越大，数据库要跳过的行越多，越慢；
2. 翻页期间有新数据插入，后面的页会整体“错位”，导致重复或遗漏（稳定排序只能解决“相同值”的问题，解决不了这个）。

**游标（cursor）分页**用“上一页最后一条的排序值”作为下一页的起点：`WHERE (created_at, id) < (:lastCreatedAt, :lastId) ORDER BY created_at DESC, id DESC LIMIT 20`。响应里返回一个不透明的 `nextCursor`（通常是这些值的 base64 编码）。它性能稳定、不受插入影响，但不能跳页、通常也不返回总数。

|                 | 页码分页             | 游标分页               |
| --------------- | -------------------- | ---------------------- |
| 跳到第 N 页     | ✅                   | ❌                     |
| 显示总数/总页数 | ✅（需要额外 COUNT） | 通常不提供             |
| 深分页性能      | 越来越慢             | 稳定                   |
| 翻页时数据变化  | 可能重复/遗漏        | 不受影响               |
| 适合            | 后台管理表格         | 信息流、无限滚动、大表 |

无论选哪种，契约都要写明：默认值、上限、排序的稳定性、响应里的分页信息结构。第 15 章的练习会让你为 TaskHub 加一个游标分页的版本。

## 10.3 请求 ID：把一次请求串起来

一次请求会产生多条日志：收到请求、认证、业务操作、错误、完成。线上同时有成百上千个请求，必须有一个 ID 把属于同一请求的日志串起来，并且让客户端也能拿到这个 ID。

Fastify 默认给每个请求分配一个 ID（`req-1`、`req-2`……），日志中的字段名是 `reqId`。这个默认值有两个问题：每次重启都从 1 开始，多实例部署时会重复；而且它不会出现在响应中。TaskHub 做了三处改造。

### 生成：`genReqId`

```ts
// src/logger.ts
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * 生成请求 ID：上游（网关/负载均衡）已经带了合法的 x-request-id 就沿用，否则生成 UUID。
 * Fastify 的 requestIdHeader 选项不会校验头的内容，所以这里自己做格式检查，
 * 防止调用方塞入超长字符串或换行符污染日志。
 */
export function genReqId(req: IncomingMessage): string {
  const incoming = req.headers["x-request-id"];
  if (typeof incoming === "string" && REQUEST_ID_PATTERN.test(incoming))
    return incoming;
  return randomUUID();
}
```

```ts
// src/app.ts
const app = Fastify({ /* ... */ genReqId });
```

为什么要沿用上游的 ID？在真实部署中，请求先经过 API 网关或负载均衡，它们通常已经生成了请求 ID。沿用它，就能把网关日志、TaskHub 日志、下游服务日志用同一个 ID 关联起来（这是分布式追踪的最简单形式）。

为什么不直接用 Fastify 的 `requestIdHeader: 'x-request-id'` 选项？Fastify 文档明确警告：开启它后，**任何调用者都能把请求 ID 设成任意值，Fastify 不做任何校验**。攻击者可以传入超长字符串或包含换行的值来干扰日志。TaskHub 用正则限制了字符集和长度，不合法就生成新的。

如果 TaskHub 直接暴露在公网、前面没有可信的网关，更保守的做法是**完全不接受**外部传入的 ID。

### 回写：`x-request-id` 响应头

第 4 章的 `request-context` 插件在 `onSend` 里把 ID 写回响应头，所以**所有**响应（包括错误响应）都带着它：

```ts
app.addHook("onSend", async (request, reply, payload) => {
  reply.header("x-request-id", request.id);
  return payload;
});
```

### 出现在错误响应体和日志中

错误响应的 `requestId` 字段（第 9 章）和日志中的 `requestId` 字段（第 13 章把默认的 `reqId` 改名为 `requestId`）是同一个值。用户报告“操作失败了，编号是 3b9e…”，你在日志系统里搜索 `requestId:"3b9e…"` 就能看到这个请求的完整经过。

配套测试：

```ts
it("沿用上游传入的合法 x-request-id，忽略不合法的", async () => {
  const app = await createTestApp();
  const kept = await app.inject({
    url: "/healthz",
    headers: { "x-request-id": "gateway-abc-123" },
  });
  expect(kept.headers["x-request-id"]).toBe("gateway-abc-123");

  const replaced = await app.inject({
    url: "/healthz",
    headers: { "x-request-id": "bad id with spaces" },
  });
  expect(replaced.headers["x-request-id"]).not.toBe("bad id with spaces");
});
```

## 10.4 并发修改：ETag 与 If-Match

需求 8 说：两个人同时编辑同一个任务，后提交的人应该被告知“数据已过期”，而不是悄悄覆盖。这是经典的**丢失更新**问题：

```text
Alice 读取任务（标题“周会”）       Bob 读取任务（标题“周会”）
Alice 改标题为“周会材料”并提交 ✅
                                  Bob 改优先级为 high 并提交（基于旧数据）
```

如果 Bob 的客户端发送的是整个对象（PUT），Alice 的修改就被覆盖了。即使是 PATCH，Bob 也是在不知道标题已变的情况下做的决定。

HTTP 标准提供了**条件请求**来解决这个问题：

1. 服务端在响应里给出资源的版本标识 `ETag`；
2. 客户端修改时，在 `If-Match` 请求头里带上它读到的版本；
3. 服务端发现版本已经变了，返回 **412 Precondition Failed**，客户端重新获取后再决定。

TaskHub 的实现：

```ts
/** ETag 必须带双引号（RFC 9110）；内容用内部版本号，不暴露更多信息 */
function etagOf(task: TaskRecord): string {
  return `"${task.version}"`;
}

// GET /tasks/:taskId
reply.header("etag", etagOf(task));

// PATCH /tasks/:taskId —— headers schema 校验 If-Match 的格式
const ifMatch = request.headers["if-match"];
if (ifMatch !== undefined && ifMatch !== etagOf(task)) {
  log.info({ ifMatch, current: etagOf(task) }, "stale update rejected");
  throw new AppError("PRECONDITION_FAILED");
}
const updated = await app.taskService.update(task, request.body);
reply.header("etag", etagOf(updated));
```

数据层每次更新把 `version` 加 1。`version` 本身不在响应体里（`TaskSchema` 没有声明它），只通过 `ETag` 头传递。

`If-Match` 在 TaskHub 中是**可选的**：不带它的 PATCH 照常执行（“我不在乎并发”）。也有 API 选择强制要求，缺失时返回 428 Precondition Required。这是一个契约层面的决定，要写进文档。

> 和第 8 章的“先查再写”一样，在真实数据库上，“读版本、比较、写入”也必须是原子的，例如 `UPDATE tasks SET ..., version = version + 1 WHERE id = :id AND version = :expected`，再根据影响行数判断是否冲突。

## 10.5 本章契约在代码中的位置

| 契约                         | 写在哪里                                      | 由谁保证            |
| ---------------------------- | --------------------------------------------- | ------------------- |
| 分页参数的类型、默认值、上限 | `ListTasksQuerySchema`                        | Ajv（运行时）+ 文档 |
| 排序白名单                   | `TaskSortSchema`                              | Ajv                 |
| 稳定排序                     | `compareTasks`（SQL 中的 `ORDER BY ..., id`） | 数据层 + 测试       |
| 可见性先于筛选               | `taskService.list`                            | 业务层 + 测试       |
| 201 + Location、204          | 路由 handler + 响应 schema                    | 测试                |
| 请求 ID 生成、回写           | `genReqId`、`request-context` 插件            | 测试                |
| ETag / If-Match / 412        | 任务路由 + headers schema                     | 测试                |

能用 schema 表达的都写在 schema 里（运行时强制、自动进文档）；表达不了的（排序稳定性、可见性规则）由代码实现、由测试守护。

## 10.6 练习

1. 客户端请求 `GET /v1/tasks?page=99`，而总共只有 3 条数据。TaskHub 会返回什么？你认为应该返回 404 吗？
2. 为什么 `ETag` 的值要带双引号？如果直接返回 `etag: 3` 会有什么问题？
3. 设计 TaskHub 的游标分页版本：写出请求参数、响应结构，以及在 `-createdAt` 排序下，数据层的查询条件。
4. 有人提议“在每个响应体里都加一个 `requestId` 字段”，而不仅是响应头和错误响应。说说利弊。

**参考答案**

1. 返回 200，`items` 为空数组，`page` 为 `{ page: 99, pageSize: 20, total: 3, totalPages: 1 }`。不建议返回 404：资源集合是存在的，只是这一页没有数据；客户端可以根据 `totalPages` 自行处理。
2. RFC 9110 规定实体标签（entity-tag）的语法是带双引号的字符串（弱标签前面加 `W/`）。不带引号的值不符合规范，严格的客户端、缓存或代理可能无法正确比较。TaskHub 的 `If-Match` schema 也按带引号的格式校验。
3. 请求：`limit`（1~100，默认 20）、`cursor`（可选，不透明字符串）。响应：`{ items, nextCursor: string | null }`。`cursor` 编码上一页最后一条的 `(createdAt, id)`；查询条件为 `createdAt < lastCreatedAt OR (createdAt = lastCreatedAt AND id > lastId)`，排序为 `createdAt DESC, id ASC`（与第二排序键的方向保持一致）。`cursor` 需要校验和解码失败时返回 400。
4. 好处：客户端只拿到 body（例如被某些封装吞掉了响应头）时也能看到 ID。代价：改变了所有成功响应的结构，所有 schema 都要加字段；而响应头已经能覆盖绝大多数场景。TaskHub 的选择是：成功响应用响应头，错误响应在 body 中也带上（因为错误时用户最需要它）。

## 本章验收

- [ ] 能为增删改查选择正确的方法、状态码和响应头（201 + Location、204）。
- [ ] 能写出完整的分页契约：参数、默认值、上限、响应结构、稳定排序、排序白名单。
- [ ] 能解释“可见性条件先于客户端筛选”的必要性。
- [ ] 能比较页码分页与游标分页。
- [ ] 能实现请求 ID 的生成、校验、回写，并说明沿用上游 ID 的条件与风险。
- [ ] 能用 ETag/If-Match/412 实现乐观并发控制。

官方阅读：[Server：genReqId / requestIdHeader](https://fastify.dev/docs/latest/Reference/Server/#genreqid)、[Logging：Request ID Tracking](https://fastify.dev/docs/latest/Reference/Logging/)、[RFC 9110：条件请求与 ETag](https://www.rfc-editor.org/rfc/rfc9110#name-conditional-requests)、[RFC 9110：方法的幂等性](https://www.rfc-editor.org/rfc/rfc9110#name-idempotent-methods)。

下一章，[用 @fastify/swagger 生成 OpenAPI 文档](./11-openapi-with-fastify-swagger.md)。
