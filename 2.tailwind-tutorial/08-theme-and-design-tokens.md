# 第 8 章：主题令牌与设计系统（@theme）

> 上一章：[第 7 章 深色模式](./07-dark-mode.md) | 返回目录：[README](./README.md) | 下一章：[第 9 章 className 管理与组件化](./09-classname-management-and-components.md)

第 7 章用语义颜色解决了深色模式，本章把视野放大：**整个设计系统**——颜色、字体、字号、间距、圆角、阴影、动画——在 v4 里都是 CSS 中的主题变量。这是"设计 token 而不是散落硬编码色值"这一验收项的主战场，也是 Tailwind 项目可维护性的分水岭。

## 8.1 什么是设计 token 与主题变量

**设计 token（design token）**：设计中最低层的决策值——品牌色是什么、正文字号多大、卡片圆角几像素。把它们命名、集中管理，就形成了设计与代码之间的契约。

**Tailwind 主题变量**：用 `@theme` 指令定义的特殊 CSS 变量，它们不只是变量——**每个主题变量会生成对应的工具类**。

```css
@import "tailwindcss";

@theme {
  --color-mint-500: oklch(0.72 0.11 178);
}
```

一行定义，三件事同时发生：

1. `bg-mint-500`、`text-mint-500`、`border-mint-500`、`fill-mint-500`、`ring-mint-500`… 一整族工具类立即可用；
2. 输出普通 CSS 变量 `--color-mint-500`，可在自定义 CSS、内联样式里 `var()` 引用；
3. 值进入设计系统，改一处、全局生效。

### 为什么是 @theme 而不是 :root？

两者的分工要明确：

| 指令     | 作用                      | 何时用                                                     |
| -------- | ------------------------- | ---------------------------------------------------------- |
| `@theme` | 定义变量 **并生成工具类** | 想让 token 变成 `bg-xxx` 这类词汇时                        |
| `:root`  | 只定义普通 CSS 变量       | 变量不直接对应工具类（如第 7 章的 `--surface` 中间层变量） |

`@theme` 还有语法约束：必须写在顶层，不能嵌套在选择器或媒体查询里——这是刻意的，保证"哪些是设计 token"一目了然。

## 8.2 命名空间：变量名决定生成什么工具类

主题变量按**命名空间**组织，前缀决定它映射到哪族工具类/变体：

| 命名空间                                              | 生成的工具类/变体                                 | 示例                                 |
| ----------------------------------------------------- | ------------------------------------------------- | ------------------------------------ |
| `--color-*`                                           | `bg-*`、`text-*`、`border-*`、`ring-*`、`fill-*`… | `--color-brand-500` → `bg-brand-500` |
| `--font-*`                                            | `font-*` 字体族                                   | `--font-poppins` → `font-poppins`    |
| `--text-*`                                            | `text-*` 字号                                     | `--text-2xs` → `text-2xs`            |
| `--font-weight-*`                                     | `font-*` 字重                                     | `--font-weight-heavy` → `font-heavy` |
| `--tracking-*` / `--leading-*`                        | 字距 / 行高                                       | `--leading-relaxed`                  |
| `--breakpoint-*`                                      | 响应式变体                                        | `--breakpoint-3xl` → `3xl:*`         |
| `--container-*`                                       | `max-w-*` 与容器查询变体 `@*`                     | `--container-8xl`                    |
| `--spacing-*`                                         | 间距/尺寸刻度                                     | `--spacing` 是全局基准值             |
| `--radius-*`                                          | `rounded-*`                                       | `--radius-4xl`                       |
| `--shadow-*` / `--inset-shadow-*` / `--drop-shadow-*` | 阴影族                                            | `--shadow-glow`                      |
| `--blur-*`、`--aspect-*`、`--ease-*`                  | 模糊、宽高比、缓动                                | `--ease-spring`                      |
| `--animate-*`                                         | `animate-*`                                       | `--animate-fade-in`                  |

**默认主题也是这么来的**：`bg-red-500`、`shadow-md`、`font-sans` 之所以存在，是因为 Tailwind 自带的 `theme.css` 里定义了 `--color-red-500`、`--shadow-md`、`--font-sans`。它们不是硬编码进框架的，只是官方给你的一套默认 token。你在自己的 `@theme` 里定义同名变量即覆盖，定义新名字即扩展。

## 8.3 定制主题的四档操作

### ① 扩展：加新值，默认值保留

```css
@import "tailwindcss";

@theme {
  --font-script: Great Vibes, cursive;
  --color-brand-500: oklch(0.62 0.19 259);
}
```

`font-script`、`bg-brand-500` 可用，`font-sans`、`bg-red-500` 等照常存在。

### ② 覆盖：改默认值

```css
@theme {
  --breakpoint-sm: 30rem; /* sm: 变体改在 480px 触发 */
}
```

### ③ 清空一个命名空间再重建

```css
@theme {
  --color-*: initial; /* 干掉整个默认色板：red/orange/…全部消失 */
  --color-white: #fff;
  --color-purple: #3f3cbb;
  --color-midnight: #121063;
  --color-tahiti: #3ab7bf;
  --color-bermuda: #78dcca;
}
```

之后项目里只有 `bg-midnight`、`text-tahiti` 这些自定义颜色，`bg-red-500` 直接不再生成——**从源头杜绝团队成员使用色板外的颜色**，这是设计约束的工程化手段。

### ④ 全部清空，完全自定义主题

```css
@theme {
  --*: initial; /* 连间距、字号、阴影的默认值都清掉 */
  --spacing: 4px; /* 重建间距基准：p-1=4px, p-2=8px… */
  --font-body: Inter, sans-serif;
  --color-lagoon: oklch(0.72 0.11 221.19);
  --color-coral: oklch(0.74 0.17 40.24);
  --color-driftwood: oklch(0.79 0.06 74.59);
  --color-tide: oklch(0.49 0.08 205.88);
  --color-dusk: oklch(0.82 0.15 72.09);
}
```

适合品牌感极强、自带完整设计系统的产品。日常项目用 ①②③ 就够。

## 8.4 语义颜色层：设计 token 的正确分层

第 7 章已经用过这个模式，这里给出完整的分层理论。健壮的主题有**两层**：

```
第一层：原始色板（primitive）      --color-blue-600、--color-gray-900 …
        "这些颜色是什么"
                    │ 被引用
                    ▼
第二层：语义 token（semantic）     --color-surface、--color-text-muted、--color-accent …
        "这些颜色用在哪、表达什么"
                    │ 被使用
                    ▼
组件层：bg-surface、text-text-muted
        "只谈用途，不谈具体颜色"
```

完整的语义层示例（可直接作为项目模板）：

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));

/* 第一层 + 中间变量：亮暗两套原始值 */
:root {
  --app-bg: var(--color-gray-100);
  --app-surface: var(--color-white);
  --app-surface-raised: var(--color-gray-50);
  --app-text: var(--color-gray-900);
  --app-text-muted: var(--color-gray-500);
  --app-border: var(--color-gray-200);
  --app-accent: var(--color-blue-600);
  --app-accent-hover: var(--color-blue-700);
  --app-accent-soft: var(--color-blue-100);
  --app-accent-contrast: var(--color-white);
  --app-danger: var(--color-red-600);
  --app-danger-soft: var(--color-red-100);
}
.dark {
  --app-bg: var(--color-gray-950);
  --app-surface: var(--color-gray-900);
  --app-surface-raised: var(--color-gray-800);
  --app-text: var(--color-gray-100);
  --app-text-muted: var(--color-gray-400);
  --app-border: var(--color-gray-700);
  --app-accent: var(--color-blue-500);
  --app-accent-hover: var(--color-blue-400);
  --app-accent-soft: oklch(from var(--color-blue-500) l c h / 15%);
  --app-accent-contrast: var(--color-white);
  --app-danger: var(--color-red-400);
  --app-danger-soft: oklch(from var(--color-red-400) l c h / 15%);
}

/* 第二层：注册为工具类。inline 是关键，见 8.5 */
@theme inline {
  --color-app-bg: var(--app-bg);
  --color-app-surface: var(--app-surface);
  --color-app-surface-raised: var(--app-surface-raised);
  --color-app-text: var(--app-text);
  --color-app-text-muted: var(--app-text-muted);
  --color-app-border: var(--app-border);
  --color-app-accent: var(--app-accent);
  --color-app-accent-hover: var(--app-accent-hover);
  --color-app-accent-soft: var(--app-accent-soft);
  --color-app-accent-contrast: var(--app-accent-contrast);
  --color-app-danger: var(--app-danger);
  --color-app-danger-soft: var(--app-danger-soft);
}
```

组件层的写法（对照第 7 章 TaskBoard）：

```html
<button
  class="rounded-lg bg-app-accent px-4 py-2 font-medium text-app-accent-contrast
               hover:bg-app-accent-hover focus-visible:outline-2 focus-visible:outline-app-accent"
>
  新建任务
</button>
```

**收益**：品牌色从蓝换成紫？改 `--app-accent` 一个变量，全站按钮、链接、焦点环同时更新。深色模式调整？只动 `.dark` 块。组件代码一行不改。这就是"设计 token 与语义颜色，而不是散落硬编码色值"的完整含义。

> 命名建议：语义名要反映**用途**（surface/text/accent/danger），不要反映外观（不要叫 `--color-dark-gray`）。语义层的规模控制在 15~30 个 token，太多说明抽象粒度不对。

## 8.5 @theme inline 与 static：两个必懂的选项

### inline：变量引用变量时必须用

普通 `@theme` 中，生成的工具类会**引用主题变量**：

```css
@theme {
  --color-primary: var(--app-accent);
}
/* 生成：.bg-primary { background-color: var(--color-primary); } */
/* 而 --color-primary 在 :root 解析，此时 --app-accent 若定义在 .dark 上则解析不到 */
```

第 1 章讲过：`var()` 在**变量定义处**解析。`--color-primary` 定义在 `:root`，但 `--app-accent` 在 `.dark` 上才有深色值——引用链断了。`inline` 让工具类**直接内联最终表达式**：

```css
@theme inline {
  --color-primary: var(--app-accent);
}
/* 生成：.bg-primary { background-color: var(--app-accent); } */
/* 在使用元素的上下文解析，.dark 的值能正确生效 ✓ */
```

**规则**：语义 token 这类"引用了随上下文变化的变量"的定义，一律 `@theme inline`。

### static：强制输出全部变量

默认只有**被用到**的主题变量才会输出到最终 CSS（体积优化）。如果某些变量需要在运行时被 JS 读取、或在 Tailwind 看不到的地方使用，用 `static` 强制全量输出：

```css
@theme static {
  --color-primary: var(--color-red-500);
  --color-secondary: var(--color-blue-500);
}
```

## 8.6 除颜色外：排版、间距、阴影、动画 token

### 字体与字号

```css
@theme {
  /* 自定义字体族：font-display、font-body 两个字体角色 */
  --font-display: "Satoshi", ui-sans-serif, system-ui, sans-serif;
  --font-body: "Inter", ui-sans-serif, system-ui, sans-serif;

  /* 自定义字号，--text-*--line-height 同时指定配套行高 */
  --text-2xs: 0.625rem;
  --text-2xs--line-height: calc(0.875 / 0.625);
}
```

```html
<h1 class="font-display text-2xs">…</h1>
```

引入 Web 字体：正常用 `@font-face` 或字体 CDN，然后 token 引用字体名即可。

### 间距基准

```css
@theme {
  --spacing: 0.25rem; /* 默认值。改成 0.2rem 则 p-1=0.2rem、p-5=1rem，整个刻度重排 */
}
```

一般不动它；它解释了第 4 章"数字 × 4 = px"的来源。

### 阴影、圆角、缓动、动画

```css
@theme {
  --shadow-glow: 0 0 1.5rem oklch(from var(--color-blue-500) l c h / 40%);
  --radius-4xl: 2rem;
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* 动画：--animate-* + @keyframes 定义在 @theme 内部，随用随打包 */
  --animate-fade-in-up: fade-in-up 0.4s var(--ease-out) both;

  @keyframes fade-in-up {
    from {
      opacity: 0;
      transform: translateY(1rem);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
}
```

```html
<div
  class="animate-fade-in-up shadow-glow rounded-4xl transition-transform ease-spring"
></div>
```

（希望某组 `@keyframes` 无论是否被引用都输出，把 `@keyframes` 写在 `@theme` 外面即可。）

## 8.7 主题变量的消费端：自定义 CSS、任意值与 JS

主题变量编译后就是普通 CSS 变量（输出在 `:root`），四处可用：

### ① 自定义 CSS（样式化不受你控制的 HTML，如 Markdown 内容）

```css
@layer components {
  .typography {
    p {
      font-size: var(--text-base);
      color: var(--color-gray-700);
    }
    h1 {
      font-size: var(--text-2xl--line-height); /* 字号 token 连行高都带 */
      font-weight: var(--font-weight-semibold);
      color: var(--color-gray-950);
    }
  }
}
```

这是 `@layer components` 的正当用途：**给无法挂类名的 HTML 上样式**（富文本、第三方渲染的内容），但值全部来自 token。

### ② 任意值与 calc

```html
<div class="absolute inset-px rounded-[calc(var(--radius-xl)-1px)]">
  <!-- 嵌套圆角=外层圆角-内缩距离，保持同心圆角——token 参与运算 -->
</div>
```

### ③ JavaScript

```jsx
// 直接引用变量名（推荐，零成本）
<motion.div animate={{ backgroundColor: "var(--color-blue-500)" }} />;

// 需要解析后的具体值时
const styles = getComputedStyle(document.documentElement);
const shadow = styles.getPropertyValue("--shadow-xl");
```

> v3 的 `resolveConfig` JS API 在 v4 已移除——官方态度很明确：**JS 需要主题值时，用 CSS 变量，别把主题打包进 JS**。

## 8.8 跨项目共享主题

主题就是一个 CSS 文件，共享 = 复用文件：

```
packages/
  brand/
    theme.css        ← @theme { … } 只有 token，不含业务
  admin/
    app.css          ← @import "tailwindcss"; @import "../brand/theme.css";
  marketing/
    app.css          ← 同上
```

monorepo 里直接相对路径 import，或者把 `brand` 发布成 npm 包后 `@import "@acmecorp/brand/theme.css"`。设计系统改版 → 发一个新版本的 theme.css → 所有项目升级依赖即同步。

## 8.9 实战：为 TaskBoard 建立正式主题文件

把第 7 章临时写的变量整理成正式的 `theme.css`（放在 `src/theme.css`）：

```css
/* src/theme.css —— TaskBoard 设计 token，唯一的颜色事实来源 */
@custom-variant dark (&:where(.dark, .dark *));

:root {
  --app-bg: var(--color-gray-100);
  --app-surface: var(--color-white);
  --app-surface-raised: var(--color-gray-50);
  --app-text: var(--color-gray-900);
  --app-text-muted: var(--color-gray-500);
  --app-border: var(--color-gray-200);
  --app-accent: var(--color-blue-600);
  --app-accent-hover: var(--color-blue-700);
  --app-accent-contrast: var(--color-white);
}
.dark {
  --app-bg: var(--color-gray-950);
  --app-surface: var(--color-gray-900);
  --app-surface-raised: var(--color-gray-800);
  --app-text: var(--color-gray-100);
  --app-text-muted: var(--color-gray-400);
  --app-border: var(--color-gray-700);
  --app-accent: var(--color-blue-500);
  --app-accent-hover: var(--color-blue-400);
  --app-accent-contrast: var(--color-white);
}

@theme inline {
  --color-app-bg: var(--app-bg);
  --color-app-surface: var(--app-surface);
  --color-app-surface-raised: var(--app-surface-raised);
  --color-app-text: var(--app-text);
  --color-app-text-muted: var(--app-text-muted);
  --color-app-border: var(--app-border);
  --color-app-accent: var(--app-accent);
  --color-app-accent-hover: var(--app-accent-hover);
  --color-app-accent-contrast: var(--app-accent-contrast);

  /* 非颜色 token 一并集中管理 */
  --font-display: "Inter", ui-sans-serif, system-ui, sans-serif;
  --shadow-card: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-card-hover:
    0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
}
```

```css
/* src/index.css —— 入口只剩装配 */
@import "tailwindcss";
@import "./theme.css";
```

然后做一次全项目"色值审计"：搜索 `gray-`、`blue-`、`white` 等直接使用默认色板的地方，逐个判断——**属于"界面基底"的（背景、文字、边框）替换为 app-\* 语义 token；属于"状态语义"的（进行中标签的琥珀色、成功绿色）可以保留色板类 + dark 微调**。审计完成后，`theme.css` 成为唯一需要维护的颜色入口。

## 本章小结与自检

- [ ] 能解释主题变量的三重身份：生成工具类、输出 CSS 变量、充当设计 token；
- [ ] 知道 `@theme` 与 `:root` 的分工，能列出至少 6 个命名空间及其对应工具类；
- [ ] 会做扩展 / 覆盖 / `--color-*: initial` 清空重建 / `--*: initial` 完全自定义四档操作；
- [ ] 能画出"原始色板 → 语义 token → 组件"三层结构，并说出语义 token 的命名原则（用途而非外观）；
- [ ] 理解 `@theme inline` 解决的变量解析问题，知道何时必须用；
- [ ] 会在自定义 CSS、任意值 calc、JS（getComputedStyle）中消费主题变量；
- [ ] 知道主题文件可以独立成包跨项目共享；
- [ ] TaskBoard 已有独立 theme.css，并完成色值审计。

---

> 上一章：[第 7 章 深色模式](./07-dark-mode.md) | 返回目录：[README](./README.md) | 下一章：[第 9 章 className 管理与组件化](./09-classname-management-and-components.md)
