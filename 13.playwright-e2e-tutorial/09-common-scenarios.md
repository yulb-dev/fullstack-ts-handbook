# 第 9 章：常见交互场景实战

> 本章目标：把日常业务里最常见的交互逐一过手：表单、原生 `<dialog>` 与 JS 弹窗、键盘、文件上传、iframe、多标签页、分页与加载态、视口仿真。每个场景给出「TaskBoard 里的真实写法」或「官方推荐写法 + 何时需要」。
>
> 对应总目标：**网络失败、权限失败、加载状态、表单校验、分页与键盘交互。**（网络/权限失败已在第 8 章与 tenancy 测试覆盖，本章补齐其余场景。）

---

## 9.1 表单：填写、选择、提交、校验

表单是业务应用的主战场。Playwright 为每种控件提供了语义化动作：

| 控件      | 动作                                                                    | TaskBoard 实例                                  |
| --------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| 文本输入  | `fill()`（清空后输入）/ `pressSequentially()`（逐键，触发每个 keydown） | `getByLabel('任务标题').fill(title)`            |
| 下拉框    | `selectOption(value \| label \| { label })`                             | `getByLabel('状态').selectOption('done')`       |
| 复选/单选 | `check()` / `uncheck()`                                                 | —                                               |
| 提交      | 点击提交按钮，或输入框内 `press('Enter')`                               | `getByRole('button', { name: '登录' }).click()` |

三个实战要点：

**① fill 与 pressSequentially 的选择**：`fill` 一次性设值，快；但如果页面监听了逐键事件（搜索联想、输入格式化、字数统计），`fill` 可能不触发预期逻辑，此时用：

```ts
await page.getByLabel("搜索标题").pressSequentially("发布", { delay: 50 });
```

TaskBoard 的搜索框监听 `keydown Enter`，`fill` + `press('Enter')` 即可；若它做的是「边输入边联想」，就该换 pressSequentially。

**② 校验错误的断言**：前端拦截（点提交不发请求）与服务端拒绝（400 透传）是两条路径，都要测。example 的写法：

```ts
// 前端拦截：断言提示出现 + 列表数量不变（证明没发请求）
const before = await page.getByRole("listitem").count();
await page.getByRole("button", { name: "新建任务" }).click();
await expect(page.getByRole("alert")).toHaveText("标题不能为空");
await expect(page.getByRole("listitem")).toHaveCount(before);

// 服务端 400：断言错误消息透传给用户
await page.getByLabel("任务标题").fill("x".repeat(81));
await page.getByRole("button", { name: "新建任务" }).click();
await expect(page.getByRole("alert")).toContainText(
  "标题长度需在 1~80 个字符之间",
);
```

「数量不变」这种**否定性断言**（证明某事没发生）常被遗漏，但它恰恰是校验测试的价值所在。

**③ 浏览器原生校验（required/pattern）**：HTML5 原生校验气泡不产生 DOM，无法用 locator 断言。对策：要么测「提交被阻断」（表单没提交、URL 没变），要么应用改用自定义校验（TaskBoard 的选择：`required` 属性存在，但空标题拦截由 JS 完成并渲染 `role="alert"` 提示——可断言、可访问）。

## 9.2 对话框：`<dialog>`、role=dialog 与 JS 弹窗

TaskBoard 的任务详情用的是原生 `<dialog>` + `showModal()`，它有隐式 `dialog` 角色：

```ts
await item.getByRole("button", { name: title }).click();

const dialog = page.getByRole("dialog");
await expect(dialog).toBeVisible();
await dialog.getByLabel("标题").fill(`${title}（已改名）`); // 范围限定在对话框内（第 3 章）
await dialog.getByRole("button", { name: "保存" }).click();
await expect(dialog).toBeHidden(); // 关闭也是可断言的状态
```

`showModal()` 的额外红利：backdrop 遮挡 + 焦点圈闭（focus trap），Playwright 的 Receives Events 检查会自动处理「点不到对话框后面的元素」这类真实行为。

**JS 弹窗（alert/confirm/prompt）是另一回事**：它们不是 DOM，locator 够不着，且默认会阻塞页面。Playwright 用事件接管：

```ts
page.on("dialog", async (dialog) => {
  expect(dialog.message()).toBe("确认删除？");
  await dialog.accept(); // 或 dialog.dismiss()
});
await page.getByRole("button", { name: "删除" }).click();
```

注意：**没注册 dialog handler 时，Playwright 会自动 dismiss**（防阻塞）。遗留应用里满屏 `confirm()` 是常见的测试拦路虎，这也是现代 UI 用自定义对话框组件替代原生弹窗的原因之一。

## 9.3 键盘：从按键到快捷键

三个层级的键盘 API：

```ts
// ① 元素级：定位到元素再按键（最常用）
await page.getByLabel("搜索标题").press("Enter");
await page.getByLabel("密码").press("Enter"); // 表单内 Enter = 提交

// ② 全局级：不指向特定元素
await page.keyboard.press("Tab");
await page.keyboard.down("Shift");
/* ... */ await page.keyboard.up("Shift");
await page.keyboard.type("hello"); // 等价 pressSequentially

// ③ 组合键
await page.keyboard.press("ControlOrMeta+k"); // 跨平台 Cmd/Ctrl 快捷键
```

example 里的两组真实用法：

```ts
// Tab 走查 + 焦点断言（可访问性回归测试）
await guestPage.getByLabel("邮箱").focus();
await expect(guestPage.getByLabel("邮箱")).toBeFocused();
await guestPage.keyboard.press("Tab");
await expect(guestPage.getByLabel("密码")).toBeFocused();

// 「回车才触发、输入过程不触发」的行为边界
await search.fill(title);
await expect(
  page.getByRole("listitem").filter({ hasText: title }),
).toBeHidden();
await search.press("Enter");
await expect(page.getByRole("listitem")).toHaveCount(1);
```

两个实测得来的跨浏览器注意事项（详细案例见第 10 章 10.6）：

- **不要断言「Tab 焦点会到达按钮」**：macOS WebKit 默认不把 Tab 焦点交给按钮（跟随系统键盘导航设置）；提交改用表单内 `press('Enter')` 验证，它在三引擎上行为一致；
- **`type="search"` 的 Escape 行为分引擎**：Chromium/Firefox 会清空输入框，WebKit 不会。要测就按 `browserName` 分支断言（example 的 `resilient.spec.ts` 就是这么写的）。

键盘测试的价值判断：**用户会不看鼠标完成的操作流**（Tab 顺序、Enter 提交、Esc 关闭、快捷键）值得测；纯按键覆盖率不值得。焦点断言（`toBeFocused`）顺带守护了可访问性——键盘不可达的界面对屏幕阅读器用户同样不可用。

## 9.4 文件上传与下载

上传：`setInputFiles` 作用于 `<input type="file">`（可见或被隐藏都能操作）：

```ts
await page.getByLabel("上传附件").setInputFiles("tests/assets/report.pdf");
// 多文件：setInputFiles(['a.png', 'b.png'])
// 内存文件：setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') })
// 拖拽上传区（无 input 可定位时）：
const [fileChooser] = await Promise.all([
  page.waitForEvent("filechooser"), // 先挂监听
  page.getByText("选择文件").click(), // 再触发
]);
await fileChooser.setFiles("tests/assets/report.pdf");
```

下载：

```ts
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("button", { name: "导出 CSV" }).click(),
]);
const path = await download.path(); // 临时文件路径
await download.saveAs(testInfo.outputPath("export.csv")); // 存进测试产物目录
expect(download.suggestedFilename()).toBe("export.csv");
```

两处都是「先挂事件监听、再触发动作」的 Promise.all 模式——与 `waitForResponse` 同一原理（第 4 章）。

## 9.5 iframe 与多标签页

**iframe**：`frameLocator` 钻进 frame 再定位（普通 locator 穿不进去）：

```ts
await page.frameLocator("#payment-frame").getByLabel("卡号").fill("4242...");
// 嵌套：page.frameLocator('#outer').frameLocator('#inner').getByText(...)
```

支付/客服挂件类第三方 iframe 的内容不受你控制，遵循第 8 章原则：能 mock 就 mock（route 拦截 iframe 的 src 响应），别对第三方页面内容做断言。

**多标签页/弹窗**：新页面通过 context 事件到达：

```ts
const [popup] = await Promise.all([
  page.waitForEvent("page"), // context 级事件，page.waitForEvent 亦可
  page.getByRole("link", { name: "查看文档" }).click(), // target=_blank 链接
]);
await expect(popup).toHaveURL(/docs\./);
await popup.close();
```

`page.route` 只拦当前页；需要拦新标签页的请求就用 `context.route`（第 8 章）。

## 9.6 分页与加载态：列表页的完整测试套路

把第 3、4 章的工具组合起来，example 的分页测试是一个可复制的模板：

```ts
test("下一页/上一页正确切换，按钮禁用状态随页码变化", async ({
  page,
  seed,
}) => {
  // ① 用 API 造足数据（不依赖种子数据的确切条数——那是共享状态）
  for (let i = 1; i <= 5; i += 1) {
    await seed.createTask({ title: seed.uniqueTitle(`分页填充${i}`) });
  }

  await page.goto("/");
  const list = page.getByRole("listitem");
  const prev = page.getByRole("button", { name: "上一页" });
  const next = page.getByRole("button", { name: "下一页" });

  // ② 第一页：满页 + 边界按钮禁用
  await expect(list).toHaveCount(5);
  await expect(prev).toBeDisabled();

  // ③ 翻页：断言「页码指示器」而不是具体数据（数据可能被并行测试影响）
  await next.click();
  await expect(page.getByText(/第 2 \/ \d+ 页/)).toBeVisible();

  // ④ 翻回：状态复原
  await prev.click();
  await expect(page.getByText(/第 1 \/ \d+ 页/)).toBeVisible();
  await expect(prev).toBeDisabled();
});
```

注意 ③ 的取舍：不断言第 2 页的具体内容（并行测试随时在造数据），只断言页码推进与按钮状态——**对共享数据环境断言「结构与行为」，对专属数据才断言「内容」**。

加载态的测试（route 延迟 + `role="status"` 断言）在第 4、8 章已两次出现，套路总结：

```
装 route（延迟/挂起） → 触发加载 → 断言 loading 可见 → 放行 → 断言 loading 消失、数据出现
```

前端配合的要点：loading 元素用 `role="status"`（aria-live polite），既服务屏幕阅读器也让测试有稳定锚点。

## 9.7 鼠标精细操作：hover、拖拽、右键

```ts
await locator.hover(); // 悬停出菜单
await locator.dblclick(); // 双击进入编辑
await locator.click({ button: "right" }); // 右键菜单
await source.dragTo(target); // HTML5 拖拽（看板卡片移动）
await page.mouse.wheel(0, 500); // 滚轮（触发无限滚动加载）
await locator.dragTo(target, { force: true }); // 绕过 actionability（自定义拖拽库时偶需）
```

看板类应用（Trello 式拖拽）是 E2E 的难点：自定义拖拽往往不走原生 drag events，需要 `mouse.move/down/up` 手工编排轨迹。遇到这种组件，先查组件库官方是否提供测试友好接口，再考虑手工鼠标轨迹——并把这类测试隔离到单独文件（它们天然更脆）。

## 9.8 视口与响应式：一套测试跑多种设备

不改测试代码，改项目配置（第 6 章 mobile 项目的完整版）：

```ts
{
  name: 'mobile-chrome',
  use: { ...devices['Pixel 7'] },        // viewport + touch + isMobile + UA
  dependencies: ['setup'],
  testMatch: /journey\.spec\.ts/,        // 只跑关键旅程，别全量 × 移动端
},
```

单测试临时改视口用 `test.use`：

```ts
test.use({ viewport: { width: 375, height: 667 } });
test("窄屏下工具栏纵向堆叠", async ({ page }) => {
  /* ... */
});
```

移动端仿真跑在 Chromium/WebKit 内核上，是「行为仿真」（触摸事件、视口、UA）而非真机——真机云（BrowserStack 等）是另一个话题，本课程不涉及。

## 9.9 ARIA 快照：结构断言的新武器（了解）

1.49+ 提供 `toMatchAriaSnapshot`：把一块 UI 的可访问性树序列化成 YAML 快照做断言，比像素截图稳定（无视样式微调）、比逐个 locator 断言紧凑：

```ts
await expect(page.getByRole("dialog")).toMatchAriaSnapshot(`
  - dialog "任务详情":
    - textbox "标题": /重构登录模块/
    - combobox "状态": 待办
    - button "保存"
`);
```

快照同样支持 `--update-snapshots` 更新。适合「结构复杂但语义稳定」的区块（导航、对话框）；像素级视觉回归（`toHaveScreenshot`）则适合营销页/设计系统，注意它要求 CI 与本地渲染环境一致（官方建议用 Docker 镜像统一）。

---

## 常见错误

1. **对 `confirm()` 弹窗用 locator**：JS 弹窗不在 DOM 里，必须 `page.on('dialog')`。
2. **`fill` 测逐键联想输入**：fill 一次设值，keyup/keydown 依赖的逻辑不触发；用 `pressSequentially`。
3. **忘了 filechooser/download 的 Promise.all 顺序**：先触发后监听 → 事件丢失死等。
4. **分页测试断言具体数据内容**：并行造数让内容漂移；断言结构（页码、按钮态、条数上限）。
5. **给 `<input type="file">` 写 click 再找文件选择框**：直接 `setInputFiles`，一步到位。
6. **拖拽失败就加 `force: true`**：force 绕过的是 actionability 检查，掩盖的可能是「元素根本没渲染稳」；先诊断再决定是否 force。
7. **移动端项目跑全量测试**：时间 ×N。移动端只跑关键旅程子集（项目级 testMatch）。

## 练习

1. 给 TaskBoard 增加一个「导出当前列表为 JSON」的按钮需求（假设开发已完成，`window.open('/api/tasks?...')` 触发下载）——不真的改应用，写出这条测试的完整骨架（waitForEvent('download') + suggestedFilename 断言）。
2. 写一条测试验证任务详情对话框的 Esc 关闭行为（`<dialog>` 原生支持 Esc；思考：需要注册 dialog handler 吗？为什么？）。
3. 用 `pressSequentially` 改写搜索测试，并在每次按键后断言列表**没有**变化（证明搜索不是实时触发，而是回车触发）；再查阅 9.3 的跨浏览器注意事项，解释为什么不能用「按 Esc 后列表不变」来证明同一件事。
4. 给 example 加一个 `viewport` 为 375×667 的测试，断言登录卡片仍然可见且可交互（`toBeVisible` + 完成一次登录）。观察工具栏在窄屏下的表现，写下你发现的任何布局问题。
5. 用 `toMatchAriaSnapshot` 为登录表单写一条结构快照断言，运行 `--update-snapshots` 生成快照文件，然后手动删掉快照里的密码框一行，重跑观察失败信息。

<details>
<summary>参考答案（要点）</summary>

1.

```ts
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("button", { name: "导出 JSON" }).click(),
]);
expect(download.suggestedFilename()).toMatch(/\.json$/);
```

2. 不需要 dialog handler——那是 JS `alert/confirm/prompt` 的机制；原生 `<dialog>` 是 DOM 元素，Esc 关闭是浏览器行为。测试：打开对话框后 `await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeHidden();`
3. `for (const ch of title) { await search.pressSequentially(ch); await expect(page.getByRole('listitem')).toHaveCount(fullCount); }` 或逐段输入后断言数量不变；最后 press('Enter') 断言收窄为 1。不能用 Esc 证明：Esc 在 Chromium/Firefox 会直接清空 search 输入框（平台既定行为），列表不变的因果无法归因于「未触发搜索」。
4. `test.use({ viewport: { width: 375, height: 667 } })`；登录流程照常。常见发现：工具栏两个字段并排溢出、分页按钮挤压——记录下来就是给「应用」的 issue，这正是响应式 E2E 的价值。
5. 失败信息会以 diff 形式展示期望 YAML 与实际可访问性树的差异（缺失 textbox "密码" 节点），比像素 diff 可读得多。

</details>

## 本章验收清单

- [ ] 熟练表单动作族（fill/pressSequentially/selectOption/check）及其选择依据；
- [ ] 能区分原生 `<dialog>` 与 JS 弹窗的测试方式；
- [ ] 掌握键盘三层 API 与焦点断言，会测「按键行为边界」（Enter 触发/Esc 不触发）；
- [ ] 会写上传/下载/弹窗页/iframe 的事件等待模式（Promise.all 先挂后触发）；
- [ ] 掌握列表页套路：API 造数 → 结构断言 → 加载态导演；
- [ ] 了解设备仿真项目与 ARIA 快照的适用场景。

## 官方文档

- [Forms](https://playwright.dev/docs/input#forms) / [Input 总览](https://playwright.dev/docs/input) — 各类输入动作
- [Dialogs](https://playwright.dev/docs/dialogs) — JS 弹窗与 `<dialog>`
- [File upload & Download](https://playwright.dev/docs/api/class-filechooser) / [Download](https://playwright.dev/docs/api/class-download)
- [Frames](https://playwright.dev/docs/frames) / [Pages & multi-tab](https://playwright.dev/docs/pages)
- [Emulation](https://playwright.dev/docs/emulation) — 视口、触摸、地理位置、时钟
- [Aria snapshots](https://playwright.dev/docs/aria-snapshots) / [Snapshots (视觉回归)](https://playwright.dev/docs/test-snapshots)

上一章：[网络、mock 与 API 测试](./08-network-and-api-testing.md) ｜ 下一章：[调试、Trace Viewer 与 flaky 治理](./10-debugging-and-flaky-tests.md)。
