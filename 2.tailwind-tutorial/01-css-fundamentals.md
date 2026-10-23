# 第 1 章：基础 CSS——学 Tailwind 之前必须懂的事

> 上一章：[返回目录](./README.md) | 下一章：[第 2 章 环境搭建](./02-setup-first-project.md)

一个常见的误解是"用了 Tailwind 就不用学 CSS 了"。**恰恰相反**：Tailwind 的每一个类名都是一条 CSS 声明的缩写，你必须知道它背后发生了什么才能用好它。官方文档的原话精神是——utility 不会替代语义、可访问性和层叠模型。

这一章是"自检清单"，如果你对这些概念已经熟悉，可以快速过一遍确认理解到位，然后直接进入第 2 章。

## 1.1 层叠模型（Cascade）：为什么这条样式生效了？

浏览器决定"一个元素最终应用哪条 CSS 声明"时，按以下优先级依次判断：

1. **声明来源与重要性**：`!important` 的用户代理样式 > `!important` 的用户样式 > `!important` 的作者样式 > 普通作者样式 > …（日常开发主要关心"作者样式"这一层）；
2. **特异性（Specificity）**：选择器越具体，优先级越高；
3. **书写顺序**：前两者都相同时，**后出现的声明赢**。

### 特异性怎么算

特异性是一个三元组 `(a, b, c)`：

| 选择器         | a（ID 数） | b（类/属性/伪类数） | c（元素/伪元素数） |
| -------------- | ---------- | ------------------- | ------------------ |
| `div`          | 0          | 0                   | 1                  |
| `.card`        | 0          | 1                   | 0                  |
| `.card .title` | 0          | 2                   | 0                  |
| `#app .card`   | 1          | 1                   | 0                  |
| `#app #main`   | 2          | 0                   | 0                  |

比较时先比 a，a 相同再比 b，以此类推。所以 `#app`（1,0,0）永远压过 `.a.b.c`（0,3,0）。

### 这与 Tailwind 有什么关系？

Tailwind 的 utility 类全部是**单个类选择器**，特异性都是 `(0,1,0)`，完全平等。当两个类作用于同一个 CSS 属性时，**谁赢由它们在生成的样式表里的顺序决定，而不是它们在 `class` 属性里的书写顺序**。看这个官方文档中的例子：

```html
<!-- 你以为 flex 在后面会赢？错。 -->
<div class="grid flex"><!-- ... --></div>
```

```css
/* Tailwind 生成的样式表中 display 类的排列顺序是固定的 */
.flex {
  display: flex;
}
.grid {
  display: grid;
}
```

`.grid` 在样式表里排在 `.flex` 后面，所以元素最终是 `display: grid`，**尽管 `flex` 写在 class 属性的最后**。

**新手结论**：永远不要给同一个元素同时加两个作用于同一属性的冲突类（如 `grid` + `flex`、`p-4` + `p-8`）。这是第 9 章"className 管理"的核心议题，先记住这个现象。

## 1.2 @layer 级联层：Tailwind v4 的样式分层

CSS 原生提供了 `@layer` 规则，可以把样式分组，**组的顺序决定优先级，组内再按正常规则比较**。Tailwind v4 完全构建在原生 `@layer` 之上，导入 `tailwindcss` 时实际引入的是：

```css
@layer theme, base, components, utilities;

@import "./theme.css" layer(theme); /* 主题变量 */
@import "./preflight.css" layer(base); /* 重置样式 */
@import "./utilities.css" layer(utilities); /* 工具类 */
```

四层的优先级从低到高：

```
theme  <  base  <  components  <  utilities
```

这意味着：

- 你写在 `utilities` 层的工具类（`p-4`、`bg-red-500`）**永远能覆盖** base 层的默认样式；
- 你用 `@layer components` 定义的自定义组件类（如 `.btn-primary`）会被工具类覆盖——这正是我们想要的："组件给默认值，工具类做局部微调"；
- 一个反直觉的点：**分层的优先级高于特异性**。即使某个未分层（unlayered）的 CSS 用了 `#id` 选择器，它也会压过所有分层内的样式（未分层样式优先级最高）；而分层之间比较时，靠后的层赢，跟选择器特异性无关。

> v3 时代的 Tailwind "劫持"了 `@layer` 关键字做自己的事；v4 使用原生级联层，行为更符合 CSS 标准。这是新旧版本差异之一，第 10 章还会提到。

## 1.3 盒模型与 box-sizing

每个元素都是一个矩形盒子：

```
┌─────────────── margin（外边距，透明） ───────────────┐
│  ┌──────────── border（边框） ────────────┐          │
│  │  ┌──────── padding（内边距） ────────┐  │          │
│  │  │                                 │  │          │
│  │  │          content（内容）          │  │          │
│  │  │                                 │  │          │
│  │  └─────────────────────────────────┘  │          │
│  └────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────┘
```

- `box-sizing: content-box`（浏览器默认）：`width` 只算内容，实际占宽 = width + padding + border；
- `box-sizing: border-box`：`width` 包含 padding 和 border，**布局可预测得多**。

Tailwind 的 Preflight 已全局设置 `box-sizing: border-box`，所以你在 Tailwind 项目里写 `w-64 p-4 border`，元素总宽就是 16rem，不用心算加法。这是"为什么 Tailwind 项目布局更好算"的底层原因之一。

## 1.4 CSS 自定义属性（CSS 变量）

Tailwind v4 的主题系统**完全建立在 CSS 变量上**，必须掌握这个语法：

```css
:root {
  --color-brand: #3f3cbb;
}

.button {
  background-color: var(--color-brand);
  /* 带后备值的用法 */
  color: var(--color-text, #333);
}
```

要点：

- 变量以 `--` 开头，用 `var()` 读取；
- 变量**沿 DOM 树继承**：在 `:root`（即 `<html>`）上定义，全页面可用；在某个 `div` 上定义，只有它的后代可用；
- 在 JS 里可以读写：`el.style.setProperty("--x", "1rem")`、`getComputedStyle(document.documentElement).getPropertyValue("--color-brand")`。

v4 中每个主题变量都会输出为真实的 CSS 变量，例如 `--color-red-500`、`--spacing`、`--text-xl`。所以你可以在任意自定义 CSS 甚至内联样式里直接引用设计 token：

```html
<div style="background-color: var(--color-mint-500)"></div>
```

这就是"设计 token 一处定义、处处可用"的技术基础，第 8 章会深入。

### 一个变量解析的坑（了解即可）

`var()` 是在**变量被定义的位置**解析的，不是在使用的位置。如果父元素定义了 `--font-sans: var(--font-inter)`，而 `--font-inter` 只在子元素上定义，那么父元素解析 `--font-sans` 时 `--font-inter` 还不存在，会回退到默认值。Tailwind 提供了 `@theme inline` 来处理这类引用（第 8 章详述）。

## 1.5 媒体查询基础

响应式变体（`md:flex`）本质是媒体查询的缩写，你必须能读懂它：

```css
/* 视口宽度 ≥ 48rem（768px）时生效 */
@media (width >= 48rem) {
  .md\:flex {
    display: flex;
  }
}
```

注意类名里的 `\:`——CSS 中冒号是特殊字符，出现在类名里必须转义。这解释了为什么你在 DevTools 里看到 Tailwind 生成的类名都带反斜杠，它们是同一个类的两种写法。

## 1.6 Preflight：Tailwind 的重置样式

`@import "tailwindcss"` 会在 `base` 层引入一份叫 **Preflight** 的现代 CSS 重置。它做了什么：

- 所有元素 `box-sizing: border-box`，`margin: 0`，`padding: 0`；
- `h1`~`h6`、`p`、`blockquote` 等**字号字重全部重置为与正文一致**——标题的视觉层级完全由你用 `text-2xl font-bold` 等工具类显式构建；
- 列表 `ul`/`ol` 去掉默认的圆点和编号（需要时用 `list-disc`/`list-decimal` 加回来）；
- `img`、`video` 等设为 `display: block`、`max-width: 100%`；
- 按钮在 v4 中默认 `cursor: default`（跟随浏览器行为，想要手型要自己加 `cursor-pointer`）；
- 边框默认颜色是 `currentColor`（v3 是 gray-200），所以写 `border` 时必须显式配 `border-gray-200` 之类的颜色。

**为什么新手觉得"Tailwind 项目里 h1 看起来不像标题"**——就是 Preflight 干的。这不是 bug，是设计：框架不替你决定标题长什么样，你的设计系统自己决定。

如果你想恢复某个默认行为，在 `base` 层加回去即可：

```css
@import "tailwindcss";

@layer base {
  button:not(:disabled),
  [role="button"]:not(:disabled) {
    cursor: pointer;
  }
}
```

## 1.7 utility 不能替代的三件事

先把结论立在这里，全书会反复回扣：

1. **语义化 HTML 不能被替代**。Tailwind 能做出一个"看起来像按钮的 div"，但它不会成为按钮：

   ```html
   <!-- 错误：视觉像按钮，语义不是按钮 -->
   <div class="rounded bg-blue-600 px-4 py-2 text-white">提交</div>

   <!-- 正确：语义、可访问性、样式各司其职 -->
   <button type="submit" class="rounded bg-blue-600 px-4 py-2 text-white">
     提交
   </button>
   ```

2. **可访问性（a11y）不能被替代**。`focus-visible` 样式、`aria-*` 属性、对比度、键盘可达性都是你的责任，不是框架的。第 6 章讲 `focus` 变体时会专门强调"永远不要简单粗暴地 `outline-none` 了事"。
3. **层叠模型不能被绕开**。类名冲突、特异性、层顺序这些 CSS 规则在 Tailwind 项目里照样起作用，1.1 和 1.2 讲的就是你排查"样式为什么没生效"时需要的知识。

## 本章小结与自检

- [ ] 能解释为什么 `<div class="grid flex">` 最终是 grid；
- [ ] 知道 Tailwind v4 的四层结构 `theme < base < components < utilities`，以及未分层样式优先级最高；
- [ ] 能读懂并书写 CSS 变量（`--x` / `var(--x)`），知道变量沿 DOM 继承；
- [ ] 能读懂 `@media (width >= 48rem)` 和类名中的 `\:` 转义；
- [ ] 知道 Preflight 会重置标题字号、列表符号、边框颜色，并能在 `@layer base` 中恢复需要的默认行为；
- [ ] 认同：语义 HTML、可访问性、层叠模型是 CSS 基本功，Tailwind 只是书写样式的"快捷方式"。

---

> 上一章：[返回目录](./README.md) | 下一章：[第 2 章 环境搭建：从 0 创建第一个项目](./02-setup-first-project.md)
