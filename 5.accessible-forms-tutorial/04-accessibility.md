# 第 4 章：可访问性实战

> 本章目标：把「可访问」从口号变成能落地的检查项——**label 与控件关联、ARIA 状态、错误描述、focus trap、Esc 关闭、返回焦点**，一个都不少。
> 对应路线图能力点：**[3] 可访问性合规**。

---

## 4.0 为什么这一章值得单独拿出来

可访问性（a11y）不是「加分项」，而是**专业前端的及格线**。屏幕阅读器用户、键盘用户、辅助技术用户，占了真实用户中不可忽视的比例；很多地区它还是**法律要求**。

好消息是：第 3 章的 Base UI 已经替你搞定了**大部分行为层 a11y**（role、键盘、焦点移动）。你的责任是两件事：

1. **别把它做错**——正确关联 label、正确暴露状态、正确描述错误；
2. **补齐视觉层**——focus ring、对比度。

本章按用户提出的六个验收点逐一击破。

---

## 4.1 label 与控件关联

屏幕阅读器聚焦到一个输入框时，靠**可编程关联的 label** 才知道「这是干嘛的」。有三种关联方式，按推荐度排序：

### （1）`<label htmlFor>` ↔ 控件 `id`（最通用）

```tsx
<div className="grid gap-2">
  <Label htmlFor="instance-name">实例名称</Label>
  <Input id="instance-name" name="instance-name" placeholder="api-server-01" />
</div>
```

- `htmlFor` 必须**精确等于**控件的 `id`；
- 关联后：读屏会念出 label；点击 label 也能聚焦/激活控件；
- id 要**全页唯一**。第 6 章接 RHF 时，`Controller` 会给你 `field.name`，可直接用作 id（`id={field.name}`）。

### （2）Base UI 的 `Field` 自动关联

Base UI 提供 `Field`、`Fieldset`、`Form`、`Input` 等部件，能**自动**把 `Field.Label`、`Field.Description`、`Field.Error` 关联到 `Field.Control`（内部帮你生成 id 并设置 `aria-describedby` 等），无需手写 `htmlFor`：

```tsx
import { Field } from "@base-ui/react/field";

<Field.Root name="serverName">
  <Field.Label>Server name</Field.Label>
  <Field.Control
    defaultValue=""
    placeholder="e.g. api-server-01"
    required
    minLength={3}
  />
  <Field.Description>至少 3 个字符</Field.Description>
  <Field.Error />
</Field.Root>;
```

> shadcn/ui 的 `Field` 系列（第 2.5 节）是它**自己的布局组件**，`FieldLabel` 内部仍是 `Label`，需要你用 `htmlFor` 关联；而 Base UI 原生的 `Field.Root` 是**行为组件**，会自动关联。两者名字像、职责不同，别混。

### （3）无可见 label 时用 `aria-label` / `aria-labelledby`

图标按钮、自定义控件没有可见文字 label 时，必须提供**可访问名称**：

```tsx
// 图标按钮：给屏幕阅读器一个名字
<Button variant="ghost" size="icon" aria-label="删除此邮箱">
  <TrashIcon />
</Button>
```

```tsx
// 用页面上已有元素的文字作为名称
<h2 id="section-title">通知设置</h2>
<div role="group" aria-labelledby="section-title">{/* ... */}</div>
```

**优先级**：可见 `<label htmlFor>` > `aria-labelledby`（复用可见文字） > `aria-label`（无可见文字时）。

---

## 4.2 ARIA 状态：让控件"说出"自己现在的样子

控件的**状态**（必填、无效、选中、展开……）要通过 ARIA 暴露给辅助技术。常见的：

| 状态          | 属性                                               | 用在哪                 |
| ------------- | -------------------------------------------------- | ---------------------- |
| 必填          | `aria-required="true"`（或原生 `required`）        | 输入控件               |
| 无效/校验失败 | `aria-invalid="true"`                              | 输入控件               |
| 当前值        | `aria-checked` / `aria-selected` / `aria-expanded` | 开关/选项/可展开触发器 |
| 禁用          | `aria-disabled` / 原生 `disabled`                  | 任意控件               |
| 描述补充      | `aria-describedby="descId errorId"`                | 指向说明文字与错误文字 |

Base UI 的很多状态**自动**加好了（如 Select 的 `aria-expanded`、Checkbox 的 `aria-checked`）。你要主动管的主要是**表单校验相关的两个**：`aria-invalid` 和 `aria-describedby`。

```tsx
<Input
  id="email"
  type="email"
  aria-invalid={hasError || undefined} // 校验失败时为 true
  aria-describedby={hasError ? "email-error" : "email-hint"} // 指向错误或提示
/>
```

> **技巧**：`aria-invalid={false}` 也会输出 `aria-invalid="false"`，虽无害但冗余。用 `hasError || undefined` 让它「有错才出现」，DOM 更干净。

---

## 4.3 错误描述：`role="alert"` + `aria-describedby`

第 2.5 节留的思考题——**为什么 `FieldError` 用 `role="alert"`？** 答案在这里。

表单校验失败时，错误消息是**动态出现**的。如果不做处理，屏幕阅读器用户提交后**听不到任何反馈**（他看不到红字）。正确做法有两步：

### 第一步：让错误"主动播报"——`role="alert"`

`role="alert"` 隐含 `aria-live="assertive"`：内容一插入 DOM，读屏**立即打断当前朗读**播报它。shadcn 的 `FieldError` 正是这么做的：

```tsx
// src/components/ui/field.tsx（第 2.5 节已见）
<div role="alert" data-slot="field-error" className="text-sm text-destructive">
  {content}
</div>
```

### 第二步：把错误"关联到控件"——`aria-describedby`

光播报还不够，用户 tab 回到该字段时，读屏应能再次念出错误。用 `aria-describedby` 把控件指向错误元素：

```tsx
const errorId = `${field.name}-error`

<Field data-invalid={fieldState.invalid}>
  <FieldLabel htmlFor={field.name}>Email</FieldLabel>
  <Input
    {...field}
    id={field.name}
    aria-invalid={fieldState.invalid}
    aria-describedby={fieldState.invalid ? errorId : undefined}
  />
  {fieldState.invalid && (
    <FieldError id={errorId} errors={[fieldState.error]} />
  )}
</Field>
```

**完整链路**：`aria-invalid`（我有错）→ `role="alert"`（错误出现时主动喊）→ `aria-describedby`（回到字段时能再念）。三者配合，才算把「错误描述」这件事做完整。

> `aria-describedby` 可以指向**多个** id（空格分隔），常见组合是「提示文字 + 错误文字」：`aria-describedby="email-hint email-error"`。

---

## 4.4 focus trap：把焦点锁在弹窗内

模态弹窗（Dialog）打开后，键盘焦点**必须只能在弹窗内部循环**，不能 tab 到背后被遮挡的页面——否则用户会「tab 进看不见的地方」，这是严重的 a11y 事故。这就是 **focus trap（焦点陷阱）**。

**Base UI 的 Dialog 默认帮你做好了。** 关键在 `Dialog.Root` 的 `modal` 属性（默认 `true`）：

| `modal` 取值   | 行为                                                         |
| -------------- | ------------------------------------------------------------ |
| `true`（默认） | **焦点被困在弹窗内**、页面滚动被锁定、弹窗外的指针交互被禁用 |
| `'trap-focus'` | 焦点被困在弹窗内，但**不锁滚动**、**允许**弹窗外指针交互     |
| `false`        | 非模态：焦点可自由离开弹窗，与页面其余部分正常交互           |

> 官方提醒：当 `modal` 为 `true` 或 `'trap-focus'` 时，应在 `<Dialog.Popup>` **内部**渲染一个 `<Dialog.Close>`，以便触屏读屏用户能退出弹窗。

所以你**几乎不需要手写 focus trap**——用对 `modal` 即可。理解它的价值在于：当有人问你「你的弹窗键盘焦点跑出去了」，你知道去哪查。

---

## 4.5 Esc 关闭

模态/浮层组件应支持 **`Esc` 键关闭**，这是用户的肌肉记忆，也是 ARIA 规范要求。

**Base UI 默认支持**：Dialog、Popover、Menu、Select 等浮层，按 `Esc` 即关闭。你通常不用写任何代码。

若你**不想**让点击外部关闭（但仍保留 Esc），用 `disablePointerDismissal`：

```tsx
// 禁止"点外部关闭"，但 Esc 仍可关闭；用于强制用户显式选择的场景
<Dialog.Root open={open} onOpenChange={setOpen} disablePointerDismissal>
  {/* ... */}
</Dialog.Root>
```

- `disablePointerDismissal`（默认 `false`）：为 `true` 时阻止点击外部关闭；对非模态弹窗，还会阻止「焦点移出即关闭」。

> **别做的事**：不要为了「防误关」把 Esc 也禁掉。强制留存应通过「关闭前二次确认」实现，而不是剥夺 Esc。

---

## 4.6 返回焦点：弹窗关闭后焦点该回哪

弹窗关闭后，焦点**不能凭空消失**（掉到 `<body>` 会让键盘用户迷失）。正确行为是：**焦点回到打开弹窗的那个触发器**（或你指定的元素）。这叫**返回焦点（focus restoration）**。

Base UI 用 `Dialog.Popup` 上的两个 prop 精确控制：

### `finalFocus`——关闭时聚焦谁

| 取值                 | 行为                                                   |
| -------------------- | ------------------------------------------------------ |
| 不传（默认）         | 回到 **Trigger** 或**之前聚焦的元素**                  |
| `false`              | 不移动焦点                                             |
| `true`               | 使用默认行为                                           |
| `RefObject`          | 聚焦该 ref 指向的元素                                  |
| `(closeType) => ...` | 按关闭方式（mouse/touch/pen/keyboard）返回元素或布尔值 |

### `initialFocus`——打开时聚焦谁

| 取值                | 行为                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| 不传（默认）        | 聚焦弹窗内**第一个可 tab 元素**；但若由**触屏**打开，则聚焦 Popup 本身（避免弹出虚拟键盘） |
| `false`             | 不移动焦点                                                                                 |
| `RefObject`         | 聚焦该 ref 元素                                                                            |
| `(openType) => ...` | 按打开方式返回元素或布尔值                                                                 |

### 实战：把初始焦点放到「取消」而非「确认」

危险操作（如删除）的弹窗，最佳实践是**初始焦点落在安全选项**上，避免用户回车误删：

```tsx
import * as React from "react"
import { Dialog } from "@base-ui/react/dialog"

function DeleteConfirmDialog({ open, onOpenChange }: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const cancelRef = React.useRef<HTMLButtonElement>(null)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/50" />
        <Dialog.Popup
          initialFocus={cancelRef}   // 打开即聚焦"取消"
          // finalFocus 不传 → 默认回到 Trigger
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6"
        >
          <Dialog.Title>删除实例？</Dialog.Title>
          <Dialog.Description>此操作不可撤销。</Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close render={<button ref={cancelRef} className="...">取消</Dialog.Close>
            <button className="bg-destructive text-white ...">确认删除</button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

**验证清单**（用键盘亲自走一遍）：

1. Tab 到触发器 → 回车打开弹窗；
2. 焦点是否**直接落在「取消」**上？（`initialFocus` 生效）
3. 连续按 Tab，焦点是否**只在弹窗内循环**、不会跑到背后页面？（focus trap）
4. 按 **Esc**，弹窗是否关闭？
5. 关闭后，焦点是否**回到触发器**？（`finalFocus` 默认行为）

五条全过，你的弹窗才算**键盘可访问**。

---

## 4.7 视觉层 a11y：focus ring 与对比度

Base UI 管「焦点去哪」，但「焦点长什么样」由你负责：

```tsx
// 用 :focus-visible 给可见焦点环，满足 WCAG 焦点可见
className =
  "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring";
```

- **用 `:focus-visible` 而非 `:focus`**：前者只在「键盘等需要指示焦点」时出现，鼠标点击不显示，体验更好；
- **不要用 `outline: none` 却不补 focus ring**——那等于抹掉焦点指示，是 a11y 反模式；
- **对比度**：文字与背景对比度至少满足 WCAG AA（正文 4.5:1）；官方推荐参考 APCA。第 2 章的 token 体系（`--foreground`/`--background`/`--muted-foreground`）就是为可控对比度服务的。

---

## 4.8 动手：一个可访问的表单字段

把 4.1~4.3 串起来，写一个**完全可访问**的字段（先用原生写法，第 6 章会换成 RHF `Controller`）：

```tsx
// src/features/launch/accessible-field.tsx
import { useId, useState } from "react";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function AccessibleEmailField() {
  const id = useId(); // 生成全页唯一 id，避免手写冲突
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();

  function handleBlur() {
    setError(value.includes("@") ? undefined : "请输入有效的邮箱地址。");
  }

  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>邮箱</FieldLabel>
      <Input
        id={id}
        name="email"
        type="email"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? errorId : hintId}
        required
      />
      <FieldDescription id={hintId}>我们不会公开你的邮箱。</FieldDescription>
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  );
}
```

**这段代码把本章六个点全用上了**：

- `useId()` → 唯一 id；`htmlFor`/`id` → **label 关联**；
- `aria-required`（原生 `required`）+ `aria-invalid` → **ARIA 状态**；
- `aria-describedby` 在「提示」和「错误」间切换 + `FieldError` 的 `role="alert"` → **错误描述**；
- `Field data-invalid` → 触发第 2 章的红色错误样式；
- 若把它放进 Dialog，还能享受 **focus trap / Esc / 返回焦点**。

---

## 4.9 本章练习

1. **键盘走查**：对第 4.6 节的删除确认弹窗，严格用键盘走完 5 步验证清单，记录每一步焦点位置。
2. **读屏实测**：打开系统读屏（macOS VoiceOver：`Cmd+F5`），聚焦第 4.8 节的邮箱字段，确认它能念出「邮箱，必填，编辑框」；输入非法值失焦后，确认能听到错误。
3. **故意做错再修好**：把 `aria-describedby` 删掉，体会读屏体验的退化，再加回来。
4. **initialFocus 实验**：把删除弹窗的 `initialFocus` 从「取消」改成「确认删除」，思考为什么危险操作**不该**这么做。
5. **思考题**：`role="alert"` 和 `aria-live="assertive"` 是什么关系？为什么错误消息适合用 assertive 而非 polite？

---

## 4.10 本章验收清单

学完本章，你应该能：

- [ ] 用 `<label htmlFor>` / Base UI `Field` / `aria-label(ldby)` 三种方式正确做 **label 关联**；
- [ ] 说清并正确使用 `aria-invalid`、`aria-required`、`aria-describedby` 等 **ARIA 状态**；
- [ ] 用 **`role="alert"` + `aria-describedby`** 完整实现**错误描述**，让读屏既能主动播报、又能在回到字段时重念；
- [ ] 解释 **focus trap** 的原理，用 `modal` 属性控制它，并确认弹窗焦点不外泄；
- [ ] 确认 **Esc 关闭** 生效，且不用「禁 Esc」来实现强制留存；
- [ ] 用 **`initialFocus` / `finalFocus`** 控制打开/关闭时的焦点，实现**返回焦点**；
- [ ] 用 `:focus-visible` 补齐 **focus ring**，并关注对比度。

---

## 4.11 常见坑速查

| 现象                 | 原因                                | 解决                                    |
| -------------------- | ----------------------------------- | --------------------------------------- |
| 读屏不念字段名       | 没有关联 label                      | `htmlFor`/`id` 或 `aria-label`          |
| 提交后读屏没反应     | 错误没用 `role="alert"`/`aria-live` | 用 `FieldError`（自带 `role="alert"`）  |
| tab 到字段听不到错误 | 没 `aria-describedby` 指向错误      | 关联 `errorId`                          |
| 弹窗焦点跑到背后页面 | 非模态或 `modal={false}`            | 用默认 `modal`（true）或 `'trap-focus'` |
| 关闭后焦点丢失       | 没有返回焦点                        | 用默认 `finalFocus` 或指定 ref          |
| 鼠标点击也出现焦点环 | 用了 `:focus`                       | 改用 `:focus-visible`                   |
| 焦点环看不见         | `outline:none` 却没补 ring          | 加 `focus-visible:ring-*`               |
| id 重复导致关联错乱  | 组件被复用多次                      | 用 `useId()` 生成唯一 id                |

---

上一章：[← 第 3 章：Base UI primitives](./03-base-ui-primitives.md) ｜ 下一章：[第 5 章：Zod：schema 与类型 →](./05-zod-schema-and-types.md)
