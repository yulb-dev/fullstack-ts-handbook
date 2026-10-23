# 第 4 章 · action 数据变更

> 本章目标：**用 `action` 统一处理「用户改数据」**——表单提交、服务端校验错误映射、成功后 redirect、提交中状态，以及最关键的「提交后自动 revalidation」。
> 对应验收项：④（action）
> 预计用时：60 分钟

第 3 章解决了「读数据」。这一章解决「写数据」。在 React Router 里，**一切数据变更都走 `action`**——它和 loader 是一对：loader 读，action 写。

---

## 4.1 action 是什么

**action 是挂在 Route Object 上的函数，处理发往该路由的非 GET 请求（表单提交）。** 它最重要的一个「魔法」是：

> 💡 **当 action 成功完成后，当前页面上所有路由的 loader 会自动重新执行（revalidation），UI 随之自动同步。** 你**不需要**手动「提交成功后再 setState / 重新拉列表」。

这一条是 React Router 数据模型的灵魂：**数据只有一份真相（服务端），UI 永远反映最新真相。**

```tsx
import { createBrowserRouter, useLoaderData, Form } from "react-router";

createBrowserRouter([
  {
    path: "/items",
    Component: Items,
    loader: async () => ({ items: await fakeDb.getItems() }),
    action: async ({ request }) => {
      const formData = await request.formData();
      await fakeDb.addItem({ title: formData.get("title") });
      return { ok: true };
    },
  },
]);

function Items() {
  const { items } = useLoaderData();
  return (
    <div>
      <ul>{items.map((it) => <li key={it.id}>{it.title}</li>)}</ul>

      {/* 提交到本路由的 action */}
      <Form method="post">
        <input name="title" placeholder="新增条目" />
        <button type="submit">创建</button>
      </Form>
      {/* 提交成功后，loader 自动重跑，上面的列表自动出现新条目 */}
    </div>
  );
}
```

---

## 4.2 action 的入参：读表单数据

action 和 loader 入参结构相同（`{ request, params, context }`）。读表单用 `await request.formData()`：

```tsx
export async function action({ request, params }) {
  const formData = await request.formData();
  const title = formData.get("title");       // string | null
  const status = formData.get("status");
  // params.concertId 等动态段同样可用
  // ...
}
```

- `formData.get(name)` 取单值；`getAll(name)` 取多值（如多个 checkbox）。
- 也能处理 JSON：若客户端以 `application/json` 提交，用 `await request.json()`。
- `request.method` 告诉你这是 POST / PUT / DELETE / PATCH。

> ⚠️ **服务端要重新校验**：即使前端做了校验，action 里也必须再校验一次（前端校验只是体验，服务端校验才是安全底线）。action 是「离服务端最近的一层」。

---

## 4.3 四种触发 action 的方式

| 方式 | 是否改变 URL / 进历史栈 | 典型场景 |
| --- | --- | --- |
| `<Form method="post">` | ✅ 会导航 | 页面级表单（新建、编辑） |
| `useSubmit()` | ✅ 会导航 | 命令式提交（定时器、非表单元素触发） |
| `<fetcher.Form method="post">` | ❌ 不导航 | 列表内联操作、局部提交（第 5 章） |
| `fetcher.submit()` | ❌ 不导航 | 命令式的局部提交（第 5 章） |

### (1) `<Form>`：声明式提交

```tsx
import { Form } from "react-router";

<Form action="/concerts/chicago/3" method="post">
  <input name="title" defaultValue={concert.title} />
  <button type="submit">保存</button>
</Form>
```

- `action` 指向要提交到的路由（省略则提交到当前路由）。
- `method="post"`（默认 get）；也可 `put`/`patch`/`delete`。
- 点击提交后，React Router 会：找到目标路由的 action → 执行 → 成功后 revalidate 所有 loader。

### (2) `useSubmit()`：命令式提交

当你需要在「非用户点击提交按钮」的时机提交（比如倒计时结束自动交卷）：

```tsx
import { useSubmit } from "react-router";

function useQuizTimer() {
  const submit = useSubmit();
  useEffect(() => {
    const t = setTimeout(() => {
      submit({ quizTimedOut: true }, { action: "/end-quiz", method: "post" });
    }, 10 * 60 * 1000);
    return () => clearTimeout(t);
  }, [submit]);
}
```

`submit` 的第一个参数可以是 `FormData`、普通对象、或一个 `<form>` DOM 元素。

> 💡 **`<Form>` / `useSubmit` / `fetcher` 该用哪个？** 记住：**默认用 `<Form>`；要「提交但不跳转、不进历史」就用 `fetcher`（第 5 章）；要在代码逻辑里命令式触发就用 `useSubmit`。**

---

## 4.4 服务端错误 → 表单字段错误的映射（重点）

这是 action 最实用的能力之一：**服务端校验失败时，把「哪个字段错了、错在哪」结构化返回给表单，让它显示在对应输入框旁边。**

约定：action **不抛错**，而是 `return { errors, values }`。组件用 `useActionData()` 读取。

```tsx filename=src/routes/concerts/edit.tsx
import { Form, useActionData, useLoaderData } from "react-router";

// action：服务端校验 + 保存
export async function action({ request, params }) {
  const formData = await request.formData();
  const title = String(formData.get("title") ?? "").trim();
  const date = String(formData.get("date") ?? "");

  // 1) 服务端校验，收集字段错误
  const errors: Record<string, string> = {};
  if (title.length < 3) errors.title = "标题至少 3 个字符";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = "日期格式应为 YYYY-MM-DD";

  // 2) 有错就把错误 + 用户已填的值返回（不 redirect）
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, values: { title, date } };
  }

  // 3) 无错则保存，成功后跳到详情页
  await updateConcert(params.concertId, { title, date });
  return redirect(`/concerts/${params.city}/${params.concertId}`);
}

export default function EditConcert() {
  const concert = useLoaderData();          // 编辑前的原值
  const actionData = useActionData();        // 上一次提交的结果（可能是错误）
  const errors = actionData?.errors ?? {};
  const values = actionData?.values ?? concert; // 回填用户刚输入的值

  return (
    <Form method="post">
      <label>
        标题
        <input name="title" defaultValue={values.title} aria-invalid={!!errors.title} />
        {errors.title && <em style={{ color: "crimson" }}>{errors.title}</em>}
      </label>

      <label>
        日期
        <input name="date" defaultValue={values.date} aria-invalid={!!errors.date} />
        {errors.date && <em style={{ color: "crimson" }}>{errors.date}</em>}
      </label>

      <button type="submit">保存</button>
    </Form>
  );
}
```

关键点：
- **`useActionData()`** 返回**最近一次 action 的返回值**。首次渲染时是 `undefined`（还没提交过）。
- 出错时 `return { ok:false, errors, values }`，**不要 redirect**，让用户留在表单页看到错误、且**输入不丢失**（回填 `values`）。
- 成功时 `return redirect(...)`，跳到详情页；此时 actionData 不再是重点。

> ⚠️ **错误分类**：表单校验错误 → 用 `useActionData` 返回；「资源不存在 / 无权限 / 服务器崩溃」→ 用 `throw data(...)` 走**错误边界**（第 6 章）。**两者不要混用**：校验错误不是「异常」，不该渲染成整页错误。

---

## 4.5 redirect：提交成功后的标准收尾

「创建成功 → 跳到详情页」是最经典的模式：

```tsx
export async function action({ request }) {
  const formData = await request.formData();
  const concert = await createConcert(formData);
  return redirect(`/concerts/${concert.city}/${concert.id}`);
}
```

为什么用 redirect 而不是「返回数据 + 组件里 navigate」？
- redirect 让「创建」和「查看」在一次导航里干净衔接，**浏览器历史栈也正确**（用户在详情页按返回不会回到「已提交的表单」）。
- action 里 `return redirect(...)` 或 `throw redirect(...)` 都行。

---

## 4.6 提交状态：让用户知道「正在处理」

提交是异步的，必须给用户反馈（禁用按钮、显示「保存中…」），否则用户会重复点击。有两种拿「提交中」状态的方式：

### 方式 A：页面级表单 → `useNavigation`

```tsx
import { Form, useNavigation } from "react-router";

function EditConcert() {
  const navigation = useNavigation();
  // 当前是否正在向本表单提交
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formAction === "/concerts/chicago/3";

  return (
    <Form method="post" action="/concerts/chicago/3">
      <input name="title" />
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "保存中…" : "保存"}
      </button>
    </Form>
  );
}
```

### 方式 B：局部表单 → `useFetcher`（更简单，推荐用于内联操作）

```tsx
import { useFetcher } from "react-router";

function EditConcert() {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post">
      <input name="title" />
      <button disabled={busy}>{busy ? "保存中…" : "保存"}</button>
    </fetcher.Form>
  );
}
```

`useNavigation` / `useFetcher` 的完整状态机（idle / loading / submitting）与选择策略在**第 5 章**深入。这里你先记住：**提交类 UI 一定要有 pending 反馈。**

---

## 4.7 自动 revalidation 与「跳过重校验」

默认情况下，action 成功后，**当前 URL 上所有匹配路由的 loader 都会重跑**。这通常正是你想要的（列表自动刷新）。但有时你只想「局部更新、别整页刷」：

- **单次提交跳过 revalidation**：在 `<Form>`/`useSubmit`/`fetcher.submit` 上传 `defaultShouldRevalidate={false}`（或对 fetcher 用同名选项）。
  ```tsx
  <Form method="post" navigate={false}> {/* navigate={false}：提交但不导航 */}
  ```
- **某条路由长期跳过**：在该 Route Object 上定义 `shouldRevalidate({ formMethod, formAction, defaultShouldRevalidate, ... })`，返回 `false` 即可让**这条路由的 loader**不参与自动重校验。
  ```tsx
  {
    path: "/stats",
    loader: statsLoader,
    shouldRevalidate: ({ formAction, defaultShouldRevalidate }) =>
      formAction?.endsWith("/analytics") ? false : defaultShouldRevalidate,
  }
  ```

> 💡 **默认 revalidation 触发时机**（Data Mode）：路由自身 params 变化、URL search params 任意变化、action 返回非错误状态之后。`shouldRevalidate` 一旦定义，就**完全接管**这条路由的重校验决策。细节与更多例子见第 5 章「避免重复请求」。

---

## 4.8 动手实践：给 Concert Hub 加「新建 + 编辑」

🧪 完整串一遍：列表页有「新建」表单，详情页有「编辑」表单，都带服务端校验、错误回填、成功 redirect。

```ts filename=src/api.ts（追加写操作）
export async function createConcert(input: Partial<Concert>): Promise<Concert> {
  await delay(500);
  const concert: Concert = {
    id: String(Date.now()),
    city: input.city ?? "chicago",
    title: input.title ?? "Untitled",
    date: input.date ?? new Date().toISOString().slice(0, 10),
  };
  concerts.push(concert);
  return concert;
}

export async function updateConcert(id: string, patch: Partial<Concert>) {
  await delay(500);
  concerts = concerts.map((c) => (c.id === id ? { ...c, ...patch } : c));
  return concerts.find((c) => c.id === id)!;
}
```

```tsx filename=src/routes/concerts/new.tsx
import { Form, redirect, useActionData, useNavigation } from "react-router";
import { createConcert } from "../../api";

export async function action({ request }) {
  const fd = await request.formData();
  const city = String(fd.get("city") ?? "").trim();
  const title = String(fd.get("title") ?? "").trim();
  const date = String(fd.get("date") ?? "");

  const errors: Record<string, string> = {};
  if (!city) errors.city = "城市必填";
  if (title.length < 3) errors.title = "标题至少 3 个字符";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = "日期格式应为 YYYY-MM-DD";

  if (Object.keys(errors).length) {
    return { ok: false as const, errors, values: { city, title, date } };
  }

  const concert = await createConcert({ city, title, date });
  return redirect(`/concerts/${concert.city}/${concert.id}`);
}

export default function NewConcert() {
  const actionData = useActionData();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const errors = actionData?.errors ?? {};
  const values = actionData?.values ?? {};

  return (
    <Form method="post">
      <h1>新建演唱会</h1>
      {(["city", "title", "date"] as const).map((name) => (
        <p key={name}>
          <label>
            {name}：
            <input name={name} defaultValue={values[name]} aria-invalid={!!errors[name]} />
          </label>
          {errors[name] && <em style={{ color: "crimson" }}>{errors[name]}</em>}
        </p>
      ))}
      <button disabled={submitting}>{submitting ? "提交中…" : "创建"}</button>
    </Form>
  );
}
```

**验收你的实现：**
1. 提交空表单 → 停在页面、每个字段下显示错误、已填的值不丢失。
2. 填对 → 自动跳到 `/concerts/:city/:id` 详情页。
3. 详情页按浏览器「返回」→ 回到**新建表单**还是**列表**？（应回到列表，因为 redirect 替换了历史——观察并理解这一点。）

---

## ✅ 本章验收清单

- [ ] 我能说出「action 处理数据变更，成功后自动 revalidate 所有 loader」这条核心机制。
- [ ] 我会用 `await request.formData()` 读表单，并知道要在服务端重新校验。
- [ ] 我能区分四种触发方式（`<Form>` / `useSubmit` / `fetcher.Form` / `fetcher.submit`）及各自是否改变 URL。
- [ ] 我会做**服务端错误 → 字段错误映射**：`return { errors, values }` + `useActionData()`，且不丢失用户输入。
- [ ] 我会用 `redirect()` 做「创建成功后跳详情」。
- [ ] 我会给提交按钮加 pending 状态（`useNavigation` 或 `fetcher.state`）。
- [ ] 我理解如何跳过自动 revalidation（`navigate={false}` / `defaultShouldRevalidate` / `shouldRevalidate`）。

完成后进入 👉 [**第 5 章：导航状态与 Pending UI**](./05-导航状态与-PendingUI.md)。

---

## 🔧 常见坑 / 排错

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 提交后列表没更新 | action 成功了但该路由没有 loader，或 loader 没重跑 | 确认列表路由有 loader；action 返回非错误状态才会触发 revalidation |
| `useActionData()` 一直是 undefined | 表单 `action` 指向了别的路由 | actionData 来自「处理该提交的路由」；确认 `action` 与组件在同一路由 |
| 校验错误渲染成了整页错误 | 用了 `throw` 而非 `return { errors }` | 校验错误用 return；异常/404/403 才 throw |
| 用户提交后输入被清空 | 出错时没回填 values | 出错分支 `return { errors, values }`，组件用 `defaultValue={values.x}` |
| 按钮能被连点，创建了多条 | 没有提交中禁用 | 用 `navigation.state==="submitting"` 或 `fetcher.state!=="idle"` 禁用 |
| 成功后按返回又回到表单 | 用 `navigate` 而非 `redirect` | 用 `return redirect(...)` 让历史栈正确 |
