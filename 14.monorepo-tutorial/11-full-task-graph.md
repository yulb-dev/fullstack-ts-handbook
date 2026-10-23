# 第 11 章：完整任务图与 OpenAPI 生成

> 本章目标：把前面所有零散任务，组装成一张完整的 `turbo.json`——涵盖 build / typecheck / lint / test / e2e，并把 **OpenAPI 客户端生成（codegen）** 作为一等公民纳入依赖图，让「schema 变 → api-client 重新生成 → web 重新类型检查」这条链自动、有序、可缓存地发生。
>
> 对应核心概念：**⑥ OpenAPI 生成客户端任务的依赖顺序；build、typecheck、lint、test、e2e 任务图。** 对应练习：**练习 2、练习 3。**

---

## 11.1 codegen 为什么要进任务图

回顾第 5 章：`apps/api` 用 `@fastify/swagger` 从路由 schema 生成 OpenAPI 文档，`packages/api-client` 用 `openapi-typescript` 从这份文档生成前端类型。这条链是：

```
api 的 route schema  ──(api: openapi:export)──▶  packages/api-client/openapi.json
                                                        │
                                    (api-client: generate)
                                                        ▼
                                    packages/api-client/src/generated/openapi.ts
                                                        │
                                            (web import 这些类型)
                                                        ▼
                                                 apps/web 类型检查/构建
```

**如果不把它建模成任务依赖会怎样？** 你改了 api 的一个响应字段，`openapi.json` 需要重新导出、client 类型需要重新生成，然后 web 才能用新类型做检查。手动跑这三步、还要保证顺序，迟早会漏——于是「契约漂移」又回来了（这正是《API 合约》教程要解决的问题）。

**正确做法**：把 `openapi:export`（api）和 `generate`（api-client）定义成 turbo 任务，并用 `dependsOn` 声明顺序，让 turbo 保证「生成先于消费」，且整条链可缓存、可增量。

---

## 11.2 为 codegen 定义任务

先在相关包的 `package.json` 里确认脚本存在（第 5 章已给）：

```json
// apps/api/package.json
{ "scripts": { "openapi:export": "tsx src/scripts/export-openapi.ts ../../packages/api-client/openapi.json" } }

// packages/api-client/package.json
{ "scripts": { "generate": "openapi-typescript openapi.json --output src/generated/openapi.ts" } }
```

在 `turbo.json` 里为它们定义任务，关键是 `dependsOn` 与 `outputs`：

```json
{
  "tasks": {
    "openapi:export": {
      "dependsOn": ["^build"],
      "outputs": ["../packages/api-client/openapi.json"]
    },
    "generate": {
      "dependsOn": ["openapi:export"],
      "inputs": ["openapi.json"],
      "outputs": ["src/generated/**"]
    }
  }
}
```

解读：

- **`openapi:export`**（在 api 里）：需要先构建/准备好上游（`^build`），产物是写到 `packages/api-client/openapi.json`。注意这个 outputs 路径是**跨包**的——turbo 允许 outputs 用相对路径指向仓库内其它位置（谨慎使用；更常见的做法是让 export 把文件写进 api 自己的目录，再由 generate 读取，见 11.6 的替代方案）；
- **`generate`**（在 api-client 里）：`dependsOn: ["openapi:export"]`——**同包内没有 openapi:export**，那这个依赖怎么解析？

这里有个 turbo 的关键语义要讲清楚。

---

## 11.3 跨包任务依赖：`包名#任务` 语法

`dependsOn` 里不带 `^` 的任务名（如 `"openapi:export"`）默认指「**同一个包**里的这个任务」。但 `generate` 在 api-client，`openapi:export` 在 api，不是同一个包。所以要**显式指定包**：

```json
{
  "tasks": {
    "generate": {
      "dependsOn": ["@workboard/api#openapi:export"],
      "inputs": ["openapi.json"],
      "outputs": ["src/generated/**"]
    }
  }
}
```

`@workboard/api#openapi:export` 是 turbo 的**精确任务引用**语法：`包名#任务名`。它明确表达「api-client 的 generate 依赖 api 的 openapi:export 先完成」。

> 但注意：`turbo.json` 顶层的 `tasks` 是**模板**，会套到所有包上。`generate` 任务只有 api-client 有，`openapi:export` 只有 api 有，其它包没有这些脚本，turbo 会自动跳过（不报错）。为了让依赖更精确，也可以用**包级配置**（`packages/api-client/turbo.json`）覆盖，见 11.6。

---

## 11.4 完整任务图

把 codegen 和常规任务合起来，这是 Workboard 完整的 `turbo.json`：

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "globalEnv": ["NODE_ENV"],
  "globalDependencies": ["tsconfig.base.json", ".npmrc"],
  "tasks": {
    "openapi:export": {
      "dependsOn": ["^build"],
      "outputs": ["openapi.json"]
    },
    "generate": {
      "dependsOn": ["@workboard/api#openapi:export"],
      "inputs": ["openapi.json"],
      "outputs": ["src/generated/**"]
    },
    "build": {
      "dependsOn": ["^build", "^generate"],
      "inputs": ["src/**", "tsconfig*.json", "*.config.*", "package.json"],
      "outputs": ["dist/**", "build/**"],
      "env": ["$TURBO_DEFAULT$"]
    },
    "typecheck": {
      "dependsOn": ["^typecheck", "^generate"]
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "test": {
      "dependsOn": ["^build", "^generate"],
      "outputs": ["coverage/**"],
      "env": ["DATABASE_URL"]
    },
    "e2e": {
      "dependsOn": ["^build"],
      "cache": false,
      "env": ["BASE_URL", "DATABASE_URL"]
    },
    "db:migrate": {
      "cache": false
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

逐条设计说明：

| 任务             | `dependsOn`                     | 为什么                                                                       |
| ---------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| `openapi:export` | `^build`                        | 导出前要确保 api 及其上游就绪；产物是 `openapi.json`                         |
| `generate`       | `@workboard/api#openapi:export` | client 类型必须在 api 导出 openapi.json 之后生成                             |
| `build`          | `^build`, `^generate`           | 构建前，上游包要 build 完；且若上游有 generate（api-client），要先生成好类型 |
| `typecheck`      | `^typecheck`, `^generate`       | web typecheck 依赖 api-client 的类型已生成，否则引用到旧类型                 |
| `lint`           | `^lint`                         | lint 一般不需产物，顺序保守                                                  |
| `test`           | `^build`, `^generate`           | 测试需要上游构建 + 生成的类型                                                |
| `e2e`            | `^build`                        | E2E 跑在构建产物上；`cache: false`（真浏览器、真服务，不该缓存）             |
| `db:migrate`     | —                               | `cache: false`（第 9 章：迁移绝不缓存）                                      |
| `dev`            | —                               | `persistent` + `cache: false`                                                |

**关键洞察**：`build`、`typecheck`、`test` 都加了 `^generate`。因为 `web` 消费 `api-client` 生成的类型——如果 api-client 的 `generate` 没先跑，web 拿到的就是过期（甚至不存在）的生成类型。**`^generate` 保证了「生成先于消费」这条链在整张图里成立。**

---

## 11.5 验证 codegen 链（练习 3）

路线图练习 3：「将 OpenAPI client 生成加入依赖图，验证 schema 变化后 client 与 web 会重新检查。」

### 步骤 1：建立基线

```bash
turbo run generate build typecheck
# 第一次全部 miss，按顺序执行：api#openapi:export → api-client#generate → web#build/typecheck
turbo run generate build typecheck
# 第二次全部 hit
```

### 步骤 2：改 api 的路由 schema

在 `apps/api` 里给某个响应加一个字段（例如给 Task 响应加 `archivedAt`），改动 route schema。

### 步骤 3：重跑，观察连锁反应

```bash
turbo run generate build typecheck
```

**期望观察到**（这就是练习 3 要验证的）：

1. `@workboard/api#openapi:export` → **miss**（api 源码变了），重新导出 `openapi.json`；
2. `@workboard/api-client#generate` → **miss**（它的 input `openapi.json` 变了），重新生成类型；
3. `@workboard/web#typecheck` → **miss**（上游 api-client 的产物变了），用新类型重新检查；
4. 如果新字段导致 web 里某处类型不匹配 → **typecheck 直接失败**，契约漂移在**编译期**被抓到；
5. 与这条链无关的包（如 db，如果它不依赖 api-client）→ 仍 **hit**。

**结论**：schema 一变，`api-client` 自动重新生成、`web` 自动重新检查，全程无需手动跑三步、无需记顺序。这就是「把 codegen 纳入任务图」的价值——**契约漂移从「线上事故」降级为「CI 红灯」**。

### 用 `--graph` 确认顺序

```bash
turbo run generate build --graph
```

确认图里 `api#openapi:export → api-client#generate → web#build` 的边存在。

---

## 11.6 用包级 turbo.json 精确表达（进阶）

顶层 `tasks` 是模板，套到所有包。但 `openapi:export` 只有 api 有、`generate` 只有 api-client 有，跨包依赖 `@workboard/api#openapi:export` 写在顶层模板里语义不够干净。更精确的做法是用**包级配置**：

`packages/api-client/turbo.json`（只影响 api-client，`extends` 根配置）：

```json
{
  "extends": ["//"],
  "tasks": {
    "generate": {
      "dependsOn": ["@workboard/api#openapi:export"],
      "inputs": ["openapi.json"],
      "outputs": ["src/generated/**"]
    }
  }
}
```

`"extends": ["//"]` 表示继承仓库根的 `turbo.json`。这样 `generate` 的特殊依赖只定义在拥有它的包里，顶层模板保持通用。

### 关于跨包 outputs 的替代方案

11.2 里 `openapi:export` 的产物写到了另一个包目录（`../packages/api-client/openapi.json`），跨包 outputs 有时会让缓存行为不好推理。一个更清晰的替代：**让 export 写进 api 自己的目录，generate 从那里读**：

```json
// apps/api: openapi:export 写到 apps/api/openapi.json（自己包内）
{
  "tasks": {
    "openapi:export": { "dependsOn": ["^build"], "outputs": ["openapi.json"] }
  }
}

// api-client 的 generate 通过 dependsOn 拿到 api 的产物后再读
// （或用一个脚本把 api 的 openapi.json 复制/软链过来）
```

具体用哪种取决于你的目录习惯。**原则**：让每个任务的 `outputs` 尽量落在**自己包内**，跨包的数据流动通过 `dependsOn` + 明确的产物路径表达，这样缓存的「谁产出、谁消费」最清晰。

---

## 11.7 练习 2（收尾）：完整的 lint/typecheck/test/build

练习 2 要求「配置 turbo 任务 lint/typecheck/test/build，声明正确的 dependsOn 与 outputs」。到本章你已完成：

1. ✅ `build`：`dependsOn: ["^build", "^generate"]`，`outputs: ["dist/**"]`，`inputs` 收窄到源码与配置；
2. ✅ `typecheck`：`dependsOn: ["^typecheck", "^generate"]`（无产物，但缓存成功状态与日志）；
3. ✅ `lint`：`dependsOn: ["^lint"]`；
4. ✅ `test`：`dependsOn: ["^build", "^generate"]`，`outputs: ["coverage/**"]`。

验证「正确性」的方法就是练习 4 的实验：改一个包，观察只有受影响的链失效。特别地：

```bash
# 改 apps/web 的一个组件
turbo run build test
# 期望：web#build、web#test miss；shared/api-client/db/api 的相关任务 hit

# 改 packages/shared
turbo run build test
# 期望：shared 及所有下游 miss（连锁），验证 ^ 依赖生效
```

---

## 11.8 e2e 任务的位置

`e2e/` 是独立的 workspace 包（第 2 章 `packages:` 里有 `e2e`），跑 Playwright。它的任务：

```json
{
  "tasks": {
    "e2e": {
      "dependsOn": ["^build"],
      "cache": false,
      "env": ["BASE_URL", "DATABASE_URL"]
    }
  }
}
```

- `^build`：E2E 要跑在 web/api 的构建产物上（或至少依赖它们就绪）；
- `cache: false`：E2E 启真浏览器、连真数据库，结果不该缓存（每次都要真跑）；
- 需要 `BASE_URL`、`DATABASE_URL` 等 env → 显式声明。

> E2E 的深入（Playwright 配置、trace、认证状态）属于路线图阶段 13，本教程只负责把它在任务图里的**位置和依赖**摆对。

---

## 11.9 常见坑

| 现象                                 | 原因                                       | 解决                                                      |
| ------------------------------------ | ------------------------------------------ | --------------------------------------------------------- |
| 改了 schema，web 没重新检查          | `typecheck`/`build` 没加 `^generate`       | 给消费生成类型的任务加 `^generate` 依赖                   |
| `generate` 报找不到 `openapi:export` | 跨包依赖没用 `包名#任务` 语法              | 写 `@workboard/api#openapi:export`，而非 `openapi:export` |
| codegen 每次都被跳过，类型是旧的     | `generate` 的 `inputs` 没含 `openapi.json` | `inputs: ["openapi.json"]`，或依赖 export 的产物          |
| 跨包 outputs 缓存行为诡异            | export 写到了别的包目录                    | 让产物落在自己包内，跨包流动靠 `dependsOn`（11.6）        |
| e2e 命中缓存没真跑                   | 忘了 `cache: false`                        | E2E/迁移/部署一律 `cache: false`                          |
| 顶层模板套到没有该脚本的包上报错     | 包缺同名脚本                               | turbo 默认跳过无脚本的包；确认脚本名拼写一致              |

---

## 11.10 本章验收清单

- [ ] 能画出 codegen 链：api schema → openapi:export → generate → web 消费；
- [ ] 会用 `包名#任务名` 语法表达跨包任务依赖（`@workboard/api#openapi:export`）；
- [ ] 完整 `turbo.json` 覆盖 build/typecheck/lint/test/e2e/codegen/db:migrate/dev，每个 `dependsOn`、`outputs`、`cache` 都有明确理由；
- [ ] 理解为什么消费生成类型的任务要加 `^generate`；
- [ ] **完成练习 3**：改 api schema 后，观察到 openapi:export → generate → web typecheck 连锁 miss，且无关包仍 hit；
- [ ] **完成练习 2**：lint/typecheck/test/build 配置正确，并用缓存命中/失效验证其依赖声明；
- [ ] 知道 e2e/迁移/部署为何 `cache: false`；了解包级 `turbo.json`（`extends: ["//"]`）用于精确表达。

---

上一章：[← 第 10 章：环境变量建模](./10-env-vars.md) ｜ 下一章：[第 12 章：CI、远程缓存与综合验收 →](./12-ci-remote-cache-capstone.md)
