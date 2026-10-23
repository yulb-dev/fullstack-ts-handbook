# 第 5 章：Zod：schema 与类型

> 本章目标：用 Zod v4 把「数据应该长什么样」写成一份 **schema**，并用它同时得到**运行时校验**和**TypeScript 类型**；重点吃透 `refine/superRefine`、`transform`、`safeParse`，以及最容易踩坑的 **`z.input` vs `z.output`**。
> 对应路线图能力点：**[4] Schema 校验**。

---

## 5.1 Zod 是什么，为什么是它

Zod 是一个 **TypeScript 优先的运行时校验库**。你用声明式的 schema 描述数据的形状和规则，Zod 做两件事：

1. **运行时校验**：`parse` 一份未知数据（表单值、API 响应、环境变量），验证它是否合法；
2. **静态类型推导**：从 schema 自动推导出 TS 类型，**一份定义，两处受益**，杜绝「类型和校验规则各写一遍还不同步」。

```
      一份 Zod schema
       ┌──────────┴──────────┐
       ▼                      ▼
  运行时校验               TS 类型推导
  (parse/safeParse)        (z.infer / z.input / z.output)
       │                      │
       └──────┬───────────────┘
              ▼
   前端表单校验 + 后端接口校验（同一份 schema 复用）
```

**为什么表单场景离不开它**：TypeScript 的类型只在**编译期**存在，运行时（用户输入、网络数据）是「无类型」的。Zod 补上了**运行时**这道防线，且能让类型和校验规则**同源**。

> 安装：`pnpm add zod`。导入：`import { z } from "zod"`（或 `import { z } from "zod/v4"` 显式锁定 v4）。本教程用 Zod v4，`z.infer` 等价于 `z.output`。

---

## 5.2 基础：primitive 与 object

### primitive schema

```ts
import { z } from "zod";

const str = z.string();
const num = z.number();
const bool = z.boolean();
```

每个 primitive 都能链式加约束，并**自定义错误消息**：

```ts
const username = z
  .string()
  .min(3, "用户名至少 3 个字符")
  .max(20, "用户名最多 20 个字符");

const replicas = z
  .number({ message: "副本数必须是数字" }) // v4：类型错误也可自定义消息
  .int("必须是整数")
  .min(1, "至少 1 个副本")
  .max(64, "最多 64 个副本");
```

常用字符串校验：`.email()`、`.url()`、`.regex()`、`.trim()`、`.toLowerCase()`。
常用数字校验：`.int()`、`.positive()`、`.min()/.max()`、`.multipleOf()`。

### object schema

```ts
const InstanceConfig = z.object({
  name: z.string().min(3, "实例名至少 3 个字符"),
  replicas: z.number().int().min(1).max(64),
  autoScale: z.boolean(),
});
```

`z.object` 是表单 schema 的主力。默认会**忽略**未声明的字段（`strip`）；也可 `.strict()`（多余字段报错）或 `.passthrough()`（保留多余字段）。

### enum 与联合

```ts
// 字符串枚举：最常用于"下拉选项"
const Region = z.enum(["us-east", "us-west", "eu-central"]);

// 从常量数组推导（避免重复维护）
const PLANS = ["standard", "performance", "enterprise"] as const;
const Plan = z.enum(PLANS);

// 数字/混合枚举用 z.literal 联合
const Priority = z.union([z.literal(1), z.literal(2), z.literal(3)]);
```

`z.enum` 与下拉框的选项**天然对应**：schema 定义合法值，UI 渲染同一份选项，类型也自动收敛为 `"us-east" | "us-west" | "eu-central"`。

---

## 5.3 optional / nullable / default：三者的精确区别

这三个最容易混，务必分清（它们直接影响第 5.5 节的 `z.input`/`z.output`）：

| 修饰符        | 含义                        | 合法值                           | 推导类型                        |
| ------------- | --------------------------- | -------------------------------- | ------------------------------- |
| `.optional()` | 可以**不传**（`undefined`） | 值 或 `undefined`                | `T \| undefined`                |
| `.nullable()` | 可以是 **`null`**           | 值 或 `null`                     | `T \| null`                     |
| `.nullish()`  | 既可不传也可 null           | 值 / `undefined` / `null`        | `T \| null \| undefined`        |
| `.default(v)` | 不传时**填充默认值**        | 输入可 `undefined`，输出一定有值 | 输入 `T \| undefined`，输出 `T` |

```ts
const schema = z.object({
  nickname: z.string().optional(), // 可不填
  deletedAt: z.string().nullable(), // 明确用 null 表示"已删除"
  region: z.enum(["us-east", "eu"]).default("us-east"), // 不选就用默认
});
```

> **`.default()` 的关键陷阱**：带 `.default()` 的字段，在**输入类型**（`z.input`）上是**可选**的（可以 `undefined`），但在**输出类型**（`z.output`）上是**必填**的（因为校验后默认值一定会被填进去）。这正是 5.5 节要重点讲的 input≠output 来源之一。**表单里慎用 `.default()`**，通常直接用 RHF 的 `defaultValues` 给初值更清晰（第 6 章）。

---

## 5.4 refine / superRefine：自定义校验规则

当内置约束不够用（跨字段、复杂业务规则）时，用 `refine`。

### `refine`——返回布尔值

```ts
// 单字段：实例名必须以字母开头
const name = z.string().refine((v) => /^[a-zA-Z]/.test(v), {
  message: "实例名必须以字母开头",
  // path 可选：把错误挂到某个子路径
});
```

### 跨字段 refine（对象级）

`refine` 挂在 object 上时，回调能拿到**整个对象**，用于跨字段规则：

```ts
const ScaleRange = z
  .object({
    minReplicas: z.number().int().min(1),
    maxReplicas: z.number().int().max(64),
  })
  .refine((data) => data.minReplicas <= data.maxReplicas, {
    message: "最小副本数不能大于最大副本数",
    path: ["maxReplicas"], // 把错误显示在 maxReplicas 字段上
  });
```

> `path` 非常重要：它决定错误**挂到哪个字段**，进而决定第 8 章 RHF 把错误显示在哪。跨字段校验时，把 `path` 指向「用户最该去改的那个字段」。

### `superRefine`——完全掌控（可报多个错、可中止）

`superRefine` 的回调拿到 `(value, ctx)`，你可以**手动 `ctx.addIssue()`**，一次加多个错误，或用 `ctx.abort()` 提前中止：

```ts
const Password = z.string().superRefine((val, ctx) => {
  if (val.length < 8) {
    ctx.addIssue({ code: "custom", message: "密码至少 8 位" });
  }
  if (!/[A-Z]/.test(val)) {
    ctx.addIssue({ code: "custom", message: "密码需包含大写字母" });
  }
  if (!/[0-9]/.test(val)) {
    ctx.addIssue({ code: "custom", message: "密码需包含数字" });
  }
  // 想只报第一个错，就在 addIssue 后 ctx.abort()
});
```

**选择指南**：规则简单、只报一个错 → `refine`；要报多个错、要精细控制 → `superRefine`。

---

## 5.5 transform 与 z.input vs z.output ★

这是本章**最重要、最容易踩坑**的一节，也是用户在核心清单里点名要验收的点。

### `transform`：在校验后转换数据

```ts
// 把字符串转成数字（表单里 input 的值永远是 string）
const ageFromString = z.string().transform((val) => Number(val));

ageFromString.parse("18"); // => 18（number）
```

```ts
// 规范化：trim + 转小写
const email = z.string().trim().toLowerCase().email();
email.parse("  Foo@Bar.com "); // => "foo@bar.com"
```

### input 类型 vs output 类型

一旦用了 `transform`（或 `default`），**解析前的输入类型**和**解析后的输出类型**就可能**不一样**。Zod 用两个工具分别提取：

```ts
const mySchema = z.string().transform((val) => val.length);

type In = z.input<typeof mySchema>; // => string   （解析"前"）
type Out = z.output<typeof mySchema>; // => number   （解析"后"）
// z.infer<typeof mySchema> 等价于 z.output => number
```

**记住三句话**：

1. `z.input<T>` = 你**喂给** `parse` 的数据类型（transform/default 生效**前**）；
2. `z.output<T>` = `parse` **返回**的数据类型（transform/default 生效**后**）；
3. `z.infer<T>` === `z.output<T>`（默认指输出）。

没有 transform/default 时，input 和 output 相同，不用操心。**一旦有，就必须区分**——否则接 RHF 时类型会打架（第 8 章会给出正确写法）。

### 一个表单里的真实例子

```ts
const LaunchSchema = z.object({
  // 表单 input 的值是 string，但我们想要 number
  replicas: z.coerce.number().int().min(1).max(64),
  // 想要规范化后的 email
  contactEmail: z.string().trim().toLowerCase().email(),
  // 不选就用默认
  region: z.enum(["us-east", "eu-central"]).default("us-east"),
});

type LaunchInput = z.input<typeof LaunchSchema>;
// replicas 的 input 侧：z.coerce.number() 的 input 是 unknown/string 友好
// region 的 input 侧：可选（因为有 default）
type LaunchOutput = z.output<typeof LaunchSchema>;
// replicas: number; contactEmail: string; region: "us-east" | "eu-central"（必填）
```

> `z.coerce.number()` 是表单常用糖：它接受任意输入并强制转成 number（`z.coerce.number().parse("42")` → `42`）。它同样导致 input/output 类型不同。

---

## 5.6 parse / safeParse：两种校验入口

### `parse`——失败即抛异常

```ts
try {
  const data = LaunchSchema.parse(rawInput);
  // data 是强类型的 output
} catch (error) {
  if (error instanceof z.ZodError) {
    console.log(error.issues); // 结构化错误列表
  }
}
```

### `safeParse`——失败返回结果对象（表单首选）

```ts
const result = LaunchSchema.safeParse(rawInput);

if (result.success) {
  result.data; // 强类型 output
} else {
  result.error; // ZodError 实例
}
```

`safeParse` **不抛异常**，返回一个**可辨识联合**（`success: true/false`），处理起来更安全，是表单/接口场景的首选。（第 8 章的 `zodResolver` 内部就是用类似机制把错误交给 RHF。）

### 异步版本

如果 schema 里有 **async refine / async transform**（如「查后端判断用户名是否可用」，第 9 章），必须用异步方法：

```ts
const data = await LaunchSchema.parseAsync(rawInput);
const result = await LaunchSchema.safeParseAsync(rawInput);
```

### 错误结构：`error.issues`

`ZodError` 的核心是 `.issues` 数组，每条含 `path`、`message`、`code`：

```ts
result.error.issues;
// [
//   { code: "invalid_type", path: ["replicas"], message: "..." },
//   { code: "too_small",    path: ["contactEmail"], message: "..." },
// ]
```

`path` 是**数组**，能表达嵌套/数组下标（如 `["emails", 1, "address"]`）。第 8 章把 `issues` 映射到 RHF 的字段错误时，靠的就是 `path`。

---

## 5.7 组合与复用

Zod schema 是可组合的值，善用组合避免重复：

```ts
// 复用片段
const Email = z.string().trim().toLowerCase().email("邮箱格式不正确");

// 合并对象
const Base = z.object({ name: z.string() });
const Extended = Base.extend({ age: z.number() });
const Partial = Extended.partial(); // 全部变可选
const Picked = Extended.pick({ name: true }); // 只挑部分字段

// 数组
const Emails = z.array(Email).min(1).max(5);

// 前后端共享：把 schema 放独立文件，两端都 import
// src/features/launch/launch-schema.ts  ← 单一事实来源
export const LaunchSchema = z.object({
  /* ... */
});
export type LaunchInput = z.input<typeof LaunchSchema>;
export type LaunchOutput = z.output<typeof LaunchSchema>;
```

> **单一事实来源（SSOT）**：把 schema 和它的 `input`/`output` 类型放在独立文件里导出，前端表单和后端接口都 import 它。这是第 8 章「同一套校验前后端复用」的物理基础，也是「客户端校验只是体验、服务端校验才是边界」这条铁律的技术落地。

---

## 5.8 动手：为 LaunchPad 写第一版 schema

把本章知识用到实战项目上，写一份可复用的 schema（后续章节逐步增强）：

```ts
// src/features/launch/launch-schema.ts
import { z } from "zod";

export const REGIONS = ["us-east", "us-west", "eu-central"] as const;
export const PLANS = ["standard", "performance", "enterprise"] as const;

export const LaunchSchema = z
  .object({
    name: z
      .string()
      .min(3, "实例名至少 3 个字符")
      .max(32, "实例名最多 32 个字符")
      .refine((v) => /^[a-zA-Z]/.test(v), "实例名必须以字母开头"),

    region: z.enum(REGIONS, { message: "请选择一个区域" }),
    plan: z.enum(PLANS, { message: "请选择一个套餐" }),

    autoScale: z.boolean(),
    minReplicas: z.coerce.number().int().min(1, "至少 1 个副本"),
    maxReplicas: z.coerce.number().int().max(64, "最多 64 个副本"),

    contactEmail: z.string().trim().toLowerCase().email("邮箱格式不正确"),
  })
  // 跨字段：min ≤ max，错误挂到 maxReplicas
  .refine((d) => d.minReplicas <= d.maxReplicas, {
    message: "最小副本数不能大于最大副本数",
    path: ["maxReplicas"],
  });

export type LaunchInput = z.input<typeof LaunchSchema>;
export type LaunchOutput = z.output<typeof LaunchSchema>;
```

**验证一下**（可临时写在文件底部或用 node 跑）：

```ts
console.log(
  LaunchSchema.safeParse({
    name: "api-01",
    region: "us-east",
    plan: "standard",
    autoScale: false,
    minReplicas: "2",
    maxReplicas: "1", // 故意 min>max，且是字符串
    contactEmail: "  Ops@Example.COM ",
  }),
);
// success: false，error.issues 里有一条 path: ["maxReplicas"] 的跨字段错误
```

观察：`minReplicas: "2"`（字符串）能通过，因为 `z.coerce.number()` 把它转成了数字——这就是 input/output 类型分离的实际效果。

---

## 5.9 本章练习

1. **primitive 约束**：写一个 `Port` schema，要求是 1~65535 的整数，非法时给出中文提示。
2. **optional vs nullable vs default**：分别用三者定义字段，用 `safeParse` 传 `undefined`/`null`/缺字段，观察各自结果差异。
3. **refine → superRefine**：把 5.4 的密码规则从多个 `refine` 改写成一个 `superRefine`，让它一次返回所有未满足的规则。
4. **input/output 类型**：对 `z.string().transform(s => s.length)` 和 `z.object({ a: z.boolean().default(true) })`，分别写出 `z.input` 和 `z.output` 的类型，验证你的判断。
5. **safeParse 错误映射**：解析一份非法数据，遍历 `result.error.issues`，把每条 `path.join('.')` 和 `message` 打印成 `字段: 错误` 的形式（第 8 章会用到这个映射）。
6. **思考题**：为什么表单里 `z.coerce.number()` 比 `z.number()` 更实用？如果不用 coerce，会发生什么？

---

## 5.10 本章验收清单

学完本章，你应该能：

- [ ] 说清 Zod 的**双重价值**（运行时校验 + 类型推导）与「同源」意义；
- [ ] 用 `z.object` / `z.string` / `z.number` / `z.enum` 描述表单数据；
- [ ] 精确区分 **optional / nullable / default**，知道各自推导出的类型；
- [ ] 用 **refine** 做单字段与**跨字段**校验，并用 `path` 指定错误落点；
- [ ] 用 **superRefine** 一次报多个错误；
- [ ] 用 **transform**（及 `z.coerce`）转换数据；
- [ ] **说清 `z.input` vs `z.output`**：转换前输入类型与解析后输出类型可能不同，`z.infer === z.output`；
- [ ] 用 **safeParse** 而非 try/catch 处理表单校验，读懂 `error.issues` 的 `path`/`message`；
- [ ] 把 schema 放独立文件、导出类型，作为**前后端共享的单一事实来源**。

---

## 5.11 常见坑速查

| 现象                              | 原因                     | 解决                                  |
| --------------------------------- | ------------------------ | ------------------------------------- |
| `z.number()` 校验表单值总是失败   | input 的值是 string      | 用 `z.coerce.number()`                |
| 接 RHF 时类型报错（input≠output） | 用了 transform/default   | 第 8 章用三泛型写法                   |
| 跨字段错误显示在了错的字段        | 没设 `path` 或 path 指错 | `refine(..., { path: [...] })`        |
| `.default()` 让表单初值行为混乱   | default 只在校验后填充   | 表单初值优先用 RHF `defaultValues`    |
| async refine 用 `parse` 报错      | 同步方法拿不到异步结果   | 用 `parseAsync`/`safeParseAsync`      |
| 错误信息是英文默认文案            | 没传自定义 message       | 每个约束都可传 `{ message }` 或第二参 |

---

上一章：[← 第 4 章：可访问性实战](./04-accessibility.md) ｜ 下一章：[第 6 章：React Hook Form 核心 →](./06-react-hook-form-core.md)
