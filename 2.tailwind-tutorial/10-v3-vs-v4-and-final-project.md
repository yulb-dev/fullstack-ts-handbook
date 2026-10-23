# 第 10 章：版本差异、综合实战与验收清单

> 上一章：[第 9 章 className 管理与组件化](./09-classname-management-and-components.md) | 返回目录：[README](./README.md)

本章三件事：① 讲清 v4 CSS-first 配置与 v3 JS 配置的差异（以及"项目必须跟随所锁定主版本文档"为什么是铁律）；② 把 TaskBoard 补全为综合实战；③ 给出全教程的逐项验收清单。

## 10.1 v4 与 v3：配置范式的根本转变

### 一张表看懂两代配置

| 维度            | v3（JS 配置时代）                                                    | v4（CSS-first 时代）                                    |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| CSS 入口        | `@tailwind base; @tailwind components; @tailwind utilities;`         | `@import "tailwindcss";` 一行                           |
| 配置文件        | `tailwind.config.js`（theme、content、plugins、darkMode…全在 JS 里） | **默认不需要配置文件**，一切写在 CSS 里                 |
| 主题定制        | `theme.extend.colors = { brand: … }`（JS 对象）                      | `@theme { --color-brand-500: …; }`（CSS 变量）          |
| 扫描源          | `content: ["./src/**/*.{js,jsx}"]` 手动列举                          | 自动探测（gitignore 感知），`@source` / `source()` 微调 |
| 深色模式        | `darkMode: 'class'` 配置项                                           | `@custom-variant dark (&:where(.dark, .dark *));`       |
| safelist        | `safelist: [{ pattern: … }]`（JS 正则）                              | `@source inline("…")`（支持花括号展开与范围）           |
| 自定义工具类    | `@layer utilities { .tab-4 { … } }`（会被自动变体化）                | `@utility tab-4 { … }`（原生 `@layer` 不再被劫持）      |
| 自定义变体      | `plugin` API 写 JS                                                   | `@custom-variant name (selector);`                      |
| 浏览器前缀      | 需要 autoprefixer                                                    | 内置                                                    |
| CSS import 处理 | 需要 postcss-import                                                  | 内置                                                    |
| 引擎            | JS 实现                                                              | Oxide 引擎（Rust），构建大幅提速                        |
| JS 读主题       | `resolveConfig(config)`                                              | 已移除，直接用 CSS 变量 / `getComputedStyle`            |

### v3 配置文件在 v4 里怎么办？

JS 配置文件仍被支持（向后兼容），但**不再自动探测**，需要显式加载：

```css
@import "tailwindcss";
@config "../../tailwind.config.js";
```

且 v3 配置中的 `corePlugins`、`safelist`、`separator` 三个选项在 v4 不再支持（safelist 用 `@source inline()` 替代）。新项目没有理由再用 JS 配置；老项目升级可先 `@config` 挂住旧配置过渡，再逐步迁移到 CSS。

### 官方升级工具

存量 v3 项目升级，官方提供了自动迁移工具（需要 Node 20+），能处理依赖更新、配置迁移、模板文件类名改写的大部分工作：

```bash
npx @tailwindcss/upgrade
```

官方建议：在新分支上运行，仔细 review diff 并在浏览器里回归测试。

### 必须知道的 v4 破坏性变更（读旧教程/旧代码时的"翻译表"）

**① 浏览器基线提高**：v4 面向 Safari 16.4+、Chrome 111+、Firefox 128+，依赖 `@property`、`color-mix()` 等现代特性。要支持老浏览器就留在 v3.4。

**② 一批类改名了**（v3 代码直接搬到 v4 会"看起来不对"）：

| v3                 | v4                    | 说明                                                         |
| ------------------ | --------------------- | ------------------------------------------------------------ |
| `shadow-sm`        | `shadow-xs`           | 阴影刻度整体下移一档                                         |
| `shadow`           | `shadow-sm`           | 同上                                                         |
| `rounded-sm`       | `rounded-xs`          | 圆角同理                                                     |
| `rounded`          | `rounded-sm`          | 同上                                                         |
| `blur-sm` / `blur` | `blur-xs` / `blur-sm` | 模糊同理                                                     |
| `outline-none`     | `outline-hidden`      | 语义澄清：真正 `outline-style: none` 的新类叫 `outline-none` |
| `ring`             | `ring-3`              | 裸 `ring` 从 3px 改为 1px                                    |
| `bg-gradient-to-r` | `bg-linear-to-r`      | 渐变命名规范化（旧名仍兼容）                                 |

**③ 默认值变化**：

- 边框/分割线默认色：`gray-200` → `currentColor`（所以 v4 里 `border` 必须显式配色）；
- ring 默认色：`blue-500` → `currentColor`；
- 按钮默认光标：`pointer` → `default`；
- placeholder 颜色：`gray-400` → 当前文字色 50% 透明；
- `hidden` 属性优先于 display 类（`class="block"` 不再能强行显示 `hidden` 元素）。

**④ 语法变化**：

- important 修饰符从类名**前**移到**后**：`!flex` → `flex!`；
- 变量任意值从方括号改为圆括号：`bg-[--brand-color]` → `bg-(--brand-color)`；
- 堆叠变体从左到右应用（v3 从右到左）：`first:*:pt-0` → `*:first:pt-0`；
- `grid-cols-[max-content,auto]` 里的逗号不再自动变空格，必须写 `grid-cols-[max-content_auto]`；
- hover 变体只在支持悬停的设备生效（`@media (hover: hover)`）。

**⑤ 移除/替代**：

- `*-opacity-*` 系列全部删除 → 用 `/50` 透明度修饰符；
- `flex-shrink-*` / `flex-grow-*` → `shrink-*` / `grow-*`；
- `theme()` 函数 → 直接 `var(--color-red-500)`；仍需要的场合（媒体查询内）写法改为 `theme(--breakpoint-xl)`；
- `corePlugins` 禁用核心插件的能力取消；
- Sass/Less/Stylus 不再被支持处理 Tailwind 样式——**Tailwind 自己就是预处理器**；
- `space-between` / `divide` 选择器实现更换（修复大页面性能问题），配合行内元素或子元素自带 margin 的场景可能出现视觉差异，官方建议迁移到 `flex/grid + gap`。

### 为什么"跟随所锁定主版本文档"是铁律

你已经在教程里看到了原因：**同一个功能，两代版本的写法可能完全不同**（darkMode 配置 vs @custom-variant、safelist vs @source inline、`!flex` vs `flex!`）。社区教程、博客、AI 生成的代码大量停留在 v3 甚至 v2 语法，混用的结果是"部分类神秘失效"这类极难排查的问题。团队实践：

1. `package.json` 里锁定主版本（如 `"tailwindcss": "^4.3.0"`），升级主版本走正式评审；
2. 官方文档站左上角确认版本与项目一致再查；
3. 接手旧项目先跑 `npm ls tailwindcss` 确认版本，再决定用哪套语法。

## 10.2 综合实战：TaskBoard 完全体

把第 5~9 章的成果组装成完整项目。最终形态：响应式 + 深色模式三态切换 + 组件化 + 移动端菜单。项目结构（React + Vite 为例，其他框架同构）：

```
taskboard/
├── index.html               # head 内联防闪屏脚本（第 7 章 7.3）
├── src/
│   ├── main.jsx
│   ├── index.css            # @import "tailwindcss" + theme.css + base 层
│   ├── theme.css            # 全部设计 token（第 8 章 8.9）
│   ├── lib/
│   │   ├── cn.js            # clsx + tailwind-merge（第 9 章 9.1）
│   │   └── useTheme.js      # 三态主题 hook（第 7 章 7.3）
│   ├── components/
│   │   ├── AppHeader.jsx    # 两层骨架 + 移动端菜单 + 主题切换
│   │   ├── TaskCard.jsx     # 第 9 章 9.5 的成品组件
│   │   ├── StatsTable.jsx   # overflow-x-auto 响应式表格（第 5 章）
│   │   └── Button.jsx       # variant API 示范（第 9 章 9.1）
│   └── pages/
│       └── BoardPage.jsx    # 只做布局：grid gap-4 md:grid-cols-2 lg:grid-cols-3
└── vite.config.ts           # @tailwindcss/vite 插件
```

### 最后一块拼图：移动端导航菜单

第 5 章我们把移动端导航直接 `hidden` 了，现在补全。用 React state（生产做法）：

```jsx
import { useState } from "react";
import { cn } from "../lib/cn";

export function AppHeader({ theme, onThemeChange }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-b border-app-border bg-app-surface">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <span className="text-lg font-bold tracking-tight text-app-text">
          📋 TaskBoard
        </span>

        {/* 桌面导航：md 以上显示 */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="主导航">
          <a
            href="#"
            className="rounded-lg bg-app-surface-raised px-3 py-2 text-sm font-medium text-app-text"
          >
            看板
          </a>
          <a
            href="#"
            className="rounded-lg px-3 py-2 text-sm font-medium text-app-text-muted hover:bg-app-surface-raised hover:text-app-text"
          >
            日程
          </a>
          <a
            href="#"
            className="rounded-lg px-3 py-2 text-sm font-medium text-app-text-muted hover:bg-app-surface-raised hover:text-app-text"
          >
            报表
          </a>
        </nav>

        <div className="flex items-center gap-2">
          {/* 主题切换按钮（第 7 章 7.6） */}
          <ThemeToggle theme={theme} onChange={onThemeChange} />

          {/* 汉堡按钮：只在 md 以下显示，带完整可访问性属性 */}
          <button
            type="button"
            className="rounded-lg p-2 text-app-text-muted hover:bg-app-surface-raised
                       focus-visible:outline-2 focus-visible:outline-app-accent md:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg
              className="size-5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              {menuOpen ? (
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              ) : (
                <path d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75ZM2 10.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* 移动菜单：条件渲染，互斥类都在完整字符串里（第 9 章原则） */}
      <nav
        id="mobile-menu"
        className={cn(
          "border-t border-app-border md:hidden",
          !menuOpen && "hidden",
        )}
        aria-label="移动端导航"
      >
        <div className="space-y-1 px-4 py-3">
          <a
            href="#"
            className="block rounded-lg bg-app-surface-raised px-3 py-2 text-base font-medium text-app-text"
          >
            看板
          </a>
          <a
            href="#"
            className="block rounded-lg px-3 py-2 text-base font-medium text-app-text-muted hover:bg-app-surface-raised"
          >
            日程
          </a>
          <a
            href="#"
            className="block rounded-lg px-3 py-2 text-base font-medium text-app-text-muted hover:bg-app-surface-raised"
          >
            报表
          </a>
        </div>
      </nav>
    </header>
  );
}
```

要点复盘：`md:hidden`（响应式显隐）、`aria-expanded`/`aria-controls`（可访问性）、图标切换用条件渲染而非冲突类、菜单项复用 token 化的 hover 样式。不用框架时，可以用第 6 章的 peer + checkbox hack 实现纯 CSS 版本——但记得给 `aria-expanded` 补 JS 同步，纯 CSS 方案的状态对屏幕阅读器不可见。

### 页面组装（BoardPage.jsx 核心）

```jsx
export function BoardPage({ tasks }) {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-app-text sm:text-3xl">
            产品迭代看板
          </h1>
          <p className="mt-1 text-sm text-app-text-muted">
            共 {tasks.length} 个任务
          </p>
        </div>
        <Button variant="primary">+ 新建任务</Button>
      </div>

      {/* 布局归父级：卡片组件自身无任何外边距 */}
      <section
        className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
        aria-label="任务列表"
      >
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onSelect={openDetail} />
        ))}
      </section>

      <StatsTable className="mt-12" />
    </main>
  );
}
```

### 完工验收（自己走一遍）

1. 设备模拟器逐断点检查：1 列 → 2 列 → 3 列，导航在 md 处切换形态，表格可横滑；
2. 主题三态切换正常，刷新无闪屏，DevTools 里确认 `<html>` 的 class 变化；
3. Tab 键走一遍全页：焦点环处处可见，汉堡按钮、卡片内按钮均可聚焦；
4. 全局搜索 `#[0-9a-fA-F]{3,6}` 和 `rgb(`——除 theme.css 外不应有硬编码色值；
5. 全局搜索 `` `.*\$\{.*\}-.*` ``（模板串拼接类名模式）——不应存在动态拼接；
6. 生产构建 `npm run build`，看 CSS 产物体积（这种规模的页面通常只有十几 KB）。

## 10.3 全教程验收清单（逐项对照）

以下是教程开头承诺的核心概念清单，每项标注对应章节。全部打勾即达成"可维护的 utility-first 样式方式，并能在响应式、主题与组件状态下保持一致"的目标：

### ① utility-first 思想：布局、尺寸、排版、颜色、边框、阴影、间距映射为组合类名

- [ ] 能读懂官方 ChitChat 卡片示例中每个类的职责分类（第 3 章 3.1）；
- [ ] 能说出 utility 类与内联样式的三点本质区别：约束的设计系统、状态、媒体查询（第 3 章 3.3）；
- [ ] 掌握间距刻度（数字×4=px）、方向后缀、任意值三条构词规则（第 4 章 4.0）；
- [ ] 能默写标准页面骨架（背景全宽层 + `mx-auto max-w-* px-4` 内容层）（第 4 章 4.1）；
- [ ] flex/grid 选型：一维 flex、二维 grid，各自的经典配方（第 4 章 4.2/4.3）；
- [ ] 颜色体系：色相-亮度 + `/透明度` 修饰符；ring vs border；阴影层级语义（第 4 章 4.7）；
- [ ] 重复应对四层策略：循环 → 多光标 → 组件 → 自定义 CSS，复用单元是组件不是类（第 3 章 3.6）。

### ② 响应式断点、hover/focus/active/disabled、group/peer 等状态变体

- [ ] 五个默认断点数值与 min-width 语义；移动端优先（无前缀=基线）；`max-*` 区间定位（第 5 章）；
- [ ] 容器查询 `@container` + `@md:`，组件级响应式与页面级断点的分工（第 5 章 5.6）；
- [ ] hover/focus/focus-visible/active 语义区分；禁用态配方；v4 hover 仅悬停设备生效（第 6 章 6.1/6.2）；
- [ ] group（祖先→后代）与 has（后代→祖先）方向互补；命名 group 解决嵌套（第 6 章 6.4/6.6）；
- [ ] peer 兄弟联动及"只能向前标记"限制；纯 CSS 技巧的可访问性边界（第 6 章 6.5）；
- [ ] data-\*/aria-\* 变体对接 headless 组件；变体堆叠从左到右（第 6 章 6.7/6.9）。

### ③ 深色模式与主题令牌；设计 token 与语义颜色，而不是散落硬编码色值

- [ ] dark 变体两种机制：prefers-color-scheme 默认 / `@custom-variant dark` 手动切换（第 7 章 7.2）；
- [ ] 三态主题切换完整实现：head 内联防 FOUC + localStorage + matchMedia（第 7 章 7.3）；
- [ ] 深色设计守则：非纯黑/纯白、阴影换 ring、降饱和、对比度 ≥ 4.5:1（第 7 章 7.4）；
- [ ] `@theme` 三重身份（生成工具类 / 输出 CSS 变量 / 设计 token）与命名空间体系（第 8 章 8.1/8.2）；
- [ ] 两层 token 结构：原始色板 → 语义层（surface/text/accent/danger），组件只谈用途（第 8 章 8.4）；
- [ ] `@theme inline` 的变量解析原理与使用时机（第 8 章 8.5）；
- [ ] 主题文件独立、可跨项目 `@import` 共享（第 8 章 8.8）；
- [ ] 项目通过"色值审计"：theme.css 之外无硬编码色值（第 8 章 8.9）。

### ④ flex/grid、溢出、定位、z-index、容器宽度、移动端布局

- [ ] flex 全套：justify/items/flex-1/shrink-0/gap + 五个经典配方（第 4 章 4.2）；
- [ ] grid 全套：cols/span/`minmax(0,1fr)` 防溢出/auto-fill 免断点网格（第 4 章 4.3）；
- [ ] 溢出：`overflow-x-auto` 包表格、`truncate + min-w-0`、`line-clamp-*`（第 4 章 4.8）；
- [ ] 定位五态 + `inset-0` 遮罩 + 徽章配方；z-index 层级表心法与层叠上下文陷阱（第 4 章 4.9）；
- [ ] `max-w-*` 容器宽度体系与 `h-dvh` 移动端视口（第 4 章 4.1/4.4）；
- [ ] 移动端布局完整实践：TaskBoard 从 375px 到 1440px 无破版（第 5、10 章）。

### ⑤ className 条件组合、可复用组件 API 与样式职责划分

- [ ] 条件组合：三元分支放互斥类、数组过滤、`cn()`（clsx + tailwind-merge）（第 9 章 9.1）；
- [ ] 组件 API：variant props 枚举化优先，className 逃生舱经 twMerge 受控（第 9 章 9.2）；
- [ ] 四层样式职责 + 三原则（布局归父级、外观归组件、值归 token）（第 9 章 9.3）；
- [ ] TaskCard 六项检查清单全部通过（第 9 章 9.5）。

### ⑥ 当前版本的 CSS-first 配置与旧版差异；项目跟随锁定主版本文档

- [ ] 能默写 v4 入口（一行 `@import`）与 v3 入口（三连 `@tailwind`）的区别（第 2、10 章）；
- [ ] 能列出至少 8 项 v3→v4 变更：改名类、默认边框色、`!` 位置、圆括号变量、变体方向、safelist、darkMode、resolveConfig（第 10 章 10.1）；
- [ ] 知道 JS 配置在 v4 需 `@config` 显式加载，且三个选项不再支持；
- [ ] 团队实践：锁主版本、查文档先对版本、接手项目先 `npm ls tailwindcss`（第 10 章 10.1）。

### ⑦ 避免动态拼接无法被构建识别的 class；必要时明确映射或 safelist

- [ ] 能解释扫描原理并复现"DOM 有类名但样式丢失"的 bug（第 9 章 9.4）；
- [ ] 三种正解及优先级：完整类名映射 > 内联样式/CSS 变量 > `@source inline()` safelist；
- [ ] 会用 `@source` / `source()` / `@source not` 控制扫描范围（第 2 章 2.3、第 9 章 9.4）。

### ⑧ 基础 CSS：utility 不替代语义、可访问性和层叠模型

- [ ] 层叠/特异性/@layer 四层结构，能解释 `grid flex` 冲突现象（第 1 章）；
- [ ] Preflight 的行为与在 base 层恢复默认的方法（第 1 章 1.6）；
- [ ] 语义 HTML：按钮是 `<button>`、时间是 `<time>`、导航有 `aria-label`（贯穿全书）；
- [ ] 可访问性：焦点环永不裸删、`aria-expanded` 同步、`motion-reduce`、对比度验证（第 6、7、10 章）。

## 10.4 下一步学什么

- **官方文档精读**：[Core concepts](https://tailwindcss.com/docs/styling-with-utility-classes) 五篇（本教程第 3、5、6、7、8、9 章的主干都出自这里）、[Adding custom utilities](https://tailwindcss.com/docs/adding-custom-utilities)（`@utility` 进阶）、[Functions & Directives](https://tailwindcss.com/docs/functions-and-directives)（全部 CSS-first API 参考）；
- **官方插件生态**：`@tailwindcss/typography`（prose 富文本排版）、`@tailwindcss/forms`（表单样式重置）；
- **组件库对照学习**：shadcn/ui、Headless UI + Tailwind 的组合是"样式职责划分"（9.3）的工业级范本；
- **Refactoring UI**：Tailwind 作者的设计书，utility-first 用好的一半功夫在设计决策上；
- **把 TaskBoard 继续长大**：加详情页路由、拖拽排序（dnd-kit）、骨架屏（`animate-pulse`）、Toast（`fixed` + `z-50` + `animate-*`）——每个新需求都是一次本教程知识的复利。

---

> 上一章：[第 9 章 className 管理与组件化](./09-classname-management-and-components.md) | 返回目录：[README](./README.md)
