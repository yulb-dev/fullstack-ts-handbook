# 第 5 章：构建缓存与锁文件——让改一行代码只重建一层

> 本章目标：理解 Docker 层缓存的命中规则；用「锁文件优先 + 依赖层分离」重写 Dockerfile；亲手做缓存命中/失效实验；理解 `--frozen-lockfile`、`--pull`、`--no-cache` 各自的职责。
>
> 关键概念：锁文件优先、依赖缓存层。｜ 动手练习：练习 1（进行中）。

---

## 5.1 层缓存的命中规则

先说清 **lockfile（锁文件，如 `pnpm-lock.yaml`）**：它记录每个依赖被解析出的**精确版本**，保证任何人、任何机器装出的依赖树完全一致（阶段 14 详讲）。本章的缓存优化就围绕「lockfile 变没变」展开。

Docker 构建时逐条执行指令，每条都先问：**「这条指令和上次一样吗？它依赖的文件变了吗？」**

- `RUN` 指令：比较**命令字符串**。字符串没变 → 命中缓存，直接复用上次结果；
- `COPY`/`ADD`：比较**被拷文件的内容校验和**。任何文件变了 → 该层失效，**且其后所有层全部失效**（缓存是链式的）。

最后一条规则是全部优化的出发点：**把「不常变的」放前面，「天天变的」放后面**。

## 5.2 naive 版为什么慢

```dockerfile
COPY . .                          # 源码天天变 → 这层天天失效
RUN pnpm install --frozen-lockfile # 连锁失效：依赖天天重装（几分钟）
RUN pnpm --filter @workboard/api build
```

改一行 `app.ts` 的注释，都要重装全部依赖。依赖安装是分钟级操作，而它本可以只在 lockfile 变化时才跑。

## 5.3 锁文件优先：依赖层与源码层分离

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

# ---- 依赖层：只拷清单，lockfile 不变就命中 ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

# ---- 源码层：天天变，但只影响编译 ----
FROM base AS build
COPY --from=deps /app ./
COPY . .
RUN pnpm --filter @workboard/api build
```

三个细节：

1. **为什么拷三个 package.json？** pnpm workspace 的 lockfile 记录了**所有**成员包的依赖（importers）。`--frozen-lockfile` 会校验每个成员的清单与 lockfile 一致，缺一个就报错。monorepo 里「只拷目标包的清单」是常见错误。
2. **为什么 `pnpm-workspace.yaml` 也要拷？** 它声明了 workspace 成员与 `allowBuilds`；缺了它 pnpm 不知道这是个 workspace。
3. **为什么先 `corepack enable`？** 它读根 `package.json` 的 `packageManager: pnpm@12.11.2`，激活与本地/CI 完全一致的 pnpm 版本——**包管理器版本也是环境的一部分**。

## 5.4 `--frozen-lockfile`：可复现的护栏

| 命令                             | 行为                                                |
| -------------------------------- | --------------------------------------------------- |
| `pnpm install`                   | 清单与 lockfile 不一致时**更新 lockfile**（开发用） |
| `pnpm install --frozen-lockfile` | 不一致时**直接失败**（CI/镜像构建用）               |

镜像构建必须用 frozen：否则「构建时悄悄解析出新版本」会让镜像内容与仓库声明不一致，可复现性破产。这也是阶段 14、16 反复强调的同一条护栏。

## 5.5 动手实验：观察命中与失效

```bash
# 实验 1：首次构建（全量）
docker build -f docker/api.Dockerfile -t workboard-api:cache .

# 实验 2：什么都不改，再构建 → 全部 CACHED
docker build -f docker/api.Dockerfile -t workboard-api:cache .

# 实验 3：改一行源码 → 只有源码层之后失效，依赖层仍 CACHED
echo "// probe" >> apps/api/src/app.ts
docker build -f docker/api.Dockerfile -t workboard-api:cache .
git checkout apps/api/src/app.ts

# 实验 4：升级一个依赖 → lockfile 变 → 依赖层起全部失效
pnpm --filter @workboard/api add fastify@latest
docker build -f docker/api.Dockerfile -t workboard-api:cache .
git checkout apps/api/package.json pnpm-lock.yaml
```

预期输出里的关键行：

```
=> CACHED [deps 4/4] RUN pnpm install --frozen-lockfile     ← 实验 3：依赖层命中
=> [build 3/3] RUN pnpm --filter @workboard/api build       ← 实验 3：只有这里重跑
```

## 5.6 `--pull` 与 `--no-cache`：什么时候故意不用缓存

缓存是加速器，不是正确性来源（与阶段 14 的 Turborepo 缓存同一条原则）：

- **`docker build --pull`**：强制检查基础镜像是否有更新。`node:24-bookworm-slim` 的 tag 会被官方滚动更新（安全补丁），定期 `--pull` 重建才能拿到补丁；
- **`docker build --no-cache`**：全部层重建。怀疑缓存污染、或要验证「从零可重建」时用；
- 两者可组合：`--pull --no-cache` = 最新基础镜像 + 全量重建。第 12 章把它写进维护节奏。

> **RUN 的缓存只看命令字符串**：`RUN pnpm install` 字符串没变就命中，即使 registry 上包已更新——这正是必须用 lockfile 的原因：版本由 lockfile 钉死，而不是由「构建那天的 registry」决定。

## 5.7 常见坑

| 现象                                | 原因                                     | 解决                                                |
| ----------------------------------- | ---------------------------------------- | --------------------------------------------------- |
| 改源码后依赖仍重装                  | COPY . . 在 install 之前                 | 清单先行（5.3）                                     |
| frozen-lockfile 报 importers 不匹配 | 只拷了部分 workspace 成员的 package.json | 拷齐所有成员清单 + pnpm-workspace.yaml              |
| 构建机和 CI 装出不同版本            | 没用 frozen / 没锁 packageManager        | frozen + corepack                                   |
| 基础镜像的安全补丁一直没拿到        | 从不 --pull，tag 缓存命中                | 定期 --pull 重建（第 12 章）                        |
| `ERR_PNPM_IGNORED_BUILDS`           | pnpm 10+ 默认不跑依赖安装脚本            | pnpm-workspace.yaml 写 `allowBuilds: esbuild: true` |

## 5.8 本章验收清单

- [ ] 能说出 COPY 与 RUN 各自的缓存命中规则，以及「链式失效」；
- [ ] Dockerfile 已改为清单先行，并能解释为什么拷全部成员清单；
- [ ] 完成实验 1~4，能指出每次哪层命中、哪层失效、为什么；
- [ ] 能区分 `--frozen-lockfile` / `--pull` / `--no-cache` 的职责。

---

上一章：[← 第 4 章：Dockerfile 基础](./04-dockerfile-basics.md) ｜ 下一章：[第 6 章：多阶段构建与生产镜像 →](./06-multi-stage-production.md) ｜ 返回：[教程目录 README](./README.md)
