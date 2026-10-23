# 第 6 章：共享 config 与业务逻辑的边界

> 本章目标：分清两种「共享」——`packages/config`（共享**工具链配置**）与 `packages/shared`（共享**业务逻辑/类型**）；用 `server-only` 标记 + tsconfig `lib` + 边界检查脚本三重手段，**强制**「服务端专属代码（数据库、密钥）绝不进前端」。这是「有边界」目标 C 的核心落地。
>
> 对应核心概念：**⑤ 共享 config 与共享业务逻辑的区别；不要将仅在服务器使用的数据库/密钥代码导入前端。**

---

## 6.1 两种「共享」，本质不同

monorepo 里「抽一个共享包」有两种截然不同的动机，混为一谈是边界失控的开端：

|                    | `packages/config`（共享配置）           | `packages/shared`（共享业务逻辑） |
| ------------------ | --------------------------------------- | --------------------------------- |
| 装的是什么         | tsconfig、eslint、prettier、vitest 配置 | 业务类型、常量、纯函数、校验规则  |
| 有运行时代码吗     | **没有**（纯配置数据）                  | **有**（会被打进 bundle）         |
| 谁能用             | 所有包（作为 devDependency）            | 前后端都能用，但**必须同构**      |
| 出现在 bundle 里吗 | 不会                                    | 会（所以绝不能含服务端专属逻辑）  |
| 依赖方向           | 横切，谁都可依赖它                      | DAG 最底层，不依赖任何业务包      |

**关键区别**：`config` 是「**开发期**的东西」，帮各包用统一的规则做类型检查/lint/格式化，运行时根本不存在；`shared` 是「**运行期**的东西」，会被 `import` 进真实代码、打进产物。

搞混的后果：有人把「服务端才能用的数据库工具函数」放进 `shared`（因为它「被多方共享」），结果前端 import `shared` 时把 `pg`、数据库连接串一起打进了浏览器 bundle。所以我们要给「共享业务逻辑」立规矩。

---

## 6.2 `packages/config`：共享工具链配置

### tsconfig 分层

在 `packages/config/tsconfig/` 放三份基础配置：

`packages/config/tsconfig/base.json`（所有包共用的严格基线）：

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "noEmit": true
  }
}
```

`packages/config/tsconfig/node.json`（服务端包：有 Node 类型，**没有 DOM**）：

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": ["node"]
  }
}
```

`packages/config/tsconfig/react.json`（前端包：有 DOM，没有 Node 全局）：

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": []
  }
}
```

各包 `extends` 对应的配置：

```json
// apps/api/tsconfig.json —— 服务端
{
  "extends": "@workboard/config/tsconfig/node.json",
  "include": ["src"]
}
```

```json
// apps/web/tsconfig.json —— 前端
{
  "extends": "@workboard/config/tsconfig/react.json",
  "include": ["src"]
}
```

> **这就是第一道边界**：`apps/web` 用 `react.json`，`types: []` 且 `lib` 里**没有 `node`**。所以前端代码里写 `process.env.DATABASE_URL`、`require("fs")`、`Buffer` 会**直接类型报错**。服务端专属的运行时全局，在前端包里根本不存在于类型系统。

### eslint / prettier 配置

`packages/config/eslint/index.js`（导出一个共享的 flat config 片段）：

```js
// 极简示例：真实项目可叠加 typescript-eslint、react 等
export const sharedRules = {
  rules: {
    "no-console": "warn",
  },
};
```

`packages/config/prettier/index.js`：

```js
export default {
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  printWidth: 100,
};
```

各包 `eslint.config.js` / `.prettierrc` 引用它们，实现「全仓一套规则」。

---

## 6.3 `packages/shared`：同构业务逻辑的红线

`shared` 会被前后端同时 import，因此必须遵守**同构（isomorphic）红线**：

✅ **可以放**：

- 纯 TypeScript 类型 / interface / 联合类型；
- 常量（如 `TASK_STATUSES`）、枚举映射；
- 纯函数（日期格式化、状态机迁移、校验规则）——**不碰任何 I/O、不碰 Node/DOM API**；
- 与运行环境无关的 Zod schema（前后端都能用来做各自的校验）。

❌ **绝不能放**：

- 任何 `import` 了 `pg`、`fs`、`node:*`、`drizzle-orm` 的代码；
- 读取 `process.env` 里服务端密钥的逻辑；
- 数据库查询、文件读写、网络监听；
- 任何「只在服务端成立」的东西。

**为什么这条线这么重要**？因为 `shared` 会被打进浏览器 bundle。一旦它含服务端代码，构建工具会尝试把 `pg`、密钥一起打包，轻则 bundle 暴涨/构建失败，重则**把 secret 泄露到前端产物**。

`packages/shared/src/index.ts` 的正确样子：

```ts
// 纯类型 + 纯常量 + 纯函数，零 I/O、零环境依赖
export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return false;
  if (from === "done") return false; // done 是终态
  return true;
}
```

---

## 6.4 服务端专属包：用 `server-only` 上锁

`packages/db` 是 server-only。光靠「大家自觉不 import」不够，我们用工具让它**一旦被前端 import 就构建失败**。

npm 上有个官方小包 `server-only`，它的机制很巧妙：它导出的浏览器版本（`browser` 条件）会**主动抛错**。在服务端包入口第一行 import 它：

```bash
pnpm --filter @workboard/db add server-only
```

```ts
// packages/db/src/index.ts 第一行
import "server-only"; // 若被浏览器环境打包，这行会导致构建失败/运行报错

import { drizzle } from "drizzle-orm/node-postgres";
// …数据库连接与查询
export const db = drizzle(/* … */);
```

原理：`server-only` 包的 `exports` 里，`browser` 条件指向一个「抛错模块」。Vite/webpack 打前端 bundle 时会走 `browser` 条件，于是**构建期就报错**，而不是等到线上泄露。

> 对应有个 `client-only` 包做反向的事（只允许在浏览器用）。`server-only` 是「防止服务端代码进前端」的标准做法，比口头约定可靠得多。

---

## 6.5 第三重防线：依赖边界检查脚本

`server-only` 挡住「运行时/构建时」，但挡不住「代码审查阶段就想发现」。而且它只在真的被打包时触发。我们再加一个**静态检查脚本**，让 `pnpm boundaries:check` 在 CI 里就能拦下越界 import——即使那行代码还没被真正打包。

创建 `scripts/check-boundaries.mjs`：

```js
/**
 * 依赖边界检查：apps/web（前端）不得引用服务端专属包。
 * 规则：
 *   1. web/package.json 不允许声明 @workboard/db、@workboard/api 等服务端依赖；
 *   2. web/src 源码不允许 import 服务端专属包，也不允许用相对路径「翻墙」进 apps/api 或 packages/db。
 * 先写「应该失败」的用例验证它真的会失败，再放心用它守 CI。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const webDir = resolve(root, "apps/web");

// 前端禁止依赖的「服务端专属」包
const SERVER_ONLY_PACKAGES = ["@workboard/db", "@workboard/api"];
// 这些目录属于服务端，前端不得用相对路径翻墙进入
const SERVER_DIRS = [resolve(root, "apps/api"), resolve(root, "packages/db")];

const problems = [];

// 规则 1：package.json 不得声明服务端依赖
const pkg = JSON.parse(readFileSync(join(webDir, "package.json"), "utf8"));
for (const field of ["dependencies", "devDependencies"]) {
  for (const dep of Object.keys(pkg[field] ?? {})) {
    if (
      SERVER_ONLY_PACKAGES.some((p) => dep === p || dep.startsWith(`${p}/`))
    ) {
      problems.push(
        `apps/web/package.json 的 ${field} 声明了服务端依赖：${dep}`,
      );
    }
  }
}

// 规则 2：源码不得 import 服务端包 / 相对路径翻墙
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|jsx|mts)$/.test(name)) yield full;
  }
}

const IMPORT_RE =
  /(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

const srcDir = join(webDir, "src");
if (statSync(srcDir, { throwIfNoEntry: false })?.isDirectory()) {
  for (const file of walk(srcDir)) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      const forbiddenPackage = SERVER_ONLY_PACKAGES.some(
        (p) => spec === p || spec.startsWith(`${p}/`),
      );
      const escapesIntoServer =
        spec.startsWith(".") &&
        SERVER_DIRS.some((d) => resolve(dirname(file), spec).startsWith(d));
      if (forbiddenPackage || escapesIntoServer) {
        problems.push(`${relative(root, file)} 引用了服务端代码：${spec}`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  console.error(
    "\napps/web 只能依赖 @workboard/api-client（生成的契约）与 @workboard/shared（同构逻辑）。",
  );
  process.exit(1);
}
console.log("✓ 依赖边界检查通过：apps/web 没有引用服务端专属代码");
```

把它接进根 `package.json`（第 2 章已预留）：

```json
{
  "scripts": {
    "boundaries:check": "node scripts/check-boundaries.mjs"
  }
}
```

### 验证它真的有效（先写失败用例）

```bash
# 1. 造一个越界文件
echo 'import { db } from "@workboard/db";' > apps/web/src/_probe.ts
pnpm boundaries:check
# ✗ apps/web/src/_probe.ts 引用了服务端代码：@workboard/db
# （退出码 1，CI 会红）

# 2. 清掉，恢复绿
rm apps/web/src/_probe.ts
pnpm boundaries:check
# ✓ 依赖边界检查通过：apps/web 没有引用服务端专属代码
```

> **写检查脚本的铁律**：**先构造一个「应该失败」的输入，确认它真的失败**，再构造「应该通过」的输入。否则你可能写出一个永远绿灯、其实什么都没检查的假守卫。这和写测试先写红灯用例是同一个道理。

在大项目里，你也可以用 ESLint 的 `no-restricted-imports`、`eslint-plugin-boundaries` 或 dependency-cruiser 表达同样规则。工具不重要，**重要的是这条规则被自动执行，并在 CI 里失败**。

---

## 6.6 三重防线小结

| 防线                          | 触发时机       | 挡住什么                                       |
| ----------------------------- | -------------- | ---------------------------------------------- |
| tsconfig `lib`/`types`（6.2） | 类型检查时     | 前端用到 `process`/`fs`/Node 全局 → 类型报错   |
| `server-only`（6.4）          | 前端构建打包时 | 前端 import 了服务端包 → 构建失败              |
| `check-boundaries.mjs`（6.5） | 随时 / CI      | package.json 声明或源码 import 越界 → 退出码 1 |

三者层层递进：类型系统最先提示，构建期强制拦截，CI 静态审查兜底。**边界不是靠自觉，是靠工具让越界变得不可能或立刻失败。**

---

## 6.7 常见坑

| 现象                                   | 原因                               | 解决                                                         |
| -------------------------------------- | ---------------------------------- | ------------------------------------------------------------ |
| 前端 bundle 里混进了 `pg`/数据库代码   | 把服务端逻辑放进了 `shared`        | `shared` 只放同构代码；服务端逻辑放 `db`，并加 `server-only` |
| 前端能读 `process.env.DATABASE_URL`    | web 的 tsconfig `types` 含 `node`  | web 用 `react.json`，`types: []`、`lib` 不含 node            |
| 边界脚本永远绿灯                       | 没用「应该失败」的用例验证过它     | 先造越界文件确认脚本会退出码 1，再删掉                       |
| `server-only` 没拦住                   | 入口忘了 `import "server-only"`    | 在服务端包 `index.ts` **第一行** import                      |
| config 包被打进了 bundle               | 把 config 放进了 `dependencies`    | config 只作 `devDependencies`，且只导出配置                  |
| 用 `startsWith("@workboard/api")` 误伤 | `@workboard/api-client` 也以它开头 | 判断用「等于 或 以 `包名/` 开头」，如脚本所示                |

---

## 6.8 本章验收清单

- [ ] 能说清 `packages/config`（工具链配置、无运行时）与 `packages/shared`（同构业务逻辑、会进 bundle）的本质区别；
- [ ] `packages/config` 提供 base/node/react 三份 tsconfig，前端包用 `react.json`（`types: []`、无 node lib）；
- [ ] `packages/shared` 只含纯类型/常量/纯函数，零 I/O、零环境依赖；
- [ ] 服务端专属包 `db` 入口 `import "server-only"`，前端构建时会失败；
- [ ] 写好 `scripts/check-boundaries.mjs`，用「应该失败」的用例验证过它能退出码 1；
- [ ] `pnpm boundaries:check` 在正常情况下通过，越界时失败，并已接入根脚本（为 CI 做准备）。

---

上一章：[← 第 5 章：搭建 Workboard 骨架](./05-repo-skeleton.md) ｜ 下一章：[第 7 章：包 exports、ESM 与 project references →](./07-exports-esm-references.md)
