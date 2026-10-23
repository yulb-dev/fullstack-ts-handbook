# 第 3 章：Base UI primitives

> 本章目标：理解 Base UI 是什么、怎么用**组合式 API** 拼装组件，掌握**受控/非受控**两种模式，吃透 Popover/Menu/Select/Dialog 的**结构**与**焦点管理、键盘行为**。
> 对应路线图能力点：**[2] 可访问组件原语**。

---

## 3.1 Base UI 是什么

Base UI 是一套**无样式（unstyled）、可访问**的 React 组件原语库，由 Radix、Floating UI、Material UI 的创作者团队打造，包名 **`@base-ui/react`**（旧名 `@base-ui-components/react` 已重命名）。

它的定位（引自官方）：

- **无样式**：不捆绑任何 CSS，不规定样式方案。Tailwind、CSS Modules、CSS-in-JS、纯 CSS 都能配；
- **可访问**：遵循 [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) 模式，符合 WCAG 2.2，把 ARIA 属性、role、键盘导航、焦点管理这些**又难又容易做错**的部分替你处理好；
- **组合式**：每个组件拆成若干「部件（parts）」，你像搭积木一样组装；
- **是 shadcn/ui 的底层地基**：shadcn/ui 就是给 Base UI（或 Radix）原语**套上样式**后的成品。

```
Base UI（无样式、可访问的行为）  +  Tailwind（样式）  =  shadcn/ui（成品组件）
        你在第 3 章直接用              第 2.3 节              第 2 章看到的 button.tsx
```

> **什么时候直接用 Base UI，什么时候用 shadcn/ui？**
>
> - 想要开箱即用、已样式化的组件 → 用 **shadcn/ui**（第 2 章）；
> - 想要完全掌控结构与样式、或 shadcn 没有你要的组件（如 Combobox） → 直接用 **Base UI**。
> - 学 Base UI 的价值还在于：即便你只用 shadcn，也能**读懂组件源码内部**在干什么。

---

## 3.2 安装与全局设置

```bash
pnpm add @base-ui/react
```

所有组件都在一个包里，且**可 tree-shake**——只打包你真正用到的。

### Portal 层叠隔离（重要）

Dialog、Popover 这类弹层用 **portal** 渲染到 `<body>` 末尾。为了让它们**永远浮在页面之上**、不被你项目里的 `z-index` 干扰，官方建议在应用布局根节点加一条样式：

```tsx
// layout / App 根节点
<body>
  <div className="root">{children}</div>
</body>
```

```css
/* styles.css */
.root {
  isolation: isolate; /* 创建独立层叠上下文 */
}
```

> 在 Tailwind 里等价写法：给根容器加 `className="isolate"`。这条能避免第 1 章「常见坑」里提到的弹层被盖住问题。

### iOS 26+ Safari 的 backdrop 兼容

从 iOS 26 起 Safari 允许 UI chrome 下方的内容可见，dialog 的遮罩要用 `position: absolute` 而非 `fixed` 才能覆盖整个可视视口。官方建议全局加：

```css
body {
  position: relative;
}
```

---

## 3.3 组合式 API：像搭积木一样拼组件

Base UI 的每个组件由**带命名空间的部件**组成。以 Popover 为例（官方 quick-start 原例）：

```tsx
import * as React from "react";
import { Popover } from "@base-ui/react/popover";

export default function NotificationsPopover() {
  return (
    <Popover.Root>
      <Popover.Trigger className="...">Notifications</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8}>
          <Popover.Popup className="...">
            <Popover.Arrow className="..." />
            <Popover.Title className="...">Notifications</Popover.Title>
            <Popover.Description className="...">
              You are all caught up. Good job!
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

理解这套**分层结构**（几乎所有浮层类组件都遵循）：

| 部件                              | 职责                                                                |
| --------------------------------- | ------------------------------------------------------------------- |
| `Root`                            | 状态容器（open/close），不渲染 DOM                                  |
| `Trigger`                         | 触发器，默认渲染 `<button>`，负责开合                               |
| `Portal`                          | 把浮层 teleport 到 `<body>`，脱离父级层叠/overflow 限制             |
| `Positioner`                      | 负责**定位**（相对 trigger 的位置、`sideOffset` 等），处理翻转/避让 |
| `Popup`                           | 浮层**内容本体**，承载 ARIA role、焦点陷阱                          |
| `Arrow` / `Title` / `Description` | 语义化子部件                                                        |

> **为什么要把 Positioner 和 Popup 分开？** 因为「定位」和「内容/动画」是两件事。Positioner 处理相对 trigger 的坐标与翻转，Popup 处理内容、role、进出场动画。分开后动画不会干扰定位计算。

---

## 3.4 `render` prop：Base UI 的组合核心（对比 Radix 的 `asChild`）

Base UI 用 **`render` prop** 来「换掉默认渲染的元素」或「组合进你自己的组件」。这是它和 Radix 最大的 API 差异（Radix 用 `asChild`）。

### （1）改变默认渲染的元素

`Accordion.Header` 默认渲染 `<h3>`，想改成 `<h2>` 以匹配页面标题层级：

```tsx
import { Accordion } from "@base-ui/react/accordion";

<Accordion.Root>
  <Accordion.Item>
    <Accordion.Header render={<h2 />}>
      <Accordion.Trigger>What is Base UI?</Accordion.Trigger>
    </Accordion.Header>
    <Accordion.Panel>
      Base UI is a library of unstyled React components.
    </Accordion.Panel>
  </Accordion.Item>
</Accordion.Root>;
```

### （2）组合进你自己的组件

大多数 Trigger 默认渲染 `<button>`。想换成你自己的按钮组件：

```tsx
<Menu.Trigger render={<MyButton size="md" />}>Open menu</Menu.Trigger>
```

**约束**：你的自定义组件必须 **① 转发 ref（forward ref）② 把收到的所有 props 铺到它底层的 DOM 节点上**。否则 Base UI 无法接管焦点、事件、ARIA。

```tsx
// ✅ 正确：转发 ref + 铺开 props
const MyButton = React.forwardRef(function MyButton(
  { size, ...props }: { size: "md" } & React.ComponentProps<"button">,
  ref: React.Ref<HTMLButtonElement>,
) {
  return <button ref={ref} data-size={size} {...props} />;
});
```

### （3）render 作为函数：完全掌控 props 与状态

在性能敏感或需要按状态渲染不同内容时，给 `render` 传函数，参数是 `(props, state)`：

```tsx
<Switch.Thumb
  render={(props, state) => (
    <span {...props}>
      {state.checked ? <CheckedIcon /> : <UncheckedIcon />}
    </span>
  )}
/>
```

函数形式让你**手动铺开 props**，并能读到组件内部状态（如 `state.checked`）。

### （4）嵌套 render：同时组合多个组件

Tooltip 套 Dialog 套 Menu 这种场景，`render` 可以层层嵌套：

```tsx
<Dialog.Root>
  <Tooltip.Root>
    <Tooltip.Trigger
      render={
        <Dialog.Trigger
          render={
            <Menu.Trigger render={<MyButton size="md" />}>
              Open menu
            </Menu.Trigger>
          }
        />
      }
    />
    <Tooltip.Portal>{/* ... */}</Tooltip.Portal>
  </Tooltip.Root>
  <Dialog.Portal>{/* ... */}</Dialog.Portal>
</Dialog.Root>
```

### Radix ↔ Base UI 对照表

| 需求                                    | Radix 写法                                 | Base UI 写法                                                                            |
| --------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| 换成自定义元素/组件                     | `asChild` + 单个子元素                     | `render={<MyEl />}`                                                                     |
| 读取内部状态自定义渲染                  | 各组件的 render props（不统一）            | `render={(props, state) => ...}`                                                        |
| 浮层结构（Menu/Select/Popover/Tooltip） | `Portal > Content`                         | `Portal > Positioner > Popup`（多一层定位）                                             |
| 遮罩层                                  | `Overlay`                                  | `Backdrop`（Dialog 用 Backdrop + Popup，无 Positioner）                                 |
| 开/关状态选择器                         | `data-[state=open]:`                       | `data-open:`（迁移时 grep `data-[state=`）                                              |
| 阻止关闭                                | `onOpenChange` 里 `event.preventDefault()` | `onOpenChange(open, details)` 里 `details.cancel()`；`details.reason` 可辨 Esc/外部点击 |
| Select 受控值                           | `string`                                   | `Value \| null`（`useState<string\|null>(null)`）                                       |
| Tabs/手风琴激活                         | 方向键移动即激活                           | 方向键移动焦点，需 Enter/Space 激活（可用 `activateOnFocus` 改回）                      |
| 底层包名                                | `@radix-ui/react-*` / `radix-ui`           | `@base-ui/react/*`                                                                      |

> shadcn/ui 尽量把这一层差异**封装掉**：对外暴露的组件名和大部分 props 在两种后端下保持一致（`import { Dialog, DialogContent } from "@/components/ui/dialog"` 两边通用）。但**组件源码内部**、以及你**直接**用 Base UI 原语时，上表这些差异就会显现——尤其 `asChild`→`render`、`Overlay`→`Backdrop`、多出的 `Positioner`。若你的老项目想在新项目里强制用 Radix，可 `npx shadcn@latest init -b radix`。

---

## 3.5 受控 vs 非受控

这是 React 表单/交互组件的通用概念，Base UI 全程支持两种模式。

### 非受控（uncontrolled）——组件自己管状态

用 `defaultValue` 给初值，之后状态由组件内部管理，你不介入：

```tsx
// 开关自己记住开/关，你不用 useState
<Switch.Root defaultChecked>
  <Switch.Thumb />
</Switch.Root>
```

```tsx
// Dialog 自己管 open，用 Trigger/Close 开合
<Dialog.Root>
  <Dialog.Trigger>打开</Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Popup>
      <Dialog.Close>关闭</Dialog.Close>
    </Dialog.Popup>
  </Dialog.Portal>
</Dialog.Root>
```

**适用**：不需要在组件外部读取/驱动它的状态时。代码最少。

### 受控（controlled）——你用 state 驱动

传 `value`（或 `open`/`checked`）+ 对应的 `onValueChange`（或 `onOpenChange`/`onCheckedChange`），状态由你的 React state 说了算：

```tsx
const [open, setOpen] = React.useState(false)

<Dialog.Root open={open} onOpenChange={setOpen}>
  <Dialog.Trigger>打开</Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Popup>
      <button onClick={() => setOpen(false)}>关闭</button>
    </Dialog.Popup>
  </Dialog.Portal>
</Dialog.Root>
```

**适用**：

- 需要在打开/关闭时**做副作用**（官方推荐用 `onOpenChange` 而非 `useEffect` 监听）；
- 需要**外部按钮**控制开合；
- 需要把值**接入表单库**（第 6 章 RHF 的 `Controller` 本质就是把组件变成受控）。

```tsx
// 用 onOpenChange 做副作用，而不是 useEffect
<Dialog.Root
  open={open}
  onOpenChange={(nextOpen) => {
    setOpen(nextOpen)
    if (!nextOpen) analytics.track("dialog_closed")
  }}
>
```

### 对照表

|          | 非受控                                   | 受控                                       |
| -------- | ---------------------------------------- | ------------------------------------------ |
| 初值     | `defaultValue` / `defaultChecked` / 不传 | `value` / `checked` / `open`               |
| 变更回调 | 可选（只读时用 `onValueChange` 观察）    | **必须**（`onValueChange`/`onOpenChange`） |
| 状态归属 | 组件内部                                 | 你的 React state                           |
| 接入 RHF | 不方便                                   | ✅ 用 `Controller`（第 6 章）              |

> **黄金法则**：**能用非受控就用非受控**（简单）；一旦需要「外部驱动状态」或「接入表单/校验」，就切受控。

---

## 3.6 四类核心组件的结构速览

### （1）Popover——锚定气泡

结构见 3.3。特点：**非模态**，点击外部/按 Esc 关闭，用于提示信息、小表单。键盘：`Esc` 关闭并把焦点还给 Trigger。

### （2）Menu——动作菜单

```tsx
import { Menu } from "@base-ui/react/menu";

<Menu.Root>
  <Menu.Trigger render={<MyButton />}>Actions</Menu.Trigger>
  <Menu.Portal>
    <Menu.Positioner>
      <Menu.Popup>
        <Menu.Item onSelect={() => copy()}>Copy</Menu.Item>
        <Menu.Item onSelect={() => paste()}>Paste</Menu.Item>
        <Menu.Separator />
        <Menu.Item variant="danger" onSelect={() => del()}>
          Delete
        </Menu.Item>
      </Menu.Popup>
    </Menu.Positioner>
  </Menu.Portal>
</Menu.Root>;
```

键盘行为（遵循 ARIA menu 模式）：`↑`/`↓` 在项间移动、`Home`/`End` 跳到首/尾、字母键**按首字符跳转**、`Enter`/`Space` 选中、`Esc` 关闭并返回焦点。支持子菜单（嵌套 `Menu.Root`）。

### （3）Select——单选下拉

```tsx
import { Select } from "@base-ui/react/select";

<Select.Root items={SERVER_TYPES} defaultValue="standard">
  <Select.Trigger>
    <Select.Value />
  </Select.Trigger>
  <Select.Portal>
    <Select.Positioner>
      <Select.Popup>
        <Select.Item value="standard">Standard</Select.Item>
        <Select.Item value="performance">Performance</Select.Item>
      </Select.Popup>
    </Select.Positioner>
  </Select.Portal>
</Select.Root>;
```

- `items` 让 Select 知道全部选项，用于键盘导航与 `Select.Value` 的展示映射；
- 受控时用 `value` + `onValueChange`（这正是第 6 章接 RHF 的接口）；
- 键盘：`↑↓` 移动、字母跳转、`Enter` 选中、`Esc` 关闭。

### （4）Dialog——模态对话框

```tsx
import { Dialog } from "@base-ui/react/dialog";

<Dialog.Root open={open} onOpenChange={setOpen}>
  <Dialog.Trigger render={<MyButton />}>Launch instance</Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Backdrop className="fixed inset-0 bg-black/50" />
    <Dialog.Popup className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ...">
      <Dialog.Title>确认开通？</Dialog.Title>
      <Dialog.Description>这将立即创建实例并开始计费。</Dialog.Description>
      <Dialog.Close render={<MyButton variant="outline" />}>取消</Dialog.Close>
    </Dialog.Popup>
  </Dialog.Portal>
</Dialog.Root>;
```

Dialog 的焦点/模态行为最复杂，单独放到第 4 章「可访问性」详讲（focus trap、`initialFocus`、`finalFocus`、`modal`）。这里先记住结构：`Root > Trigger + Portal(Backdrop + Popup(Title/Description/Close))`。

---

## 3.7 焦点管理与键盘行为（概览）

Base UI 遵循 WAI-ARIA APG，**开箱即得**以下能力（第 4 章深入）：

- **键盘导航**：多数组件支持方向键、字母键、`Home`、`End`、`Enter`、`Esc`；
- **焦点管理**：交互后自动移动焦点；浮层类组件提供 `initialFocus`（打开时聚焦谁）和 `finalFocus`（关闭时焦点回到谁）；
- **模态焦点陷阱**：`Dialog` 的 `modal` 属性（默认 `true`）会把焦点**锁在弹窗内**、锁定页面滚动、禁用外部指针交互；
- **开发者职责**：Base UI 管「焦点去哪」，但**焦点的视觉呈现（focus ring）由你用 CSS 负责**——用 `:focus-visible` 样式，满足 WCAG 焦点可见要求。

> **划重点**：Base UI 帮你做对了**行为层**的可访问性（role、aria、键盘、焦点移动）；**视觉层**（对比度、focus ring 样式）仍是你的责任。这正是第 4 章要补齐的。

---

## 3.8 动手：组装一个带样式的 Popover

把本章知识串起来，用 Base UI + Tailwind 组装一个可用的 Popover（可直接放进第 1 章的项目）：

```tsx
// src/features/launch/help-popover.tsx
"use client";
import * as React from "react";
import { Popover } from "@base-ui/react/popover";

export function HelpPopover() {
  return (
    <Popover.Root>
      <Popover.Trigger
        className="rounded-md border bg-background px-3 py-1.5 text-sm
                   focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none"
      >
        什么是副本数？
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8}>
          <Popover.Popup
            className="z-50 w-72 rounded-lg border bg-popover p-4 text-popover-foreground
                       shadow-md outline-none
                       data-[starting-style]:opacity-0 data-[ending-style]:opacity-0
                       transition-opacity duration-150"
          >
            <Popover.Arrow className="bg-popover" />
            <Popover.Title className="text-sm font-semibold">
              副本数
            </Popover.Title>
            <Popover.Description className="mt-1 text-sm text-muted-foreground">
              同一实例并行运行的容器数量。副本越多，可用性越高，成本也越高。
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

**观察点**：

- `data-[starting-style]` / `data-[ending-style]` 是 Base UI 提供的**进出场状态钩子**，用来做 CSS 动画；
- `bg-popover` / `text-popover-foreground` 是第 2 章的 **design token**——Base UI 无样式，颜色全靠你的 token；
- 我给 Trigger 加了 `focus-visible:ring-*`——这就是「焦点视觉呈现由你负责」的落地。

---

## 3.9 本章练习

1. **装好 Base UI** 并给应用根节点加 `isolate`。
2. **拼一个 Menu**：三个动作项 + 一个分隔线 + 一个 danger 项，用键盘（方向键、字母、Enter、Esc）完整操作一遍。
3. **受控 Select**：用 `useState` 把 Select 变成受控，选中后在页面上回显当前值。
4. **render 改造**：用 `render={<MyButton />}` 把 Popover.Trigger 换成你第 2 章封装的按钮组件，确认 ref 转发与 props 铺开都正确（焦点、点击都正常）。
5. **对比实验**：把 Dialog 分别用非受控（`Trigger`+`Close`）和受控（`open`+`onOpenChange`）各写一遍，体会差异。
6. **思考题**：为什么浮层组件要有 `Portal` 和 `Positioner` 两层，而不是把定位样式直接写在 `Popup` 上？

---

## 3.10 本章验收清单

学完本章，你应该能：

- [ ] 说清 Base UI 是**无样式可访问原语**，以及它与 shadcn/ui 的关系；
- [ ] 装好 `@base-ui/react`，并完成 **portal 层叠隔离**（`isolation: isolate`）；
- [ ] 读懂浮层组件的**分层结构**（Root/Trigger/Portal/Positioner/Popup）；
- [ ] 用 **`render` prop** 组合自定义组件，并知道「转发 ref + 铺开 props」的约束；
- [ ] 区分 **受控/非受控**，知道各自的 props 与适用场景，以及受控如何接 RHF；
- [ ] 组装 Popover/Menu/Select/Dialog 并描述其**键盘行为**；
- [ ] 说清 Base UI 负责**行为层可访问性**，而 focus ring 等**视觉层**由你负责。

---

## 3.11 常见坑速查

| 现象                             | 原因                                                      | 解决                                                          |
| -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| 自定义 Trigger 点击无反应/无焦点 | 没转发 ref 或没铺开 props                                 | `forwardRef` + `{...props}` 到底层 DOM                        |
| 弹层被遮挡或随父容器裁切         | 缺 Portal 或根节点无层叠隔离                              | 用 `Portal` + 根节点 `isolate`                                |
| 受控组件「点了不动」             | 传了 `value`/`open` 却没传 `onValueChange`/`onOpenChange` | 受控必须成对出现                                              |
| 想改渲染元素却用了 `asChild`     | 那是 Radix 写法                                           | Base UI 用 `render={<El />}`                                  |
| iOS Safari 遮罩盖不全            | backdrop 用了 `fixed`                                     | 官方建议 `body { position: relative }` + backdrop 用 absolute |
| focus ring 看不见                | Base UI 不管视觉焦点样式                                  | 自己加 `:focus-visible` 样式                                  |

---

上一章：[← 第 2 章：shadcn/ui 的「拥有源码」模型](./02-shadcn-ownership-model.md) ｜ 下一章：[第 4 章：可访问性实战 →](./04-accessibility.md)
