# 第 13 章：综合实战——TaskFlow 与逐项验收

> 上一章：[第 12 章 测试与架构边界](./12-testing-and-boundaries.md) | 返回目录：[README](./README.md)

这是全书的收官章。我们把前 12 章的知识组装成一个**完整、可运行、状态归属清晰**的 TaskFlow 任务看板，走查一次真实交互的数据流，最后对照你最初的学习目标做一次**逐项验收**。

## 13.1 架构总览：每块状态归谁

先画出 TaskFlow 的「状态归属地图」——这是整套架构的灵魂：

```
┌──────────────────────────── TaskFlow ────────────────────────────┐
│                                                                    │
│  服务端状态（TanStack Query）          客户端状态（Zustand）         │
│  ─────────────────────────           ───────────────────          │
│  ['tasks', {status,page}]  列表        useUiStore:                 │
│  ['task', id]              详情          filter（当前筛选）         │
│  ['task-comments', id]     评论          viewMode（列表/看板）      │
│  useCreateTask             新增          sidebarCollapsed          │
│  useUpdateTask             改状态        isComposerOpen            │
│  useDeleteTask             删除          draftTitle（表单草稿）     │
│                                        usePreferencesStore:       │
│  ↑ 通过 query key 连接 ↑                theme / density（persist） │
│  filter 从 Zustand 读出 → 放进 ['tasks',{status:filter}] 的 key    │
└────────────────────────────────────────────────────────────────┘
```

**注意两边的分工**：Zustand 里**没有任何一条服务器数据**，只有「用户把界面调成了什么样」；TanStack Query 里**没有任何 UI 开关**，只有「服务器上的数据 + 它的缓存」。它们通过 `query key` 这一个接口对话。

## 13.2 完整代码

下面是一份可直接组装的最小完整实现。文件按职责分层，每段都标注了它对应前面哪一章。

### ① 客户端状态：两个 Zustand store

```tsx
// src/stores/useUiStore.ts —— 视图控制（不持久化，第 9 章）
import { create } from 'zustand'
import type { TaskStatus } from '../api/mockApi'

type ViewMode = 'list' | 'board'
interface UiState {
  filter: TaskStatus | 'all'
  viewMode: ViewMode
  sidebarCollapsed: boolean
  isComposerOpen: boolean
  draftTitle: string
  setFilter: (f: TaskStatus | 'all') => void
  setViewMode: (m: ViewMode) => void
  toggleSidebar: () => void
  openComposer: () => void
  closeComposer: () => void
  setDraftTitle: (t: string) => void
}

export const useUiStore = create<UiState>()((set) => ({
  filter: 'all',
  viewMode: 'list',
  sidebarCollapsed: false,
  isComposerOpen: false,
  draftTitle: '',
  setFilter: (filter) => set({ filter }),
  setViewMode: (viewMode) => set({ viewMode }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  openComposer: () => set({ isComposerOpen: true }),
  closeComposer: () => set({ isComposerOpen: false, draftTitle: '' }),
  setDraftTitle: (draftTitle) => set({ draftTitle }),
}))
```

```tsx
// src/stores/usePreferencesStore.ts —— 用户偏好（持久化，第 10、11 章）
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface PreferencesState {
  theme: 'light' | 'dark'
  density: 'comfortable' | 'compact'
  setTheme: (t: 'light' | 'dark') => void
  toggleDensity: () => void
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: 'light',
      density: 'comfortable',
      setTheme: (theme) => set({ theme }),
      toggleDensity: () =>
        set((s) => ({ density: s.density === 'compact' ? 'comfortable' : 'compact' })),
    }),
    {
      name: 'taskflow-preferences',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ theme: s.theme, density: s.density }), // 白名单，只存偏好
    },
  ),
)
```

### ② 服务端状态：查询与变更 hooks

```tsx
// src/hooks/useTasks.ts —— 列表查询（分页 + 筛选，第 3、4、7 章）
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { fetchTasks } from '../api/mockApi'
import { useUiStore } from '../stores/useUiStore'

export function useTasks(page: number) {
  const filter = useUiStore((s) => s.filter) // ← 从 Zustand 读 UI 状态
  return useQuery({
    // ↓ UI 状态 filter 进了 query key（铁律：影响结果的变量必须进 key）
    queryKey: ['tasks', { status: filter, page }],
    queryFn: () => fetchTasks({ status: filter, page, pageSize: 5 }),
    placeholderData: keepPreviousData, // 翻页不闪（第 7 章）
    staleTime: 30_000,                 // 30 秒内新鲜（第 4 章）
  })
}
```

```tsx
// src/hooks/useTaskMutations.ts —— 增删改 + 乐观更新（第 5、6 章）
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createTask, updateTask, deleteTask, type Task } from '../api/mockApi'

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }), // 失效所有列表
  })
}

export function useToggleTaskStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: Task['status'] }) =>
      updateTask(id, { status }),
    scope: { id: 'task-status' }, // 同资源串行，避免并发乐观更新互相覆盖（第 6 章）
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] }) // 先取消后台刷新
      const previous = qc.getQueryData<any>(['tasks']) // 拍快照
      // 乐观更新列表缓存里的这一条
      qc.setQueryData<any>(['tasks'], (old: any) =>
        old
          ? {
              ...old,
              items: old.items.map((t: Task) => (t.id === id ? { ...t, status } : t)),
            }
          : old,
      )
      return { previous }
    },
    onError: (_e, _v, context) => {
      if (context?.previous) qc.setQueryData(['tasks'], context.previous) // 失败回滚
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }), // 兜底对齐真值
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteTask,
    onSuccess: (_d, variables) => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.removeQueries({ queryKey: ['task', variables.id] })
    },
  })
}
```

```tsx
// src/hooks/useTaskDetail.ts —— 详情 + 依赖查询评论（第 3、7 章）
import { useQuery } from '@tanstack/react-query'
import { fetchTask, fetchComments } from '../api/mockApi'

export function useTaskDetail(id: number) {
  const task = useQuery({
    queryKey: ['task', id],
    queryFn: () => fetchTask(id),
    staleTime: 5 * 60_000, // 详情变动少，给更长新鲜度
  })
  const taskId = task.data?.id
  const comments = useQuery({
    queryKey: ['task-comments', taskId],
    queryFn: () => fetchComments(taskId!),
    enabled: !!taskId, // 依赖查询：等详情到了才查评论
  })
  return { task, comments }
}
```

### ③ 组件：订阅各自需要的状态

```tsx
// src/components/TaskBoard.tsx —— 主界面
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTasks } from '../hooks/useTasks'
import { useCreateTask, useToggleTaskStatus, useDeleteTask } from '../hooks/useTaskMutations'
import { useUiStore } from '../stores/useUiStore'
import { usePreferencesStore } from '../stores/usePreferencesStore'

const FILTERS = ['all', 'todo', 'doing', 'done'] as const

export function TaskBoard() {
  const [page, setPage] = useState(0)

  // 客户端状态：细粒度订阅（第 9 章），只订阅本组件真正用到的
  const filter = useUiStore((s) => s.filter)
  const setFilter = useUiStore((s) => s.setFilter)
  const theme = usePreferencesStore((s) => s.theme)

  // 服务端状态：从 Query 读（第 3 章）
  const { data, isPending, isError, error, isFetching, isPlaceholderData } = useTasks(page)

  const createTask = useCreateTask()
  const toggleStatus = useToggleTaskStatus()
  const deleteTask = useDeleteTask()
  const queryClient = useQueryClient()

  // 派生状态：渲染时算，不单独存（第 9 章铁律三）
  const visibleCount = data?.items.length ?? 0

  return (
    <div data-theme={theme} style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>TaskFlow {isFetching && <small>（刷新中…）</small>}</h1>

      {/* 筛选栏：改的是 Zustand 的 filter → query key 变 → Query 自动重取 */}
      <nav>
        {FILTERS.map((f) => (
          <button key={f} onClick={() => { setFilter(f); setPage(0) }}
                  style={{ fontWeight: filter === f ? 'bold' : 'normal', marginRight: 8 }}>
            {f}
          </button>
        ))}
      </nav>

      {isPending ? (
        <p>加载中…</p>
      ) : isError ? (
        <p style={{ color: 'red' }}>
          出错：{error.message}{' '}
          <button onClick={() => queryClient.invalidateQueries({ queryKey: ['tasks'] })}>
            重试
          </button>
        </p>
      ) : (
        <>
          <p>本页 {visibleCount} 条</p>
          <ul>
            {data.items.map((t) => (
              <li key={t.id}>
                <input
                  type="checkbox"
                  checked={t.status === 'done'}
                  onChange={() =>
                    toggleStatus.mutate({ id: t.id, status: t.status === 'done' ? 'todo' : 'done' })
                  }
                />
                <span style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>
                  [{t.status}] {t.title}
                </span>
                <button onClick={() => deleteTask.mutate(t.id)}>删除</button>
              </li>
            ))}
          </ul>

          {/* 分页（第 7 章）*/}
          <button onClick={() => setPage((p) => Math.max(p - 1, 0))} disabled={page === 0}>
            上一页
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={isPlaceholderData || !data.hasMore}
          >
            下一页
          </button>
        </>
      )}

      {/* 新增任务（第 5 章）*/}
      <button
        onClick={() => createTask.mutate({ title: `新任务 ${Date.now()}` })}
        disabled={createTask.isPending}
      >
        {createTask.isPending ? '新增中…' : '新增任务'}
      </button>
      {createTask.isError && <span style={{ color: 'red' }}>新增失败：{createTask.error.message}</span>}
    </div>
  )
}
```

至此，一个「筛选 + 分页 + 增删改 + 乐观更新 + 主题持久化」的完整应用就成型了，而**服务器数据和 UI 状态自始至终泾渭分明**。

## 13.3 走查：一次「切换筛选并勾选完成」的完整数据流

把两个库的协作慢放一遍，确认你真的理解了边界：

```
1. 用户点「done」筛选按钮
   → setFilter('done')  [Zustand 更新客户端状态]
   → 订阅了 filter 的 TaskBoard 重渲染

2. TaskBoard 重新执行 useTasks(page)
   → 读到 filter='done'，query key 变成 ['tasks', {status:'done', page:0}]
   → TanStack Query 发现这是个"新 key"，缓存里没有 → isPending，发起请求
   → （若之前看过 done 且缓存还在 → 秒出旧数据 + 后台刷新，即 stale-while-revalidate）

3. 数据回来，渲染 done 任务列表  [服务器数据只活在 Query 缓存里]

4. 用户勾选某任务复选框
   → toggleStatus.mutate({id, status:'todo'})
   → onMutate：取消后台刷新、拍快照、乐观把该任务改成 todo  [先改缓存]
   → 界面立刻反映勾选变化（不等服务器）

5. 服务器响应
   → 成功：onSettled 里 invalidateQueries(['tasks']) → 重新拉取，缓存对齐真值
   → 失败：onError 用快照回滚 → 界面弹回原样，并显示错误

6. 用户切了深色主题
   → setTheme('dark')  [Zustand + persist 写入 localStorage]
   → 刷新页面后自动恢复深色（hydration）
```

关键观察：**整个流程里，Zustand 从头到尾没有碰过任何一条任务数据**；TanStack Query 也从不关心「侧边栏是否折叠、主题是什么」。它们各司其职，通过 query key 和事件协作。这就是第 1 章心智模型的完整兑现。

## 13.4 逐项验收清单

对照你最初的学习目标，逐条打勾。每一条都标注了对应章节，没把握就回去重读。

### 🎯 总目标

- [ ] **能分别说出服务端状态与客户端状态的本质区别，并解释为什么不应把它们混成一种状态**（第 1、12 章）——两份真相、手搓残缺版 Query、失去缓存/去重/失效、优化手段不同。

### 📦 TanStack Query 核心概念

- [ ] **QueryClient**：知道它是缓存大脑，必须在模块顶层创建唯一实例，用 QueryClientProvider 注入（第 2 章）；
- [ ] **query key 结构**：必须是数组、对象键顺序无关、数组顺序敏感、按「资源名 + 参数对象」组织（第 3 章）；
- [ ] **queryFn**：任何返回 Promise 的函数，resolve 数据或 throw 错误，`undefined` 视为失败、fetch 需手动检查 `res.ok`（第 3 章）；
- [ ] **useQuery**：会写 `queryKey + queryFn` 的最小形态（第 2、3 章）；
- [ ] **loading/error/success 状态**：分得清 `status`（pending/error/success）与 `fetchStatus`（fetching/paused/idle），会写三态渲染（第 3 章）。

### ⏱ 缓存新鲜度与失效

- [ ] **staleTime**：数据新鲜度，默认 0，决定要不要重新请求（第 4 章）；
- [ ] **gcTime**：inactive 缓存的回收时间，默认 5 分钟，决定要不要从内存删（第 4 章）；
- [ ] **invalidateQueries**：标记过期 + active 时后台刷新，支持前缀/exact/predicate 匹配（第 4 章）；
- [ ] **主动 refetch 与默认自动刷新**：`refetch()` 手动重跑；默认在挂载/窗口聚焦/重连时刷新 stale 查询（第 4 章）。

### ✏️ useMutation 与生命周期

- [ ] **useMutation**：不自动执行，靠 `mutate(variables)` 触发（第 5 章）；
- [ ] **mutation 生命周期**：idle/pending/error/success + onMutate/onError/onSuccess/onSettled 及执行顺序（第 5 章）；
- [ ] **成功后失效相关 query**：在 onSuccess/onSettled 里 invalidateQueries 并 return Promise（第 5 章）；
- [ ] **取消请求**：queryFn 消费 `signal` 才能真正中断，`cancelQueries` 手动取消（第 5 章）；
- [ ] **重试和错误处理**：mutation 默认不重试，会用 error/onError 处理，理解离线重试与 scope 串行（第 5 章）。

### 🚀 乐观更新

- [ ] **先改缓存**：onMutate 里 cancelQueries → 拍快照 → setQueryData（第 6 章）；
- [ ] **失败回滚**：onError 用 context 里的快照 setQueryData 还原（第 6 章）；
- [ ] **并发 mutation 与最终一致性风险**：能解释「一个 mutation 回滚可能抹掉另一个的乐观结果」，知道用 onSettled invalidate 兜底 + scope 串行 + 高风险操作不做乐观更新（第 6 章）。

### 📄 进阶查询模式

- [ ] **分页**：page 进 key + `placeholderData: keepPreviousData` 消除闪烁（第 7 章）；
- [ ] **无限滚动**：useInfiniteQuery 的 initialPageParam/getNextPageParam/fetchNextPage/hasNextPage、data.pages 结构、maxPages（第 7 章）；
- [ ] **依赖查询**：用 `enabled` 控制时机，理解它是请求瀑布、能并行就别串行（第 7 章）；
- [ ] **预取**：事件处理器/组件/路由层用 prefetchQuery（配 staleTime），知道最新版对应 queryClient.query()（第 7 章）；
- [ ] **后台刷新**：能解释 stale-while-revalidate（第 4、7 章）；
- [ ] **缓存 key 必须包含所有影响结果的变量**（第 3、7 章铁律）。

### ⚡ 性能与调试

- [ ] **结构共享**：重新拉取后尽量保留未变部分引用，只对 JSON 兼容数据生效，可关闭/自定义（第 8 章）；
- [ ] **数据引用稳定性**：顶层结果对象不稳定、`data` 稳定，依赖挂 data 上（第 8 章）；
- [ ] **Query Devtools**：会观察状态、手动 refetch/invalidate，知道默认只在开发环境打包（第 2、8 章）；
- [ ] **默认重试/刷新行为**：查询 retry 3 次指数退避、窗口聚焦刷新开启；mutation 默认不重试（第 4、8 章）。

### 🐻 Zustand

- [ ] **store/action/selector**：create 建 store、set/get 改状态、selector 订阅（第 9 章）；
- [ ] **细粒度订阅**：只为 selector 结果变化重渲染，返回新对象/数组时用 `useShallow`（v5 移除了旧的 shallow 第二参数）（第 9 章）；
- [ ] **derived state**：不存派生值，在 selector 里算或组件内 useMemo（第 9 章）；
- [ ] **多个 store 的拆分策略**：多独立 store vs slices 模式，判断标准是「是否需要在一个 action 里协同改动」（第 10 章）。

### 💾 Zustand persist

- [ ] **partialize**：用白名单只存纯数据字段（第 11 章）；
- [ ] **版本升级与 migrate**：改结构就升 version 并写 migrate，会写单级/多级迁移（第 11 章）；
- [ ] **持久化存储不应保存秘密**：localStorage 明文易受 XSS，绝不存密码/token/密钥/敏感 PII，token 优先 HttpOnly Cookie 或内存（第 11 章）。

### 🧪 测试与调试

- [ ] **每个测试隔离 QueryClient**：用 wrapper 工厂每个测试 new 一个，配 retry:false、Jest 加 gcTime:Infinity（第 12 章）；
- [ ] **不要把服务端数据复制一份进 Zustand**：能讲清「两份真相」的危害，坚持服务器数据只活在 Query 缓存、通过 query key 协作（第 1、12 章）；
- [ ] （附加）会重置 Zustand store（setState(getInitialState(), true)）、会用 MSW/nock mock 网络（第 12 章）。

**全部打勾 = 你已经达成「分别掌握服务端状态缓存与客户端 UI 状态，并能解释为什么不应混用」的目标。**

## 13.5 下一步可以往哪走

你已经掌握了核心，下面是自然的进阶方向：

1. **接入真实后端**：把 `mockApi.ts` 换成真实 `fetch`/axios，记得在 fetch 版里补 `if (!res.ok) throw`；
2. **SSR / 框架集成**：Next.js / Remix / TanStack Router 里的服务端渲染与数据 hydration（`dehydrate`/`hydrate`/`HydrationBoundary`）；
3. **离线优先**：`persistQueryClient` + 离线 mutation 队列，做「断网也能操作、联网自动同步」；
4. **Suspense 模式**：`useSuspenseQuery` 配合 React Suspense/错误边界，换一种更「声明式」的数据加载写法；
5. **query key 工厂**：项目变大后用 query key factory 集中管理 key，避免手写字符串散落各处；
6. **Zustand 中间件进阶**：`redux` 中间件、`combine`、以及用 superjson 持久化 Map/Set/Date 等非 JSON 类型；
7. **读维护者博客**：TkDodo 的 *Practical React Query*、*React Query as a State Manager*、*Mastering Mutations*、*Concurrent Optimistic Updates*——本教程很多结论的一手来源。

## 13.6 结语

回到最开始那个让新手头疼的问题：**「这个数据该放哪？」**

现在你有了一套清晰的答案：

> **问「真相在哪」。真相在服务器 → TanStack Query（useQuery/useMutation），让它管缓存、失效、重试、乐观更新；真相在用户的界面操作里 → Zustand（create/selector），让它管跨组件共享与持久化；只在单个组件里临时用 → useState。派生值就地计算，不要落地成第二份真相。两者通过 query key 协作，各自不越界。**

服务端状态难，是因为它「异步、远端、会过期、多方共享」；客户端状态易，是因为它「同步、本地、你独占」。**用对工具，难的会变简单，简单的会更简单。** 这就是把两种状态分开管理的全部意义。

祝你在真实项目里，把每一个数据都放到它该在的地方。

---

> 上一章：[第 12 章 测试与架构边界](./12-testing-and-boundaries.md) | 返回目录：[README](./README.md)

**全书完。** 恭喜！🎉
