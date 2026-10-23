# 第 2 章：准备工具与第一个 workspace

> 本章目标：装好 Node 与 pnpm，从零创建一个 pnpm workspace，理解根 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml` 三者的职责，并跑通第一次 `pnpm install`。完成本章，你就有了一个「空但正确」的 monorepo 地基。
>
> 对应核心概念：**① pnpm workspace 基础。** 对应练习：**练习 1（起步）。**

---

## 2.1 准备 Node 与 pnpm

### 用 corepack 管理包管理器（强烈推荐）

不要全局 `npm i -g pnpm` 装一个「你机器上碰巧的版本」。monorepo 的第一原则是**可复现**，包管理器本身也要锁版本。Node 自带 **corepack**，它能读取 `package.json` 里的 `packageManager` 字段，自动使用指定版本的 pnpm：

```bash
node -v          # 期望 v24.x
corepack enable  # 启用 corepack（可能需要 sudo，取决于 Node 安装方式）
```

启用后，当你在一个声明了 `"packageManager": "pnpm@12.11.2"` 的仓库里运行 `pnpm`，corepack 会自动下载并使用**这个精确版本**——团队里每个人、每台 CI runner 用的都是同一个 pnpm。这就消灭了「我 pnpm 9 你 pnpm 12」导致 lockfile 反复变动的问题。

> **为什么不用 `npm i -g pnpm`？** 全局安装是「机器级」的，无法保证和别人一致；corepack 是「仓库级」的，版本跟着仓库走。这正是「可复现」目标 A 的第一块砖。

### 验证

```bash
mkdir workboard && cd workboard
pnpm -v   # corepack 会提示是否下载；确认后输出版本号
```

---

## 2.2 根 `package.json`：只做编排，不放业务依赖

在 `workboard/` 根目录创建 `package.json`：

```json
{
  "name": "workboard",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.11.2",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "boundaries:check": "node scripts/check-boundaries.mjs"
  },
  "devDependencies": {
    "turbo": "2.5.4"
  }
}
```

逐字段解释——每个字段都对应一个明确意图：

| 字段                         | 作用                                                                                 | 不这么做的后果                                       |
| ---------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `"private": true`            | **根包永远不该被发布到 npm**。这个标记防止你手滑 `npm publish` 把整个仓库发出去      | 可能误发布内部代码                                   |
| `"type": "module"`           | 整个仓库默认用 ESM（`import`/`export`），与本系列其它教程一致                        | CJS/ESM 混用会带来一堆 `.mjs`/`.cjs` 后缀烦恼        |
| `"packageManager"`           | **corepack 据此锁定 pnpm 版本**，全团队 + CI 统一                                    | 每人 pnpm 版本不同，lockfile 反复冲突                |
| `"engines"`                  | 声明 Node 版本下限，pnpm 会在不符时警告（配合 `.npmrc` 可强制）                      | 有人用老 Node，语法/行为不一致                       |
| `scripts` 里全是 `turbo …`   | 根脚本是**编排入口**：`pnpm build` 实际委托给 turbo 按任务图跑各包的 build           | 手写 `cd apps/web && …` 无法并行、无缓存、无依赖顺序 |
| `devDependencies` 只有 turbo | 根只放**跨包的工具**（turbo、prettier、typescript 有时也放这），**不放任何业务依赖** | 业务依赖放根会破坏包边界、污染提升                   |

> **关键原则**：**根 `package.json` 是「调度台」，不是「储物间」。** 业务依赖（react、fastify、zod……）应该装在**用到它们的那个包**里，而不是根。这样每个包的依赖是显式的、自包含的——这也是 Turborepo 能精确计算缓存 hash 的前提（第 9 章）。

此刻 `turbo` 还没装、`scripts/` 还不存在，先不管，后面章节会补。

---

## 2.3 `pnpm-workspace.yaml`：声明有哪些包

这是 pnpm workspace 的**唯一必需文件**——只要仓库根有它，pnpm 就把这里当作一个 workspace。创建 `pnpm-workspace.yaml`：

```yaml
# 哪些目录下的 package.json 会被当作 workspace 成员
packages:
  - "apps/*"
  - "packages/*"
  - "e2e"

# pnpm 10+ 默认不运行依赖的安装脚本（供应链安全措施）。
# 需要构建的依赖必须显式放行，否则 install 会报 ERR_PNPM_IGNORED_BUILDS。
allowBuilds:
  esbuild: true
```

三块内容：

### `packages:` —— 成员匹配

`apps/*` 表示「`apps/` 下每个直接子目录（各含一个 `package.json`）都是一个包」。所以 `apps/web`、`apps/api` 会被识别；`packages/db`、`packages/shared`、`packages/api-client`、`packages/config` 同理。`e2e` 是单个目录（不是 `e2e/*`），直接作为一个包。

> `*` 只匹配一层，不跨目录层级；`**` 才跨层级。一般用 `apps/*`、`packages/*` 就够了，不要写 `**` 把 `node_modules` 里的东西也匹配进来。

### `allowBuilds:` —— 放行安装脚本（pnpm 10+ 的坑）

pnpm 从 10 起，出于供应链安全，**默认不执行依赖包的 `preinstall`/`install`/`postinstall` 脚本**。很多包（`esbuild`、`better-sqlite3`、`@swc/core` 等）依赖 `postinstall` 下载或编译原生二进制。不放行时，`pnpm install` 会报：

```
 ERR_PNPM_IGNORED_BUILDS  Ignored build scripts: esbuild.
```

两种放行方式：

```bash
# 方式 A：交互式选择，pnpm 会把结果写进 pnpm-workspace.yaml 的 allowBuilds
pnpm approve-builds

# 方式 B：像上面那样直接在 pnpm-workspace.yaml 写好
```

> **为什么这是好事？** 安装脚本能在你机器上执行任意代码，是供应链攻击的常见入口。默认关闭 + 显式放行 = 你能看见「哪些依赖需要跑脚本」，而不是盲目信任。这是 pnpm 帮你守住的一条安全边界。

### （进阶）`catalog:` —— 全仓统一版本

第 3 章会详细讲，这里先埋个伏笔。你可以在同一个文件里定义「版本目录」，各包用 `catalog:` 引用，实现「一处定义、全仓统一」：

```yaml
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
```

---

## 2.4 `.npmrc`：可选但推荐的行为约束

在根目录创建 `.npmrc`，把几条「让可复现更硬」的规则固化下来：

```ini
# engines 字段不符时直接报错，而不是只警告（配合根 package.json 的 engines）
engine-strict=true

# 保存依赖时默认写精确版本（不带 ^），教程与生产都更可预测。
# 团队项目可按需改成 true 用 ^，但务必提交 lockfile。
save-prefix=""
```

> `.npmrc` 是「仓库级」的 pnpm/npm 配置，和 `packageManager` 一样，目的是让**行为跟着仓库走**，而不是跟着每个人的全局配置走。

---

## 2.5 `.gitignore`：什么该提交、什么不该

```gitignore
# 依赖与构建产物
node_modules/
dist/
build/
.next/
coverage/

# Turborepo 本地缓存与产物（第 8、9 章）
.turbo/

# 环境变量：真实 secret 绝不入库，只提交 .env.example
.env
.env.local
.env.*.local

# 编辑器/系统
.DS_Store
*.log
.idea/
.vscode/
```

**必须提交**的三样东西（可复现的核心）：

1. `pnpm-lock.yaml` —— 全仓依赖的唯一真相，**必须提交**（下一节详解）；
2. `pnpm-workspace.yaml`、根 `package.json`、各包 `package.json` —— 结构定义；
3. `.env.example` —— 环境变量**模板**（只写键名和占位，不写真实值）。

**绝不提交**：`node_modules/`、`.turbo/`、真实 `.env`、构建产物 `dist/`。

---

## 2.6 `pnpm-lock.yaml`：全仓唯一的账本

运行第一次安装（此时还没有任何成员包，但 workspace 已成立）：

```bash
pnpm install
```

你会看到根目录生成了 `pnpm-lock.yaml`。理解它的三个要点：

### 1. 一个 workspace 只有一个 lockfile

由 `sharedWorkspaceLockfile`（默认 `true`）控制：**整个 workspace 共享根目录的单一 `pnpm-lock.yaml`**，而不是每个包各自一个。好处：

- 每个依赖在全仓是**单例**（同一版本只解析一次）；
- monorepo 安装更快；
- code review 时依赖变更集中在一个文件里，一眼看全。

### 2. lockfile 锁定的是「解析结果」，不只是「版本范围」

`package.json` 写 `zod@^4.6.0`（一个范围），lockfile 记录的是**这次实际解析到的精确版本 + 完整性哈希 + 依赖树**。所以即使范围允许 `4.7`，只要 lockfile 没变，谁装都是 `4.6.x`。这就是「可复现」的技术底座。

### 3. `--frozen-lockfile`：CI 的护栏

本地开发时，改了 `package.json` 再 `pnpm install` 会更新 lockfile。但在 CI 里，我们要的是「**按 lockfile 装，一个字都不许改**」：

```bash
pnpm install --frozen-lockfile
```

如果 `package.json` 和 lockfile 对不上（有人改了依赖却忘了提交更新的 lockfile），这条命令会**直接失败**，而不是偷偷重新解析。CI 默认就该用它（pnpm 在检测到 CI 环境时会自动开启 frozen）。第 12 章会把它写进 GitHub Actions。

> **黄金法则**：**`package.json` 和 `pnpm-lock.yaml` 要么一起改、要么都不改，且都要提交。** 「改了依赖忘了提交 lockfile」是 monorepo 里最常见的可复现性破坏源。

---

## 2.7 创建第一个成员包，验证 workspace 成立

现在 workspace 还是空的。创建一个最小的成员包来验证结构（正式的 web/api 在第 5 章搭）：

```bash
mkdir -p packages/shared/src
```

`packages/shared/package.json`：

```json
{
  "name": "@workboard/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`packages/shared/src/index.ts`：

```ts
// 同构（前后端都能安全 import）的纯类型与工具，第 6 章展开
export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
```

再创建一个 `packages/shared/tsconfig.json`（第 7 章会讲透，这里先用起来）：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

现在重新安装，让 pnpm 把新成员纳入 workspace：

```bash
pnpm install
```

验证 workspace 认出了这个包：

```bash
pnpm list -r --depth -1
# 输出应包含：
# @workboard/shared 0.0.0 packages/shared
```

`-r` 是 `--recursive`（对所有 workspace 包执行），`--depth -1` 表示只列包本身、不展开依赖。能看到 `@workboard/shared` 就说明 workspace 成员识别成功。

---

## 2.8 练习 1（起步）：把两个已有项目变成 workspace

路线图练习 1 是「把 web/api 拆成 workspace 包，统一 pnpm lockfile 与脚本」。本章先完成**起步**动作，第 4、5 章会把它做完：

1. 如果你手头已有一个前端项目和一个后端项目（各自是独立的 `package.json`），把它们分别移动到 `apps/web/` 和 `apps/api/`；
2. 删除它们各自的 `node_modules/`、`package-lock.json`/`yarn.lock`（monorepo 只保留根的一个 `pnpm-lock.yaml`）；
3. 确认 `pnpm-workspace.yaml` 的 `packages:` 覆盖了 `apps/*`；
4. 在根目录运行 `pnpm install`——现在**一条命令**就装齐了所有包，不再需要「进 a 目录装、进 b 目录装」；
5. 用 `pnpm list -r --depth -1` 确认所有成员都被识别。

> 完成这一步，你就已经解决了 1.1 节的「场景三：本地环境不可复现」——新人只需在根目录 `pnpm install` 一次。

---

## 2.9 常见坑

| 现象                                   | 原因                                        | 解决                                                                 |
| -------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| `ERR_PNPM_IGNORED_BUILDS`              | pnpm 10+ 默认不跑依赖安装脚本               | `pnpm approve-builds` 或在 `pnpm-workspace.yaml` 写 `allowBuilds`    |
| `pnpm list -r` 看不到新建的包          | 目录没被 `packages:` glob 匹配到            | 检查 `pnpm-workspace.yaml` 的路径；确认包目录里有 `package.json`     |
| 每个人 lockfile 都在变、频繁冲突       | 没锁 `packageManager`，各自 pnpm 版本不同   | 根 `package.json` 写 `packageManager` + `corepack enable`            |
| CI 装了和本地不一样的依赖版本          | CI 没用 frozen lockfile，或 lockfile 没提交 | CI 用 `pnpm install --frozen-lockfile`；把 `pnpm-lock.yaml` 提交入库 |
| `engine-strict` 报错说 Node 版本不符   | 你的 Node 低于 `engines` 声明               | 升级 Node（用 `nvm`/`fnm`/`volta`），或临时调低 engines              |
| 在根 `pnpm add react` 后前端反而找不到 | 业务依赖被装到了根，而包内没声明            | 用 `pnpm --filter @workboard/web add react` 装到具体的包（第 4 章）  |

---

## 2.10 本章验收清单

- [ ] 用 `corepack enable` + 根 `packageManager` 字段锁定了 pnpm 版本；
- [ ] 创建了 `pnpm-workspace.yaml`，能用 `packages:` 声明成员，理解 `allowBuilds` 为何存在；
- [ ] 理解根 `package.json` 只放编排脚本与跨包工具，**不放业务依赖**；
- [ ] 知道 `pnpm-lock.yaml` 必须提交，且 CI 用 `--frozen-lockfile`；
- [ ] 创建了第一个成员包并 `pnpm install` 成功，`pnpm list -r --depth -1` 能看到它；
- [ ] 完成练习 1 起步：把已有 web/api 移入 `apps/*`，用一条 `pnpm install` 装齐。

---

上一章：[← 第 1 章：为什么需要 Monorepo](./01-why-monorepo.md) ｜ 下一章：[第 3 章：pnpm 依赖模型 →](./03-pnpm-dependency-model.md)
