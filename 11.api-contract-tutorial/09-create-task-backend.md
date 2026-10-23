# 第 9 章：创建任务（上）：服务端链路

> 本章目标：完成练习 2 的服务端部分——`Fastify schema → AuthZ → Drizzle → Postgres`。重点是**授权**（谁能在哪个项目里创建任务、拒绝时返回 403 还是 404）、**Service 层**的职责、**数据库行到契约 DTO 的映射**，以及**唯一约束冲突如何变成一个能映射到表单字段的 409**。
>
> 对应动手练习：**练习 2（服务端部分）**。
> 对应核心概念：**③ 服务端信任边界**、**⑥ 创建类动作的幂等（本章只用，第 11 章细讲）**。

---

## 9.1 需求与验收标准

「创建任务」的业务规则：

1. 必须登录（否则 401）；
2. 必须是项目成员，且角色是 `owner` 或 `editor`；
   - 不是成员（或项目不存在）：404；
   - 是只读成员 `viewer`：403；
3. 请求体符合契约（否则 400，带字段错误）；
4. 同一项目中，**未完成**的任务标题不能重复，忽略大小写（否则 409，错误落在 `title` 字段上）；
5. `status` 固定为 `todo`，`createdBy` 是当前用户，`version` 从 1 开始——客户端无权指定；
6. 必须带 `Idempotency-Key`；同一个键重复提交只创建一次（第 11 章）；
7. 成功返回 201、完整的 `Task`、`Location` 和 `ETag` 头。

每一条都会有对应的自动化测试。

---

## 9.2 一次请求在 Fastify 里的生命周期

在写业务代码之前，先搞清楚各个检查发生在哪个阶段。Fastify 的请求生命周期（只列出我们用到的部分）：

```
请求到达
  │
  ├─ genReqId                     生成/采纳 requestId（第 6 章）
  │
  ├─ onRequest 钩子               @fastify/cors（跨源时处理预检）
  │                               authPlugin：读 Cookie → request.auth
  │                                           写请求：Origin 校验、CSRF 校验 → 403
  │
  ├─ 解析请求体                    JSON 语法错误 → 400 BAD_REQUEST
  │
  ├─ 校验（Ajv）                   params / querystring / headers / body → 400 VALIDATION_FAILED
  │
  ├─ handler                      requireAuth → 401
  │    └─ Service                 授权 → 404 / 403
  │         └─ 事务               幂等键、INSERT、唯一冲突 → 409 / 422
  │
  ├─ 序列化                        按 response[状态码] schema 输出
  │
  └─ onSend 钩子                   写回 X-Request-Id
```

一个值得注意的顺序问题：**认证（`requireAuth`）在 handler 的第一行，而 Ajv 校验在它之前**。这意味着「未登录 + 请求体非法」的请求会得到 400 而不是 401。

这样可以接受吗？对本项目来说可以：校验错误只会透露字段名和规则，而这些本来就公开写在 OpenAPI 里；Ajv 校验的开销也很小。CSRF 校验在 `onRequest` 阶段，早于一切，所以「伪造的写请求」不会走到校验和业务逻辑。

如果你的团队希望「未登录一律先 401」，可以把认证改成路由级的 `preValidation` 钩子：

```ts
app.post(
  "/projects/:projectId/tasks",
  {
    preValidation: async (request) => {
      requireAuth(request);
    }, // 在 Ajv 校验之前执行
    schema: {
      /* … */
    },
  },
  handler,
);
```

两种做法都对，关键是**团队统一一种**，并且用测试固定下来。

---

## 9.3 认证 vs 授权

两个容易混淆的词：

- **认证（Authentication, AuthN）**：你是谁？——会话 Cookie 解决，失败返回 **401**；
- **授权（Authorization, AuthZ）**：你能做这件事吗？——要看你和资源的关系，失败返回 **403**（或 404）。

授权逻辑放在哪里？

| 位置                   | 是否合适     | 原因                                                         |
| ---------------------- | ------------ | ------------------------------------------------------------ |
| 前端（隐藏按钮）       | 只能做体验   | 可被绕过（第 5 章）                                          |
| 路由 handler           | 不推荐       | 每个路由各写一遍，容易漏                                     |
| **Service 层**         | ✅           | 业务规则的一部分；所有入口（HTTP、脚本、队列消费者）都经过它 |
| 数据库（RLS 行级安全） | 可以作为补充 | 适合多租户的强隔离，但调试复杂，本教程不展开                 |

### 403 还是 404？

当用户无权访问一个资源时，返回 403 还是 404？这是一个**安全决策**：

| 情况                     | 返回    | 理由                                                                   |
| ------------------------ | ------- | ---------------------------------------------------------------------- |
| 项目不存在               | 404     | 事实如此                                                               |
| 项目存在，但用户不是成员 | **404** | 如果返回 403，攻击者就能通过「403 vs 404」探测哪些项目 ID 是真实存在的 |
| 用户是成员，但只读       | **403** | 用户本来就能看到这个项目，告诉他「没权限」是有用且无害的信息           |

所以规则是：**对「看不见」的资源说 404，对「看得见但不能改」的资源说 403**。而且非成员和不存在的项目必须返回**完全相同**的响应（状态码、错误码、文案都一样），否则文案差异本身就泄露了信息。

**`apps/api/src/services/access.ts`**：

```ts
import { and, eq } from "drizzle-orm";
import { projectMembers } from "../db/schema";
import type { Db } from "../db/types";
import { forbidden, notFound } from "../domain/errors";

export type MemberRole = "owner" | "editor" | "viewer";

export async function findRole(
  db: Db,
  projectId: string,
  userId: string,
): Promise<MemberRole | null> {
  const [row] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
      ),
    )
    .limit(1);
  return row?.role ?? null;
}

/**
 * 授权决策集中在这里，路由与前端都不做最终判断。
 *
 * - 不是成员：一律 404。不让外人通过 403/404 的差异探测「这个项目是否存在」；
 * - 是成员但权限不够：403。他本来就能看到项目，告诉他「没权限」是有用的信息。
 */
export async function assertCanRead(db: Db, projectId: string, userId: string) {
  const role = await findRole(db, projectId, userId);
  if (!role) throw notFound("项目");
  return role;
}

export async function assertCanWrite(
  db: Db,
  projectId: string,
  userId: string,
) {
  const role = await assertCanRead(db, projectId, userId);
  if (role === "viewer") throw forbidden("只读成员不能创建或修改任务");
  return role;
}
```

注意 `findRole` 只查 `project_members`，**不单独查 `projects` 表**。项目不存在时，自然也不会有成员记录，`role` 为 `null` → 404。一次查询同时回答了「项目存在吗」和「你是成员吗」，并且两种情况天然无法区分。

### 越权访问（IDOR）

还有一种常见漏洞叫 **IDOR（Insecure Direct Object Reference，不安全的直接对象引用）**：接口根据 URL 里的 ID 直接操作资源，却没有检查当前用户和这个资源的关系。

比如 `PATCH /tasks/:taskId`，只要知道任务 ID 就能改别人项目里的任务。UUID 让 ID 难以猜测，但**难以猜测不等于安全**——ID 会出现在日志、分享链接、浏览器历史里。

我们通过任务 ID 读取任务时，**在同一条 SQL 里**连接成员表（**`apps/api/src/services/task-service.ts`**）：

```ts
/** 按任务 ID 读取，同时拿到当前用户在该项目里的角色；不是成员就当作不存在 */
async function loadTaskWithRole(db: Db, userId: string, taskId: string) {
  const [row] = await db
    .select({ task: tasks, role: projectMembers.role })
    .from(tasks)
    .innerJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, tasks.projectId),
        eq(projectMembers.userId, userId),
      ),
    )
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!row) throw notFound("任务");
  return row;
}
```

`INNER JOIN` 的语义保证了：任务不存在、或任务存在但当前用户不是其项目成员，结果都是空 → 404。不存在「先查任务、再查权限」之间被遗漏的分支。

---

## 9.4 Service：创建任务

Service 层回答「**为什么做这些动作**」：授权、业务规则、事务边界。它不关心 HTTP（不读请求头、不设状态码），所以将来批量导入脚本或消息队列消费者也能复用它。

**`apps/api/src/services/task-service.ts`**（创建部分）：

```ts
const OPEN_TITLE_UQ = "tasks_project_open_title_uq";

export interface CreateResult {
  task: Task;
  replayed: boolean;
}

export async function createTask(
  db: Db,
  userId: string,
  projectId: string,
  input: CreateTaskBody,
  idempotencyKey: string,
): Promise<CreateResult> {
  await assertCanWrite(db, projectId, userId);

  const scope = `createTask:${projectId}`;
  const requestHash = createHash("sha256")
    .update(stableStringify(input))
    .digest("hex");

  try {
    return await db.transaction(async (tx) => {
      // ① 先「占」幂等键（细节见第 11 章）
      const [claimed] = await tx
        .insert(idempotencyKeys)
        .values({
          userId,
          key: idempotencyKey,
          scope,
          requestHash,
          responseStatus: 0,
          responseBody: {},
        })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key });

      if (!claimed) {
        // ② 键已被使用：同内容 → 重放；不同内容 → 422（第 11 章）
        // ……
      }

      // ③ 真正创建。服务端决定 status / createdBy / version，客户端无权指定
      const [row] = await tx
        .insert(tasks)
        .values({
          projectId,
          title: input.title.trim(),
          description: input.description ?? null,
          priority: input.priority ?? "medium",
          dueDate: input.dueDate ?? null,
          createdBy: userId,
        })
        .returning();
      if (!row) throw new Error("插入任务后没有返回行");
      const task = toTaskDto(row);

      // ④ 把响应和键存在同一事务里：要么都成功，要么都回滚
      await tx
        .update(idempotencyKeys)
        .set({ responseStatus: 201, responseBody: task })
        .where(
          and(
            eq(idempotencyKeys.userId, userId),
            eq(idempotencyKeys.key, idempotencyKey),
          ),
        );
      return { task, replayed: false };
    });
  } catch (err) {
    if (isUniqueViolation(err, OPEN_TITLE_UQ)) {
      throw fieldConflict("title", "该项目中已有同名的未完成任务");
    }
    throw err;
  }
}
```

### 为什么授权在事务外面

`assertCanWrite` 在事务开始前执行。授权失败时，不需要开启事务、不占用连接。理论上，授权检查和插入之间成员关系可能被撤销（「检查时可以，执行时不行了」的 TOCTOU 问题），对于「创建任务」这种业务可以接受；如果是转账之类的场景，就要把权限检查放进事务并对成员行加锁。

### 唯一冲突 → 409 字段错误

「同一项目中未完成任务标题不重复」由数据库的**部分唯一索引**保证：

```sql
CREATE UNIQUE INDEX "tasks_project_open_title_uq"
  ON "tasks" ("project_id", lower("title"))
  WHERE "status" <> 'done';
```

为什么不在插入前先查一下「有没有同名任务」？因为两个请求可能同时查询、都发现没有、然后都插入成功——经典的竞态。**唯一性只能由数据库保证**，应用层能做的是：把数据库的冲突错误翻译成对用户有意义的响应。

**`apps/api/src/db/errors.ts`**：

```ts
import { DrizzleQueryError } from "drizzle-orm";

type PgErrorLike = { code?: string; constraint?: string };

/** Drizzle 把驱动错误包在 DrizzleQueryError.cause 里，这里统一取出原始错误 */
function unwrap(err: unknown): PgErrorLike | undefined {
  const inner = err instanceof DrizzleQueryError ? err.cause : err;
  if (typeof inner === "object" && inner !== null && "code" in inner) {
    return inner as PgErrorLike;
  }
  return undefined;
}

/** 只认「指定约束」的唯一冲突，别把所有 23505 都翻译成同一句话 */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = unwrap(err);
  return e?.code === "23505" && e.constraint === constraint;
}
```

`23505` 是 Postgres 的唯一冲突错误码。**一定要同时检查约束名**：一张表将来可能有多个唯一约束，把所有 23505 都翻译成「标题重复」会产生误导性的错误信息。没被识别的数据库错误继续向上抛，最终由错误处理器变成 500——它是 bug，应该被告警。

翻译后的错误（第 6 章的 `fieldConflict`）：

```ts
export const fieldConflict = (path: string, message: string) =>
  new AppError(409, "CONFLICT", message, {
    fields: [{ in: "body", path, rule: "unique", message }],
  });
```

带上 `fields` 之后，前端可以把这个 409 显示在标题输入框下面，体验和客户端校验一模一样（第 10 章）。

---

## 9.5 DTO 映射：数据库行 → 契约

```ts
type TaskRow = typeof tasks.$inferSelect;

/**
 * 数据库行 → 契约 DTO。显式列出每个字段：
 * 新增数据库列不会「顺手」泄露到 API；Date 在这里统一转成 UTC ISO 字符串。
 */
export function toTaskDto(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    createdBy: row.createdBy,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

这个看似啰嗦的函数有三个作用：

1. **类型闸门**：返回类型是契约的 `Task`（来自 TypeBox 的 `Static`）。数据库列类型和契约类型对不上时（比如第 4.7 节加 `urgent` 的实验），这里或调用处会编译失败；
2. **显式白名单**：将来 `tasks` 表加了 `internalNotes` 列，它不会自动出现在 API 里。要暴露它，必须同时改契约和这个函数——这是一个有意识的决定；
3. **序列化规范的唯一执行点**：所有时间点在这里统一 `toISOString()`，输出 `2026-10-22T08:30:00.000Z` 格式（第 12 章）。`dueDate` 是 `date({ mode: "string" })`，直接就是 `"2026-10-30"`，不经过 `Date` 对象，避免时区偏移。

> 第 3 章提到 Fastify 的响应 schema 本身就是白名单，那 `toTaskDto` 是不是多余？不是。序列化白名单是「最后一道」防线，而且它是**静默**的；DTO 映射是「第一道」，而且**在代码审查时可见**。

---

## 9.6 路由：把各层接起来

路由代码在第 3 章已经完整展示过。回顾创建任务的 handler：

```ts
async (request, reply) => {
  const { user } = requireAuth(request); // 401
  const { task, replayed } = await createTask(
    // 404 / 403 / 409 / 422
    db,
    user.id, // 来自会话，不来自请求体
    request.params.projectId, // 已被 Ajv 校验为 UUID
    request.body, // 已被 Ajv 校验为 CreateTaskBody
    request.headers["idempotency-key"], // 已被 Ajv 校验为 UUID
  );
  if (replayed) reply.header("idempotent-replayed", "true");
  return reply
    .code(201)
    .header("location", `/api/v1/tasks/${task.id}`) // 新资源的地址
    .header("etag", `"${task.version}"`) // 当前版本，供后续 If-Match 使用
    .send(task);
};
```

handler 很薄：**认证 → 调 Service → 组装 HTTP 响应**。HTTP 相关的东西（状态码、响应头）只出现在这里，业务规则只出现在 Service 里。

---

## 9.7 测试服务端链路

### 测试基础设施

每个测试文件一套独立的内存数据库，运行**和生产完全相同的迁移文件**（**`apps/api/test/helpers.ts`**）：

```ts
export async function createTestApp() {
  const client = new PGlite();
  const db = drizzle({ client });
  await migrate(db, { migrationsFolder: "./drizzle" });

  // 种子数据：alice 是 owner，bob 是 viewer，carol 不是成员
  const [alice, bob, carol] = await db.insert(users).values([...]).returning();
  const [project] = await db.insert(projects).values({ name: "Launch" }).returning();
  await db.insert(projectMembers).values([
    { projectId: project.id, userId: alice.id, role: "owner" },
    { projectId: project.id, userId: bob.id, role: "viewer" },
  ]);

  const config: AppConfig = {
    webOrigins: [WEB_ORIGIN],  // 测试里开启 CORS，以便测预检
    cookieSecure: false,
    logLevel: "info",
    sessionTtlMs: 60 * 60 * 1000,
    exposeDocs: false,
  };
  const logs = memoryLogger();
  const app = await buildApp({ db, config, logger: logs.logger });

  /** 以某个用户登录，返回之后请求要带的 cookie 与 CSRF 头 */
  async function loginAs(email: string) {
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email } });
    const sid = res.cookies.find((c) => c.name === "sid");
    const { csrfToken } = res.json() as { csrfToken: string };
    return { cookies: { sid: sid!.value }, headers: { "x-csrf-token": csrfToken }, setCookie: sid! };
  }

  return { app, db, logs: logs.lines, projectId: project.id, loginAs, close: /* … */ };
}
```

`app.inject()` 在进程内模拟 HTTP 请求，**经过完整的 Fastify 生命周期**（钩子、校验、序列化、错误处理），但不需要监听端口。它测试的是真实的 HTTP 行为，而不是直接调用 Service 函数。

### 覆盖每一条验收标准

**`apps/api/test/api.test.ts`**（节选）：

```ts
describe("创建任务：成功路径", () => {
  it("201 + Location + ETag，响应符合 Task 契约，服务端决定 status/version", async () => {
    const res = await createTask(alice, {
      title: "  写发布说明  ",
      priority: "high",
      dueDate: "2026-10-30",
    });
    expect(res.statusCode).toBe(201);
    const task = res.json();
    assertMatchesSchema("Task", task); // 契约测试
    expect(task).toMatchObject({
      title: "写发布说明", // 服务端 trim 了
      status: "todo", // 服务端决定
      priority: "high",
      dueDate: "2026-10-30", // 日历日期原样往返
      version: 1, // 服务端决定
    });
    expect(task.createdAt).toMatch(/Z$/); // UTC
    expect(res.headers.location).toBe(`/api/v1/tasks/${task.id}`);
    expect(res.headers.etag).toBe('"1"');
  });
});

describe("403 / 404：授权", () => {
  it("只读成员创建 → 403", async () => {
    const res = await createTask(bob, { title: "bob 想建任务" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("非成员与不存在的项目得到完全相同的 404", async () => {
    const notMember = await createTask(carol, { title: "carol" });
    const missing = await createTask(
      alice,
      { title: "x" },
      { projectId: randomUUID() },
    );
    expect(notMember.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(notMember.json().error.message).toBe(missing.json().error.message);
  });
});

describe("409：唯一性冲突", () => {
  it("同项目未完成任务重名（忽略大小写）→ 409 + 字段级错误", async () => {
    await createTask(alice, { title: "Deploy" });
    const res = await createTask(alice, { title: "deploy" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: "CONFLICT",
      fields: [{ in: "body", path: "title", rule: "unique" }],
    });
  });
});
```

再加上第 5 章的绕过测试、第 6 章的 400/500 测试、第 8 章的 401/CSRF 测试，「创建任务」的每一个分支都被覆盖了：

| 验收标准                        | 测试                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| 未登录 401                      | `401 / requestId`                                             |
| 非成员 / 不存在 404，且无法区分 | `非成员与不存在的项目得到完全相同的 404`                      |
| 只读 403                        | `只读成员创建 → 403`                                          |
| 越权修改（IDOR）404             | `非成员修改任务 → 404`                                        |
| 契约校验 400 + 字段             | `空标题`、`缺少必填字段`、`绕过前端…`                         |
| 重名 409 + 字段                 | `同项目未完成任务重名`                                        |
| 服务端决定字段                  | `201 + Location + ETag…`、`偷塞 status / createdBy / version` |
| 幂等                            | 第 11 章                                                      |
| CSRF                            | `缺少 X-CSRF-Token`、`不受信任 Origin`                        |

运行：

```bash
pnpm --filter @taskflow/api test
#  ✓ test/errors.test.ts (2 tests)
#  ✓ test/api.test.ts (26 tests)
#  Test Files  2 passed (2)
#       Tests  28 passed (28)
```

> **PGlite 的边界**：PGlite 是单连接的进程内数据库，非常适合验证 SQL 语义、约束和单请求行为。但它无法证明「两个独立连接并发时」的行为（比如两个请求同时用同一个幂等键）。那类测试需要真实的 Postgres，《Drizzle ORM 从 0 到 1》第 12 章有完整示例。

---

## 9.8 本章练习

1. **验证 IDOR 防护**：阅读测试 `非成员修改任务 → 404`，然后用 `curl` 以 carol 身份直接 `PATCH /api/v1/tasks/<alice 的任务 ID>`，分别带和不带 `If-Match`，确认两次都是 404。想一想：如果「缺少 If-Match → 428」的检查放在授权之前，会泄露什么？（配套工程最初就是这样写的，后来被这个测试纠正了顺序。）
2. **体会约束名检查**：把 `isUniqueViolation(err, OPEN_TITLE_UQ)` 改成只检查 `code === "23505"`。现在测试仍然通过——但如果将来给 `tasks` 表再加一个唯一约束（比如「外部系统同步 ID」），用户会看到什么错误提示？为什么幂等键表的主键冲突不会走到这里？（提示：`onConflictDoNothing`。）
3. **改变授权策略**：如果产品要求「editor 只能创建任务，不能修改别人创建的任务」，你会改哪个文件？需要新增什么测试？
4. **顺序实验**：不登录，发送一个空标题的创建请求，观察返回的是 400 还是 401；尝试改成 `preValidation` 认证，再观察一次。

---

## 9.9 本章验收清单

- [ ] 能画出 Fastify 请求生命周期中各项检查的位置（CSRF → 解析 → 校验 → 认证 → 授权 → 业务）；
- [ ] 能区分认证与授权，并说明授权为什么放在 Service 层；
- [ ] 能解释「看不见说 404，看得见但不能改说 403」，并保证非成员与不存在的响应完全一致；
- [ ] 用 `INNER JOIN` 成员表防止 IDOR；
- [ ] 唯一性由数据库保证，冲突按**约束名**翻译成带 `fields` 的 409；
- [ ] `toTaskDto` 显式映射每个字段，时间统一转 UTC ISO 字符串；
- [ ] handler 只做「认证 → 调 Service → 组装 HTTP 响应」；
- [ ] 每一条验收标准都有对应的 `inject` 测试，且成功响应通过契约校验。

---

上一章：[← 第 8 章：Cookie、CORS、预检、CSRF 与代理](./08-cookies-cors-csrf.md) ｜ 下一章：[第 10 章：创建任务（下）：前端链路与错误 UI →](./10-create-task-frontend.md)
