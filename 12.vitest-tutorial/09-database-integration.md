# 第 9 章：数据库集成测试——验证 mock 永远测不到的东西

> 第 8 章的 API 测试跑在内存仓储上，快且可控，但它证明不了「Postgres 真的会拦截重复标题」「事务真的会回滚」。这一章用 PGlite（编译成 WASM 的嵌入式 Postgres）建真库、跑真迁移、执行真 SQL，完成 mock 边界的另一半。代码来自 [example/test/integration/db.test.ts](./example/test/integration/db.test.ts)。

## 9.1 为什么选 PGlite，它证明了什么、证明不了什么

数据库集成测试的传统方案是 docker-compose 起一个 Postgres 容器。它的问题是：CI 与本地都要装 Docker、启动要等十几秒、多人共享容器还要处理数据清理。

[PGlite](https://pglite.dev/) 把 Postgres 编译成了 WASM：`new PGlite()` 就是一个进程内的真 Postgres（真 SQL 解析器、真约束、真事务、真 MVCC 语义），零安装、毫秒级启动、用完即弃。配套工程的 [Drizzle 教程示例](../9.drizzle-orm-tutorial/README.md)同样用它做默认测试库。

诚实的边界声明（这也是路线图「integration test 验证真实集成」的应有态度）：

- **能证明**：SQL 正确性、唯一约束、外键、事务回滚、类型往返（Date ↔ timestamptz）、Drizzle 查询构造的正确性；
- **不能证明**：多连接并发竞态（PGlite 是单连接进程内库，两个「并发」insert 实际串行执行）、连接池行为、真实网络延迟下的超时。这些需要真 Postgres（本仓库 Supabase 教程的环境即可），属于选配进阶。

教学与日常回归用 PGlite 足够；上线前的验收测试跑一次真库，两层互补。

## 9.2 测试库的搭建：真实迁移 + 每文件独立库

三条原则：

**1. 表结构来自与生产完全相同的迁移文件。** 绝不为测试手写另一套 `CREATE TABLE`——手写副本会随着迁移历史推进悄悄失真，最后你测的库和跑的库结构不同。配套工程用 drizzle-kit 生成的 [example/drizzle/](./example/drizzle/) 迁移目录，测试启动时执行同一套迁移：

```ts
// src/db/client.ts
export async function openDb(
  options: { dataDir?: string; migrationsFolder?: string } = {},
) {
  const client = new PGlite(options.dataDir); // 不传 dataDir = 纯内存实例
  const db = drizzle({ client, relations });
  await migrate(db, {
    migrationsFolder: options.migrationsFolder ?? "./drizzle",
  });
  return { db, client };
}
```

**2. 每个测试文件一个全新库，文件间天然隔离。** 测试文件顶层 `await` 建库（ESM 顶层 await，Vitest 原生支持）：

```ts
// test/integration/db.test.ts
const { db, close } = await createTestDb(); // test/integration/db-helper.ts 包了一层 openDb
const repo = createDbTaskRepository(db);

afterAll(async () => {
  await close(); // 不关库，测试进程可能挂住不退
});
```

（第 3 章讲过：我们试过 globalSetup + `provide()` 共享一个库，但 provide 只接受可序列化值，数据库实例传不过去。「每文件自建内存库」在 PGlite 的启动速度下毫无负担——整个 db.test.ts 十个测试 20ms 左右跑完。）

**3. 文件内部靠清表隔离每个测试。** 共享库、独立数据：

```ts
beforeEach(async () => {
  await db.delete(tasks); // 每个测试从空表开始，不依赖执行顺序
});
```

「清表」与「事务回滚」两种文件内隔离方案的取舍：清表直观、对「测试要观察提交后状态」的场景友好（本教程采用）；事务回滚（每个测试包在 `BEGIN...ROLLBACK` 里）数据永不落盘、隔离更彻底，但被测代码内部再开事务就会撞上嵌套限制（需要 SAVEPOINT 技巧），对新手复杂度偏高。知道两者存在，从清表开始。

## 9.3 值得用真库验证的四类行为

**类型往返：Date 进去，Date 出来**

```ts
it("insert → findById 往返：Date 字段仍是 Date，不是字符串", async () => {
  const task = makeTask({ dueDate: new Date("2026-04-01T00:00:00Z") });
  await repo.insert(task);

  const found = await repo.findById(task.id);
  expect(found).toEqual(task); // 全字段深度相等
  expect(found?.createdAt).toBeInstanceOf(Date); // timestamptz → JS Date
});
```

mock 仓储永远「返回你喂进去的东西」，这条测试在 mock 下毫无意义；在真库下它验证了 Drizzle 的类型映射与 Postgres 的 timestamptz 语义。

**唯一约束：23505 与错误翻译**

```ts
it("重复标题触发 23505，仓储把它翻译成 TaskConflictError", async () => {
  await repo.insert(makeTask({ id: "task_1", title: "唯一标题" }));
  await expect(
    repo.insert(makeTask({ id: "task_2", title: "唯一标题" })),
  ).rejects.toThrow(TaskConflictError);
});
```

这里埋着第二个实测踩坑：**Drizzle 1.0 RC 会把驱动错误包装成 `DrizzleQueryError`，Postgres 的 `23505` 错误码挂在 `error.cause` 上**，直接读 `error.code` 拿不到。仓储的翻译逻辑因此要沿 cause 链找（[example/src/db/task-repository.ts](./example/src/db/task-repository.ts)）：

```ts
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 5 && current !== null && typeof current === "object";
    depth++
  ) {
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
```

如果没有这条集成测试，「先查后插」的 service 逻辑会在内存测试里全绿，而真实数据库抛出的原始 23505 错误直接变 500——这就是「所有测试通过但系统无法运行」的具体形态。

**并发竞态：数据库是最后防线**

```ts
it("并发插入同名任务：恰好一条存活", async () => {
  const results = await Promise.allSettled([
    repo.insert(makeTask({ id: "task_a", title: "并发同名" })),
    repo.insert(makeTask({ id: "task_b", title: "并发同名" })),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(eq(tasks.title, "并发同名"));
  expect(rows[0]?.n).toBe(1);
});
```

（诚实声明：PGlite 单连接，这两个「并发」实际是串行排队——它验证的是「约束存在且仓储正确翻译冲突」，不是真实多连接下的锁竞争时序。后者需要真 Postgres + 多连接，见 9.1 的边界。）

**事务回滚：不留半截数据**

```ts
it("事务中途抛错 → 已插入的行也消失", async () => {
  await expect(
    db.transaction(async (tx) => {
      await tx
        .insert(tasks)
        .values(makeTask({ id: "tx_a", title: "会回滚的任务" }));
      throw new Error("模拟事务中途失败");
    }),
  ).rejects.toThrow("模拟事务中途失败");

  expect(await db.select().from(tasks)).resolves.toEqual([]);
});
```

以及它的业务版：「创建任务 + 写审计」放同一事务，第二步撞唯一约束，断言第一步的主记录也没留下。多表一致写入（订单 + 订单行、任务 + 审计）全靠这个语义，mock 数据库给不了任何保证。

## 9.4 mock 边界的完整图景：同一个 service，两种测法

到这里，TaskDesk Lite 的测试分层完全成形。注意**被测的业务逻辑从头到尾只有一份**，变的只是依赖的实现：

```text
                        ┌─ test/unit/task-service.test.ts ────────┐
createTaskService ──────┤  repo = 内存仓储（真实行为的手写替身）      │ 毫秒级
（查重/权限/状态机/       │  notifier = vi.fn（交互验证）             │ 穷举边界
 分页，一份代码）         │  clock = 注入固定时间                     │
                        └─────────────────────────────────────────┘
                        ┌─ test/integration/api-in-memory.test.ts ┐
buildApp + service ─────┤  repo = 内存仓储                          │ HTTP 边界
                        │  真实 Fastify hook/错误处理/序列化          │ 状态码矩阵
                        └─────────────────────────────────────────┘
                        ┌─ test/integration/db.test.ts ───────────┐
createDbTaskRepository ─┤  真实 PGlite + 真实迁移                   │ SQL 语义
                        │  验证约束/事务/类型往返                     │ 约束与回滚
                        └─────────────────────────────────────────┘
```

判断一段代码该在哪层测的口诀：**它依赖的行为是「我定义的」还是「别人实现的」？** 我定义的业务规则（查重后拒绝、越权 403）→ 用替身在快层测；别人实现的语义（Postgres 约束、事务、Fastify 序列化）→ 用真货在集成层测。两边接缝处（仓储接口）就是 mock 边界。

## 9.5 路线图练习 4 与覆盖率作业的铺垫

> 路线要求（练习 1 的数据库部分 + 通过标准）：「每个数据库测试都要有自己的事务/数据集」「唯一约束与并发竞态」。

1. 给 `tasks` 表加一列 `owner_id` 上的普通索引（改 [schema.ts](./example/src/db/schema.ts) → `npm run db:generate` 生成新迁移），验证既有测试不改一行仍然全绿——迁移是叠加的，测试是迁移正确性的守卫。
2. 写一个测试证明 `updateStatus` 的 `returning()` 返回的是**更新后**的行（status 是新值、其余字段不变）。
3. 把 9.3 的「事务回滚」改写成 SAVEPOINT 风格：外层事务不结束，内层 `tx.transaction()` 嵌套回滚只撤销内层插入。观察 PGlite 的行为并记录。
4. 思考题：为什么 `beforeEach` 清表用 `db.delete(tasks)` 而不是 `TRUNCATE`？两者在事务内、有外键引用时的行为差异是什么？（本教程单表无外键，两者皆可；多表有外键时 `TRUNCATE ... CASCADE` 更快但更危险。）

## 本章来源

- Vitest 官方文档：[Features](https://vitest.dev/guide/features)（顶层 await / ESM first——测试文件顶层建库的基础）
- PGlite 官方文档（pglite.dev）：嵌入式 Postgres 的能力与单连接限制
- Drizzle ORM 官方文档：[Migrations](https://orm.drizzle.team/docs/migrations)（migrate 与迁移目录）、[Transactions](https://orm.drizzle.team/docs/transactions)（transaction 与嵌套 savepoint）、错误包装行为为 drizzle-orm 1.0.0-rc.4 实测记录
- Postgres 官方文档：[Error Codes](https://www.postgresql.org/docs/current/errcodes-appendix.html)（23505 unique_violation）、[SAVEPOINT](https://www.postgresql.org/docs/current/sql-savepoint.html)

下一章：[10 Coverage 覆盖率](./10-coverage.md) —— 读懂四个指标，找出分支漏测，且不把覆盖率当质量。
