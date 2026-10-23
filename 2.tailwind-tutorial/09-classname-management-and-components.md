# 第 9 章：className 管理与组件化

> 上一章：[第 8 章 主题令牌与设计系统](./08-theme-and-design-tokens.md) | 返回目录：[README](./README.md) | 下一章：[第 10 章 版本差异、综合实战与验收清单](./10-v3-vs-v4-and-final-project.md)

前面几章解决了"怎么写样式"，本章解决"怎么组织样式代码"：类名的条件组合、可复用组件的 API 设计、样式职责划分，以及 Tailwind 最著名的大坑——**动态拼接的类名不会生效**。这些是从"会用 Tailwind"到"能维护 Tailwind 项目"的关键一跃。

## 9.1 className 条件组合

### 基本手法：模板字符串与三元表达式

```jsx
function Sidebar({ isOpen }) {
  return (
    <aside
      className={`fixed inset-y-0 left-0 w-64 bg-app-surface transition-transform
                  ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
    >
      {/* … */}
    </aside>
  );
}
```

铁律（第 1、3 章反复强调过）：**互斥的类必须放在三元表达式的两个分支里，任何时刻只让一个生效**。`${isOpen ? "translate-x-0" : "-translate-x-full"}` 是对的；`translate-x-0 ${!isOpen && "-translate-x-full"}` 这种"叠加冲突类"的写法，生效与否取决于样式表顺序而不是你的代码顺序，是 bug 之源。

多条件时，三元嵌套很快失控，用**数组过滤**保持扁平：

```jsx
function Badge({ tone = "neutral", dot = false, size = "md", className }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full font-medium",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        dot && "before:size-1.5 before:rounded-full before:bg-current",
        tone === "success" &&
          "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
        tone === "danger" &&
          "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
        tone === "neutral" &&
          "bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300",
        className, // 外部覆盖放最后（见 9.2 的冲突说明）
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* … */}
    </span>
  );
}
```

### 团队规模大了：引入 class 合并库

手写数组有两个痛点：忘记过滤产生 `"false"` 字符串、外部传入的类与内部类冲突时**谁赢不可控**（取决于样式表顺序，不是书写顺序）。社区标准解法是两个小库：

```bash
npm install clsx tailwind-merge
```

```jsx
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

// clsx：把对象/数组/条件表达式安全地拼成类名字符串
// twMerge：识别 Tailwind 类的"组"，后写的覆盖先写的（真正的后者胜出）
function cn(...inputs) {
  return twMerge(clsx(inputs));
}

function Button({ variant = "primary", size = "md", className, ...props }) {
  return (
    <button
      className={cn(
        // 基础样式
        "inline-flex items-center justify-center rounded-lg font-medium transition",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent",
        "disabled:pointer-events-none disabled:opacity-50",
        // 变体：对象写法，key 为条件
        {
          "bg-app-accent text-app-accent-contrast hover:bg-app-accent-hover":
            variant === "primary",
          "border border-app-border bg-app-surface text-app-text hover:bg-app-surface-raised":
            variant === "secondary",
          "text-app-danger hover:bg-app-danger-soft": variant === "danger",
        },
        {
          "px-3 py-1.5 text-sm": size === "sm",
          "px-4 py-2.5 text-sm": size === "md",
          "px-5 py-3 text-base": size === "lg",
        },
        className,
      )}
      {...props}
    />
  );
}
```

`twMerge` 的魔法：`cn("px-4 py-2", "px-2")` 返回 `"py-2 px-2"`——它知道两个 `px-*` 冲突，保留后者。这样组件消费者传 `className="px-8"` 就能**可靠地**覆盖内部默认值，解决了 9.2 要讲的冲突问题。

> 使用建议：小项目/静态页面手写模板字符串完全够；做组件库或多人协作项目，第一天就把 `cn()` 工具函数立起来，全项目统一走它。

## 9.2 样式冲突：组件消费者传类名进来会发生什么

复习问题本质：`<Button className="bg-red-500" />`，内部有 `bg-app-accent`，两个类同特异性，**样式表中靠后的赢，而 Tailwind 生成顺序你不可控**（按属性组固定排序，与 class 属性书写顺序无关）。

三种应对，按推荐度排序：

### 方案 A（官方最推荐）：暴露语义化 props，不暴露类名

官方文档的原话精神：组件化框架下，**优先为样式定制暴露明确的 props**，而不是让消费者从外面塞类名——因为外部类名常常与内部冲突。

```jsx
// ✅ 消费者表达"意图"，组件内部负责翻译成类名
<Button variant="danger" size="lg">删除</Button>

// ⚠️ 消费者表达"实现"，冲突与失控的开始
<Button className="bg-red-600 px-8 text-lg">删除</Button>
```

变体（variant）体系就是组件的**样式 API**：枚举有限的合法组合，非法组合从类型上就不存在。

### 方案 B：仍接收 className，但用 twMerge 保证覆盖语义

有些定制无法穷举成 props（比如一次性地把某处按钮的外边距改掉）。保留 `className` 逃生舱 + `cn()`（9.1 的模式），让"外部传的类总是赢"成为**明确契约**。组件库里这是事实标准。

### 方案 C：核选项（了解即可）

- 单个类强制生效：`bg-red-500!`（v4 把 `!` 放**末尾**）；
- 整个项目所有工具类 `!important`：`@import "tailwindcss" important;`——用于给遗留 CSS 大盘渐进上 Tailwind 的过渡期；
- 类名加前缀避免与现有 CSS 撞名：`@import "tailwindcss" prefix(tw);`，之后所有类写作 `tw:flex tw:hover:bg-red-600`（v4 的前缀像变体一样放在最前面；v3 是 `tw-flex` 后缀式写法）。

三者都是"与遗留系统共存"或"极端情况"的工具，正常组件开发用 A + B。

## 9.3 样式职责划分：什么样式写在哪里

一个健康的 Tailwind 项目，样式分布在四个层次，各司其职：

| 层次           | 位置                               | 负责                                              | 例子                                       |
| -------------- | ---------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| **设计 token** | `theme.css`（`@theme` / `:root`）  | 颜色、字体、圆角、阴影等一切"值"                  | `--color-app-accent`                       |
| **全局基线**   | `index.css`（`@layer base`）       | 元素级默认：body 底色、标题默认字号、焦点样式兜底 | `body { @apply bg-app-bg text-app-text; }` |
| **可复用组件** | 组件文件（React/Vue/模板 partial） | 结构与样式的封装单元，样式 API（variant props）   | `<Button>`、`<TaskCard>`                   |
| **页面/局部**  | 页面 JSX 的 className              | 一次性布局与微调                                  | `mt-8 grid gap-4 md:grid-cols-2`           |

配套的判断准则：

1. **布局属于父级**：`<TaskCard>` 自己不要带 `mt-4` 或 `w-1/3`——间距和网格位置由使用它的父容器决定（`grid gap-4` / `flex flex-col gap-4`）。这样组件放进任何布局都不用改；
2. **外观属于组件**：卡片内部的圆角、内边距、字体，组件自己管；
3. **值属于 token**：组件里出现第三个 `bg-[#…]` 硬编码色值时，就是该去 `theme.css` 注册 token 的信号；
4. **base 层保持极简**：只放真正全局的默认。把组件样式塞进 `@layer base`、或在 CSS 文件里堆一堆 `.my-page-header` 类，是退回传统 CSS 老路的开始。

### @apply 的使用边界

v4 依然支持 `@apply`，正当用途基本只剩一个：**给你控制不了的 HTML 上样式**（Markdown 渲染结果、第三方脚本注入的 DOM）：

```css
@layer components {
  .prose-custom h2 {
    @apply mt-8 text-xl font-semibold text-app-text;
  }
}
```

如果你发现自己大量用 `@apply` 把工具类串搬进 CSS 文件"让 HTML 清爽一点"——停下来，那通常意味着该提取的是**组件**而不是 CSS 类（第 3 章 3.6）。v4 中还有更优选择：直接引用主题变量（`color: var(--color-app-text)`），不经过 `@apply`，构建更快。另外注意：Vue/Svelte 的单文件 `<style>` 块、CSS Modules 这类**独立打包的样式文件**默认访问不到主题变量，需要 `@reference "../../app.css";` 显式引入定义。

## 9.4 动态类名陷阱：构建工具"看不见"的类不会存在

这是 Tailwind 项目最经典、最让新手困惑的 bug：**类名明明在 DOM 上，样式就是不出现**。

### 原理回顾

第 2 章讲过：Tailwind 在**构建时**把源文件当纯文本扫描，找出所有"看起来像类名"的完整字符串，为它们生成 CSS。它不解析你的 JS/模板语法，**看不懂任何运行时拼接**。扫描到不认识的 token 就丢弃，扫不到的 token 就当不存在。

### 反面教材（全部不工作）

```html
<!-- ❌ 模板插值拼接：源文件里不存在 "text-red-600" 这个完整字符串 -->
<div class="text-{{ error ? 'red' : 'green' }}-600"></div>
```

```jsx
// ❌ props 拼接：源文件里只有 "bg-"、"-600" 等碎片
function Button({ color, children }) {
  return (
    <button className={`bg-${color}-600 hover:bg-${color}-500`}>
      {children}
    </button>
  );
}
```

```jsx
// ❌ 数据库/CMS 驱动的类名：构建时文件里根本没有这些字符串
const settings = await fetch("/api/settings"); // { buttonClass: "bg-teal-500" }
<button className={settings.buttonClass}>…</button>;
```

判断口诀：**在源文件里全文搜索这个完整类名，搜不到，样式就一定不生成**。DOM 检查看到类名没用——CSS 文件里没有对应规则。

### 正确姿势一：完整类名 + 明确映射（官方标准方案）

把"值 → 完整类名"的映射写死在源码里：

```jsx
// ✅ 每个类名都以完整字符串形式存在于源文件
function Button({ color, children }) {
  const colorVariants = {
    blue: "bg-blue-600 hover:bg-blue-500 text-white",
    red: "bg-red-600 hover:bg-red-500 text-white",
    yellow: "bg-yellow-300 hover:bg-yellow-400 text-black",
  };
  return <button className={`${colorVariants[color]} ...`}>{children}</button>;
}
```

好处不止是"能工作"：映射表本身成了组件的样式 API 文档，还能对不同值配不同深浅（yellow 配黑字，blue 配白字）——拼接写法根本做不到。

条件类名同理，用 9.1 的三元/对象写法，每个分支都是完整类名。

### 正确姿势二：运行时动态值 → 内联样式 / CSS 变量

值真正来自运行时（API 返回 `#3f3cbb`），映射表不可能穷举时，回到第 3 章 3.3 的方案：内联样式，或"内联样式设 CSS 变量 + 工具类消费变量"（后者能保留 hover 等状态能力）。

### 正确姿势三：safelist——`@source inline()`

少数场景类名确实无法出现在源文件中（比如 CMS 富文本里允许运营填 Tailwind 类名），v4 用 `@source inline()` 强制生成（v3 是 JS 配置里的 `safelist` 数组）：

```css
@import "tailwindcss";

/* 强制生成单个类 */
@source inline("underline");

/* 带变体：花括号展开，生成 hover:underline 和 focus:underline */
@source inline("{hover:,focus:,}underline");

/* 批量：整个 red 色板的背景类 + hover 变体，支持范围语法 */
@source inline("{hover:,}bg-red-{50,{100..900..100},950}");

/* 反向操作：即使源码里出现了也排除掉 */
@source not inline("{hover:,focus:,}bg-red-{50,{100..900..100},950}");
```

**克制使用**：safelist 是"我确认这些类会在运行时出现"的兜底声明，每加一条都是体积成本。优先级永远是：完整类名映射 > 内联样式/CSS 变量 > safelist。

### 相关：控制扫描范围

```css
/* 显式注册默认被忽略的扫描源（.gitignore 内的内部组件库） */
@source "../node_modules/@acmecorp/ui-lib";

/* 排除确定不含类名的大目录，加快构建 */
@source not "../src/components/legacy";

/* monorepo：指定扫描基准路径 */
@import "tailwindcss" source("../src");

/* 完全手动控制：关闭自动探测，只扫描显式注册的源 */
@import "tailwindcss" source(none);
@source "../admin";
@source "../shared";
```

多份样式表各自服务不同子应用时，`source(none)` + 显式 `@source` 能保证每份 CSS 只含自己那部分类。

## 9.5 可复用组件 API 设计：一个完整的示范

综合本章全部内容，给出 TaskBoard 的核心组件 `<TaskCard>` 的成品级实现，注意每个设计决策：

```jsx
import { cn } from "../lib/cn";

const TONE_STYLES = {
  todo: "bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300",
  doing: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  done: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
};

const TONE_LABELS = { todo: "待办", doing: "进行中", done: "已完成" };

/**
 * TaskCard —— 任务卡片
 * 职责：卡片内部的结构与外观。
 * 不负责：外部布局（间距/网格位置由父容器决定）、数据来源。
 */
export function TaskCard({ task, priority = "normal", onSelect, className }) {
  return (
    <article
      // 布局无关的外观全部内聚；className 作为受控逃生舱，经 cn() 保证覆盖语义
      className={cn(
        "group rounded-xl border border-app-border bg-app-surface p-5 shadow-card",
        "transition hover:-translate-y-0.5 hover:shadow-card-hover",
        "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-app-accent",
        "motion-reduce:hover:translate-y-0",
        priority === "high" && "border-l-4 border-l-app-danger",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold leading-snug text-app-text group-hover:text-app-accent">
          <button
            type="button"
            onClick={() => onSelect?.(task.id)}
            className="text-left"
          >
            {task.title}
          </button>
        </h3>
        {/* 状态徽标：tone → 完整类名映射（9.4 姿势一），文案映射分离 */}
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
            TONE_STYLES[task.tone],
          )}
        >
          {TONE_LABELS[task.tone]}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 text-sm text-app-text-muted">
        {task.summary}
      </p>

      <footer className="mt-4 flex items-center justify-between border-t border-app-border pt-4">
        <div className="flex -space-x-2">
          {task.assignees.map((user) => (
            // 循环渲染：类名只写一次（第 3 章策略一）
            <img
              key={user.id}
              src={user.avatarUrl}
              alt={user.name}
              className="size-7 rounded-full ring-2 ring-app-surface"
            />
          ))}
        </div>
        <time dateTime={task.dueDate} className="text-xs text-app-text-muted">
          {task.dueDateLabel} 截止
        </time>
      </footer>
    </article>
  );
}
```

对照检查清单（这就是"可复用组件 API 与样式职责划分"的验收标准）：

- [x] **布局外置**：组件内无 margin/宽度，父容器用 `grid gap-4 md:grid-cols-2 lg:grid-cols-3` 摆放；
- [x] **样式 API 枚举化**：`priority` 只接受有限值，每个值映射**完整类名**；
- [x] **受控逃生舱**：`className` 经 `cn()` 合并，外部覆盖行为可预期；
- [x] **token 化颜色**：基底颜色全部走 `app-*` 语义 token（第 8 章），状态色保留色板 + dark 微调；
- [x] **可访问性**：真正的 `<button>` 承载交互、`<time dateTime>` 语义时间、`focus-within` 焦点可见、`motion-reduce` 尊重系统设置；
- [x] **状态内聚**：hover 抬升、group 联动全部封装在组件内，消费者无感知。

## 练习

1. 把第 5 章 TaskBoard 的静态卡片重构为上面的 `<TaskCard>` 组件（无框架就用模板函数/模板 partial），父页面改用 `grid gap-4 md:grid-cols-2 lg:grid-cols-3` 摆放；
2. 给 `<TaskCard>` 增加 `density="compact" | "cozy"` prop：compact 隐藏摘要行、减小内边距——用完整类名映射实现；
3. 故意写一个 `bg-${color}-500` 的拼接组件，在 DevTools 里确认类名在 DOM 上但 CSS 里无规则，体会一遍这个 bug 的排查过程；
4. 安装 `clsx + tailwind-merge`，封装自己的 `cn()`，验证 `cn("p-4", "p-2")` 输出 `"p-2"`。

## 本章小结与自检

- [ ] 条件组合：互斥类放三元分支；多条件用数组/对象 + `filter(Boolean)`；团队项目统一 `cn()`（clsx + tailwind-merge）；
- [ ] 理解类冲突的本质（样式表顺序决定胜负），掌握三级应对：语义 props > className + twMerge > `!`/important/prefix 核选项；
- [ ] 能说出四层样式职责（token / base / 组件 / 页面局部）与"布局归父级、外观归组件、值归 token"三原则；
- [ ] 知道 `@apply` 的边界（不受控 HTML），知道独立打包样式文件需要 `@reference`；
- [ ] **能向同事解释为什么动态拼接类名不生效**，并给出三种正解（完整映射 / 内联变量 / `@source inline()` safelist）及其优先级；
- [ ] 会用 `@source` / `source()` 控制扫描范围；
- [ ] 完成 TaskCard 组件化实战，对照六项检查清单逐条通过。

---

> 上一章：[第 8 章 主题令牌与设计系统](./08-theme-and-design-tokens.md) | 返回目录：[README](./README.md) | 下一章：[第 10 章 版本差异、综合实战与验收清单](./10-v3-vs-v4-and-final-project.md)
