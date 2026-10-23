# 第 13 章：综合实战与逐项验收

> 本章目标：先把整个系统跑一遍，确认所有检查都是绿的；然后完整演练一次真实的需求变更——「给任务增加预估工时」——看契约变化如何沿着整条链路被编译器、测试和 CI 一步步「推」着走完；最后对照最初的学习目标，逐项给出**证据**。

---

## 13.1 一键验证全部检查

```bash
cd example
pnpm install

pnpm contract:check     # 生成物是否与代码一致
pnpm boundaries:check   # 前端是否越界
pnpm --filter @taskflow/api-client lint:openapi
pnpm typecheck          # 三个包的类型检查
pnpm test               # 全部自动化测试
pnpm --filter @taskflow/web build
```

编写本教程时的实际输出：

```
✓ packages/api-client/openapi.json 与服务端代码一致
✓ packages/api-client/src/generated/openapi.ts 与服务端代码一致
✓ apps/web 没有直接依赖服务端实现
Woohoo! Your API description is valid. 🎉        （1 个关于 license 的警告）
packages/api-client typecheck: Done
apps/api typecheck: Done
apps/web typecheck: Done
packages/api-client test:       Tests  7 passed (7)
apps/api test:                  Tests  28 passed (28)
apps/web test:                  Tests  27 passed (27)
✓ built in 121ms
```

62 个测试分布在三层：

| 包                    | 测试文件                        | 测什么                                                                                                                     |
| --------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`            | `api.test.ts`（26）             | OpenAPI 元规则、401/requestId、创建成功、400 字段映射、绕过测试、403/404、409、幂等、CSRF/CORS、乐观并发、IDOR、分页、弃用 |
|                       | `errors.test.ts`（2）           | 500 不泄露 + 日志可检索、未知路由                                                                                          |
| `packages/api-client` | `client.test.ts`（7）           | 中间件（CSRF、requestId）、网络错误/取消、错误规整、未知错误码、非 JSON 502、Retry-After                                   |
| `apps/web`            | `errors.test.ts`（15）          | 状态码 → UI 映射表、字段错误回填、重试策略                                                                                 |
|                       | `task-form-schema.test.ts`（4） | 表单与契约约束对齐、`toCreateTaskBody`                                                                                     |
|                       | `CreateTaskForm.test.tsx`（6）  | 完整表单链路：客户端校验、成功、400、409、403、500、网络重试复用幂等键                                                     |
|                       | `TaskList.test.tsx`（2）        | 未知枚举兜底、412 冲突处理                                                                                                 |

---

## 13.2 综合演练：给任务增加「预估工时」

产品提出新需求：创建任务时可以填写预估工时（可选），列表里显示出来。

这是一个**非常典型**的契约变更。我们按真实的工作顺序走一遍，重点观察：**每一步是谁告诉你下一步该做什么。** 下面每一步的代码和报错，都是编写本教程时在配套工程上实际执行得到的（演练完成后已还原）。

### 第 0 步：设计决策

| 问题     | 决策                                                   | 依据                                         |
| -------- | ------------------------------------------------------ | -------------------------------------------- |
| 字段名   | `estimateMinutes`                                      | 单位写进名字，避免「是小时还是分钟」的歧义   |
| 类型     | 整数分钟，1~10000                                      | 第 12 章：避免浮点（1.5 小时 = 90 分钟）     |
| 必填？   | 创建时**可选**，响应里**总是存在**（`number \| null`） | 第 12 章 null 规范；可选字段是兼容变更       |
| 兼容性   | 兼容（响应新增字段、请求新增可选字段）                 | 第 12.2 节                                   |
| 发布顺序 | **服务端先上线**                                       | 请求 schema 有 `additionalProperties: false` |

### 第 1 步：数据库

```ts
// apps/api/src/db/schema.ts —— tasks 表
// 预估工时（分钟）：用整数分钟而不是小数小时，避免浮点误差
estimateMinutes: integer(),
// ……
check("tasks_estimate_range_ck", sql`${t.estimateMinutes} between 1 and 10000`),
```

```bash
pnpm --filter @taskflow/api db:generate --name task_estimate
```

生成的迁移：

```sql
ALTER TABLE "tasks" ADD COLUMN "estimate_minutes" integer;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_estimate_range_ck" CHECK ("estimate_minutes" between 1 and 10000);
```

可空列 + CHECK 约束，对已有数据和正在运行的旧版服务都是安全的。

### 第 2 步：契约

```ts
// apps/api/src/contract/tasks.ts
const EstimateMinutes = Type.Integer({ minimum: 1, maximum: 10000, description: "预估工时（分钟）" });

// Task（响应）
estimateMinutes: Type.Union([EstimateMinutes, Type.Null()]),
// CreateTaskBody 与 UpdateTaskBody（请求）
estimateMinutes: Type.Optional(Type.Union([EstimateMinutes, Type.Null()])),
```

### 第 3 步：服务端编译器接手

```bash
pnpm --filter @taskflow/api typecheck
```

```
src/services/task-service.ts(24,3): error TS2741: Property 'estimateMinutes' is missing in type
  '{ id: string; …; dueDate: string | null; createdBy: string; version: number; createdAt: string; updatedAt: string; }'
  but required in type
  '{ id: string; …; dueDate: string | null; estimateMinutes: number | null; createdBy: string; … }'.
```

`toTaskDto` 的返回类型是契约的 `Task`，契约多了一个必填的响应字段，映射函数立刻报错。补上：

```ts
export function toTaskDto(row: TaskRow): Task {
  return {
    // ……
    dueDate: row.dueDate,
    estimateMinutes: row.estimateMinutes,
    // ……
  };
}
```

**但是**，编译器**没有**提醒你修改 `createTask` 里的 `INSERT`：

```ts
.values({
  projectId,
  title: input.title.trim(),
  // …… 忘了写 estimateMinutes，类型检查照样通过！
})
```

因为数据库列是可空的，插入时省略它完全合法——用户填了预估工时，服务端却悄悄丢掉了。**类型系统能保证「输出完整」，保证不了「输入被使用」。** 这正是需要测试的地方：

```ts
it("预估工时能保存并原样返回", async () => {
  const res = await createTask(alice, { title: "带估时", estimateMinutes: 90 });
  expect(res.statusCode).toBe(201);
  expect(res.json().estimateMinutes).toBe(90);
});
```

补上插入字段：

```ts
estimateMinutes: input.estimateMinutes ?? null,
```

`updateTask` 用的是 `...patch` 展开，新字段自动生效，不需要改。

### 第 4 步：重新生成契约——漂移检查会提醒你

如果你现在就提交，CI 的第一步会失败：

```
✗ packages/api-client/openapi.json 已过期
✗ packages/api-client/src/generated/openapi.ts 已过期
契约产物与代码不一致：请运行 pnpm contract:generate 并提交生成结果。
```

```bash
pnpm contract:generate
```

生成的类型里出现了新字段：

```ts
Task: {
  // ……
  estimateMinutes: number | null;       // 响应：总是存在
};
CreateTaskBody: {
  // ……
  estimateMinutes?: number | null;      // 请求：可选
};
```

### 第 5 步：前端类型检查——**通过了**

```bash
pnpm --filter @taskflow/web typecheck
# Done
```

为什么没有报错？因为 `estimateMinutes` 在 `CreateTaskBody` 里是**可选**的，`toCreateTaskBody` 不返回它也合法；响应里多一个字段，读取方不受影响。**这正说明这是一个兼容变更**——旧前端（不知道这个字段）可以继续和新服务端一起工作。

前端要不要使用这个字段，是产品决定，不是编译器决定。现在开始做前端：

### 第 6 步：表单

```ts
// apps/web/src/features/tasks/task-form-schema.ts
export const createTaskFormSchema = z.object({
  // ……
  // <input type="number"> 的值也是字符串：空串表示「不估算」
  estimateMinutes: z.union([
    z.literal(""),
    z.coerce
      .number()
      .int("请输入整数分钟")
      .min(1, "至少 1 分钟")
      .max(10000, "最多 10000 分钟"),
  ]),
});

export const CREATE_TASK_FIELDS = [
  "title",
  "description",
  "priority",
  "dueDate",
  "estimateMinutes",
] as const;

export const emptyCreateTaskForm: CreateTaskFormInput = {
  title: "",
  description: "",
  priority: "medium",
  dueDate: "",
  estimateMinutes: "",
};

export function toCreateTaskBody(values: CreateTaskFormOutput): CreateTaskBody {
  return {
    // ……
    estimateMinutes:
      values.estimateMinutes === "" ? null : values.estimateMinutes,
  };
}
```

```tsx
// apps/web/src/features/tasks/CreateTaskForm.tsx
<label htmlFor="task-estimateMinutes">预估工时（分钟）</label>
<input type="number" inputMode="numeric" {...fieldProps("estimateMinutes")} {...form.register("estimateMinutes")} />
{fieldError("estimateMinutes")}
```

把 `"estimateMinutes"` 加进 `CREATE_TASK_FIELDS` 很重要：服务端如果返回这个字段的错误（比如有人绕过前端提交了 99999），它才能被回填到输入框，而不是被汇总到表单顶部。

再给第 5 章的契约对齐测试加一条数值范围检查：

```ts
it("estimateMinutes 的数值范围不比契约宽松", () => {
  const pick = (s: JsonSchema | undefined) =>
    s?.anyOf?.find((b) => b.maximum !== undefined) ?? {};
  const server = pick(body.properties?.estimateMinutes);
  const client = pick(form.properties?.estimateMinutes);
  expect(client.maximum!).toBeLessThanOrEqual(server.maximum!);
  expect(client.minimum!).toBeGreaterThanOrEqual(server.minimum!);
});
```

### 第 7 步：测试告诉你哪些断言需要更新

```bash
pnpm --filter @taskflow/web test
```

```
× 空字符串整理成 null，标题去掉首尾空格
× 成功：请求体符合契约，带幂等键与 CSRF 头，成功后清空并换新键
  AssertionError: expected { title: '写发布说明', …(4) } to deeply equal { title: '写发布说明', …(3) }
Tests  2 failed | 26 passed (28)
```

两个失败都是**预期之内**的：请求体多了一个 `estimateMinutes: null`，精确断言请求体的测试需要更新。这恰恰说明测试在保护契约——请求体的形状变了，测试会第一时间知道。更新断言后：

```
Tests  28 passed (28)
✓ packages/api-client/openapi.json 与服务端代码一致
✓ packages/api-client/src/generated/openapi.ts 与服务端代码一致
```

### 第 8 步：列表展示

在 `TaskList` 里加一行（作为练习）：

```tsx
{
  task.estimateMinutes !== null && (
    <span>预估 {task.estimateMinutes} 分钟</span>
  );
}
```

`task.estimateMinutes` 的类型是 `number | null`，来自生成的契约。

### 第 9 步：提交与发布

提交内容：

```
apps/api/drizzle/<时间戳>_task_estimate/      迁移
apps/api/src/db/schema.ts                     数据库
apps/api/src/contract/tasks.ts                契约（源头）
apps/api/src/services/task-service.ts         DTO 与插入
apps/api/test/api.test.ts                     往返测试
packages/api-client/openapi.json              生成物
packages/api-client/src/generated/openapi.ts  生成物
apps/web/src/features/tasks/*                 表单、展示与测试
```

CI 中：漂移检查 ✓、边界检查 ✓、OpenAPI lint ✓、类型检查 ✓、测试 ✓、**oasdiff：无破坏性变更** ✓。

发布顺序：

```
① 执行数据库迁移（新增可空列，对旧服务无影响）
② 发布服务端（接受并返回 estimateMinutes）
   → 此时旧前端：不发这个字段，忽略响应里的这个字段，正常工作
③ 发布前端（开始发送并展示）
```

### 回顾：谁在每一步推动你

| 步骤                     | 推动者                                  | 如果没有它                       |
| ------------------------ | --------------------------------------- | -------------------------------- |
| DTO 漏了字段             | **服务端类型检查**（`toTaskDto: Task`） | 响应少字段，前端拿到 `undefined` |
| INSERT 漏了字段          | **服务端测试**（往返测试）              | 用户输入被静默丢弃               |
| 忘了重新生成             | **漂移检查**                            | 前端用旧类型，CI 绿但线上错      |
| 前端约束比契约宽松       | **契约对齐测试**                        | 表单通过、提交 400               |
| 请求体形状变化           | **组件测试的精确断言**                  | 无意中改变了发出的请求           |
| 不兼容的修改             | **oasdiff**                             | 旧客户端在发布后崩溃             |
| 前端误 import 服务端代码 | **边界检查**                            | 实现细节泄露、构建耦合           |

没有一步依赖「记得去做」。这就是「稳定可验证的契约」的完整含义。

---

## 13.3 逐项验收：每一项都有证据

### 🎯 总目标：将前端和后端通过稳定可验证的契约连接起来，减少手写类型漂移

- [x] 契约的唯一来源是 `apps/api/src/contract/*.ts` → 证据：`openapi:export` 脚本；`contract:check`
- [x] 前端没有任何手写的 API 类型 → 证据：`packages/api-client/src/index.ts` 只有对生成类型的别名
- [x] 契约变化会被自动发现 → 证据：13.2 节演练

### ① Fastify route schema / OpenAPI 作为权威描述

| 要求                           | 证据                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 请求（path/query/header/body） | `routes/tasks.ts` 的 `params` / `querystring` / `headers` / `body`；`openapi.json` 中的 `parameters` 与 `requestBody` |
| 响应                           | `response: { 201: ref(Task) }`；`components.schemas.Task`                                                             |
| 状态码                         | `errorResponses(400, 401, 403, 404, 409, 422, 500)`；元测试「每个操作都有 500」                                       |
| 安全方案                       | `components.securitySchemes.cookieAuth / csrfHeader`；路由级 `security`；元测试                                       |
| 分页                           | `listTasks` 的 `limit`/`cursor`；`TaskPage`；「不重不漏」测试                                                         |

### ② 从 OpenAPI 生成客户端，`apps/web` 不依赖服务端实现

| 要求                                | 证据                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| 生成类型                            | `openapi-typescript` → `src/generated/openapi.ts`                             |
| 请求封装                            | `createApiClient`（openapi-fetch + 中间件）、`unwrap`                         |
| 不依赖服务端                        | `apps/web/package.json` 无服务端依赖；`pnpm boundaries:check`                 |
| **练习 1**：CI 检查生成结果是否过期 | `scripts/check-contract.mjs`；`.github/workflows/ci.yml`；第 4.6 节的失败演示 |

### ③ 前端 Zod 与后端 TypeBox 职责独立

| 要求               | 证据                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| Zod 只做表单体验   | `task-form-schema.ts`：允许 `""`、中文文案、`toCreateTaskBody`                                             |
| TypeBox 是信任边界 | `additionalProperties: false` + `removeAdditional: false`；服务端决定 `status/createdBy/version`           |
| 独立但不分叉       | `satisfies Record<TaskPriority, string>`；`toCreateTaskBody(): CreateTaskBody`；`task-form-schema.test.ts` |

### ④ 错误 envelope、requestId、字段映射、取消与重试

| 要求              | 证据                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| 统一错误 envelope | `ErrorResponse` schema；`plugins/errors.ts` 四个分支；所有错误测试都 `assertMatchesSchema("ErrorResponse")` |
| requestId         | `genReqId`（采纳合法上游值）；`onSend` 写回响应头；测试「沿用上游合法的 X-Request-Id，拒绝不安全的值」      |
| 字段错误映射      | `toFieldErrors`（JSON Pointer → 点号路径）；`applyServerFieldErrors`；组件测试「400 字段错误 → 回填」       |
| 取消请求          | `queryFn({ signal })` → `api.GET(…, { signal })`；中间件放过 AbortError；client 测试                        |
| 重试策略          | `shouldRetryQuery` / `retryDelay`；mutation 默认不重试；`useCreateTask` 只重试网络错误；表驱动测试          |

### ⑤ 认证 Cookie、credentials、CSRF/CORS、预检、代理

| 要求        | 证据                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------- |
| 会话 Cookie | `HttpOnly; SameSite=Lax; Secure(生产)`；测试「会话 Cookie 是 HttpOnly + SameSite=Lax」            |
| credentials | api-client `credentials: "include"`                                                               |
| CORS 与预检 | `@fastify/cors` 白名单 + `exposedHeaders`；两个预检测试                                           |
| CSRF        | Origin 校验 + 会话绑定的 `X-CSRF-Token`；两个 CSRF 测试                                           |
| 代理        | Vite `/api` 代理（`changeOrigin: false`）；Nginx 示例；`TRUST_PROXY`；第 8.6 节经代理的 curl 实测 |

### ⑥ 幂等与并发

| 要求                     | 证据                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| 按业务决定是否需要幂等键 | 第 11.2 节决策表；`createTask` 契约要求 `Idempotency-Key`                                             |
| 正确实现                 | 同事务「占键 → 执行 → 存响应」；三个幂等测试（重放 / 422 / 失败不占键）                               |
| 客户端键生命周期         | `useRef` + 成功/确定失败换新；测试「网络错误自动重试，且重试复用同一个幂等键」「成功后换新键」        |
| 常规更新的并发控制       | `version` + `If-Match` + 条件 UPDATE；测试「缺 If-Match → 428；旧版本 → 412」；`TaskList` 的 412 测试 |

### ⑦ 版本兼容、弃用、分页契约、日期/时区与枚举

| 要求      | 证据                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| 版本兼容  | `/api/v1` 前缀；第 12.2 节兼容规则；CI 中的 oasdiff                                                         |
| 弃用策略  | `GET /api/v1/me`：`deprecated: true` + `Deprecation`/`Sunset`/`Link`；测试                                  |
| 分页契约  | `CursorPage`；不透明游标；`limit` 1~100；稳定排序；非法游标 400；测试                                       |
| 日期/时区 | `DateTime`（UTC Z）与 `CalendarDate`（YYYY-MM-DD）；`timestamptz(3)`；`toISOString()`；`formatCalendarDate` |
| 枚举      | 字符串枚举；契约与 pgEnum 分开但被类型检查关联；`label()` 兜底 + 测试                                       |

### 必须完成的动手练习

- [x] **练习 1**：生成或更新 OpenAPI 后运行客户端类型生成脚本，并让 CI 检查生成结果是否过期 → `pnpm contract:generate` / `pnpm contract:check` / `ci.yml`（第 4 章）
- [x] **练习 2**：完整「创建任务」链路 → `CreateTaskForm`（RHF）→ `createTaskFormSchema`（Zod）→ `useCreateTask`（Query mutation）→ `POST /api/v1/projects/{projectId}/tasks`（Fastify schema）→ `assertCanWrite`（AuthZ）→ `db.transaction` + `insert(tasks)`（Drizzle）→ Postgres（迁移、约束）（第 9、10 章）
- [x] **练习 3**：400 字段错误、401、403、404、409、500 映射到合适的 UI → `describeError` + `ErrorBanner` + `applyServerFieldErrors` + 组件测试（第 10 章）

---

## 13.4 通过标准的最终验证

### 标准 1：前端代码不复制维护第二套 API 响应类型；合同变更会在编译或 CI 中暴露

```bash
# 前端里没有手写的 API 类型（只有对生成类型的引用）
grep -rn "interface Task\b\|type Task = {" apps/web/src || echo "✓ 没有手写的 Task 类型"

# 契约变更在编译中暴露：13.2 第 3 步（服务端）、第 4.7 节加 urgent（前后端同时报错）
# 契约变更在 CI 中暴露：第 4.6 节漂移检查、第 12.6 节 oasdiff
```

### 标准 2：任何客户端校验绕过都不能破坏服务器端的数据正确性与权限

```bash
pnpm --filter @taskflow/api test -- -t "绕过前端|只读成员|非成员|CSRF|Origin"
```

覆盖的绕过方式：越权字段（`status`/`createdBy`/`version`）、非法枚举、非法日期、超长文本、纯空白标题、只读成员写入、非成员读写（包括 IDOR）、缺 CSRF token、恶意 Origin。外加数据库层的 CHECK 与唯一约束作为最后防线（第 5.5 节纯空白标题的案例）。

### 标准 3：错误可被 UI 解释，同时服务器端日志保留排查所需上下文，不泄露内部细节

```bash
pnpm --filter @taskflow/api test -- -t "500"
pnpm --filter @taskflow/web test -- -t "describeError|403|500"
```

- UI 可解释：每种状态码都有标题、说明、下一步动作；字段错误落在字段上；
- 日志有上下文：每条日志带 `requestId`；`AppError.logContext` 记录排查数据；5xx 记完整错误；
- 不泄露：500 响应体只有固定文案和 requestId（测试断言不含 `ECONNREFUSED`、密码）；`humanMessage` 不输出正则等实现细节。

---

## 13.5 全书常见坑汇总

| #   | 坑                                                                          | 章    |
| --- | --------------------------------------------------------------------------- | ----- |
| 1   | 前端 import 后端类型 / 用相对路径越界                                       | 1、2  |
| 2   | TypeScript 7 与 openapi-typescript 的 peer 冲突                             | 2     |
| 3   | `Type.Ref` 丢类型、生成的 schema 名叫 `def-0`                               | 3     |
| 4   | 以为响应 schema 会校验数据                                                  | 3     |
| 5   | 声明了 4xx schema 却没有统一错误处理 → `FST_ERR_FAILED_ERROR_SERIALIZATION` | 3、6  |
| 6   | 改了接口忘了重新生成                                                        | 4     |
| 7   | openapi-fetch 内联 body 不做多余属性检查                                    | 4     |
| 8   | 4xx 时 `useQuery` 显示成功                                                  | 4     |
| 9   | 表单约束比契约宽松 / 层间语义不一致（纯空白标题 → 500）                     | 5     |
| 10  | 响应里出现 SQL、堆栈                                                        | 6     |
| 11  | 原样信任外部 `X-Request-Id`                                                 | 6     |
| 12  | 默认重试所有错误，404 要转 7 秒                                             | 7     |
| 13  | 取消当成网络错误 / 取消当成撤销                                             | 7     |
| 14  | 以为 CORS 能防 CSRF；`origin: true` + `credentials`                         | 8     |
| 15  | Vite 代理 `changeOrigin: true` / 生产代理后没开 `trustProxy`                | 8     |
| 16  | 非成员返回 403 泄露资源存在 / 前置条件检查早于授权                          | 9、11 |
| 17  | 所有 23505 都翻译成同一句话                                                 | 9     |
| 18  | `mutate` 导致 `isSubmitting` 提前结束                                       | 10    |
| 19  | 在 `mutationFn` 里生成幂等键                                                | 7、11 |
| 20  | 先查再插的「伪幂等」                                                        | 11    |
| 21  | 新增请求字段时前端先上线                                                    | 12    |
| 22  | 时间精度不对齐导致游标漏行                                                  | 12    |
| 23  | `new Date("YYYY-MM-DD")` 差一天                                             | 12    |
| 24  | 前端对未知枚举 / 未知错误码没有兜底                                         | 6、12 |
| 25  | 类型检查通过就以为输入被使用了（INSERT 漏字段）                             | 13    |

---

## 13.6 下一步可以往哪走

- **契约优先（design-first）**：当 API 要对外开放、多团队协作时，可以先评审 `openapi.yaml` 再实现。可以用 `openapi-typescript` 生成服务端也要满足的类型，或用 oasdiff 检查实现导出的契约与设计稿一致；
- **消费者驱动契约测试**：用 Pact 等工具，让每个客户端声明「我依赖契约的哪些部分」，服务端 CI 验证不会破坏它们。适合多个独立部署的客户端；
- **从 OpenAPI 生成 mock**：用 MSW 根据契约生成 mock handler，前端可以在后端还没实现时开发，而且 mock 永远和契约一致；
- **运行时响应校验**：在开发环境用 OpenAPI 生成的 Zod/Ajv 校验器校验每个响应，把「服务端违反契约」从测试扩展到日常开发；
- **分布式追踪**：把 requestId 升级为 W3C `traceparent`（OpenTelemetry），前端、网关、API、数据库的耗时都能串在一条 trace 上；
- **限流**：用 `@fastify/rate-limit` 给登录和写接口加限流，429 + `Retry-After` 已经在客户端处理好了。

---

## 13.7 结语

回到第 1 章的那个事故：后端把 `done` 改成了 `status`、把 `dueAt` 改成了 `dueDate`，前端一个错都没报，直到用户反馈。

在 TaskFlow 里，同样的修改会发生什么？

1. 后端改了 TypeBox 契约，`toTaskDto` 立刻编译失败；
2. 忘了重新生成？`contract:check` 让 CI 变红；
3. 重新生成后，前端所有读 `task.done`、`task.dueAt` 的地方编译失败；
4. 删除字段是破坏性变更，oasdiff 在 PR 上拦下它，要求走「扩展-迁移-收缩」或 `/v2`；
5. 即使有人绕过这一切，服务端依然拒绝所有不符合契约的请求，数据库依然拒绝所有违反约束的数据。

**契约不是一份文档，而是一组被持续执行的约束。** 你写下它一次，然后让编译器、测试和 CI 每天替你检查成千上万次。这就是本教程的全部。

---

上一章：[← 第 12 章：版本、弃用、分页与序列化规范](./12-versioning-pagination-serialization.md) ｜ 返回目录：[README](./README.md)
