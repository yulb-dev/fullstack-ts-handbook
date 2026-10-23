# 第 3 章：配置与测试环境

> 第 2 章的工程已经能跑测试，但所有测试都挤在默认配置里。这一章把 `vitest.config.ts` 配起来：别名解析、node 与 jsdom 双环境、setupFiles、三个分层 projects——这也是配套工程最终使用的配置。

## 3.1 Vitest 怎么找配置

Vitest 复用 Vite 的配置体系，查找顺序是：

1. `--config` 显式指定的文件；
2. 项目根的 `vitest.config.ts`（也支持 `.js`/`.mts` 等）；
3. 项目根的 `vite.config.ts`（读取其中的 `test` 字段）。

**`vitest.config.ts` 优先级更高，且一旦存在就完全覆盖 `vite.config.ts`**——不是合并。所以如果你两份文件都要（dev server 用 vite 的、测试用 vitest 的），公共部分（如 `@` 别名、react 插件）要在两份里各写一遍，或者用 `mergeConfig` 显式合并。

配套工程的选择：两份配置各自独立、内容重叠的部分保持一致——

- [example/vite.config.ts](./example/vite.config.ts)：服务 `npm run dev` / `npm run build`，含 dev server 的 `/api` 代理；
- [example/vitest.config.ts](./example/vitest.config.ts)：服务测试，含 projects 与 coverage 配置。

配置文件里用 `defineConfig`（从 `vitest/config` 导入）获得完整类型提示：

```ts
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // ...测试专属配置都放在 test 字段里
  },
});
```

两个容易踩的点：

- **`resolve.alias` 是 Vite 顶层配置，不在 `test` 里面**。第 2 章 tsconfig 的 `paths` 只管类型检查，这里的 alias 才管运行时解析，两边要指向同一个目录。
- `plugins: [react()]` 让 Vitest 用与 dev/build 完全相同的 JSX 转换管线处理 `.tsx` 测试与组件。没有它，jsdom 环境的组件测试无法编译 JSX。

## 3.2 environment：测试代码跑在哪个「世界」里

`test.environment` 决定测试文件的全局环境：

| 值                              | 提供的世界                                  | 适用                             |
| ------------------------------- | ------------------------------------------- | -------------------------------- |
| `node`（默认）                  | 纯 Node.js：没有 `document`、`window`       | domain 纯函数、service、API 测试 |
| `jsdom`                         | 用 JS 模拟的 DOM（需安装 `jsdom`）          | React 组件测试                   |
| `happy-dom`                     | 另一个更快但兼容性略低的 DOM 模拟（需安装） | 组件测试的轻量替代               |
| `browser`（v5 的 Browser Mode） | 真实浏览器（需 Playwright/WebdriverIO）     | 需要真实渲染行为的组件测试       |

为什么不能全用 jsdom？因为**环境越重，每个测试文件的启动成本越高**（本配套工程实测：jsdom 环境文件的环境准备耗时明显高于 node），而且 node 环境能天然阻止前端代码里手滑用 `window`、后端测试里手滑依赖 DOM。原则：**默认 node，只有组件测试升到 jsdom**。

配置方式有两种粒度：

```ts
// 全局默认
export default defineConfig({
  test: { environment: "node" },
});
```

```ts
// 单文件覆盖：写在测试文件第一行的注释指令
// @vitest-environment jsdom
import { describe, it } from "vitest";
```

文件头注释（docblock）适合「一个以 node 为主的工程里偶有一个 DOM 测试」。但当 DOM 测试成规模时，正确的做法是下一节的 projects。

## 3.3 projects：把三个测试层拆成三个项目

Vitest 的 `test.projects` 允许一份配置里定义多个子项目，各自有独立的 `include`、`environment`、`setupFiles`。这正是第 1 章分层策略的落地（完整文件见 [example/vitest.config.ts](./example/vitest.config.ts)）：

```ts
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    projects: [
      {
        // 纯逻辑单元测试：Node 环境，速度最快
        test: {
          name: "unit",
          root: fileURLToPath(new URL(".", import.meta.url)),
          include: ["test/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // React 组件测试：jsdom + Testing Library setup
        test: {
          name: "component",
          root: fileURLToPath(new URL(".", import.meta.url)),
          include: ["test/component/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./test/setup-component.ts"],
        },
      },
      {
        // API 与数据库集成测试
        test: {
          name: "integration",
          root: fileURLToPath(new URL(".", import.meta.url)),
          include: ["test/integration/**/*.test.ts"],
          environment: "node",
          testTimeout: 30_000, // PGlite 首次初始化较慢
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
```

运行 `npm test` 时输出会按项目分组：

```text
 unit
 ✓ test/unit/task-flow.test.ts (6 tests) 3ms
 ...
 component
 ✓ test/component/task-form.test.tsx (7 tests) 675ms
 ...
 integration
 ✓ test/integration/db.test.ts (10 tests) 20ms
```

projects 带来的实际收益：

- **按层过滤**：`npx vitest run --project=unit` 只跑单元测试，改后端代码时不必等组件测试。
- **环境成本精确投放**：只有 component 项目加载 jsdom 和 setup 文件。
- **超时独立调节**：集成测试放宽 `testTimeout`，单元测试保持默认 5 秒——单测超过 5 秒本身就说明有问题，不该放宽。

**Vitest 5 的重要变化**：内联（inline）project 默认 `extends: true`，会继承根配置的 Vite 部分（plugins、alias 等）——所以 `react()` 插件和 `@` 别名只在根上写一次，三个项目都能用。在 Vitest 4 里内联项目默认不继承，老教程会让你在每个 project 里重复配 alias，v5 不需要了。注意继承时**数组类配置是追加而非覆盖**（如根和项目都配 `setupFiles`，则两个都执行）。

## 3.4 setupFiles 与 globalSetup：两种「开场准备」

这两个配置名字相似，作用域完全不同，路线图把它们列为必会概念：

|            | `setupFiles`                                                              | `globalSetup`                                      |
| ---------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| 执行时机   | 每个**测试文件**执行前（在该文件的环境里）                                | 整个 Vitest 进程启动时，执行**一次**               |
| 运行位置   | 测试 worker 内，能访问 `document`（jsdom 项目）、能调 `beforeEach` 等钩子 | 主进程，**不在**测试环境里，没有 jsdom             |
| 典型用途   | 注册 jest-dom 匹配器、RTL 自动 cleanup、mock 全局对象                     | 起 docker 容器、建共享数据库、准备一次性 fixtures  |
| 传值给测试 | 同一模块世界，直接 import                                                 | 只能通过 `provide()`/`inject()` 传**可序列化**的值 |

配套工程的 component 项目使用 setupFiles（[example/test/setup-component.ts](./example/test/setup-component.ts)）：

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
```

两件事：

1. `@testing-library/jest-dom/vitest` 把 `toBeInTheDocument()`、`toBeDisabled()`、`toHaveTextContent()` 等 DOM 断言匹配器注册到 Vitest 的 `expect` 上（第 6 章大量使用）。不开 `globals: true` 时，导入 `/vitest` 后缀的入口是官方推荐做法。
2. **`cleanup()`**：每个测试后卸载 React 树、清空 `document.body`。Testing Library 在检测到全局 `afterEach` 时会自动注册 cleanup，但那依赖 `globals: true`；我们显式导入，就不依赖这种隐式行为。不 cleanup 的后果：上一个测试渲染的 DOM 残留到下一个测试，`getByRole` 查出两个同名元素直接报错——这是第 7 章「测试隔离」的第一课。

关于 globalSetup 还有一个**实测踩坑**值得记录：我们最初想在 globalSetup 里建一个 PGlite 数据库、用 `provide("db", db)` 共享给所有集成测试，结果 Vitest 直接报：

```text
Error: Cannot provide "db" because it's not serializable.
```

`provide()` 只接受可序列化值（字符串、数字、布尔、plain object 等），数据库连接、类实例、函数都不行。所以配套工程改为**每个数据库测试文件用顶层 `await` 自建内存库**（第 9 章），文件间天然隔离。globalSetup 更适合「起一个外部服务然后把连接串 provide 给测试」这类场景。

## 3.5 globals: true 还是显式导入？

`test.globals: true` 会把 `describe`/`it`/`expect`/`vi` 注入全局，测试文件可以不写 import。本教程**不开**，理由：

- 显式导入让每个文件的依赖一目了然，TS 不需要额外的 `types` 配置就能工作；
- 全局注入与 ESM 的模块边界理念相悖，重构/迁移时容易踩「这个文件里的 `describe` 是哪来的」；
- 官方文档也说明：globals 主要服务于 Jest 迁移和第三方 matcher 兼容性场景。

代价只是每个测试文件多一行 `import { describe, expect, it, vi } from "vitest"`——值得。

## 3.6 其余值得知道的配置项

配套工程用到或后续章节会用到的：

```ts
test: {
  include: [...],           // 测试文件 glob（每个 project 里配）
  environment: "node",      // 见 3.2
  setupFiles: [...],        // 见 3.4
  testTimeout: 5_000,       // 单个测试超时（默认 5s）
  hookTimeout: 10_000,      // beforeAll 等钩子超时（默认 10s）
  coverage: { ... },        // 第 10 章
  sequence: { shuffle: true }, // 乱序执行，第 11 章（也可用 CLI --sequence.shuffle）
  clearMocks: true,         // Vitest 5 默认已是 true，见第 5 章
}
```

环境变量方面注意：Vitest 默认只自动加载 `.env` 文件中 **`VITE_` 前缀**的变量（与 Vite 约定一致）。需要加载全部变量时，官方给的方案是在配置里用 `loadEnv`：

```ts
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  test: {
    env: loadEnv(mode, process.cwd(), ""),
  },
}));
```

配套工程的测试不依赖 `.env`（PGlite 是内存库、Fastify 不监听端口），所以没有配这一项——**测试不需要环境变量文件才能跑，本身就是一种好设计**。

## 3.7 验证配置生效

三条命令确认本章成果：

```bash
npx vitest run                    # 三个项目全部执行，输出按项目分组
npx vitest run --project=unit     # 只跑 unit（毫秒级）
npx vitest run --project=component # 只跑组件测试（能看到 jsdom 环境耗时）
```

再做两个破坏性实验，确认环境隔离真实存在：

1. 在任意 unit 测试里加一行 `expect(typeof document).toBe("object")` —— 应当**失败**（node 环境没有 document）；
2. 在 component 测试里加同样一行 —— 应当通过（jsdom 提供了 document）。

## 练习

1. 给 integration 项目单独加一个 `--project=integration` 的运行脚本，并解释为什么它需要 30 秒超时而 unit 不需要。（要点：PGlite 建库 + 迁移是真实 I/O；unit 全内存。）
2. 把 component 项目的 `setupFiles` 临时注释掉再跑组件测试，记录报错信息（提示：`toBeInTheDocument is not a function`），然后恢复。这个报错在第 12 章 FAQ 里还会出现——你现在已经知道它的根因了。
3. 思考题：为什么 `resolve.alias` 必须写在 defineConfig 顶层而不是 `test` 字段里？（要点：它是 Vite 的模块解析配置，Vitest 只是复用；`test` 字段里放的是测试专属选项。）

## 本章来源

- Vitest 官方文档：[Configuring Vitest](https://vitest.dev/config/)（配置文件查找顺序与覆盖关系、`defineConfig`/`mergeConfig`、`configDefaults`）
- Vitest 官方文档：[Features](https://vitest.dev/guide/features)（environment 选项、jsdom/happy-dom 安装、`VITE_` 前缀环境变量与 `loadEnv` 方案、文件级并行与隔离）
- Vitest 官方文档：[Migrating to Vitest 5.0](https://vitest.dev/guide/migration.html)（inline projects 默认继承根配置、数组配置追加合并、`sharedViteServer`）
- `provide()` 仅支持可序列化值为配套工程实测结果（vitest 5.0.5）

下一章：[04 编写高质量测试](./04-writing-tests.md) —— AAA、断言选型、边界值与参数化测试。
