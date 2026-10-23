# 第 9 章：Turborepo 缓存 —— inputs / outputs 与命中失效

> 本章目标：拆开 Turborepo 缓存的黑盒——缓存存在哪、hash 由什么算出、`inputs`/`outputs` 各自声明什么、`cache: false` 何时用；然后**动手做实验**：故意制造缓存命中与失效，用 `--dry`、`--force`、`--output-logs` 观察并解释每一次结果。这是「可缓存」目标 B 与练习 4 的核心。
>
> 对应核心概念：**③ cache、outputs、任务边界。** 对应练习：**练习 4。**

---

## 9.1 缓存的基本承诺

Turborepo 缓存的核心承诺是一句话：

> **「相同的输入，不重复计算。」** 如果一个任务这次的所有输入和上次完全一样，turbo 就直接恢复上次的产物和日志，跳过执行。

这就是第 8 章你看到的 `cache miss`（没有可复用的，执行）与 `cache hit`（有可复用的，恢复）的区别。命中的任务几乎瞬间完成——这正是 monorepo「改一行不必全量重跑」的机制。

但请注意这句话的**边界**：缓存只保证「不重复计算」，**不保证「计算是对的」**。如果你的 build 脚本本身有 bug，缓存只会忠实地把错误结果缓存下来。**正确性靠测试，不靠缓存。**（第 1 章坑表已强调，这里再钉一次。）

---

## 9.2 缓存存在哪：`.turbo/cache`

turbo 默认把缓存写在本地文件系统的 `.turbo/cache/` 目录（Turborepo 2.10+ 的位置；早期版本在 `node_modules/.cache/turbo`）。

```bash
ls .turbo/cache
# 一堆以 hash 命名的目录，每个是一次任务的缓存条目
```

- 这是**本地缓存**：只在你这台机器上，`git clone` 别人拿不到；
- 它**必须 gitignore**（第 2 章 `.gitignore` 已含 `.turbo/`）——缓存是派生产物，不是源码；
- 团队/CI 之间共享缓存需要**远程缓存**（第 12 章）。

每个缓存条目里存了两样东西：

1. **`outputs`**：任务产出的文件（如 `dist/`）；
2. **日志**：任务执行时的 stdout/stderr（命中时可以「回放」日志，让你看到和真跑一样的输出）。

---

## 9.3 hash 由什么算出（最关键的心智模型）

一个任务是否命中缓存，取决于它的 **hash（指纹）**。hash 相同 → 命中；hash 变了 → 失效重跑。**理解 hash 的输入，就理解了缓存的一切。** 任务的 hash 由这几类东西共同算出：

| hash 输入                            | 说明                                           | 改变它会导致                      |
| ------------------------------------ | ---------------------------------------------- | --------------------------------- |
| **包的输入文件**（`inputs`）         | 默认是「该包所有被 git 跟踪的文件」            | 改源码 → 该包任务失效             |
| **依赖包的产物**（上游 outputs）     | `^build` 依赖的上游包，它们的**输出**也进 hash | 改 `shared` → 依赖它的 `web` 失效 |
| **环境变量**（`env`/`globalEnv`）    | 声明过的、影响任务的环境变量值                 | 改了 `NODE_ENV` → 相关任务失效    |
| **`turbo.json` 里该任务的配置**      | `dependsOn`、`outputs`、`inputs` 等本身        | 改任务配置 → 该任务失效           |
| **lockfile（依赖版本）**             | 依赖树变化会影响 hash                          | 升级依赖 → 相关任务失效           |
| **全局依赖**（`globalDependencies`） | 声明的全局文件（如根 `.env`、`tsconfig.base`） | 改全局文件 → 所有任务失效         |
| **turbo 版本 / Node 版本**           | 工具链本身                                     | 升级 turbo → 缓存可能整体失效     |

**这里藏着 monorepo 增量最精妙的地方**：`web#build` 的 hash 里包含了「它依赖的上游包（`api-client`、`shared`）的产物 hash」。所以：

- 改 `apps/web/src` 一个文件 → 只有 `web#build` 失效，`shared`/`api-client` 仍命中；
- 改 `packages/shared/src` 一个文件 → `shared#build` 失效 → 它的产物 hash 变 → **所有依赖 shared 的下游**（api-client、web、api、db）的 build 也失效；
- 改一个**没人依赖**的包 → 只有它自己失效，其余全命中。

**「受影响的下游会被正确重建，无关的包仍命中」——这正是通过标准第二条的技术实现。**

---

## 9.4 `outputs`：声明任务的产物

turbo 需要知道「任务跑完，哪些文件是产物、该被缓存起来」。这就是 `outputs`：

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "build/**", "!.next/cache/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    }
  }
}
```

要点：

- `outputs` 是**相对于包目录**的 glob，如 `dist/**` 指该包的 `dist/` 全部内容；
- 命中缓存时，turbo 会把缓存里的 `dist/` **还原**到包目录，仿佛你刚跑过 build；
- `!` 前缀排除某些东西（如 Next.js 的 `.next/cache/**` 是它自己的缓存，不该被 turbo 再缓存一层）；
- **没有 `outputs` 的任务**（如 `typecheck`、`lint`）：turbo 仍会缓存它的**成功状态和日志**——命中时直接报告「通过」并回放日志，不重新执行。这对 typecheck/lint 这类「只关心成功与否、无产物」的任务非常有用。

> **易错点**：如果 build 产物目录写错了（比如实际产出在 `lib/` 却只声明了 `dist/**`），命中缓存时 `lib/` 不会被还原，下游拿到的是空目录 → 构建/运行失败。**`outputs` 必须真实覆盖所有产物路径。**

---

## 9.5 `inputs`：收窄「什么变化才算变化」

默认，`inputs` 是「该包所有被 git 跟踪的文件」。这意味着**改包里的任何文件都会让任务失效**——包括改 `README.md`、改注释。这有时太激进了。

`inputs` 让你**收窄**触发范围：

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tsconfig.json", "vite.config.ts", "package.json"],
      "outputs": ["dist/**"]
    }
  }
}
```

现在只有 `src/`、几个配置文件变化才会让 build 失效；改 `README.md` 不会。这能提升命中率、减少无谓重建。

`inputs` 的特殊值：

```json
{
  "tasks": {
    "lint": {
      "inputs": ["src/**", ".eslintrc*", "eslint.config.js"]
    },
    "typecheck": {
      "inputs": [] // 空数组：不依赖任何文件（极少用，谨慎）
    }
  }
}
```

> **权衡**：`inputs` 收窄能提升命中率，但**收窄错了会漏掉真实变化**——比如你 `inputs` 只写了 `src/**`，但 build 其实还依赖 `public/` 里的资源，改了 `public/` 却不重跑，就会得到过期产物。**默认（全部 git 跟踪文件）是最安全的**；只有当你确认某些文件绝不影响任务时，才用 `inputs` 排除。宁可偶尔重跑，不可悄悄用错缓存。

---

## 9.6 `cache: false`：关闭缓存

有些任务**不该被缓存**：

```json
{
  "tasks": {
    "dev": {
      "cache": false,
      "persistent": true
    },
    "db:migrate": {
      "cache": false // 迁移必须真的执行，不能「缓存命中就跳过」！
    },
    "lint:fix": {
      "cache": false // 会修改源文件，缓存语义不成立
    }
  }
}
```

**哪些任务该关缓存**：

- **persistent 任务**（dev/watch）：turbo 强制要求 `cache: false`；
- **有副作用、改变外部状态的任务**：数据库迁移 `db:migrate`、部署、种子数据——「缓存命中就跳过」会导致迁移根本没跑，后果严重；
- **修改源文件的任务**：`lint:fix`、格式化、codegen 写回源码（若产物纳入 git 且要每次校验，也可考虑关缓存或改造成有明确 outputs 的可缓存任务）。

> **血泪教训**：**数据库迁移任务绝对不能缓存。** 想象一下：CI 里 `db:migrate` 第二次命中缓存被跳过，新迁移没应用，测试全在旧 schema 上跑，绿得发慌，上线即炸。凡是「改变仓库之外世界状态」的任务，一律 `cache: false`。

---

## 9.7 练习 4：亲手制造命中与失效

这是路线图练习 4 的核心——「人为改动某个 package，观察缓存命中/失效，解释输入文件与环境变量的影响」。按顺序做，每步都观察输出。

### 实验 0：建立基线

```bash
turbo run build
# 第一次：全部 cache miss，Cached: 0 cached, 5 total

turbo run build
# 第二次：什么都没改
# 期望：全部 cache hit，Cached: 5 cached, 5 total，瞬间完成
```

第二次应看到类似：

```
@workboard/shared:build: cache hit, replaying logs 1a2b3c...
@workboard/web:build: cache hit, replaying logs ...
 Tasks:    5 successful, 5 total
Cached:    5 cached, 5 total     ← 全命中
    Time:    120ms >>> Full TURBO
```

`Full TURBO` 表示「整个运行全部命中缓存，一个真跑的都没有」。

### 实验 1：改一个叶子包的源码，观察连锁失效

```bash
# 改 packages/shared 的一个源文件（加一行注释即可）
echo "// touched" >> packages/shared/src/index.ts

turbo run build
```

**观察并解释**：

- `@workboard/shared#build` → **cache miss**（它的 inputs 变了）；
- `@workboard/api-client`、`@workboard/web`、`@workboard/db`、`@workboard/api` → **cache miss**（它们依赖 shared，shared 的产物 hash 变了，见 9.3）；
- 也就是说，改最底层的 `shared`，几乎所有下游都失效了。

### 实验 2：改一个叶子应用，观察「只失效自己」

```bash
# 先把上一步的改动还原（git checkout packages/shared/src/index.ts），重新 build 建立基线
git checkout packages/shared/src/index.ts
turbo run build   # 全命中

# 现在只改 apps/web 的一个源文件
echo "// web touched" >> apps/web/src/main.tsx   # 或该包任意源文件

turbo run build
```

**观察并解释**：

- `@workboard/web#build` → **cache miss**；
- 其余包（shared、api-client、db、api）→ **cache hit**（它们不依赖 web，web 的变化不影响它们）。
- 这就是「改一个叶子，不必全量重建」——**目标 B 的直接证据**。

### 实验 3：用 `inputs` 收窄，让「改 README 不触发 build」

```bash
# 给 build 任务加上 9.5 的 inputs（只含 src 和配置），重新建立基线后：
echo "# note" >> apps/web/README.md

turbo run build
# 期望：web#build 仍 cache hit（因为 README 不在 inputs 里）

# 再改一个真正在 inputs 里的文件：
echo "// real change" >> apps/web/src/App.tsx
turbo run build
# 期望：web#build cache miss
```

**解释**：`inputs` 决定了「哪些文件变化才算数」。README 不影响 build 产物，所以被排除后不再触发失效。

### 实验 4：用 `--force` 无视缓存

```bash
turbo run build --force
# 强制全部重跑，即使有缓存。用于怀疑缓存脏了的时候。
```

### 实验 5：用 `--dry=json` 直接看 hash 输入

```bash
turbo run build --filter=@workboard/web --dry=json
```

输出里会列出该任务的 `hash`、`inputs`（文件清单）、`env`、`dependencies` 等。**这是理解「为什么命中/失效」的终极工具**——不用猜，直接看 turbo 认为哪些东西构成了 hash。改一个文件前后各跑一次 `--dry=json`，对比 `hash` 变化，就明白是什么触发了失效。

### 实验 6：观察日志回放（`--output-logs`）

```bash
turbo run build --output-logs=full    # 命中时也完整回放缓存的日志
turbo run build --output-logs=errors-only   # 只在出错时显示日志
```

命中缓存时，turbo 默认可能只显示 `cache hit`；`--output-logs=full` 会把上次执行的日志原样打出来，让你确认「和真跑一样」。

### 把实验结论写下来

练习 4 要求「解释输入文件与环境变量的影响」。你的结论应覆盖：

1. **改叶子应用** → 只失效自己，无关包命中（实验 2）；
2. **改底层共享包** → 所有下游连锁失效（实验 1）；
3. **`inputs` 收窄** → 无关文件（README）不再触发失效（实验 3）；
4. **环境变量** → 见第 10 章（改了影响 hash 的 env 会失效，改了 passthrough 的不会）；
5. **`--force`** 无视缓存，**`--dry=json`** 可审查 hash 输入。

---

## 9.8 缓存与正确性：一条必须守住的底线

再强调一次，因为这是最危险的误区：

> **缓存命中 ≠ 代码正确。** 缓存只回答「输入是否和上次一样」，不回答「结果对不对」。

因此：

- **不要用缓存替代测试**。测试任务本身可以有 outputs（覆盖率报告），但「测试通过」这个结论来自真实执行；
- **改变外部状态的任务必须 `cache: false`**（迁移、部署）；
- **怀疑缓存脏了**（比如升级了工具链、改了全局配置）用 `--force` 或清空 `.turbo/cache`；
- **CI 里不能靠缓存保正确性**——缓存是加速器，不是护栏。第 12 章会讲 CI 缓存的安全边界。

---

## 9.9 常见坑

| 现象                           | 原因                                      | 解决                                                |
| ------------------------------ | ----------------------------------------- | --------------------------------------------------- |
| 第二次跑还是全 miss            | 每次 hash 都变（如 inputs 含时间戳/随机） | `--dry=json` 对比两次 hash 的 inputs 差异，找出变量 |
| 命中缓存后下游报「找不到产物」 | `outputs` 没覆盖真实产物目录              | 补全 `outputs` glob                                 |
| 改 README 也触发全量重建       | 默认 inputs 含所有 git 文件               | 用 `inputs` 收窄到 `src/**` + 必要配置              |
| 迁移任务「跑了」但数据库没变   | `db:migrate` 被缓存跳过了                 | 副作用任务一律 `cache: false`                       |
| 清了缓存还是命中               | 命中了**远程缓存**（第 12 章）            | `--no-cache` 或断开远程缓存；确认缓存来源           |
| 缓存目录被提交进了 git         | `.gitignore` 漏了 `.turbo/`               | gitignore 加 `.turbo/`（第 2 章已含）               |
| 升级 turbo 后缓存全失效        | 工具链版本进 hash                         | 正常现象；重建一次即可                              |

---

## 9.10 本章验收清单

- [ ] 能一句话说清缓存承诺（相同输入不重复计算）及其边界（不保证正确性）；
- [ ] 知道本地缓存在 `.turbo/cache`、必须 gitignore、团队共享需远程缓存；
- [ ] 能列出 hash 的主要输入（inputs、上游产物、env、任务配置、lockfile、全局依赖、工具链版本），并解释「改底层包为何连锁失效、改叶子为何只失效自己」；
- [ ] 会正确声明 `outputs`（含 `!` 排除），理解无 outputs 任务也会缓存成功状态与日志；
- [ ] 理解 `inputs` 收窄的收益与风险，默认全量最安全；
- [ ] 知道哪些任务必须 `cache: false`（persistent、迁移、部署、改源文件）；
- [ ] **完成练习 4**：用实验 0~6 亲手制造并解释命中/失效，会用 `--force`、`--dry=json`、`--output-logs`。

---

上一章：[← 第 8 章：Turborepo 入门：任务图](./08-turborepo-task-graph.md) ｜ 下一章：[第 10 章：环境变量建模 →](./10-env-vars.md)
