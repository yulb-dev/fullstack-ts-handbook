# 第 7 章：测试隔离——不让状态在测试之间串门

> 路线图通过标准第一条：「测试不依赖执行顺序、不因共享 Query cache/store 而互相污染」。这一章先制造污染（让你看见它长什么样），再逐个给出 QueryClient、zustand store、内存仓储、数据库四类状态的隔离方案。全部代码来自 [example/test/component/isolation.test.tsx](./example/test/component/isolation.test.tsx)。

## 7.1 污染的形态：一个测试的残留，另一个测试的谜团

共享可变状态 + 测试执行 = 顺序依赖。典型症状：

- 单个测试跑通过，整个文件跑失败（或反过来）；
- `--sequence.shuffle` 乱序后随机红一两个；
- 失败信息莫名其妙：「找到了 2 个 role=button 的元素」「期望缓存为空但里面有数据」。

根源都是一个：**上一个测试写的状态，下一个测试读到了**。React 测试里有三大惯犯：QueryClient 缓存、模块级 zustand store、没 cleanup 的 DOM。Vitest 的默认机制已经帮你隔离了一部分，先分清哪些是天生的、哪些要自己动手：

| 层级             | 默认隔离吗    | 说明                                                                                       |
| ---------------- | ------------- | ------------------------------------------------------------------------------------------ |
| 测试**文件**之间 | ✓（默认）     | Vitest 默认为每个文件分配独立 worker/环境，模块状态互不可见；`--no-isolate` 可关（换速度） |
| 同文件内测试之间 | ✗             | 模块只 import 一次，模块级单例（store！）、全局对象在测试间共享                            |
| mock 调用记录    | ✓（Vitest 5） | `clearMocks` 默认 true（第 5 章）                                                          |
| DOM              | 半自动        | RTL 的 `cleanup` 需要注册（我们在 setupFiles 里做了，第 3 章）                             |

所以隔离工作的重心是**同文件内**：QueryClient、store、任何模块级可变对象。

## 7.2 QueryClient：每个测试一个新的，别共享再 clear

TanStack Query 的缓存挂在 QueryClient 上。共享一个模块级 client 的后果：测试 A `setQueryData` 的数据、mutation 的成功状态，全部泄漏给测试 B。

正确做法是把「新建 client」放进 render helper（[example/test/test-utils.tsx](./example/test/test-utils.tsx)）：

```tsx
export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false }, // 测试里失败就立刻失败，别等指数退避
      mutations: { retry: false },
    },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    options,
  );
  return { ...result, queryClient }; // 把 client 交出去，测试可以直接检查缓存
}
```

配套工程用两个互相「指认」的测试证明隔离成立：

```tsx
it("测试 A：往缓存写入数据", () => {
  const { queryClient } = renderWithProviders(<TaskForm onSubmit={vi.fn()} />);
  queryClient.setQueryData(["tasks"], ["测试 A 留下的数据"]);
  expect(queryClient.getQueryData(["tasks"])).toEqual(["测试 A 留下的数据"]);
});

it("测试 B：全新 QueryClient 看不到测试 A 的缓存", () => {
  const { queryClient } = renderWithProviders(<TaskForm onSubmit={vi.fn()} />);
  // 如果共享模块级 client，这里会读到测试 A 的数据——污染发生了
  expect(queryClient.getQueryData(["tasks"])).toBeUndefined();
});
```

为什么不是「共享 client + 每个测试前 `client.clear()`」？两个原因：`clear()` 清缓存但 mutation 观察者、进行中请求的生命周期仍可能跨测试存活；而 `new QueryClient()` 的成本几乎为零。新建永远比清理更可靠——这个原则对后面所有隔离方案都适用。

`retry: false` 值得单独强调：TanStack Query 默认查询失败会重试 3 次（指数退避），测试里一个「预期失败」的查询要拖好几秒才落定，`findBy*` 的 1 秒超时先到，产生莫名其妙的失败。**测试环境的 QueryClient 必须关 retry**（或显式 `retry: 1` 并在断言里考虑）。

还有一个反向验证：不套 Provider 直接用 hook 应当抛错，证明 client 确实来自注入而不是某个隐藏单例——

```tsx
it("不套 Provider 直接用 useCreateTask 会抛错", async () => {
  const { useCreateTask } = await import("@/ui/use-create-task.js");
  function Probe() {
    useCreateTask();
    return null;
  }
  const spy = vi.spyOn(console, "error").mockImplementation(() => {}); // 压掉 React 的错误日志
  expect(() => render(<Probe />)).toThrow();
  spy.mockRestore();
});
```

## 7.3 zustand store：模块级单例，必须显式重置

zustand 的 `create()` 返回的 hook 本身就是 store 单例——`import { useDraftStore }` 拿到的永远是同一个。文件内跨测试必然共享。隔离方案是 `beforeEach` 恢复初始状态：

```tsx
// src/ui/draft-store.ts 里导出初始状态，避免测试各自复制一份（复制的初始值会悄悄过期）
export const initialDraftState = { draftTitle: "" } as const;

// 测试里
beforeEach(() => {
  useDraftStore.setState(initialDraftState); // 部分更新即可恢复数据字段
});
```

配套工程同样用「A 污染、B 验证」的组合钉住它：

```tsx
it("测试 A：把草稿改成「A 的草稿」", () => {
  useDraftStore.getState().setDraftTitle("A 的草稿");
  expect(useDraftStore.getState().draftTitle).toBe("A 的草稿");
});

it("测试 B：因为有 beforeEach 重置，看到的仍是初始值", () => {
  // 删掉 beforeEach 里的 setState，这个测试就会读到「A 的草稿」而失败
  expect(useDraftStore.getState().draftTitle).toBe("");
});
```

进阶方案（大型工程常用）：把 store 做成 `createStore()` 工厂 + Context 注入，每个测试 `createStore()` 一个新实例，彻底摆脱单例。教学项目用 `setState` 重置足够，但要知道工厂模式的存在——它对 store 数量多、初始状态复杂的工程更省心。

注意 `setState(state, replace)` 的第二个参数：zustand v5 里 `replace: true` 要求传入**完整状态**（含 action 函数），只传数据字段会类型报错；用默认的部分合并（`setState({ draftTitle: "" })`）重置数据字段即可。

## 7.4 组合验证：TaskPage 的完整链路仍然互相隔离

有了 7.2 和 7.3 两块拼图，`TaskPage`（QueryClient + mutation + store + 表单的组合体）的测试就能既真实又隔离：

```tsx
describe("TaskPage 组合", () => {
  beforeEach(() => {
    useDraftStore.setState(initialDraftState);
  });

  it("提交成功后展示状态区域，并把标题写进草稿 store", async () => {
    const user = userEvent.setup();
    render(<TaskPage />); // TaskPage 内部自己 new QueryClient（useState 惰性初始化）

    await user.type(screen.getByLabelText("任务标题"), "打通全链路");
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "已创建：打通全链路",
    );
    expect(useDraftStore.getState().draftTitle).toBe("打通全链路");
  });

  it("再次渲染（新 QueryClient）不受上一个测试的 mutation 状态影响", () => {
    render(<TaskPage />);
    // 上一个测试 mutation 已成功；如果 QueryClient 被共享，这里可能直接出现 status 区域
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
```

这里 mock 依然停在第 6 章划定的网络边界（`vi.mock("@/ui/api-client.js")`），React Query 的 mutation 状态机、Provider 注入、store 订阅全部真实运行——这就是「component 层集成」的正确姿势。

## 7.5 数据与后端的隔离预告

同文件内还有一类共享状态：**测试数据**。本章的内存仓储方案是「每个测试 `createInMemoryTaskRepository()` 新建」（第 5 章的 `makeService()` helper 每次都返回全新 repo + notifier，正是这个模式）；数据库的隔离（清表 vs 独立库 vs 事务回滚）放在第 9 章展开，因为它还牵扯「文件级并行时会不会互相踩库」的问题。

先记住结论：**「新建」优于「清理」，「清理」优于「共享后祈祷」**。

## 7.6 隔离自检清单

- [ ] 测试文件里没有模块级可变的 `QueryClient` / store 引用（helper 每次新建）
- [ ] 用了 zustand/全局 store 的文件有 `beforeEach` 重置
- [ ] component 项目的 setupFiles 注册了 RTL `cleanup`
- [ ] 测试 QueryClient 关闭了 retry
- [ ] `npx vitest run --sequence.shuffle` 连跑三次全绿（第 11 章把它进 CI）
- [ ] 没有任何测试断言依赖「上一个测试执行过」（A/B 指认测试除外——它们本身就是隔离的证明）

## 练习

1. 把 `isolation.test.tsx` 中「测试 B：全新 QueryClient 看不到测试 A 的缓存」改坏：在文件顶部建一个模块级 `sharedClient` 并让两个测试共用，运行验证污染真实发生（B 读到 A 的数据），然后改回 helper 方案。亲眼见过污染，以后才认得它。
2. 给 7.3 的 beforeEach 重置写一个「哨兵测试」：故意删掉 `beforeEach`，确认「测试 B」失败信息里出现「A 的草稿」——这条信息就是将来排查同类问题的路标。
3. 思考题：为什么文件级隔离（每个测试文件独立 worker）不能替代本章的所有工作？（要点：它隔离的是**文件之间**；同文件内的测试共享模块实例与全局对象，本章解决的正是这一层。）

## 本章来源

- Vitest 官方文档：[Features](https://vitest.dev/guide/features)（文件级环境隔离、`--no-isolate`、fileParallelism）
- Vitest 官方文档：[Migrating to Vitest 5.0](https://vitest.dev/guide/migration.html)（`clearMocks` 默认 true——mock 记录的文件内隔离）
- TanStack Query 官方文档：Testing 章节（每测试新建 QueryClient、关闭 retry 的推荐做法）
- zustand 官方文档：`setState` 的 replace 语义与 v5 类型约束、[testing](https://zustand.docs.pmnd.rs/guides/testing) 指南

下一章：[08 Fastify app.inject](./08-fastify-inject.md) —— 不监听端口测完整个 HTTP 边界。
