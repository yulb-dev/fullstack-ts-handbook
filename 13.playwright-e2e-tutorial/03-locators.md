# 第 3 章：定位器——像用户一样找到元素

> 本章目标：掌握 Playwright 定位器体系：优先级的取舍（role / label / testid / CSS）、strictness 规则、`filter` 与链式收窄、列表操作。所有例子直接取自 TaskBoard lite 的真实标记与真实测试。
>
> 对应总目标：**locator 与语义化定位（getByRole、getByLabel、getByTestId 的取舍）；主要定位使用可访问角色或明确测试 id。**

---

## 3.1 定位器优先级：官方推荐的顺序

操作任何元素前都要先「找到」它。Playwright 提供一组内置定位器，官方推荐按下面的优先级选择：

| 优先级 | 定位器                            | 依据                                   | 适用                                               |
| ------ | --------------------------------- | -------------------------------------- | -------------------------------------------------- |
| 1      | `getByRole(role, { name })`       | 显式/隐式可访问性属性（W3C ARIA 规范） | 按钮、链接、标题、复选框、对话框……一切有角色的元素 |
| 2      | `getByLabel(text)`                | 表单控件关联的 `<label>`               | 输入框、下拉框                                     |
| 3      | `getByPlaceholder(text)`          | placeholder 属性                       | 没有 label 只有占位符的输入框                      |
| 4      | `getByText(text)`                 | 文本内容                               | 非交互元素（`div/span/p`）；交互元素用 role        |
| 5      | `getByAltText` / `getByTitle`     | alt / title 属性                       | 图片、带 title 的元素                              |
| 6      | `getByTestId(id)`                 | `data-testid` 属性（显式测试契约）     | 无法用上述方式唯一定位时                           |
| 7      | `locator(css)` / `locator(xpath)` | DOM 结构                               | **最后手段**，官方明确不推荐                       |

这个排序背后是一个统一原则：**越靠近「用户如何感知页面」的定位方式越稳定**。用户看到的是「一个叫『登录』的按钮」，不是「一个 class 为 `btn btn-primary` 的 DOM 节点」。前者改版时不变，后者说改就改。

### getByRole：首选

角色来自两种途径：`<button>`、`<a href>`、`<h1>`、`<dialog>` 等元素的**隐式角色**，以及 `role="alert"` 等**显式 ARIA 角色**。配合可访问名称（accessible name，通常是按钮文字、label 文本、aria-label）精确定位。

TaskBoard 登录页的标记：

```html
<h1 id="login-heading">登录 TaskBoard</h1>
<p id="login-error" class="error" role="alert" hidden></p>
<label for="email">邮箱</label>
<input id="email" name="email" type="email" required />
<button type="submit">登录</button>
```

对应的定位：

```ts
await expect(
  page.getByRole("heading", { name: "登录 TaskBoard" }),
).toBeVisible();
await page.getByRole("button", { name: "登录" }).click();
await expect(page.getByRole("alert")).toHaveText("邮箱或密码不正确");
```

`name` 选项的匹配规则：字符串默认**不区分大小写、搜索子串、忽略首尾空白**；要精确匹配传 `{ exact: true }`；也可以传正则：

```ts
page.getByRole("button", { name: /submit/i });
```

顺带的收益：`getByRole` 定位不到时，往往说明页面本身缺可访问性语义——官方文档的说法是「role locators give early feedback about the ARIA guidelines」。E2E 测试顺手当了无障碍的哨兵。

### getByLabel：表单控件专用

`<label for>`（或包裹式 label）关联的控件都可以用 label 文本定位。TaskBoard 的搜索框：

```html
<label for="search-input">搜索标题</label>
<input id="search-input" type="search" placeholder="输入关键词后按回车" />
```

```ts
await page.getByLabel("搜索标题").fill("发布说明");
await page.getByLabel("搜索标题").press("Enter");
```

对比 `page.locator('#search-input')`：id 是实现细节，label 是用户看到的东西。而且当有人把 label 文字从「搜索标题」改成「搜索」时，**测试失败是应该的**——用户可感知的文案变了，测试本来就该被叫来确认。

注意一个特例：label 存在但被视觉隐藏（如 TaskBoard 顶栏的工作区选择器用了 `visually-hidden` 类），`getByLabel` 依然有效——可访问名称不要求视觉可见：

```ts
const select = page.getByLabel("当前工作区");
```

### getByTestId：显式契约，兜底手段

有些元素确实没有用户可感知的语义可依赖（比如一个纯装饰性容器、一个文案由运营随时改的区块），这时和开发团队约定 `data-testid` 作为**显式测试契约**：

```html
<li data-testid="task-card">…</li>
```

```ts
page.getByTestId("task-card");
```

官方对 testid 的评价很辩证：**它最抗改（文案、角色怎么变它都在），但它不面向用户**——用户看不到 testid，用它定位就放弃了「测试即用户视角」的保证。因此取舍规则是：

- 能用 role/label/text 唯一定位 → 用它们；
- 元素没有稳定语义、或语义会随运营变化 → 加 testid；
- 属性名可配置：`use: { testIdAttribute: 'data-pw' }`（默认 `data-testid`）。

TaskBoard lite 全程没用一个 testid——它的标记足够语义化。这不是巧合，是刻意的教学示范。

### CSS / XPath：知道为什么排最后

```ts
// ❌ 官方文档中的反面教材
await page
  .locator(
    "#tsf > div:nth-child(2) > div.A8SBwf > div.RNNXgb > div > div.a4bIc > input",
  )
  .click();
```

这种「DOM 结构指纹」式定位把测试和实现细节焊死：设计师调一次样式、框架升级改一层包裹 div，测试就碎。Playwright 支持 CSS/XPath（`page.locator('css=button')`、省略前缀自动检测），但只在语义定位实在不可行时使用，且尽量写短、写稳（按语义属性选，而不是按结构层级选）。

补充两个事实，免得被旧资料误导：

- Playwright 的 CSS 定位**默认穿透 Shadow DOM**（XPath 不穿透；closed shadow root 不支持）；
- `locator()` 也接受选项对象做轻量过滤：`page.locator('li', { hasText: 'Product 2' })`。

## 3.2 Strictness：严格模式与它的报错

**locator 是严格的**：凡隐含「操作某一个元素」的动作（click、fill……），如果 locator 匹配到多于一个元素，直接抛错，而不是默默点第一个。

TaskBoard 任务列表里每张卡片都有一个「删除」按钮，于是：

```ts
await page.getByRole("button", { name: "删除" }).click();
```

在有多条任务时会得到著名的 strict mode violation 报错：

```text
Error: strict mode violation: getByRole('button', { name: '删除' }) resolved to 7 elements
```

这个报错是**特性不是缺陷**：它强迫你把 locator 收窄到唯一元素，而不是把「点哪个」交给运气。两种收窄方式：

```ts
// ✅ 方式一：先过滤到唯一卡片，再在卡片内找按钮（推荐）
const item = page.getByRole("listitem").filter({ hasText: "设计登录页" });
await item.getByRole("button", { name: "删除「设计登录页」" }).click();

// ⚠️ 方式二：显式取第 n 个（官方不推荐——页面顺序一变就点错）
await page.getByRole("button", { name: /删除/ }).nth(2).click();
```

`first()/last()/nth()` 存在，但官方明确提醒慎用：它们绕过了严格性检查，把「哪个元素」的决定权从语义让渡给了顺序。多元素操作（`count()`、`all()`、`toHaveCount()`）不受严格性限制，因为它们的语义本来就是针对集合的。

TaskBoard 的实际做法值得学习：每张卡片的删除按钮带了**含任务标题的 aria-label**（`删除「设计登录页」`），状态选择器同理。这不是为了测试硬塞的属性——屏幕阅读器用户同样需要知道「删除的是哪一条」。可访问性和可测试性在这里是同一件事。

## 3.3 filter 与链式收窄

`filter()` 按内容过滤一个 locator 匹配的集合，`getByXxx` 可以在任何 locator 上继续链式调用，把范围逐层收窄。官方文档的电商例子：

```html
<ul>
  <li>
    <h3>Product 1</h3>
    <button>Add to cart</button>
  </li>
  <li>
    <h3>Product 2</h3>
    <button>Add to cart</button>
  </li>
</ul>
```

```ts
// 点击「Product 2」卡片里的 Add to cart
await page
  .getByRole("listitem")
  .filter({ hasText: "Product 2" })
  .getByRole("button", { name: "Add to cart" })
  .click();
```

filter 的四个选项：

| 选项                        | 含义                              |
| --------------------------- | --------------------------------- |
| `hasText: string \| RegExp` | 元素内部（含后代）含有该文本      |
| `hasNotText`                | 不含该文本                        |
| `has: locator`              | 内部存在匹配另一个 locator 的后代 |
| `hasNot: locator`           | 内部不存在                        |

**关键陷阱**：`has` 里的 locator 是**相对外层匹配结果**查询的，不是从文档根开始。官方给的错误示例：

```ts
// ✖ 错：内层从 <ul> 开始找，超出了 <li> 的范围
await expect(
  page
    .getByRole("listitem")
    .filter({ has: page.getByRole("list").getByText("Product 2") }),
).toHaveCount(1);

// ✔ 对：内层直接从 li 内部找
await expect(
  page.getByRole("listitem").filter({ has: page.getByText("Product 2") }),
).toHaveCount(1);
```

filter 可以链式叠加（先按文本、再按子元素），TaskBoard 的真实测试里大量使用这个模式：

```ts
// tests/journey.spec.ts —— 找到标题含指定文本的那张任务卡片
const item = page.getByRole("listitem").filter({ hasText: title });
await expect(item).toBeVisible();
await item.getByLabel(`修改「${title}」的状态`).selectOption("done");
```

另外两个组合器：

```ts
// and()：同时满足两个 locator（交集）
const button = page.getByRole("button").and(page.getByTitle("Subscribe"));

// or()：满足其一（并集）——适合「可能出现也可能不出现的元素」
const newEmail = page.getByRole("button", { name: "New" });
const dialog = page.getByText("Confirm security settings");
await expect(newEmail.or(dialog).first()).toBeVisible();
if (await dialog.isVisible()) {
  await page.getByRole("button", { name: "Dismiss" }).click();
}
await newEmail.click();
```

`or()` 注意配 `.first()`：若两个分支同时匹配，严格模式会再次生效。

还有一个把「查找范围」显式化的方法 `within()`（1.5x 引入）：

```ts
const saveButton = page.getByRole("button", { name: "Save" });
const dialog = page.getByTestId("settings-dialog");
await saveButton.within(dialog).click(); // 只点这个对话框里的 Save
```

TaskBoard 的详情对话框场景用它也很自然（教程测试里用的是等价的 `dialog.getByLabel(...)` 链式写法）：

```ts
const dialog = page.getByRole("dialog");
await dialog.getByLabel("标题").fill("新标题"); // 链式：在对话框内找
await dialog.getByRole("button", { name: "保存" }).click();
```

## 3.4 列表与集合断言

对列表，Playwright 的哲学是**优先断言集合整体，而不是遍历单个元素**：

```ts
// 数量
await expect(page.getByRole("listitem")).toHaveCount(5);

// 全部文本（按顺序一次性断言）
await expect(page.getByRole("listitem")).toHaveText([
  "apple",
  "banana",
  "orange",
]);

// 收窄到某一项再操作
await page.getByRole("listitem").filter({ hasText: "orange" }).click();
```

`toHaveText([...])` 同时校验了数量、内容和顺序，一行顶三行。TaskBoard 的工作区选择器测试就是这么写的：

```ts
// tests/tenancy.spec.ts —— Alice 只属于 Alpha，看不到 Beta
const select = page.getByLabel("当前工作区");
await expect(select.locator("option")).toHaveText(["Alpha"]);
```

确实需要遍历时（少见），用 `all()`：

```ts
for (const row of await page.getByRole("listitem").all()) {
  console.log(await row.textContent());
}
```

但记住：**能在断言层解决就不要写循环**。循环 + 逐个断言的测试又慢又难读，还容易埋下时序问题。

## 3.5 定位器的调试与生成

写定位器不要靠猜，三个工具：

1. **codegen Pick Locator**（第 2 章）：`npx playwright codegen <url>`，停止录制后点 Pick Locator，悬停元素直接得到推荐定位器；
2. **VS Code 扩展**：光标停在测试里的 locator 上，浏览器窗口实时高亮匹配元素并显示匹配数量；
3. **报错信息本身**：strict mode violation 会列出所有匹配到的元素的 HTML 片段，通常一眼就能看出该加什么过滤条件。

还有一个运行时利器 `page.locator(...).highlight()` 以及 `--debug` 模式下的实时编辑（第 10 章）。

## 3.6 取舍决策表（背下来）

```
需要定位一个元素：
├── 它是交互元素（按钮/链接/输入/复选…）？
│   ├── 有 label / aria-label？        → getByLabel（表单）或 getByRole + name
│   ├── 有稳定的可见文本 / 标题语义？    → getByRole(role, { name })
│   └── 都没有、文本还会变？            → 加 data-testid，用 getByTestId
├── 它是非交互元素（提示语/段落/徽标）？
│   └── getByText（必要时配 role 断言）
├── 页面上有多个同类元素？
│   └── filter({ hasText / has }) 先收窄到唯一容器，再链式 getByXxx
└── 以上都不行？
    └── locator(css)，写短写稳，并接受它的脆弱性
```

---

## 常见错误

1. **用 CSS class 定位交互元素**（`page.locator('.btn-primary')`）：样式重构即碎。用 role + name。
2. **`getByText` 定位按钮**：能跑，但丢掉了「这是个按钮」的语义校验；且文本子串匹配容易多中（strict violation）。交互元素用 `getByRole`。
3. **忽略 strict violation，直接 `.first()` 消音**：报错在告诉你「定位不唯一」，`.first()` 只是把问题藏起来，页面一变就点错元素。
4. **`filter({ has })` 里写了从根开始的 locator**：内层匹配是相对外层的，带上外层范围之外的选择器永远匹配不到（3.3 节示例）。
5. **`nth()` 依赖渲染顺序**：数据顺序、分页、并行造数都会改变顺序。用文本/id 过滤，别用序号。
6. **给文本匹配写死首尾空白或大小写**：`getByText` 会归一化空白（多空格并一个、换行变空格、去首尾），传 `exact: true` 时才做全等（仍归一化空白）。

## 练习

以下练习基于 example 工程（`npm run app` 已启动，或依赖 webServer 自动拉起）。

1. 为登录页写 locator：邮箱输入框、密码输入框、登录按钮、错误提示（提示：错误提示的 role 是什么？）。
2. 任务卡片上有两个可交互元素：状态 `<select>` 和删除按钮。它们的 aria-label 都含任务标题。写出「把标题为 X 的任务设为已完成」和「删除标题为 X 的任务」的定位链。
3. 详情对话框打开后，页面底部列表里也有一个「保存」相关按钮吗？没有——但顶栏有「退出登录」。写一个 locator，要求匹配「对话框内部的按钮」，并解释为什么直接 `page.getByRole('button', { name: '保存' })` 在当前页面恰好不会歧义、但这个写法仍然危险。
4. 用 codegen 的 Pick Locator 功能找出「上一页」按钮的推荐定位器，与手写对比。
5. 思考题：如果产品要求把「退出登录」按钮文案改成「登出」，本章测试里哪些定位器会失败？这算测试的问题还是产品的问题？

<details>
<summary>参考答案</summary>

1.

```ts
page.getByLabel("邮箱"); // 或 getByRole('textbox', { name: '邮箱' })
page.getByLabel("密码");
page.getByRole("button", { name: "登录" });
page.getByRole("alert"); // <p role="alert">；页面上同时只有一个 alert 时可不带 name
```

2.

```ts
const item = page.getByRole("listitem").filter({ hasText: "X" });
await item.getByLabel("修改「X」的状态").selectOption("done");
await item.getByRole("button", { name: "删除「X」" }).click();
```

3. `page.getByRole('dialog').getByRole('button', { name: '保存' })`。当前不歧义只是因为全站只有一个「保存」按钮——这是环境巧合，不是定位器的性质；一旦别的页面/对话框也出现「保存」，测试就碎。把范围显式限定在对话框内，locator 的正确性就不依赖全页面巧合。
4. 推荐结果应为 `getByRole('button', { name: '上一页' })`——codegen 的优先级和手写最佳实践一致。
5. 所有 `getByRole('button', { name: '退出登录' })` 会失败。这不是测试脆弱，而是测试在履行职责：用户可感知的文案变更本就应该让 E2E 亮红灯，由人确认后再更新。这正是「面向用户定位」的代价与价值——如果当初用 `#signout` id 定位，文案改了测试照样绿，但屏幕阅读器用户的体验已经变了而你毫不知情。

</details>

## 本章验收清单

- [ ] 能背出定位器优先级并解释「为什么 role 第一、CSS 最后」；
- [ ] 理解 strictness：报错是特性；会正确用 filter/链式收窄而不是 `.first()` 消音；
- [ ] 会用 `filter({ hasText })`、`filter({ has })`，并知道 `has` 的相对查询陷阱；
- [ ] 会用 `toHaveCount` / `toHaveText([...])` 做集合断言；
- [ ] 能说出 getByTestId 的适用边界（显式契约、非用户视角、可配置属性名）。

## 官方文档

- [Locators](https://playwright.dev/docs/locators) — 本章主体：全部内置定位器、filter、strictness
- [Other locators](https://playwright.dev/docs/other-locators) — CSS/XPath 细节与冷门定位器
- [Best Practices · Use locators](https://playwright.dev/docs/best-practices) — 优先级与反面教材
- [WAI-ARIA Roles](https://www.w3.org/TR/html-aria/) — 隐式角色对照表

上一章：[环境搭建与第一个测试](./02-setup-and-first-test.md) ｜ 下一章：[自动等待与断言](./04-auto-waiting-and-assertions.md)。
