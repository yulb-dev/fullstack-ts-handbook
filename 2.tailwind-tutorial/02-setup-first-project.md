# 第 2 章：环境搭建——从 0 创建第一个项目

> 上一章：[第 1 章 基础 CSS](./01-css-fundamentals.md) | 返回目录：[README](./README.md) | 下一章：[第 3 章 utility-first 核心思想](./03-utility-first-thinking.md)

本章目标：亲手搭一个 Tailwind CSS v4 项目，理解它的工作原理（类名扫描 → 按需生成 CSS），并写出第一个页面。

## 2.1 先理解工作原理，再动手

Tailwind 不是一份"全量样式库"。它的工作流程是：

```
扫描你的源文件（HTML/JSX/Vue/Svelte...），找出所有"像类名"的字符串
        │
        ▼
只为实际用到的类名生成 CSS
        │
        ▼
输出一个很小的静态样式文件（zero-runtime，运行时零开销）
```

两个关键推论，后面章节会反复用到：

1. **CSS 体积与你用到的类名成正比**，与项目大小无关——用 30 个类就只生成 30 个类的 CSS；
2. **类名必须以"完整字符串"形式出现在源文件里**，Tailwind 才能扫到。任何运行时拼接（如 `bg-${color}-500`）都会导致样式丢失。这是第 9 章的重点，先在脑子里挂个号。

## 2.2 方式一（推荐）：Vite + 官方插件

这是官方文档首推的方式，适用于纯 Vite 项目以及 React、Vue、SvelteKit 等基于 Vite 的框架。

### 第 1 步：创建项目

```bash
npm create vite@latest my-project
cd my-project
```

（框架选择 vanilla / react / vue 都可以，本教程示例以 React 为主，纯 HTML 也完全通用。）

### 第 2 步：安装 Tailwind

```bash
npm install tailwindcss @tailwindcss/vite
```

注意 v4 的包结构：核心是 `tailwindcss`，Vite 插件是 `@tailwindcss/vite`。（对比：v3 时代装的是 `tailwindcss postcss autoprefixer` 三件套，且不需要 Vite 插件——这是版本差异的直观体现。）

### 第 3 步：配置 Vite 插件

```ts
// vite.config.ts
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
});
```

### 第 4 步：创建 CSS 入口

新建（或改写）`src/index.css`，只需一行：

```css
@import "tailwindcss";
```

**没有 `tailwind.config.js`，没有 `@tailwind base/components/utilities` 三连**。v4 是 CSS-first 配置：一行 `@import` 引入全部内容，所有定制（主题、断点、深色模式策略、扫描源）之后都写在 CSS 里。如果你看到某个教程让你创建 `tailwind.config.js` 并写 `@tailwind base;`，那是 v3 的写法。

确认 JS 入口引入了这个 CSS 文件（Vite 模板通常已引入）：

```js
// src/main.jsx 或 src/main.js
import "./index.css";
```

### 第 5 步：启动并使用

```bash
npm run dev
```

在页面里写第一个标题：

```html
<h1 class="text-3xl font-bold underline">Hello world!</h1>
```

保存后浏览器里应立刻看到 3xl 字号、加粗、带下划线的标题。恭喜，环境搭好了。

### 其他集成方式速览

| 场景                                    | 方式                                                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vite / React / Vue / SvelteKit 等       | `@tailwindcss/vite` 插件（本章方式，官方首推）                                                                                                                    |
| 非 Vite 的构建流程（如纯 PostCSS 管道） | `@tailwindcss/postcss`，在 postcss.config.mjs 中注册 `"@tailwindcss/postcss": {}`；v4 已内置 import 处理和浏览器前缀，不再需要 `postcss-import` 和 `autoprefixer` |
| 无构建工具的静态站点                    | `@tailwindcss/cli`：`npx @tailwindcss/cli -i input.css -o output.css --watch`                                                                                     |
| 学习/原型验证                           | Play CDN（见 2.4）                                                                                                                                                |

## 2.3 你的第一个完整页面

把下面的内容放进 `index.html`（vanilla）或你的入口组件（React/Vue），我们逐段解读：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <!-- 响应式的前提：没有这个 meta，移动端断点全部失效 -->
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My First Tailwind Page</title>
  </head>
  <body class="bg-gray-100 font-sans text-gray-900 antialiased">
    <main class="mx-auto max-w-3xl px-4 py-12">
      <h1 class="text-4xl font-extrabold tracking-tight">
        我的第一个 <span class="text-blue-600">Tailwind</span> 页面
      </h1>
      <p class="mt-4 text-lg leading-relaxed text-gray-600">
        这段文字使用了
        mt-4（上外边距）、text-lg（字号）、leading-relaxed（行高） 和
        text-gray-600（颜色）四个工具类。
      </p>

      <div class="mt-8 flex flex-col gap-4 sm:flex-row">
        <div
          class="flex-1 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <h2 class="text-xl font-semibold">卡片一</h2>
          <p class="mt-2 text-sm text-gray-500">
            移动端上下堆叠，sm 断点以上并排。
          </p>
        </div>
        <div
          class="flex-1 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <h2 class="text-xl font-semibold">卡片二</h2>
          <p class="mt-2 text-sm text-gray-500">
            试着拖动浏览器窗口宽度看布局变化。
          </p>
        </div>
      </div>

      <button
        type="button"
        class="mt-8 rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white transition
               hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2
               focus-visible:outline-blue-600 active:bg-blue-800"
      >
        一个带完整交互状态的按钮
      </button>
    </main>
  </body>
</html>
```

逐段解读（现在不求全懂，建立整体印象，后续章节逐个击破）：

- `bg-gray-100 font-sans text-gray-900`：给 body 设置背景、字体、默认文字颜色——**在根元素上定基调，是 Tailwind 项目的常见模式**；
- `mx-auto max-w-3xl px-4 py-12`：容器宽度（max-w-3xl）+ 水平居中（mx-auto）+ 内边距，这是"内容列"的标准配方；
- `flex flex-col gap-4 sm:flex-row`：默认（移动端）纵向排列，`sm` 断点以上横向排列——**移动端优先**的第一次亮相（第 5 章详解）；
- `rounded-xl border border-gray-200 bg-white p-6 shadow-sm`：圆角 + 边框（注意 v4 中 border 必须显式给颜色，第 1 章讲过）+ 白底 + 内边距 + 浅阴影，一张卡片的完整"皮肤"；
- 按钮上的 `hover:` / `focus-visible:` / `active:` 前缀叫**变体（variant）**，让同一个元素在不同交互状态下呈现不同样式（第 6 章详解）。

### 验证"按需生成"

打开 DevTools 检查 `<h1>`，你会看到 `.text-4xl`、`.font-extrabold` 等规则真实存在；而在 Sources 面板里看生成的 CSS 文件，它只包含你用到的类。试着删掉页面里的 `underline` 类名保存，再全局搜索编译产物——`.underline` 规则消失了。**类名驱动生成，用多少生成多少**，这就是 2.1 说的原理在你眼前的实证。

### 哪些文件会被扫描

默认扫描项目里所有文件，除了：`.gitignore` 里的文件、`node_modules`、二进制文件（图片视频压缩包）、CSS 文件、包管理器的 lock 文件。

如果你的类名藏在默认不扫描的地方（比如一个内部用 Tailwind 写的 npm 组件库），用 `@source` 显式注册：

```css
@import "tailwindcss";
@source "../node_modules/@acmecorp/ui-lib";
```

更多扫描控制（`source(none)`、`@source not`、safelist）在第 9 章讲动态类名陷阱时展开。

## 2.4 方式二：Play CDN 与在线演练场

学习阶段不想装环境？两个零成本选择：

1. **Playground**：<https://play.tailwindcss.com/> ——官方在线演练场，左边写代码右边看效果，还能直接看生成的 CSS。本教程所有示例都可以粘进去跑。
2. **Play CDN**：在任意 HTML 里加一个 script 标签，在浏览器里实时编译：

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  </head>
  <body>
    <h1 class="text-3xl font-bold underline">Hello world!</h1>
  </body>
</html>
```

**警告**：Play CDN 在浏览器运行时编译，性能和体积都不适合生产环境，官方明确定位为原型/学习工具。正式项目请用 2.2 的构建集成方式。

## 2.5 编辑器配置（强烈建议）

安装官方 **Tailwind CSS IntelliSense** 插件（VS Code / Cursor 等均有），你会获得：

- 类名自动补全（输入 `bg-` 弹出所有颜色）；
- 悬停显示类名对应的 CSS 与主题变量值；
- 无效类名、冲突类名的 lint 提示；
- `@theme`、`@source` 等 CSS 指令的补全。

再配一个 **Prettier + prettier-plugin-tailwindcss**：自动把类名按官方推荐顺序排列（布局 → 盒模型 → 排版 → 视觉 → 动画…），团队代码风格瞬间统一：

```bash
npm install -D prettier prettier-plugin-tailwindcss
```

```json
// .prettierrc
{
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

排序后的类名可读性大幅提升，例如 `class="mt-2 text-sm text-gray-500"` 会被自动整理成规范顺序，以后 review 代码时一眼就能看出两个元素的样式差异。

## 2.6 常见新手问题排查

| 症状                          | 原因                                                          | 解决                                                                          |
| ----------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 类名写了完全没效果            | CSS 入口没有 `@import "tailwindcss"`，或入口 CSS 没被 JS 引入 | 检查 2.2 第 4 步                                                              |
| 手机上页面不缩放，断点全乱    | `<head>` 缺 viewport meta                                     | 加 `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` |
| 部分样式生效部分不生效        | 类名是运行时拼接的，扫描不到                                  | 第 9 章，改用完整类名映射                                                     |
| `h1` 又小又不加粗，"不像标题" | Preflight 重置了标题默认样式，属正常行为                      | 自己加 `text-4xl font-bold`（见第 1 章 1.6）                                  |
| `border` 加上了但看不见颜色   | v4 边框默认色是 `currentColor`                                | 显式加 `border-gray-200` 等颜色类                                             |
| 按钮鼠标悬停不是手型          | v4 Preflight 跟随浏览器默认 `cursor: default`                 | 加 `cursor-pointer`，或按第 1 章方式在 base 层全局恢复                        |

## 练习

1. 按 2.2 搭好 Vite 项目，跑通 2.3 的页面，拖动窗口观察卡片布局在 sm 断点的变化；
2. 给页面再加一张卡片，让它和前两张在 `md` 断点以上三列并排（提示：`md:` 前缀 + grid，不会写可以先跳到第 4、5 章再回来）；
3. 打开编译产物 CSS，找到 `.text-4xl` 的规则，确认它的 `font-size` 引用了 `var(--text-4xl)`——这是第 8 章主题变量的伏笔；
4. 安装 IntelliSense 插件，体验输入 `bg-` 时的补全。

## 本章小结与自检

- [ ] 能独立用 Vite + `@tailwindcss/vite` 搭建 Tailwind v4 项目；
- [ ] 知道 v4 的 CSS 入口只有一行 `@import "tailwindcss"`，不需要 JS 配置文件和 `@tailwind` 指令；
- [ ] 能说出"扫描源文件 → 按需生成 CSS"的原理，以及它对"类名必须完整出现"的要求；
- [ ] 知道哪些文件默认不被扫描，会用 `@source` 显式注册；
- [ ] 配好了 IntelliSense 和 Prettier 插件；
- [ ] 页面 `<head>` 里有 viewport meta。

---

> 上一章：[第 1 章 基础 CSS](./01-css-fundamentals.md) | 返回目录：[README](./README.md) | 下一章：[第 3 章 utility-first 核心思想](./03-utility-first-thinking.md)
