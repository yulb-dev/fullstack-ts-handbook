# 第 2 章：环境搭建与第一个测试

> 本章从空目录开始，搭出一个能跑测试的 TypeScript 工程，写出第一个通过的测试，并学会读懂 Vitest 的输出。跟做完成后，你就拥有了继续全书所需的最小环境。

## 2.1 检查运行环境

Vitest 5 有硬性版本要求：**Node.js ≥ 22.12**（Vite ≥ 6.4 由 vitest 的 peer dependency 保证）。先确认：

```bash
node --version
# v24.21.0（本教程验证环境；≥ 22.12 即可）
npm --version
# 11.x
```

如果你的 Node 版本偏低，用 [nvm](https://github.com/nvm-sh/nvm) 或 [fnm](https://github.com/Schniz/fnm) 切换：

```bash
nvm install 22 && nvm use 22
```

## 2.2 初始化工程

从零建一个目录（也可以直接看配套工程 [example](./example)，它就是按这些步骤搭出来的）：

```bash
mkdir taskdesk && cd taskdesk
npm init -y
```

把 `package.json` 改成 ESM 工程（Vitest 5 原生 ESM，全书代码都用 `import`/`export`）：

```json
{
  "name": "taskdesk-vitest-example",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.12"
  }
}
```

`"type": "module"` 意味着所有 `.js`/`.ts` 文件默认按 ESM 解析。这带来一个贯穿全书的习惯：**相对导入必须写扩展名**（`./task-flow.js` 而不是 `./task-flow`）——即使源文件是 `.ts`，导入路径也写编译后的 `.js`。TypeScript 的 `NodeNext` 模块解析就是这么要求的，Vite 也能正确把 `.js` 映射回 `.ts` 源文件。

安装依赖。第一批只装最小集合：

```bash
npm i -D vitest typescript tsx @types/node
npm i zod
```

- `vitest`：测试框架本体（会自动带上匹配版本的 `vite` peer 依赖）
- `typescript` + `tsx`：类型检查与直接运行 TS 脚本
- `zod`：运行时 schema 校验（domain 层使用，业务依赖装进 `dependencies`）

> **配套工程的一个坑，提前告诉你**：TaskDesk Lite 还依赖 `drizzle-orm@1.0.0-rc.4`，它的**可选** peer 依赖 `effect` 声明了一个含预发布号的版本范围（`">=4.0.0-beta.83 || >=4.0.0"`），npm 11 的求解器会对这种范围误报 `ERESOLVE unable to resolve dependency tree`。解决办法是在工程根加一个 `.npmrc`：
>
> ```ini
> legacy-peer-deps=true
> ```
>
> `effect` 是 Drizzle 的可选集成，我们根本没用它，跳过该 peer 求解是安全的。如果你自己搭的项目没装 drizzle-orm rc 版，就不需要这个文件。

再补上 TypeScript 配置 `tsconfig.json`（与配套工程一致）：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "noEmit": true
  },
  "include": ["src", "test", "vitest.config.ts", "drizzle.config.ts"]
}
```

两个选项值得解释：

- `paths: { "@/*": ["src/*"] }` 让 TS 认识 `@/domain/task-flow.js` 这种别名导入。**注意 TS 只负责类型检查，不负责运行时解析**——运行时的别名解析要靠 Vitest 配置里的 `resolve.alias`（第 3 章），两边必须一致。
- `lib` 里加了 `DOM`：因为工程同时包含前端组件代码。纯后端工程可以不加。

## 2.3 第一个被测函数与第一个测试

先写被测对象。创建 `src/domain/task-flow.ts`——任务状态机（完整版见配套工程，这里先用它开跑）：

```ts
export const TASK_STATUSES = [
  "todo",
  "in_progress",
  "done",
  "archived",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ["in_progress", "archived"],
  in_progress: ["todo", "done", "archived"],
  done: ["in_progress"],
  archived: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
```

然后写测试。创建 `test/unit/task-flow.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { canTransition } from "@/domain/task-flow.js";

describe("task-flow 状态机", () => {
  it("todo 可以进入 in_progress", () => {
    expect(canTransition("todo", "in_progress")).toBe(true);
  });

  it("todo 不能跳过 in_progress 直接 done", () => {
    expect(canTransition("todo", "done")).toBe(false);
  });

  it("archived 是终态", () => {
    expect(canTransition("archived", "todo")).toBe(false);
  });
});
```

这段 12 行的代码包含了 Vitest 的三个核心 API：

- **`describe(name, fn)`**：把相关测试组织成一组。可以嵌套，输出里会显示层级路径。
- **`it(name, fn)`**（`test` 的别名，二者完全等价）：一个测试用例。名字应当是一句「行为描述」，读起来像规格说明书。
- **`expect(value).matcher(expected)`**：断言。`toBe` 用 `Object.is` 比较（适合原始值），对象/数组要用 `toEqual`（第 4 章细讲区别）。

注意 `describe/it/expect` 是从 `vitest` **显式导入**的。很多教程让你开 `globals: true` 配置省掉 import——本教程不开，理由在第 3 章讲。

### 文件命名约定

Vitest 默认只把文件名含 `.test.` 或 `.spec.` 的文件当作测试（如 `task-flow.test.ts`、`api.spec.ts`）。官方建议测试文件紧挨源文件放（`src/domain/task-flow.test.ts`）或集中在 `test/` 目录。本教程选择集中式并按层级分目录（`test/unit`、`test/component`、`test/integration`），因为第 3 章要给不同层配不同的运行环境。

## 2.4 添加测试脚本并运行

在 `package.json` 里加脚本：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

一个容易搞反的点：**`vitest` 不带参数时默认进入 watch 模式**（开发环境），`vitest run` 才是跑一次就退出。CI 环境（存在 `process.env.CI`）下 `vitest` 会自动切换成 run 模式，但脚本里显式写 `run` 更稳。

运行：

```bash
npm test
```

输出（Vitest 5 对多目录工程会按 project 分组显示，这里还没配 projects，所以是平铺的）：

```text
 ✓ test/unit/task-flow.test.ts (3 tests) 4ms
   ✓ task-flow 状态机 > todo 可以进入 in_progress
   ✓ task-flow 状态机 > todo 不能跳过 in_progress 直接 done
   ✓ task-flow 状态机 > archived 是终态

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  14:52:03
   Duration  312ms
```

读懂这几行：

- `✓ ... (3 tests) 4ms`：文件级结果与耗时。**单个测试文件耗时超过 1 秒就该警惕**——要么有真实 I/O，要么有不必要的等待（第 11 章处理这类问题）。
- `Test Files 1 passed (1)` / `Tests 3 passed (3)`：文件数与用例数是两个维度，失败时会显示 `1 failed | 2 passed (3)`。
- `Duration` 里除了测试本身，还有 import / transform / environment 的开销，排查慢测试时要分开看（第 11 章）。

再试试 watch 模式：

```bash
npm run test:watch
```

改一下 `task-flow.ts`（比如把 `done: ["in_progress"]` 改成 `done: []`），保存——Vitest 只重跑受影响的测试文件，你会立刻看到「done 只能重新打开」相关断言变红。改回来，又变绿。这就是第 1 章说的「回归防护」的日常形态。watch 模式界面底部有快捷键：`a` 重跑全部、`f` 只跑失败过的、`q` 退出。

### 故意写挂一个测试

学习失败输出比学习成功输出更重要。把断言改成 `expect(canTransition("todo", "done")).toBe(true)`，观察红色输出：

```text
 FAIL  test/unit/task-flow.test.ts > task-flow 状态机 > todo 不能跳过 in_progress 直接 done
AssertionError: expected false to be true // Object.is equality
 ❯ test/unit/task-flow.test.ts:11:38
     9|
    10|   it("todo 不能跳过 in_progress 直接 done", () => {
    11|     expect(canTransition("todo", "done")).toBe(true);
       |                                      ^
```

三要素：**哪个测试挂了**（完整 describe > it 路径）、**期望与实际的差异**（`expected false to be true`）、**精确到行列的源码定位**。对象断言失败时 Vitest 还会打印带 `+`/`-` 的结构化 diff（第 6 章会见到）。读错误输出永远从这三要素开始，而不是从头重跑。

## 2.5 补全工程骨架

第一个测试跑通后，把配套工程的完整结构建出来（后续章节逐个填充）：

```bash
npm i fastify react react-dom react-hook-form zustand @tanstack/react-query
npm i -D @vitejs/plugin-react vite jsdom \
  @testing-library/react @testing-library/dom @testing-library/user-event @testing-library/jest-dom \
  @types/react @types/react-dom \
  drizzle-orm@1.0.0-rc.4 drizzle-kit@1.0.0-rc.4 @electric-sql/pglite \
  @vitest/coverage-v8
```

版本说明：

- `@testing-library/react` 16.x 要求 React ≥ 18，且需要**显式安装 peer 依赖 `@testing-library/dom`**（npm 通常会自动装，写进 devDependencies 更明确）。
- `@vitest/coverage-v8` 必须与 `vitest` 主版本一致，第 10 章使用。
- `drizzle-orm` / `drizzle-kit` 锁定 `1.0.0-rc.4`，与本仓库 [Drizzle 教程](../9.drizzle-orm-tutorial/README.md) 同基线。
- `jsdom` 是组件测试的 DOM 模拟环境，`vite` + `@vitejs/plugin-react` 服务于 TSX 转换与本地 dev server。

目录骨架（成品见 [example](./example)）：

```text
taskdesk/
├── src/
│   ├── domain/       # 纯函数（本章的 task-flow.ts 放这里）
│   ├── services/     # 业务服务 + 端口接口（第 5 章）
│   ├── api/          # Fastify app factory（第 8 章）
│   ├── db/           # Drizzle schema + PGlite（第 9 章）
│   └── ui/           # React 组件（第 6 章）
├── test/
│   ├── unit/
│   ├── component/
│   └── integration/
├── drizzle/          # 数据库迁移（第 9 章生成）
├── package.json
└── tsconfig.json
```

最后加一个 `.gitignore`：

```text
node_modules/
dist/
coverage/
.vitest/
.pgdata/
.env
```

`coverage/` 是覆盖率报告产物，`.vitest/` 是 Vitest 5 存放生成物的目录（官方建议忽略），`.pgdata/` 是本地开发时 PGlite 的落盘数据。

## 2.6 常见报错排查

| 报错                                                          | 原因                                                | 解法                                                   |
| ------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| `Cannot find module './task-flow'`                            | ESM + NodeNext 下相对导入没写扩展名                 | 写全 `./task-flow.js`（TS 会映射到 `.ts`）             |
| `ReferenceError: describe is not defined`                     | 测试文件没从 `vitest` 导入 API，又没开 `globals`    | 顶部加 `import { describe, expect, it } from "vitest"` |
| `ERESOLVE unable to resolve dependency tree`（提到 `effect`） | drizzle-orm rc 版的可选 peer 范围触发 npm bug       | 工程根加 `.npmrc`：`legacy-peer-deps=true`（见 2.2）   |
| `Cannot find module '@/domain/...'`（运行时）                 | 只在 tsconfig 配了 paths，Vitest 不认识             | 在 vitest 配置里加 `resolve.alias`（第 3 章）          |
| 测试文件没被执行                                              | 文件名不含 `.test.` / `.spec.`，或不在 include 范围 | 改名，或检查 `test.include` 配置                       |

## 练习

1. 在 `task-flow.test.ts` 里补一个测试：`in_progress` 可以回退到 `todo`（答案：`expect(canTransition("in_progress", "todo")).toBe(true)`）。
2. 故意把 `it("archived 是终态")` 的断言写反，运行 `npm test`，**不看代码**只凭红色输出说出：哪个测试、期望什么、实际什么、错在哪个文件哪一行。这是排查失败的基本功。
3. 运行 `npm run typecheck`，确认零错误。以后每次写完测试都先过一遍 typecheck 再跑测试——类型错误会同时污染两个环节的输出。

## 本章来源

- Vitest 官方文档：[Getting Started](https://vitest.dev/guide/)（安装、Node/Vite 版本要求、`.test.`/`.spec.` 命名约定、`.vitest/` 目录与 .gitignore、`vitest run` 与 watch 模式、Bun 用户的 `bun run test` 注意事项）
- Vitest 官方文档：[Features](https://vitest.dev/guide/features)（watch 模式的模块图智能重跑、CI 环境自动 run 模式）
- npm `ERESOLVE` 与可选 peer 预发布范围的问题为实测记录（npm 11.19 / drizzle-orm 1.0.0-rc.4）

下一章：[03 配置与测试环境](./03-config-and-environments.md) —— 配置 `vitest.config.ts`，把三类测试拆进不同环境。
