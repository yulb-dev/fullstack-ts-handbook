# 第 12 章：CI、远程缓存与综合验收

> 本章目标：把整套 monorepo 接进 CI——用 GitHub Actions 跑 turbo，用 affected 过滤只跑受影响的包，配好缓存；讲清 **CI 缓存**（Actions `cache`）与 **Turborepo 缓存**（本地/远程）缓存的东西不同、命中前提不同；最后用一次综合演练 + 逐项验收，对照路线图阶段 14 的每一条通过标准给出证据。
>
> 对应核心概念：**⑦ CI 缓存与 Turborepo 缓存的区别；⑧ workspace filters 在 CI 中的用法。** 对应练习：**练习 2、4（在 CI 中复现）。**

---

## 12.1 CI 要达成的目标

回顾目标 A（可复现）：CI 是「可复现」最严格的检验场——**一台全新的、没有任何本机缓存的 runner**，能否只靠仓库内容 + lockfile 把整个应用装起来、构建、测试？

CI 的三个任务：

1. **质量门禁**：lint、typecheck、test、build 全绿才允许合并；
2. **可复现**：用 `--frozen-lockfile` 装依赖，锁定 Node/pnpm 版本；
3. **高效**：用缓存 + affected 过滤，避免每次 PR 都全量重跑。

---

## 12.2 两种缓存，别搞混

这是路线图明确要求的辨析点（核心概念 ⑦）。CI 里其实有**两层缓存**，它们缓存的东西、命中前提完全不同：

|          | **CI 缓存**（如 GitHub Actions `actions/cache`）   | **Turborepo 缓存**（本地 `.turbo/cache` / 远程）                   |
| -------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| 缓存什么 | 依赖（pnpm store）、有时是 `.turbo/cache` 目录本身 | **任务的产物与日志**（build 输出、测试结果）                       |
| 命中前提 | 你定义的 key（通常基于 lockfile 哈希）             | 任务 hash：inputs 文件 + 上游产物 + env + 配置 + lockfile + 工具链 |
| 粒度     | 粗（整个依赖目录 / 整个 turbo 缓存目录）           | 细（单个 `包#任务`）                                               |
| 谁管理   | CI 平台                                            | Turborepo                                                          |
| 主要收益 | 少下载依赖、少重装                                 | 少重复执行 build/test                                              |
| 失效风险 | key 设计不当 → 用了过期依赖                        | env/inputs 建模不当 → 用了错误产物                                 |

### 它们如何协作

- **CI 缓存**加速「装依赖」这一步（把 pnpm store 缓存下来，下次不用重新下载）；
- **Turborepo 缓存**加速「跑任务」这一步（把 build/test 产物缓存下来，下次命中直接恢复）。

在 CI 里让两者协作有两种方式：

**方式 A：用 Actions cache 缓存 pnpm store + `.turbo/cache`**

把 turbo 的本地缓存目录也纳入 CI 缓存，这样跨 PR 也能命中 turbo 缓存（在没有远程缓存时）：

```yaml
- name: Cache pnpm store & turbo
  uses: actions/cache@v4
  with:
    path: |
      ~/.pnpm-store
      .turbo/cache
    key: ${{ runner.os }}-monorepo-${{ hashFiles('pnpm-lock.yaml') }}-${{ hashFiles('**/turbo.json') }}
    restore-keys: |
      ${{ runner.os }}-monorepo-${{ hashFiles('pnpm-lock.yaml') }}-
      ${{ runner.os }}-monorepo-
```

**方式 B：用 Turborepo 远程缓存**（更专业，见 12.5）

turbo 自己把缓存存到远程服务器，CI 只需登录，不必手动 cache `.turbo`。

> **关键区别记忆**：**CI 缓存是「按你给的 key 存取一坨文件」，Turborepo 缓存是「按任务 hash 存取单次任务产物」。** 前者粗、后者细；前者靠 lockfile key，后者靠 inputs+env+依赖。用 CI 缓存 `.turbo` 只是「在没有远程缓存时，让 turbo 缓存能跨 CI run 复用」的折中手段。

---

## 12.3 缓存命中必须以正确性为前提

路线图原话：「**缓存命中必须以依赖、输入文件和相关环境为前提**」，且「**用 cache 加速但不依赖缓存保障正确性**」。展开：

1. **命中前提必须完整**：turbo 缓存命中，当且仅当「inputs 文件 + 上游产物 + 声明的 env + lockfile + 配置」都没变。任何影响产物的东西都必须进 hash（第 9、10 章）。**漏声明 env → 错误命中 → 用错产物**，这是最危险的 bug；
2. **缓存是加速器，不是护栏**：不能因为「缓存命中了」就认为代码是对的。正确性由测试保证。缓存只保证「相同输入不重算」；
3. **CI 缓存 key 要绑定 lockfile**：依赖变了 key 就得变，否则会用旧依赖。上面 `hashFiles('pnpm-lock.yaml')` 正是此意；
4. **绝不把 secret 放进任何缓存**（第 10 章红线 3）：CI 缓存可能被不同分支、甚至 fork PR 的工作流读取。

---

## 12.4 GitHub Actions workflow（完整示例）

`.github/workflows/ci.yml`：

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

# 同一分支的旧 run 在新 push 时取消，省资源
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

# 最小权限（对应阶段 16 的安全要求，这里先养成习惯）
permissions:
  contents: read

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # affected 过滤需要完整历史来算 merge base

      # 用 corepack 按 package.json 的 packageManager 锁定 pnpm
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: corepack enable

      # CI 缓存：pnpm store（+ 可选 .turbo/cache，见 12.2 方式 A）
      - name: Get pnpm store dir
        id: pnpm-cache
        run: echo "dir=$(pnpm store path)" >> "$GITHUB_OUTPUT"
      - uses: actions/cache@v4
        with:
          path: ${{ steps.pnpm-cache.outputs.dir }}
          key: ${{ runner.os }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}
          restore-keys: ${{ runner.os }}-pnpm-

      # frozen lockfile：package.json 与 lockfile 不一致就直接失败
      - name: Install
        run: pnpm install --frozen-lockfile

      # 边界检查：前端不得引用服务端代码（第 6 章）
      - name: Boundaries
        run: pnpm boundaries:check

      # 只跑受这个 PR 影响的包（affected）
      - name: Typecheck / Lint / Test / Build
        run: |
          turbo run typecheck lint test build \
            --filter='...[origin/${{ github.base_ref || github.ref_name }}]'
```

设计要点：

- **`fetch-depth: 0`**：`...[origin/main]` 需要完整 git 历史才能算 merge base（第 4 章），浅克隆会失效；
- **`corepack enable`**：不写死 pnpm 版本，让 `packageManager` 字段说话——全团队 + CI 统一（第 2 章）；
- **`--frozen-lockfile`**：可复现的护栏（第 2、9 章）；
- **`pnpm boundaries:check`**：把第 6 章的边界规则放进 CI，越界即红；
- **`--filter='...[origin/base]'`**：只跑受影响的包。PR 的目标分支是 `github.base_ref`，push 到 main 时用 `github.ref_name`。

> **turbo 也内置了 affected**：`turbo run build --affected` 会自动对比 base 分支只跑受影响的包，等价于手写 filter，更简洁。二选一即可。

---

## 12.5 Turborepo 远程缓存（进阶，可后置）

本地缓存只在单机；CI 缓存 `.turbo` 目录是折中。**远程缓存**让缓存在「团队所有成员 + 所有 CI runner」之间共享：你同事昨天 build 过的任务，你今天直接命中。

两种选择：

1. **Vercel Remote Cache**：免费额度足够个人/小团队，`turbo login` 后自动启用；
2. **自托管**：社区有 `turbo-remote-cache` 等实现，指向自己的存储。

启用后，CI 里通过环境变量提供凭据：

```yaml
- name: Build with remote cache
  run: turbo run build test
  env:
    TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
    TURBO_TEAM: ${{ secrets.TURBO_TEAM }}
```

**远程缓存的安全边界**（务必牢记）：

- 远程缓存里存的是**任务产物**。如果产物里内联了 secret（第 10 章红线），secret 就被上传了；
- 所以远程缓存**只对可信团队开放**，且**前端产物里绝不能有 secret**；
- fork PR 的不可信代码**不应**能写入/读取你的远程缓存（对应阶段 16 的 fork 边界）。

> **建议**：教程阶段用本地缓存 + CI 缓存 `.turbo` 即可，跑通全流程；等团队规模上来、CI 时间成为瓶颈，再引入远程缓存。路线图也只要求你「理解远程缓存的用途和边界」，不强制启用。

---

## 12.6 预告阶段 15：`turbo prune` 与 Docker

阶段 15（Docker）会用到 turbo 的一个利器 `turbo prune`：它把「某个 app 及其依赖的所有包」裁剪成一个最小的、可独立构建的子仓库，专门用于 Docker 镜像构建：

```bash
turbo prune @workboard/api --docker
# 生成 out/ 目录：只含 api 及其依赖包的源码 + 精简 lockfile
```

这样 Docker 镜像里不会塞进整个 monorepo，只装 api 真正需要的东西，镜像更小、构建缓存层更合理。**本教程不展开**（属阶段 15），但你现在搭的任务图和包结构，正是 `turbo prune` 能工作的前提——**依赖关系清晰、无环、包边界明确**，prune 才能准确裁出子图。

---

## 12.7 综合演练：从零验证整个仓库

现在做一次完整的「毕业演练」，把三个目标一次性验证。**建议在一个全新的目录里模拟「新人 clone」**：

### 演练脚本

```bash
# 0. 模拟全新环境：换个目录重新 clone（或删掉 node_modules/.turbo 重来）
rm -rf node_modules .turbo apps/*/node_modules packages/*/node_modules
git status   # 确认 lockfile、turbo.json、各 package.json 都已提交

# === 目标 A：可复现 ===
corepack enable
pnpm install --frozen-lockfile        # 一条命令装齐全仓，无人工分目录安装
pnpm boundaries:check                 # ✓ 边界通过
pnpm build                            # 全仓构建成功
pnpm test                             # 全仓测试通过

# === 目标 B：可缓存 / 增量 ===
pnpm build                            # 第二次：Full TURBO，Cached 全部命中
echo "// leaf" >> apps/web/src/App.tsx
turbo run build                       # 只有 web 及其相关链 miss，其余 hit
git checkout apps/web/src/App.tsx
echo "// base" >> packages/shared/src/index.ts
turbo run build                       # shared 及所有下游连锁 miss，验证 ^ 依赖
git checkout packages/shared/src/index.ts

# === 目标 C：有边界 ===
echo 'import { db } from "@workboard/db";' > apps/web/src/_probe.ts
pnpm boundaries:check                 # ✗ 退出码 1，CI 会红
rm apps/web/src/_probe.ts
pnpm boundaries:check                 # ✓ 恢复绿
turbo run build --graph               # 确认依赖图无环、codegen 顺序正确
```

如果每一步都符合注释里的期望，你就达成了阶段 14 的全部通过标准。

---

## 12.8 逐项验收：对照路线图给出证据

下面把路线图阶段 14 的**每一条**核心概念、动手练习、通过标准，映射到本教程的证据（文件/命令/现象）。逐条打勾。

### 核心概念清单

| 核心概念                                                                       | 证据（章节 / 文件 / 命令）                                                                                                           | ✓   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | --- |
| pnpm-workspace.yaml、`workspace:*`、lockfile、过滤器、提升/隔离                | 第 2 章 `pnpm-workspace.yaml`；第 3 章 `workspace:*` + node_modules 结构；第 4 章 `--filter`；第 2 章 lockfile + `--frozen-lockfile` | ☐   |
| package scripts、版本锁定、包导出、ESM、tsconfig references（按需）            | 第 2/4 章同名脚本；第 3 章 `catalog:`；第 7 章 `exports`+ESM+references「按需」决策                                                  | ☐   |
| Turborepo：task graph、dependsOn、outputs、cache、env 建模、任务边界、远程缓存 | 第 8 章任务图+dependsOn；第 9 章 outputs+cache；第 10 章 env；第 8 章任务边界；第 12 章远程缓存                                      | ☐   |
| 每个 package 职责；apps/packages 划分；避免循环依赖                            | 第 5 章职责表+依赖方向图+madge `--circular`+`disallowWorkspaceCycles`                                                                | ☐   |
| 共享 config 与共享业务逻辑的区别；server/client 危险依赖                       | 第 6 章 config vs shared 表 + `server-only` + tsconfig lib + 边界脚本                                                                | ☐   |
| OpenAPI 生成任务的依赖顺序；build/typecheck/lint/test/e2e 图                   | 第 11 章完整 turbo.json + `^generate` + 练习 3 连锁验证                                                                              | ☐   |
| CI 缓存与 Turbo 缓存的区别；命中以依赖/输入/env 为前提                         | 第 12 章对比表 + `hashFiles(lockfile)` + 12.3 正确性前提                                                                             | ☐   |
| workspace filters 在单包开发与全仓构建中的用法                                 | 第 4 章 4.9 单包 vs 全仓；第 12 章 `--filter='...[origin/base]'` / `--affected`                                                      | ☐   |

### 动手练习

| 练习                                                                 | 证据                                                   | ✓   |
| -------------------------------------------------------------------- | ------------------------------------------------------ | --- |
| 练习 1：web/api 拆成 workspace 包，统一 lockfile 与脚本              | 第 2 章 2.8 起步 + 第 4 章 4.10 收尾 + 第 5 章完整骨架 | ☐   |
| 练习 2：turbo 配 lint/typecheck/test/build，正确 dependsOn/outputs   | 第 8 章 8.9 起步 + 第 11 章 11.4 完整 + 11.7 验证      | ☐   |
| 练习 3：OpenAPI client 生成入图，验证 schema 变后 client 与 web 重检 | 第 11 章 11.5 步骤 1~3 连锁 miss 观察                  | ☐   |
| 练习 4：人为改动包，观察缓存命中/失效，解释 inputs 与 env            | 第 9 章实验 0~6 + 第 10 章实验 A/B/C                   | ☐   |

### 通过标准

| 通过标准                                            | 证据                                                           | ✓   |
| --------------------------------------------------- | -------------------------------------------------------------- | --- |
| 新 clone 后固定命令安装/启动/测试，无需多目录手工装 | 12.7 演练「目标 A」：`pnpm install --frozen-lockfile` 一条装齐 | ☐   |
| 单包修改不必无条件重建全仓，但受影响依赖正确重建    | 12.7「目标 B」+ 练习 4：改叶子只失效自己、改 shared 连锁失效   | ☐   |
| 没有跨越 server/client 的危险依赖，也没有循环依赖   | 12.7「目标 C」：`boundaries:check` 拦越界；madge/pnpm 证明无环 | ☐   |

---

## 12.9 常见坑（CI 层面）

| 现象                                 | 原因                                    | 解决                                                       |
| ------------------------------------ | --------------------------------------- | ---------------------------------------------------------- |
| affected 过滤选不中任何包            | 浅克隆没有 merge base                   | `fetch-depth: 0`                                           |
| CI 每次 lockfile 都变                | 没锁 pnpm 版本 / 没用 frozen            | `corepack enable` + `--frozen-lockfile`                    |
| CI 缓存命中了却用了旧依赖            | cache key 没绑定 lockfile               | key 里加 `hashFiles('pnpm-lock.yaml')`                     |
| turbo 缓存跨 PR 不命中（无远程缓存） | `.turbo/cache` 没被 CI 缓存             | 用 12.2 方式 A 缓存 `.turbo/cache`，或上远程缓存           |
| 边界检查在 CI 没跑                   | 忘了把 `boundaries:check` 写进 workflow | 作为独立 step，且在 build 之前                             |
| fork PR 污染了远程缓存               | 对不可信代码开放了写权限                | fork PR 不提供 `TURBO_TOKEN`；部署与 PR 权限分离（阶段16） |
| 迁移在 CI 被缓存跳过                 | `db:migrate` 没关缓存                   | `cache: false`（第 9、11 章）                              |

---

## 12.10 本章（及全教程）验收清单

- [ ] 能清楚区分 **CI 缓存** 与 **Turborepo 缓存**：缓存内容、命中前提、粒度、收益各是什么；
- [ ] 理解「缓存命中必须以依赖/输入/env 为前提」，且「缓存不保正确性，测试才保」；
- [ ] 写出一个 GitHub Actions workflow：corepack 锁 pnpm、`--frozen-lockfile`、边界检查、affected 过滤；
- [ ] 理解远程缓存的收益与安全边界（secret 不入产物、fork 不可信）；
- [ ] 完成 12.7 综合演练，三个目标全部按预期验证；
- [ ] **对照 12.8 逐条打勾**，为核心概念、动手练习、通过标准各自提供了可验证证据；
- [ ] 知道 `turbo prune` 是通往阶段 15（Docker）的桥梁。

---

## 结语：你已经拥有的能力

走完这 12 章，你不再只是「会用 monorepo」，而是能对它做出**可验证的工程判断**：

- 你能从零把一个全栈应用组织成 **pnpm workspace**，让任何人一条命令装齐、跑起来（**可复现**）；
- 你能用 **Turborepo** 建模任务图与缓存，让「改一行不必全量重跑，但受影响的绝不会被漏掉」（**可缓存**）；
- 你能用 tsconfig、`server-only`、边界脚本三重防线，让前端**拿不到**服务端代码、包之间**没有**循环依赖（**有边界**）；
- 你还能说清 CI 缓存与 turbo 缓存的分工，守住 secret 不入缓存的红线。

这正是路线图阶段 14 的目标：**把 web、api、共享 schema/类型与测试组织到可复现、可缓存的仓库结构中**。接下来，阶段 15 会用 `turbo prune` 把它装进 Docker，阶段 16 会用 GitHub Actions 把它变成自动化门禁——而它们都站在你这份仓库骨架之上。

---

上一章：[← 第 11 章：完整任务图与 OpenAPI 生成](./11-full-task-graph.md) ｜ 返回：[教程目录 README](./README.md)
