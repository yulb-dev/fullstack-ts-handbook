# 第 7 章：表单生命周期

> 本章目标：把表单当成一个**状态机**来管理——初始化、编辑（dirty/touched）、提交中、成功后重置、失败后回填服务端错误、以及贯穿始终的**重复提交防护**。
> 对应路线图能力点：**[5] 表单状态机**（进阶）。

---

## 7.1 表单是一个状态机

一个「正经」的表单，从打开到提交完成，会经历一串明确的状态。把它画出来，很多新手觉得「玄学」的问题就清晰了：

```
        ┌─────────────┐
        │   idle      │  初始：pristine（未脏、未碰）
        │  (pristine) │
        └──────┬──────┘
               │ 用户输入 / blur
               ▼
        ┌─────────────┐   isDirty=true / touchedFields 累积
        │   editing   │
        │  (dirty)    │
        └──────┬──────┘
               │ 点击提交 handleSubmit
               ▼
        ┌─────────────┐   isSubmitting=true
        │  submitting │   （此时必须防重复提交）
        └──┬───────┬──┘
   校验/请求成功 │       │ 校验失败 或 服务端返回错误
           ▼       ▼
   ┌──────────┐  ┌──────────────┐
   │ success  │  │ error        │
   │ → reset  │  │ → setError   │  回到 editing，展示错误
   └────┬─────┘  └──────┬───────┘
        │               │
        └───────┬───────┘
                ▼
          （success 后回到 pristine；error 后回到 editing）
```

RHF 的 `formState` 恰好为每个状态提供了对应的旗标。本章逐个讲清「每个状态该做什么、用哪个 API」。

---

## 7.2 初始化：`defaultValues` 与异步初值

### 同步初值

最常见的情况，直接用 `defaultValues`（第 6.5 节）：

```tsx
const form = useForm<LaunchOutput>({
  defaultValues: {
    name: "",
    region: "us-east",
    autoScale: false,
    minReplicas: 1,
    maxReplicas: 3,
    contactEmail: "",
  },
});
```

### 异步初值（编辑场景）

「编辑已有实例」时，初值要从接口拉。有两种主流做法：

**做法 A：拿到数据后 `reset`**

```tsx
const form = useForm<LaunchOutput>();
const { data } = useFetchInstance(id); // 任意数据请求方案

useEffect(() => {
  if (data) form.reset(data); // 数据到达后填充，并作为新基准
}, [data, form]);
```

**做法 B：`defaultValues` 用函数/异步（RHF 支持 `values` 选项）**

```tsx
const form = useForm<LaunchOutput>({
  values: data, // values 变化时自动同步（内部走 reset）
});
```

> `reset(data)` 不仅设值，还把 `data` 变成**新的 dirty 基准**——即之后和 `data` 比是否改动。这正是编辑表单需要的：用户改了才算脏。

**要点**：无论哪种，初始化后表单是 **pristine**（`isDirty=false`、`touchedFields={}`）。别在初始化阶段就触发校验报错吓到用户。

---

## 7.3 编辑期：dirty 与 touched

这是两个**正交**的概念，务必分清：

| 概念                | 含义                               | formState 字段            |
| ------------------- | ---------------------------------- | ------------------------- |
| **dirty（脏）**     | 值和 `defaultValues` **不一样**了  | `isDirty` / `dirtyFields` |
| **touched（碰过）** | 用户**聚焦又失焦**过该字段（blur） | `touchedFields`           |

- **dirty** 关心「**改没改**」——用于「有改动才允许提交」「关闭前提示未保存」；
- **touched** 关心「**看没看**」——用于「用户碰过之后才显示错误」，避免用户还没输入就满屏红。

```tsx
const { formState: { isDirty, touchedFields, dirtyFields } } = form

// 有改动才允许提交
<Button type="submit" disabled={!isDirty || form.formState.isSubmitting}>
  保存
</Button>

// 只在字段被碰过、且有错时显示错误（onTouched 模式的 UI 配合）
{touchedFields.name && form.formState.errors.name && (
  <FieldError>{form.formState.errors.name.message}</FieldError>
)}
```

### 离开页面前提示未保存

```tsx
useEffect(() => {
  const handler = (e: BeforeUnloadEvent) => {
    if (isDirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}, [isDirty]);
```

> 注意：`isDirty` 的判定依赖 `defaultValues`。若初值给得不准（比如数字字段初值给了 `""` 而值是 `0`），dirty 会误判。初值类型要和字段实际类型一致。

---

## 7.4 提交中：`isSubmitting`

当你把一个 **async** 函数交给 `handleSubmit` 时，从调用开始到 Promise 结束，`formState.isSubmitting` 自动为 `true`：

```tsx
<form
  onSubmit={form.handleSubmit(async (data) => {
    // 进入这里时 isSubmitting 已经是 true
    await createInstance(data)
    // Promise resolve/reject 后 isSubmitting 变回 false
  })}
>
```

这段时间里你**应该**：

1. **禁用提交按钮**，防止重复点击；
2. 显示 **loading** 反馈（转圈、文案变化）；
3. 可选：禁用整张表单，避免提交途中改值。

```tsx
<Button type="submit" disabled={form.formState.isSubmitting}>
  {form.formState.isSubmitting ? "开通中…" : "开通实例"}
</Button>
```

---

## 7.5 成功后：重置与反馈

提交成功后要做三件事：**给反馈、重置表单、（可选）跳转**。

```tsx
const form = useForm<LaunchOutput>({
  /* ... */
});

async function onSubmit(data: LaunchOutput) {
  const res = await createInstance(data);
  if (res.ok) {
    toast.success("实例开通成功");
    form.reset(); // 回到 defaultValues，清 dirty/touched/errors
    // 或者：重置为新创建的数据作为基准
    // form.reset(res.instance)
  }
}
```

`reset()`（无参）会把表单恢复到 `defaultValues`，并清空 `isDirty`、`touchedFields`、`errors`——表单回到 **pristine** 状态，可以再次填写。

> **`isSubmitSuccessful`**：`formState.isSubmitSuccessful` 在 `handleSubmit` 的回调**没有抛异常**时为 `true`。可用来区分「提交完成且成功」和「提交完成但失败」，配合决定是否 reset。

### 成功状态的边界情况

如果 `onSubmit` 里 **抛了异常**（网络错误等），`isSubmitSuccessful` 为 `false`，`isSubmitting` 仍会回到 `false`，但表单**不会**自动 reset——这时应走错误分支（7.6）。

---

## 7.6 失败后：服务端错误回填（`setError`）

有些错误**只有服务端才知道**：优惠码过期、实例名已被占用、配额不足、支付失败……客户端校验（第 5、8 章）根本拦不到。这类错误要在提交后**回填到对应字段**。

RHF 提供 `setError`：

```tsx
async function onSubmit(data: LaunchOutput) {
  const res = await createInstance(data);
  if (!res.ok) {
    // 单个字段错误
    if (res.error.field === "promoCode") {
      form.setError("promoCode", {
        type: "server",
        message: res.error.message, // "优惠码已过期"
      });
    }
    // 表单级（非某字段）错误
    form.setError("root", { message: "开通失败，请稍后重试" });
    // 或某个具体字段
    // form.setError("name", { message: "该实例名已被占用" })
    return;
  }
  form.reset();
}
```

要点：

- `setError(name, { type, message })` 把错误挂到指定字段，`formState.errors[name]` 立刻可读，`Controller` 的 `fieldState.error` 也会更新；
- 挂在 **`"root"`** 上表示**整表级错误**，用 `formState.errors.root?.message` 读取，通常显示在表单顶部；
- 服务端错误**默认会在该字段值再次变化时被清除**（符合用户预期：我改了，旧错误就不该留着）；
- 结构化的多字段错误（服务端一次返回多个）如何**批量映射**，是第 8 章的重点。

```tsx
// 表单顶部展示 root 错误（可访问：role="alert"）
{
  form.formState.errors.root && (
    <div
      role="alert"
      className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
    >
      {form.formState.errors.root.message}
    </div>
  );
}
```

> 这里只讲**生命周期层面**「失败后回填」的时机与 API。第 8 章会把它和「服务端用同一套 Zod schema 校验 → 返回结构化 issues → 前端批量 setError」串成完整闭环。

---

## 7.7 重复提交防护 ★

用户狂点提交、网络慢、双击——都会导致**重复提交**，轻则创建两条数据，重则重复扣款。防护要**多层**：

### 第 1 层：UI 禁用（防手滑）

```tsx
<Button type="submit" disabled={form.formState.isSubmitting}>
  {form.formState.isSubmitting ? "开通中…" : "开通实例"}
</Button>
```

提交中按钮禁用 + loading，挡掉绝大多数连点。

### 第 2 层：提交回调内加锁（防竞态）

`disabled` 有渲染延迟，极端情况下仍可能进来两次。用一个 ref 做**同步锁**兜底：

```tsx
const submittingRef = useRef(false);

async function onSubmit(data: LaunchOutput) {
  if (submittingRef.current) return; // 已在提交，直接拦截
  submittingRef.current = true;
  try {
    await createInstance(data);
    form.reset();
  } catch (e) {
    form.setError("root", { message: "开通失败" });
  } finally {
    submittingRef.current = false; // 无论成败都释放锁
  }
}
```

> 为什么用 `useRef` 而不是 `useState`？因为 ref 是**同步**的，设置后立即生效；state 更新有延迟，挡不住同一 tick 内的第二次调用。

### 第 3 层：幂等（防网络重试）

真正的「防重复」要在**服务端**做**幂等**：前端生成一个 **幂等键（idempotency key）** 随请求发送，服务端对同一个 key 只处理一次。

```tsx
const idempotencyKey = useRef(crypto.randomUUID());

async function onSubmit(data: LaunchOutput) {
  await fetch("/api/instances", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey.current },
    body: JSON.stringify(data),
  });
  // 成功后若还要再提交一次，记得换新的 key
}
```

**三层缺一不可**：UI 禁用管体验，ref 锁管前端竞态，幂等键管网络/重试的最终一致性。

---

## 7.8 把生命周期拼成一个完整组件

```tsx
// src/features/launch/lifecycle-form.tsx
import { useRef } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import type { LaunchOutput } from "./launch-schema";

export function LifecycleForm() {
  const form = useForm<LaunchOutput>({
    defaultValues: {
      name: "",
      autoScale: false,
      minReplicas: 1,
      maxReplicas: 3,
      contactEmail: "",
    } as LaunchOutput,
  });
  const submittingRef = useRef(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const { isSubmitting, isDirty } = form.formState;

  async function onSubmit(data: LaunchOutput) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      const res = await fetch("/api/instances", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) {
        // 服务端错误回填（结构化映射见第 8 章）
        form.setError("root", { message: json.message ?? "开通失败" });
        return;
      }
      form.reset(); // 成功 → 回到 pristine
      idempotencyKey.current = crypto.randomUUID(); // 换新幂等键
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

      {/* ...字段... */}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "开通中…" : "开通实例"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => form.reset()}
          disabled={!isDirty}
        >
          重置
        </Button>
      </div>
    </form>
  );
}
```

这段代码把本章七个状态全用上了：`defaultValues`（初始化）→ `isDirty`（编辑）→ `isSubmitting` + `submittingRef` + 幂等键（提交中 + 防重复）→ `reset()`（成功）→ `setError("root")`（失败回填）。

---

## 7.9 本章练习

1. **状态可视化**：在页面上实时显示 `isDirty`、`isSubmitting`、`isSubmitSuccessful`、`touchedFields`，完整走一遍「输入→提交→成功→重置」，观察每个旗标的变化时机。
2. **异步初值**：模拟一个 `setTimeout` 返回的实例数据，用 `reset` 填充表单，验证之后 dirty 是相对新数据判定的。
3. **重复提交防护**：写一个故意 `sleep(2000)` 的假接口，狂点提交按钮，验证「UI 禁用 + ref 锁」是否挡住了重复请求（看 network 或 console 计数）。
4. **服务端错误回填**：假接口对某个特定实例名返回 409，用 `setError("name", ...)` 把错误显示到该字段，验证改动该字段后错误消失。
5. **root 错误**：让接口随机失败，用 `setError("root", ...)` + `role="alert"` 在表单顶部展示，用读屏确认能播报。
6. **思考题**：为什么幂等键要在**成功后**才更换，而不是每次提交都换？

---

## 7.10 本章验收清单

学完本章，你应该能：

- [ ] 把表单画成一个**状态机**（idle/editing/submitting/success/error）；
- [ ] 用 `defaultValues` / `reset(data)` / `values` 处理**同步与异步初始化**；
- [ ] 区分 **dirty（改没改）** 与 **touched（碰没碰）**，并用它们控制「可提交」与「何时显错」；
- [ ] 用 **`isSubmitting`** 在提交中禁用按钮 + 显示 loading；
- [ ] 提交成功后用 **`reset()`** 回到 pristine，并理解 `isSubmitSuccessful`；
- [ ] 用 **`setError`** 回填**服务端错误**（字段级 + `root` 级），且错误在字段变化后自动清除；
- [ ] 实现**三层重复提交防护**：UI 禁用 + `useRef` 同步锁 + 幂等键。

---

## 7.11 常见坑速查

| 现象                         | 原因                                 | 解决                                     |
| ---------------------------- | ------------------------------------ | ---------------------------------------- |
| 编辑表单初始就显示「已改动」 | `defaultValues` 与异步数据类型不符   | 数据到达后 `reset(data)` 校准基准        |
| 还没输入就满屏红             | `mode` 太激进或没用 touched 控制     | 用 `onTouched` + `touchedFields` 判断    |
| 提交按钮点了两次创建两条     | 只靠 `disabled`，有渲染延迟          | 加 `useRef` 同步锁 + 幂等键              |
| 提交中还能改表单导致数据错乱 | 没禁用表单                           | 提交中禁用字段或整表                     |
| 服务端错误不显示             | `setError` 的 name 与字段名不匹配    | name 要与注册字段一致；表单级用 `"root"` |
| 成功后表单没清空             | 忘了 `reset()`                       | 成功分支里调用 `reset()`                 |
| `isSubmitting` 一直是 false  | onSubmit 不是 async / 没返回 Promise | 让 onSubmit 是 async 或返回 Promise      |

---

上一章：[← 第 6 章：React Hook Form 核心](./06-react-hook-form-core.md) ｜ 下一章：[第 8 章：zodResolver 与校验闭环 →](./08-resolver-and-validation-loop.md)
