# 第 3 章：pnpm 依赖模型 —— node_modules、workspace:\*、隔离与 catalog

> 本章目标：打开 pnpm 的「黑盒」，看懂它的 `node_modules` 到底长什么样、为什么能消灭幽灵依赖、`workspace:*` 协议如何把本地包链接起来、以及 `catalog:` 如何统一全仓版本。这一章是「有边界」目标 C 的底层原理。
>
> 对应核心概念：**① 依赖提升/隔离语义、`workspace:*`、lockfile；② 核心依赖版本锁定。**

---

## 3.1 npm 的扁平化，与它带来的幽灵依赖

要理解 pnpm 为什么这么设计，先看 npm/yarn 怎么做。

假设你的项目依赖 `express`，而 `express` 内部依赖 `body-parser`。npm 安装时会尽量把所有依赖**扁平化提升（hoist）**到项目根的 `node_modules`：

```
node_modules/
├── express/
└── body-parser/     ← express 的依赖，被提升到了顶层
```

这样 Node 的模块解析（从当前目录逐级向上找 `node_modules`）能很快找到它们。**问题在于**：`body-parser` 现在在顶层可见了，即使你的 `package.json` 里**根本没声明它**，你也能写：

```js
import bodyParser from "body-parser"; // 编译通过！但你从没声明这个依赖
```

这就是**幽灵依赖（phantom dependency）**。它的危险性：

- 哪天 `express` 升级后不再依赖 `body-parser`，或者换成别的库，顶层的 `body-parser` 消失了，你的代码**突然崩溃**；
- 你排查半天，因为你一直以为「我明明能用它」；
- 在 monorepo 里包一多，这种隐式依赖网会指数级复杂。

---

## 3.2 pnpm 的解法：内容寻址存储 + 符号链接

pnpm 用完全不同的结构。分两步理解：

### 第一步：全局内容寻址存储（store）

pnpm 在你机器上有一个全局 store（默认在 `~/.pnpm-store` 或类似位置），**所有项目、所有版本的包都只存一份**，按文件内容哈希去重。你可以查看：

```bash
pnpm store path
```

### 第二步：项目里的 `node_modules` 结构

项目的 `node_modules` 里，pnpm 建了一个 `.pnpm/` 目录，里面是**扁平化的、带版本号的真实包**（硬链接到 store），而顶层只放**你 `package.json` 里声明过的依赖**，且它们是**符号链接**指向 `.pnpm/` 里的真实位置：

```
node_modules/
├── express -> .pnpm/express@4.19.2/node_modules/express    ← 符号链接（你声明了）
└── .pnpm/
    ├── express@4.19.2/node_modules/
    │   ├── express/               ← 真实文件（硬链接到 store）
    │   └── body-parser -> ...      ← express 的依赖，只在 express 内部可见
    └── body-parser@1.20.2/node_modules/
        └── body-parser/
```

关键在于：**顶层 `node_modules` 里只有 `express`，没有 `body-parser`**。`body-parser` 只出现在 `.pnpm/express@.../node_modules/` 里，也就是**只有 express 自己能解析到它**。

所以当你写 `import bodyParser from "body-parser"` 时，Node 从你项目顶层的 `node_modules` 找不到它——**幽灵依赖被结构性地消灭了**。你能 import 的，永远只是你 `package.json` 声明过的东西。

> **一句话总结隔离语义**：**pnpm 的 `node_modules` 是「非扁平」的**——顶层只暴露你声明的直接依赖，间接依赖藏在 `.pnpm/` 的隔离目录里，各归各的所有者。这既是安全（无幽灵依赖），也是 monorepo 边界的基础。

### 验证一下

在一个装了依赖的包里：

```bash
# 顶层只有你声明的直接依赖，全是符号链接
ls -la node_modules | head

# 间接依赖在 .pnpm 里，带精确版本
ls node_modules/.pnpm | head
```

---

## 3.3 「提升」在 pnpm 里还存在吗？

存在，但被限制在一个**私有的、你无法直接 import 的**区域。pnpm 有一个 `node_modules/.pnpm/node_modules/` 目录，一些间接依赖会被「提升」到那里，目的是解决某些老包对扁平结构的假设（比如 peer dependency 解析）。但这个目录**不在你项目的正常解析路径顶层**，所以你依然无法幽灵依赖它。

如果你需要精细控制提升行为，有 `.npmrc` 选项：

```ini
# 提升所有间接依赖到 .pnpm/node_modules（默认行为的一部分）
hoist=true
# 用模式限制提升哪些包（例如只提升以 @babel/ 开头的）
hoist-pattern[]=@babel/*
# 完全关闭提升（最严格，某些老包可能因此解析失败）
hoist=false
```

**实践建议**：默认 `hoist=true` 就好，不用动。pnpm 已经保证了「你只能 import 声明过的依赖」这一核心隔离性；`hoist` 调的是间接依赖在 `.pnpm` 内部的摆放，不影响边界。真正需要严格隔离时（比如想验证包不依赖任何未声明的东西），可以临时 `hoist=false` 跑一遍测试。

---

## 3.4 workspace 协议：包之间怎么互相依赖

现在进入 monorepo 的核心：`apps/web` 想依赖 `packages/shared`，怎么写？

### 普通版本范围 vs `workspace:`

你可以在 `apps/web/package.json` 里写：

```json
{
  "dependencies": {
    "@workboard/shared": "^0.0.0"
  }
}
```

但这有歧义：pnpm 会去 registry 找 `@workboard/shared`，还是用本地的？由 `linkWorkspacePackages`（默认 `false`）控制，行为不确定。

**正确做法是用 `workspace:` 协议**：

```json
{
  "dependencies": {
    "@workboard/shared": "workspace:*"
  }
}
```

`workspace:` 协议告诉 pnpm：**这个依赖只能来自本地 workspace，绝不去 registry 找**。如果本地没有这个包，安装直接失败（而不是悄悄从 npm 拉一个同名的）。这消除了歧义。

### 三种写法

| 写法              | 含义                                       | 发布时被替换为   |
| ----------------- | ------------------------------------------ | ---------------- |
| `workspace:*`     | 链接本地包，任意版本（最常用，永远用本地） | 本地包的精确版本 |
| `workspace:^`     | 链接本地包，发布时用 `^` 范围              | `^<本地版本>`    |
| `workspace:~`     | 链接本地包，发布时用 `~` 范围              | `~<本地版本>`    |
| `workspace:1.2.3` | 要求本地包版本正好是 `1.2.3`，否则安装失败 | `1.2.3`          |

本教程内部包统一用 `workspace:*`：因为 Workboard 的这些包都 `private`（不发布），版本对齐没有意义，`*` 最简单，「永远用本地当前代码」正是我们要的。

### 链接后是什么效果

`pnpm install` 后，`apps/web/node_modules/@workboard/shared` 是一个**符号链接**，直接指向 `packages/shared/`：

```bash
ls -la apps/web/node_modules/@workboard/
# shared -> ../../../packages/shared
```

这意味着：**你改 `packages/shared/src/index.ts`，`apps/web` 立刻看到最新代码**，无需「重新发布 / 重新安装」。这就是 monorepo「一次改动全仓生效」的机制基础。

> **对比多仓**：在多仓方案里，改 `shared` 要 `npm version` → `npm publish` → 到 `web` 里 `npm update`。monorepo 里这些全消失，因为符号链接直接指向源码。

---

## 3.5 循环依赖：monorepo 的头号结构病

有了 `workspace:*`，包之间可以自由互链。但**自由带来危险**：如果 `@workboard/shared` 依赖 `@workboard/db`，而 `@workboard/db` 又依赖 `@workboard/shared`，就形成了**循环依赖（cycle）**。

后果：

- pnpm 在 install 时会给警告：`There are cyclic workspace dependencies`；
- 更严重的是**任务顺序无法确定**——build/test 谁先谁后？pnpm 和 Turborepo 都依赖「有向无环图（DAG）」来排任务顺序，有环就排不出来（pnpm 甚至可能报 `ERR_PNPM_TASK_CYCLE`）；
- ESM 里循环 import 还会导致运行时拿到 `undefined`（模块还没初始化完就被引用）。

**如何避免**（第 5、6 章会落地）：

1. **依赖只能单向流动**：`apps → packages → 更底层的 packages`，底层包绝不反向依赖上层；
2. **共享的东西往下沉**：如果 `shared` 和 `db` 都需要某个类型，把类型放进更底层的 `shared`，让 `db` 依赖 `shared`，而不是互相依赖；
3. **用工具检查**：`pnpm why` 追依赖来源；`madge`/`dpdm` 检测环；本教程第 6 章的 `check-boundaries.mjs` 也会顺带守住方向。

如果你想让 pnpm 在 install 阶段就对循环依赖「零容忍」，可以在 `pnpm-workspace.yaml` 里：

```yaml
# 检测到循环依赖时安装直接失败，而不是只警告
disallowWorkspaceCycles: true
```

---

## 3.6 `catalog:`：一处定义，全仓统一版本

现在解决 1.1 节的「场景二：版本地狱」。当多个包都用 `typescript`、`vitest`、`zod` 时，你会在每个 `package.json` 里重复写版本号；升级时要改 N 个文件，还容易漏、容易冲突。

pnpm 的 **catalog** 就是为此设计的：在 `pnpm-workspace.yaml` 里定义一次版本，各包用 `catalog:` 引用。

### 定义 catalog

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
  - "e2e"

allowBuilds:
  esbuild: true

catalog:
  typescript: 5.9.3
  vitest: 5.0.5
  zod: 4.6.7
  "@types/node": 24.19.2
```

### 在包里引用

```json
// packages/shared/package.json
{
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`catalog:` 会被展开成 `pnpm-workspace.yaml` 里定义的 `5.9.3` / `5.0.5`。好处：

- **升级只改一处**：把 catalog 里的 `typescript` 改成 `5.10`，全仓所有用 `catalog:` 的包一起升级；
- **消灭合并冲突**：升级时不用动各个 `package.json`，git 冲突面大大减小；
- **保证单例**：全仓 `typescript` 只有一个版本，不会出现「两个包用不同 tsc」。

### 命名 catalog（多版本共存）

如果确实需要多版本（例如某个包必须用旧版），可以定义**命名 catalog**：

```yaml
catalogs:
  ts5:
    typescript: 5.9.3
  ts-legacy:
    typescript: 4.9.5
```

引用时带名字：`"typescript": "catalog:ts-legacy"`。《API 合约》教程里 `packages/api-client` 单独锁 TypeScript 5.9（因为代码生成器的 peer 要求），就适合用命名 catalog 表达。

> **实践建议**：把「全仓应该只有一个版本」的东西放进 catalog——TypeScript、Vitest、Prettier、ESLint、以及像 `zod` 这种被多包共享的库。各包**独有**的依赖（比如只有 api 用的 `fastify`）不必进 catalog，直接写在 api 的 `package.json` 里更清晰。

---

## 3.7 `pnpm why` 与依赖审查

monorepo 里排查「这个依赖是哪来的、为什么装了两个版本」，用 `pnpm why`：

```bash
# 某个依赖为什么在这里？被谁依赖？
pnpm why zod
pnpm --filter @workboard/web why react

# 查全仓重复版本（版本地狱的信号）
pnpm list -r zod --depth 0
```

如果发现同一个库有多个版本，通常意味着某些包写了不同范围——把它们改成 `catalog:` 或统一范围即可收敛成单例。

---

## 3.8 常见坑

| 现象                                      | 原因                                                     | 解决                                                            |
| ----------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| 能 import 到没声明的包（在 npm 下）       | 幽灵依赖被提升到顶层                                     | 用 pnpm；它天然不允许。别迁就坏习惯去 `hoist=false` 前先补声明  |
| `workspace:` 依赖装不上 / 找不到          | 目标包名拼错，或它不在 `packages:` 匹配范围内            | 核对包 `name` 与 `pnpm-workspace.yaml` glob                     |
| `There are cyclic workspace dependencies` | 包之间形成了循环依赖                                     | 把共享物下沉到底层包；用 `disallowWorkspaceCycles: true` 强约束 |
| 改了 `packages/shared` 但 `web` 没生效    | 用了普通版本范围而非 `workspace:*`，装成了 registry 版本 | 改用 `workspace:*` 并重新 `pnpm install`                        |
| 升级一个库要改十几个 `package.json`       | 版本散落在各包                                           | 引入 `catalog:`，各包改引用 `catalog:`                          |
| 同一依赖装了多个版本                      | 各包范围不一致                                           | `pnpm list -r <dep>` 排查，统一到 catalog                       |

---

## 3.9 本章验收清单

- [ ] 能画出 pnpm `node_modules` 的结构（顶层符号链接 + `.pnpm/` 隔离目录），并解释它为什么能消灭幽灵依赖；
- [ ] 理解「隔离 vs 提升」在 pnpm 里的确切含义：顶层只暴露声明过的直接依赖；
- [ ] 会用 `workspace:*`（及 `^`/`~`）在包之间建立本地依赖，并说清发布时如何被替换、链接后为何「改了立即生效」；
- [ ] 能解释循环依赖的危害（任务无法排序、运行时 undefined），并说出至少两种避免手段；
- [ ] 会用 `catalog:` 统一全仓版本，理解它「一处定义、升级只改一行、减少冲突」的价值；
- [ ] 会用 `pnpm why` / `pnpm list -r` 审查依赖来源与重复版本。

---

下一章：[第 4 章：pnpm 过滤器与脚本编排 →](./04-filters-and-scripts.md)
