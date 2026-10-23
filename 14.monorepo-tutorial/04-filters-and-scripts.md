# 第 4 章：pnpm 过滤器与脚本编排

> 本章目标：掌握 pnpm 的 `--filter` 选择器与 `-r` 递归执行，能精确地「只对某个包 / 某类包 / 变更过的包」执行命令；分清「单包开发」与「全仓构建」两种典型用法。完成练习 1 的脚本统一部分。
>
> 对应核心概念：**① 过滤器；⑧ workspace filters 在单包开发与全仓构建中的用法。** 对应练习：**练习 1。**

---

## 4.1 为什么需要过滤器

monorepo 里有很多包。大部分时候你**不想**对所有包做操作：

- 你在开发 `apps/web`，只想跑 web 的 dev server，不想把 api 也拉起来；
- 你改了 `packages/shared`，想重新测试**所有依赖它的包**，但不想重跑无关的包；
- CI 里你只想检查**这次 PR 改动过的包**，而不是全仓二十分钟。

`pnpm --filter` 就是「选出包的子集」的工具。它的基本形态：

```bash
pnpm --filter <选择器> <命令>
```

---

## 4.2 基础选择器

### 按包名（精确 / 通配）

```bash
# 精确选中一个包
pnpm --filter @workboard/web dev

# 通配：所有 @workboard 作用域的包
pnpm --filter "@workboard/*" test

# 通配：名字以 db 结尾的包
pnpm --filter "*db" typecheck
```

> 注意：包名带 `/`（作用域）时，在 zsh 里要用引号包起来，否则 shell 会把 `*` 当路径通配。

### 按目录（glob）

```bash
# packages/ 下的所有包
pnpm --filter "./packages/**" typecheck

# apps/ 下的所有包
pnpm --filter "./apps/*" build
```

---

## 4.3 关系选择器：依赖 与 被依赖（重点）

这是过滤器最强大、也最容易记混的部分。用 `...` 表示「顺着依赖关系扩展」：

### `<pkg>...` —— 该包 + 它依赖的所有包

```bash
# web 以及 web 依赖的所有包（shared、api-client……）
pnpm --filter @workboard/web... build
```

后缀 `...`：**向后**追依赖。适合「构建/安装某个 app 时，先把它依赖的包也准备好」。

### `...<pkg>` —— 该包 + 所有依赖它的包

```bash
# shared 以及所有依赖 shared 的包（web、api……）
pnpm --filter ...@workboard/shared test
```

前缀 `...`：**向前**找「谁用了我」。适合「我改了 shared，把所有下游都重新测一遍」。

### 只要依赖 / 只要被依赖（排除自己）

```bash
# 只要 web 的依赖，不含 web 自己
pnpm --filter "@workboard/web^..." build

# 只要依赖 shared 的包，不含 shared 自己
pnpm --filter "...^@workboard/shared" test
```

`^` 表示「排除起点包本身」。

一张速查表：

| 写法      | 选中                        | 典型用途                 |
| --------- | --------------------------- | ------------------------ |
| `web`     | 仅 web                      | 只操作一个包             |
| `web...`  | web + web 的所有依赖        | 构建 app 前先备好依赖    |
| `...web`  | web + 所有依赖 web 的包     | 改了 web，测所有受影响方 |
| `web^...` | 仅 web 的依赖（不含 web）   | 只重建上游               |
| `...^web` | 仅依赖 web 的包（不含 web） | 只处理下游               |

> **记忆法**：`...` 在哪边，就往哪边扩。`web...`（点在右）向右扩到依赖；`...web`（点在左）向左扩到被依赖。`^` 是「砍掉起点」。

---

## 4.4 变更选择器：只处理「改动过的包」

这是 CI 增量的关键。`[<since>]` 选出「相对某个 commit/分支有变更的包」：

```bash
# 相对 origin/main 有改动的包
pnpm --filter "...[origin/main]" test
```

- `[origin/main]`：自 `origin/main` 以来变更的包；
- 前缀 `...`：连同依赖这些变更包的下游一起选中（改了 shared，web/api 也要测）；
- 自 pnpm v12.7 起，`<since>` 与「当前分支的分叉点（merge base）」比较，避免把 `main` 上的新提交误算成你的改动；
- 需要 Git 2.24+。

配合 `--test-pattern` 可以更聪明：如果改动只发生在测试文件里，就不必连累下游包：

```bash
pnpm --filter "...[origin/main]" --test-pattern="test/*" test
```

> **这正是「可缓存/增量」目标 B 在 pnpm 层面的体现**：不是全仓重跑，而是只跑受影响的。第 12 章会在 CI 里用它；而 Turborepo 的缓存（第 9 章）是更细粒度的另一种增量，两者互补。

---

## 4.5 排除与组合

任何选择器加前缀 `!` 变成排除（zsh 里 `!` 要转义成 `\!` 或用引号）：

```bash
# 除 web 外的所有包
pnpm --filter '!@workboard/web' test

# 所有包，但排除 packages/config
pnpm -r --filter '!@workboard/config' typecheck
```

多个 `--filter` 可叠加，取并集后再按排除收敛：

```bash
pnpm --filter "@workboard/web..." --filter "@workboard/api..." build
```

---

## 4.6 递归执行：`-r` / `--recursive`

`-r` 表示「对所有 workspace 包执行」，无需逐个 filter：

```bash
# 对所有包跑 typecheck（各包 package.json 里要有 typecheck 脚本）
pnpm -r typecheck

# 对所有包安装依赖（其实根目录 pnpm install 就够了）
pnpm -r install

# 只列出所有包
pnpm list -r --depth -1
```

`-r` 与 `--filter` 可结合，`--filter` 缩小 `-r` 的范围：

```bash
pnpm -r --filter "./packages/**" test
```

几个控制递归行为的开关：

| 开关                        | 作用                                                            |
| --------------------------- | --------------------------------------------------------------- |
| `--workspace-concurrency=N` | 并行执行几个包的任务（默认 `min(4, CPU 核数)`）                 |
| `--include-workspace-root`  | 递归时也把根包算进去（默认不含根）                              |
| `--fail-if-no-match`        | filter 没匹配到任何包时报错退出（防止「选择器写错却静默成功」） |
| `--parallel`                | 无视拓扑顺序，全部并行（用于 dev/watch 这类长任务）             |

> `--fail-if-no-match` 很有用：如果你把包名拼错，默认 pnpm 会「什么都没选中但成功退出」，CI 里就漏跑了检查还一片绿。加上它，拼错会直接失败。也可在 `pnpm-workspace.yaml` 里设 `failIfNoMatch: true` 全局开启。

---

## 4.7 给某个包添加依赖（正确的姿势）

回顾 2.9 的坑：在根目录 `pnpm add react` 会把依赖装到根，前端反而找不到。正确做法是用 `--filter` 指定目标包：

```bash
# 给 web 添加运行时依赖
pnpm --filter @workboard/web add react react-dom

# 给 api 添加开发依赖
pnpm --filter @workboard/api add -D vitest

# 给 web 添加对本地包 shared 的依赖（自动写成 workspace:*）
pnpm --filter @workboard/web add @workboard/shared
```

最后一条会自动写入 `"@workboard/shared": "workspace:*"`（受 `saveWorkspaceProtocol` 影响，默认 `rolling` 即写 `workspace:*`），并建立符号链接。**永远用 `--filter` 定向添加，不要在根目录乱装业务依赖。**

---

## 4.8 脚本编排：根脚本 vs 包脚本

monorepo 的脚本分两层，职责要分清：

### 包内脚本（每个包自己的 `package.json`）

描述「这个包自己能做什么」，用**本包的**依赖和上下文：

```json
// apps/web/package.json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run"
  }
}
```

### 根脚本（根 `package.json`）

描述「怎么编排所有包」。有两种写法：

**写法 A：委托给 pnpm 递归**（简单，无缓存、依赖顺序有限）

```json
{
  "scripts": {
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test"
  }
}
```

**写法 B：委托给 Turborepo**（推荐，有任务图、并行、缓存）

```json
{
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "dev": "turbo run dev"
  }
}
```

第 8 章起我们全面转向写法 B。为什么？因为 `pnpm -r` 虽然也能按拓扑顺序跑，但它**没有缓存**——每次都从头执行，无法「跳过没变的包」。Turborepo 补上了这块。

> **过渡期建议**：在你还没引入 Turborepo 之前（第 2~7 章），根脚本可以先用 `pnpm -r …` 或 `pnpm --filter …` 顶着；引入 turbo 后再替换成 `turbo run …`。本教程会在第 8 章统一切换。

---

## 4.9 单包开发 vs 全仓构建（核心概念 ⑧）

路线图明确要求区分这两种用法，这里对照给出命令：

### 场景一：单包开发（本地日常）

你在开发 `apps/web`，只想跑它和它依赖的东西，不碰无关包：

```bash
# 只起 web 的 dev（假设 web 的 dev 不需要先 build 依赖包，因为内部包直连源码）
pnpm --filter @workboard/web dev

# 如果 web 依赖的包需要先构建（比如 api-client 要先生成），用 ... 把依赖也带上
pnpm --filter @workboard/web... build

# 只装 web 及其依赖的依赖树
pnpm install --filter @workboard/web...
```

### 场景二：全仓构建 / CI（发布、验证）

要确保整个仓库都能构建、都能通过检查：

```bash
# 全仓构建（引入 turbo 后）
pnpm build            # == turbo run build，按任务图并行 + 缓存

# 全仓类型检查 + 测试
pnpm typecheck
pnpm test

# CI 里：只跑这次 PR 受影响的包
pnpm --filter "...[origin/main]" typecheck
pnpm --filter "...[origin/main]" test
```

> **要点**：本地开发追求「快、只碰我在意的包」（用 `--filter <pkg>` 或 `<pkg>...`）；CI/发布追求「全、不遗漏」（用 `-r` 全量，或 `...[origin/main]` 精准增量）。选错会导致要么本地太慢，要么 CI 漏检。

---

## 4.10 练习 1（完成）：统一 lockfile 与脚本

把第 2 章起步的练习 1 收尾：

1. **统一 lockfile**：确认全仓只有根目录一个 `pnpm-lock.yaml`，各子包目录下没有残留的 `package-lock.json`/`yarn.lock`（有就删掉并提交）：

   ```bash
   find . -name package-lock.json -not -path "*/node_modules/*"
   find . -name yarn.lock -not -path "*/node_modules/*"
   ```

2. **统一脚本命名**：给每个包的 `scripts` 用**一致的名字**——`build`、`dev`、`typecheck`、`lint`、`test`。命名统一后，`pnpm -r typecheck` / `turbo run typecheck` 才能一次性对所有包生效。这是 monorepo 的隐形约定：**同名脚本 = 同类操作**。

3. **根脚本编排**：把根 `package.json` 的脚本指向 `pnpm -r <name>`（暂时）或 `turbo run <name>`（第 8 章后）。

4. **验证**：

   ```bash
   pnpm -r typecheck          # 所有包类型检查一次跑完
   pnpm --filter @workboard/shared test   # 只测一个包
   pnpm list -r --depth -1    # 确认成员齐全
   ```

完成后，路线图练习 1「把 web/api 拆成 workspace 包，统一 pnpm lockfile 与脚本」即告达成——**新 clone 后一条 `pnpm install` 装齐，一条 `pnpm -r typecheck` 全检**，无需在多个目录手工操作。

---

## 4.11 常见坑

| 现象                                | 原因                                         | 解决                                                                       |
| ----------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `--filter @scope/pkg` 在 zsh 里报错 | shell 把 `*`、`!` 当特殊字符                 | 用引号包住选择器：`--filter "@scope/*"`、`--filter '!x'`                   |
| filter 拼错包名，命令却「成功」了   | 没匹配到包时默认静默成功                     | 加 `--fail-if-no-match`，或 `pnpm-workspace.yaml` 设 `failIfNoMatch: true` |
| `pnpm add x` 装到了根，子包找不到   | 在根目录直接 add                             | 用 `pnpm --filter <pkg> add x`                                             |
| `[origin/main]` 选不中任何包        | 本地没有 `origin/main` 引用，或 Git 版本过低 | `git fetch origin`；确认 Git ≥ 2.24                                        |
| `pnpm -r dev` 卡住不动              | 多个 persistent（watch）任务串行等待         | 用 `--parallel`，或引入 turbo 的 `persistent` 任务（第 8 章）              |
| 改了 shared，web 的行为没变         | 只跑了 `--filter web`，没重建/重测下游       | 用 `...` 关系选择器或 `...[origin/main]`                                   |

---

## 4.12 本章验收清单

- [ ] 会用 `--filter <包名>`、通配、目录 glob 选中包；
- [ ] 能准确区分并写出 `web...`（+依赖）、`...web`（+被依赖）、`^` 排除起点四种关系选择器；
- [ ] 会用 `...[origin/main]` 选出「变更过的包及其下游」，并说清它在 CI 增量里的价值；
- [ ] 理解 `-r` 递归与 `--workspace-concurrency`、`--fail-if-no-match` 等开关；
- [ ] 会用 `pnpm --filter <pkg> add` 给指定包添加依赖（含 `workspace:*` 本地包）；
- [ ] 能对照给出「单包开发」与「全仓构建」两套命令；
- [ ] 完成练习 1：统一单一 lockfile 与各包同名脚本，用一条命令装齐/全检。

---

上一章：[← 第 3 章：pnpm 依赖模型](./03-pnpm-dependency-model.md) ｜ 下一章：[第 5 章：搭建 Workboard 骨架 →](./05-repo-skeleton.md)
