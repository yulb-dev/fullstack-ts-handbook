# 第 10 章：环境变量建模

> 本章目标：搞清楚 Turborepo 如何对待环境变量——`env` / `globalEnv` / `passThroughEnv` / `globalPassThroughEnv` 的区别、strict 模式为什么是默认、framework inference 帮你做了什么、`.env` 文件如何进入缓存 hash；并守住一条红线：**绝不把 secret 混进缓存 key，绝不让 secret 出现在产物或日志里**。完成练习 4 的环境变量部分。
>
> 对应核心概念：**③ 环境变量建模。** 对应练习：**练习 4（环境变量部分）。**

---

## 10.1 为什么环境变量对缓存如此关键

回顾第 9 章：任务的 hash 决定了缓存命中与否，而**环境变量的值是 hash 的输入之一**。为什么必须这样？

因为很多任务的产物**依赖环境变量**。举例：

- `vite build` 会把 `VITE_API_URL` 内联进 bundle。如果 `VITE_API_URL=https://prod` 和 `=https://staging` 用同一份缓存，你就会把 staging 的地址发到 prod；
- `tsc` 的行为可能受 `NODE_ENV` 影响；
- 测试可能因 `DATABASE_URL` 不同而跑不同的库。

所以正确的语义是：**影响产物的环境变量，值变了就必须让缓存失效。** 如果 turbo 不把 env 纳入 hash，你会得到一个「看起来命中、其实产物是用错误 env 生成的」的幽灵缓存——这是极其隐蔽的 bug。

但反过来：**不影响产物的环境变量**（比如 `CI=true`、`TERM`、CI 厂商注入的一堆 `GITHUB_*`），如果也纳入 hash，会导致「换个 runner 就全量失效」，缓存形同虚设。

**于是问题变成：如何区分「影响产物的 env」和「无关的 env」？** 这就是 Turborepo 环境变量建模要解决的。

---

## 10.2 四个关键字段

turbo 把环境变量分成两个维度、四种处理：

| 字段                   | 作用域 | 是否进 hash | 是否对任务可见 | 用途                                  |
| ---------------------- | ------ | ----------- | -------------- | ------------------------------------- |
| `env`                  | 单任务 | ✅ 是       | ✅ 是          | 影响该任务产物的变量（如 `NODE_ENV`） |
| `globalEnv`            | 全仓   | ✅ 是       | ✅ 是          | 影响所有任务的变量                    |
| `passThroughEnv`       | 单任务 | ❌ 否       | ✅ 是          | 任务要用、但不影响产物的变量          |
| `globalPassThroughEnv` | 全仓   | ❌ 否       | ✅ 是          | 所有任务可用、但不影响缓存的变量      |

两个维度：

- **作用域**：`env`/`passThroughEnv` 定义在**某个任务**下，只对该任务生效；`globalEnv`/`globalPassThroughEnv` 定义在 `turbo.json` **顶层**，对所有任务生效。
- **是否进 hash**：`env`/`globalEnv` 的值**参与 hash**（变了就失效）；`passThroughEnv`/`globalPassThroughEnv` **不参与 hash**（只是「允许任务读到它」，但读到的值不同不会导致缓存失效）。

### 配置示例

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "globalEnv": ["NODE_ENV"],
  "globalPassThroughEnv": ["CI"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "env": ["VITE_API_URL"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "env": ["DATABASE_URL"],
      "passThroughEnv": ["GITHUB_RUN_ID"]
    }
  }
}
```

解读：

- `NODE_ENV` 影响所有任务 → `globalEnv`，值变了全仓相关任务失效；
- `VITE_API_URL` 只影响 `build`（被内联进 bundle）→ build 的 `env`；
- `DATABASE_URL` 影响 `test` 跑哪个库 → test 的 `env`；
- `CI`、`GITHUB_RUN_ID` 任务里可能读，但不影响产物 → `passThroughEnv` / `globalPassThroughEnv`，**不进 hash**（否则每次 CI run id 不同就全失效）。

> **判断口诀**：问自己「这个变量的值不同，会不会让**产物或结果**不同？」
>
> - **会** → 放 `env`/`globalEnv`（进 hash，保证正确性）；
> - **不会，但任务运行时需要读到它** → 放 `passThroughEnv`（不进 hash，保证命中率）。

---

## 10.3 strict 模式（默认）：白名单语义

Turborepo 2.x 默认 **strict 模式**（`envMode: "strict"`）。它的规则是：

> **任务在运行时，只能读到你在 `env`/`globalEnv`/`passThroughEnv`/`globalPassThroughEnv` 里显式声明过的环境变量。未声明的，一律被过滤掉、读不到。**

为什么默认这么严格？两个原因：

1. **正确性**：强制你显式声明「哪些 env 影响任务」，避免「某个 env 悄悄影响了产物，但你没纳入 hash，导致错误缓存」；
2. **可复现**：任务的行为只取决于声明过的变量，不受 runner 上一堆意外注入的环境变量干扰。

strict 模式的**代价**：如果你的任务依赖了某个没声明的 env（比如 CI 厂商注入的、或框架约定的），它会读到 `undefined` 而失败。turbo 会在日志里提示「某个被引用的 env 未声明」。

### loose 模式（不推荐，但要知道）

`envMode: "loose"` 会让任务读到所有环境变量（类似传统行为），只有声明进 `env` 的才进 hash。这牺牲了严格性换取便利，容易埋「幽灵 env」的坑。**除非有明确的兼容需求，否则保持默认 strict。**

```bash
turbo run build --env-mode=loose   # 临时切换（不推荐）
```

---

## 10.4 framework inference：turbo 帮你认常见变量

strict 模式听起来很麻烦——难道每个 `VITE_*`、`NEXT_PUBLIC_*` 都要手写进 `env`？

不用。turbo 有 **framework inference（框架推断）**：它识别常见框架（Vite、Next.js、Vue、Astro 等）的约定，**自动**把相关环境变量纳入对应任务的 hash。例如：

- 检测到 Vite 项目 → 自动把所有 `VITE_*` 变量当作 `build`/`dev` 的 env；
- 检测到 Next.js → 自动处理 `NEXT_PUBLIC_*`、`NEXT_*`。

所以你不必手动列 `VITE_API_URL`（虽然显式列也没坏处、更清晰）。framework inference 降低了 strict 模式的摩擦。

> **但别过度依赖推断**：对于**自定义**的、框架不认识的环境变量（如你自己的 `WORKBOARD_REGION`），inference 不会帮你，你必须手动写进 `env`。**凡是影响产物、又不是标准框架变量的 env，一律显式声明。**

---

## 10.5 `$TURBO_DEFAULT$`：保留默认行为

有时你既想加自己的 env，又想保留 turbo 的默认 env 集合（含 framework inference 的那些）。用 `$TURBO_DEFAULT$`：

```json
{
  "tasks": {
    "build": {
      "env": ["$TURBO_DEFAULT$", "MY_CUSTOM_VAR"]
    }
  }
}
```

`$TURBO_DEFAULT$` 展开成 turbo 对该任务的默认 env（框架推断出来的那些），再加上你自定义的 `MY_CUSTOM_VAR`。这样你不会因为「自己写了 env 数组」而丢掉框架推断。

---

## 10.6 `.env` 文件如何进入缓存

一个常见困惑：turbo 读的是「进程环境变量」，那项目里的 `.env` 文件呢？

关键区分：

- **turbo 本身不自动解析 `.env` 文件的内容**（是否加载 `.env` 是你的任务脚本/框架的事，如 Vite 会读 `.env`、`tsx --env-file=.env` 会加载）；
- **但 `.env` 文件的内容变化，需要反映到 hash 上**——否则你改了 `.env` 里的 `VITE_API_URL`，build 却命中旧缓存，产物还是旧地址。

怎么让 `.env` 影响 hash？两种途径：

### 途径 1：把 env 值声明进 `env`（推荐）

如果 `.env` 里的变量被框架/脚本加载成了进程环境变量，并且你把它声明进了 `env`/`globalEnv`，那么**它的值**就进了 hash。改 `.env` → 加载出的 env 值变 → hash 变 → 缓存失效。这是最干净的方式。

### 途径 2：把 `.env` 文件声明为依赖文件

对于**没被加载成 env、但影响构建**的文件（或你想让整个文件参与 hash），用 `globalDependencies`（顶层）或任务 `inputs`：

```json
{
  "globalDependencies": [".env", "tsconfig.base.json"],
  "tasks": {
    "build": {
      "inputs": ["src/**", ".env.production"]
    }
  }
}
```

- `globalDependencies` 里列的文件，**任何一个变化 → 所有任务失效**（适合根级共享配置）；
- 任务 `inputs` 里列的文件，只影响该任务。

> **安全提醒**：`.env` 通常是 gitignore 的（第 2 章），turbo 计算 hash 用的是文件的**内容哈希**，不会把内容写进缓存或日志。但**绝不**要把真实 `.env` 提交进 git，也不要在 `env` 里声明 secret 后又把缓存上传到不可信的远程（见 10.7）。

---

## 10.7 红线：secret 与缓存的安全边界

这是本教程最重要的安全条款之一，直接对应路线图的红线要求。

### 红线 1：secret 不进缓存 key、不进产物、不进日志

- 如果你把一个 secret（如 `DATABASE_URL` 带密码、`BETTER_AUTH_SECRET`）声明进了 `env`，它的**值会参与 hash 计算**。hash 是单向的，理论上反推不出原值，但：
  - turbo 在 `--dry=json` 里会列出「哪些 env 被纳入」；
  - **远程缓存**会把 hash 和产物上传到服务端。如果产物里内联了 secret（比如 Vite 把 `VITE_*` 打进 bundle，而你不小心把 secret 用了 `VITE_` 前缀），**secret 就被上传到远程缓存了**。
- **规则**：**任何以 `VITE_`/`NEXT_PUBLIC_` 等「会被打包进前端产物」的前缀命名的变量，绝不能放真实 secret。** 前端产物是公开的。secret 只能是服务端运行时注入、不进 bundle 的变量。

### 红线 2：区分 build-time 与 runtime secret

- **build-time 变量**（进 bundle）：如 `VITE_API_URL`。这些会固化在产物里，缓存产物 = 缓存了这些值。**只能是公开信息。**
- **runtime secret**（运行时读取，不进 bundle）：如 `DATABASE_URL`、`JWT_SECRET`。这些应由部署环境在**运行时**注入，不参与构建，也就**不该进 build 任务的 env/缓存**。

如果你把 runtime secret 错误地放进了 build 的 env，会导致：改一次 secret → 全量重建（不必要），且 secret 值进入了 hash 计算链路。**正确做法：runtime secret 通过 `passThroughEnv` 传给需要的任务（如 `test`、`db:migrate`），或干脆在任务外部由部署环境注入，且相关任务 `cache: false`。**

### 红线 3：CI 缓存可能被不可信工作流读取

第 12 章详述，这里先立规矩：**CI 的 cache 可能被不同分支、甚至 fork PR 的工作流读取。绝不能把 secret 存进任何形式的缓存**（CI cache 或远程 turbo cache 的产物里）。

---

## 10.8 练习 4（环境变量部分）：观察 env 对缓存的影响

接着第 9 章练习 4 的实验，补上环境变量维度：

### 实验 A：改一个「进 hash」的 env，观察失效

```bash
# 确保 build 的 env 声明了 VITE_API_URL（或用 turbo 对 Vite 的自动推断）
# 建立基线
turbo run build --filter=@workboard/web
# 全命中

# 改变量值再跑
VITE_API_URL=https://staging.example.com turbo run build --filter=@workboard/web
# 期望：web#build cache miss（因为 VITE_API_URL 进了 hash，值变了）
```

**解释**：`VITE_API_URL` 被内联进 bundle，属于「影响产物」的 env，所以进 hash；值变 → hash 变 → 失效重建。这保证了 staging/prod 不会用错缓存。

### 实验 B：改一个「passthrough」的 env，观察仍命中

```bash
# 假设 CI 在 globalPassThroughEnv 里
turbo run build --filter=@workboard/web
# 全命中

CI=true GITHUB_RUN_ID=999 turbo run build --filter=@workboard/web
# 期望：仍然 cache hit（CI / GITHUB_RUN_ID 是 passthrough，不进 hash）
```

**解释**：这些变量任务能读到，但不影响产物，所以不进 hash；改它们不会导致无谓失效。这就是 passthrough 的价值——**兼顾「能读到」与「高命中率」**。

### 实验 C：用 `--dry=json` 看 env 如何进 hash

```bash
turbo run build --filter=@workboard/web --dry=json | grep -A20 environment
# 能看到 turbo 认为哪些 env 变量参与了该任务的 hash
VITE_API_URL=https://a turbo run build --filter=@workboard/web --dry=json
VITE_API_URL=https://b turbo run build --filter=@workboard/web --dry=json
# 对比两次的 hash，应不同
```

### 把结论写进练习 4 的记录

- 影响产物的 env（`env`/`globalEnv`）→ 进 hash → 改值即失效（实验 A）；
- 无关的 env（`passThroughEnv`）→ 不进 hash → 改值仍命中（实验 B）；
- `--dry=json` 是审查「哪些 env 进了 hash」的权威工具（实验 C）。

---

## 10.9 常见坑

| 现象                                | 原因                                     | 解决                                                             |
| ----------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| 任务报某 env 是 `undefined`         | strict 模式下没声明该 env                | 把它加进 `env`/`passThroughEnv`（影响产物用前者，否则后者）      |
| 改了 `.env` 里的 API 地址，产物没变 | env 没进 hash，命中旧缓存                | 把该变量声明进 `env`，或把 `.env` 加入 `globalDependencies`      |
| 换个 CI runner 就全量失效           | CI 注入的 env 被当成了 `env`（进 hash）  | 把无关变量改用 `passThroughEnv`/`globalPassThroughEnv`           |
| 前端 bundle 里出现了 secret         | secret 用了 `VITE_`/`PUBLIC_` 前缀被打包 | secret 绝不用公开前缀；只服务端运行时注入                        |
| 改 secret 导致全量重建              | secret 被放进了 build 的 `env`           | runtime secret 用 passthrough 或外部注入，相关任务 `cache:false` |
| 自己写了 `env` 数组后框架变量失效   | 覆盖了默认推断                           | 用 `$TURBO_DEFAULT$` 保留默认再加自定义                          |

---

## 10.10 本章验收清单

- [ ] 能解释为什么「影响产物的 env 必须进 hash」，以及「无关 env 进 hash」为何有害；
- [ ] 分清 `env` / `globalEnv` / `passThroughEnv` / `globalPassThroughEnv` 的作用域与是否进 hash；
- [ ] 理解 strict 模式（默认）的白名单语义与 framework inference 的便利及其边界；
- [ ] 会用 `$TURBO_DEFAULT$` 保留默认 env；
- [ ] 知道 `.env` 文件如何通过 `env` 值或 `globalDependencies` 进入 hash；
- [ ] **牢记三条 secret 红线**：不进公开产物、区分 build-time/runtime、不进 CI 缓存；
- [ ] 完成练习 4 环境变量部分（实验 A/B/C）。

---

上一章：[← 第 9 章：Turborepo 缓存](./09-turborepo-caching.md) ｜ 下一章：[第 11 章：完整任务图与 OpenAPI 生成 →](./11-full-task-graph.md)
