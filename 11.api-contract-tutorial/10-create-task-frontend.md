# 第 10 章：创建任务（下）：前端链路与错误 UI

> 本章目标：完成练习 2 的前端部分——`React Hook Form → Zod → TanStack Query mutation → 生成的客户端`；并完成练习 3：把 **400 字段错误、401、403、404、409、500** 映射到合适的 UI。最后用组件测试证明每一种映射都成立。
>
> 对应动手练习：**练习 2（前端部分）**、**练习 3**。
> 对应核心概念：**④ 验证错误字段映射**。

---

## 10.1 前端的文件结构

```
apps/web/src/
├── main.tsx                         Provider 组装：ApiContext + QueryClient + 全局 401
├── App.tsx                          会话守卫：加载中 / 登录 / 工作区
├── lib/
│   ├── api.ts                       创建 api-client 实例、CSRF token 存放、useApi()
│   ├── query-client.ts              重试策略、全局错误处理（第 7 章）
│   ├── errors.ts                    describeError()：错误 → UI；applyServerFieldErrors()
│   └── dates.ts                     时间点与日历日期的展示（第 12 章）
├── components/
│   └── ErrorBanner.tsx              统一的错误横幅
└── features/
    ├── auth/
    │   ├── session.ts               useSession / useLogin / useLogout
    │   └── LoginForm.tsx
    └── tasks/
        ├── task-form-schema.ts      Zod 表单 schema + toCreateTaskBody（第 5 章）
        ├── api.ts                   query key、useTaskList、useCreateTask、useUpdateTask
        ├── CreateTaskForm.tsx       ★ 本章主角
        └── TaskList.tsx
```

注意 `features/tasks/api.ts` 这个名字：它是「任务功能的服务端状态层」，只做两件事——定义 query key、把生成的客户端调用包装成 hooks。组件里看不到任何 URL 字符串或 `fetch`。

---

## 10.2 组装 Provider

**`apps/web/src/lib/api.ts`**：

```ts
import { createApiClient, type ApiClient } from "@taskflow/api-client";
import { createContext, useContext } from "react";

/**
 * CSRF token 只放内存：它不是秘密（每次 GET /auth/session 都能拿到），
 * 但也没必要写进 localStorage，刷新页面后重新获取即可。
 */
let csrfToken: string | null = null;
export const csrf = {
  get: () => csrfToken,
  set: (token: string | null) => {
    csrfToken = token;
  },
};

export function createBrowserApi(): ApiClient {
  return createApiClient({
    // 同源部署留空；跨源部署时通过 VITE_API_BASE_URL 指向 API 源
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? "",
    getCsrfToken: csrf.get,
  });
}

export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi 必须在 <ApiContext.Provider> 内使用");
  return api;
}
```

为什么用 Context 注入客户端，而不是在模块里 `export const api = createApiClient(...)` 直接用？**为了测试。** 组件测试可以注入一个带假 `fetch` 的客户端（10.8 节），不需要 mock 模块、不需要 MSW，也不需要启动服务器。

**`apps/web/src/main.tsx`**：

```tsx
const api = createBrowserApi();
const queryClient = createQueryClient({
  onUnauthenticated: () => {
    // 会话失效：清空所有服务端缓存，回到登录页
    csrf.set(null);
    queryClient.clear();
    queryClient.setQueryData(sessionKey, null);
  },
});

createRoot(root).render(
  <StrictMode>
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ApiContext.Provider>
  </StrictMode>,
);
```

**`apps/web/src/App.tsx`**（会话守卫）：

```tsx
export function App() {
  const session = useSession();
  const logout = useLogout();

  if (session.isPending) return <p>加载中…</p>;
  if (session.isError)
    return (
      <ErrorBanner error={session.error} onRetry={() => session.refetch()} />
    );
  if (!session.data) return <LoginForm />;

  return (
    <main>
      <header>
        <span>你好，{session.data.user.displayName}</span>
        <button type="button" onClick={() => logout.mutate()}>
          退出
        </button>
      </header>
      <Workspace />
    </main>
  );
}

function Workspace() {
  const projects = useProjects();
  if (projects.isPending) return <p>加载项目…</p>;
  if (projects.isError)
    return (
      <ErrorBanner error={projects.error} onRetry={() => projects.refetch()} />
    );

  const project = projects.data.items[0];
  if (!project) return <p>你还没有加入任何项目。</p>;

  // 前端按角色隐藏表单只是体验优化；真正的权限判断在服务端（第 9 章）
  const canWrite = project.myRole !== "viewer";
  return (
    <>
      <h2>{project.name}</h2>
      {canWrite ? (
        <CreateTaskForm projectId={project.id} />
      ) : (
        <p className="hint">你是只读成员，不能创建任务。</p>
      )}
      <TaskList projectId={project.id} canWrite={canWrite} />
    </>
  );
}
```

`project.myRole` 的类型是 `"owner" | "editor" | "viewer"`——来自契约，不是手写的。

---

## 10.3 表单组件：把五个环节串起来

**`apps/web/src/features/tasks/CreateTaskForm.tsx`**：

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@taskflow/api-client";
import { useRef } from "react";
import { useForm } from "react-hook-form";
import { ErrorBanner } from "../../components/ErrorBanner";
import { applyServerFieldErrors } from "../../lib/errors";
import { useCreateTask } from "./api";
import {
  CREATE_TASK_FIELDS,
  PRIORITY_LABEL,
  createTaskFormSchema,
  emptyCreateTaskForm,
  toCreateTaskBody,
  type CreateTaskFormInput,
  type CreateTaskFormOutput,
} from "./task-form-schema";

/** 这些状态码说明「服务端确定没有落库」，换一个新的幂等键再提交是安全的 */
const DEFINITELY_NOT_CREATED = new Set([400, 403, 404, 409]);

export function CreateTaskForm({ projectId }: { projectId: string }) {
  const createTask = useCreateTask(projectId);
  const form = useForm<CreateTaskFormInput, unknown, CreateTaskFormOutput>({
    resolver: zodResolver(createTaskFormSchema),
    defaultValues: emptyCreateTaskForm,
    mode: "onTouched",
  });
  const { errors, isSubmitting } = form.formState;

  // 一次「创建意图」一个键：网络重试复用它；成功或确定失败后才换新键
  const idempotencyKey = useRef(crypto.randomUUID());

  async function onSubmit(values: CreateTaskFormOutput) {
    try {
      await createTask.mutateAsync({
        body: toCreateTaskBody(values),
        idempotencyKey: idempotencyKey.current,
      });
      idempotencyKey.current = crypto.randomUUID();
      form.reset(emptyCreateTaskForm);
    } catch (error) {
      if (
        error instanceof ApiError &&
        DEFINITELY_NOT_CREATED.has(error.status)
      ) {
        idempotencyKey.current = crypto.randomUUID();
      }
      // 400 / 409 的字段错误回到对应输入框；其余错误由下方 ErrorBanner 展示
      applyServerFieldErrors(error, form.setError, CREATE_TASK_FIELDS);
    }
  }

  const fieldProps = (name: (typeof CREATE_TASK_FIELDS)[number]) => ({
    id: `task-${name}`,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `task-${name}-error` : undefined,
  });
  const fieldError = (name: (typeof CREATE_TASK_FIELDS)[number]) =>
    errors[name] && (
      <p id={`task-${name}-error`} className="field-error" role="alert">
        {errors[name]?.message}
      </p>
    );

  // 字段级错误已经回填到输入框上，就不再重复弹横幅
  const showBanner =
    createTask.isError &&
    !(
      createTask.error instanceof ApiError &&
      [400, 409].includes(createTask.error.status)
    );

  return (
    <form
      noValidate
      className="card"
      onSubmit={form.handleSubmit(onSubmit)}
      aria-label="新建任务"
    >
      <h2>新建任务</h2>
      {showBanner && <ErrorBanner error={createTask.error} />}
      {errors.root?.server && (
        <p role="alert" className="field-error">
          {errors.root.server.message}
        </p>
      )}

      <label htmlFor="task-title">标题</label>
      <input {...fieldProps("title")} {...form.register("title")} />
      {fieldError("title")}

      <label htmlFor="task-description">描述</label>
      <textarea
        {...fieldProps("description")}
        rows={3}
        {...form.register("description")}
      />
      {fieldError("description")}

      <label htmlFor="task-priority">优先级</label>
      <select {...fieldProps("priority")} {...form.register("priority")}>
        {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {fieldError("priority")}

      <label htmlFor="task-dueDate">截止日期</label>
      <input
        type="date"
        {...fieldProps("dueDate")}
        {...form.register("dueDate")}
      />
      {fieldError("dueDate")}

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "创建中…" : "创建任务"}
      </button>
    </form>
  );
}
```

### 数据在组件里的流动

```
用户输入
  │  form.register(...)                       ← RHF 收集值（CreateTaskFormInput）
  ▼
form.handleSubmit(onSubmit)
  │  zodResolver(createTaskFormSchema)        ← Zod 校验；失败 → errors[字段]，不调用 onSubmit
  ▼
onSubmit(values: CreateTaskFormOutput)        ← 已 trim、类型已收窄
  │  toCreateTaskBody(values)                 ← 表单形状 → 契约形状（"" → null），返回 CreateTaskBody
  ▼
createTask.mutateAsync({ body, idempotencyKey })
  │  mutationFn → api.POST(...)               ← 生成的客户端：路径、参数、请求体全部有类型
  │  中间件：X-CSRF-Token、X-Request-Id
  ▼
unwrap()                                      ← 2xx → Task；否则抛 ApiError / NetworkError
  ├─ 成功：onSuccess 失效列表缓存 → 换新键 → reset 表单
  └─ 失败：applyServerFieldErrors → 字段错误；其他 → ErrorBanner
```

### 几个关键决策

**① 三泛型 `useForm<Input, unknown, Output>`。** 表单 schema 用了 `.trim()`，输入和输出类型在概念上不同。显式写出三个泛型，`handleSubmit` 的回调参数就是 `CreateTaskFormOutput`。（《可访问设计系统与复杂表单实战》第 8.3 节有详细解释。）

**② 用 `mutateAsync` + `try/catch`，而不是 `mutate` + 回调。** 因为 `onSubmit` 返回的 Promise 被 RHF 用来维护 `isSubmitting`：Promise 未结束时按钮是禁用的，这就是第一层重复提交防护。用 `mutate`（不返回 Promise），`isSubmitting` 会在请求还没完成时就变回 `false`。

**③ 幂等键的生命周期。** 键用 `useRef` 保存，在多次提交之间保持；什么时候换新键：

| 结果                     | 服务器上发生了什么         | 键怎么办                                                               |
| ------------------------ | -------------------------- | ---------------------------------------------------------------------- |
| 201 成功                 | 已创建                     | **换新**（下一个任务是新的意图）                                       |
| 400 / 409                | 确定没创建（事务回滚）     | **换新**（用户会修改内容再提交）                                       |
| 403 / 404                | 确定没创建                 | **换新**                                                               |
| 网络错误（重试后仍失败） | **不知道**                 | **保留**（用户再点一次，如果其实已创建，会得到重放结果而不是重复任务） |
| 500 / 502 / 503          | **不知道**                 | **保留**                                                               |
| 422 键被复用             | 之前用这个键创建过别的内容 | 保留，提示用户刷新（第 11 章）                                         |

这张表是第 11 章「幂等键生命周期」在 UI 层的落地。

> 为什么 400/409 也要换键？严格来说不换也行：服务端的事务回滚了，键并没有被占用。但如果某个 4xx 是在**占用键之后**才抛出的（比如将来 Service 改了顺序），保留旧键再提交不同的内容就会得到 422。确定失败时换键，规则更简单、更不容易出错。

**④ 字段错误和横幅不重复显示。** 400/409 的错误已经显示在输入框下面了，再在顶部弹一个横幅就是重复信息。其他错误（403、500、网络）不属于任何字段，用横幅展示。

**⑤ 可访问性。** 每个错误消息都有 `id`，输入框通过 `aria-describedby` 关联它，`aria-invalid` 标记错误状态，错误消息带 `role="alert"` 让读屏软件播报。服务端错误回填时 `shouldFocus` 让第一个出错的字段获得焦点。

---

## 10.4 练习 3：状态码 → UI 映射

UI 不应该到处写 `if (error.status === 403)`。我们把「错误长什么样、下一步做什么」集中在一个纯函数里（**`apps/web/src/lib/errors.ts`**）：

```ts
/** UI 只关心「怎么展示、下一步做什么」，不关心 HTTP 细节 */
export interface ErrorView {
  title: string;
  message: string;
  requestId: string | null;
  action: "retry" | "login" | "reload" | "back" | "none";
}

export function describeError(error: unknown): ErrorView {
  if (error instanceof NetworkError) {
    return {
      title: "网络异常",
      message: error.message,
      requestId: null,
      action: "retry",
    };
  }
  if (isAbortError(error)) {
    return {
      title: "请求已取消",
      message: "",
      requestId: null,
      action: "none",
    };
  }
  if (!(error instanceof ApiError)) {
    return {
      title: "出错了",
      message: "发生未知错误，请刷新页面",
      requestId: null,
      action: "reload",
    };
  }

  const { requestId } = error;
  switch (error.status) {
    case 400:
      return {
        title: "提交的数据有误",
        message: error.message,
        requestId,
        action: "none",
      };
    case 401:
      return {
        title: "登录已过期",
        message: "请重新登录后继续",
        requestId,
        action: "login",
      };
    case 403:
      return error.code === "CSRF_REJECTED"
        ? {
            title: "页面已过期",
            message: "请刷新页面后重试",
            requestId,
            action: "reload",
          }
        : {
            title: "没有权限",
            message: error.message,
            requestId,
            action: "back",
          };
    case 404:
      return {
        title: "内容不存在",
        message: "它可能已被删除，或你没有访问权限",
        requestId,
        action: "back",
      };
    case 409:
      return {
        title: "与现有数据冲突",
        message: error.message,
        requestId,
        action: "none",
      };
    case 412:
    case 428:
      return {
        title: "内容已被他人修改",
        message: error.message,
        requestId,
        action: "reload",
      };
    case 422:
      return {
        title: "无法重复提交",
        message: error.message,
        requestId,
        action: "reload",
      };
    case 429:
      return {
        title: "操作太频繁",
        message: "请稍等片刻再试",
        requestId,
        action: "retry",
      };
  }
  if (error.status >= 500) {
    return {
      title: "服务器出错了",
      message:
        "我们已记录这个问题，请稍后重试。如需反馈，请附上下方的请求编号。",
      requestId,
      action: "retry",
    };
  }
  return {
    title: "请求失败",
    message: error.message,
    requestId,
    action: "none",
  };
}
```

完整的映射矩阵：

| 情况               | 表现形式                       | 文案来源                              | 下一步      | 为什么这样设计                               |
| ------------------ | ------------------------------ | ------------------------------------- | ----------- | -------------------------------------------- |
| **400 有字段错误** | 回填到输入框，聚焦第一个       | 服务端 `fields[].message`             | 用户修改    | 和客户端校验体验一致                         |
| 400 无字段错误     | 横幅                           | 服务端 `message`                      | —           | 罕见（如 JSON 损坏），通常是 bug             |
| **401**            | **全局**：清空缓存，回到登录页 | —                                     | 登录        | 会话失效是全局状态，不该每个组件各弹一次     |
| **403 FORBIDDEN**  | 横幅「没有权限」               | 服务端 `message`（「只读成员不能…」） | 返回        | 告诉用户「为什么不行」，而不是笼统的「失败」 |
| 403 CSRF_REJECTED  | 横幅「页面已过期」+ 刷新按钮   | 固定文案                              | 刷新        | 最常见原因是换了会话没刷新页面               |
| **404**            | 横幅「内容不存在」             | 固定文案                              | 返回        | 不区分「被删了」和「没权限」（第 9 章）      |
| **409 有字段错误** | 回填到 `title` 输入框          | 服务端 `fields[].message`             | 用户改名    | 冲突本质上是字段问题                         |
| 412 / 428          | 横幅 + 刷新按钮                | 服务端 `message`                      | 刷新看最新  | 第 11 章                                     |
| 422                | 横幅                           | 服务端 `message`                      | 刷新        | 第 11 章                                     |
| 429                | 横幅「操作太频繁」             | 固定文案                              | 稍后重试    | 查询会按 `Retry-After` 自动重试              |
| **500 / 5xx**      | 横幅 + **请求编号**            | 固定文案                              | 重试 / 反馈 | 不展示任何内部信息；给用户一个可以报告的编号 |
| 网络错误           | 横幅「网络异常」+ 重试         | 固定文案                              | 重试        | 幂等接口已自动重试过                         |

`ErrorBanner` 组件把 `ErrorView` 渲染出来（**`apps/web/src/components/ErrorBanner.tsx`**）：

```tsx
/** 统一的错误展示：标题 + 说明 + 可复制的请求编号 + 下一步动作 */
export function ErrorBanner({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const view = describeError(error);
  if (view.action === "none" && !view.message) return null;
  return (
    <div role="alert" className="error-banner">
      <strong>{view.title}</strong>
      {view.message && <p>{view.message}</p>}
      {view.requestId && (
        <p className="request-id">
          请求编号：<code>{view.requestId}</code>
        </p>
      )}
      {view.action === "retry" && onRetry && (
        <button type="button" onClick={onRetry}>
          重试
        </button>
      )}
      {view.action === "reload" && (
        <button type="button" onClick={() => window.location.reload()}>
          刷新页面
        </button>
      )}
    </div>
  );
}
```

`login` 动作没有按钮，因为 401 已经被全局处理（第 7 章），用户会直接看到登录页。

### 为什么按 `status` 分支，而不是按 `code`？

`describeError` 主要按 HTTP 状态码分支，只在 403 时细看 `code`。这是有意的：

- 状态码是 HTTP 标准，**永远存在**，即使响应体不是我们的 envelope（网关的 502）；
- `code` 是**细分**，用于同一个状态码下需要不同 UI 的情况（403 的权限 vs CSRF）；
- 遇到不认识的 `code`（`UNKNOWN`），按状态码兜底，界面不会崩。

---

## 10.5 列表与更新：412 冲突的 UI

**`apps/web/src/features/tasks/TaskList.tsx`**（节选）：

```tsx
const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: "doing",
  doing: "done",
  done: "todo",
};

/** 服务端将来新增的枚举值，旧前端不认识：显示原值，而不是崩溃或显示空白 */
function label<T extends string>(map: Record<T, string>, value: T): string {
  return (map as Record<string, string>)[value] ?? value;
}

export function TaskList({
  projectId,
  canWrite,
}: {
  projectId: string;
  canWrite: boolean;
}) {
  const [status, setStatus] = useState<TaskStatus | undefined>();
  const list = useTaskList(projectId, status);
  const update = useUpdateTask(projectId);
  const tasks = list.data?.pages.flatMap((page) => page.items) ?? [];

  function advance(task: Task) {
    const next = NEXT_STATUS[task.status] ?? "todo";
    update.mutate({ task, patch: { status: next } });
  }

  return (
    <section className="card" aria-labelledby="task-list-title">
      {/* ……筛选下拉框…… */}
      {update.isError && (
        <ErrorBanner
          error={update.error}
          {...(update.error instanceof ApiError && update.error.status === 412
            ? {}
            : { onRetry: () => update.reset() })}
        />
      )}
      {list.isPending && <p>加载中…</p>}
      {list.isError && (
        <ErrorBanner error={list.error} onRetry={() => list.refetch()} />
      )}
      <ul className="task-list">
        {tasks.map((task) => (
          <li key={task.id}>
            <strong>{task.title}</strong>
            <span className={`badge badge-${task.status}`}>
              {label(STATUS_LABEL, task.status)}
            </span>
            <span>优先级：{label(PRIORITY_LABEL, task.priority)}</span>
            {task.dueDate && (
              <span>截止：{formatCalendarDate(task.dueDate)}</span>
            )}
            <time dateTime={task.createdAt}>
              创建于 {formatInstant(task.createdAt)}
            </time>
            {canWrite && (
              <button
                type="button"
                onClick={() => advance(task)}
                disabled={update.isPending}
              >
                标记为「
                {label(STATUS_LABEL, NEXT_STATUS[task.status] ?? "todo")}」
              </button>
            )}
          </li>
        ))}
      </ul>
      {list.hasNextPage && (
        <button
          type="button"
          onClick={() => list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
        >
          {list.isFetchingNextPage ? "加载中…" : "加载更多"}
        </button>
      )}
    </section>
  );
}
```

`useUpdateTask` 在请求头里带上 `If-Match: "<version>"`（第 11 章）。如果别人先改了这个任务：

1. 服务端返回 412 `PRECONDITION_FAILED`；
2. `onSettled` 检测到 412，**失效列表缓存**，TanStack Query 重新拉取最新数据；
3. 横幅显示「内容已被他人修改」，用户看到的列表已经是最新的，可以基于最新状态再次操作。

```ts
onSettled: (_data, error) => {
  // 成功：刷新列表；412：本地数据已过期，同样需要拉最新
  if (!error || (error instanceof ApiError && error.status === 412)) {
    return queryClient.invalidateQueries({ queryKey: taskKeys.lists(projectId) });
  }
},
```

这个行为和「未知枚举值兜底」都有组件测试（**`apps/web/src/features/tasks/TaskList.test.tsx`**）：

```tsx
it("服务端新增了前端不认识的枚举值：显示原值，不崩溃", async () => {
  setup(() =>
    json(200, {
      items: [{ ...baseTask, status: "blocked" }],
      nextCursor: null,
    }),
  );
  expect(await screen.findByText("写发布说明")).toBeTruthy();
  expect(screen.getByText("blocked")).toBeTruthy();
});

it("更新时带 If-Match；412 → 提示被他人修改，并重新拉取列表", async () => {
  let version = 1;
  const { requests, user } = setup((req) => {
    if (req.method === "PATCH") {
      version = 2; // 别人抢先改了
      return json(412, {
        error: {
          code: "PRECONDITION_FAILED",
          message: "任务已被其他人修改，请查看最新内容后再保存",
          requestId: "req-list",
        },
      });
    }
    return json(200, { items: [{ ...baseTask, version }], nextCursor: null });
  });

  await user.click(
    await screen.findByRole("button", { name: "标记为「进行中」" }),
  );
  expect(await screen.findByText("内容已被他人修改")).toBeTruthy();

  const patch = requests.find((r) => r.method === "PATCH");
  expect(patch?.headers.get("if-match")).toBe('"1"');
  // 412 之后列表被重新请求了一次
  await waitFor(() =>
    expect(requests.filter((r) => r.method === "GET")).toHaveLength(2),
  );
});
```

---

## 10.6 登录表单

登录表单是一个更简单的同类例子（**`apps/web/src/features/auth/LoginForm.tsx`**）：

```tsx
const loginSchema = z.object({
  email: z.email("请输入有效的邮箱"),
});

export function LoginForm() {
  const login = useLogin();
  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "alice@example.com" },
  });
  // ……
  return (
    <form
      noValidate
      className="card"
      onSubmit={form.handleSubmit((values) => login.mutate(values.email))}
    >
      {login.isError && <ErrorBanner error={login.error} />}
      {/* ……邮箱输入框，同样有 aria-invalid / aria-describedby…… */}
    </form>
  );
}
```

登录失败（401）时，`ErrorBanner` 显示「登录已过期」并不合适——这里的 401 意思是「凭据不正确」。`login.error` 的 `message` 是服务端的「邮箱或凭据不正确」。作为练习，你可以给 `ErrorBanner` 加一个 `overrides` 参数，让调用方针对特定场景覆盖标题。

---

## 10.7 组件测试：证明每一种映射

**`apps/web/src/features/tasks/CreateTaskForm.test.tsx`**。测试的关键是 `setup()`：用注入的假 `fetch` 构造一个**真实的** api-client，经过真实的中间件、真实的 `unwrap`、真实的 TanStack Query。

```tsx
/** 渲染表单，并用假 fetch 记录每个请求 */
function setup(handler: Handler) {
  const requests: { req: Request; body: unknown }[] = [];
  const api = createApiClient({
    baseUrl: "http://test",
    getCsrfToken: () => "csrf-test",
    fetch: async (req) => {
      const body = await req
        .clone()
        .json()
        .catch(() => null);
      requests.push({ req, body });
      return handler(req, body);
    },
  });
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retryDelay: 0 } },
  });
  render(
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={queryClient}>
        <CreateTaskForm projectId={PROJECT} />
      </QueryClientProvider>
    </ApiContext.Provider>,
  );
  return { requests, user: userEvent.setup() };
}
```

覆盖练习 3 要求的每一种状态码：

```tsx
it("客户端校验不通过时根本不发请求", async () => {
  const { requests, user } = setup(() => json(201, task));
  await user.click(screen.getByRole("button", { name: "创建任务" }));
  expect(await screen.findByText("请填写标题")).toBeTruthy();
  expect(screen.getByLabelText("标题").getAttribute("aria-invalid")).toBe(
    "true",
  );
  expect(requests).toHaveLength(0);
});

it("成功：请求体符合契约，带幂等键与 CSRF 头，成功后清空并换新键", async () => {
  const { requests, user } = setup(() => json(201, task));
  await user.type(screen.getByLabelText("标题"), "  写发布说明 ");
  await user.click(screen.getByRole("button", { name: "创建任务" }));
  await waitFor(() => expect(requests).toHaveLength(1));

  const first = requests[0]!;
  expect(first.req.headers.get("x-csrf-token")).toBe("csrf-test");
  expect(first.body).toEqual({
    title: "写发布说明",
    description: null,
    priority: "medium",
    dueDate: null,
  });
  await waitFor(() =>
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe(""),
  );

  await user.type(screen.getByLabelText("标题"), "第二个任务");
  await user.click(screen.getByRole("button", { name: "创建任务" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]!.req.headers.get("idempotency-key")).not.toBe(
    first.req.headers.get("idempotency-key"),
  );
});

it("400 字段错误 → 回填到对应输入框", async () => {
  const { user } = setup(() =>
    json(
      400,
      envelope("VALIDATION_FAILED", "提交的数据有误", [
        {
          in: "body",
          path: "title",
          rule: "pattern",
          message: "标题不能只包含表情符号",
        },
      ]),
    ),
  );
  await user.type(screen.getByLabelText("标题"), "🎉");
  await user.click(screen.getByRole("button", { name: "创建任务" }));
  expect(await screen.findByText("标题不能只包含表情符号")).toBeTruthy();
  expect(screen.getByLabelText("标题").getAttribute("aria-invalid")).toBe(
    "true",
  );
});

it("409 唯一冲突 → 标题字段提示", async () => {
  /* …同理… */
});

it("403 → 权限横幅；500 → 通用文案 + 请求编号", async () => {
  let status = 403;
  const { user } = setup(() =>
    status === 403
      ? json(403, envelope("FORBIDDEN", "只读成员不能创建或修改任务"))
      : json(500, envelope("INTERNAL", "服务器开小差了，请稍后重试")),
  );
  await user.type(screen.getByLabelText("标题"), "试试");
  await user.click(screen.getByRole("button", { name: "创建任务" }));
  expect(await screen.findByText("没有权限")).toBeTruthy();
  expect(screen.getByText("只读成员不能创建或修改任务")).toBeTruthy();

  status = 500;
  await user.click(screen.getByRole("button", { name: "创建任务" }));
  expect(await screen.findByText("服务器出错了")).toBeTruthy();
  expect(screen.getByText("req-test")).toBeTruthy();
});

it("网络错误自动重试，且重试复用同一个幂等键", async () => {
  /* 第 7 章 */
});
```

401 和 404 的映射是纯函数行为，用表驱动测试覆盖更清晰（**`apps/web/src/lib/errors.test.ts`**）：

```ts
describe("describeError：状态码 → UI", () => {
  it.each([
    [400, "VALIDATION_FAILED", "提交的数据有误", "none"],
    [401, "UNAUTHENTICATED", "登录已过期", "login"],
    [403, "FORBIDDEN", "没有权限", "back"],
    [403, "CSRF_REJECTED", "页面已过期", "reload"],
    [404, "NOT_FOUND", "内容不存在", "back"],
    [409, "CONFLICT", "与现有数据冲突", "none"],
    [412, "PRECONDITION_FAILED", "内容已被他人修改", "reload"],
    [429, "RATE_LIMITED", "操作太频繁", "retry"],
    [500, "INTERNAL", "服务器出错了", "retry"],
    [502, "UNKNOWN", "服务器出错了", "retry"],
  ] as const)("%i %s → %s", (status, code, title, action) => {
    const view = describeError(apiError(status, code));
    expect(view).toMatchObject({ title, action });
  });
});
```

运行前端全部测试：

```bash
pnpm --filter @taskflow/web test
#  ✓ src/lib/errors.test.ts (15 tests)
#  ✓ src/features/tasks/task-form-schema.test.ts (4 tests)
#  ✓ src/features/tasks/TaskList.test.tsx (2 tests)
#  ✓ src/features/tasks/CreateTaskForm.test.tsx (6 tests)
#  Tests  27 passed (27)
```

> **测试替身的选择**：这里注入假 `fetch`，而不是 mock `useCreateTask` 或 mock 整个 api-client 模块。区别在于：注入 `fetch` 时，**中间件、类型、`unwrap`、错误规整、TanStack Query 的重试**都是真实运行的代码，只有网络是假的。测试离真实行为越近，能发现的问题越多。

---

## 10.8 手动走一遍完整流程

```bash
pnpm --filter @taskflow/api dev:memory   # 终端 1
pnpm dev:web                             # 终端 2，打开 http://localhost:5173
```

按顺序检查：

1. **alice 登录** → 看到项目和创建表单；
2. 不填标题直接提交 → 「请填写标题」，Network 面板里**没有请求**；
3. 创建「发布 v2」→ 列表出现新任务，表单清空；
4. 再创建「发布 V2」→ 标题下出现「该项目中已有同名的未完成任务」（409）；
5. 在 Network 面板看请求头：`X-CSRF-Token`、`Idempotency-Key`、`X-Request-Id`；看响应头：`ETag`、`Location`、`X-Request-Id`；
6. 点「标记为进行中」→ 状态变化，版本 +1；
7. 开两个标签页，都停在同一个任务上；在 A 里推进状态，**30 秒内**再在 B 里推进 → B 显示「内容已被他人修改」，列表自动刷新（412）。（超过 30 秒的话，切回 B 时 TanStack Query 会因为数据过期而自动刷新，冲突就不会发生——这本身也是一层保护。）
8. **退出，bob 登录** → 没有创建表单，提示「只读成员」。在控制台里绕过 UI：
   ```js
   const { csrfToken } = await (await fetch("/api/v1/auth/session")).json();
   const { items } = await (await fetch("/api/v1/projects")).json();
   const res = await fetch(`/api/v1/projects/${items[0].id}/tasks`, {
     method: "POST",
     headers: {
       "content-type": "application/json",
       "x-csrf-token": csrfToken,
       "idempotency-key": crypto.randomUUID(),
     },
     body: JSON.stringify({ title: "bob 的任务" }),
   });
   console.log(res.status, await res.json()); // 403 FORBIDDEN：UI 隐藏不等于权限
   ```
   去掉 `x-csrf-token` 再试一次 → 403 `CSRF_REJECTED`；
9. **carol 登录** → 「你还没有加入任何项目」；
10. 停掉 API 进程，刷新列表 → 「网络异常」横幅，带重试按钮；重启 API 后点重试 → 恢复。

---

## 10.9 常见坑

| 现象                               | 原因                               | 解决                                                  |
| ---------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| 提交按钮在请求完成前就恢复可点击   | 用了 `mutate` 而不是 `mutateAsync` | `onSubmit` 返回 Promise                               |
| 服务端字段错误没显示               | 字段名不一致 / 表单里没有这个字段  | 点号路径 + 白名单（第 6 章）                          |
| 400 错误同时显示在字段下和顶部横幅 | 横幅没有排除字段错误               | `showBanner` 排除 400/409                             |
| 每个组件都弹「登录已过期」         | 各自处理 401                       | 全局 `QueryCache.onError`                             |
| 测试里的查询失败后要等很久才结束   | 测试的 QueryClient 用了默认重试    | 测试里 `queries: { retry: false }` 或 `retryDelay: 0` |
| 新增枚举值后列表显示空白           | 直接 `STATUS_LABEL[task.status]`   | `label()` 兜底显示原值                                |
| 隐藏了按钮就以为没有权限问题       | —                                  | 服务端 403 + 绕过测试                                 |

---

## 10.10 本章验收清单

- [ ] 前端代码里没有任何手写的 API 类型、URL 拼接或裸 `fetch`；
- [ ] **练习 2**：表单 → Zod → `toCreateTaskBody` → `useCreateTask` → 生成的客户端 → 服务端，完整跑通；
- [ ] 能解释 `mutateAsync` 与 `isSubmitting` 的关系，以及三泛型 `useForm` 的作用；
- [ ] 能说出幂等键在每种结果下是保留还是换新，以及原因；
- [ ] **练习 3**：400 字段错误回填到输入框、401 全局回到登录、403 权限/CSRF 分别提示、404 内容不存在、409 回填到标题、500 显示请求编号；
- [ ] 412 冲突时自动刷新列表并提示用户；
- [ ] 所有错误消息都可被读屏软件播报（`role="alert"`、`aria-describedby`）；
- [ ] 组件测试注入假 `fetch`，覆盖以上每一种映射。

---

上一章：[← 第 9 章：创建任务（上）：服务端链路](./09-create-task-backend.md) ｜ 下一章：[第 11 章：幂等键与并发更新 →](./11-idempotency-and-concurrency.md)
