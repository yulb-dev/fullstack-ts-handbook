# 第 5 章：搭建 Workboard 骨架 —— apps 与 packages 的职责划分

> 本章目标：把 Workboard 的所有包一次性搭出来——`apps/web`、`apps/api`、`packages/db`、`packages/api-client`、`packages/shared`、`packages/config`；画出单向无环的依赖方向，并解释每个包「该放什么、不该放什么」。这是「有边界」目标 C 的结构落地。
>
> 对应核心概念：**④ 每个 package 的职责；apps 存应用，packages 只放清晰可复用的模块，避免循环依赖。** 对应练习：**练习 1（收尾）。**

---

## 5.1 先定原则：apps vs packages

路线图给的结构是 `apps/` + `packages/`，这不是随便分的：

| 维度         | `apps/*`                    | `packages/*`                                 |
| ------------ | --------------------------- | -------------------------------------------- |
| 是什么       | **可运行/可部署的应用**     | **被复用的库/模块**                          |
| 典型成员     | `web`（SPA）、`api`（服务） | `db`、`api-client`、`shared`、`config`、`ui` |
| `private`    | 一定 `true`（应用不发布）   | 通常 `true`（内部包）                        |
| 有构建产物吗 | 有（`dist/`、bundle）       | 内部包常直接暴露 `.ts` 源码（第 7 章）       |
| 依赖方向     | 依赖 packages               | 依赖更底层的 packages，**绝不依赖 apps**     |

**判断一个东西该放哪**：

- 它能被 `pnpm start` 跑起来、能部署成一个进程/站点吗？→ `apps/`；
- 它是被别人 `import` 的、本身不独立运行吗？→ `packages/`。

> **别过度拆包**。路线图反复强调：最小合理结构是 `web`、`api`、`db`、`api-client`。`ui`、`config`、`shared` 只有当「有明确边界和真实使用方」时才抽。本教程拆出这几个是因为它们各自的教学目的明确；你真实项目起步时可以先只建 `web`/`api`/`db`/`api-client`，需要时再加。

---

## 5.2 依赖方向：一张必须背下来的图

```
                    ┌───────────────┐
                    │ apps/web      │  (React SPA)
                    └───────┬───────┘
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
      ┌──────────────┐ ┌─────────┐ ┌──────────┐
      │ api-client   │ │ shared  │ │  (ui)    │
      └──────┬───────┘ └────┬────┘ └────┬─────┘
             │              │           │
             ▼              │           │
          ┌────────┐        │           │
          │ shared │◄───────┘           │
          └────────┘                    │
                                        │
      ┌──────────────┐                  │
      │  apps/api    │  (Fastify)       │
      └───────┬───────┘                 │
       ┌──────┼───────┬─────────┐       │
       ▼      ▼       ▼         ▼       │
   ┌──────┐┌────────┐┌────────┐         │
   │  db  ││  api-  ││ shared │         │
   │      ││ client ││        │         │
   └──┬───┘└────────┘└────────┘         │
      ▼                                  │
   ┌────────┐                            │
   │ shared │                            │
   └────────┘                            │
                                         │
   所有包 ───────► packages/config（仅工具链配置，无运行时依赖）
```

规则只有三条，务必内化：

1. **apps 在最上层**：可以依赖任何 packages，但没有 packages 能依赖 apps；
2. **箭头永远向下**：`web → api-client → shared`，`api → db → shared`；底层包（`shared`）不依赖任何业务包；
3. **`config` 是横切的**：它只提供 tsconfig/eslint/prettier 配置，**没有任何运行时代码**，所以谁都能安全地把它当 devDependency。

**为什么必须无环**？回顾 3.5：pnpm 和 Turborepo 都靠「有向无环图（DAG）」来决定安装与任务顺序。有环 = 排不出顺序 = 构建不可预测 + ESM 运行时 undefined。

---

## 5.3 各包定义（完整 `package.json`）

下面给出每个包的最小可用定义。业务代码在其它阶段填充，本章聚焦**结构与依赖关系**。所有内部包用 `@workboard/` 作用域、`private: true`、`type: module`、`workspace:*` 互链。

### `apps/web`

```json
{
  "name": "@workboard/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "dependencies": {
    "@workboard/api-client": "workspace:*",
    "@workboard/shared": "workspace:*",
    "@tanstack/react-query": "5.104.5",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "6.1.2",
    "@workboard/config": "workspace:*",
    "typescript": "catalog:",
    "vite": "8.3.5",
    "vitest": "catalog:"
  }
}
```

**注意 web 的依赖里有什么、没有什么**：

- ✅ 有 `@workboard/api-client`（了解后端的唯一窗口）、`@workboard/shared`（同构类型）；
- ❌ **没有** `@workboard/api`、`@workboard/db`、`fastify`、`drizzle-orm`、`pg`。

前端**不该**知道服务端怎么实现，更不该拿到数据库代码。这条规则第 6 章会用脚本强制。

### `apps/api`

```json
{
  "name": "@workboard/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run",
    "openapi:export": "tsx src/scripts/export-openapi.ts ../../packages/api-client/openapi.json"
  },
  "dependencies": {
    "@workboard/db": "workspace:*",
    "@workboard/api-client": "workspace:*",
    "@workboard/shared": "workspace:*",
    "fastify": "5.12.7",
    "@fastify/swagger": "9.9.2",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "@workboard/config": "workspace:*",
    "tsx": "4.23.15",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`openapi:export` 是关键脚本：它把 api 的路由 schema 导出成 `openapi.json`，写进 `packages/api-client/`。第 11 章会把它作为 codegen 任务链的起点纳入 turbo 任务图。

> **为什么 api 依赖 api-client？** 因为 api 要用契约测试验证「真实响应符合自己导出的 OpenAPI」（第 11 章的 codegen 依赖顺序也要求 api 先于 api-client 生成）。这依然符合「箭头向下」：api 是 app，api-client 是 package。

### `packages/db`（server-only）

```json
{
  "name": "@workboard/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "@workboard/shared": "workspace:*",
    "drizzle-orm": "1.0.0-rc.4",
    "pg": "8.23.1"
  },
  "devDependencies": {
    "@types/pg": "8.23.1",
    "@workboard/config": "workspace:*",
    "drizzle-kit": "1.0.0-rc.4",
    "typescript": "catalog:"
  }
}
```

`db` 依赖 `pg`、`drizzle-orm`——**这些是服务端专属、且会接触数据库密钥的包**。前端绝不能 import `@workboard/db`。第 6 章讲如何用 `server-only` 标记 + 边界检查双重防护。

### `packages/api-client`

```json
{
  "name": "@workboard/api-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./openapi.json": "./openapi.json"
  },
  "scripts": {
    "generate": "openapi-typescript openapi.json --output src/generated/openapi.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@workboard/shared": "workspace:*",
    "openapi-fetch": "0.17.0"
  },
  "devDependencies": {
    "openapi-typescript": "7.13.0",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

### `packages/shared`（同构，前后端都能安全用）

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
    "@workboard/config": "workspace:*",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`shared` **不依赖任何业务包**（它是 DAG 的最底层），且**不含任何 Node/DOM 专属 API**——只有纯类型、常量、纯函数。这保证前后端都能安全 import。

### `packages/config`（仅工具链配置）

```json
{
  "name": "@workboard/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./tsconfig/base.json": "./tsconfig/base.json",
    "./tsconfig/react.json": "./tsconfig/react.json",
    "./tsconfig/node.json": "./tsconfig/node.json",
    "./eslint": "./eslint/index.js",
    "./prettier": "./prettier/index.js"
  },
  "devDependencies": {
    "typescript": "catalog:"
  }
}
```

`config` 里**没有运行时代码**，只有 JSON 配置和 lint 配置。第 6 章详解。

---

## 5.4 一次装齐并验证依赖图

所有包定义好后：

```bash
pnpm install
```

验证成员齐全：

```bash
pnpm list -r --depth -1
# @workboard/web 0.0.0 apps/web
# @workboard/api 0.0.0 apps/api
# @workboard/db 0.0.0 packages/db
# @workboard/api-client 0.0.0 packages/api-client
# @workboard/shared 0.0.0 packages/shared
# @workboard/config 0.0.0 packages/config
```

验证依赖方向（谁依赖 shared）：

```bash
pnpm --filter ...@workboard/shared list --depth -1
# 会列出 shared 以及所有依赖它的包
```

验证没有循环依赖：`pnpm install` 没有打印 `There are cyclic workspace dependencies` 即通过。想强制零容忍，在 `pnpm-workspace.yaml` 加 `disallowWorkspaceCycles: true`（3.5）。

---

## 5.5 检查依赖图是否真的是 DAG

除了 pnpm 的警告，你可以用 `madge` 直接可视化并检测环（临时用，不必装进依赖）：

```bash
# 对某个包的源码做循环依赖检测
pnpm dlx madge --circular --extensions ts apps/web/src
pnpm dlx madge --circular --extensions ts packages
```

`--circular` 会列出所有循环引用。把它加进 CI（第 12 章）就能守住「无环」这条规则。

> **包级循环**（`package.json` 里 `workspace:*` 互相指）由 pnpm 检测；**文件级循环**（`a.ts` import `b.ts`，`b.ts` import `a.ts`）由 madge 这类工具检测。两者都要防。

---

## 5.6 目录初始化清单

把本章落地成一份可执行的命令序列（业务代码后续章节填）：

```bash
# 目录
mkdir -p apps/web/src apps/api/src \
         packages/db/src packages/api-client/src/generated \
         packages/shared/src packages/config/tsconfig \
         e2e scripts

# 各包 package.json 按 5.3 创建
# 根 pnpm-workspace.yaml / package.json / .npmrc / .gitignore 已在第 2 章创建

pnpm install
pnpm list -r --depth -1     # 六个成员齐全
```

---

## 5.7 常见坑

| 现象                                      | 原因                                      | 解决                                                   |
| ----------------------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| `There are cyclic workspace dependencies` | 包之间 `workspace:*` 互相指               | 把共享物下沉到 `shared`；让依赖单向流动                |
| web 里能 import 到 `@workboard/db`        | 只是还没人拦，pnpm 严格性只挡「未声明的」 | 第 6 章的边界检查脚本 + `server-only` 标记             |
| 各包脚本名不统一，`pnpm -r build` 漏跑    | 有的包叫 `build` 有的叫 `compile`         | 统一命名：`build`/`dev`/`typecheck`/`lint`/`test`      |
| 内部包改了源码，app 里没生效              | 该包 `exports` 指向了 `dist` 但没重新构建 | 内部包 `exports` 直接指向 `.ts` 源码（第 7 章）        |
| `config` 包被运行时依赖，拖慢安装         | 把 config 放进了 `dependencies`           | config 只应是 `devDependencies`（它无运行时代码）      |
| 过早拆出一堆没人用的包                    | 「为了 monorepo 而 monorepo」             | 回到最小结构 web/api/db/api-client，有真实共享需求再拆 |

---

## 5.8 本章验收清单

- [ ] 能说清 `apps/*` 与 `packages/*` 的划分标准，并判断一个模块该放哪；
- [ ] 搭出六个包，`pnpm install` 成功、`pnpm list -r --depth -1` 成员齐全；
- [ ] 能默画依赖方向图，解释「apps 在上、箭头向下、config 横切」；
- [ ] 确认无循环依赖（pnpm 无警告 / madge `--circular` 为空），并知道如何用 `disallowWorkspaceCycles` 强约束；
- [ ] `apps/web/package.json` 里**没有**任何服务端专属依赖（`db`/`api`/`fastify`/`pg`）；
- [ ] 各包脚本命名统一，为后续 `pnpm -r` / `turbo run` 编排打好基础；
- [ ] 完成练习 1 全部内容。

---

上一章：[← 第 4 章：pnpm 过滤器与脚本编排](./04-filters-and-scripts.md) ｜ 下一章：[第 6 章：共享 config 与业务逻辑的边界 →](./06-shared-config-and-boundaries.md)
