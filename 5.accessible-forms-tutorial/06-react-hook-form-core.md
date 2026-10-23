# 第 6 章：React Hook Form 核心

> 本章目标：吃透 RHF 的核心 API——`useForm`、`register`、`Controller`、`formState`、`defaultValues`、`reset`、`watch`、`setValue`，并理解它「非受控 + ref」的性能模型，以及怎么把 Base UI/shadcn 组件接进来。
> 对应路线图能力点：**[5] 表单状态机**。

---

## 6.0 版本说明

本教程基于 **React Hook Form v7（当前稳定版）**。官方已有 **v8 Beta**，主要变化是配合 React Compiler 让 `useForm` 每次渲染返回同一对象、读取 `formState` 需显式订阅。**v7 的 API 在 v8 里绝大部分保持兼容**，本章按 v7 讲，遇到 v8 差异会标注。安装：

```bash
pnpm add react-hook-form
```

---

## 6.1 为什么用 RHF：非受控 + ref 的性能模型

React 里写表单最朴素的方式是「受控组件」：每个 input 的值都存在 `useState`，`onChange` 里 `setState`。小表单没问题，但表单一大就痛：

```tsx
// ❌ 朴素受控：每敲一个字，整个表单组件重渲染
const [name, setName] = useState("")
const [email, setEmail] = useState("")
// ...20 个字段就是 20 个 useState + 20 个 onChange
<input value={name} onChange={(e) => setName(e.target.value)} />
```

**问题**：任何一个字段变化都会触发**整个表单组件重渲染**，字段越多、嵌套越深，越卡。

RHF 的核心思路：**默认用非受控组件 + ref**，把值「寄存」在 DOM 里而不是 React state 里，只在**必要时**（提交、校验、你显式订阅的字段）才触发渲染。

```tsx
// ✅ RHF：input 的值由 RHF 通过 ref 收集，不逐字重渲染
const { register } = useForm()
<input {...register("name")} />
```

**收益**：

- 打字时**几乎不重渲染**（性能）；
- 不用为每个字段写 `useState`/`onChange`（少样板）；
- 内置校验、错误、脏值/touched、提交状态管理（一站式）；
- 与 Zod 等校验库通过 resolver 无缝集成（第 8 章）。

> **代价**：非受控模型有学习曲线，尤其接入「天生受控」的自定义组件时要用 `Controller`（6.4）。理解「值存在哪、什么时候渲染」是掌握 RHF 的钥匙。

---

## 6.2 `useForm`：一切的中枢

`useForm()` 返回一个方法集合，是整个表单的控制器：

```tsx
import { useForm } from "react-hook-form";

const {
  register, // 注册原生 input（非受控）
  handleSubmit, // 包装提交：先校验，通过才调你的回调
  control, // 交给 Controller / useFieldArray 用
  formState, // 表单状态（errors、isDirty、isSubmitting...）
  watch, // 订阅字段值
  setValue, // 手动设值
  reset, // 重置表单
  getValues, // 读取当前值（不触发渲染）
  setError, // 手动设错（服务端错误回填，第 8 章）
  clearErrors, // 清错
  trigger, // 手动触发校验
  setFocus, // 手动聚焦某字段
} = useForm();
```

### 泛型：给表单一个类型

```tsx
import { useForm } from "react-hook-form";
import type { LaunchOutput } from "./launch-schema";

// 简单情况：输入=输出类型时，一个泛型即可
const form = useForm<LaunchOutput>();
```

> 当 schema 用了 `transform`/`default` 导致 **input ≠ output** 时，单个泛型会类型打架。正确写法是**三泛型** `useForm<Input, Context, Output>`——第 8 章接 zodResolver 时详解。

### `handleSubmit`：提交的守门员

```tsx
<form onSubmit={form.handleSubmit(onValid, onInvalid)}>
```

- 它**先跑校验**（含 resolver）；
- **通过** → 调用 `onValid(data)`，`data` 是强类型的解析后数据；
- **不通过** → 填充 `formState.errors`，并（可选）调用 `onInvalid(errors)`；
- 你**永远不用**自己写 `event.preventDefault()`——`handleSubmit` 帮你处理。

```tsx
function onSubmit(data: LaunchOutput) {
  console.log("校验通过的数据：", data);
}

return <form onSubmit={form.handleSubmit(onSubmit)}>{/* ... */}</form>;
```

---

## 6.3 `register`：注册原生输入

`register(name)` 返回一组 props（`name`、`onChange`、`onBlur`、`ref`），**铺到原生 `<input>`/`<select>`/`<textarea>`** 上即可把它接入 RHF：

```tsx
const { register, formState: { errors } } = useForm()

<input {...register("name")} />
```

### 带内置校验规则

不接 resolver 时，可以直接在 `register` 里写规则：

```tsx
<input
  {...register("email", {
    required: "邮箱必填",
    pattern: { value: /^\S+@\S+$/, message: "邮箱格式不正确" },
  })}
/>
```

> **注意**：一旦你接了 Zod resolver（第 8 章），**校验规则就以 schema 为准**，不要再在 `register` 里重复写 `required`/`pattern`，否则两处规则容易打架。`register` 主要负责「把字段接进来」。

### 处理值类型：`valueAsNumber` 等

原生 `<input type="number">` 的值仍是 **string**。`register` 提供转换选项：

```tsx
<input type="number" {...register("replicas", { valueAsNumber: true })} />
```

（若用 Zod 的 `z.coerce.number()`，也能达到同样效果，二选一即可，别重复。）

---

## 6.4 `Controller`：接入自定义/受控组件 ★

`register` 只能用于**原生 input**（靠 ref 收集值）。但 Base UI 的 `Select`、`Switch`、`Slider`、`Checkbox` 这些**不是原生 input**，它们是**受控组件**（`value` + `onValueChange`）。这时用 **`Controller`** 做桥接。

`Controller` 的本质：**把 RHF 的字段状态，翻译成一个受控组件需要的 `value`/`onChange`**。

```tsx
import { Controller, useForm } from "react-hook-form";

<Controller
  name="region"
  control={form.control}
  render={({ field, fieldState }) => (
    // field: { value, onChange, onBlur, name, ref, disabled }
    // fieldState: { invalid, isDirty, isTouched, error }
    <Select
      value={field.value}
      onValueChange={field.onChange} // Base UI Select 的受控接口
      name={field.name}
    >
      {/* ...items */}
    </Select>
  )}
/>;
```

### 与 shadcn `Field` + 可访问性结合（官方推荐写法）

把第 4 章的可访问性、第 2 章的 shadcn `Field` 和 `Controller` 合起来，就是 shadcn/ui 官方 RHF 指南的标准形态：

```tsx
<Controller
  name="region"
  control={form.control}
  render={({ field, fieldState }) => (
    <Field data-invalid={fieldState.invalid}>
      <FieldLabel htmlFor={field.name}>区域</FieldLabel>
      <Select
        value={field.value}
        onValueChange={field.onChange}
        name={field.name}
      >
        <SelectTrigger id={field.name} aria-invalid={fieldState.invalid}>
          <SelectValue placeholder="选择区域" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="us-east">US East</SelectItem>
          <SelectItem value="eu-central">EU Central</SelectItem>
        </SelectContent>
      </Select>
      <FieldDescription>选择离你用户最近的区域。</FieldDescription>
      {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
    </Field>
  )}
/>
```

**观察这段代码如何把前几章串起来**：

- `Controller` 把 Base UI `Select`（受控）接入 RHF（第 3、6 章）；
- `FieldLabel htmlFor={field.name}` + `SelectTrigger id={field.name}` → **label 关联**（第 4 章）；
- `data-invalid={fieldState.invalid}` + `aria-invalid` → **ARIA 状态**（第 2、4 章）；
- `FieldError errors={[fieldState.error]}`（内部 `role="alert"`）→ **错误描述**（第 4 章）。

### `render` 里能拿到什么

| 字段                               | 内容                                       |
| ---------------------------------- | ------------------------------------------ |
| `field.value`                      | 当前值                                     |
| `field.onChange(v)`                | 更新值（触发表单状态更新）                 |
| `field.onBlur()`                   | 标记 touched                               |
| `field.name`                       | 字段名（可用作 id）                        |
| `field.ref`                        | 焦点 ref（需要 `setFocus`/错误聚焦时挂上） |
| `fieldState.invalid`               | 是否校验失败                               |
| `fieldState.isDirty` / `isTouched` | 脏/碰过                                    |
| `fieldState.error`                 | 该字段的错误对象（含 `message`）           |

> **`useController`**：如果你在写自定义 hook 或函数组件里更想用 hook 形式，`useController({ name, control })` 返回同样的 `{ field, fieldState }`。`Controller` 是它的组件封装。

---

## 6.5 `defaultValues`：表单初值

```tsx
const form = useForm<LaunchOutput>({
  defaultValues: {
    name: "",
    region: "us-east",
    plan: "standard",
    autoScale: false,
    minReplicas: 1,
    maxReplicas: 3,
    contactEmail: "",
  },
});
```

要点：

- `defaultValues` 是**表单的初始快照**，`reset()`（6.7）会回到它；
- 它决定字段的**初始 dirty 判定基准**；
- 若初值来自异步（如「编辑」页拉取现有数据），用 `reset(data)` 或 `defaultValues` + `useEffect` 更新（第 7 章）；
- **优先用 `defaultValues` 给初值**，而不是 Zod 的 `.default()`（第 5.3 节的建议在此落地）。

---

## 6.6 `formState`：表单的"仪表盘"

`formState` 是一个对象，包含表单的实时状态。**你从它读取状态来驱动 UI**：

```tsx
const { formState } = useForm();
const {
  errors, // 校验错误（按字段名组织）
  isDirty, // 是否有任意字段被改过
  dirtyFields, // 哪些字段被改过
  touchedFields, // 哪些字段被"碰过"（blur）
  isSubmitting, // 是否正在提交（异步 onSubmit 期间为 true）
  isSubmitted, // 是否已提交过
  isValid, // 是否全部校验通过
  isSubmitSuccessful, // 上次提交是否成功
  submitCount, // 提交次数
} = formState;
```

### 常见用法

```tsx
// 提交按钮：提交中禁用 + 显示 loading（第 7 章重点）
<Button type="submit" disabled={formState.isSubmitting}>
  {formState.isSubmitting ? "开通中…" : "开通实例"}
</Button>;

// 显示某个字段的错误
{
  formState.errors.name && (
    <FieldError>{formState.errors.name.message}</FieldError>
  );
}

// "有改动才允许提交"
<Button type="submit" disabled={!formState.isDirty}>
  保存
</Button>;
```

> **性能提示（v7）**：`formState` 用 Proxy 实现，**你解构/访问了哪个字段，RHF 才订阅哪个字段的变化**并据此决定重渲染。所以「只在需要时读取 formState 的具体字段」是有性能意义的。v8 Beta 对订阅机制做了进一步显式化。

---

## 6.7 `watch` 与 `setValue`：读与写

### `watch`——订阅字段值（会触发渲染）

```tsx
const { watch } = useForm();

// 订阅单个字段
const autoScale = watch("autoScale");

// 订阅多个
const { minReplicas, maxReplicas } = watch(["minReplicas", "maxReplicas"]);

// 订阅全部（带回调，可拿 name 判断哪个变了）
watch((values, { name }) => {
  console.log(name, "变了", values);
});
```

**用途**：**条件渲染**（第 9 章的条件字段就靠它）。例如只有勾选了「自动扩缩容」才显示阈值滑块：

```tsx
{
  watch("autoScale") && <ThresholdSliderField />;
}
```

> `watch` 会导致组件在值变化时重渲染。若只想在**提交/校验时**读值而不订阅渲染，用 `getValues()`。若想在**子组件**里高效订阅，用 `useWatch({ name, control })`。

### `setValue`——手动设值

```tsx
const { setValue } = useForm();

setValue("region", "eu-central");

// 带选项：是否触发校验/脏标记/touched
setValue("plan", "performance", {
  shouldValidate: true, // 立即校验该字段
  shouldDirty: true, // 标记为 dirty
  shouldTouch: true, // 标记为 touched
});
```

**用途**：联动赋值（选套餐 A 自动把副本数设为某值）、异步回填、批量设置。第 9 章的跨字段联动会用到。

### `getValues` vs `watch`

|                       | `watch(name)` | `getValues(name)` |
| --------------------- | ------------- | ----------------- |
| 触发重渲染            | ✅ 会订阅     | ❌ 只读一次       |
| 用在 JSX 里做条件渲染 | ✅ 合适       | ❌ 不会更新 UI    |
| 用在 onSubmit 里读值  | 可以但多余    | ✅ 合适           |

---

## 6.8 `reset`：重置表单

```tsx
const { reset } = useForm({ defaultValues });

// 回到 defaultValues
reset();

// 重置到新的值（并把它们变成新的"基准"）
reset({ name: "new-01", region: "us-west" /* ... */ });

// 只重置部分，保留其余
reset({ name: "new-01" }, { keepDefaultValues: true });
```

`reset` 会清空：值、errors、touched、dirty（除非用 options 保留）。第 7 章「提交成功后重置」会用到 `reset()`。

---

## 6.9 `control`：把控制器传下去

`control` 是 `useForm` 返回的「控制器句柄」。当你把字段拆到**子组件**里，或用 `useFieldArray`（第 9 章）、`Controller`、`useWatch` 时，需要把 `control` 传进去，它们才知道操作的是哪个表单实例：

```tsx
<RegionField control={form.control} /> // 子组件内部用 Controller/useWatch
```

> 深层嵌套的表单可以用 `FormProvider` + `useFormContext` 避免层层传 `control`，但**显式传 `control` 更清晰、更类型安全**，本教程优先用它。

---

## 6.10 `mode`：什么时候校验

`mode` 决定**首次校验**的触发时机（`reValidateMode` 决定出错后**重新校验**的时机）：

| `mode`               | 何时校验                       |
| -------------------- | ------------------------------ |
| `"onSubmit"`（默认） | 点提交时才校验                 |
| `"onBlur"`           | 字段失焦时校验                 |
| `"onChange"`         | 每次值变化都校验               |
| `"onTouched"`        | 首次失焦后，之后每次变化都校验 |
| `"all"`              | 失焦和变化都校验               |

```tsx
const form = useForm({
  resolver: zodResolver(LaunchSchema),
  mode: "onTouched",
});
```

**选择建议**：

- 默认 `onSubmit`：提交前才报错，最不打扰；
- `onTouched`：**推荐的平衡点**——用户碰过（blur）后才开始实时反馈，不会一输入就满屏红；
- `onChange`：即时反馈，但异步校验（第 9 章）要配防抖，否则请求过多。

---

## 6.11 动手：把 LaunchPad 表单搭起来

把第 5 章的 schema 先**不接 resolver**，用 RHF 把表单骨架搭出来（第 8 章再接 Zod）：

```tsx
// src/features/launch/launch-form.tsx
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import type { LaunchOutput } from "./launch-schema";

export function LaunchForm() {
  const form = useForm<LaunchOutput>({
    defaultValues: {
      name: "",
      autoScale: false,
      minReplicas: 1,
      maxReplicas: 3,
      contactEmail: "",
      // region/plan 由 Select 提供
    } as LaunchOutput,
  });

  function onSubmit(data: LaunchOutput) {
    console.log("提交：", data);
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="grid gap-6"
      noValidate
    >
      {/* 原生 input 用 register */}
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
            />
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      {/* 受控组件（Switch）用 Controller 的 field.value/onChange */}
      <Controller
        name="autoScale"
        control={form.control}
        render={({ field }) => (
          <Field orientation="horizontal">
            <FieldLabel htmlFor="autoScale">自动扩缩容</FieldLabel>
            <Switch
              id="autoScale"
              name={field.name}
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          </Field>
        )}
      />

      {/* watch 驱动条件字段 */}
      {form.watch("autoScale") && (
        <p className="text-sm text-muted-foreground">
          （阈值滑块将在第 9 章接入）
        </p>
      )}

      <Button type="submit" disabled={form.formState.isSubmitting}>
        开通实例
      </Button>
    </form>
  );
}
```

> `noValidate` 加在 `<form>` 上是为了**关闭浏览器原生校验气泡**，让校验完全由你的 schema/resolver 接管（这样错误展示、i18n、样式才可控）。生产环境也可保留部分原生校验作为兜底。

---

## 6.12 本章练习

1. **register vs Controller**：分别用 `register`（`<input>`）和 `Controller`（`<Switch>`）接入两个字段，观察 `field` 对象提供了什么。
2. **formState 仪表盘**：在页面上实时打印 `isDirty`、`isValid`、`isSubmitting`、`touchedFields`，改动表单观察变化。
3. **watch 条件渲染**：勾选「自动扩缩容」时显示一段文字，取消时隐藏。
4. **setValue 联动**：加一个按钮，点它用 `setValue("maxReplicas", 10, { shouldValidate: true })`。
5. **reset**：提交成功后 `console.log` 并 `reset()`，观察表单回到初值。
6. **mode 对比**：把 `mode` 依次设为 `onSubmit` / `onBlur` / `onTouched`，配合一个 `required` 字段，体会报错时机差异。
7. **思考题**：为什么原生 `<input>` 用 `register` 就够，而 Base UI `Select` 必须用 `Controller`？

---

## 6.13 本章验收清单

学完本章，你应该能：

- [ ] 解释 RHF 的**非受控 + ref** 性能模型，说清它比朴素受控好在哪；
- [ ] 用 **`useForm`** 拿到控制器，理解 `handleSubmit` 的「先校验后回调」；
- [ ] 对原生输入用 **`register`**，对自定义/受控组件用 **`Controller`**，并知道各自适用场景；
- [ ] 读懂 `Controller` 的 `field` / `fieldState`，把 Base UI 组件 + shadcn `Field` + 可访问性接起来；
- [ ] 用 **`defaultValues`** 设初值，并知道它优先于 Zod `.default()`；
- [ ] 从 **`formState`** 读取 errors/isDirty/isValid/isSubmitting/touchedFields 驱动 UI；
- [ ] 用 **`watch`** 订阅（条件渲染）、用 **`setValue`** 写值（联动）、用 **`getValues`** 只读；
- [ ] 用 **`reset`** 重置表单；
- [ ] 选对 **`mode`**（推荐 `onTouched`）；
- [ ] 知道 **`control`** 是传给子组件/`useFieldArray`/`Controller` 的句柄。

---

## 6.14 常见坑速查

| 现象                               | 原因                                | 解决                                        |
| ---------------------------------- | ----------------------------------- | ------------------------------------------- |
| `register` 用在 Select 上不工作    | 它不是原生 input                    | 改用 `Controller`                           |
| 受控组件警告 "value 没有 onChange" | 忘了接 `field.onChange`             | `onValueChange={field.onChange}`            |
| 打字时页面很卡                     | 用 `watch()` 订阅了全部字段         | 只订阅必要字段，或用 `useWatch`/`getValues` |
| 数字字段校验说类型不对             | input 值是 string                   | `valueAsNumber` 或 `z.coerce.number()`      |
| 提交没反应也不报错                 | 用了原生 submit 或漏了 handleSubmit | `<form onSubmit={handleSubmit(onSubmit)}>`  |
| 改了值但 UI 不更新                 | 用 `getValues` 做了条件渲染         | 改用 `watch`/`useWatch`                     |
| 接了 Zod 后 register 规则失效      | 两处规则冲突                        | 规则统一放 schema                           |

---

上一章：[← 第 5 章：Zod：schema 与类型](./05-zod-schema-and-types.md) ｜ 下一章：[第 7 章：表单生命周期 →](./07-form-lifecycle.md)
