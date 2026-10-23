# 第 8 章：Turborepo 入门 —— 任务图与 dependsOn

> 本章目标：安装 Turborepo，写出第一个 `turbo.json`，理解它的核心心智模型——**任务图（task graph）**：`tasks` 定义「有哪些任务」，`dependsOn` 定义「谁先谁后」，turbo 据此**并行 + 拓扑有序**地执行。掌握 `^` 拓扑依赖、同包依赖、`persistent` 长任务，以及 `turbo run --filter`。
>
> 对应核心概念：**③ Turborepo：task graph、dependsOn、任务边界。** 对应练习：**练习 2（起步）。**

---

## 8.1 为什么 pnpm 不够，还要 Turborepo

第 4 章我们用 `pnpm -r build` 就能对所有包跑 build，pnpm 甚至会按拓扑顺序执行。那为什么还要 Turborepo？因为 `pnpm -r` 缺了 monorepo 规模化后最关键的三样东西：

1. **缓存**：`pnpm -r build` 每次都从头跑所有包，哪怕 99% 没变。turbo 会跳过「输入没变」的任务，直接复用上次产物；
2. **最大化并行**：turbo 在满足依赖顺序的前提下，尽可能并行执行无依赖关系的任务，充分利用多核；
3. **精确的任务依赖建模**：turbo 让你显式声明「web 的 build 依赖 api-client 的 build 先完成」，还能声明「test 依赖 build」这类跨任务关系。

一句话：**pnpm 负责「把依赖装对」，turbo 负责「把任务跑对、跑快、不重复跑」。**

---

## 8.2 安装与 `turbo.json` 的位置

第 2 章的根 `package.json` 已经把 `turbo` 放进 `devDependencies`。安装后即可用：

```bash
pnpm install
pnpm exec turbo --version   # 或 npx turbo --version
```

在**仓库根目录**创建 `turbo.json`（turbo 的唯一全局配置文件）：

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    }
  }
}
```

> **两个版本坑**（README 已提醒，这里再钉一次）：
>
> 1. Turborepo **2.x 用 `tasks` 键**。1.x 用的 `pipeline` 键在 2.x 已废弃，抄旧教程会失效。
> 2. `$schema` 让你的编辑器对 `turbo.json` 提供补全和校验，强烈建议加上。

---

## 8.3 核心心智模型：任务图（task graph）

Turborepo 的世界观是一张**有向无环图（DAG）**。理解这张图，就理解了 turbo 的一半。

图里有**两种节点**：

- **包（package）**：workspace 里的每个成员，如 `@workboard/web`；
- **任务（task）**：`包#任务名`，如 `@workboard/web#build`、`@workboard/api#build`。

`turbo.json` 里的 `tasks` 定义的是**任务的「模板」**：它说「所有包的 `build` 任务，都遵循这套 `dependsOn`/`outputs` 规则」。turbo 会把模板套用到每个具体的包上，再结合包之间的 `workspace:*` 依赖，生成一张**具体的任务图**。

举个例子。我们的依赖是 `web → api-client → shared`、`api → db → shared`。当你运行 `turbo run build`，turbo 生成的图大致是：

```
@workboard/shared#build
        │            │
        ▼            ▼
api-client#build   @workboard/db#build
        │            │
        ▼            ▼
@workboard/web#build  @workboard/api#build
```

turbo 会：

1. 先跑没有任何前置的 `shared#build`；
2. 然后**并行**跑 `api-client#build` 和 `db#build`（它们互不依赖）；
3. 最后**并行**跑 `web#build` 和 `api#build`。

无依赖关系的任务自动并行，有依赖的严格按序。你什么都不用手动排序——**你只要声明「谁依赖谁」，turbo 负责调度。**

---

## 8.4 `dependsOn`：三种依赖写法

`dependsOn` 是一个数组，每个元素描述「本任务开始前，哪些任务必须已完成」。三种写法：

### 1. `^build` —— 拓扑依赖（最重要）

`^` 读作「caret」，表示「**我依赖的那些包**的同名任务」。

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"]
    }
  }
}
```

含义：`web#build` 开始前，`web` 依赖的所有包（`api-client`、`shared`）的 `build` 必须先完成。`^` 让依赖关系**顺着 `workspace:*` 自动展开**，你不用手写「web 依赖 api-client 和 shared」——turbo 从包依赖图推导。

> `^` 和第 4 章 pnpm 的 `web^...` 选择器是同一个直觉：**顺着依赖方向**。区别是 pnpm 用于「选包执行命令」，turbo 用于「声明任务先后」。

### 2. `build`（无 `^`）—— 同包内不同任务的依赖

不带 `^` 的任务名，表示「**同一个包里**的另一个任务」。

```json
{
  "tasks": {
    "test": {
      "dependsOn": ["build"] // 本包的 test 依赖本包的 build 先完成
    }
  }
}
```

含义：`api#test` 开始前，`api#build` 必须先完成（但不管别的包）。常用于「测试需要先构建产物」。

### 3. `$TURBO_DEFAULT$` —— 配合具体任务名的默认前置

当你既想依赖上游包，又想依赖同包的某任务，可以组合：

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build", "build"] // 上游包 build + 本包 build 都先完成
    }
  }
}
```

（`$TURBO_DEFAULT$` 主要用在环境变量声明里，第 10 章详解；在 `dependsOn` 里你主要用 `^task` 和 `task` 两种。）

一张速查表：

| `dependsOn` 写法 | 含义                        | 例子                              |
| ---------------- | --------------------------- | --------------------------------- |
| `^build`         | 依赖包们的 build 先完成     | web#build 等 api-client#build     |
| `build`          | 同包的 build 先完成         | api#test 等 api#build             |
| `^typecheck`     | 依赖包们的 typecheck 先完成 | web#typecheck 等 shared#typecheck |
| `[]`（空）       | 无前置，可立即并行执行      | lint 通常不依赖别的任务           |

---

## 8.5 一个完整的起步 `turbo.json`

先把最常用的四个任务定义好（缓存细节第 9 章补，环境变量第 10 章补）：

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "build/**"]
    },
    "typecheck": {
      "dependsOn": ["^typecheck"]
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

逐任务解释：

- **`build`**：`^build` 保证先构建上游包；`outputs` 声明产物目录（第 9 章缓存要用）；
- **`typecheck`**：`^typecheck` 让上游包先过类型检查。因为内部包直连 `.ts` 源码（第 7 章），typecheck 不需要上游先 build，但让上游先 typecheck 能更早暴露问题；
- **`lint`**：同理，`^lint`；
- **`test`**：`dependsOn: ["^build"]`——测试通常需要上游包已构建（若上游是源码直连则可省，但保守起见留着）；`outputs` 收集覆盖率报告；
- **`dev`**：`cache: false`（开发服务器不该被缓存，缓存一个「永远运行的进程」没意义）；`persistent: true`（这是个长任务，不会自己退出）。

### `persistent` 任务是什么

普通任务跑完就退出（build、test）。`persistent: true` 标记「这是个会一直运行的任务」（dev server、watch）。turbo 对 persistent 任务的处理：

- 不会等它「结束」再跑别的（否则 dev server 一启动就永远卡住）；
- 并行拉起多个 persistent 任务时，输出会带包名前缀区分；
- persistent 任务**不能被缓存**（turbo 会要求 `cache: false`）。

所以 `pnpm dev`（= `turbo run dev`）能同时拉起 web 和 api 两个 dev server。

---

## 8.6 运行任务

```bash
# 跑所有包的 build（按任务图并行 + 有序）
turbo run build

# 一次跑多个任务
turbo run build test lint

# 只跑某个包及其依赖（--filter，和 pnpm 语法相通）
turbo run build --filter=@workboard/web
turbo run build --filter=@workboard/web...   # web 及其依赖包
turbo run build --filter='...@workboard/shared'  # shared 的所有下游

# 通过根脚本（第 2 章已定义）
pnpm build       # == turbo run build
pnpm dev         # == turbo run dev
pnpm test        # == turbo run test
```

第一次运行 `turbo run build`，你会看到类似输出：

```
• Packages in scope: @workboard/api, @workboard/api-client, @workboard/db, @workboard/shared, @workboard/web
• Running build in 5 packages
• Remote caching disabled
@workboard/shared:build: cache miss, executing 1a2b3c...
@workboard/db:build: cache miss, executing 4d5e6f...
@workboard/api-client:build: cache miss, executing 7g8h9i...
@workboard/web:build: cache miss, executing ...
@workboard/api:build: cache miss, executing ...

 Tasks:    5 successful, 5 total
Cached:    0 cached, 5 total
```

注意 `cache miss`——第一次没有缓存可命中。`Cached: 0` 说明全是从头执行。第 9 章我们会看到第二次运行变成 `cache hit` / `Cached: 5`。

> **`cache miss, executing <hash>`** 里的 hash 是这次任务的「指纹」，由输入文件、依赖、环境变量、配置共同算出。第 9 章会拆解它。

---

## 8.7 可视化任务图

想亲眼看到 turbo 生成的图，用 `--graph`：

```bash
turbo run build --graph
```

它会输出一份 DOT/图形描述（或直接在终端渲染依赖关系），让你确认「谁在谁之前」。排查任务顺序问题时非常有用——**如果你怀疑某个任务没有按预期顺序跑，先 `--graph` 看图**。

你也可以用 dry run 看「turbo 打算怎么跑」而不真的执行：

```bash
turbo run build --dry=json    # 输出每个任务的 hash、inputs、依赖，但不执行
```

`--dry` 是理解缓存（第 9 章）的利器，先记住它。

---

## 8.8 任务边界：什么该是一个 task

不是所有脚本都值得进 `turbo.json`。判断标准：

✅ **适合当 turbo 任务**：

- 有明确开始/结束、产物可缓存的（build、test、lint、typecheck、codegen）；
- 跨包有依赖顺序的（`^build`）；
- 想享受并行 + 缓存的。

❌ **不适合当 turbo 任务**：

- 一次性的、交互式的命令（`pnpm dlx ...`）；
- 部署命令（应放 CI，且通常不缓存）；
- 纯根级操作（`git`、`docker compose`）。

> **任务边界 = 缓存边界**。你把什么定义成一个 task，就等于决定了「什么东西可以被独立缓存和跳过」。切得太粗（一个大 task 干很多事）会让缓存粒度太粗、动辄失效；切得太细（几十个 task）会让图复杂、调度开销上升。经验法则：**一个 task 对应一个包的一类可复用产物**（build 产物、测试结果、生成的代码）。

---

## 8.9 练习 2（起步）：配置 build/typecheck/lint/test

1. 在根目录写好 8.5 的 `turbo.json`；
2. 确认每个包的 `package.json` 都有对应的同名脚本（第 4 章练习 1 已统一）；没有的包，turbo 会自动跳过（不报错）；
3. 运行并观察：

   ```bash
   turbo run build
   turbo run typecheck lint test
   turbo run build --graph        # 看图，确认 shared 在最前、web/api 在最后
   ```

4. 记录第一次运行的 `Cached: 0 cached`，第 9 章我们会让它变成全命中。

`dependsOn` 与 `outputs` 的「正确性」验证留到第 9 章——因为「是否正确」恰恰要通过缓存的命中/失效来观察。

---

## 8.10 常见坑

| 现象                                      | 原因                                 | 解决                                                               |
| ----------------------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| `turbo.json` 配了却没生效                 | 用了 1.x 的 `pipeline` 键            | 2.x 改成 `tasks`                                                   |
| dev server 一启动，别的任务全卡住         | `dev` 没标 `persistent: true`        | 加 `"persistent": true` + `"cache": false`                         |
| 上游包没先构建，下游 build 失败           | `build` 的 `dependsOn` 漏了 `^build` | 加 `"dependsOn": ["^build"]`                                       |
| `--filter` 语法与 pnpm 不完全一样导致选错 | 混淆了 turbo 与 pnpm 的 filter       | turbo 用 `--filter=@workboard/web...`；多包用逗号或多次 `--filter` |
| persistent 任务报「cannot be cached」     | 给了 persistent 任务 `cache: true`   | persistent 任务必须 `cache: false`                                 |
| 任务顺序看着不对                          | 依赖图和你想象的不一致               | `turbo run <task> --graph` 可视化确认                              |

---

## 8.11 本章验收清单

- [ ] 能说清 Turborepo 相比 `pnpm -r` 多出的三样东西（缓存、并行、任务依赖建模）；
- [ ] 在根目录写好 `turbo.json`，理解 `tasks` 是「任务模板」、turbo 会套用到每个包生成具体任务图；
- [ ] 掌握 `dependsOn` 三种写法：`^build`（拓扑）、`build`（同包）、组合；
- [ ] 理解 `persistent` + `cache: false` 用于 dev/watch 长任务；
- [ ] 会用 `turbo run <task>`、多任务、`--filter`、`--graph`、`--dry=json`；
- [ ] 能判断一个脚本是否适合定义为 turbo 任务（任务边界 = 缓存边界）；
- [ ] 完成练习 2 起步：跑通 build/typecheck/lint/test，看到第一次 `Cached: 0`。

---

上一章：[← 第 7 章：包 exports、ESM 与 project references](./07-exports-esm-references.md) ｜ 下一章：[第 9 章：Turborepo 缓存 →](./09-turborepo-caching.md)
