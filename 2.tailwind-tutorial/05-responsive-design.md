# 第 5 章：响应式设计

> 上一章：[第 4 章 常用 utility 体系详解](./04-core-utilities.md) | 返回目录：[README](./README.md) | 下一章：[第 6 章 状态变体](./06-state-variants.md)

响应式是 Tailwind 的看家本领：**任何**工具类都能加断点前缀，媒体查询从此不用手写。本章讲透断点系统、移动端优先思维、区间定位和容器查询，最后用实战把 TaskBoard 项目做成响应式。

## 5.1 前提：viewport meta 标签

再强调一次，没有它一切响应式都失效（移动端浏览器会以 980px 左右的虚拟视口渲染页面）：

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

## 5.2 默认断点

Tailwind 内置五个断点（v4 默认值，单位是 rem）：

| 前缀   | 最小宽度       | 生成的 CSS                      | 大致对应设备     |
| ------ | -------------- | ------------------------------- | ---------------- |
| `sm:`  | 40rem (640px)  | `@media (width >= 40rem) { … }` | 大屏手机（横屏） |
| `md:`  | 48rem (768px)  | `@media (width >= 48rem) { … }` | 平板             |
| `lg:`  | 64rem (1024px) | `@media (width >= 64rem) { … }` | 笔记本           |
| `xl:`  | 80rem (1280px) | `@media (width >= 80rem) { … }` | 桌面显示器       |
| `2xl:` | 96rem (1536px) | `@media (width >= 96rem) { … }` | 大屏             |

用法就是加前缀：

```html
<!-- 默认宽 4rem，md 以上 8rem，lg 以上 12rem -->
<img class="w-16 md:w-32 lg:w-48" src="…" alt="" />
```

**任何**类都能加前缀——不只是布局，字距、光标、阴影统统可以：

```html
<h1 class="text-2xl tracking-normal md:text-4xl md:tracking-tight"></h1>
```

## 5.3 移动端优先：最重要的思维方式

Tailwind 的断点是 **min-width**（"至少这么宽才生效"），所以整套体系是移动端优先的：

- **不带前缀的类 = 所有尺寸都生效**（这就是你的移动端样式）；
- **带前缀的类 = 到达该断点及以上才生效**，并覆盖同属性的无前缀类。

新手最容易犯的错：

```html
<!-- ❌ 错误理解：以为 sm: 是"手机上的样式" -->
<div class="sm:text-center"></div>
<!-- 实际效果：640px 以下不居中，640px 以上才居中——恰好和你想的相反 -->

<!-- ✅ 正确：无前缀 = 移动端，前缀 = 往大屏覆盖 -->
<div class="text-center sm:text-left"></div>
<!-- 手机上居中，640px 以上左对齐 -->
```

官方给出的心智转换：**不要把 `sm:` 读作"在小屏幕上"，要读作"在小断点及以上"**。

推荐的工作流程也由此确定：**先写移动端布局（不带前缀），再逐层叠加 sm、md、lg 的调整**。这样小屏样式是"基线"，大屏样式是"渐进增强"，代码顺序和覆盖顺序一致，可读性最好。

### 官方经典示例解读

```html
<div
  class="mx-auto max-w-md overflow-hidden rounded-xl bg-white shadow-md md:max-w-2xl"
>
  <div class="md:flex">
    <div class="md:shrink-0">
      <img
        class="h-48 w-full object-cover md:h-full md:w-48"
        src="/img/building.jpg"
        alt="Modern building architecture"
      />
    </div>
    <div class="p-8">
      <div
        class="text-sm font-semibold uppercase tracking-wide text-indigo-500"
      >
        Company retreats
      </div>
      <a
        href="#"
        class="mt-1 block text-lg font-medium leading-tight text-black hover:underline"
      >
        Incredible accommodation for your team
      </a>
      <p class="mt-2 text-gray-500">
        Looking to take your team away on a retreat to enjoy awesome food and
        take in some sunshine?
      </p>
    </div>
  </div>
</div>
```

阅读方法（每个类问自己"移动端是什么样、md 以上变成什么样"）：

- 外层：移动端最宽 `max-w-md`，md 以上放宽到 `max-w-2xl`；
- 内容行：移动端是普通块级流（图上文下），`md:flex` 后变成左右并排；
- 图片：移动端全宽固定高（`h-48 w-full object-cover`），md 以上变成左侧竖条（`md:h-full md:w-48`）；
- `md:shrink-0`：flex 布局下图片禁止被压缩。

## 5.4 区间与单断点定位：max-\* 变体

`md:flex` 会一直生效到更大的断点。如果只想在**某个区间**内生效，把断点变体和 `max-*` 变体堆叠：

```html
<!-- 只在 md ~ xl 之间（768px ≤ 宽 < 1280px）flex -->
<div class="md:max-xl:flex">
  <!-- 只在 md 这一个断点段内（768px ≤ 宽 < 1024px）flex -->
  <div class="md:max-lg:flex"></div>
</div>
```

每个断点都有对应的 `max-*` 变体：

| 变体       | 媒体查询                 |
| ---------- | ------------------------ |
| `max-sm:`  | `@media (width < 40rem)` |
| `max-md:`  | `@media (width < 48rem)` |
| `max-lg:`  | `@media (width < 64rem)` |
| `max-xl:`  | `@media (width < 80rem)` |
| `max-2xl:` | `@media (width < 96rem)` |

**实践建议**：绝大多数情况坚持纯移动端优先（只用 min-width 前缀）；`max-*` 留给确实需要"只在这个区间"的场景（比如给中间尺寸单独的导航形态）。混着用太多会让覆盖关系难以推理。

## 5.5 自定义断点

断点由 `--breakpoint-*` 主题变量驱动，在 CSS 里直接改（v4 的 CSS-first 配置，无需 JS config）：

```css
@import "tailwindcss";

@theme {
  /* 新增两个断点 */
  --breakpoint-xs: 30rem;
  --breakpoint-3xl: 120rem;
  /* 修改默认断点 */
  --breakpoint-2xl: 100rem;
}
```

```html
<div class="grid grid-cols-2 xs:grid-cols-3 3xl:grid-cols-6"></div>
```

删除默认断点用 `initial`：

```css
@theme {
  --breakpoint-2xl: initial; /* 只删 2xl */

  /* 或者推倒重来，全部自定义： */
  --breakpoint-*: initial;
  --breakpoint-tablet: 40rem;
  --breakpoint-laptop: 64rem;
  --breakpoint-desktop: 80rem;
}
```

两个注意点：

1. **单位必须统一**（默认全是 rem，新增也用 rem）。混用 px 和 rem 会导致生成的工具类排序错乱，断点之间互相意外覆盖；
2. 一次性断点不值得进主题，直接用任意值变体：
   ```html
   <div class="max-[600px]:bg-sky-300 min-[320px]:text-center"></div>
   ```

## 5.6 容器查询：组件级响应式（v4 内置）

### 为什么需要它

媒体查询看的是**视口**宽度，但组件真正关心的是**自己可用空间**的宽度。同一个 `<UserCard>` 放进侧边栏（窄）和主内容区（宽），视口是一样的，需要的布局却不同。容器查询（container queries）让组件根据**父容器尺寸**自适应——组件因此真正可移植。

### 基本用法

v4 中容器查询是内置功能（v3 需要单独装插件），父元素标 `@container`，子元素用 `@sm`、`@md` 等变体：

```html
<div class="@container">
  <div class="flex flex-col @md:flex-row">
    <!-- 容器宽度 ≥ 28rem 时横排 -->
  </div>
</div>
```

同样是移动端优先："@md:flex-row" 读作"容器达到 @md 尺寸及以上时"。

### 完整变体家族

```html
<!-- 区间与单段：和断点的 max-* 一个套路 -->
<div class="@sm:@max-md:flex-col">
  <!-- 命名容器：嵌套多个容器时指定参照谁 -->
  <div class="@container/main">
    <div class="@sm/main:flex-col">…</div>
  </div>

  <!-- 任意值 -->
  <div class="@min-[475px]:flex-row">
    <!-- 容器查询长度单位：cqw = 容器宽度的 1% -->
    <div class="w-[50cqw]">
      <!-- 需要依赖容器高度（cqb/cqh）时，用 size 容器 -->
      <div class="@container-size">
        <div class="h-[50cqb]">…</div>
      </div>
    </div>
  </div>
</div>
```

### 容器尺寸对照表

| 变体   | 最小宽度 | 变体            | 最小宽度      |
| ------ | -------- | --------------- | ------------- |
| `@3xs` | 16rem    | `@xl`           | 36rem         |
| `@2xs` | 18rem    | `@2xl`          | 42rem         |
| `@xs`  | 20rem    | `@3xl`          | 48rem         |
| `@sm`  | 24rem    | `@4xl`          | 56rem         |
| `@md`  | 28rem    | `@5xl`          | 64rem         |
| `@lg`  | 32rem    | `@6xl` / `@7xl` | 72rem / 80rem |

自定义容器尺寸：`--container-8xl: 96rem;`（注意 `--container-*` 同时驱动 `max-w-*` 类，见第 4 章）。

### 什么时候用容器查询，什么时候用媒体查询

- **页面级骨架**（导航折叠、侧栏显隐、整体几列）→ 媒体查询断点 `md:` `lg:`；
- **可复用组件内部**（卡片、列表项、widget 的形态切换）→ 容器查询 `@container` + `@md:`；
- 一个实用信号：当你想把某个组件复制到另一个位置却发现布局崩了、需要为位置单独调断点——就该改成容器查询。

## 5.7 实战：TaskBoard 响应式布局

现在开始贯穿后面章节的实战项目。这一节先做静态的响应式骨架（交互状态、深色模式在后续章节叠加）。

需求：一个任务看板页——顶部导航；移动端单列任务卡片，md 三列；每张卡片有标题、标签、负责人头像、截止日期；表格视图在移动端可横向滚动。

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TaskBoard</title>
    <link rel="stylesheet" href="/src/index.css" />
  </head>
  <body class="bg-gray-100 font-sans text-gray-900 antialiased">
    <!-- ===== 顶部导航：两层结构，背景全宽 + 内容限宽 ===== -->
    <header class="border-b border-gray-200 bg-white">
      <div
        class="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8"
      >
        <span class="text-lg font-bold tracking-tight">📋 TaskBoard</span>
        <!-- 桌面端水平菜单；移动端隐藏（第 6、10 章再加汉堡菜单） -->
        <nav class="hidden items-center gap-1 md:flex" aria-label="主导航">
          <a
            href="#"
            class="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-900"
            >看板</a
          >
          <a
            href="#"
            class="rounded-lg px-3 py-2 text-sm font-medium text-gray-600"
            >日程</a
          >
          <a
            href="#"
            class="rounded-lg px-3 py-2 text-sm font-medium text-gray-600"
            >报表</a
          >
        </nav>
        <img
          class="size-9 shrink-0 rounded-full ring-2 ring-gray-200"
          src="/img/avatar.jpg"
          alt="我的头像"
        />
      </div>
    </header>

    <main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <!-- ===== 页头：移动端堆叠，sm 以上两端对齐 ===== -->
      <div
        class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
            产品迭代看板
          </h1>
          <p class="mt-1 text-sm text-gray-500">共 12 个任务 · 4 个进行中</p>
        </div>
        <button
          type="button"
          class="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm"
        >
          + 新建任务
        </button>
      </div>

      <!-- ===== 任务卡片网格：移动 1 列 → md 2 列 → lg 3 列 ===== -->
      <section
        class="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
        aria-label="任务列表"
      >
        <article
          class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          <div class="flex items-start justify-between gap-2">
            <h2 class="font-semibold leading-snug">重构登录页表单校验</h2>
            <span
              class="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800"
              >进行中</span
            >
          </div>
          <p class="mt-2 line-clamp-2 text-sm text-gray-500">
            将现有校验逻辑迁移到统一的 schema，补充错误提示的可访问性标签……
          </p>
          <div
            class="mt-4 flex items-center justify-between border-t border-gray-100 pt-4"
          >
            <div class="flex -space-x-2">
              <img
                class="size-7 rounded-full ring-2 ring-white"
                src="/img/a.jpg"
                alt="成员 A"
              />
              <img
                class="size-7 rounded-full ring-2 ring-white"
                src="/img/b.jpg"
                alt="成员 B"
              />
            </div>
            <time datetime="2026-10-30" class="text-xs text-gray-400"
              >10 月 30 日截止</time
            >
          </div>
        </article>

        <!-- 其余卡片结构相同，循环渲染时类名只写一次（第 3 章策略一） -->
      </section>

      <!-- ===== 宽表格：移动端横向滚动（第 4 章 4.8 的实战） ===== -->
      <section class="mt-12" aria-label="任务统计表">
        <h2 class="text-xl font-semibold">本周统计</h2>
        <div
          class="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white"
        >
          <table class="w-full min-w-[40rem] text-sm">
            <thead
              class="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"
            >
              <tr>
                <th class="px-4 py-3 font-medium">成员</th>
                <th class="px-4 py-3 font-medium">已完成</th>
                <th class="px-4 py-3 font-medium">进行中</th>
                <th class="px-4 py-3 font-medium">阻塞</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr>
                <td class="px-4 py-3 font-medium">Ada</td>
                <td class="px-4 py-3 tabular-nums">8</td>
                <td class="px-4 py-3 tabular-nums">2</td>
                <td class="px-4 py-3 tabular-nums">0</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  </body>
</html>
```

这个页面浓缩了本章全部要点，逐条对照：

- 页头 `flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`：移动端标题和按钮上下堆叠（按钮 `shrink-0` 不被压扁），sm 以上两端对齐——**先写移动端基线，再加前缀增强**；
- 卡片网格 `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`：1 → 2 → 3 列的经典渐进；
- 标题 `text-2xl sm:text-3xl`：字号也响应式；
- 内边距 `px-4 sm:px-6 lg:px-8`：屏幕越大，页边距越宽，官方骨架的标准配方；
- 导航 `hidden md:flex`：移动端整条隐藏（真实的汉堡菜单需要 JS 状态，第 10 章补全；也可以先用第 6 章的 peer 技巧做纯 CSS 版本）；
- 表格 `overflow-x-auto` + `min-w-[40rem]`：小屏不挤压、可滑动。

**练习**：把上面的代码跑起来，用 DevTools 的设备模拟器逐个断点检查布局；然后把卡片区改造成容器查询版——外层 `@container`，卡片内部描述文字用 `@lg:block hidden` 控制"容器够宽才显示详情"。

## 5.8 常见错误清单

| 错误                        | 后果                         | 纠正                                                                    |
| --------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| 用 `sm:` 写移动端样式       | 手机（<640px）上样式全部丢失 | 移动端用无前缀类                                                        |
| 断点单位混用 px/rem         | 工具类排序错乱、意外覆盖     | 统一用 rem                                                              |
| 每个断点都写一遍完整类名    | 冗余、难维护                 | 只写"变化的部分"：`text-center sm:text-left`，而不是两处都全量覆盖      |
| 依赖 `hover` 在触屏上的表现 | 触屏点按后样式"卡住"         | v4 的 hover 变体已只在支持悬停的设备生效（第 6 章），交互不要依赖 hover |
| 用媒体查询处理组件内部布局  | 组件换个位置就崩             | 容器查询 `@container`                                                   |
| flex 子项里长文本撑破布局   | 列宽失控                     | `min-w-0` + `truncate`（第 4 章 4.8）                                   |

## 本章小结与自检

- [ ] 能默写五个默认断点及其宽度（sm 40rem / md 48rem / lg 64rem / xl 80rem / 2xl 96rem）；
- [ ] 理解 min-width 语义，会用"无前缀=移动端基线"的方式组织类名；
- [ ] 能用 `md:max-xl:` 定位区间，知道何时该克制使用；
- [ ] 会用 `@theme { --breakpoint-* }` 增删改断点，知道单位必须统一；
- [ ] 能说出容器查询与媒体查询的适用分界，会写 `@container` + `@md:`；
- [ ] 完成 TaskBoard 响应式骨架并在设备模拟器下逐断点验证。

---

> 上一章：[第 4 章 常用 utility 体系详解](./04-core-utilities.md) | 返回目录：[README](./README.md) | 下一章：[第 6 章 状态变体：hover / focus / group / peer](./06-state-variants.md)
