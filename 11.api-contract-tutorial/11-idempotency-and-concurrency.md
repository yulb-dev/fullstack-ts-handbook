# 第 11 章：幂等键与并发更新

> 本章目标：根据业务判断哪些动作需要**幂等键（Idempotency-Key）**，并完整实现服务端算法与客户端的键生命周期；再用**版本号 + If-Match** 解决普通更新的「丢失更新」问题。
>
> 对应核心概念：**⑥ 幂等与重复提交：支付类/创建类动作应根据业务定义是否需要 idempotency key；常规更新也需考虑并发。**

---

## 11.1 重复提交从哪里来

「用户点了两次」只是最显眼的一种。完整的来源清单：

| 来源               | 例子                                               | 前端能挡住吗                      |
| ------------------ | -------------------------------------------------- | --------------------------------- |
| 手快双击           | 按钮还没禁用就点了第二下                           | ✅ 提交中禁用按钮                 |
| 并发触发           | 回车提交 + 点击按钮同时发生                        | ✅ 提交回调内加锁                 |
| **响应丢失后重试** | 请求已成功，响应在弱网中丢失，客户端（或用户）重试 | ❌ **前端无从知道第一次是否成功** |
| 网关/代理重试      | 负载均衡器在上游超时后自动重发                     | ❌ 前端根本不知道                 |
| 用户刷新后重新提交 | 「刚才好像没成功，再来一次」                       | ❌                                |

前两种在《可访问设计系统与复杂表单实战》第 7.7 节已经用「UI 禁用 + 提交锁」解决（本项目里 RHF 的 `isSubmitting` 就承担了这个角色）。**后三种的共同点是：客户端不知道服务器上到底发生了什么。** 解决它们只能靠服务端：让「同一个意图」无论到达多少次，都只产生一次效果。这就是**幂等**。

---

## 11.2 哪些动作需要幂等键：这是业务决策

HTTP 规范（RFC 9110）定义了方法的语义幂等性：`GET`、`HEAD`、`PUT`、`DELETE` 是幂等的，`POST` 和 `PATCH` 不是。但**语义是约定，实现才是事实**——一个写得不好的 `PUT` 也可能不幂等。所以要逐个动作判断：

| 动作                                        | 天然幂等吗                                   | 重复执行的后果           | 需要幂等键？                                       |
| ------------------------------------------- | -------------------------------------------- | ------------------------ | -------------------------------------------------- |
| 支付、扣款、退款                            | 否                                           | 多扣钱                   | **必须**                                           |
| 创建订单                                    | 否                                           | 重复订单、重复扣库存     | **必须**（《Drizzle ORM》第 9 章）                 |
| 发送邮件/短信/推送                          | 否                                           | 用户收到多条             | **必须**（且要配合 outbox）                        |
| **创建任务**                                | 否                                           | 列表里出现两条一样的任务 | **建议**——用户可见的重复会损害信任，本项目要求必带 |
| 设置任务状态为 `done`（`PATCH { status }`） | **是**（设置为某个值，执行多少次结果都一样） | 无                       | 不需要；但需要**并发控制**（11.6 节）              |
| 计数器 +1、余额 +100                        | 否                                           | 多加                     | 必须，或改成「设置为」语义                         |
| 「点赞」切换（toggle）                      | 否（点两次等于没点）                         | 状态翻转                 | 改成 `PUT /likes/me`（设置）+ `DELETE`，天然幂等   |
| `DELETE /tasks/:id`                         | 是（第二次返回 404 或 204）                  | 无                       | 不需要                                             |

决策原则：

1. **能把操作改成「设置为某个值」，就优先改**（toggle → PUT/DELETE，+1 → 设置为 N）。天然幂等比加幂等键简单得多；
2. 改不了的「创建」类动作，按**重复的业务代价**决定是否需要幂等键：涉及钱、库存、外部通知的必须加；用户可见的重复内容建议加；
3. 一旦决定某个接口需要幂等键，就把它写进**契约**（必填请求头），让所有客户端都遵守。

---

## 11.3 协议设计

我们遵循 IETF 草案 [`draft-ietf-httpapi-idempotency-key-header`](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/) 的约定（Stripe 等支付平台多年来也是这样做的）：

| 场景                                   | 服务端响应                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| 缺少 `Idempotency-Key`（接口要求必带） | **400**（我们的契约把它声明为必填头，Ajv 自动拒绝）                          |
| 新键                                   | 正常执行，记录「键 → 响应」                                                  |
| 同键 + 同内容（重试）                  | **重放**第一次的响应（相同状态码和响应体），并带 `Idempotent-Replayed: true` |
| 同键 + **不同内容**                    | **422**：「这个键已经用于另一份内容」                                        |
| 同键的第一个请求还在处理中             | 草案建议 409；**我们的实现会让第二个请求等待**第一个完成后再重放（11.4 节）  |

契约部分（第 3 章已写好）：

```ts
export const IdempotencyHeaders = Type.Object({
  "idempotency-key": Type.String({
    format: "uuid",
    description: "同一次「创建意图」的唯一键；网络重试时必须复用同一个值",
  }),
});
```

### 键的三个维度

一个幂等记录由三样东西确定：

- **谁**（`userId`）：不同用户可以碰巧用相同的 UUID，互不干扰。也防止攻击者用别人的键「偷看」别人的响应；
- **键**（`key`）：客户端生成的 UUID；
- **作用域**（`scope`，如 `createTask:<projectId>`）：同一个键不能被挪用到另一个接口或另一个项目。

还有一个**请求指纹**（`requestHash`）：请求体的 SHA-256，用来识别「同键不同内容」。

```ts
// 幂等键记录：同一用户 + 同一个键 = 同一次「创建意图」
export const idempotencyKeys = snakeCase.table(
  "idempotency_keys",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: uuid().notNull(),
    scope: text().notNull(),
    requestHash: text().notNull(),
    responseStatus: integer().notNull(),
    responseBody: jsonb().notNull(),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index("idempotency_keys_created_idx").on(t.createdAt),
  ],
);
```

---

## 11.4 服务端算法：先占键，再干活，同一个事务

**`apps/api/src/services/task-service.ts`**（完整的创建函数）：

```ts
/** 键顺序无关的稳定 JSON，用来给请求体算指纹 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
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
      // ① 先「占」幂等键。并发的同键请求会在这条 INSERT 上等待第一笔事务结束
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
        // ② 键已被使用：同内容 → 重放第一次的结果；不同内容 → 拒绝
        const [existing] = await tx
          .select()
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.userId, userId),
              eq(idempotencyKeys.key, idempotencyKey),
            ),
          );
        if (!existing) throw new Error("幂等键冲突但读取不到记录");
        if (existing.scope !== scope || existing.requestHash !== requestHash) {
          throw new AppError(
            422,
            "IDEMPOTENCY_KEY_REUSED",
            "这个提交编号已用于另一份内容，请刷新页面后重新提交",
            { logContext: { idempotencyKey } },
          );
        }
        return { task: existing.responseBody as Task, replayed: true };
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

### 为什么是「先占键」

一个直觉的写法是「先查键是否存在 → 不存在就创建 → 再记录键」。它有竞态：两个同键请求同时查询，都发现不存在，于是都创建了任务。

我们的写法把「检查」和「占用」合并成一条 `INSERT … ON CONFLICT DO NOTHING`，由主键 `(user_id, key)` 保证原子性。

### 五种场景推演

**场景 A：正常请求。** 占键成功 → 创建任务 → 保存响应 → 提交事务 → 201。

**场景 B：响应丢失后重试。** 第一次已提交。第二次 `INSERT` 冲突，`DO NOTHING` 返回空 → 读到已完成的记录 → 指纹一致 → 重放 201 + `Idempotent-Replayed: true`。数据库里只有一条任务。

**场景 C：两个同键请求并发到达。**

```
请求 1：BEGIN → INSERT 键（成功，持有该主键上的行锁）→ INSERT 任务 → UPDATE 键 → …
请求 2：BEGIN → INSERT 键 ──────── 在主键上等待请求 1 的事务结束 ────────┐
请求 1：COMMIT ─────────────────────────────────────────────────────────┤
请求 2：                                     冲突 → DO NOTHING → 读到完整记录 → 重放
```

Postgres 在唯一索引冲突时，会让后来的插入**等待**先前未提交的事务。请求 1 提交后，请求 2 才看到冲突，此时读到的已经是完整的响应。所以我们**永远不会**把「`responseStatus: 0` 的半成品」暴露给其他请求——这也是为什么我们不需要草案里「处理中 → 409」那个状态。

如果请求 1 回滚了（比如标题冲突），请求 2 的 `INSERT` 会成功，然后正常执行。

**场景 D：同键不同内容。** 用户提交了「任务 A」，网络超时；他改成「任务 B」再提交，但前端复用了旧键。指纹不一致 → 422。**静默返回「任务 A」是错误的**：用户以为自己创建了 B。

**场景 E：失败的请求不占用键。** 用户提交了一个重名的标题。占键成功 → 插入任务时触发唯一冲突 → **整个事务回滚，包括占键** → 409。用户改名后用同一个键重新提交，键是「干净的」，正常创建。

对应的测试（**`apps/api/test/api.test.ts`**）：

```ts
describe("幂等键", () => {
  it("同键同内容重试：只创建一次，第二次重放", async () => {
    const key = randomUUID();
    const payload = { title: "幂等测试", description: "retry me" };
    const first = await createTask(alice, payload, { key });
    // 字段顺序不同，指纹仍然一致（stableStringify）
    const second = await createTask(
      alice,
      { description: "retry me", title: "幂等测试" },
      { key },
    );
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.json().id).toBe(first.json().id);
    const [row] = await ctx.db
      .select({ n: count() })
      .from(tasks)
      .where(eq(tasks.title, "幂等测试"));
    expect(row?.n).toBe(1);
  });

  it("同键不同内容 → 422", async () => {
    const key = randomUUID();
    await createTask(alice, { title: "第一次" }, { key });
    const res = await createTask(alice, { title: "第二次" }, { key });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("因 409 失败的请求不会占用幂等键：改正后可用同一个键重试", async () => {
    const key = randomUUID();
    await createTask(alice, { title: "Unique-1" });
    const conflict = await createTask(alice, { title: "Unique-1" }, { key });
    expect(conflict.statusCode).toBe(409);
    const fixed = await createTask(alice, { title: "Unique-2" }, { key });
    expect(fixed.statusCode).toBe(201);
  });
});
```

> 场景 C 的「两个独立连接并发」在 PGlite 单连接环境里无法真正复现。要证明它，需要在真实 Postgres 上开两个连接同时提交，《Drizzle ORM 从 0 到 1》第 12.11 节给出了这类测试的写法。

### 为什么存响应快照，而不是重放时重新查询任务？

重放应该返回**第一次请求的结果**。如果重放时去查任务的当前状态，而任务在两次请求之间已经被别人改过（甚至删了），客户端拿到的就是一个「它没有创建过的」状态，或者一个 404。快照让重放的语义稳定：**你重试的是那次请求，所以你得到那次请求的响应**。

### 边界与运维

- **外部副作用不能放在事务里**。如果创建任务还要发邮件，邮件在事务提交前发出、事务又回滚了，邮件就收不回来。正确做法是在事务里写一条 outbox 记录，提交后由后台任务发送（《Drizzle ORM》第 9.11 节）；
- **键要过期清理**。幂等记录不需要永久保存，保留期只需覆盖客户端可能重试的时间窗（几小时到几天）。`created_at` 上的索引就是为定期清理准备的：

  ```sql
  DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours';
  ```

  保留期一定要**长于**客户端的最长重试窗口，否则「过期后重试」会再次创建；

- **重放的响应头**：我们只重放了状态码和响应体。`Location`、`ETag` 由 handler 根据任务重新计算，与第一次一致。

---

## 11.5 客户端：键的生命周期

服务端保证了「同键只执行一次」，客户端要保证「**同一个意图用同一个键，不同意图用不同的键**」。第 10 章已经实现，这里把规则完整列出：

```ts
// 一次「创建意图」一个键：网络重试复用它；成功或确定失败后才换新键
const idempotencyKey = useRef(crypto.randomUUID());

async function onSubmit(values: CreateTaskFormOutput) {
  try {
    await createTask.mutateAsync({
      body: toCreateTaskBody(values),
      idempotencyKey: idempotencyKey.current,
    });
    idempotencyKey.current = crypto.randomUUID(); // 成功：下一个任务是新意图
    form.reset(emptyCreateTaskForm);
  } catch (error) {
    if (error instanceof ApiError && DEFINITELY_NOT_CREATED.has(error.status)) {
      idempotencyKey.current = crypto.randomUUID(); // 确定没创建：换新键
    }
    // 网络错误 / 5xx：结果未知，保留键，用户再点一次会安全地重放
    applyServerFieldErrors(error, form.setError, CREATE_TASK_FIELDS);
  }
}
```

| 时机                                   | 键                                              |
| -------------------------------------- | ----------------------------------------------- |
| 表单打开                               | 生成                                            |
| TanStack Query 自动重试（网络错误）    | **不变**（键在 mutation variables 里，第 7 章） |
| 用户手动再点一次（上次网络错误 / 5xx） | **不变**                                        |
| 成功                                   | 换新                                            |
| 400 / 403 / 404 / 409                  | 换新                                            |
| 422                                    | 不变，提示用户刷新                              |

一个反面例子——**在 `mutationFn` 里生成键**：

```ts
// ❌ 每次调用（包括自动重试）都是新键，幂等保障完全失效
mutationFn: (body) => api.POST(path, { params: { header: { "idempotency-key": crypto.randomUUID() } }, body }),
```

### 422 时用户看到什么

422 的典型路径：提交「任务 A」→ 网络错误（其实已经创建）→ 用户把标题改成「任务 B」→ 再提交（复用了键）→ 422。

此时正确的提示是：「这个提交编号已用于另一份内容，请刷新页面后重新提交」。刷新后用户会看到「任务 A」已经在列表里，然后可以决定是否还要创建「任务 B」（新表单 = 新键）。

> 你可能会想：「为什么不在用户修改表单内容时就换新键？」因为「修改内容」不等于「上一次确定失败了」。如果上一次其实成功了，换新键再提交就会创建第二个任务。422 把这个模糊的情况**显式地**交给用户判断，这比静默猜测更安全。

---

## 11.6 并发更新：丢失更新问题

现在换一个问题。Alice 和 Bob 同时打开了同一个任务：

```
t1  Alice 读取任务：{ title: "发布 v2", priority: "medium", version: 3 }
t2  Bob   读取任务：{ title: "发布 v2", priority: "medium", version: 3 }
t3  Alice 把标题改成「发布 v2.0」并保存     → 成功
t4  Bob   把优先级改成「high」并保存        → ？
```

如果 Bob 的客户端发送的是「整个任务对象」（`PUT`），t4 会把标题改回「发布 v2」——**Alice 的修改丢失了**，而且没有任何人知道。即使用 `PATCH` 只发送改动的字段，问题也没有消失：如果 Bob 是基于「旧标题」做出的判断（比如「标题是 v2，所以优先级应该是 high」），他的修改可能已经不合理了。

三种策略：

| 策略             | 做法                                 | 适用                                     |
| ---------------- | ------------------------------------ | ---------------------------------------- |
| 最后写入获胜     | 什么都不做                           | 冲突几乎不发生、或覆盖无所谓（个人设置） |
| 悲观锁           | 编辑前「锁定」资源，别人不能改       | 长时间独占编辑（文档签出），实现复杂     |
| **乐观并发控制** | 带上「我看到的版本」，版本不对就拒绝 | **大多数协作场景**，本项目采用           |

---

## 11.7 版本号 + If-Match

HTTP 早就为乐观并发设计了标准机制（RFC 9110）：

- 服务器在响应里用 **`ETag`** 头告诉客户端资源的当前版本；
- 客户端修改时用 **`If-Match`** 头带回这个版本：「只有当资源仍然是这个版本时，才执行修改」；
- 版本不匹配时，服务器返回 **412 Precondition Failed**；
- 服务器要求必须带条件头、客户端却没带时，返回 **428 Precondition Required**。

我们用数据库的 `version` 整数列作为 ETag 的值：`"3"`（ETag 规定要带引号）。

> 为什么同时在响应体里放 `version` 字段？因为列表接口一次返回很多任务，它们不能各自有一个 `ETag` 响应头。前端从列表里拿到 `task.version`，拼成 `If-Match: "3"` 即可。单个资源的 GET/PATCH 响应同时带 `ETag` 头，符合 HTTP 语义，也方便通用的 HTTP 工具使用。

### 契约

```ts
// 声明为可选：缺失时由 handler 返回 428，而不是笼统的 400
export const IfMatchHeaders = Type.Object({
  "if-match": Type.Optional(
    Type.String({
      pattern: '^"[0-9]+"$',
      description: '资源版本，格式为带引号的整数，例如 "3"。更新时必须提供',
    }),
  ),
});
```

这里有一个契约设计上的小技巧：`if-match` 在 schema 里是**可选**的。如果设为必填，缺失时 Ajv 会返回笼统的 400 `VALIDATION_FAILED`；设为可选，再由业务代码返回语义更准确的 **428**。但格式（`pattern`）仍由 Ajv 校验——带了却格式不对，还是 400。

路由：

```ts
app.patch(
  "/tasks/:taskId",
  {
    schema: {
      operationId: "updateTask",
      tags: ["tasks"],
      summary: "部分更新任务（乐观并发）",
      description:
        '必须携带 If-Match: "<version>"。版本不一致返回 412，缺少返回 428。',
      security: writeSecurity,
      params: TaskParams,
      headers: IfMatchHeaders,
      body: ref(UpdateTaskBody),
      response: {
        200: ref(Task),
        ...errorResponses(400, 401, 403, 404, 409, 412, 428, 500),
      },
    },
  },
  async (request, reply) => {
    const { user } = requireAuth(request);
    const task = await updateTask(
      db,
      user.id,
      request.params.taskId,
      request.body,
      request.headers["if-match"],
    );
    return reply.header("etag", `"${task.version}"`).send(task);
  },
);
```

### 条件更新

**`apps/api/src/services/task-service.ts`**：

```ts
export async function updateTask(
  db: Db,
  userId: string,
  taskId: string,
  patch: UpdateTaskBody,
  ifMatch: string | undefined,
): Promise<Task> {
  // 先授权、再检查前置条件：对看不见这个任务的人，任何请求都应该是 404
  const { task, role } = await loadTaskWithRole(db, userId, taskId);
  if (role === "viewer") throw forbidden("只读成员不能创建或修改任务");

  if (!ifMatch) {
    throw new AppError(
      428,
      "PRECONDITION_REQUIRED",
      "缺少版本信息，请刷新后重试",
    );
  }
  const expectedVersion = Number(ifMatch.slice(1, -1));

  try {
    // 条件更新：版本号匹配才写入，判断与修改在同一条 SQL 里，没有竞态窗口
    const [row] = await db
      .update(tasks)
      .set({
        ...patch,
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        version: sql`${tasks.version} + 1`,
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.version, expectedVersion)))
      .returning();
    if (!row) {
      throw new AppError(
        412,
        "PRECONDITION_FAILED",
        "任务已被其他人修改，请查看最新内容后再保存",
        {
          headers: { etag: `"${task.version}"` },
          logContext: { expectedVersion, currentVersion: task.version },
        },
      );
    }
    return toTaskDto(row);
  } catch (err) {
    if (isUniqueViolation(err, OPEN_TITLE_UQ)) {
      throw fieldConflict("title", "该项目中已有同名的未完成任务");
    }
    throw err;
  }
}
```

核心是这一条 SQL：

```sql
UPDATE tasks SET …, version = version + 1
WHERE id = $1 AND version = $2
RETURNING *;
```

「检查版本」和「修改」在**同一条语句**里完成，数据库保证它的原子性。两个人同时用 `version = 3` 提交，只有一个能匹配成功（另一个执行时版本已经是 4），返回 0 行 → 412。不需要显式加锁，也不需要事务。

### 检查顺序很重要

注意函数开头的注释：**先授权，再检查前置条件**。配套工程最初的写法是先检查 `If-Match`、再加载任务。这导致一个非成员不带 `If-Match` 请求别人的任务时，得到的是 428 而不是 404——虽然没有泄露任务内容，但它违背了第 9 章「看不见的资源一律 404」的原则。一个专门的测试发现并修正了这个顺序：

```ts
it("非成员修改任务 → 404（即使没带 If-Match，也先得到 404 而不是 428）", async () => {
  const created = (await createTask(alice, { title: "carol 看不见我" })).json();
  for (const headers of [
    carol.headers,
    { ...carol.headers, "if-match": '"1"' },
  ]) {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/v1/tasks/${created.id}`,
      cookies: carol.cookies,
      headers,
      payload: { title: "越权修改" },
    });
    expect(res.statusCode).toBe(404);
  }
});
```

### 412 响应里带上当前 ETag

`headers: { etag: \`"${task.version}"\` }` 让 412 响应携带服务端看到的当前版本（这是加载时的版本，严格来说可能又被别人改了，但作为提示足够）。客户端可以据此判断「落后了几个版本」，或者直接重新拉取。

### 测试

```ts
describe("更新：乐观并发", () => {
  it("缺 If-Match → 428；旧版本 → 412；正确版本 → 200 且 version + 1", async () => {
    const created = (await createTask(alice, { title: "并发更新" })).json();
    const patch = (ifMatch?: string, title = "改名") =>
      ctx.app.inject({
        method: "PATCH",
        url: `/api/v1/tasks/${created.id}`,
        cookies: alice.cookies,
        headers: {
          ...alice.headers,
          ...(ifMatch ? { "if-match": ifMatch } : {}),
        },
        payload: { title },
      });

    expect((await patch()).statusCode).toBe(428);

    const ok = await patch('"1"');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().version).toBe(2);
    expect(ok.headers.etag).toBe('"2"');

    const stale = await patch('"1"', "别人的旧修改");
    expect(stale.statusCode).toBe(412);
    expect(stale.json().error.code).toBe("PRECONDITION_FAILED");
    expect(stale.headers.etag).toBe('"2"');
  });
});
```

---

## 11.8 客户端：带上版本，处理冲突

**`apps/web/src/features/tasks/api.ts`**：

```ts
export function useUpdateTask(projectId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ task, patch }: { task: Task; patch: UpdateTaskBody }) =>
      unwrap(
        api.PATCH("/api/v1/tasks/{taskId}", {
          params: {
            path: { taskId: task.id },
            // 带上「我看到的版本」：别人先改了，服务端会返回 412 而不是覆盖
            header: { "if-match": `"${task.version}"` },
          },
          body: patch,
        }),
      ),
    onSettled: (_data, error) => {
      // 成功：刷新列表；412：本地数据已过期，同样需要拉最新
      if (!error || (error instanceof ApiError && error.status === 412)) {
        return queryClient.invalidateQueries({
          queryKey: taskKeys.lists(projectId),
        });
      }
    },
  });
}
```

`header: { "if-match": … }` 的键名和类型都来自契约。如果有人把契约里的 `if-match` 改成必填，这里不受影响；如果改了名字，这里编译失败。

冲突时的 UI 选择：

| 方式                                             | 适合                                                 |
| ------------------------------------------------ | ---------------------------------------------------- |
| 提示 + 自动刷新，让用户重新操作                  | 简单操作（推进状态），本项目采用                     |
| 显示「你的版本」和「最新版本」的对比，让用户合并 | 长文本编辑                                           |
| 自动基于最新版本重试                             | 操作与其他字段无关、且业务允许（比如「标记为已读」） |

### 一个微妙的情况：重试遇到自己

`PATCH` 不带幂等键。如果一次更新**实际成功了**但响应丢失，客户端（或用户）重试时带着旧版本号，会得到 412——「被他人修改了」，但「他人」其实是自己。

本项目的更新 mutation 不自动重试（默认 `retry: false`），所以只有用户手动重试才会遇到；UI 的处理（刷新列表、提示重新操作）对这种情况也是正确的：刷新后用户会看到自己的修改已经生效。如果你的场景要求自动重试更新，可以给 PATCH 也加上幂等键，或者在 412 时比较最新数据是否已经等于期望的修改。

---

## 11.9 两种机制的对比

|            | 幂等键                        | 版本号 + If-Match                  |
| ---------- | ----------------------------- | ---------------------------------- |
| 解决的问题 | **同一个意图**被执行多次      | **不同的意图**基于过期数据互相覆盖 |
| 典型场景   | 创建、支付、发送              | 更新                               |
| 冲突时     | 同内容 → 重放；不同内容 → 422 | 412                                |
| 状态存储   | 幂等记录表                    | 资源上的 `version` 列              |
| 客户端职责 | 管理键的生命周期              | 带上看到的版本，处理 412           |

两者可以同时使用：一个「修改订单收货地址」的接口，既需要防止重复提交（幂等键），又需要防止覆盖别人刚做的修改（If-Match）。

---

## 11.10 本章练习

1. **业务判断**：为下列动作决定「天然幂等 / 需要幂等键 / 需要版本控制」：给任务添加评论、把任务移动到另一个项目、批量把 10 个任务标记为完成、给任务点赞。
2. **观察场景 E**：在测试里，先用键 K 提交一个会 409 的请求，再查 `idempotency_keys` 表，确认没有 K 的记录。
3. **过期清理**：写一个脚本，删除 24 小时前的幂等记录。思考：如果客户端有「离线队列」，可能在 3 天后才重发请求，保留期该怎么定？
4. **合并冲突 UI**：改造 `TaskList`，在 412 时弹出对话框，显示「你想改成：进行中」和「最新状态：已完成」，让用户选择。

---

## 11.11 本章验收清单

- [ ] 能列出重复提交的五种来源，说明哪些只能靠服务端解决；
- [ ] 能按业务代价判断一个动作是否需要幂等键，并优先把操作改成天然幂等；
- [ ] 幂等键写进契约（必填请求头），作用域包含用户、键和接口；
- [ ] 服务端用「占键 → 执行 → 保存响应」在同一事务中实现，并能推演五种场景；
- [ ] 同键同内容重放（`Idempotent-Replayed`），同键不同内容 422，失败请求不占用键——都有测试；
- [ ] 客户端的键在重试时保持不变，在成功或确定失败后换新；
- [ ] 能解释丢失更新问题，并用 `version` + `If-Match` + 条件 UPDATE 实现乐观并发，返回 412 / 428；
- [ ] 授权检查在前置条件检查之前；
- [ ] 能说出幂等键与版本控制各自解决什么问题。

---

上一章：[← 第 10 章：创建任务（下）：前端链路与错误 UI](./10-create-task-frontend.md) ｜ 下一章：[第 12 章：版本、弃用、分页与序列化规范 →](./12-versioning-pagination-serialization.md)
