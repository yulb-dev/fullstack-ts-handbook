# 第 7 章：包 exports、ESM 与 TypeScript project references

> 本章目标：把「包如何对外暴露自己」讲清楚——`package.json` 的 `exports` 字段、ESM 与 `"type": "module"`、内部包为什么可以直接暴露 `.ts` 源码；再按需理解 TypeScript project references 何时需要、何时可省。这是「包管理」核心概念 ② 的收口。
>
> 对应核心概念：**② package scripts、包导出、ESM、tsconfig project references（按需）。**

---

## 7.1 `exports` 字段：包的「前台」

`exports` 是现代 Node（12.7+）定义「**这个包对外暴露哪些入口**」的标准字段。它取代了老的 `main`，能力更强：

```json
{
  "name": "@workboard/shared",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

含义：当别人 `import ... from "@workboard/shared"`（`.` 表示包的根入口）时，解析到 `./src/index.ts`。

### 多入口

一个包可以暴露多个子路径：

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./db": "./src/db.ts",
    "./package.json": "./package.json"
  }
}
```

于是消费者可以 `import ... from "@workboard/shared/db"`。`packages/config` 正是靠这个暴露多份 tsconfig（第 6 章）：

```json
{
  "exports": {
    "./tsconfig/base.json": "./tsconfig/base.json",
    "./tsconfig/node.json": "./tsconfig/node.json",
    "./tsconfig/react.json": "./tsconfig/react.json"
  }
}
```

所以 `apps/api` 才能写 `"extends": "@workboard/config/tsconfig/node.json"`。

### `exports` 是「白名单」，也是「封装边界」

一旦定义了 `exports`，**没在 `exports` 里列出的路径，外部就无法 import**——即使文件真实存在。比如 `@workboard/db` 内部有 `src/internal/pool.ts`，但 `exports` 只暴露 `.`，那么 `import "@workboard/db/internal/pool"` 会失败。

这是一件好事：**`exports` 定义了包的公共 API 表面**，内部实现细节被藏起来，你可以自由重构内部文件而不破坏消费者。这与第 6 章的「边界」思想一脉相承——只不过那是包与包之间的边界，这是包内部的公私边界。

---

## 7.2 条件导出：同一入口，不同环境给不同实现

`exports` 支持「条件（conditions）」，让 Node/Vite 根据环境选择不同文件：

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "default": "./dist/index.mjs"
    }
  }
}
```

- `types`：TypeScript 找类型声明时用（**必须放最前**，否则 TS 可能解析错）；
- `import`：ESM 环境（`import x from ...`）；
- `require`：CJS 环境（`require(...)`）；
- `default`：兜底。

这就是第 6 章 `server-only` 包的原理：它的 `exports` 里 `browser` 条件指向一个抛错文件，`node`/`default` 条件指向空实现。打包工具走 `browser` 条件时就炸。

条件是有**顺序**的：Node 从上往下匹配第一个成立的条件。所以 `types` 要放最前，`default` 放最后。

---

## 7.3 ESM 与 `"type": "module"`

本系列全程用 ESM（ECMAScript Modules，`import`/`export`），而非老的 CJS（`require`/`module.exports`）。

`package.json` 里 `"type": "module"` 声明：**这个包里的 `.js` 文件默认按 ESM 解析**。影响：

- `.js` → ESM；若要在此包里写 CJS，文件用 `.cjs`；
- `.mjs` → 永远 ESM（无论 type）；`.cjs` → 永远 CJS；
- 顶层可用 `await`、`import.meta` 等 ESM 特性。

### ESM 与 CJS 互操作的坑

monorepo 里最容易踩的是「ESM 包 import 了只提供 CJS 的依赖」或反之。几条经验：

1. **尽量全仓统一 ESM**（`"type": "module"`），减少混用；
2. `import` CJS 包时，命名导出可能拿不到（CJS 的 `module.exports` 被当作 default）：

   ```js
   // 某些纯 CJS 包
   import pkg from "some-cjs-lib";
   const { foo } = pkg; // 而不是 import { foo } from "some-cjs-lib"
   ```

3. ESM 里**没有** `__dirname`/`__filename`，用：

   ```js
   import { fileURLToPath } from "node:url";
   import { dirname } from "node:path";
   const __dirname = dirname(fileURLToPath(import.meta.url));
   // 或 Node 20.11+ 直接：import.meta.dirname
   ```

   第 6 章的 `check-boundaries.mjs` 用的就是 `import.meta.dirname`（Node 24 支持）。

4. `verbatimModuleSyntax: true`（base tsconfig 里开了）要求：**只用作类型的导入必须写 `import type`**。这让「前端只导入类型、不导入运行时值」在代码层面可审查——一眼能看出哪些 import 会真的产生运行时依赖。

---

## 7.4 内部包直接暴露 `.ts` 源码（本教程的选择）

注意 7.1 里 `@workboard/shared` 的 `exports` 直接指向 `./src/index.ts`——**源码 `.ts`，不是构建产物 `dist`**。这是 monorepo 内部包的常见且推荐做法，理由：

### 为什么内部包可以不预构建

- **消费者自己会处理**：`apps/web` 用 Vite（内置 esbuild/TS 转译），`apps/api` 用 `tsx`（也是 esbuild）或 `tsc`。它们都能直接吃 `.ts`；
- **TypeScript 配 `moduleResolution: "Bundler"`**：允许解析到 `.ts` 源码、允许不写 `.js` 后缀的相对导入；
- **改了立即生效**：不用「先 build 包、再让 app 看到」，符号链接 + 源码直连 = 改 `shared` 的瞬间 web/api 就用上新代码；
- **少一套构建缓存要维护**：内部包不必有 `build` 步骤，任务图更简单。

### 代价与边界

- 内部包**不能发布到 npm**（因为暴露的是 `.ts`，消费者未必有转译能力）。它们都 `private: true`，本就无需发布；
- 如果某个内部包**将来要对外发布**，就得给它加真正的 `build`（产出 `dist` + `.d.ts`），`exports` 指向 `dist`，并用条件导出（7.2）。

> **决策原则**：**只在仓库内部消费的包 → `exports` 指向 `.ts` 源码，免构建；要发布到 npm 的包 → 构建出 `dist` + 类型声明，`exports` 指向产物。** Workboard 全是内部包，所以全走前者。

`apps/api` 是个例外：它作为**可部署应用**需要一个真正的 `build`（`tsc` 产出 `dist/*.js`），因为生产环境跑的是 `node dist/server.js` 而不是 `tsx`。但 api 不被别人 import，所以它的 build 只是「为自己的部署产物服务」，不涉及对外 `exports`。

---

## 7.5 TypeScript project references（按需）

`tsconfig` 的 **project references** 让一个 TS 项目「引用」另一个已构建的项目，实现**增量编译**（只重编变化的项目）和跨项目类型检查。配置长这样：

```jsonc
// apps/web/tsconfig.json
{
  "extends": "@workboard/config/tsconfig/react.json",
  "compilerOptions": {
    "composite": true, // 被引用项目必须开
    "declaration": true,
    "declarationMap": true,
  },
  "references": [
    { "path": "../../packages/shared" },
    { "path": "../../packages/api-client" },
  ],
  "include": ["src"],
}
```

然后用 `tsc --build`（而非 `tsc --noEmit`）触发增量构建：

```bash
tsc --build apps/web
```

### 本教程**不强制**用 references，原因：

1. 我们的内部包**直接暴露 `.ts` 源码**（7.4），TypeScript 靠 `moduleResolution: Bundler` + 符号链接就能跨包解析类型，不需要 references 生成的 `.d.ts`；
2. references 要求被引用项目 `composite: true` 且产出声明文件，会增加构建复杂度和「先 build 依赖包才能 typecheck」的顺序约束；
3. Turborepo 的任务图（第 8 章）已经在**包级别**处理了「先构建依赖、再构建下游」的顺序和增量缓存——这与 references 的增量编译**功能重叠**。用 turbo 编排 `typecheck` 任务通常就够了。

### 什么时候**该**用 references

- 你的内部包**确实需要预构建成 `dist` + `.d.ts`**（比如要发布，或包很大、每次全量 typecheck 太慢）；
- 你想要 `tsc --build` 的**跨项目增量编译**，且不打算用 turbo 来做这层缓存；
- 编辑器（VS Code）在超大仓库里跨包跳转/类型检查慢，references 能改善 IDE 体验。

> **结论**：references 是「按需」工具。本教程的路线是「内部包直连源码 + Turborepo 做包级增量」，所以**不引入 references**，让心智负担最小。等你遇到上面三种情况，再回来加它——路线图把它标为「按需」正是此意。

---

## 7.6 `paths` 别名：可选的便利

有些团队喜欢用 tsconfig `paths` 做路径别名（`@shared/*` → `packages/shared/src/*`）。在 monorepo 里**通常不需要**——因为 `workspace:*` + 包名 import 已经提供了清晰的模块边界。滥用 `paths` 反而会：

- 绕过包边界（用相对/别名路径「翻墙」，第 6 章的边界检查可能扫不到）；
- 让「谁依赖谁」在 `package.json` 里不可见。

**建议**：坚持用包名 import（`@workboard/shared`），让依赖关系显式落在 `package.json` 里。`paths` 只用于单包内部的目录别名（如 `@/*` → `src/*`），不用于跨包。

---

## 7.7 常见坑

| 现象                                           | 原因                                    | 解决                                                                 |
| ---------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `ERR_PACKAGE_PATH_NOT_EXPORTED`                | import 了 `exports` 里没暴露的子路径    | 在包 `exports` 里补上该子路径                                        |
| TS 找不到内部包的类型                          | `exports` 的 `types` 条件缺失或没放最前 | 条件导出里 `types` 放第一位；或内部包直接暴露 `.ts`（7.4）           |
| `Cannot use import statement outside a module` | 包没设 `"type": "module"` 却是 ESM 语法 | 加 `"type": "module"`，或文件改 `.mjs`                               |
| ESM 里 `__dirname is not defined`              | ESM 没有这些 CJS 全局                   | 用 `import.meta.dirname` 或 `fileURLToPath(import.meta.url)`         |
| `import { foo }` 从 CJS 包拿到 undefined       | CJS 默认导出与命名导出差异              | 改 `import pkg from "..."; const { foo } = pkg`                      |
| `tsc --build` 报被引用项目未 composite         | references 指向的项目没开 `composite`   | 被引用项目 `compilerOptions.composite: true`                         |
| 改了内部包但 app 类型没更新（用了 dist）       | `exports` 指向 `dist` 却没重新 build    | 内部包改指向 `.ts` 源码；或在任务图里让 build 先于消费（第 8/11 章） |

---

## 7.8 本章验收清单

- [ ] 会用 `exports` 定义包的公共入口与多子路径，理解它是「白名单 + 封装边界」；
- [ ] 理解条件导出（`types`/`import`/`require`/`browser`/`default`）的顺序与作用，并能解释 `server-only` 的原理；
- [ ] 全仓统一 ESM（`"type": "module"`），知道 `__dirname`、CJS 互操作等常见坑；
- [ ] 能解释「内部包直接暴露 `.ts` 源码」的理由与代价，以及何时才需要产出 `dist`；
- [ ] 理解 TypeScript project references 的作用，能说出**本教程为何不引入它**、以及何时该引入；
- [ ] 不用 `paths` 做跨包别名，坚持包名 import 让依赖显式化。

---

到这里，pnpm 这一半（把仓库「组织对」）已经讲完：workspace、依赖模型、过滤器、包职责、边界、导出。下一章进入 Turborepo，把任务「跑得快、跑得准」。

上一章：[← 第 6 章：共享 config 与业务逻辑的边界](./06-shared-config-and-boundaries.md) ｜ 下一章：[第 8 章：Turborepo 入门：任务图 →](./08-turborepo-task-graph.md)
