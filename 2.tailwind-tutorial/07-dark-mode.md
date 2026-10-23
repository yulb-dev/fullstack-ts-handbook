# 第 7 章：深色模式

> 上一章：[第 6 章 状态变体](./06-state-variants.md) | 返回目录：[README](./README.md) | 下一章：[第 8 章 主题令牌与设计系统](./08-theme-and-design-tokens.md)

深色模式在 Tailwind 里就是又一个变体：`dark:`。但要做对——不闪屏、可切换、不散落硬编码色值——需要理解它的机制并配合语义颜色。本章先讲机制与切换实现，"如何避免每个类都写两遍颜色"的语义 token 方案在 7.5 展开（并与第 8 章衔接）。

## 7.1 基本用法：dark 变体

```html
<div
  class="bg-white dark:bg-gray-800 rounded-lg px-6 py-8 shadow-xl ring ring-gray-900/5"
>
  <div>
    <span
      class="inline-flex items-center justify-center rounded-md bg-indigo-500 p-2 shadow-lg"
    >
      <svg
        class="size-6 stroke-white"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <!-- ... -->
      </svg>
    </span>
  </div>
  <h3
    class="mt-5 text-base font-medium tracking-tight text-gray-900 dark:text-white"
  >
    Writes upside-down
  </h3>
  <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
    The Zero Gravity Pen can be used to write in any orientation, including
    upside-down.
  </p>
</div>
```

核心心智模型（与所有变体一致）：**一个类永远只携带一种模式的样式**。`bg-white` 管浅色模式，`dark:bg-gray-800` 管深色模式，两个类并存、条件生效：

```css
.dark\:bg-gray-800 {
  @media (prefers-color-scheme: dark) {
    background-color: var(--color-gray-800);
  }
}
```

## 7.2 两种触发机制

### 机制一（默认）：跟随系统偏好

什么都不用配置，`dark:` 基于 `prefers-color-scheme` 媒体查询——用户在操作系统里选了深色，你的站点就是深色。**适合内容型站点**。

### 机制二：手动切换（class / data 属性驱动）

要在站点里放一个"主题切换开关"，需要覆盖 `dark` 变体的定义（v4 CSS-first 方式，一行 CSS）：

```css
@import "tailwindcss";

/* 用 .dark 类驱动 */
@custom-variant dark (&:where(.dark, .dark *));
```

含义：`dark:bg-gray-800` 现在生成的是 `.dark` 类出现在 HTML 树上方时生效（`:where()` 保持零特异性，不干扰层叠——第 1 章的知识在这里闭环）。

用 data 属性驱动也一样：

```css
@import "tailwindcss";

@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
```

```html
<html data-theme="dark">
  <body>
    <div class="bg-white dark:bg-black"><!-- data-theme=dark 时是黑底 --></div>
  </body>
</html>
```

> v3 里这是 `tailwind.config.js` 的 `darkMode: 'class'` 选项；v4 用 `@custom-variant` 覆盖，更灵活（你可以定义任意选择器作为深色模式的开关）。版本差异的又一例证。

## 7.3 实现三态主题切换（浅色 / 深色 / 跟随系统）

官方推荐的完整方案。要点有二：**CSS 用 class 驱动**（机制二）+ **JS 在 `<head>` 里内联执行**（避免闪屏）。

### 第 1 步：CSS 定义变体

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
```

### 第 2 步：head 内联脚本，页面渲染前定好主题

```html
<head>
  <!-- 必须内联在 head 中、样式之后立即执行，否则深色用户会先看到一帧白屏（FOUC） -->
  <script>
    document.documentElement.classList.toggle(
      "dark",
      localStorage.theme === "dark" ||
        (!("theme" in localStorage) &&
          window.matchMedia("(prefers-color-scheme: dark)").matches),
    );
  </script>
</head>
```

逻辑：用户显式选过就用用户的选择；没选过就跟随系统。

### 第 3 步：切换按钮的三种动作

```js
// 用户选择浅色
localStorage.theme = "light";
// 用户选择深色
localStorage.theme = "dark";
// 用户选择"跟随系统"
localStorage.removeItem("theme");

// 每次变更后同步 DOM（也可抽成 applyTheme() 函数）
document.documentElement.classList.toggle(
  "dark",
  localStorage.theme === "dark" ||
    (!("theme" in localStorage) &&
      window.matchMedia("(prefers-color-scheme: dark)").matches),
);
```

### React 版本（组合成 hook）

```jsx
import { useEffect, useState } from "react";

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function useTheme() {
  // "light" | "dark" | "system"
  const [theme, setTheme] = useState(() => localStorage.theme ?? "system");

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") {
      localStorage.removeItem("theme");
      root.classList.toggle("dark", getSystemTheme() === "dark");
    } else {
      localStorage.theme = theme;
      root.classList.toggle("dark", theme === "dark");
    }
  }, [theme]);

  // 系统主题变化时（仅当处于 system 模式）跟随
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (!("theme" in localStorage))
        root.classList?.toggle("dark", mq.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return { theme, setTheme };
}
```

服务端渲染（SSR）项目注意：初始 class 要在服务端渲染时就输出（比如根据用户资料/cookie 决定），内联脚本仅做校正，否则水合（hydration）时会闪一下。

## 7.4 深色模式的实用设计守则

写 `dark:` 类时的经验法则（设计层面，不是语法层面）：

1. **深色模式不是纯黑**：背景用 `gray-900`/`gray-950` 这类深灰而非 `black`，卡片再提亮一档（`gray-800`），层级靠"越靠前越亮"表达；
2. **文字不要纯白**：`gray-100`/`gray-400` 的柔和对比比 `white` 更耐读；
3. **阴影在深色下几乎不可见**：官方示例的做法是 `dark:shadow-none` + 用 `ring`/边框（`dark:outline-white/10`）表达层级；
4. **饱和度要降**：亮色模式下的 `bg-blue-600` 在深色背景上会刺眼，常用 `dark:bg-blue-500/20 dark:text-blue-300` 这类"低透明底 + 亮文字"组合；
5. **图片刺眼**：给亮色图片加 `dark:opacity-80` 或 `dark:brightness-75`；
6. **对比度是硬指标**：正文与背景对比度 ≥ 4.5:1（WCAG AA），改完用 DevTools 的检查器验证。

## 7.5 进阶：用语义颜色避免"每个类写两遍"

`dark:` 变体的代价是：每个带颜色的类都要成对出现。页面一复杂，`dark:` 会像雪片一样散落各处：

```html
<!-- 能跑，但每个组件都在重复"颜色决策" -->
<div
  class="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700"
></div>
```

更工程化的方案：**把"哪个颜色"的决策收敛到主题层，组件只表达"这是什么用途"**。定义语义颜色 token：

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));

/* 第一步：亮/暗两套原始值（普通 CSS 变量，不生成工具类） */
:root {
  --surface: var(--color-white);
  --surface-raised: var(--color-gray-50);
  --text: var(--color-gray-900);
  --text-muted: var(--color-gray-500);
  --border: var(--color-gray-200);
}
.dark {
  --surface: var(--color-gray-900);
  --surface-raised: var(--color-gray-800);
  --text: var(--color-gray-100);
  --text-muted: var(--color-gray-400);
  --border: var(--color-gray-700);
}

/* 第二步：把语义变量注册进主题，生成 bg-surface、text-muted 等工具类
   inline 让工具类直接引用 --surface 而不是拷贝定义时的值（第 8 章详解） */
@theme inline {
  --color-surface: var(--surface);
  --color-surface-raised: var(--surface-raised);
  --color-text: var(--text);
  --color-text-muted: var(--text-muted);
  --color-border: var(--border);
}
```

现在组件层完全没有 `dark:` 了，一套类名自动适配两种模式：

```html
<div class="bg-surface text-text border border-border">
  <p class="text-text-muted">次要文字</p>
</div>
```

**两种方案怎么选**：

| 方案                         | 适用                                                     |
| ---------------------------- | -------------------------------------------------------- |
| 直接写 `dark:` 对（7.1~7.4） | 小项目、落地页、深色只是局部微调                         |
| 语义颜色 token（7.5）        | 应用类产品、组件库、多人协作——深色模式成为"换一套变量值" |

这不是二选一：语义 token 打底，个别元素仍可用 `dark:` 微调（如 `dark:opacity-80` 的图片处理）。完整的 token 体系设计在第 8 章展开。

## 7.6 实战：TaskBoard 支持深色模式

在第 5、6 章的成果上做三处改造：

**① CSS 入口**（`src/index.css`）：

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));

:root {
  --surface: var(--color-white);
  --surface-sunken: var(--color-gray-100);
  --surface-raised: var(--color-gray-50);
  --text: var(--color-gray-900);
  --text-muted: var(--color-gray-500);
  --border: var(--color-gray-200);
}
.dark {
  --surface: var(--color-gray-900);
  --surface-sunken: var(--color-gray-950);
  --surface-raised: var(--color-gray-800);
  --text: var(--color-gray-100);
  --text-muted: var(--color-gray-400);
  --border: var(--color-gray-700);
}

@theme inline {
  --color-surface: var(--surface);
  --color-surface-sunken: var(--surface-sunken);
  --color-surface-raised: var(--surface-raised);
  --color-text: var(--text);
  --color-text-muted: var(--text-muted);
  --color-border: var(--border);
}
```

**② HTML 关键类名替换**（语义化前后对照）：

```html
<!-- 之前 -->
<body class="bg-gray-100 text-gray-900">
  <header class="border-b border-gray-200 bg-white">
    <h2 class="font-semibold">…</h2>
    <p class="mt-2 text-sm text-gray-500">…</p>

    <!-- 之后：无任何 dark: 前缀，自动适配双模式 -->
    <body class="bg-surface-sunken text-text">
      <header class="border-b border-border bg-surface">
        <h2 class="font-semibold text-text">…</h2>
        <p class="mt-2 text-sm text-text-muted">…</p>
      </header>
    </body>
  </header>
</body>
```

状态标签这类"品牌色块"保留常规色板 + 显式 dark 微调即可：

```html
<span
  class="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800
             dark:bg-amber-500/15 dark:text-amber-300"
  >进行中</span
>
```

**③ 加一个主题切换按钮**（head 内联脚本见 7.3）：

```html
<button
  type="button"
  id="theme-toggle"
  aria-label="切换深色模式"
  class="rounded-lg p-2 text-text-muted hover:bg-surface-raised hover:text-text
         focus-visible:outline-2 focus-visible:outline-blue-600"
>
  <!-- 太阳/月亮图标互斥显示：dark 变体的又一种用法 -->
  <svg
    class="size-5 dark:hidden"
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
  >
    <!-- 太阳路径 -->
  </svg>
  <svg
    class="hidden size-5 dark:block"
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
  >
    <!-- 月亮路径 -->
  </svg>
</button>
```

```js
document.getElementById("theme-toggle").addEventListener("click", () => {
  const isDark = document.documentElement.classList.toggle("dark");
  localStorage.theme = isDark ? "dark" : "light";
});
```

在浏览器里验证：切换系统外观 → 页面跟随（system 模式）；点按钮 → 手动覆盖并记忆；刷新 → 不闪屏。

## 本章小结与自检

- [ ] 理解 `dark:` 就是普通变体，"一个类只携带一种模式的样式"；
- [ ] 知道默认机制是 `prefers-color-scheme`，手动切换要用 `@custom-variant dark (&:where(.dark, .dark *))` 覆盖；
- [ ] 能实现三态切换（浅色/深色/跟随系统），head 内联脚本防 FOUC，localStorage 记忆偏好；
- [ ] 掌握深色设计守则：非纯黑背景、非纯白文字、阴影换 ring、降饱和、对比度 ≥ 4.5:1；
- [ ] 能写出语义颜色方案（`:root` / `.dark` 双套变量 + `@theme inline` 注册），知道它与 `dark:` 成对写法的适用边界；
- [ ] TaskBoard 已完成深色模式改造：主体颜色全部走语义 token，仅局部保留 `dark:` 微调。

---

> 上一章：[第 6 章 状态变体](./06-state-variants.md) | 返回目录：[README](./README.md) | 下一章：[第 8 章 主题令牌与设计系统](./08-theme-and-design-tokens.md)
