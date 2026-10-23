# 第 6 章：React Testing Library——测试用户能看到和完成的事

> 路线图要求：「优先按 role/label/user-visible behavior 查询，而不是依赖实现细节」。这一章用 TaskDesk Lite 的 `TaskForm`（React Hook Form + Zod）落地这条原则，完成路线练习 2 的四类场景：必填错误、提交成功、服务器拒绝、disabled 状态。

## 6.1 心法：用户看不见你的 state，只看得见 DOM

React Testing Library（下称 RTL）的设计哲学一句话：**测试写得越像用户的使用方式，它就越可靠**。用户不会说「把 `formState.errors.title` 设成非空」，只会说「我不填标题点提交，页面上应该出现红字」。

这直接决定了查询方式的选择优先级（RTL 官方优先级，越靠前越好）：

1. `getByRole(role, { name })` —— 按可访问性角色 + 可访问名查询（按钮、输入框、表单、alert 区域）
2. `getByLabelText(text)` —— 按 `<label>` 文本查表单控件
3. `getByPlaceholderText` / `getByText` —— 按可见文本
4. `getByTestId` —— 最后手段（用户看不见 testid，它只该用于实在没有语义抓手的元素）

**反面清单**（实现细节，禁止出现在断言里）：组件的 state/props、class 组件的实例方法、CSS 类名、DOM 层级结构（`.form > div:nth-child(2) input`）。这些一旦重构就碎，而用户可见行为重构后应当不变——测试就该在「行为不变」时保持绿色。

为了让组件可被语义化查询，`TaskForm` 的 JSX 做了对应的可访问性投入（[example/src/ui/task-form.tsx](./example/src/ui/task-form.tsx)）：

```tsx
<form noValidate aria-label="创建任务" onSubmit={handleSubmit(handleValid)}>
  <label htmlFor="task-title">任务标题</label>
  <input
    id="task-title"
    type="text"
    aria-invalid={errors.title ? true : undefined}
    aria-describedby={errors.title ? "task-title-error" : undefined}
    {...register("title", { required: "请填写任务标题" /* ... */ })}
  />
  {errors.title && (
    <p id="task-title-error" role="alert">
      {errors.title.message}
    </p>
  )}
  <button type="submit" disabled={isSubmitting}>
    {isSubmitting ? "创建中…" : "创建任务"}
  </button>
</form>
```

注意这是**双赢**：`aria-invalid`、`role="alert"`、label 关联让读屏用户能用表单，也让测试能按语义查询。测试困难常常是可访问性缺陷的信号。另外 `noValidate` 关掉了浏览器原生校验——原生校验弹层在 jsdom 里不存在，且会挡住 RHF 的错误展示逻辑（原生校验与库校验二选一，[表单教程第 8 章](../5.accessible-forms-tutorial/08-resolver-and-validation-loop.md)对此有展开）。

## 6.2 环境与断言匹配器

第 3 章已经配好：component 项目跑在 jsdom 环境，`test/setup-component.ts` 注册了 jest-dom 匹配器并自动 cleanup。测试文件的固定开头：

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { TaskForm } from "@/ui/task-form.js";
```

- `render(<Component />)`：把组件渲染进 jsdom 的 `document.body`，返回查询工具集；
- `screen`：全局查询入口（查的就是 `document.body`），比解构 `render` 返回值更方便；
- `userEvent`：**模拟真实用户交互**（点击、逐字输入、tab 聚焦），比底层的 `fireEvent` 多了一层真实事件序列（focus → keydown → keypress → input → keyup…）。新手一律用 `userEvent`；`fireEvent` 只留给 userEvent 覆盖不到的特殊事件。使用前先 `userEvent.setup()`。

jest-dom 提供的 DOM 断言（本章会用到）：`toBeInTheDocument()`、`toBeDisabled()` / `toBeEnabled()`、`toHaveTextContent()`、`toHaveValue()`、`toHaveAttribute()`。

## 6.3 四类核心场景

以下全部来自 [example/test/component/task-form.test.tsx](./example/test/component/task-form.test.tsx)（7 个测试，全部通过）。

**场景 1：必填错误**

```tsx
it("必填校验：空标题提交 → 显示错误、aria-invalid 生效、onSubmit 不被调用", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<TaskForm onSubmit={onSubmit} />);

  await user.click(screen.getByRole("button", { name: "创建任务" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("请填写任务标题");
  expect(screen.getByLabelText("任务标题")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(onSubmit).not.toHaveBeenCalled(); // 校验失败绝不能触发提交
});
```

三个断言各司其职：用户看见了错误文案（`role="alert"`）、可访问性状态正确（`aria-invalid`）、被拦截的行为确实没发生（`not.toHaveBeenCalled`）。最后这条最容易被漏，但它恰恰是「校验」的意义所在。

**场景 2：提交成功**

```tsx
it("提交成功：onSubmit 收到 trim 后的值，表单被清空", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(async () => {});
  render(<TaskForm onSubmit={onSubmit} />);

  await user.type(screen.getByLabelText("任务标题"), "  写周报  ");
  await user.type(screen.getByLabelText("截止日期"), "2026-04-01");
  await user.click(screen.getByRole("button", { name: "创建任务" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit).toHaveBeenCalledWith({
    title: "写周报",
    dueDate: "2026-04-01",
  });
  await waitFor(() =>
    expect(screen.getByLabelText("任务标题")).toHaveValue(""),
  );
});
```

`user.type` 逐字符输入，会触发 RHF 的 onChange 校验管线——这正是「像用户一样测」。`waitFor` 用于等待异步更新落定（提交是异步的）；断言「表单被清空」验证的是成功后的 UX 承诺。

**场景 3：提交中 disabled（防重复提交）**

```tsx
it("提交进行中：按钮 disabled 且文案变化", async () => {
  const user = userEvent.setup();
  let resolveSubmit!: () => void;
  // 手动控制 Promise 的决议时机：让「提交中」状态可被观察
  const onSubmit = vi.fn(
    () => new Promise<void>((resolve) => (resolveSubmit = resolve)),
  );
  render(<TaskForm onSubmit={onSubmit} />);

  await user.type(screen.getByLabelText("任务标题"), "慢请求");
  await user.click(screen.getByRole("button", { name: "创建任务" }));

  const button = await screen.findByRole("button", { name: "创建中…" });
  expect(button).toBeDisabled();

  resolveSubmit(); // 放行挂起的提交，让组件状态收尾
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "创建任务" })).toBeEnabled(),
  );
});
```

技巧核心：**用手动控制的 Promise 把异步「定格」在中间态**。不 `resolveSubmit()`，按钮就永远停在「创建中…」，你可以从容断言。测试结束前记得放行，否则组件卸载时还有挂起的状态更新，可能打印 act 警告。

**场景 4：服务器拒绝**

```tsx
it("服务器拒绝（如 409 重名）→ 展示服务器错误消息，表单内容保留", async () => {
  const user = userEvent.setup();
  const onSubmit = vi
    .fn<(values: { title: string; dueDate: string | null }) => Promise<void>>()
    .mockRejectedValueOnce(new Error("已存在同名任务：重构缓存层"));
  render(<TaskForm onSubmit={onSubmit} />);

  await user.type(screen.getByLabelText("任务标题"), "重构缓存层");
  await user.click(screen.getByRole("button", { name: "创建任务" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "已存在同名任务：重构缓存层",
  );
  expect(screen.getByLabelText("任务标题")).toHaveValue("重构缓存层"); // 失败不清空
});
```

`mockRejectedValueOnce` 让「服务器」拒绝这一次提交。断言了UX 决策：错误消息**原样透出**（来自 ApiError 的 message，第 8 章会看到它就是后端 envelope 里的 `error.message`），且失败后表单内容保留，用户改两个字就能重试。

## 6.4 getBy / queryBy / findBy：三族查询的选择

| 前缀       | 找不到时    | 找到多个时 | 返回                | 用途                           |
| ---------- | ----------- | ---------- | ------------------- | ------------------------------ |
| `getBy*`   | 抛错        | 抛错       | 元素（同步）        | 断言元素**存在**               |
| `queryBy*` | 返回 `null` | 抛错       | 元素或 null（同步） | 断言元素**不存在**（唯一选择） |
| `findBy*`  | 超时后抛错  | 抛错       | Promise\<元素\>     | 等待**异步出现**               |

配套工程里的对应用法：

```tsx
expect(await screen.findByRole("alert")).toHaveTextContent("..."); // 异步出现 → findBy
expect(screen.queryByRole("status")).not.toBeInTheDocument(); // 断言不存在 → queryBy
expect(screen.getByLabelText("任务标题")).toBeInTheDocument(); // 同步存在 → getBy
```

两条常见错误：`expect(screen.getByRole("alert")).not.toBeInTheDocument()`——找不到时 `getBy` 直接抛错，测试以「查询异常」而非「断言失败」告终，错误信息误导排查；以及用 `findBy` 去查一个同步就存在的元素，白白引入一轮轮询。**「不存在」用 queryBy、「异步出现」用 findBy、其余用 getBy**。

`findBy*` 本质是 `waitFor(() => getBy*())` 的语法糖，默认超时 1 秒、按间隔轮询——这就是组件层的「异步断言」（对应第 4 章 `expect.poll` 的组件版）。超时时间可以在 setup 时全局调（`configure({ asyncUtilTimeout })`），但更好的做法是追问「为什么要等这么久」。

## 6.5 mock 停在哪一层：组件测试的边界

`TaskForm` 的 `onSubmit` 是 props 注入的，所以测 `TaskForm` 时连 `vi.mock` 都不需要——直接传 `vi.fn()`。这是**组件设计决定测试难度**的实例：把副作用做成可注入的 props/hook，组件测试就是纯 DOM 交互测试。

上一层的组合组件 `TaskPage`（内部用 TanStack Query 的 `useCreateTask` → `api-client` → fetch）则用 `vi.mock` 把边界划在网络层（[example/test/component/isolation.test.tsx](./example/test/component/isolation.test.tsx)）：

```tsx
vi.mock("@/ui/api-client.js", () => ({
  ApiError: class ApiError extends Error {},
  createTask: vi.fn(async () => ({ ok: true })),
  listTasks: vi.fn(async () => ({ items: [] })),
}));
```

mock 之下（api-client、fetch）是外部世界；mock 之上（TaskPage、useCreateTask、React Query、TaskForm、zustand store）全部真实运行。第 7 章会看到这个 setup 下如何验证「提交成功 → status 区域出现 → 草稿 store 更新」的完整前端链路。

什么时候值得升级到 Browser Mode？当你要测的行为依赖真实浏览器：焦点管理细节、CSS 实际渲染、原生 `<dialog>`、跨窗口交互。jsdom 没有布局引擎，任何依赖几何/样式的断言（`toBeVisible` 的部分场景、滚动位置）都不可靠。届时用 `vitest --browser` + Playwright 驱动，RTL 的查询逻辑大多可以平移——这也是第 1 章说「学完阶段 13 可随时升级」的原因。

## 6.6 路线图练习 2：为表单组件写完整行为测试

> 路线要求：「为表单组件测试必填错误、提交成功、服务器拒绝与 disabled 状态。」

示范已完成四类场景，现在给 TaskForm 补三个新测试（都在 jsdom + RTL 下）：

1. **超长输入的即时反馈**：输入 81 个字符后**不点提交**，先 `blur`（`await user.tab()`）再断言 alert 是否出现——先预测 RHF 默认校验时机（onSubmit），运行验证，再决定这条测试钉住什么行为。
2. **连续双击提交只触发一次**：用场景 3 的手动 Promise 技巧，快速 `click` 两次（第二次点击发生在 disabled 生效前还是后？），断言 `onSubmit` 调用次数。提示：`userEvent` 对 disabled 按钮的 click 不会触发事件。
3. **服务器错误的恢复路径**：`mockRejectedValueOnce(...).mockResolvedValueOnce(undefined)`——第一次提交失败展示错误，用户改标题后第二次提交成功，断言 alert 消失、表单清空。

完成标准：三个测试通过且互不依赖执行顺序；断言全部基于 role/label/文本，没有出现 `container.querySelector` 或组件内部状态。

### 参考思路

1. RHF 默认 `mode: "onSubmit"`——首次提交前 blur 不会校验，alert 不出现。这条测试钉住的正是「默认校验时机」；如果想要 blur 即校验，组件要改成 `mode: "onBlur"`（改的是产品行为，不只是测试）。
2. 第一次 click 进入 pending → 按钮变 disabled；第二次 click 因按钮 disabled 不产生提交。断言 `toHaveBeenCalledTimes(1)`。若发现是 2 次，说明 disabled 生效前存在双击窗口——那是要修的竞态（React 18+ 的并发渲染下 `isSubmitting` 同步翻转，窗口极小，但值得用测试证明）。
3. 关键断言顺序：先 `findByRole("alert")`，再次提交后用 `waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())`——「消失」的断言必须用 queryBy（6.4 的规则）。

## 本章来源

- Vitest 官方文档：[Component Testing](https://vitest.dev/guide/browser/component-testing)（Browser Mode 为官方推荐的组件测试方式、Testing Library 集成与迁移路径、jsdom 与真实浏览器的差异）
- React Testing Library 官方文档：[Priority List](https://testing-library.com/docs/queries/about#priority)（查询优先级）、[API 类型](https://testing-library.com/docs/dom-testing-library/api-queries)（get/query/find 三族语义）
- [user-event 官方文档](https://testing-library.com/docs/user-event/intro)（setup、与 fireEvent 的差异）
- `@testing-library/jest-dom/vitest` 入口注册匹配器：jest-dom 官方 README（Vitest 集成节）

下一章：[07 测试隔离](./07-test-isolation.md) —— QueryClient、zustand store 与数据集的隔离方案。
