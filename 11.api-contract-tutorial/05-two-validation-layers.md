# 第 5 章：Zod 与 TypeBox：两道校验，各守一边

> 本章目标：分清**前端 Zod（表单体验）**与**后端 TypeBox（信任边界）**各自负责什么；理解本教程为什么让两者**独立**而不是共用同一份 schema；用「三道闸」防止它们悄悄分叉；最后用「绕过测试」证明：无论客户端怎么作弊，服务端的数据正确性和权限都不会被破坏。
>
> 对应核心概念：**③ 前端 Zod 与后端 TypeBox 的职责：表单 UX 校验和服务端信任边界校验各自独立。**
> 对应通过标准：**任何客户端校验绕过都不能破坏服务器端的数据正确性与权限。**

---

## 5.1 一个转变：为什么不再共用同一份 schema？

如果你读过本系列的《可访问设计系统与复杂表单实战》，会记得第 8 章的做法：**前后端 import 同一份 Zod schema**，「前端改规则，后端自动同步，永不分叉」。

那是一个合理的方案，尤其适合全栈 Next.js 这种「前后端本来就是同一份代码」的项目。但在本教程的架构里，我们换了一种做法：**服务端用 TypeBox 描述 HTTP 契约，前端用 Zod 描述表单，两者独立维护。**

这不是推翻之前的结论，而是因为约束变了。我们来看看「共用一份 schema」在这里会遇到什么问题。

### 问题 1：表单的形状 ≠ 请求的形状

看看「创建任务」表单里用户实际输入的东西：

| 字段             | 表单里的值                           | 请求体里应该是 |
| ---------------- | ------------------------------------ | -------------- |
| 描述（没填）     | `""`（空字符串）                     | `null` 或不传  |
| 截止日期（没选） | `""`（`<input type="date">` 的空值） | `null`         |
| 截止日期（选了） | `"2026-10-30"`                       | `"2026-10-30"` |
| 优先级           | `"medium"`（下拉框默认值）           | `"medium"`     |
| 标题             | `"  写发布说明  "`（有空格）         | 去掉首尾空格   |

表单 schema 需要接受 `""`，请求 schema 需要拒绝它（空描述应该是 `null`，否则数据库里会出现一堆 `""` 和 `null` 混在一起的数据）。如果强行共用一份，要么前端处处做特判，要么服务端被迫接受「表单专用」的宽松格式。

### 问题 2：校验文案与交互是 UI 的事

「请填写标题」「标题最多 120 个字」「请选择有效日期」——这些文案要国际化、要符合设计规范、可能随 A/B 测试调整。它们属于前端产品体验，不该和服务端的信任边界绑在一起发版。

### 问题 3：服务端要做的远不止「形状校验」

| 服务端必须做                                | 前端能做吗                |
| ------------------------------------------- | ------------------------- |
| 格式、长度、枚举                            | ✅ 能（体验）             |
| 当前用户是谁                                | ❌ 前端说了不算           |
| 有没有权限操作这个项目                      | ❌                        |
| 标题在项目里是否重复（并发安全）            | ❌ 只能「预检」，不能保证 |
| `status` / `createdBy` / `version` 该是多少 | ❌ 必须由服务端决定       |
| 同一个幂等键是否用过                        | ❌                        |

服务端的校验是一整套「信任边界」逻辑，schema 只是其中第一步。

### 问题 4：耦合了部署和技术选型

共用 schema 意味着前端打包会包含服务端的校验库，服务端的升级会影响前端构建。更重要的是，**契约要对多端开放**——移动端、合作伙伴用的是 OpenAPI，不是你的 Zod 文件。

### 所以：独立，但不能「放任」

独立的风险显而易见：两边各写各的，会不会又回到第 1 章的漂移？会，**如果没有任何机制把它们连起来的话**。5.4 节的「三道闸」就是这个机制。

---

## 5.2 两层校验的职责划分

```
                      用户输入
                         │
       ┌─────────────────▼─────────────────┐
       │ 第 1 层：前端 Zod（体验层）         │
       │  · 即时反馈：失焦就提示              │
       │  · 友好文案、可本地化                │
       │  · 把表单值整理成契约形状（"" → null）│
       │  · 挡掉 99% 的无效提交，省一次往返    │
       │  ✗ 可以被绕过：禁用 JS、改请求、curl  │
       └─────────────────┬─────────────────┘
                         │ HTTP
       ┌─────────────────▼─────────────────┐
       │ 第 2 层：服务端 TypeBox + 业务（边界层）│
       │  · 形状：类型、必填、长度、格式、枚举  │
       │  · 拒绝契约外字段（防批量赋值）        │
       │  · 认证、CSRF、授权                  │
       │  · 业务规则：唯一性、状态机、幂等      │
       │  · 服务端决定的字段：status/createdBy │
       │  ✓ 不可绕过：每个请求都必须经过        │
       └─────────────────┬─────────────────┘
                         │ SQL
       ┌─────────────────▼─────────────────┐
       │ 第 3 层：数据库约束（最后防线）       │
       │  · NOT NULL / CHECK / UNIQUE / FK   │
       │  · 即使服务端代码有 bug 也守得住       │
       └───────────────────────────────────┘
```

一句话总结：**前端校验是为了让诚实的用户少犯错，服务端校验是为了让不诚实的请求无法得逞，数据库约束是为了让有 bug 的代码也写不进脏数据。**

---

## 5.3 前端：为表单服务的 Zod schema

**`apps/web/src/features/tasks/task-form-schema.ts`**：

```ts
import type {
  CreateTaskBody,
  TaskPriority,
  TaskStatus,
} from "@taskflow/api-client";
import { z } from "zod";

/**
 * 前端表单 schema：只为「用户体验」服务——即时提示、友好文案、把空字符串整理成 null。
 * 它不是安全边界，服务端的 TypeBox 契约才是。两者独立维护，靠下面三道闸防止漂移：
 *   ① 选项表 satisfies Record<契约枚举, string> —— 枚举增删会编译失败；
 *   ② toCreateTaskBody 的返回类型是生成的 CreateTaskBody —— 字段改名/改类型会编译失败；
 *   ③ task-form-schema.test.ts 比对数值约束 —— 长度上限不一致会测试失败。
 */

export const PRIORITY_LABEL = {
  low: "低",
  medium: "中",
  high: "高",
} as const satisfies Record<TaskPriority, string>;

export const STATUS_LABEL = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
} as const satisfies Record<TaskStatus, string>;

const priorities = Object.keys(PRIORITY_LABEL) as [
  TaskPriority,
  ...TaskPriority[],
];

export const createTaskFormSchema = z.object({
  title: z.string().trim().min(1, "请填写标题").max(120, "标题最多 120 个字"),
  description: z.string().trim().max(2000, "描述最多 2000 个字"),
  priority: z.enum(priorities),
  // <input type="date"> 的值要么是 ""，要么是 YYYY-MM-DD
  dueDate: z.union([z.literal(""), z.iso.date("请选择有效日期")]),
});

export type CreateTaskFormInput = z.input<typeof createTaskFormSchema>;
export type CreateTaskFormOutput = z.output<typeof createTaskFormSchema>;

/** 表单字段名清单：服务端字段错误只回填到这些字段上 */
export const CREATE_TASK_FIELDS = [
  "title",
  "description",
  "priority",
  "dueDate",
] as const;

export const emptyCreateTaskForm: CreateTaskFormInput = {
  title: "",
  description: "",
  priority: "medium",
  dueDate: "",
};

/** 表单值 → 契约请求体。返回类型由生成代码决定，契约一变这里就编译失败 */
export function toCreateTaskBody(values: CreateTaskFormOutput): CreateTaskBody {
  return {
    title: values.title,
    description: values.description === "" ? null : values.description,
    priority: values.priority,
    dueDate: values.dueDate === "" ? null : values.dueDate,
  };
}
```

和契约（第 3 章的 `CreateTaskBody`）对比一下：

|               | 表单 schema（Zod）    | 契约（TypeBox）                 |
| ------------- | --------------------- | ------------------------------- |
| `description` | 必填字符串，允许 `""` | 可选，`string \| null`          |
| `dueDate`     | `""` 或日期字符串     | 可选，`date \| null`            |
| `priority`    | 必填（下拉框总有值）  | 可选（服务端默认 `medium`）     |
| `title`       | `trim()` 后 1~120     | 1~120（服务端另外也会 trim）    |
| 文案          | 「请填写标题」        | 无（Ajv 英文 + 服务端中文兜底） |

它们**描述的是两个不同的东西**：一个是「用户在界面上能输入什么」，一个是「网络上传输什么」。`toCreateTaskBody()` 是两者之间唯一的桥梁。

---

## 5.4 防止分叉的三道闸

独立维护的风险是分叉。我们用三种机制，让任何分叉都在编译或测试时暴露。

### 闸 1：枚举——`satisfies Record<契约枚举, string>`

```ts
export const PRIORITY_LABEL = {
  low: "低",
  medium: "中",
  high: "高",
} as const satisfies Record<TaskPriority, string>;
```

`TaskPriority` 来自生成的契约类型。`satisfies Record<TaskPriority, string>` 要求这个对象**恰好**包含所有枚举值作为键：

- 契约新增 `urgent` → 缺少键 → 编译错误（第 4.7 节的真实输出）；
- 契约删除 `low` → 多余键 → 编译错误。

下拉框的选项从这个对象生成（`Object.keys(PRIORITY_LABEL)`），所以选项列表也永远和契约一致。

> 为什么用 `satisfies` 而不是类型标注 `const PRIORITY_LABEL: Record<TaskPriority, string> = ...`？`satisfies` 检查完整性的同时**保留字面量类型**（`as const` 的效果不会丢失），后续 `Object.keys` 等推导更精确。

### 闸 2：字段——`toCreateTaskBody(): CreateTaskBody`

```ts
export function toCreateTaskBody(values: CreateTaskFormOutput): CreateTaskBody { ... }
```

返回类型是生成的 `CreateTaskBody`。契约里把 `dueDate` 改名为 `dueOn`、把 `title` 改成必须是某种格式的对象、新增一个必填字段……这个函数都会编译失败。而且因为返回的是对象字面量，**多余字段**也会被 TypeScript 拦下（弥补了第 4.3 节提到的 openapi-fetch 盲区）。

### 闸 3：数值约束——契约对齐测试

类型系统表达不了「最多 120 个字」这样的约束。如果契约把上限改成 100，而表单还是 120，用户会填一个 110 字的标题，表单通过，提交后服务端返回 400——体验很差。

我们用一个测试比对两边的约束。Zod 4 自带 `z.toJSONSchema()`，可以把表单 schema 也转成 JSON Schema，然后和 `openapi.json` 里的契约直接比较。

**`apps/web/src/features/tasks/task-form-schema.test.ts`**：

```ts
import contract from "@taskflow/api-client/openapi.json";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  PRIORITY_LABEL,
  createTaskFormSchema,
  toCreateTaskBody,
} from "./task-form-schema";

/**
 * 前端 Zod 与服务端契约「独立维护」，但数值约束不能悄悄分叉。
 * 规则：表单可以比契约更严格（体验选择），但绝不能更宽松——
 * 否则用户在表单里填得好好的，提交后才被服务端 400 拒绝。
 */
type JsonSchema = {
  minLength?: number;
  maxLength?: number;
  enum?: string[];
  anyOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
};

const body = contract.components.schemas.CreateTaskBody as JsonSchema;
const form = z.toJSONSchema(createTaskFormSchema, {
  io: "input",
}) as JsonSchema;

/** 契约里 nullable 字段是 anyOf: [string, null]，取出 string 分支 */
function stringBranch(schema: JsonSchema | undefined): JsonSchema {
  return (
    schema?.anyOf?.find(
      (s) => s.maxLength !== undefined || s.minLength !== undefined,
    ) ??
    schema ??
    {}
  );
}

describe("表单 schema 与 OpenAPI 契约对齐", () => {
  for (const field of ["title", "description"] as const) {
    it(`${field} 的长度限制不比契约宽松`, () => {
      const server = stringBranch(body.properties?.[field]);
      const client = stringBranch(form.properties?.[field]);
      if (server.maxLength !== undefined) {
        expect(client.maxLength, "表单缺少 maxLength").toBeDefined();
        expect(client.maxLength!).toBeLessThanOrEqual(server.maxLength);
      }
      if (server.minLength !== undefined) {
        expect(client.minLength ?? 0).toBeGreaterThanOrEqual(server.minLength);
      }
    });
  }

  it("优先级选项与契约枚举完全一致", () => {
    const serverEnum = (contract.components.schemas.TaskPriority as JsonSchema)
      .enum;
    expect(Object.keys(PRIORITY_LABEL).sort()).toEqual(
      [...(serverEnum ?? [])].sort(),
    );
  });
});
```

注意这个测试读的是 `@taskflow/api-client/openapi.json`——**已发布的契约**，而不是服务端源码。前端依然没有越过边界。

规则是「**表单可以更严，不能更松**」：

- 表单比契约严格（比如表单限制 100 字，契约允许 120）：允许。这可能是产品的体验决策；
- 表单比契约宽松：测试失败。用户会遇到「前端通过、后端拒绝」的割裂体验。

> `{ io: "input" }` 表示按「输入」形态生成 JSON Schema。对于带 `.trim()`、`.transform()` 的 schema，输入和输出形态可能不同；我们关心的是用户能输入什么，所以用 input。

### 三道闸的分工

| 分叉类型                 | 例子                   | 被谁发现                                 | 何时   |
| ------------------------ | ---------------------- | ---------------------------------------- | ------ |
| 枚举增删                 | 新增 `urgent`          | 闸 1（`satisfies`）                      | 编译   |
| 字段改名/改类型/新增必填 | `dueDate` → `dueOn`    | 闸 2（返回类型）                         | 编译   |
| 数值约束变化             | 上限 120 → 100         | 闸 3（对齐测试）                         | 测试   |
| 正则、业务规则           | 「标题不能只包含表情」 | 服务端 400 + 字段错误回填（第 6、10 章） | 运行时 |

最后一行说明：总有一些规则只在服务端存在（或者不值得在前端重复）。对它们，我们的策略不是「同步」，而是**让服务端的拒绝能被优雅地显示在正确的字段上**。

---

## 5.5 服务端：信任边界上的每一道检查

服务端不知道请求来自你的前端、别人写的脚本，还是攻击者。它必须对每个请求独立完成全部检查。回顾一下创建任务时服务端做了什么：

**① 契约形状**（第 3 章，Fastify + Ajv 自动完成）：

- `title`：字符串，1~120；
- `priority`：只能是 `low/medium/high`；
- `dueDate`：合法的 `YYYY-MM-DD` 或 `null`；
- **不允许任何契约外字段**（`additionalProperties: false` + `removeAdditional: false`）；
- `Idempotency-Key` 头：必须是 UUID；
- `projectId`：必须是 UUID。

**② 身份与请求来源**（第 8 章）：Cookie 会话有效、Origin 可信、CSRF token 正确。

**③ 授权**（第 9 章）：是项目成员，且不是只读角色。

**④ 服务端决定的字段**（第 9 章 Service）：

```ts
const [row] = await tx
  .insert(tasks)
  .values({
    projectId, // 来自 URL，已校验权限
    title: input.title.trim(), // 服务端再 trim 一次，不信任前端已经 trim
    description: input.description ?? null,
    priority: input.priority ?? "medium",
    dueDate: input.dueDate ?? null,
    createdBy: userId, // 来自会话，不来自请求体
    // status、version 用数据库默认值：'todo'、1
  })
  .returning();
```

请注意 `createdBy: userId`。如果契约允许客户端传 `createdBy`，任何人都可以「以别人的名义」创建任务——这就是**批量赋值（mass assignment）漏洞**。契约里根本没有这个字段，Ajv 会拒绝；即使将来有人不小心放宽了契约，Service 层也只从会话里取用户 ID。

**⑤ 业务规则**：同项目未完成任务标题唯一（数据库唯一索引 + 409）、幂等键（第 11 章）。

**⑥ 数据库约束**（第 2 章）：`CHECK (char_length(title) between 1 and 120)`、唯一索引、外键。

> **为什么数据库还要再检查一次长度？** 因为服务端代码也可能有 bug。比如将来有人新增一个「批量导入」接口，忘了写 schema——数据库的 CHECK 约束会让这个 bug 变成一个显式的错误，而不是悄悄写入一条 500 字的标题。

### 一个真实的「层间缝隙」：纯空白标题

编写配套工程时，最初的契约是 `Type.String({ minLength: 1, maxLength: 120 })`。看起来很完整，但有一个缝隙：

```
请求体 { "title": "   " }
  → Ajv：长度 3 ≥ 1，通过 ✅
  → Service：trim() 后变成 ""
  → Postgres：CHECK (char_length(title) between 1 and 120) 失败 ❌
  → 未被识别的数据库错误 → 错误处理器的兜底分支 → 500
```

数据没有被写坏（数据库守住了），但用户得到的是「服务器出错了」，而不是「标题不能为空」。**三层防线都在，却因为层与层之间的语义不一致（一层先 trim、一层不 trim），把一个用户输入错误变成了服务端故障。**

修复是让契约表达真实的业务规则——「至少包含一个非空白字符」：

```ts
const Title = Type.String({ minLength: 1, maxLength: 120, pattern: "\\S" });
```

现在 `"   "` 在 Ajv 层就得到 400 和 `rule: "pattern"` 的字段错误，绕过测试里也加上了这个用例。教训是：**写校验规则时，要按「服务端最终会怎么处理这个值」来写，而不是按「字段的原始类型」来写。**

---

## 5.6 绕过测试：证明前端校验可以被拿掉

「服务端会再校验」这句话人人都会说。我们用测试**证明**它：直接用 `app.inject()` 发请求，完全跳过前端（**`apps/api/test/api.test.ts`** 节选）。

```ts
it("绕过前端：偷塞 status / createdBy / version 被拒绝，而不是被采纳", async () => {
  const res = await createTask(alice, {
    title: "越权字段",
    status: "done",
    createdBy: randomUUID(),
    version: 99,
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.fields[0]).toMatchObject({
    rule: "additionalProperties",
  });
});

it("绕过前端：非法枚举、非法日期、超长文本、纯空白标题", async () => {
  for (const payload of [
    { title: "a", priority: "urgent" },
    { title: "a", dueDate: "2026-13-45" },
    { title: "x".repeat(121) },
    { title: "   " },
  ]) {
    const res = await createTask(alice, payload);
    expect(res.statusCode, JSON.stringify(payload)).toBe(400);
  }
});

it("空标题 → fields[].path = title, rule = minLength", async () => {
  const res = await createTask(alice, { title: "" });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.fields).toEqual([
    { in: "body", path: "title", rule: "minLength", message: "至少 1 个字符" },
  ]);
});
```

权限也一样，前端隐藏了「新建任务」按钮，不代表只读成员就不能发请求：

```ts
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
```

你也可以在终端里亲手试（服务启动后）：

```bash
# 登录拿到 Cookie 和 CSRF token
curl -s -c jar.txt -H 'content-type: application/json' \
  -d '{"email":"alice@example.com"}' http://localhost:3000/api/v1/auth/login

# 伪造 createdBy（替换成真实的 projectId 与 csrfToken）
curl -s -b jar.txt -H 'content-type: application/json' \
  -H "x-csrf-token: <csrfToken>" -H "idempotency-key: $(uuidgen | tr A-Z a-z)" \
  -d '{"title":"x","createdBy":"00000000-0000-0000-0000-000000000000"}' \
  http://localhost:3000/api/v1/projects/<projectId>/tasks
# {"error":{"code":"VALIDATION_FAILED","message":"提交的数据有误，请检查标出的字段",
#   "requestId":"…","fields":[{"in":"body","path":"createdBy","rule":"additionalProperties","message":"不允许提交该字段"}]}}
```

这组测试就是通过标准「**任何客户端校验绕过都不能破坏服务器端的数据正确性与权限**」的证据。

---

## 5.7 那「异步唯一性预检」呢？

有些表单会在用户输入标题时，调用一个接口检查「这个标题是否已存在」，提前给出提示。这是很好的体验优化，但要记住：

1. **预检不是保证**。预检和真正提交之间，别人可能已经创建了同名任务；
2. **最终判断必须在写入时，由数据库唯一约束完成**。服务端捕获唯一冲突，返回 409 + `fields: [{ path: "title" }]`；
3. 前端把 409 的字段错误回填到标题输入框（第 10 章）——用户看到的效果和预检一样，只是晚了一步。

所以，即使没有预检接口，只要 409 能映射到字段，体验也是完整的。预检是锦上添花，不是必需品。

---

## 5.8 常见误区

| 误区                                     | 正确理解                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| 「前后端用同一份 schema 才不会漂移」     | 共用是一种方案，但不是唯一方案。独立 + 自动化对齐检查同样可靠，且解耦了表单形状与线上形状 |
| 「前端已经 trim 了，服务端不用再 trim」  | 服务端不能假设请求来自你的前端                                                            |
| 「隐藏按钮就等于没权限」                 | 隐藏是体验，403 是权限。两者都要有                                                        |
| 「Fastify 默认会删掉多余字段，够安全了」 | 安全上够了，但调用方不知道自己传错了。显式拒绝让契约更清晰                                |
| 「数据库约束和 API 校验重复了，删一个」  | 它们防的是不同的东西：API 校验防请求，数据库约束防代码 bug                                |
| 「表单比契约严格是 bug」                 | 不一定，可以是产品决策。但表单**宽松**于契约一定是 bug                                    |

---

## 5.9 本章练习

1. **制造约束漂移**：把契约里的 `title` 上限从 120 改成 100，运行 `pnpm contract:generate` 和 `pnpm --filter @taskflow/web test`，观察对齐测试的失败信息。再试试只把**表单**改成 100，测试是否通过？为什么？
2. **制造字段漂移**：把契约里的 `dueDate` 改名为 `dueOn`，重新生成，看 `toCreateTaskBody` 报什么错。
3. **拆掉一道防线**：暂时去掉契约里 `Title` 的 `pattern: "\\S"`，用 `curl` 发送 `"title": "   "`，观察响应状态码和服务端日志里的数据库错误；再恢复 `pattern`。这个实验说明了什么？
4. **思考题**：如果有一天要给 iOS 客户端开放这个接口，「共用 Zod schema」和「OpenAPI 契约」哪种方案改动更小？

---

## 5.10 本章验收清单

- [ ] 能说出「共用同一份 schema」在本架构下的四个问题；
- [ ] 能画出「前端体验层 / 服务端边界层 / 数据库最后防线」三层校验图，并说明各自防什么；
- [ ] 能解释表单形状与请求形状的差异，以及 `toCreateTaskBody()` 的作用；
- [ ] 实现并能解释三道闸：`satisfies Record<枚举>`、显式返回契约类型、契约对齐测试；
- [ ] 知道哪些字段必须由服务端决定（`createdBy`、`status`、`version`），以及批量赋值漏洞；
- [ ] 绕过测试覆盖：越权字段、非法值、只读成员、非成员，全部被服务端拒绝。

---

上一章：[← 第 4 章：从 OpenAPI 生成客户端，并让 CI 守住它](./04-codegen-and-ci.md) ｜ 下一章：[第 6 章：统一错误 envelope 与 requestId →](./06-error-envelope-and-request-id.md)
