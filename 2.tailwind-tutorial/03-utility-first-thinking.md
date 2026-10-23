# 第 3 章：utility-first 核心思想

> 上一章：[第 2 章 环境搭建](./02-setup-first-project.md) | 返回目录：[README](./README.md) | 下一章：[第 4 章 常用 utility 体系详解](./04-core-utilities.md)

这是全书最重要的一章。工具类名可以现查现用，但**心智模型的转变**必须在这里完成，否则你写出来的会是"披着 Tailwind 外皮的传统 CSS"，得不到它任何好处。

## 3.1 什么是 utility-first

传统写法是"为每个 UI 部件起一个语义类名，再到 CSS 文件里实现它"：

```html
<!-- 传统方式：语义类名 + 独立 CSS -->
<div class="chat-notification">
  <img class="chat-logo" src="/img/logo.svg" alt="ChitChat Logo" />
  <div class="chat-content">
    <div class="chat-title">ChitChat</div>
    <p class="chat-message">You have a new message!</p>
  </div>
</div>
```

```css
.chat-notification {
  display: flex;
  max-width: 24rem;
  margin: 0 auto;
  padding: 1.5rem;
  border-radius: 0.75rem;
  background-color: #fff;
  box-shadow:
    0 20px 25px -5px rgb(0 0 0 / 0.1),
    0 8px 10px -6px rgb(0 0 0 / 0.1);
}
.chat-logo {
  width: 3rem;
  height: 3rem;
  flex-shrink: 0;
}
.chat-title {
  font-size: 1.25rem;
  line-height: 1.75rem;
  font-weight: 500;
  color: #000;
}
.chat-message {
  color: #6b7280;
}
```

utility-first 方式则是**把每个样式决策直接用一个小的、单一职责的类名表达，在标记（markup）里组合它们**：

```html
<!-- Tailwind 官方示例：同样的 UI，全部用组合类名表达 -->
<div
  class="mx-auto flex max-w-sm items-center gap-x-4 rounded-xl bg-white p-6 shadow-lg outline outline-black/5 dark:bg-slate-800 dark:shadow-none dark:-outline-offset-1 dark:outline-white/10"
>
  <img class="size-12 shrink-0" src="/img/logo.svg" alt="ChitChat Logo" />
  <div>
    <div class="text-xl font-medium text-black dark:text-white">ChitChat</div>
    <p class="text-gray-500 dark:text-gray-400">You have a new message!</p>
  </div>
</div>
```

对照着看，这个 UI 用到的类名可以按职责分类：

| 职责     | 类名                                                        |
| -------- | ----------------------------------------------------------- |
| 整体布局 | `flex`、`items-center`、`shrink-0`                          |
| 间距     | `p-6`（内边距）、`gap-x-4`（水平间隙）                      |
| 尺寸约束 | `max-w-sm`（最大宽度）、`size-12`（宽高各 3rem）            |
| 位置     | `mx-auto`（水平居中）                                       |
| 外观     | `bg-white`、`rounded-xl`、`shadow-lg`、`outline`            |
| 排版     | `text-xl`、`font-medium`、`text-black`、`text-gray-500`     |
| 深色模式 | `dark:bg-slate-800`、`dark:text-white`、`dark:shadow-none`… |

**这就是"将布局、尺寸、排版、颜色、边框、阴影、间距映射为组合类名"的完整演示**——本教程验收清单的第一条。

## 3.2 为什么要这样做：五个真实收益

官方文档列出的收益，加上实践注解：

1. **开发更快**——不用给每个 div 想类名（`chat-notification-inner-wrapper` 这种名字你想过吧？），不用在 HTML 和 CSS 文件之间来回跳，不用纠结选择器怎么写。设计到实现的路径被压到最短。
2. **改样式更安全**——改一个元素的类名只影响这个元素。传统 CSS 里改 `.chat-logo` 可能悄悄弄坏另一个页面复用了同名类的组件；utility 类没有这种"隔空打击"。
3. **维护老项目更容易**——半年前写的组件，样式就写在标记里，所见即所得；不需要回忆"当时那个 SCSS 文件的嵌套结构是怎么组织的"。
4. **代码可移植**——结构和样式在同一个地方，整块 UI 可以跨文件、甚至跨项目复制粘贴，样式不会丢（因为 utility 类是全局通用的词汇表）。
5. **CSS 体积不再线性膨胀**——传统项目每加一个功能就加一坨 CSS；Tailwind 项目里 `p-4 text-sm text-gray-500` 用过一次之后，再用的成本是**零字节**。

## 3.3 "这不就是内联样式吗？"——不是，有三点本质区别

这是新手最常见的质疑。表面上都是"样式写在元素上"，但 utility 类有内联样式（`style="..."`）做不到的三件事：

| 能力                 | 内联样式                                            | utility 类                                              |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| **受约束的设计系统** | 每个值都是随手写的魔法数字：`style="padding: 17px"` | 只能从预定义刻度里选：`p-4` 就是 1rem，天然保持视觉一致 |
| **状态样式**         | 无法表达 hover/focus/active                         | `hover:bg-sky-700`、`focus:outline-2`                   |
| **媒体查询**         | 无法表达响应式                                      | `md:flex`、`lg:grid-cols-3`                             |

第一点尤其重要：`p-4`、`text-sm`、`bg-sky-500` 不是随意的值，它们来自一套**间距刻度、字号阶梯、色板**（即设计 token，第 8 章）。你的团队每个人只能从这套词汇表里选词，写出来的界面自然统一。这就是"约束创造一致性"。

### 那什么时候可以用内联样式？

官方给出的合理场景——**值来自运行时动态数据**时：

```jsx
// 颜色来自数据库/API，编译期不可能知道，只能用内联样式
export function BrandedButton({ buttonColor, textColor, children }) {
  return (
    <button
      style={{ backgroundColor: buttonColor, color: textColor }}
      className="rounded-md px-3 py-1.5 font-medium"
    >
      {children}
    </button>
  );
}
```

更优雅的进阶模式：**内联样式只负责设置 CSS 变量，utility 类负责消费它们**，这样 hover 等状态也能用上动态值：

```jsx
export function BrandedButton({
  buttonColor,
  buttonColorHover,
  textColor,
  children,
}) {
  return (
    <button
      style={{
        "--bg-color": buttonColor,
        "--bg-color-hover": buttonColorHover,
        "--text-color": textColor,
      }}
      className="bg-(--bg-color) text-(--text-color) hover:bg-(--bg-color-hover) rounded-md px-3 py-1.5 font-medium"
    >
      {children}
    </button>
  );
}
```

`bg-(--bg-color)` 是 v4 的变量简写语法（等价于 `bg-[var(--bg-color)]`），第 4 章细讲。

## 3.4 用变体思考：一个类只负责一种状态

传统 CSS 里，一个 `.btn` 类通常包含所有状态的样式：

```css
.btn {
  background-color: var(--color-sky-500);
  &:hover {
    background-color: var(--color-sky-700);
  }
}
```

Tailwind 的哲学是**一个类只干一件事**，状态通过加前缀（变体）表达：

```html
<button class="bg-sky-500 hover:bg-sky-700 ...">Save changes</button>
```

生成的 CSS 一目了然：

```css
.hover\:bg-sky-700 {
  &:hover {
    background-color: var(--color-sky-700);
  }
}
```

`hover:bg-sky-700` 这个类**只在悬停时生效，除此之外什么都不做**。理解这一点后，你可以把变体像乐高一样自由堆叠：

```html
<!-- 深色模式 + lg 断点 + 悬停，三个条件同时满足才生效 -->
<button class="dark:lg:data-current:hover:bg-indigo-600 ..."></button>
```

```css
/* 等价于 */
@media (prefers-color-scheme: dark) and (width >= 64rem) {
  button[data-current]:hover {
    background-color: var(--color-indigo-600);
  }
}
```

一行类名替代了一段嵌套媒体查询选择器，且**条件逻辑和样式在同一个地方**，读代码不用跳文件。

## 3.5 类名组合：多个类协作产生一个效果

有些 CSS 属性由多个类共同构建。例如滤镜：

```html
<div class="blur-sm grayscale"><!-- ... --></div>
```

两个类都作用于 `filter` 属性，Tailwind 用 CSS 变量让它们能共存组合：

```css
.blur-sm {
  --tw-blur: blur(var(--blur-sm));
  filter: var(--tw-blur,) var(--tw-brightness,) var(--tw-grayscale,);
}
.grayscale {
  --tw-grayscale: grayscale(100%);
  filter: var(--tw-blur,) var(--tw-brightness,) var(--tw-grayscale,);
}
```

每个类只设置自己那个变量，`filter` 属性统一读取所有变量。渐变、阴影颜色、transform 也是同样的机制。你不需要记住实现细节，只需知道：**在 Tailwind 里，"叠加效果"就是"叠加类名"**，框架已经处理好了属性合并。

## 3.6 重复问题：没有你担心的那么严重

新手看到五个头像元素各挂一串 `inline-block h-12 w-12 rounded-full ring-2 ring-white` 会慌："这么多重复怎么维护？"官方给出的四层应对策略，按优先级排列：

### 策略一：循环渲染（大多数"重复"其实不存在）

页面上渲染了 5 个头像 ≠ 你写了 5 遍类名。真实项目里它们在循环里，**类名只写一次**：

```svelte
{#each contributors as user}
  <img class="inline-block h-12 w-12 rounded-full ring-2 ring-white"
       src={user.avatarUrl} alt={user.handle} />
{/each}
```

### 策略二：多光标编辑（局部重复）

同一文件里几个兄弟元素类名重复（比如导航的 4 个链接）？用编辑器的多光标（multi-cursor）一次性选中所有类名同时改。官方原话："你会惊讶于这常常就是最好的方案"——如果能同时编辑所有重复处，就没必要引入额外抽象。

### 策略三：提取组件（跨文件复用的正解）

用 React/Vue/Svelte 就提取组件，用模板语言（Blade/ERB/Twig/Nunjucks）就提取模板片段（partial）：

```jsx
export function VacationCard({ img, imgAlt, eyebrow, title, pricing, url }) {
  return (
    <div>
      <img className="rounded-lg" src={img} alt={imgAlt} />
      <div className="mt-4">
        <div className="text-xs font-bold text-sky-500">{eyebrow}</div>
        <div className="mt-1 font-bold text-gray-700">
          <a href={url} className="hover:underline">
            {title}
          </a>
        </div>
        <div className="mt-2 text-sm text-gray-600">{pricing}</div>
      </div>
    </div>
  );
}
```

组件成为样式的**唯一事实来源**，到处使用、一处修改。**在 utility-first 体系里，你的复用单元是组件，不是 CSS 类**——这是与传统 CSS 最大的思维差异。第 9 章专门讲组件 API 设计。

### 策略四：自定义 CSS（无组件系统的补充手段）

如果项目用模板语言、为一个按钮建 partial 太重了，写一个自定义类也完全可以接受，用 `@layer components` 包住，并**引用主题变量**保持一致性：

```css
@import "tailwindcss";

@layer components {
  .btn-primary {
    border-radius: calc(infinity * 1px);
    background-color: var(--color-violet-500);
    padding-inline: --spacing(5);
    padding-block: --spacing(2);
    font-weight: var(--font-weight-semibold);
    color: var(--color-white);
    box-shadow: var(--shadow-md);

    &:hover {
      @media (hover: hover) {
        background-color: var(--color-violet-700);
      }
    }
  }
}
```

官方建议：超过单个 HTML 元素的复杂度，还是回到策略三用组件/模板片段封装结构与样式。

> 顺带一提：v3 教程常见的 `@apply` 指令在 v4 依然可用（如 `.btn { @apply rounded px-4 py-2; }`），但官方更推荐直接写主题变量（如上），性能更好也更透明。滥用 `@apply` 把长串类名搬进 CSS，等于放弃了 utility-first 的大部分好处。

## 3.7 样式冲突：规则很简单

复习第 1 章的结论并给出官方建议：

1. **不要给同一元素加两个冲突类**（`grid flex`、`p-4 p-8`）。要条件切换就用三元表达式，保证任何时刻只有一个生效：
   ```jsx
   <div className={gridLayout ? "grid" : "flex"}>{/* ... */}</div>
   ```
2. **组件库设计**：与其让使用者从外部塞类名进来（容易和组件内部类名冲突），不如暴露明确的样式 props（第 9 章展开）；
3. **实在需要强制生效**：v4 在类名**末尾**加 `!`（如 `bg-red-500!`），生成 `!important` 声明。这是逃生舱，不是常规手段；
4. **给整个项目加 Tailwind 时与遗留 CSS 打架**：可以 `@import "tailwindcss" important;` 让所有工具类带 `!important`，或用 `@import "tailwindcss" prefix(tw);` 给所有类加 `tw:` 前缀避免命名冲突。

## 3.8 实战练习：亲手完成一次"翻译"

把下面的传统 CSS 组件"翻译"成 utility-first 写法（答案在下面，先自己动手，可以在 [Playground](https://play.tailwindcss.com/) 里验证）：

```html
<div class="user-card">
  <img class="avatar" src="/img/avatar.jpg" alt="用户头像" />
  <div class="info">
    <h3 class="name">Ada Lovelace</h3>
    <p class="role">Frontend Engineer</p>
  </div>
</div>
```

```css
.user-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.75rem;
  background: white;
}
.avatar {
  width: 3rem;
  height: 3rem;
  border-radius: 9999px;
}
.name {
  font-size: 1.125rem;
  font-weight: 600;
  color: #111827;
}
.role {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: #6b7280;
}
```

<details>
<summary>参考答案（先自己写！）</summary>

```html
<div
  class="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4"
>
  <img class="size-12 rounded-full" src="/img/avatar.jpg" alt="用户头像" />
  <div>
    <h3 class="text-lg font-semibold text-gray-900">Ada Lovelace</h3>
    <p class="mt-1 text-sm text-gray-500">Frontend Engineer</p>
  </div>
</div>
```

对照要点：`gap: 1rem` → `gap-4`（间距刻度 1 = 0.25rem，所以 4 = 1rem）；`border-radius: 0.75rem` → `rounded-xl`；`width+height: 3rem` → `size-12`；`border-radius: 9999px` → `rounded-full`。发现了吗——**你不需要记这些映射，你需要理解"每个视觉决策对应一个刻度值"**，具体类名查文档或靠 IntelliSense 补全。

</details>

## 本章小结与自检

- [ ] 能把一段传统 CSS 组件"翻译"为 utility-first 标记（3.8 练习）；
- [ ] 能说出 utility 类与内联样式的三点本质区别（约束、状态、媒体查询）；
- [ ] 理解"一个类只负责一种状态/一个属性"，变体通过前缀堆叠；
- [ ] 面对重复时的决策顺序：循环渲染 → 多光标编辑 → 提取组件 → 自定义 CSS；
- [ ] 知道复用单元是**组件**而不是 CSS 类；
- [ ] 知道冲突类的处理原则和 `!`、`important`、`prefix` 三个逃生舱的使用场景。

---

> 上一章：[第 2 章 环境搭建](./02-setup-first-project.md) | 返回目录：[README](./README.md) | 下一章：[第 4 章 常用 utility 体系详解](./04-core-utilities.md)
