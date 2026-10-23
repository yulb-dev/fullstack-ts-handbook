# 第 2 章：shadcn/ui 的「拥有源码」模型

> 本章目标：彻底理解 shadcn/ui 的分发方式——**组件源码被拷进你的项目、由你拥有和维护**；并学会维护三样东西：**design tokens、variants、自定义边界**。
> 对应路线图能力点：**[1] 设计系统所有权**。

---

## 2.1 shadcn/ui 不是「组件库」，是「组件分发方式」

这是最反直觉、也最重要的一点。

传统组件库（MUI、Ant Design、Chakra）是 **npm 依赖**：你 `import { Button } from '@mui/material'`，Button 的实现藏在 `node_modules` 里，是个**黑盒**。想改内部结构？只能靠它暴露的 props 或脆弱的 CSS 覆盖。

shadcn/ui 反过来：当你运行

```bash
pnpm dlx shadcn@latest add button
```

它做的事情是——**把 `button.tsx` 的完整源码复制到你项目的 `src/components/ui/button.tsx`**。从此这个文件就是你的了。`package.json` 里**没有** `shadcn-ui` 这个依赖。

```
传统组件库：      你的代码  ──import──▶  node_modules/黑盒组件（改不动）
shadcn/ui：       你的代码  ──import──▶  src/components/ui/button.tsx（你的源码，随便改）
```

### 这样做的收益与代价

|              | 收益                                       | 代价                                 |
| ------------ | ------------------------------------------ | ------------------------------------ |
| **拥有源码** | 可以改任何一行：结构、样式、行为、可访问性 | 官方更新不会自动同步到你已改过的文件 |
| **无黑盒**   | 出问题时能直接读源码定位，不用猜           | 你要对这份代码负责（维护、测试）     |
| **可裁剪**   | 只拷你用到的组件，bundle 精简              | 需要时得手动 `add`                   |
| **一致抽象** | 底层换 Radix/Base UI，对外 API 不变        | 底层升级时源码内部会变               |

> **一句话记住**：shadcn/ui 用「复制源码」换来了**完全的控制权**，代价是**你要自己维护这份源码**。理解了这个权衡，后面「自定义边界」的决策就顺理成章了。

---

## 2.2 `components.json`：项目的 shadcn 配置

`shadcn init` 会在项目根目录生成它。它告诉 CLI「往哪拷、怎么拷」：

```jsonc
// components.json（示例，字段值取决于你 init 时的选择）
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york", // 组件风格：new-york / default
  "rsc": false, // 是否用 React Server Components（Next.js 相关）
  "tsx": true, // 用 TSX 而非 JSX
  "tailwind": {
    "config": "", // v4 是 CSS-first，通常留空
    "css": "src/index.css", // tokens 注入到哪个 CSS 文件
    "baseColor": "neutral", // 基础色板
    "cssVariables": true, // 用 CSS 变量作为 token（强烈推荐 true）
    "prefix": "",
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils", // cn() 所在
    "ui": "@/components/ui", // 组件源码落地目录
    "lib": "@/lib",
    "hooks": "@/hooks",
  },
  "iconLibrary": "lucide",
}
```

**新手最需要关心的两个字段**：

- `tailwind.css`：tokens 会被注入到这个文件（第 2.3 节）；
- `aliases.ui`：组件源码拷到哪（默认 `@/components/ui`），你 import 组件就用这个别名。

> 用 Base UI 还是 Radix 的选择，`init`/`create` 时决定，会影响拷进来的组件源码内部实现，但不改变上面这套配置结构。

---

## 2.3 Design tokens：设计系统的地基

打开 `src/index.css`，你会看到 `init` 注入的一整套 CSS 变量。这就是 **design tokens**——把颜色、圆角等设计决策抽成语义化变量，而不是散落各处的硬编码色值。

```css
/* src/index.css（节选，实际值取决于你选的 baseColor） */
@import "tailwindcss";

:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --radius: 0.625rem;
  /* ...还有 card / popover / muted / accent / secondary 等 */
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --primary: oklch(0.985 0 0);
  /* ...深色模式下同一批变量的另一组值 */
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-ring: var(--ring);
  /* ...把语义变量映射成 Tailwind 能识别的 color-* */
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

### 这套 token 机制怎么运转

```
:root { --primary: ... }          ← 语义 token（浅色的值）
.dark  { --primary: ... }          ← 语义 token（深色的值）
              │
              ▼
@theme inline {
  --color-primary: var(--primary)  ← 把 token 暴露成 Tailwind 的 color-primary
}
              │
              ▼
你在 JSX 里写 className="bg-primary text-primary-foreground"
              │
              ▼
深色模式下 <html class="dark">，--primary 自动切换 → 颜色自动变
```

**关键收益**：

- 想全局改主色？只改 `--primary` 一处，所有 `bg-primary` 跟着变；
- 深色模式几乎零成本——`.dark` 里给同一批变量另一组值即可；
- 语义化命名（`primary`/`destructive`/`muted`）比 `blue-600`/`red-500` 更能表达**意图**，团队协作时不会写出 `bg-[#3b82f6]` 这种硬编码。

> **维护 token 的正确姿势**：改 `:root` / `.dark` 里的变量值，或用主题生成器（如官方 theme preset）重新生成。**不要**在组件里写死颜色类名，否则 token 就失去意义了。

---

## 2.4 Variants：用 `cva` 管理组件的「样子组合」

看 shadcn 真实的 `button.tsx` 源码（拷进你项目后长这样）：

```tsx
// src/components/ui/button.tsx（真实源码，节选）
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Slot } from "radix-ui"; // Base UI 版此处实现不同，见下方说明

const buttonVariants = cva(
  // 所有 variant 共享的基础类
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs",
        sm: "h-8 gap-1.5 rounded-md px-3",
        lg: "h-10 rounded-md px-6",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
```

拆开看几个设计点：

### （1）`cva` = class-variance-authority

它把「一组类名」按 **variant 维度**组织起来。`variant`（default/destructive/outline…）和 `size`（default/sm/lg/icon…）两个维度自由组合，`cva` 帮你算出最终类名串。

```tsx
<Button variant="destructive" size="sm">
  删除
</Button>
// 最终 className = 基础类 + destructive 类 + sm 类
```

比起手写 `className={variant === 'destructive' ? '...' : '...'}` 的三元地狱，`cva` 让「组件有哪些样子」一目了然，且类型安全（`VariantProps` 推导出 `variant`/`size` 的合法值）。

### （2）`defaultVariants`：默认样子

不传 `variant` 就是 `default`，不传 `size` 就是 `default`。

### （3）`cn()`：条件合并 + 冲突消解

`src/lib/utils.ts` 里的 `cn` 通常是 `clsx` + `tailwind-merge` 的组合：

```ts
// src/lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

`twMerge` 会智能处理 Tailwind 类冲突：`cn("px-2", "px-4")` → `"px-4"`（后者胜）。所以 `<Button className="px-8">` 能覆盖 variant 里的 `px-4`，这是**允许使用方微调**的关键机制。

### （4）`data-slot`：稳定的样式钩子

每个子组件都带 `data-slot="button"` / `data-slot="field-error"` 之类的属性。这是一个**契约**：让父组件或使用者能用 `[data-slot=xxx]` 选择器定位子元素（你在第 2.4 节 Field 源码里会看到大量 `has-[>[data-slot=...]]` 用法），比依赖易变的 class 名更稳。

### （5）`asChild` / `Slot`：把样式套到别的元素上

`asChild` 让 Button 不渲染 `<button>`，而是把样式和行为**合并到它的子元素**上：

```tsx
<Button asChild>
  <a href="/docs">当成链接用，但长得像按钮</a>
</Button>
```

> **Radix vs Base UI 的差异点**：上面这份源码是 **Radix 风格**（`Slot` + `asChild`）。若你 init 时选了 **Base UI**，底层原语用的是 **`render` prop** 而非 `asChild`（第 3 章会详讲 Base UI 的 `render`）。但请注意：**shadcn 对外暴露的 Button API 在两种后端下保持一致**，你写业务代码时基本无感。差异主要体现在组件源码内部，以及你**直接**用 Base UI 原语时。

---

## 2.5 Field：一个「纯 shadcn」组件如何组织

不是所有 shadcn 组件都是原语的薄封装。`Field` 系列就是 shadcn **自己用 `<div>` + cva + data-slot** 搭出来的，用来统一表单字段的布局与错误展示（第 4、8 章会大量用到）。看真实源码的两个代表：

```tsx
// src/components/ui/field.tsx（节选）

// 用 cva 管理"字段布局方向"这个 variant
const fieldVariants = cva(
  "group/field flex w-full gap-3 data-[invalid=true]:text-destructive",
  {
    variants: {
      orientation: {
        vertical: ["flex-col [&>*]:w-full [&>.sr-only]:w-auto"],
        horizontal: [
          "flex-row items-center",
          "[&>[data-slot=field-label]]:flex-auto",
        ],
        responsive: [
          "flex-col @md/field-group:flex-row @md/field-group:items-center",
        ],
      },
    },
    defaultVariants: { orientation: "vertical" },
  },
);

function Field({ className, orientation = "vertical", ...props }) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  );
}

// 错误展示：role="alert" 让屏幕阅读器能主动播报
function FieldError({ className, children, errors, ...props }) {
  // ...把 errors 数组去重后渲染成文本或列表
  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn("text-sm font-normal text-destructive", className)}
      {...props}
    >
      {content}
    </div>
  );
}
```

从这里能学到 shadcn 的组织范式：

- **`data-[invalid=true]:text-destructive`**：当 `Field` 上出现 `data-invalid="true"` 时，文字变红。这就是第 8 章错误显示的样式入口；
- **`role="group"` / `role="alert"`**：语义化 ARIA，第 4 章会讲为什么错误要用 `role="alert"`；
- **`orientation` variant**：垂直/水平/响应式三种字段布局，一处定义、处处复用。

---

## 2.6 自定义边界：改源码？包一层？还是 className？

既然源码归你，是不是想怎么改就怎么改？**不是**。乱改会让你之后无法升级、难以协作。按「侵入性从低到高」有四个层次，**优先用靠前的**：

```
侵入性低 ────────────────────────────────────────────▶ 侵入性高
  ①使用方 className      ②包一层业务组件       ③加 variant      ④直接改源码
  （一次性微调）          （复用+封装意图）      （扩展样式维度）   （改结构/行为）
```

### ① 使用方 `className`——一次性微调

只想在某个页面把按钮加宽？直接传 `className`，靠 `cn`/`twMerge` 覆盖：

```tsx
<Button className="w-full">占满整行</Button>
```

**适用**：一次性的、局部的样式微调。**不适用**：会重复出现的模式（那样等于把样式散落各处）。

### ② 包一层业务组件——封装意图 + 复用

反复用同一种「危险操作按钮」？在**你自己的目录**里封装，而不是改 `ui/button.tsx`：

```tsx
// src/components/danger-button.tsx  ← 你的业务组件，不碰 ui/ 源码
import { Button } from "@/components/ui/button";

export function DangerButton(props: React.ComponentProps<typeof Button>) {
  return <Button variant="destructive" {...props} />;
}
```

**适用**：团队约定俗成的模式、带业务语义的组合。**这是最推荐的复用方式**——它不修改源码，因此源码升级不受影响。

### ③ 加 variant——扩展样式维度

如果确实需要一种新的「官方样式变体」（比如 `variant="brand"`），可以在 `buttonVariants` 里**新增一个 variant**，而不是改现有的：

```tsx
// src/components/ui/button.tsx
const buttonVariants = cva("...", {
  variants: {
    variant: {
      default: "...",
      destructive: "...",
      brand: "bg-brand text-white hover:bg-brand/90", // ← 新增，不动其它
    },
    // ...
  },
});
```

**适用**：需要沉淀进设计系统、被多处以 props 方式复用的样式。**代价**：改了源码，官方更新时需要手动合并。

### ④ 直接改源码——最后手段

要改组件的 DOM 结构、可访问性行为、默认 props 时，才动源码本体。

**适用**：源码的行为不满足需求，且无法通过前三层解决。**代价最大**：你与上游彻底分叉，`shadcn add` 再拉同名组件会覆盖/冲突，需要你自己 diff 合并。

### 决策速查表

| 你的需求                  | 推荐做法        | 是否改源码        |
| ------------------------- | --------------- | ----------------- |
| 某处按钮临时加宽          | ① `className`   | 否                |
| 团队统一的「危险按钮」    | ② 业务组件封装  | 否                |
| 新增一种全局按钮样式      | ③ 加 variant    | 是（增量）        |
| 改 Dialog 的焦点行为/结构 | ④ 改源码        | 是（侵入）        |
| 改主色/圆角               | 改 token（2.3） | 否（改 CSS 变量） |

> **黄金法则**：**能用 token 解决的不改组件，能包一层解决的不改源码，能加 variant 解决的不改现有 variant。** 把对 `src/components/ui/*` 的直接修改降到最少，你才能在享受官方更新的同时保住自己的定制。

---

## 2.7 升级与再生成的权衡

因为源码归你，「升级 shadcn」不像升级 npm 包那样一条命令搞定。现实做法：

- **只加新组件**：`shadcn add xxx` 拷新文件，不影响你已改的旧文件；
- **想更新某个已改过的组件**：官方提供了组件更新/diff 的能力，但**你手改过的部分需要人工合并**；
- **降低痛点的策略**：
  1. 把定制尽量放在**业务封装层（②）和 token 层**，少动 `ui/*` 源码；
  2. 必须改源码时，**改动集中、加注释**，方便日后 diff；
  3. 用 git 跟踪 `src/components/ui/`，升级前先提交，升级后 review diff。

---

## 2.8 本章练习

1. **找到 token**：打开 `src/index.css`，列出至少 5 个语义 token 变量，说明各自用途。
2. **改主色**：只通过修改 `--primary`（`:root` 和 `.dark` 两处），把整站主色换成一种你喜欢的颜色，验证所有 `bg-primary` 元素都跟着变。
3. **读 Button 源码**：打开 `src/components/ui/button.tsx`，回答：`variant` 和 `size` 各有哪些合法值？`asChild` 为 true 时渲染成什么？
4. **封装业务组件**：在 `src/components/` 下写一个 `DangerButton`（基于 `variant="destructive"`），并在一处使用它——**不要**改 `ui/button.tsx`。
5. **加 variant**：给 Button 增加一个 `variant="brand"`，配合一个新 token `--brand`，验证生效。
6. **思考题**：为什么 `FieldError` 用 `role="alert"` 而不是普通 `<div>`？（第 4 章揭晓）

---

## 2.9 本章验收清单

学完本章，你应该能：

- [ ] 解释 shadcn/ui 是**源码分发**而非 npm 黑盒依赖，说出收益与代价；
- [ ] 读懂 `components.json`，知道 `aliases.ui` 和 `tailwind.css` 的作用；
- [ ] 说清 **design token** 机制：`:root`/`.dark` 变量 → `@theme inline` 映射 → Tailwind 语义类；
- [ ] 只改 token 就能全局换肤 + 深色模式，不写死颜色；
- [ ] 读懂 `cva` 的 `variants` / `defaultVariants`，理解 `cn`（clsx + tailwind-merge）如何消解冲突；
- [ ] 解释 `data-slot` 的作用；
- [ ] 说清 **自定义四层边界**（className / 业务封装 / 加 variant / 改源码），并按「最小侵入」原则做决策；
- [ ] 理解升级权衡，知道如何降低与上游分叉的痛点。

---

## 2.10 常见坑速查

| 现象                         | 原因                                          | 解决                                         |
| ---------------------------- | --------------------------------------------- | -------------------------------------------- |
| 改了颜色但没生效             | 只改了组件类名，没改 token；或被 `.dark` 覆盖 | 改 `:root`/`.dark` 里的变量                  |
| 深色模式颜色不对             | 只在 `:root` 定义了值，`.dark` 没同步         | 两处都要给值                                 |
| `className` 覆盖不了组件样式 | 类冲突但没用 `cn`/`twMerge`                   | 确保组件内部用 `cn` 合并                     |
| 想升级组件却覆盖了定制       | 直接改了 `ui/*` 源码                          | 定制尽量放业务封装层；升级前 git 提交后 diff |
| `bg-primary` 类不存在        | `@theme inline` 未正确映射变量                | 检查 index.css 的 `@theme inline` 段         |

---

上一章：[← 第 1 章：全景与环境搭建](./01-landscape-and-setup.md) ｜ 下一章：[第 3 章：Base UI primitives →](./03-base-ui-primitives.md)
