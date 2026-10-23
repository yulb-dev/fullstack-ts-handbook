# 第 8 章：zodResolver 与校验闭环

> 本章目标：用 `zodResolver` 把第 5 章的 Zod schema 接到第 6 章的 RHF 上，处理 `z.input≠z.output` 的类型难题；然后打通**客户端校验 → 提交 → 服务端校验 → 错误回显**的完整闭环，并牢牢记住那条铁律：**客户端校验是用户体验，不是安全边界**。
> 对应路线图能力点：**[6] 校验闭环** + **[7] 服务端校验（安全边界）**。

---

## 8.1 全景：两道校验，一个闭环

先看整体，再抠细节：

```
   ┌─────────────────────── 客户端（浏览器）───────────────────────┐
   │                                                                 │
   │  用户输入 ──▶ RHF 收集值 ──▶ zodResolver 用 Zod 校验            │
   │                                    │                            │
   │                     ┌──────────────┴──────────────┐            │
   │                  校验失败                       校验通过          │
   │                     │                              │            │
   │          errors 落到字段，role=alert 播报      handleSubmit 回调  │
   │          （第 4 章错误展示）                        │            │
   │                                                     ▼            │
   │                                              fetch POST /api      │
   └─────────────────────────────────────────────────────┬───────────┘
                                                          │
   ┌─────────────────────── 服务端（Node）─────────────────▼───────────┐
   │  用【同一份 Zod schema】再校验一次（safeParse）                    │
   │        │                                                          │
   │   ┌────┴─────┐                                                    │
   │ 失败         成功 ──▶ 业务处理（查库/扣款/建实例）                 │
   │   │                          │                                    │
   │   │                    业务级错误（重名/配额/过期）                │
   │   ▼                          ▼                                    │
   │  返回结构化 issues    返回 { ok:false, errors:[...] }             │
   └───────────────────────────────┬──────────────────────────────────┘
                                    │  HTTP 4xx + JSON
   ┌────────────────────────────────▼───────────────────────────────┐
   │  客户端把服务端错误【批量映射】到 setError，回显到对应字段          │
   └──────────────────────────────────────────────────────────────────┘
```

**两道校验各司其职**：

|                | 客户端校验                           | 服务端校验                                      |
| -------------- | ------------------------------------ | ----------------------------------------------- |
| 目的           | **用户体验**：即时反馈、少跑网络     | **安全边界**：绝不能信任客户端                  |
| 能否被绕过     | ✅ 能（禁用 JS、改请求、直接调 API） | ❌ 不能                                         |
| 校验什么       | 格式、必填、跨字段一致性             | 一切客户端校验的 + 权限、配额、唯一性、业务规则 |
| 用同一份 Zod？ | 是                                   | **是**（复用 schema 是关键）                    |

> **铁律**：**客户端校验是用户体验，不是安全边界。** 任何只在客户端做的校验，都等于没做——攻击者可以直接构造请求打到你的 API。所以**服务端必须用同一套规则再校验一遍**。Zod 的最大价值之一，就是让这「同一套规则」在前后端**物理复用同一份代码**。

---

## 8.2 用 zodResolver 接入 RHF

安装 resolver 包（RHF 官方维护）：

```bash
pnpm add @hookform/resolvers
```

把 Zod schema 交给 `useForm` 的 `resolver`：

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod"; // 或 "zod/v4"
import { LaunchSchema } from "./launch-schema";

const form = useForm({
  resolver: zodResolver(LaunchSchema),
  defaultValues: {
    /* ... */
  },
});
```

接入后发生的事：

- **校验规则统一由 Zod schema 说了算**，不用再在 `register` 里写 `required`/`pattern`；
- 提交（或按 `mode` 触发）时，resolver 内部对表单值跑 `safeParse`；
- 校验**失败** → 把 `ZodError.issues` 转成 RHF 的 `formState.errors`，按 `path` 落到字段；
- 校验**成功** → `handleSubmit(onValid)` 的 `onValid` 收到**解析后的强类型数据**（即 `z.output`）。

```tsx
<form
  onSubmit={form.handleSubmit((data) => {
    // data 的类型是 LaunchSchema 的 output（transform/coerce 已生效）
    console.log(data.replicas); // number，不是 string
  })}
/>
```

---

## 8.3 类型难题：`z.input` vs `z.output` 与三泛型 ★

这是接 resolver 时**最容易报类型错**的地方，也是核心清单点名验收的点。回顾第 5.5 节：一旦 schema 用了 `transform`/`coerce`/`default`，**输入类型 ≠ 输出类型**。

而 `useForm<T>` 的**单泛型**会把「输入」和「输出」**钉成同一个 T**，于是和 zodResolver「输入输出分离推导」的行为**冲突**，TS 直接报错。

### 官方推荐写法

**方案 A（首选）：省略泛型，让 resolver 自己推导**

```tsx
const form = useForm({
  resolver: zodResolver(LaunchSchema),
  defaultValues: {
    /* ... */
  },
});
// form 的输入/输出类型自动从 LaunchSchema 推导，最省心
```

**方案 B：显式写三个泛型** `useForm<Input, Context, Output>`

```tsx
import { z } from "zod";

const form = useForm<
  z.input<typeof LaunchSchema>, // ① 表单"输入"类型（transform 前）
  unknown, // ② context 类型（用不到就 unknown/any）
  z.output<typeof LaunchSchema> // ③ 提交"输出"类型（transform 后）
>({
  resolver: zodResolver(LaunchSchema),
});
```

三泛型的含义：

| 位置 | 泛型                              | 作用                                                      |
| ---- | --------------------------------- | --------------------------------------------------------- |
| ①    | `TFieldValues` = `z.input`        | 表单**收集/持有**的值类型（用户输入的原始形态）           |
| ②    | `TContext`                        | `useForm({ context })` 的上下文类型，一般 `unknown`       |
| ③    | `TTransformedValues` = `z.output` | `handleSubmit(onValid)` 里 `onValid` 收到的**解析后**类型 |

```tsx
// 有了三泛型，onValid 的参数自动是 output 类型
form.handleSubmit((data) => {
  data.replicas; // ✅ number（output 侧），不是 string（input 侧）
});
```

> **什么时候必须用方案 B**：当你的 schema 用了 `.default()`、`.transform()`、`z.coerce.*`，且 TS 报「input 与 output 不兼容」时。官方 resolvers 文档明确给了这个三泛型范例：
>
> ```tsx
> const schema = z.object({ debug_mode: z.boolean().default(true) });
> useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
>   resolver: zodResolver(schema),
> });
> ```
>
> 记忆法：**`default`/`transform` 让字段在 input 侧"可选/宽松"、在 output 侧"必填/严格"，单泛型装不下这种差异，就用三泛型分开装。**

---

## 8.4 `criteriaMode`：报第一个错还是全部错

`useForm` 的 `criteriaMode` 控制**同一字段**校验失败时报几条：

```tsx
const form = useForm({
  resolver: zodResolver(LaunchSchema),
  criteriaMode: "all", // "firstError"（默认）| "all"
});
```

- `"firstError"`（默认）：每字段只报**第一个**错误；
- `"all"`：报**所有**错误。`formState.errors[name]` 会带 `types`（多条错误的映射）。

配合第 2.5 节 shadcn `FieldError` 的 `errors` 数组，能把一个字段的多个问题**列成清单**展示：

```tsx
{
  fieldState.invalid && (
    <FieldError
      errors={Object.values(fieldState.error?.types ?? { _: fieldState.error })}
    />
  );
}
```

> 密码强度这种「一次告诉用户所有不满足的规则」的场景，`criteriaMode: "all"` + 第 5.4 的 `superRefine` 是绝配。

---

## 8.5 服务端校验：复用同一份 schema

因为 Zod schema 是纯 TS，**Node 服务端能直接 import 前端那份 schema**——这就是「单一事实来源」的威力。下面用 Node + Express 风格演示（和你熟悉的前端是同一套 TS/async 心智）。

### 服务端 handler

```ts
// src/server/validate.ts —— 服务端复用同一份 schema
import { LaunchSchema } from "@/features/launch/launch-schema";

export function validateLaunch(body: unknown) {
  // safeParse：不抛异常，返回 success/error（第 5.6 节）
  const result = LaunchSchema.safeParse(body);
  return result;
}
```

```ts
// src/server/routes/instances.ts —— Express 风格路由
import express from "express";
import { validateLaunch } from "../validate";

export const router = express.Router();

router.post("/api/instances", async (req, res) => {
  // ① 结构校验：复用同一份 Zod schema
  const parsed = validateLaunch(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      // 把 Zod 的 issues 原样返回，前端好映射
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path, // 数组，如 ["maxReplicas"] 或 ["emails",1,"address"]
        message: issue.message,
      })),
    });
  }

  // ② 业务校验：只有服务端能做的（唯一性/配额/权限）
  const data = parsed.data; // 强类型 output
  const existing = await db.instance.findByName(data.name);
  if (existing) {
    return res.status(409).json({
      ok: false,
      errors: [{ path: ["name"], message: "该实例名已被占用" }],
    });
  }

  // ③ 通过 → 建实例
  const instance = await db.instance.create(data);
  return res.status(201).json({ ok: true, instance });
});
```

**关键点**：

- **结构校验用同一份 `LaunchSchema`**——前端改规则，后端自动同步，永不分叉；
- **业务校验（唯一性/配额）只能在服务端做**——这正是「客户端拦不住」的部分；
- **返回结构统一**：`{ ok: false, errors: [{ path, message }] }`，`path` 是数组，天然支持嵌套/数组字段。

---

## 8.6 客户端映射服务端错误 → `setError`

服务端返回的 `errors: [{ path, message }]`，要在前端**批量映射**到 RHF 字段。写一个通用工具：

```tsx
// src/features/launch/map-server-errors.ts
import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";

type ServerIssue = { path: (string | number)[]; message: string };

export function applyServerErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  issues: ServerIssue[],
) {
  for (const issue of issues) {
    // 把 ["emails", 1, "address"] 拼成 "emails.1.address"，正是 RHF 的字段路径写法
    const name = issue.path.join(".") as FieldPath<T>;
    setError(name, { type: "server", message: issue.message });
  }
}
```

> **为什么 `path.join(".")` 就能对上字段？** 因为 RHF 用**点号路径**表示嵌套/数组字段（`emails.1.address`），而 Zod 的 `issue.path` 是**数组**（`["emails", 1, "address"]`）。两者一拼即通——这就是「同一份 schema 前后端复用」在错误映射上的红利。

### 在提交回调里使用

```tsx
async function onSubmit(data: LaunchOutput) {
  const res = await fetch("/api/instances", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": keyRef.current,
    },
    body: JSON.stringify(data),
  });
  const json = await res.json();

  if (!res.ok) {
    if (json.errors?.length) {
      applyServerErrors(form.setError, json.errors); // 字段级错误批量回填
    } else {
      form.setError("root", { message: json.message ?? "开通失败" }); // 表单级兜底
    }
    return;
  }

  form.reset();
  keyRef.current = crypto.randomUUID();
}
```

**空路径错误（表单级）怎么办？** 有些服务端错误的 `path` 是空数组 `[]`（不属于任何字段，如「账户欠费」）。约定：`path` 为空时映射到 `"root"`：

```tsx
const name = issue.path.length ? issue.path.join(".") : "root";
setError(name as FieldPath<T>, { type: "server", message: issue.message });
```

然后在表单顶部用 `formState.errors.root` + `role="alert"` 展示（第 7.6 节）。

---

## 8.7 完整闭环：把所有环节拼起来

```tsx
// src/features/launch/launch-form.tsx（闭环版核心）
import { useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { LaunchSchema, type LaunchOutput } from "./launch-schema";
import { applyServerErrors } from "./map-server-errors";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function LaunchForm() {
  const form = useForm<z.input<typeof LaunchSchema>, unknown, LaunchOutput>({
    resolver: zodResolver(LaunchSchema), // ← 客户端校验（体验）
    mode: "onTouched",
    criteriaMode: "all",
    defaultValues: {
      name: "",
      autoScale: false,
      minReplicas: 1,
      maxReplicas: 3,
      contactEmail: "",
    },
  });
  const submittingRef = useRef(false);
  const keyRef = useRef(crypto.randomUUID());

  async function onSubmit(data: LaunchOutput) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      const res = await fetch("/api/instances", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": keyRef.current,
        },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) {
        // ← 服务端校验（安全边界）回显
        if (json.errors?.length) applyServerErrors(form.setError, json.errors);
        else form.setError("root", { message: json.message ?? "开通失败" });
        return;
      }
      form.reset(); // ← 成功回到 pristine
      keyRef.current = crypto.randomUUID();
    } catch {
      form.setError("root", { message: "网络异常，请重试" });
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
      className="grid gap-4"
    >
      {form.formState.errors.root && (
        <div
          role="alert"
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
          {form.formState.errors.root.message}
        </div>
      )}

      <Controller
        name="name"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>实例名称</FieldLabel>
            <Input
              {...field}
              id={field.name}
              aria-invalid={fieldState.invalid}
              aria-describedby={
                fieldState.invalid ? `${field.name}-error` : undefined
              }
            />
            {fieldState.invalid && (
              <FieldError
                id={`${field.name}-error`}
                errors={[fieldState.error]}
              />
            )}
          </Field>
        )}
      />

      {/* ...其余字段同理... */}

      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "开通中…" : "开通实例"}
      </Button>
    </form>
  );
}
```

这一个组件同时做到了：**客户端校验（resolver）+ 可访问错误展示（第 4 章）+ 服务端校验回填（setError 批量映射）+ 生命周期与防重复提交（第 7 章）**。这就是完整闭环。

---

## 8.8 客户端 vs 服务端：谁校验什么

给一张分工表，避免「什么都塞客户端」或「什么都等提交」：

| 校验类型                    | 放客户端（Zod resolver）  | 放服务端（同 schema + 业务） | 说明                       |
| --------------------------- | ------------------------- | ---------------------------- | -------------------------- |
| 必填、格式（email/长度）    | ✅                        | ✅                           | 两端都校，服务端为准       |
| 跨字段（min≤max、密码一致） | ✅                        | ✅                           | schema 的 refine，两端复用 |
| 唯一性（实例名/用户名）     | 异步预检（第 9 章，体验） | ✅ 必须                      | 只有服务端有全量数据       |
| 权限（能不能建）            | ❌                        | ✅                           | 客户端无从判断             |
| 配额/余额/库存              | ❌                        | ✅                           | 客户端数据不可信           |
| 价格/金额计算               | ❌                        | ✅                           | 绝不能信客户端算的钱       |

> **原则**：客户端做的所有校验，服务端都要**再做一遍**；服务端**额外**做客户端做不到的（权限、配额、唯一性、金额）。异步唯一性预检（第 9 章）是为了**体验**（早点告诉用户重名），但**最终判定仍在服务端**。

---

## 8.9 本章练习

1. **接 resolver**：把第 6.11 的表单接上 `zodResolver(LaunchSchema)`，删掉 `register` 里的内联规则，验证校验改由 schema 驱动。
2. **三泛型实验**：给 schema 加一个 `.default()` 字段，先用单泛型 `useForm<T>` 触发类型错误，再用三泛型修好，体会 `z.input`/`z.output` 的差异。
3. **criteriaMode**：对密码字段用 `superRefine` 报多条错，把 `criteriaMode` 设为 `"all"`，用 `FieldError` 列出全部问题。
4. **本地假服务端**：写一个本地函数模拟 `POST /api/instances`，对特定实例名返回 409 + `{ errors:[{path:["name"],message:"已占用"}] }`，用 `applyServerErrors` 回填并验证。
5. **root 错误映射**：让假服务端返回一条 `path: []` 的错误，验证它落到 `errors.root` 并在顶部展示。
6. **思考题**：如果只在客户端校验、服务端不校，攻击者用 `curl` 直接发一个非法请求会发生什么？为什么「同一份 Zod schema」能防止前后端规则分叉？

---

## 8.10 本章验收清单

学完本章，你应该能：

- [ ] 用 **`zodResolver`** 把 Zod schema 接入 RHF，让校验规则单一来源；
- [ ] 处理 **`z.input ≠ z.output`** 的类型难题：省略泛型让 resolver 推导，或用**三泛型** `useForm<Input, Ctx, Output>`；
- [ ] 说清 `handleSubmit(onValid)` 收到的是 **output** 类型（transform/coerce 已生效）；
- [ ] 用 **`criteriaMode: "all"`** 展示一个字段的多条错误；
- [ ] 在**服务端复用同一份 Zod schema**（`safeParse`）做结构校验，并额外做业务校验；
- [ ] 把服务端返回的 `issues`（含 `path` 数组）**批量映射**到 `setError`，空 path 落 `root`；
- [ ] 画出并实现**完整校验闭环**；
- [ ] **牢记并能解释**：客户端校验是**用户体验**、不是**安全边界**，服务端必须再校验。

---

## 8.11 常见坑速查

| 现象                                | 原因                                | 解决                                                 |
| ----------------------------------- | ----------------------------------- | ---------------------------------------------------- |
| 接 resolver 后类型报错              | input≠output 却用了单泛型           | 省略泛型或三泛型 `useForm<z.input,unknown,z.output>` |
| `register` 规则和 schema 打架       | 两处都写了校验                      | 规则只放 schema                                      |
| onValid 里字段是 string 不是 number | 没用 coerce/transform               | schema 里 `z.coerce.number()`，output 才是 number    |
| 服务端错误显示不出来                | `path` 没 join 成点号 / name 不匹配 | `path.join(".")`；核对字段名                         |
| 表单级错误无处安放                  | 用了空 path 却没落 root             | 空 path → `setError("root", ...)`                    |
| 前端过了后端却拒                    | 只信客户端校验                      | 服务端用同 schema + 业务校验                         |
| 前后端规则不一致                    | 各写各的校验                        | 抽到独立 schema 文件，两端 import                    |
| 一个字段只显示第一条错              | 默认 `firstError`                   | `criteriaMode: "all"`                                |

---

上一章：[← 第 7 章：表单生命周期](./07-form-lifecycle.md) ｜ 下一章：[第 9 章：复杂字段与高级校验 →](./09-advanced-fields.md)
