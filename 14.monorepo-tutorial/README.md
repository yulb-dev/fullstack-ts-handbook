# pnpm + Turborepo Monorepo：从 0 到 1 把全栈应用组织成可复现、可缓存的仓库

你已经能写 React 前端、写 Fastify 后端、用 Drizzle 操作数据库、用 OpenAPI 把前后端「钉」在同一份契约上。但当你把这些东西放进真实的团队协作里，新的麻烦冒出来了：

- 前端和后端在**两个仓库**里，改一个接口要开两个 PR、来回对齐版本号，合并顺序稍错就线上崩；
- 每个子项目**各自 `npm install`**，同一个 `zod` 装了五个版本，磁盘占满、CI 每次都从零下载；
- 前端同学图省事 `import { db } from "../../api/src/db"`，把服务端代码（和数据库密钥）打进了浏览器 bundle，**直到线上泄露才发现**；
- 明明只改了一个包的一行注释，CI 却把**整个仓库重新构建 + 重新测试**，跑二十分钟；
- 新人 clone 下来，README 写着「先进 a 目录装依赖，再进 b 目录装，再进 c……」，一步没对上就跑不起来；
- 两个包互相 import，构建顺序怎么都不对，报**循环依赖**。

这些问题有一个共同的根源：**代码的物理组织方式，跟不上它逻辑上的依赖关系**。

这份教程带你从零把一个全栈应用 **Workboard**（多租户任务协作系统，也是本系列毕业项目的骨架）组织成一个 **pnpm workspace + Turborepo** 的 monorepo，让仓库做到三件事：

```
可复现  →  新 clone 后一条命令安装、启动、测试，不依赖任何人的本机环境
可缓存  →  只重建「真正受影响的包」，改一行不必全量重跑
有边界  →  前端拿不到服务端代码，包与包之间没有循环依赖，且被自动检查守住
```

---

## 学完之后你将能够

1. 用 **pnpm workspace** 把多个应用与共享包组织进单一仓库：`pnpm-workspace.yaml`、`workspace:*` 协议、单一 lockfile、严格 `node_modules`；
2. 说清 pnpm 的**依赖提升与隔离语义**：为什么它消灭了「幽灵依赖」，`catalog:` 如何统一全仓版本；
3. 用 **pnpm 过滤器**（`--filter`、`-r`、`...`、`[since]`）精确地「只装/只跑某个包及其相关包」，区分单包开发与全仓构建；
4. 用 **Turborepo** 定义**任务图**：`turbo.json` 的 `tasks`、`dependsOn`（含 `^` 拓扑依赖）、`outputs`、并发执行；
5. 理解并操控 **Turborepo 缓存**：hash 的输入是什么（文件、依赖输出、环境变量、配置、lockfile），如何声明 `inputs`/`outputs`，如何**故意制造命中与失效**来验证；
6. 正确做**环境变量建模**：`env` / `globalEnv` / `passThroughEnv`、strict 模式、framework inference、`.env` 文件如何进入缓存 key，以及为什么绝不能把 secret 混进缓存；
7. 设计完整的 **build / typecheck / lint / test / e2e** 任务图，并把 **OpenAPI 客户端生成**任务放进依赖链（schema 变 → client 重新生成 → web 重新类型检查）；
8. 分清 **CI 缓存**（如 GitHub Actions `cache`）与 **Turborepo 缓存**（含远程缓存）的职责边界，并让 CI 用 `--filter=[origin/main]` 只跑受影响的包；
9. 用 `packages/config`（共享工具链配置）与 `packages/shared`（共享业务逻辑）的**区别**，加上边界检查脚本，**强制**「服务端专属代码不进前端」。

---

## 版本说明（2026 年 10 月核对）

本教程所有命令与配置都在配套结构上验证过。为与《API 合约与端到端数据流整合》一致，锁定如下版本；你跟随教程时请以自己安装到的最新稳定版为准，并注意 Turborepo 2.x 与 pnpm 10+ 的语法与旧教程的差异。

| 组件        | 版本   | 说明                                                                             |
| ----------- | ------ | -------------------------------------------------------------------------------- |
| Node.js     | 24     | 运行时，建议用 `corepack` 管理包管理器                                           |
| pnpm        | 12     | workspace 包管理；默认不运行依赖的安装脚本，需 `allowBuilds` 显式放行            |
| Turborepo   | 2.x    | 任务编排与缓存；配置文件 `turbo.json` 用 `tasks` 键（v1 的 `pipeline` 已废弃）   |
| TypeScript  | 5.9    | 类型检查；内部包 `exports` 直接指向 `.ts` 源码，配合 `moduleResolution: Bundler` |
| Vite        | 8      | `apps/web` 构建与开发服务器                                                      |
| Vitest      | 5      | 各包单元/集成测试                                                                |
| Fastify     | 5      | `apps/api` 服务端框架（用到的部分会解释，深入见对应教程）                        |
| Drizzle ORM | 1.0-rc | `packages/db` 数据访问（同上）                                                   |

> **两个容易踩的版本坑**
>
> 1. **Turborepo 2.x 的 `turbo.json` 用 `tasks` 键**。网上大量教程（含很多博客与旧 README）仍是 1.x 的 `pipeline` 键，直接抄会被忽略或报错。
> 2. **pnpm 10+ 默认不执行依赖的安装脚本**（`postinstall` 等，属供应链安全措施）。esbuild、better-sqlite3 这类需要构建的依赖会触发 `ERR_PNPM_IGNORED_BUILDS`，要用 `pnpm approve-builds` 或在 `pnpm-workspace.yaml` 写 `allowBuilds` 放行。第 2 章详解。

---

## 适合谁

- 会 React + TypeScript，写过后端接口（本系列 Fastify / Drizzle / API 契约教程的读者最佳）；
- 用过 npm 或 yarn，但对 pnpm 的 workspace、`node_modules` 结构、lockfile 语义一知半解；
- 听说过 monorepo / Turborepo，但没从零搭过，或搭了却说不清「缓存为什么命中/失效」。

如果你只写过前端单项目，也没关系：本教程从「为什么需要 monorepo」讲起，每个配置都解释**它解决什么问题**、**不这么做会怎样**。

---

## 贯穿项目：Workboard

Workboard 是一个多租户任务协作系统，也是本系列毕业项目的骨架。我们不会在这份教程里把业务功能写全（那是其它阶段的事），而是聚焦**如何把它组织成一个健康的 monorepo**。最终结构对齐路线图推荐的目标：

```
workboard/
├── apps/
│   ├── web/                  # React + Vite 单页应用（只依赖 api-client / shared / ui）
│   └── api/                  # Fastify API（依赖 db / shared，产出 OpenAPI）
├── packages/
│   ├── db/                   # Drizzle schema / queries / migrations 的所有者（server-only）
│   ├── api-client/           # 由 OpenAPI 生成的客户端类型与请求封装（前后端唯一连接点）
│   ├── shared/               # 同构（isomorphic）的纯类型与工具，前后端都能安全 import
│   └── config/               # 共享 tsconfig / eslint / prettier 配置（只是配置，不是业务）
├── e2e/                      # Playwright 端到端场景（依赖 build 产物）
├── scripts/
│   └── check-boundaries.mjs  # 依赖边界检查：前端不得引用服务端专属包
├── turbo.json                # Turborepo 任务图与缓存配置
├── pnpm-workspace.yaml       # workspace 成员、catalog、allowBuilds
├── package.json              # 根：编排脚本 + turbo 依赖，不放业务依赖
└── pnpm-lock.yaml            # 单一 lockfile（全仓依赖的唯一真相）
```

依赖方向是**单向无环**的（第 5 章会画出来并强制检查）：

```
apps/web ─┬─> packages/api-client ──> packages/shared
          ├─> packages/shared
apps/api ─┬─> packages/db ──────────> packages/shared
          ├─> packages/api-client
          └─> packages/shared
所有包 ───> packages/config（仅配置）
```

---

## 章节目录

| 章节     | 标题                                                                    | 你将掌握                                                                       | 对应核心概念    |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------- |
| 第 1 章  | [为什么需要 Monorepo](./01-why-monorepo.md)                             | 多仓 vs 单仓的取舍、幽灵依赖、pnpm 与 Turborepo 的分工                         | 总目标          |
| 第 2 章  | [准备工具与第一个 workspace](./02-first-workspace.md)                   | corepack、`pnpm-workspace.yaml`、根 `package.json`、lockfile、`allowBuilds`    | ① · 练习 1      |
| 第 3 章  | [pnpm 依赖模型](./03-pnpm-dependency-model.md)                          | store + symlink、严格 `node_modules`、`workspace:*`、隔离/提升、`catalog:`     | ① ②             |
| 第 4 章  | [pnpm 过滤器与脚本编排](./04-filters-and-scripts.md)                    | `--filter`、`-r`、`...`、`[since]`、并发、单包开发 vs 全仓                     | ① ⑧ · 练习 1    |
| 第 5 章  | [搭建 Workboard 骨架](./05-repo-skeleton.md)                            | apps/packages 职责、依赖方向、避免循环依赖、`private`/`type`                   | ④ · 练习 1      |
| 第 6 章  | [共享 config 与业务逻辑的边界](./06-shared-config-and-boundaries.md)    | `packages/config` vs `packages/shared`、server-only、边界检查脚本              | ⑤               |
| 第 7 章  | [包 exports、ESM 与 project references](./07-exports-esm-references.md) | `exports` 条件导出、ESM、内部包直连 `.ts`、tsconfig references（按需）         | ②               |
| 第 8 章  | [Turborepo 入门：任务图](./08-turborepo-task-graph.md)                  | `turbo.json`、`tasks`、`dependsOn`（`^` 拓扑）、并发、`persistent`、`--filter` | ③               |
| 第 9 章  | [Turborepo 缓存](./09-turborepo-caching.md)                             | `.turbo/cache`、hash 输入、`inputs`/`outputs`、`cache:false`、命中/失效实验    | ③ · 练习 4      |
| 第 10 章 | [环境变量建模](./10-env-vars.md)                                        | `env`/`globalEnv`/`passThroughEnv`、strict 模式、`.env` 入 hash、secret 红线   | ③ · 练习 4      |
| 第 11 章 | [完整任务图与 OpenAPI 生成](./11-full-task-graph.md)                    | build/typecheck/lint/test/e2e 依赖图、codegen 任务顺序、schema 变的连锁重建    | ⑥ · 练习 2、3   |
| 第 12 章 | [CI、远程缓存与综合验收](./12-ci-remote-cache-capstone.md)              | GitHub Actions + turbo、affected 过滤、CI 缓存 vs Turbo 缓存、逐项验收         | ⑦ ⑧ · 练习 2、4 |

## 学习路线建议

```
第 1 章（建立心智模型）★ 先想清楚 monorepo 到底解决什么
   └─> 第 2 章（第一个 workspace）
         └─> 第 3 章（pnpm 依赖模型）★ 隔离/提升是理解一切的基础
               └─> 第 4 章（过滤器与脚本）
                     └─> 第 5 章（搭骨架）★ 练习 1：拆分 web/api
                           └─> 第 6 章（边界）
                                 └─> 第 7 章（exports / ESM / references）
                                       └─> 第 8 章（Turborepo 任务图）★ 从这里进入编排
                                             └─> 第 9 章（缓存）★ 练习 4：命中/失效
                                                   └─> 第 10 章（环境变量）
                                                         └─> 第 11 章（完整任务图）★ 练习 2、3
                                                               └─> 第 12 章（CI 与综合验收）
```

- 每章都有**可运行的命令与配置**、**常见坑表格**和**本章验收清单**；
- 前 7 章是 pnpm（把仓库「组织对」），第 8 章起是 Turborepo（把任务「跑得快、跑得准」）；
- 第 3、6、9、11 章是「可复现 + 有边界 + 可缓存」的核心，值得反复读。

---

## 逐项验收清单（总表）

学完每章回来打勾。第 12 章会给出每一项对应的**证据**（文件、命令或可观察现象）。以下条目直接对应路线图阶段 14 的核心概念清单。

### ① pnpm workspace

- [ ] 理解 `pnpm-workspace.yaml` 的作用，能用 `packages:` 声明成员；
- [ ] 会用 `workspace:*`（及 `^`/`~`）在包之间建立本地依赖，并说清发布时如何被替换；
- [ ] 理解单一 `pnpm-lock.yaml` 是「全仓依赖的唯一真相」，且必须提交；
- [ ] 会用 `--filter` / `-r` 精确选择包，理解「提升 vs 隔离」语义。

### ② Node / package 管理

- [ ] 每个包有清晰的 `scripts`；根目录只做编排，不放业务依赖；
- [ ] 锁定核心依赖版本（写死或用 `catalog:`），并提交 lockfile；
- [ ] 会写包 `exports`，理解 ESM（`"type": "module"`）；
- [ ] 知道 tsconfig project references 何时需要、何时可省（内部包直连源码）。

### ③ Turborepo

- [ ] 理解 task graph 与 `dependsOn`（`^` 拓扑依赖、同包依赖、`$TURBO_DEFAULT$`）；
- [ ] 会声明 `outputs`，理解缓存命中的前提与 `inputs`；
- [ ] 会做环境变量建模（`env`/`globalEnv`/`passThroughEnv`、strict 模式）；
- [ ] 理解任务边界与远程缓存的用途。

### ④ 包职责与依赖方向

- [ ] apps 只放应用；packages 只放清晰可复用的模块；
- [ ] 依赖方向单向、**无循环依赖**，并有工具/检查佐证。

### ⑤ 共享 config vs 共享业务逻辑

- [ ] 能区分 `packages/config`（工具链配置）与 `packages/shared`（业务/类型）；
- [ ] 不把仅服务器使用的数据库/密钥代码导入前端，且这条规则被自动执行。

### ⑥ 任务图与 codegen 顺序

- [ ] OpenAPI 客户端生成任务在依赖图中位置正确；
- [ ] build / typecheck / lint / test / e2e 的依赖关系声明正确。

### ⑦ CI 缓存 vs Turbo 缓存

- [ ] 能说清两者缓存的东西不同、命中前提不同；
- [ ] 理解缓存命中必须以「依赖、输入文件、相关环境变量」为前提，不能靠缓存保正确性。

### ⑧ workspace filters 的两种用法

- [ ] 单包开发时只跑该包及其依赖；
- [ ] 全仓构建/CI 时用 affected 过滤只跑受影响的包。

### 必须完成的动手练习

- [ ] 练习 1：把 web/api 拆成 workspace 包，统一 pnpm lockfile 与脚本（第 2、4、5 章）；
- [ ] 练习 2：配置 turbo 任务 lint/typecheck/test/build，声明正确的 `dependsOn` 与 `outputs`（第 8、9、11 章）；
- [ ] 练习 3：把 OpenAPI client 生成加入依赖图，验证 schema 变化后 client 与 web 会重新检查（第 11 章）；
- [ ] 练习 4：人为改动某个 package，观察缓存命中/失效，解释输入文件与环境变量的影响（第 9、10 章）。

### 通过标准

- [ ] 新 clone 后用固定命令安装、启动、测试，无需手工在多个目录装依赖；
- [ ] 单包修改不必无条件重建全仓；但受影响的依赖包会被正确重新构建；
- [ ] 没有跨越 server/client 的危险依赖，也没有循环依赖。

---

## 如何使用配套结构

本教程的每一章都给出**完整、可直接落地的文件内容**，你按章节顺序创建即可。全部搭好后的常用命令：

```bash
# 在仓库根目录
corepack enable                 # 启用与 packageManager 字段匹配的 pnpm
pnpm install                    # 一次装齐全仓依赖（单一 lockfile）

pnpm dev                        # turbo 并行拉起 web + api（persistent 任务）
pnpm build                      # turbo 按任务图构建全部包
pnpm typecheck                  # turbo 全仓类型检查
pnpm test                       # turbo 全仓测试
pnpm boundaries:check           # 依赖边界检查（前端不得引用服务端包）

# 单包开发：只跑 web 及其依赖
pnpm --filter @workboard/web... dev
turbo run build --filter=@workboard/web

# 缓存实验（练习 4）
turbo run build --filter=@workboard/api --dry=json   # 只看 hash 输入，不执行
turbo run build                                       # 第二次应大量 FULL TURBO / cache hit
```

---

## 与本系列其他教程的关系

- **《API 合约与端到端数据流整合》（阶段 11）** 已经搭了一个三包的 pnpm workspace，本教程把「monorepo 工程化」这件事讲透：为什么这么拆、缓存怎么算、边界怎么强制、CI 怎么只跑受影响的包。两教程的 `packages/api-client`（OpenAPI 生成）思路一致，第 11 章会把 codegen 正式纳入任务图。
- **毕业项目 Workboard（第六部分）** 直接用本教程产出的仓库骨架作为起点，后续往里填业务、测试、Docker（阶段 15）与 CI/CD（阶段 16）。
- **阶段 15（Docker）** 会用到本章提到的 `turbo prune`，把单个 app 连同它依赖的包裁出来构建镜像；本教程第 12 章会预告。

---

## 官方资源

- pnpm Workspaces：<https://pnpm.io/workspaces>
- pnpm Catalogs：<https://pnpm.io/catalogs>
- pnpm Filtering：<https://pnpm.io/filtering>
- pnpm `approve-builds`：<https://pnpm.io/cli/approve-builds>
- Turborepo 文档首页：<https://turborepo.dev/docs>
- Turborepo `turbo.json` 配置参考：<https://turborepo.dev/docs/reference/configuration>
- Turborepo 缓存：<https://turborepo.dev/docs/core-concepts/caching>
- Turborepo 环境变量：<https://turborepo.dev/docs/core-concepts/env-vars>
- Turborepo 远程缓存：<https://turborepo.dev/docs/core-concepts/remote-caching>
- Turborepo `prune`：<https://turborepo.dev/docs/reference/prune>
