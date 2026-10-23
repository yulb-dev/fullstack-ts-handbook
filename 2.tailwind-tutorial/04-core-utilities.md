# 第 4 章：常用 utility 体系详解

> 上一章：[第 3 章 utility-first 核心思想](./03-utility-first-thinking.md) | 返回目录：[README](./README.md) | 下一章：[第 5 章 响应式设计](./05-responsive-design.md)

本章把最常用的工具类按职责分门别类讲一遍：间距、尺寸、排版、颜色、边框、阴影、flex、grid、定位、z-index、溢出、容器宽度。第一遍通读建立整体印象即可，之后当查询手册用——实际开发中配合 IntelliSense 补全和官方文档（每个 utility 页面都有完整示例），你不需要背。

## 4.0 先掌握三条通用规则

所有工具类共享的构词法，掌握了它们就等于掌握了"举一反三"的钥匙：

### 规则一：间距刻度

大量类名（padding、margin、gap、width、height、inset…）共用一套数字刻度，基准是 `--spacing: 0.25rem`：

| 数字  | 实际值          | 数字 | 实际值           |
| ----- | --------------- | ---- | ---------------- |
| `0`   | 0               | `4`  | 1rem (16px)      |
| `px`  | 1px             | `5`  | 1.25rem (20px)   |
| `0.5` | 0.125rem (2px)  | `6`  | 1.5rem (24px)    |
| `1`   | 0.25rem (4px)   | `8`  | 2rem (32px)      |
| `1.5` | 0.375rem (6px)  | `12` | 3rem (48px)      |
| `2`   | 0.5rem (8px)    | `16` | 4rem (64px)      |
| `2.5` | 0.625rem (10px) | `24` | 6rem (96px)      |
| `3`   | 0.75rem (12px)  | …    | 数字越大步长越粗 |

**记忆方法**：数字 × 4 = 像素数（`p-4` = 16px，`gap-6` = 24px）。v4 中刻度是动态生成的，`mt-17`、`w-29` 这类"非标准数字"也合法（自动算 17 × 0.25rem）。

### 规则二：方向与取值的后缀语义

- `p-4` 全方向 padding；`px-4` 水平（x 轴）；`py-4` 垂直（y 轴）；`pt-4` / `pr-4` / `pb-4` / `pl-4` 单方向；
- v4 推荐逻辑属性：`ps-4`（padding-inline-start）、`pe-4`（end）、`ms-4` / `me-4`（margin 同理）——在 RTL（从右到左）语言下自动翻转，`start`/`end` 比 `left`/`right` 更语义化；
- 同一模式适用于 `m`（margin）、`inset`（定位偏移）、`space`（子元素间距）等家族。

### 规则三：任意值方括号语法

主题刻度里没有的值，用方括号现场指定：

```html
<div
  class="mt-[17px] bg-[#316ff6] grid-cols-[24rem_2.5rem_minmax(0,1fr)]"
></div>
```

- 方括号内就是 CSS 值，**空格必须写成下划线**（类名里不能有空格）；
- 引用 CSS 变量用圆括号简写：`bg-(--brand-color)`，等价于 `bg-[var(--brand-color)]`；
- 甚至能写任意属性：`[--gutter-width:1rem]`；
- **原则**：任意值是逃生舱。同一个值出现第三次，就该考虑把它变成主题 token（第 8 章），而不是继续散落方括号。

## 4.1 布局 display 与容器宽度

```html
<div class="block">
  <!-- display: block -->
  <div class="inline-block">
    <div class="flex">
      <!-- display: flex -->
      <div class="inline-flex">
        <div class="grid">
          <!-- display: grid -->
          <div class="contents">
            <div class="hidden"><!-- display: none --></div></div
          >
        </div></div
      >
    </div>
  </div>
</div>
```

容器宽度控制"内容列"的宽度，是页面骨架的基础：

```html
<!-- max-w-* 限制最大宽度，配合 mx-auto 水平居中 -->
<main class="mx-auto max-w-3xl px-4">
  <!-- max-w-3xl = 48rem = 768px，正文阅读的舒适宽度 -->
</main>
```

常用 `max-w-*` 取值（来自 `--container-*` 命名空间，与容器查询共用）：

| 类名                        | 宽度            | 典型用途                 |
| --------------------------- | --------------- | ------------------------ |
| `max-w-sm`                  | 24rem           | 卡片、弹层               |
| `max-w-md`                  | 28rem           | 表单、登录框             |
| `max-w-lg` / `max-w-xl`     | 32 / 36rem      | 窄内容列                 |
| `max-w-2xl` / `max-w-3xl`   | 42 / 48rem      | 文章正文                 |
| `max-w-5xl` / `max-w-7xl`   | 64 / 80rem      | 宽版页面骨架             |
| `max-w-full` / `max-w-none` | 100% / 解除限制 | 特殊场景                 |
| `max-w-prose`               | 65ch            | 按字符数限制的"可读行宽" |

> 注意 v4 中独立的 `container` 类不再有 v3 的 `center`/`padding` 配置项；要定制它，用 `@utility container { margin-inline: auto; padding-inline: 2rem; }` 扩展。日常更推荐直接用 `mx-auto max-w-*` 组合，语义更清晰。

**标准页面骨架配方**（记住它，到处能用）：

```html
<body>
  <header class="border-b border-gray-200">
    <div
      class="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8"
    >
      <!-- 导航内容：宽度受限、垂直居中、两端对齐 -->
    </div>
  </header>
  <main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
    <!-- 页面主体 -->
  </main>
</body>
```

背景色铺满全屏（挂在 header/main 上），内容宽度受限并居中（挂在内层 div 上）——**两层结构**是所有落地页的通用骨架。

## 4.2 Flexbox：一维布局

父容器（flex container）：

```html
<div class="flex">
  <!-- 开启 flex，默认横向 -->
  <div class="flex flex-col">
    <!-- 纵向 -->
    <div class="flex flex-wrap"><!-- 允许换行 --></div>
  </div>
</div>
```

主轴对齐 `justify-*`、交叉轴对齐 `items-*`、多行对齐 `content-*`：

```html
<div class="flex justify-between items-center">
  <!-- justify-between：两端对齐，中间均分——导航栏标配 -->
  <!-- items-center：交叉轴（此处为垂直）居中 -->
</div>
```

| 需求     | justify-\*                          | items-\*                                           |
| -------- | ----------------------------------- | -------------------------------------------------- |
| 起始对齐 | `justify-start`                     | `items-start`                                      |
| 居中     | `justify-center`                    | `items-center`                                     |
| 末端对齐 | `justify-end`                       | `items-end`                                        |
| 两端对齐 | `justify-between`                   | —                                                  |
| 环绕留边 | `justify-around` / `justify-evenly` | —                                                  |
| 基线对齐 | —                                   | `items-baseline`（文字基线对齐，混排不同字号时用） |
| 拉伸填满 | —                                   | `items-stretch`（默认值）                          |

子元素（flex item）：

```html
<div class="flex-1">
  <!-- flex: 1 1 0%：按比例填满剩余空间 -->
  <div class="flex-auto">
    <!-- flex: 1 1 auto：按内容 + 比例分配 -->
    <div class="flex-none">
      <!-- flex: none：完全不伸缩 -->
      <div class="grow">
        <!-- flex-grow: 1 -->
        <div class="shrink-0">
          <!-- flex-shrink: 0：禁止被压扁——固定尺寸图标/头像必加 -->
          <div class="basis-64"><!-- flex-basis: 16rem：伸缩的起始尺寸 --></div>
        </div>
      </div>
    </div>
  </div>
</div>
```

间距用 `gap`（现代做法，替代旧式 `space-x-*`）：

```html
<div class="flex gap-4">
  <!-- 所有方向间隙 1rem -->
  <div class="flex gap-x-6 gap-y-2">
    <!-- 水平 1.5rem、垂直 0.5rem 分开控制 -->
  </div>
</div>
```

**经典配方集**：

```html
<!-- 1. 水平垂直完全居中 -->
<div class="flex items-center justify-center">…</div>

<!-- 2. 导航栏：logo 在左，菜单在右 -->
<nav class="flex items-center justify-between">…</nav>

<!-- 3. 头像 + 文字，头像不被压扁 -->
<div class="flex items-center gap-3">
  <img class="size-10 shrink-0 rounded-full" src="…" alt="" />
  <div class="min-w-0">
    <!-- min-w-0 是让子项内 truncate 生效的关键，见 4.8 -->
    <p class="truncate font-medium">很长很长的名字…</p>
  </div>
</div>

<!-- 4. 输入框内嵌按钮：输入框吃掉全部空间 -->
<div class="flex gap-2">
  <input class="flex-1 rounded-md border border-gray-300 px-3 py-2" />
  <button class="shrink-0 rounded-md bg-blue-600 px-4 text-white">搜索</button>
</div>

<!-- 5. 底部固定操作条（sticky footer 的一部分） -->
<div class="flex justify-end gap-3 border-t border-gray-200 p-4">
  <button class="…">取消</button>
  <button class="…">确定</button>
</div>
```

> `space-x-4` 这类旧工具仍然可用，但官方建议新代码优先 `flex/grid + gap`：gap 是原生 CSS 属性，行为更可预测（v4 还改了 space-between 的选择器实现以修复性能问题，行为与 v3 略有差异）。

## 4.3 Grid：二维布局

```html
<div class="grid grid-cols-3">
  <!-- 三等分列 -->
  <div class="grid grid-cols-2 gap-4">
    <!-- 两列 + 1rem 间隙 -->
    <div class="grid grid-rows-2"><!-- 控制行 --></div>
  </div>
</div>
```

列定义的完整表达力：

```html
<!-- 分数比例：侧边栏 1 份、主内容 3 份 -->
<div class="grid grid-cols-[1fr_3fr]">
  <!-- 混合固定与弹性：24rem 侧栏 + 自适应主区（minmax(0,1fr) 防溢出，见下） -->
  <div class="grid grid-cols-[24rem_minmax(0,1fr)]">
    <!-- 自动填充响应式卡片网格：不用任何断点就能自适应列数！ -->
    <div
      class="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-6"
    ></div>
  </div>
</div>
```

跨行跨列与起始位置：

```html
<div class="grid grid-cols-4">
  <div class="col-span-2">占两列</div>
  <div class="col-span-2 row-span-2">占两列两行</div>
  <div class="col-start-1">从第 1 列开始</div>
</div>
```

**两个高频坑**：

1. **`minmax(0, 1fr)` vs `1fr`**：`1fr` 的完整含义是 `minmax(auto, 1fr)`，最小宽度是内容宽度——如果格子里有长文本或图片，列会被撑破。想让格子严格遵守比例，写 `minmax(0, 1fr)`（v4 内置的 `grid-cols-1~12` 已经用了 `minmax(0,1fr)`，自定义列时要自己注意）。
2. **隐式行**：内容超出显式定义的 `grid-rows-*` 时会自动生成隐式行，用 `auto-rows-min` / `auto-rows-fr` / `grid-flow-row-dense` 控制隐式行为。

flex 还是 grid？**一维（一行或一列的排列、导航栏、按钮组）用 flex；二维（行列同时对齐的网格、页面骨架、卡片墙）用 grid**。两者可任意嵌套组合。

## 4.4 尺寸 width / height / size

```html
<div class="w-64">
  <!-- width: 16rem，走间距刻度 -->
  <div class="w-1/2">
    <!-- width: 50%，分数语法 -->
    <div class="w-screen">
      <!-- width: 100vw -->
      <div class="w-full">
        <!-- width: 100% -->
        <div class="w-auto">
          <div class="min-w-0 max-w-md">
            <!-- 最小/最大宽度 -->
            <div class="h-10">
              <!-- height: 2.5rem -->
              <div class="h-dvh">
                <!-- height: 100dvh：动态视口高度，移动端全屏布局的正确姿势 -->
                <div class="size-12">
                  <!-- width 和 height 同时设为 3rem，正方形快捷方式 -->
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

- `size-*` 是 v4 的高频类：图标、头像、缩略图都是正方形，一个类搞定；
- 移动端全屏优先用 `h-dvh`（dynamic viewport height）而不是 `h-screen`（100vh）——移动浏览器的地址栏伸缩会让 `100vh` 超出可视区，`dvh` 动态适配；
- `aspect-video`（16/9）、`aspect-square`（1/1）、`aspect-[4/3]` 控制宽高比，做响应式图片/视频容器必备：
  ```html
  <div class="aspect-video w-full overflow-hidden rounded-lg">
    <img class="size-full object-cover" src="…" alt="" />
  </div>
  ```

`object-*` 控制替换元素（img/video）内容如何填充盒子：

```html
<img class="size-32 object-cover" />
<!-- 保比例裁切填满（最常用） -->
<img class="size-32 object-contain" />
<!-- 保比例完整显示，可能留白 -->
<img class="object-center" />
<!-- 对齐位置，还有 object-top 等 -->
```

## 4.5 间距 padding / margin

```html
<div class="p-4">
  <!-- 四边 padding 1rem -->
  <div class="px-6 py-3">
    <!-- 水平 1.5rem、垂直 0.75rem——按钮的标准配方 -->
    <div class="pt-8">
      <!-- 只加上边 -->
      <div class="m-0">
        <!-- margin 同理 -->
        <div class="mx-auto">
          <!-- 水平外边距 auto = 水平居中（配合限宽） -->
          <div class="-mt-4">
            <!-- 负 margin：叠压布局、出血效果 -->
            <div class="space-y-4">
              <!-- 除第一个外的所有直接子元素加 margin-top: 1rem -->
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

经验法则：

- **组件内部间距用 padding**（背景色、边框会包住它），**组件之间的间距用 margin 或父容器的 gap**；
- 垂直列表优先 `flex flex-col gap-*` 而不是 `space-y-*`（见 4.2 的说明）；
- `p-0.5`（2px）这类小值常用来做"内衬"，比如给头像加白色描边圈：`ring-2 ring-white p-0.5 bg-white`。

## 4.6 排版 text / font / leading / tracking

字号（来自 `--text-*`，自动携带配套行高）：

| 类名                    | 字号           | 场景           |
| ----------------------- | -------------- | -------------- |
| `text-xs`               | 0.75rem        | 辅助说明、徽标 |
| `text-sm`               | 0.875rem       | 次要正文、表格 |
| `text-base`             | 1rem           | 正文           |
| `text-lg`               | 1.125rem       | 小标题         |
| `text-xl` ~ `text-4xl`  | 1.25 ~ 2.25rem | 各级标题       |
| `text-5xl` ~ `text-9xl` | 3 ~ 8rem       | 落地页大标题   |

```html
<h1 class="text-4xl font-extrabold tracking-tight">落地页大标题</h1>
<!-- tracking-tight：字距收紧，大字号标题几乎必配，否则显得松散 -->

<p class="text-base leading-relaxed text-gray-600">
  <!-- leading-relaxed = 行高 1.625，长文阅读更舒适 -->
</p>
```

其他常用：

```html
<div class="font-sans">
  <!-- 字体族：font-sans / font-serif / font-mono，主题可扩展 -->
  <div class="font-semibold">
    <!-- 字重：font-thin(100) ~ font-black(900) -->
    <div class="text-center">
      <!-- 对齐：text-left / text-right / text-justify -->
      <div class="uppercase">
        <!-- 大小写：lowercase / capitalize / normal-case -->
        <div class="italic">
          <div class="underline">
            <!-- decoration-* 可控下划线样式 -->
            <div class="truncate">
              <!-- = overflow-hidden + text-ellipsis + whitespace-nowrap 三合一 -->
              <div class="line-clamp-2">
                <!-- 多行截断，超出两行显示省略号 -->
                <div class="whitespace-nowrap">
                  <div class="tabular-nums">
                    <!-- 等宽数字：表格里的数字列对齐必备 -->
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

字号 + 行高联写：`text-sm/6` 表示字号 sm、行高 1.5rem（6 × 0.25rem），紧凑写法。

## 4.7 颜色、透明度与阴影

### 颜色家族

同一个色板作用于不同属性，前缀区分：

```html
<div class="text-gray-700">
  <!-- 文字颜色 -->
  <div class="bg-gray-100">
    <!-- 背景颜色 -->
    <div class="border-gray-200">
      <!-- 边框颜色 -->
      <div class="ring-blue-500">
        <!-- ring 颜色 -->
        <div class="fill-current">
          <!-- SVG 填充 -->
          <div class="stroke-gray-400">
            <!-- SVG 描边 -->
            <div class="accent-blue-600">
              <!-- 原生表单控件（checkbox/radio）强调色 -->
              <div class="caret-blue-600">
                <!-- 文本光标颜色 -->
                <div class="placeholder:text-gray-400">
                  <!-- 占位符颜色（用变体写法） -->
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

默认色板：22 个色相（red/orange/amber/yellow/lime/green/emerald/teal/cyan/sky/blue/indigo/violet/purple/fuchsia/pink/rose/slate/gray/zinc/neutral/stone…），每色 50~950 共 11 档亮度。**50 最浅、950 最深**，这个规律全书通用。

### 透明度修饰符

任意颜色类后加 `/数字` 控制不透明度：

```html
<div class="bg-black/50">
  <!-- 50% 透明的黑——遮罩层标配 -->
  <div class="bg-blue-600/10">
    <!-- 10% 透明的品牌色——浅色底衬 -->
    <div class="text-white/80"><!-- 深色背景上的柔和白字 --></div>
  </div>
</div>
```

这个语法也可以用于任意值：`bg-[#316ff6]/75`。v3 的 `bg-opacity-*` 系列在 v4 已删除，`/` 修饰符是唯一写法。

### 边框与圆角

```html
<div class="border">
  <!-- 1px 实线边框，颜色默认 currentColor（v4！） -->
  <div class="border-2 border-gray-200">
    <!-- 显式给宽度与颜色——常规写法 -->
    <div class="border-t">
      <!-- 只有上边框；border-b / border-l / border-x… -->
      <div class="rounded-lg">
        <!-- 圆角 0.5rem；rounded-none/sm/md/xl/2xl/3xl -->
        <div class="rounded-full">
          <!-- 全圆角：胶囊按钮、圆形头像 -->
          <div class="rounded-t-xl">
            <!-- 只圆上边两角 -->
            <div class="border-dashed">
              <!-- 虚线；dotted / double / none -->
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

**v4 特别提醒**：`border` 不带颜色时是 `currentColor`（跟随文字颜色），想要浅灰分隔线必须写 `border-gray-200`。这是 v3 → v4 迁移最常见的视觉回归。

### ring：box-shadow 实现的焦点环

```html
<button class="focus-visible:ring-3 focus-visible:ring-blue-500">
  <!-- ring-3 = 3px 宽的环（v4 中裸 ring 默认 1px，v3 是 3px） -->
  <div class="ring-2 ring-offset-2 ring-offset-white ring-gray-900/5">
    <!-- ring-offset-* 产生"双层环"效果，常用于选中态卡片 -->
  </div>
</button>
```

ring 不占布局空间（是 shadow 实现），适合做焦点指示和轻量的选中描边；border 会改变盒子尺寸，适合做真实的边框。

### 阴影

```html
<div class="shadow-sm">
  <!-- 注意：v4 的 shadow-sm ≈ v3 的 shadow -->
  <div class="shadow-md">
    <!-- 卡片常态 -->
    <div class="shadow-lg">
      <!-- 悬浮卡片、下拉菜单 -->
      <div class="shadow-xl">
        <!-- 模态框 -->
        <div class="shadow-none">
          <div class="shadow-blue-500/50">
            <!-- 彩色阴影：shadow-<color> 修饰 shadow-* -->
            <div class="inset-shadow-sm"><!-- 内阴影 --></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

阴影层级语义要统一：团队约定好"卡片用 md、悬浮用 lg、模态用 xl"，不要随手乱选——这就是设计一致性的日常实践。

## 4.8 溢出、文本截断与滚动

```html
<div class="overflow-hidden">
  <!-- 裁掉溢出内容（圆角容器裁图片必备） -->
  <div class="overflow-auto">
    <!-- 溢出时才出滚动条 -->
    <div class="overflow-scroll">
      <!-- 始终可滚动 -->
      <div class="overflow-x-auto">
        <!-- 只控制水平方向——响应式表格的救星 -->
        <div class="overflow-visible"><!-- 默认值，不裁切 --></div>
      </div>
    </div>
  </div>
</div>
```

**响应式宽表格的标准解法**——外层包一个横向滚动容器：

```html
<div class="overflow-x-auto rounded-lg border border-gray-200">
  <table class="w-full min-w-[40rem] text-sm">
    <!-- min-w 保证表格在小屏上不被挤烂，超出部分横向滚动 -->
  </table>
</div>
```

文本截断三兄弟：

```html
<p class="truncate">单行截断，超出显示 …</p>
<p class="line-clamp-3">最多三行，超出显示 …</p>
<p class="text-ellipsis overflow-hidden">手动组合版</p>
```

**truncate 在 flex/grid 里失效？** 因为 flex 子项的默认最小宽度是内容宽度。解法：给包含 truncate 的那一层加 `min-w-0`：

```html
<div class="flex items-center gap-3">
  <img class="size-10 shrink-0" src="…" alt="" />
  <div class="min-w-0 flex-1">
    <!-- 关键：min-w-0 -->
    <p class="truncate font-medium">很长的标题会被正确截断…</p>
  </div>
</div>
```

滚动行为微调：`scroll-smooth`（平滑滚动）、`snap-*`（滚动吸附做轮播）、`overscroll-contain`（阻止滚动链，弹窗内滚动必备）。

## 4.9 定位与 z-index

```html
<div class="static">
  <!-- 默认 -->
  <div class="relative">
    <!-- 相对定位：给绝对定位子元素当锚点 -->
    <div class="absolute">
      <!-- 绝对定位：相对最近的非 static 祖先 -->
      <div class="fixed">
        <!-- 视口定位：顶栏、悬浮按钮 -->
        <div class="sticky top-0">
          <!-- 滚动到阈值后粘住：吸顶表头、吸底操作条 -->
        </div>
      </div>
    </div>
  </div>
</div>
```

偏移量：`top-* / right-* / bottom-* / left-*`，v4 推荐逻辑属性 `start-* / end-*`（RTL 友好），以及四边一次到位的 `inset-*`：

```html
<!-- 全覆盖（遮罩层的本质）： -->
<div class="absolute inset-0 bg-black/50"></div>

<!-- 徽章：钉在头像右上角 -->
<div class="relative">
  <img class="size-12 rounded-full" src="…" alt="" />
  <span
    class="absolute -top-1 -right-1 size-4 rounded-full bg-green-500 ring-2 ring-white"
  ></span>
</div>
```

z-index 层级：`z-0`、`z-10`、`z-20`、`z-30`、`z-40`、`z-50`，负值 `z--1`（v4 写法，等价旧的 `-z-10`），任意值 `z-[100]`。

**z-index 心法（比类名更重要）**：

1. 十档刻度足够绝大多数项目。**团队约定一张层级表**并写进文档，例如：内容 0 / 悬浮卡片 10 / 吸顶导航 20 / 下拉菜单 30 / 侧边抽屉 40 / 模态框 50；
2. z-index 只在**同一层叠上下文**内比较。父元素若有 `transform`、`opacity < 1`、`filter` 等属性会创建新层叠上下文，子元素的 `z-50` 可能仍被外面的 `z-10` 盖住——这时该调整 DOM 结构或父级样式，而不是无脑加大数字；
3. 出现 `z-[9999]` 说明层级管理已经失控，回到第 1 条。

## 4.10 过渡与动画（交互质感的来源）

```html
<button class="bg-blue-600 transition hover:bg-blue-700">
  <!-- transition：对常用属性（颜色、阴影、transform、opacity 等）加 150ms 过渡 -->

  <div class="transition-all duration-300 ease-out">
    <!-- 全部属性 / 300ms / 缓出 -->
    <div class="animate-spin">
      <!-- 内置动画：加载圈 -->
      <div class="animate-pulse">
        <!-- 呼吸闪烁：骨架屏 -->
        <div class="animate-ping">
          <!-- 扩散波纹：红点提醒 -->
          <div class="animate-bounce"></div>
        </div>
      </div>
    </div>
  </div>
</button>
```

hover 变色不加 `transition` 会显得生硬；但 `transition-all` 慎用（性能开销大），用默认的 `transition` 或 `transition-colors` 更精准。自定义动画通过 `--animate-*` 主题变量 + `@keyframes` 定义（第 8 章）。

## 练习：拼一个"统计卡片"

用本章知识复刻这个结构（答案提示都在正文里，去 [Playground](https://play.tailwindcss.com/) 验证）：

```
┌────────────────────────────┐
│ [icon]  月活跃用户      ↑12% │   <- 图标在左(flex+shrink-0)，百分比右对齐
│         12,482              │   <- 大数字(tabular-nums)
│  ────────────────────────   │   <- 分隔线(border-t)
│  较上月 +1,332              │   <- 次要文字(text-sm text-gray-500)
└────────────────────────────┘
     卡片: rounded-xl border bg-white p-6 shadow-sm
     hover 时 shadow-md + transition
```

<details>
<summary>参考答案</summary>

```html
<div
  class="rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition hover:shadow-md"
>
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-3">
      <span
        class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600"
      >
        <!-- 这里放 SVG 图标 -->
        👤
      </span>
      <span class="text-sm font-medium text-gray-500">月活跃用户</span>
    </div>
    <span
      class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700"
      >↑12%</span
    >
  </div>
  <p class="mt-4 text-3xl font-bold tabular-nums text-gray-900">12,482</p>
  <div class="mt-4 border-t border-gray-100 pt-4">
    <p class="text-sm text-gray-500">
      较上月 <span class="font-medium text-gray-700">+1,332</span>
    </p>
  </div>
</div>
```

</details>

## 本章小结与自检

- [ ] 掌握三条通用规则：间距刻度（数字×4=px）、方向后缀（x/y/t/s/e…）、任意值方括号（空格用下划线、变量用圆括号）；
- [ ] 能写出标准页面骨架（背景全宽 + `mx-auto max-w-*` 内容列）；
- [ ] flex：会用 justify/items 对齐、`flex-1`/`shrink-0` 分配空间、`gap` 控制间距，能说出 5 个经典配方中至少 3 个的场景；
- [ ] grid：会用 `grid-cols-*`、`col-span-*`、`minmax(0,1fr)` 防溢出、`auto-fill+minmax` 免断点自适应网格；
- [ ] 会用 `size-*`、`h-dvh`、`aspect-*`、`object-cover` 控制尺寸与媒体；
- [ ] 颜色体系：色相-亮度（gray-200）+ 透明度修饰符（`/50`）；知道 v4 边框默认 currentColor；
- [ ] 能解释 ring 与 border 的区别；团队式地使用阴影层级；
- [ ] 会用 `overflow-x-auto` 包表格、`truncate + min-w-0` 截断文本；
- [ ] 定位五兄弟 + `inset-0` 全覆盖 + z-index 层级表心法；
- [ ] 交互元素记得配 `transition`。

---

> 上一章：[第 3 章 utility-first 核心思想](./03-utility-first-thinking.md) | 返回目录：[README](./README.md) | 下一章：[第 5 章 响应式设计](./05-responsive-design.md)
