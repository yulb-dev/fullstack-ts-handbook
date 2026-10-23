# 第 6 章：状态变体——hover / focus / active / disabled / group / peer

> 上一章：[第 5 章 响应式设计](./05-responsive-design.md) | 返回目录：[README](./README.md) | 下一章：[第 7 章 深色模式](./07-dark-mode.md)

第 3 章说过："一个类只负责一种状态"。本章把 Tailwind 的变体（variant）体系完整过一遍：交互伪类、表单状态、结构伪类、父子/兄弟联动（group/peer/has）、属性变体（data/aria），以及变体堆叠规则与自定义变体。

## 6.1 交互状态：hover / focus / active

```html
<button
  class="bg-violet-500
               hover:bg-violet-600
               focus:outline-2 focus:outline-offset-2 focus:outline-violet-500
               active:bg-violet-700
               ..."
>
  Save changes
</button>
```

三个状态的语义要分清：

| 变体             | 触发时机                           | 典型用途                   |
| ---------------- | ---------------------------------- | -------------------------- |
| `hover:`         | 指针悬停                           | 背景加深、下划线、阴影增强 |
| `focus:`         | 获得焦点（含 JS 聚焦与点击）       | 表单控件聚焦样式           |
| `focus-visible:` | **键盘导航**等真正需要指示器的聚焦 | 按钮/链接的焦点环（推荐）  |
| `active:`        | 按下瞬间                           | 背景再加深、轻微缩放       |

### focus 与 focus-visible 的取舍（可访问性重点）

- 对**按钮和链接**：优先 `focus-visible:`——鼠标点击不显示焦点环（符合平台习惯），键盘 Tab 导航时显示（可访问性要求）；
- 对**输入框**：用 `focus:`——用户点击输入框就应该有明确的聚焦反馈；
- **永远不要**只写 `focus:outline-none` 就完事——那会杀死键盘用户的焦点指示。v4 里这个类叫 `focus:outline-hidden`（旧的 `outline-none` 更名而来，新的 `outline-none` 是真正的 `outline-style: none`）。去掉默认 outline 的同时必须提供替代指示器：

```html
<!-- ✅ 正确：去掉默认轮廓，换上更醒目的自定义焦点样式 -->
<button
  class="rounded-lg bg-blue-600 px-4 py-2 text-white
               focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500/50"
>
  提交
</button>

<!-- ❌ 错误：键盘用户再也看不见焦点在哪 -->
<button class="focus:outline-none">提交</button>
```

### v4 的 hover 只在"真能悬停"的设备生效

v4 生成的 hover 样式默认包了一层媒体查询：

```css
@media (hover: hover) {
  .hover\:underline:hover {
    text-decoration-line: underline;
  }
}
```

也就是说触屏设备上点按不会触发"粘滞的 hover 样式"。如果你的设计依赖触屏也触发 hover（不推荐），可以用 `@custom-variant hover (&:hover);` 覆盖回旧行为。官方立场：**把 hover 当作增强，不要把关键信息只藏在 hover 里**（触屏用户永远看不到）。

## 6.2 表单状态：disabled / required / invalid / checked…

表单是状态变体的主场。官方示例——一个输入框覆盖全部状态，**模板里不需要任何条件逻辑**，浏览器状态变了样式自动跟随：

```html
<input
  type="text"
  value="tbone"
  disabled
  class="invalid:border-pink-500 invalid:text-pink-600
         focus:border-sky-500 focus:outline focus:outline-sky-500
         focus:invalid:border-pink-500 focus:invalid:outline-pink-500
         disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-500 disabled:shadow-none
         ..."
/>
```

这就是变体思维对代码结构的改善：**用声明式的状态样式替代命令式的 class 切换 JS**。

常用表单变体：

| 变体                          | 对应伪类              | 场景                                         |
| ----------------------------- | --------------------- | -------------------------------------------- |
| `disabled:`                   | `:disabled`           | 禁用态：降饱和、去阴影、`cursor-not-allowed` |
| `required:` / `optional:`     | `:required`           | 必填标记                                     |
| `valid:` / `invalid:`         | `:valid` / `:invalid` | 校验反馈                                     |
| `checked:`                    | `:checked`            | 复选/单选选中态                              |
| `read-only:`                  | `:read-only`          | 只读字段                                     |
| `placeholder-shown:`          | `:placeholder-shown`  | 空输入框（浮动标签技巧的核心）               |
| `in-range:` / `out-of-range:` | 数值输入范围          | 数字/日期控件                                |

禁用按钮的完整配方：

```html
<button
  class="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white
               hover:bg-blue-700 active:bg-blue-800
               disabled:pointer-events-none disabled:opacity-50"
>
  保存
</button>
```

`disabled:pointer-events-none` 让禁用按钮不再响应任何鼠标事件（hover 样式也不会触发），`opacity-50` 给视觉降档。

## 6.3 结构伪类：first / last / odd / even / nth-\*

给列表中的特定位置元素加样式：

```html
<ul role="list">
  {#each people as person}
  <!-- 第一项去掉顶部内边距、最后一项去掉底部内边距：让列表边缘干净 -->
  <li class="flex py-4 first:pt-0 last:pb-0">…</li>
  {/each}
</ul>
```

```html
<!-- 斑马纹表格 -->
<tr
  class="odd:bg-white even:bg-gray-50 dark:odd:bg-gray-900/50 dark:even:bg-gray-950"
></tr>
```

更精细的位置控制用 `nth-*` 家族：

```html
<div class="nth-3:underline">
  <!-- 第 3 个 -->
  <div class="nth-last-5:underline">
    <!-- 倒数第 5 个 -->
    <div class="nth-of-type-4:underline">
      <!-- 同类型第 4 个 -->
      <div class="nth-[2n+1_of_li]:underline"><!-- 任意表达式 --></div>
    </div>
  </div>
</div>
```

注意变体堆叠顺序在 v4 中是**从左到右**应用（v3 是从右到左）：`first:*:pt-0`（v3 写法）在 v4 是 `*:first:pt-0`。第 10 章还会提。

## 6.4 group：父元素状态驱动子元素样式

需求：整张卡片可点击，悬停**卡片**时，卡片内的标题变蓝、箭头右移。用 `group` 标记父元素，子元素用 `group-hover:` 等变体：

```html
<a href="#" class="group rounded-lg p-8 ...">
  <div>
    <svg
      class="stroke-sky-500 group-hover:stroke-white ..."
      fill="none"
      viewBox="0 0 24 24"
    >
      <!-- ... -->
    </svg>
    <h3 class="text-gray-900 group-hover:text-white ...">New project</h3>
  </div>
  <p class="text-gray-500 group-hover:text-white ...">
    Create a new project from a variety of starting templates.
  </p>
  <span class="inline-block translate-x-0 transition group-hover:translate-x-1"
    >→</span
  >
</a>
```

`group-*` 支持所有伪类变体：`group-focus:`、`group-active:`、`group-odd:`、`group-open:`……

### 命名 group：解决嵌套

外层卡片是 group，内部"编辑"链接也想做 group，无名 group 会互相干扰。给 group 起名：

```html
<li class="group/item ...">
  <a class="group/edit invisible group-hover/item:visible ..." href="tel:...">
    <span class="group-hover/edit:text-gray-700 ...">Call</span>
    <svg
      class="group-hover/edit:translate-x-0.5 group-hover/edit:text-gray-500 ..."
    >
      <!-- ... -->
    </svg>
  </a>
</li>
```

`group/{name}` + `group-hover/{name}:`，名字随意起，无需任何配置。

### 任意 group 与隐式 group

```html
<!-- 任意选择器版：父元素带 .is-published 时子元素显示 -->
<div class="group is-published">
  <div class="hidden group-[.is-published]:block">Published</div>
</div>

<!-- in-* 隐式变体：不需要给父元素加 group 类 -->
<div tabindex="0">
  <div class="opacity-50 in-focus:opacity-100">…</div>
</div>
```

`in-*` 响应**任意祖先**的状态，方便但控制粒度粗；需要精确指定"哪个父级"时还是用命名 group。

## 6.5 peer：兄弟元素状态驱动

`peer` 标记一个元素，**它后面的兄弟**用 `peer-*:` 响应该元素的状态。经典场景：输入框校验失败时，显示旁边的错误提示。

```html
<form>
  <label class="block">
    <span class="...">Email</span>
    <input type="email" class="peer ..." />
    <p class="invisible peer-invalid:visible ...">
      Please provide a valid email address.
    </p>
  </label>
</form>
```

**硬性限制**：CSS 的兄弟选择器只能"向后看"，所以 `peer` 必须标记在**前面的兄弟**上，被驱动的元素放在它后面。下面这样不工作：

```html
<!-- ❌ 无效：peer 在目标元素后面 -->
<label>
  <span class="peer-invalid:text-red-500 ...">Email</span>
  <input type="email" class="peer ..." />
</label>
```

peer 同样支持全部伪类变体（`peer-focus:`、`peer-checked:`、`peer-disabled:`…），也可以命名（`peer/draft` + `peer-checked/draft:`）。

### 纯 CSS 交互的巅峰：peer + checked

不写一行 JS 实现"单选切换显示内容"：

```html
<fieldset>
  <legend>Published status</legend>
  <input id="draft" class="peer/draft" type="radio" name="status" checked />
  <label for="draft" class="peer-checked/draft:text-sky-500">Draft</label>

  <input id="published" class="peer/published" type="radio" name="status" />
  <label for="published" class="peer-checked/published:text-sky-500"
    >Published</label
  >

  <div class="hidden peer-checked/draft:block">
    Drafts are only visible to administrators.
  </div>
  <div class="hidden peer-checked/published:block">
    Your post will be publicly visible on your site.
  </div>
</fieldset>
```

同类技巧：纯 CSS 浮动标签（`placeholder-shown:` + `peer-focus:`）、纯 CSS 手风琴、纯 CSS 移动端汉堡菜单（checkbox hack）。**但注意可访问性边界**：复杂交互（弹窗焦点圈禁、路由切换）还是应该用 JS 和正确的 ARIA，纯 CSS 技巧只适合简单、语义天然成立的场景。

## 6.6 has：根据"后代"的状态 styling 自己

`:has()` 是 CSS 的"父选择器"，Tailwind 提供 `has-*` 变体。官方示例：整块 label 根据内部 radio 是否选中变色：

```html
<label
  class="has-checked:bg-indigo-50 has-checked:text-indigo-900 has-checked:ring-indigo-200 ..."
>
  <svg fill="currentColor"><!-- ... --></svg>
  Google Pay
  <input type="radio" class="checked:border-indigo-500 ..." />
</label>
```

其他用法：

```html
<div class="has-[:focus]:ring-2">
  <!-- 任意后代获得焦点时 -->
  <div class="has-[img]:p-0">
    <!-- 内部包含图片时（去掉内边距让图片出血） -->
  </div>
</div>
```

配合 group / peer：`group-has-[a]:block`（父级的后代里有链接时）、`peer-has-checked:hidden`（兄弟内部有选中项时）。

`has-*` 与 `group-*` 的方向相反，正好互补：

- `group-hover:` 子元素响应**祖先**的状态；
- `has-checked:` 元素响应**后代**的状态。

## 6.7 data 与 aria 属性变体

组件库普遍用 `data-*` 属性暴露状态（如 Radix、Headless UI 的 `data-open`、`data-closed`、`data-selected`），Tailwind 直接支持：

```html
<!-- 简写：匹配 data-current 存在（任意值） -->
<button data-current class="data-current:bg-indigo-600">…</button>

<!-- 精确值匹配 -->
<div data-size="large" class="data-[size=large]:p-8">…</div>

<!-- aria 属性同理 -->
<div aria-expanded="true" class="aria-expanded:rotate-180">…</div>
<div aria-invalid="true" class="aria-invalid:border-red-500">…</div>
```

这是给第三方无样式组件（headless components）上妆的标准姿势：**状态归 JS/属性管，样式归 data/aria 变体管**，职责清晰。

## 6.8 伪元素与其他变体速览

```html
<!-- ::before / ::after（Tailwind 自动补 content: ''） -->
<span class="after:ml-0.5 after:text-red-500 after:content-['*']">Email</span>

<!-- ::placeholder -->
<input
  class="placeholder:text-gray-400 placeholder:italic"
  placeholder="Search…"
/>

<!-- ::selection 选中文字（可继承，挂在 body 上全局生效） -->
<body class="selection:bg-pink-300 selection:text-pink-950">
  <!-- ::marker 列表符号 / ::first-letter 首字下沉 -->
  <ul class="list-disc marker:text-sky-400">
    <p
      class="first-letter:float-left first-letter:mr-3 first-letter:text-7xl first-letter:font-bold"
    >
      <!-- ::backdrop 原生 dialog 的遮罩 -->
      <dialog class="backdrop:bg-gray-900/50 backdrop:backdrop-blur-sm">
        <!-- 文件上传按钮 ::file-selector-button -->
        <input
          type="file"
          class="file:mr-4 file:rounded-full file:border-0 file:bg-violet-50 file:px-4 file:py-2"
        />
      </dialog>
    </p>
  </ul>
</body>
```

官方对 before/after 的实用建议：**大多数情况下直接用真实元素更好**——`<span class="absolute -inset-1 -skew-y-3 bg-pink-500" aria-hidden="true">` 比 before 伪元素更易读、代码更少。伪元素留给"内容必须不可选中/不在 DOM 里"的场景。

媒体特性类变体（了解）：`motion-safe:` / `motion-reduce:`（尊重系统"减弱动态效果"设置，做动画必备的可访问性变体）、`portrait:` / `landscape:`、`contrast-more:`、`supports-[display:grid]:`、`print:` 等。

## 6.9 变体堆叠：组合的极限

变体可以任意叠加，表达"多个条件同时满足"：

```html
<!-- 深色模式 + 禁用状态下悬停保持原色（防止禁用按钮还有 hover 反馈） -->
<button class="bg-sky-500 hover:bg-sky-700 disabled:hover:bg-sky-500 ...">
  <!-- 深色 + lg 断点 + data-current + 悬停 -->
  <button class="dark:lg:data-current:hover:bg-indigo-600">
    <!-- 响应式的 group-hover -->
    <div class="group">
      <span class="md:group-hover:underline">…</span>
    </div>
  </button>
</button>
```

规则与陷阱：

1. **阅读顺序 = 从外到内**：`dark:lg:hover:bg-x` ≈ "深色模式下、lg 及以上、悬停时"；
2. v4 中堆叠变体**从左到右**应用（v3 相反），迁移旧代码时注意 `first:*:` → `*:first:`；
3. 堆叠超过三层就该警惕可读性了——考虑是不是该把状态拆到组件 props 里（第 9 章）。

## 6.10 自定义变体：@custom-variant

内置变体不够用时，在 CSS 里定义自己的（v4 CSS-first 配置的又一体现）：

```css
@import "tailwindcss";

/* 简单的：包裹现有选择器 */
@custom-variant pointer-coarse (@media (pointer: coarse));

/* 组合的：& 代表当前元素 */
@custom-variant when-open (&[data-state="open"]);
```

```html
<div class="pointer-coarse:text-lg when-open:block">…</div>
```

第 7 章的深色模式切换就是用 `@custom-variant dark` 实现的——它本质上就是一个自定义变体。

## 6.11 实战：给 TaskBoard 加上完整交互状态

在第 5 章骨架上叠加（只列改动）：

```html
<!-- 卡片：整卡可点击，悬停抬升，键盘聚焦有焦点环 -->
<article
  tabindex="0"
  class="group cursor-pointer rounded-xl border border-gray-200 bg-white p-5 shadow-sm
         transition hover:-translate-y-0.5 hover:shadow-md
         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600
         motion-reduce:hover:translate-y-0"
>
  <div class="flex items-start justify-between gap-2">
    <h2 class="font-semibold leading-snug group-hover:text-blue-600">
      重构登录页表单校验
    </h2>
    <span
      class="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800"
      >进行中</span
    >
  </div>
  <!-- 操作按钮：平时隐藏，悬停/聚焦卡片时浮现 -->
  <div
    class="mt-3 flex gap-2 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
  >
    <button
      class="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100
                   focus-visible:outline-2 focus-visible:outline-blue-600"
    >
      编辑
    </button>
    <button
      class="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50
                   disabled:pointer-events-none disabled:opacity-50
                   focus-visible:outline-2 focus-visible:outline-red-600"
    >
      删除
    </button>
  </div>
</article>
```

用到的本章知识点清单：`group-hover` 联动（悬停卡片→标题变色、操作浮现）、`focus-visible` 焦点环、`disabled` 配方、`transition` 平滑过渡、`motion-reduce` 尊重系统减弱动画设置。

> 可访问性提醒：`opacity-0` 的按钮键盘 Tab 仍可聚焦（好事），但要确保 `group-focus-visible:opacity-100` 让键盘用户也能看到它；如果内容对屏幕阅读器都该隐藏，用 `hidden`/`invisible` 而非透明度。真实项目中"悬停才出现的操作"建议同时提供常显的菜单入口。

## 本章小结与自检

- [ ] 能区分 hover / focus / focus-visible / active 的语义并正确选用；
- [ ] 掌握"移除默认 outline 必须补偿自定义焦点样式"的铁律；
- [ ] 知道 v4 的 hover 变体默认只在支持悬停的设备生效；
- [ ] 会用 disabled/invalid/checked 等表单变体写出零 JS 条件逻辑的表单样式；
- [ ] group：父子联动、命名 group 解决嵌套、in-\* 隐式变体；
- [ ] peer：兄弟联动、"只能向前标记"的限制、纯 CSS 单选切换技巧及其可访问性边界；
- [ ] has-\*（后代状态）与 group（祖先状态）方向互补；
- [ ] data-\* / aria-\* 变体对接 headless 组件；
- [ ] 变体堆叠左到右应用（v4），超过三层要警惕；
- [ ] 会用 `@custom-variant` 自定义变体；
- [ ] 完成 TaskBoard 交互状态实战。

---

> 上一章：[第 5 章 响应式设计](./05-responsive-design.md) | 返回目录：[README](./README.md) | 下一章：[第 7 章 深色模式](./07-dark-mode.md)
