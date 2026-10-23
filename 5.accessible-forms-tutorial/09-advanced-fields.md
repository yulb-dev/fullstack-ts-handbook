# 第 9 章：复杂字段与高级校验

> 本章目标：攻克复杂表单的五座大山——**字段数组**（`useFieldArray`）、**嵌套对象**、**条件字段**、**跨字段校验**、**异步校验**，并让每一种都能把错误精确落到**字段级**。
> 对应路线图能力点：**[5] 表单状态机**（复杂形态）。

---

## 9.0 字段路径：贯穿本章的一根主线

RHF 用**点号路径**寻址任意深度的字段，Zod 的 `issue.path` 是**数组**形式，两者一一对应（第 8.6 节已用过）。先把这根主线立起来，后面所有复杂字段都靠它定位错误：

| 数据结构     | RHF 字段路径         | Zod `issue.path`           |
| ------------ | -------------------- | -------------------------- |
| 顶层字段     | `"name"`             | `["name"]`                 |
| 嵌套对象     | `"config.region"`    | `["config", "region"]`     |
| 数组项       | `"emails.0.address"` | `["emails", 0, "address"]` |
| 数组项的字段 | `"envVars.1.value"`  | `["envVars", 1, "value"]`  |

> 记住：**路径 = 错误落点**。写复杂表单时，先想清楚「这个错误该显示在哪个路径」，再决定 schema 的 `path` 和 UI 的 `name`。

---

## 9.1 嵌套对象：给字段分组

表单数据天然是树状的。用嵌套 `z.object` 描述，用点号路径寻址：

```ts
// launch-schema.ts（片段）
export const LaunchSchema = z.object({
  name: z.string().min(3),
  config: z.object({
    // ← 嵌套对象
    region: z.enum(REGIONS),
    plan: z.enum(PLANS),
    replicas: z.object({
      min: z.coerce.number().int().min(1),
      max: z.coerce.number().int().max(64),
    }),
  }),
});
```

```tsx
// 用点号路径注册嵌套字段
<Controller
  name="config.region" // ← 路径寻址
  control={form.control}
  render={({ field, fieldState }) => (
    <Field data-invalid={fieldState.invalid}>
      <FieldLabel htmlFor={field.name}>区域</FieldLabel>
      <Select value={field.value} onValueChange={field.onChange}>
        {/* ... */}
      </Select>
      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
    </Field>
  )}
/>
```

`defaultValues` 也要写成对应的嵌套结构：

```tsx
defaultValues: {
  name: "",
  config: { region: "us-east", plan: "standard", replicas: { min: 1, max: 3 } },
}
```

**要点**：嵌套只是路径变长，`Controller`/`register`/`errors` 的用法完全一致。`formState.errors.config?.region?.message` 逐层可选链读取。

---

## 9.2 字段数组：`useFieldArray` ★

「可增删的列表」是复杂表单的标志：环境变量、通知邮箱、多个地址……用 **`useFieldArray`** 管理。

### 基本用法

```tsx
import { useFieldArray, useForm, Controller } from "react-hook-form";

const form = useForm({ resolver: zodResolver(LaunchSchema), defaultValues });

const { fields, append, remove, insert, move, prepend, replace, update } =
  useFieldArray({
    control: form.control,
    name: "emails", // 数组字段的路径
  });
```

`useFieldArray` 返回：

| 属性/方法         | 作用                                    |
| ----------------- | --------------------------------------- |
| `fields`          | 当前数组项（每项带一个稳定的 **`id`**） |
| `append(item)`    | 末尾追加                                |
| `prepend(item)`   | 开头插入                                |
| `insert(i, item)` | 指定位置插入                            |
| `remove(i)`       | 删除（可传数组删多个）                  |
| `move(from, to)`  | 移动（做拖拽排序）                      |
| `replace(items)`  | 整体替换                                |
| `update(i, item)` | 更新某项                                |

### ⚠️ 最关键的一条：用 `field.id` 作 key，不要用 index

```tsx
{
  fields.map((field, index) => (
    <Controller
      key={field.id} // ✅ 用 RHF 生成的稳定 id
      name={`emails.${index}.address`} // ← 路径用 index
      control={form.control}
      render={({ field: input, fieldState }) => (
        <Field orientation="horizontal" data-invalid={fieldState.invalid}>
          <Input
            {...input}
            id={`emails-${index}-address`}
            aria-invalid={fieldState.invalid}
            placeholder="name@example.com"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`删除第 ${index + 1} 个邮箱`}
            onClick={() => remove(index)}
          >
            <XIcon />
          </Button>
          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  ));
}
```

> **为什么 key 用 `field.id` 而不是 `index`？** 因为删除/插入中间项时，`index` 会导致 React 复用错误的 DOM 与内部状态（值串行、焦点乱跳）。`field.id` 是 RHF 为每一项生成的**稳定标识**，用它做 key 才能保证增删时状态正确。这是官方反复强调的坑。

### 增删按钮 + 数量约束

```tsx
<Button
  type="button"
  variant="outline"
  size="sm"
  onClick={() => append({ address: "" })}
  disabled={fields.length >= 5}
>
  添加邮箱
</Button>
```

数量约束交给 schema（第 5.2 节）：

```ts
emails: z
  .array(z.object({ address: z.string().email("邮箱格式不正确") }))
  .min(1, "至少一个邮箱")
  .max(5, "最多 5 个邮箱"),
```

数组级错误（如「至少一个」）的 `path` 是 `["emails"]`，用 `formState.errors.emails?.root?.message`（或 `errors.emails?.message`）读取，展示在列表下方：

```tsx
{
  form.formState.errors.emails?.root && (
    <FieldError>{form.formState.errors.emails.root.message}</FieldError>
  );
}
```

> **`_isFieldArray` 提示**：字段数组项本身没有独立的「值变化订阅」，`fields` 里存的是快照。要读某项的实时值仍用 `Controller`/`watch(\`emails.${i}.address\`)`，别直接依赖 `fields[i]` 的实时性。

---

## 9.3 条件字段：显示/隐藏与"隐藏即不校验"

选了「自动扩缩容」才显示「阈值滑块」——这是条件字段。有两个层次要处理：**UI 显隐** 和 **校验规则跟随**。

### UI 显隐：`watch` 驱动

```tsx
{
  form.watch("autoScale") && (
    <Controller
      name="scalingThreshold"
      control={form.control}
      render={({ field }) => (
        <Field>
          <FieldLabel htmlFor="scalingThreshold">扩缩容阈值</FieldLabel>
          <Slider
            id="scalingThreshold"
            value={[field.value]}
            onValueChange={([v]) => field.onChange(v)}
          />
        </Field>
      )}
    />
  );
}
```

### 校验跟随：字段卸载 vs schema 条件

**关键问题**：当条件字段**不显示**时，它还该被校验吗？通常**不该**。有两条路线：

**路线 A（推荐）：条件挂载 → 卸载即不校验**

RHF 默认在字段**卸载**时会移除其校验（受 `shouldUnregister` 影响）。把条件字段放进 `{watch(...) && <Controller/>}`，不满足条件时组件不渲染、字段不注册，自然不校验。为确保卸载时彻底清除，可开启：

```tsx
const form = useForm({
  resolver: zodResolver(LaunchSchema),
  shouldUnregister: true, // 卸载的字段从表单值和校验中移除
});
```

**路线 B：schema 内条件校验（`superRefine` / 判别联合）**

如果字段值始终存在、只是「某些条件下才要求」，在 schema 里用 `superRefine` 表达：

```ts
const LaunchSchema = z
  .object({
    autoScale: z.boolean(),
    scalingThreshold: z.number().min(0).max(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.autoScale && data.scalingThreshold == null) {
      ctx.addIssue({
        code: "custom",
        path: ["scalingThreshold"], // 错误落到该字段
        message: "开启自动扩缩容时必须设置阈值",
      });
    }
  });
```

> **两条路线怎么选**：字段「物理上不存在」时用 A（条件渲染 + `shouldUnregister`）；字段「存在但按条件要求」时用 B（schema `superRefine`）。A 更省渲染，B 更精确可控，也可两者结合。

### 判别联合（discriminatedUnion）：按类型切换整组字段

更强的条件形态：选了不同的「实例类型」，整组字段都不同。用 `z.discriminatedUnion`：

```ts
const BillingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("free"), plan: z.enum(["standard"]) }),
  z.object({
    kind: z.literal("paid"),
    plan: z.enum(["performance", "enterprise"]),
    cardToken: z.string().min(1, "需要支付方式"),
  }),
]);
```

`kind` 决定校验哪一组，错误也能精确落到 `cardToken` 等字段。

---

## 9.4 跨字段校验

「一个字段的合法性依赖另一个字段」——第 5.4 节在 schema 层讲过 `refine`/`superRefine`，这里看它在**表单里**如何落到 UI。

### 经典案例：确认密码

```ts
const SignupSchema = z
  .object({
    password: z.string().min(8, "密码至少 8 位"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "两次输入的密码不一致",
    path: ["confirmPassword"], // ← 错误显示在"确认密码"字段
  });
```

```tsx
<Controller
  name="confirmPassword"
  control={form.control}
  render={({ field, fieldState }) => (
    <Field data-invalid={fieldState.invalid}>
      <FieldLabel htmlFor={field.name}>确认密码</FieldLabel>
      <Input
        {...field}
        id={field.name}
        type="password"
        aria-invalid={fieldState.invalid}
      />
      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
    </Field>
  )}
/>
```

### 跨字段联动的重校验陷阱

改了 `password` 后，`confirmPassword` 的错误**不会自动重算**（因为它的值没变）。解决：在 `password` 变化时**手动触发** `confirmPassword` 重校验：

```tsx
<Controller
  name="password"
  control={form.control}
  render={({ field }) => (
    <Input
      {...field}
      type="password"
      onChange={(e) => {
        field.onChange(e);
        // 改了密码，顺带重新校验确认密码
        if (form.formState.touchedFields.confirmPassword) {
          form.trigger("confirmPassword");
        }
      }}
    />
  )}
/>
```

> `form.trigger("confirmPassword")` 手动触发指定字段校验。加 `touchedFields` 判断是为了「用户还没碰确认框时不要提前报错」。这是跨字段校验最常见的体验坑。

### 副本数区间（min ≤ max）

第 5.8 的 `refine` 已给出，配合上面的 `trigger`：改 `minReplicas` 时触发 `maxReplicas` 重校验，错误始终显示在 `maxReplicas`。

---

## 9.5 异步校验：唯一性预检

「实例名是否已被占用」需要**问服务端**。这属于**体验型预检**（最终判定仍在服务端，第 8.8 节）。三种实现层次：

### 方式 A：Zod `superRefine` 里做异步（配 `parseAsync`）

```ts
const LaunchSchema = z.object({
  name: z
    .string()
    .min(3)
    .superRefine(async (val, ctx) => {
      const res = await fetch(
        `/api/instances/exists?name=${encodeURIComponent(val)}`,
      );
      const { taken } = await res.json();
      if (taken) {
        ctx.addIssue({
          code: "custom",
          path: ["name"],
          message: "该实例名已被占用",
        });
      }
    }),
});
```

> 含 async refine 的 schema，resolver 会用 `parseAsync`/`safeParseAsync` 处理（`zodResolver` 支持异步 schema）。**代价**：每次校验都发请求，必须配防抖 + 校验时机（`mode: "onBlur"` 或 `onTouched`），否则请求爆炸。

### 方式 B：RHF `register` 的 async `validate`（原生 input）

```tsx
<Input
  {...form.register("name", {
    validate: {
      notTaken: async (value) => {
        const { taken } = await checkName(value);
        return taken ? "该实例名已被占用" : true;
      },
    },
  })}
/>
```

> 注意：一旦接了 zodResolver，`register` 内联校验一般不再使用（第 8.2）。异步唯一性更适合放在 resolver 的 schema 里，或用下面方式 C 的字段级方案。

### 方式 C：Base UI `Field` 的异步 `validate`（原生 Base UI 表单）

若你直接用 Base UI 的 `Field`（不经 RHF），它自带异步校验 + 防抖：

```tsx
<Field.Root
  name="username"
  validationMode="onChange"
  validationDebounceTime={300} // ← 防抖 300ms
  validate={async (value) => {
    if (value === "admin") return "系统保留名称";
    const ok = await checkAvailability(value);
    return ok ? null : `${value} 不可用`; // 返回字符串=错误，null=通过
  }}
>
  <Field.Control required minLength={3} />
  <Field.Error />
</Field.Root>
```

- `validationMode`：`onSubmit`（默认）/`onBlur`/`onChange`；
- `validationDebounceTime`：给异步请求防抖，避免逐字请求；
- `validate` 返回**字符串**表示错误、**`null`** 表示通过。

### 异步校验的体验要点

1. **一定要防抖**（300~500ms），否则每个字符一个请求；
2. **时机用 onBlur/onTouched**，别 onChange 逐字打后端；
3. **显示"检查中"状态**，别让用户以为卡住；
4. **处理竞态**：用户快速改名时，旧请求的结果可能后到——用最新值比对或 AbortController 取消旧请求；
5. **它只是预检**：服务端提交时仍要再判一次唯一性（TOCTOU 问题：你查的时候没被占，提交瞬间被占了）。

```tsx
// 竞态防护：AbortController 取消过期请求
useEffect(() => {
  const controller = new AbortController();
  const t = setTimeout(async () => {
    const { taken } = await checkName(name, { signal: controller.signal });
    if (taken) form.setError("name", { message: "已被占用" });
    else form.clearErrors("name");
  }, 400);
  return () => {
    clearTimeout(t);
    controller.abort();
  };
}, [name, form]);
```

---

## 9.6 字段级错误：把错误精确落到每一处

复杂表单的错误可能来自三个源头，最终都要**落到具体字段路径**并展示：

| 错误来源              | 落到哪                     | 怎么读                                                    |
| --------------------- | -------------------------- | --------------------------------------------------------- |
| 客户端 schema 校验    | 各字段路径                 | `Controller` 的 `fieldState.error` / `formState.errors.x` |
| 跨字段 refine         | `path` 指定的字段          | 同上                                                      |
| 数组级约束（min/max） | `errors.emails.root`       | `formState.errors.emails?.root?.message`                  |
| 服务端结构化错误      | `setError(path.join('.'))` | 对应字段的 `fieldState.error`                             |
| 服务端表单级错误      | `errors.root`              | `formState.errors.root?.message`                          |

统一的展示组件（复用第 4 章可访问性）：

```tsx
// 一个把 fieldState.error 渲染成可访问错误的通用件
function FieldErrorSlot({
  field,
  id,
}: {
  field: { name: string };
  id?: string;
}) {
  return (
    <FieldError
      id={id ?? `${field.name}-error`}
      errors={
        [
          /* ... */
        ]
      }
    />
  );
}
```

> 原则：**每个错误都要能被屏幕阅读器读到（role="alert"）、能被 tab 回字段时重念（aria-describedby）、能视觉定位（红色 + 靠近字段）**。复杂表单字段多，错误的**定位精度**直接决定体验。

---

## 9.7 动手：把 LaunchPad 升级成复杂表单

在第 8 章闭环版基础上，加入本章所有能力。schema 增强：

```ts
// launch-schema.ts（完整版）
export const LaunchSchema = z
  .object({
    name: z.string().min(3, "至少 3 个字符").max(32, "最多 32 个字符"),
    region: z.enum(REGIONS),
    plan: z.enum(PLANS),

    autoScale: z.boolean(),
    scalingThreshold: z.number().min(0).max(1).optional(),

    minReplicas: z.coerce.number().int().min(1),
    maxReplicas: z.coerce.number().int().max(64),

    // 字段数组
    envVars: z
      .array(
        z.object({
          key: z.string().min(1, "键必填"),
          value: z.string(),
        }),
      )
      .max(10, "最多 10 个环境变量"),

    emails: z
      .array(
        z.object({
          address: z.string().email("邮箱格式不正确"),
        }),
      )
      .min(1, "至少一个通知邮箱")
      .max(5, "最多 5 个"),

    contactEmail: z.string().trim().toLowerCase().email(),
  })
  // 跨字段：min ≤ max
  .refine((d) => d.minReplicas <= d.maxReplicas, {
    message: "最小副本数不能大于最大副本数",
    path: ["maxReplicas"],
  })
  // 条件字段：开自动扩缩容必须有阈值
  .superRefine((d, ctx) => {
    if (d.autoScale && d.scalingThreshold == null) {
      ctx.addIssue({
        code: "custom",
        path: ["scalingThreshold"],
        message: "开启自动扩缩容时必须设置阈值",
      });
    }
  });
```

字段数组 UI（环境变量，可增删）：

```tsx
const { fields: envFields, append, remove } = useFieldArray({
  control: form.control, name: "envVars",
})

<FieldSet>
  <FieldLegend variant="label">环境变量</FieldLegend>
  <FieldGroup>
    {envFields.map((f, i) => (
      <div key={f.id} className="flex gap-2">
        <Controller name={`envVars.${i}.key`} control={form.control}
          render={({ field }) => <Input {...field} placeholder="KEY" aria-label={`第 ${i+1} 个环境变量键`} />} />
        <Controller name={`envVars.${i}.value`} control={form.control}
          render={({ field }) => <Input {...field} placeholder="value" aria-label={`第 ${i+1} 个环境变量值`} />} />
        <Button type="button" variant="ghost" size="icon" aria-label={`删除第 ${i+1} 个环境变量`}
                onClick={() => remove(i)}><XIcon /></Button>
      </div>
    ))}
  </FieldGroup>
  <Button type="button" variant="outline" size="sm" onClick={() => append({ key: "", value: "" })}>
    添加环境变量
  </Button>
  {form.formState.errors.envVars?.root && (
    <FieldError>{form.formState.errors.envVars.root.message}</FieldError>
  )}
</FieldSet>
```

---

## 9.8 本章练习

1. **嵌套对象**：把 `config.replicas.min/max` 做成嵌套字段，验证 `errors.config.replicas.min` 能正确读取。
2. **字段数组增删移**：给邮箱数组实现 `append`/`remove`/`move`（上下移），全程用 `field.id` 作 key，删除中间项后验证值不串行。
3. **数组约束错误**：把邮箱删到 0 个，验证 `.min(1)` 的错误显示在列表下方而非某一项。
4. **条件字段**：勾选 `autoScale` 才显示阈值滑块；取消勾选后提交，验证阈值**不再被校验**（试 `shouldUnregister: true`）。
5. **跨字段重校验**：实现确认密码，改密码后用 `trigger` 让确认密码重校验，观察错误实时更新。
6. **异步唯一性 + 防抖 + 竞态**：实现实例名唯一性预检，用 `setTimeout` 防抖 + `AbortController` 取消过期请求，显示"检查中"状态。
7. **思考题**：为什么异步唯一性预检通过了，服务端提交时还要再查一次？（提示：TOCTOU）

---

## 9.9 本章验收清单

学完本章，你应该能：

- [ ] 用**点号路径**寻址嵌套对象字段，并正确读取嵌套 errors；
- [ ] 用 **`useFieldArray`** 管理字段数组（append/remove/insert/move），**坚持用 `field.id` 作 key**；
- [ ] 展示**数组级错误**（`errors.xxx.root`）与**数组项级错误**（`errors.xxx.i.field`）；
- [ ] 实现**条件字段**：`watch` 驱动显隐 + `shouldUnregister` 或 schema `superRefine` 让校验跟随；
- [ ] 用 `z.discriminatedUnion` 处理「按类型切换整组字段」；
- [ ] 实现**跨字段校验**，并用 `trigger` 解决「改了 A，B 的错误不重算」的陷阱；
- [ ] 实现**异步校验**（唯一性预检），配**防抖 + onBlur 时机 + 竞态防护 + 检查中状态**；
- [ ] 把三类错误（客户端/跨字段/服务端）**精确落到字段级**并可访问地展示。

---

## 9.10 常见坑速查

| 现象                           | 原因                    | 解决                                            |
| ------------------------------ | ----------------------- | ----------------------------------------------- |
| 删数组中间项后值串行/焦点乱跳  | 用 index 作 key         | 用 `field.id` 作 key                            |
| 隐藏的条件字段仍被校验报错     | 字段未卸载              | `shouldUnregister: true` 或条件渲染卸载         |
| 改了密码，确认密码错误不更新   | 确认框值没变，未重校验  | 在密码 onChange 里 `trigger("confirmPassword")` |
| 数组「至少一个」的错误没处显示 | 挂在了数组根            | 读 `errors.emails?.root?.message`               |
| 异步校验请求爆炸               | onChange 逐字触发无防抖 | `onBlur`/`onTouched` + 防抖                     |
| 异步结果显示到了旧值上         | 请求竞态                | AbortController 取消过期请求 / 比对最新值       |
| 嵌套字段 errors 读不到         | 路径写错                | 用点号路径逐层可选链 `errors.a?.b?.c`           |
| 异步预检过了但提交仍失败       | 只信客户端预检          | 服务端提交时再判唯一性（TOCTOU）                |

---

上一章：[← 第 8 章：zodResolver 与校验闭环](./08-resolver-and-validation-loop.md) ｜ 下一章：[第 10 章：综合实战与逐项验收 →](./10-capstone-and-acceptance.md)
