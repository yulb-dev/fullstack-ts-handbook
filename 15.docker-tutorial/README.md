# Docker 与本地可复现环境：从 0 到 1 把全栈应用装进容器

你已经能写 React 前端、Fastify 后端，用 pnpm + Turborepo 把仓库组织得井井有条，测试和契约也都上了 CI。但只要项目离开你的电脑，一类新的问题就会准时出现：

- 新同事 clone 仓库，装依赖、装数据库、配环境变量折腾一下午，最后卡在「我这边 Node 版本不一样」；
- 你本地跑得好好的功能，测试环境报 `ECONNREFUSED 127.0.0.1:5432`——因为数据库根本不在那台机器上；
- 上线前夜发现「开发能跑、生产起不来」：生产镜像把 `tsx watch` 和 devDependencies 一起打了进去，又大又慢还带着源码；
- 有人把 `.env` 里的数据库密码 `COPY` 进了镜像，推到 registry 后**任何能拉到镜像的人都能读出密码**；
- `docker stop` 之后进程被强杀，数据库连接池没释放，在途请求直接断掉；
- Compose 里 API 比数据库先启动， crash 循环，你以为加了 `depends_on` 就万事大吉——其实它只保证「启动顺序」，不保证「数据库已就绪」。

这些问题有一个共同的根源：**应用运行的环境没有被版本化、没有被隔离、没有被审计**。

这份教程带你从零掌握 Docker，把贯穿项目 **Workboard**（多租户任务协作系统，阶段 14 的仓库骨架）的前端静态构建和 Fastify API 打包成**可运行、可审计、可复现**的生产镜像，并用 Compose 把「API + 数据库 + 前端」组成一键启动的本地环境：

```
可复现  →  别人从仓库按说明就能构建和运行，不依赖任何人的本机环境
可审计  →  镜像里没有秘密、非 root 运行、每一层都能解释为什么存在
可运维  →  容器能优雅停止，健康检查反映真实可用性，配置全部运行时注入
```

---

## 学完之后你将能够

1. 说清 **镜像、容器、layer、registry、端口映射、volume、network、entrypoint/cmd** 各自是什么、彼此什么关系；
2. 写出**锁文件优先、依赖缓存层合理**的 Dockerfile：`.dockerignore`、`pnpm install --frozen-lockfile`、源码层与依赖层分离，并能用实验解释缓存为什么命中/失效；
3. 用**多阶段构建 + `pnpm deploy --prod`** 把生产镜像缩到只含运行所需文件，以**非 root** 用户运行；
4. 正确处理**进程信号**：exec 形式的 CMD、PID 1、SIGTERM 优雅关闭（先停 HTTP 再放连接池）；
5. 区分 **liveness 与 readiness**，让 Fastify 监听 `0.0.0.0`，理解容器端口与宿主端口的映射；
6. 用 **Compose** 编排多服务：`depends_on: condition: service_healthy`、healthcheck、网络、volume、环境变量，并说清「容器 started ≠ 数据库 ready」；
7. 守住**配置与秘密红线**：运行时注入，不把密钥写进镜像层、构建参数或仓库；会用 `docker history` / `docker inspect` 审计镜像；
8. 把 **Vite 前端构建为静态文件用 nginx 发布**（不当生产服务器用 dev server），理解 **Supabase 本地栈为什么依赖 Docker runtime**；
9. 建立**镜像扫描、依赖更新与可重建性**的维护习惯，不把开发热更新配置复制进生产镜像。

---

## 版本说明（2026 年 11 月核对）

本教程所有命令与配置都在配套示例工程上验证过（Node/pnpm 侧全量验证；Docker 构建与 Compose 编排需要本机安装 Docker，命令与配置按官方文档核对）。

| 组件           | 版本        | 说明                                                        |
| -------------- | ----------- | ----------------------------------------------------------- |
| Node.js        | 24          | 运行时；镜像用 `node:24-bookworm-slim`                      |
| pnpm           | 12.11.2     | 由根 `package.json` 的 `packageManager` 锁定，corepack 激活 |
| Docker Engine  | 28+         | macOS/Windows 用 Docker Desktop 自带；Linux 装 docker-ce    |
| Docker Compose | v2（插件）  | 命令是 `docker compose`（空格），不是旧的 `docker-compose`  |
| PostgreSQL     | 18          | 官方镜像 `postgres:18`；数据卷挂载点 `/var/lib/postgresql`  |
| nginx          | 1.29-alpine | 前端静态文件服务器 + `/api` 反向代理                        |
| Fastify        | 5           | API 框架（深入见阶段 7 教程）                               |
| Vite           | 8           | 前端构建（深入见阶段 1/2 教程）                             |
| TypeScript     | 5.9         | 与全库口径一致                                              |

> **两个容易踩的版本坑**
>
> 1. **Compose v2 是 Docker CLI 插件**：`docker compose version` 能打印版本才算装好；网上旧教程的 `docker-compose`（带连字符）是已停止维护的 v1。
> 2. **postgres 18 镜像的数据卷挂载点是 `/var/lib/postgresql`**（17 及以前是 `/var/lib/postgresql/data`）。照抄旧教程的挂载路径会导致数据「看起来丢了」。

---

## 适合谁

- 已完成本系列阶段 7（Fastify）与阶段 14（Monorepo）的读者最佳；只写过后端或只写过前端也能跟，用到的框架知识会随文解释；
- 听说过 Docker、可能 `docker run` 过别人的镜像，但没自己写过 Dockerfile，或写了却说不清「为什么这么分层」；
- 被「本地能跑、线上不行」「新人环境搭一天」折磨过，想建立可复现环境的人。

---

## 贯穿项目：Workboard（容器化切片）

Workboard 是多租户任务协作系统（本系列毕业项目骨架）。本教程不写新业务，而是把阶段 14 组织好的仓库**装进容器**。配套 `example/` 是一个最小但完整的全栈切片：

```
example/
├── apps/
│   ├── api/                  # Fastify API：/health/live、/health/ready、/api/tasks
│   │   ├── src/              # env 校验 / pg 连接池 / buildApp 工厂 / 优雅关闭
│   │   └── test/             # vitest + inject（stub 数据库，7 个测试）
│   └── web/                  # React + Vite：任务列表 + 创建表单
├── docker/
│   ├── api.Dockerfile        # 多阶段：deps → build → runtime（非 root）
│   ├── web.Dockerfile        # 多阶段：构建 → nginx 静态托管
│   └── nginx.conf            # SPA fallback + /api 反向代理
├── initdb/01-schema.sql      # postgres 首次启动自动执行的 schema + 种子
├── scripts/audit-image.sh    # 镜像秘密审计（练习 4）
├── compose.yaml              # db + api + web，healthcheck + 就绪依赖
├── .dockerignore             # 构建上下文排除（秘密第一道防线）
├── .env.example              # 本地开发口令示例（真实 .env 不入库）
├── package.json              # packageManager: pnpm@12.11.2
└── pnpm-workspace.yaml       # workspace + allowBuilds
```

---

## 章节目录

| 章节     | 标题                                                              | 你将掌握                                                              | 对应核心概念 |
| -------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- | ------------ |
| 第 1 章  | [Docker 是什么](./01-why-docker.md)                               | Docker/容器/镜像是什么、为什么需要、术语词典                          | 总目标       |
| 第 2 章  | [安装与第一个容器](./02-setup-and-first-container.md)             | Docker Desktop/Engine、run/exec/logs/stop、第一个 postgres 容器       | ①            |
| 第 3 章  | [镜像、容器与层](./03-images-containers-layers.md)                | layer/registry/写时复制、pull/tag/inspect/history、容器生命周期       | ①            |
| 第 4 章  | [Dockerfile 基础](./04-dockerfile-basics.md)                      | FROM/RUN/COPY/CMD/ENTRYPOINT、.dockerignore、第一个 API 镜像          | ① ②          |
| 第 5 章  | [构建缓存与锁文件](./05-build-cache-and-lockfile.md)              | 层缓存、锁文件优先、依赖层分离、命中/失效实验                         | ② · 练习 1   |
| 第 6 章  | [多阶段构建与生产镜像](./06-multi-stage-production.md)            | 多阶段、`pnpm deploy --prod`、非 root、镜像缩小                       | ② ③ · 练习 1 |
| 第 7 章  | [网络、端口与数据卷](./07-networks-ports-volumes.md)              | bridge/DNS、端口映射、volume vs bind mount、持久化实验                | ①            |
| 第 8 章  | [配置与秘密](./08-env-and-secrets.md)                             | ENV/ARG/运行时注入、秘密不进层、history/inspect 审计                  | ⑤ · 练习 4   |
| 第 9 章  | [信号、健康检查与优雅关闭](./09-signals-health-graceful.md)       | PID 1、SIGTERM、HEALTHCHECK、liveness/readiness、0.0.0.0              | ③ ⑥          |
| 第 10 章 | [Compose 编排全栈](./10-compose-full-stack.md)                    | depends_on/healthcheck/网络/volume/env、一键起停                      | ④ · 练习 3   |
| 第 11 章 | [前端静态发布与 Supabase 本地栈](./11-web-static-and-supabase.md) | nginx 托管 Vite 产物、SPA fallback、Supabase 与 Docker、ready≠started | ⑦ · 练习 2   |
| 第 12 章 | [镜像维护与综合验收](./12-capstone-and-acceptance.md)             | 扫描/更新/可重建性、综合演练、逐项验收                                | ⑧ · 全部练习 |

## 学习路线建议

```
第 1 章（心智模型）★ 先想清楚容器到底解决什么
   └─> 第 2 章（装好、跑起来）
         └─> 第 3 章（镜像/容器/层）★ 后面一切的地基
               └─> 第 4 章（写第一个 Dockerfile）
                     └─> 第 5 章（缓存与锁文件）★ 练习 1 起步
                           └─> 第 6 章（多阶段生产镜像）★ 练习 1 完成
                                 └─> 第 7 章（网络/端口/卷）
                                       └─> 第 8 章（配置与秘密）★ 练习 4
                                             └─> 第 9 章（信号与健康检查）
                                                   └─> 第 10 章（Compose）★ 练习 3
                                                         └─> 第 11 章（前端发布）★ 练习 2
                                                               └─> 第 12 章（维护与验收）
```

- 每章都有**可运行的命令与配置**、**常见坑表格**和**本章验收清单**；
- 第 3、5、6、9 章是「生产化」的核心，值得反复读；第 8 章是安全红线，必须全部通过；
- 没有 Docker 环境也能学：第 4~6 章的构建逻辑可以用 `pnpm deploy` 在宿主机上先行验证（第 6 章有专门一节）。

---

## 逐项验收清单（总表）

学完每章回来打勾。第 12 章会给出每一项对应的**证据**（文件、命令或可观察现象）。以下条目直接对应路线图阶段 15 的核心概念清单。

### ① 镜像、容器、layer、registry、端口映射、volume、network、entrypoint/cmd

- [ ] 能用自己的话说清这八个概念及彼此关系；
- [ ] 能解释「镜像是不可变模板、容器是运行实例、层是共享只读片段」；
- [ ] 能区分 ENTRYPOINT 与 CMD 的分工。

### ② Dockerfile：锁文件优先、依赖缓存层、.dockerignore、多阶段构建

- [ ] Dockerfile 先 COPY 清单 + lockfile 再装依赖，最后才 COPY 源码；
- [ ] 有 `.dockerignore`，且 `node_modules`、`.env`、`.git` 都被排除；
- [ ] 用多阶段构建把生产镜像缩到只含运行所需文件。

### ③ 非 root、最小运行时、信号传递、SIGTERM 优雅关闭

- [ ] 生产镜像 `USER node`（非 root）；
- [ ] CMD 用 exec 形式，node 是 PID 1；
- [ ] `docker stop` 时进程先停 HTTP、再放连接池，干净退出。

### ④ Compose：服务依赖、健康检查、网络、volume、环境变量

- [ ] compose.yaml 用 `depends_on: condition: service_healthy` 表达就绪依赖；
- [ ] db 与 api 都有 healthcheck，且探测的是真实可用性；
- [ ] 能解释服务名即容器网络主机名。

### ⑤ 配置与秘密：运行时注入

- [ ] 镜像层、构建参数、仓库里都没有真实密钥；
- [ ] 配置全部通过环境变量在运行时注入；
- [ ] 会用 `docker history` / `docker inspect` / 文件系统检查完成审计（练习 4）。

### ⑥ Fastify 监听 0.0.0.0、端口区别、readiness 与 liveness

- [ ] API 监听 `0.0.0.0`，能解释容器端口与宿主端口；
- [ ] `/health/live` 不查数据库，`/health/ready` 查数据库；
- [ ] 能解释两者分别给谁用、配错会怎样。

### ⑦ Supabase 本地栈依赖 Docker；started ≠ ready

- [ ] 能解释 `supabase start` 为什么需要 Docker runtime；
- [ ] 能解释「容器 started」与「服务 ready」的区别及 Compose 的应对。

### ⑧ 镜像扫描、依赖更新与可重建性

- [ ] 知道定期重建（`--pull`）与镜像扫描（Docker Scout 等）的意义；
- [ ] 生产镜像不含 dev server / 热更新配置；
- [ ] 别人能从仓库按说明重建镜像。

### 必须完成的动手练习

- [ ] 练习 1：为 apps/api 写 production multi-stage Dockerfile，用 pnpm lockfile 安装固定依赖（第 4~6 章）；
- [ ] 练习 2：为 web 生成静态 build 并用 nginx 发布，不把 Vite dev server 当生产服务器（第 11 章）；
- [ ] 练习 3：写 Compose 启动 API 与依赖，带 healthcheck，验证容器内连接正确数据库（第 10 章）；
- [ ] 练习 4：用 docker inspect / 镜像层检查确认无秘密烘焙进镜像（第 8、12 章）。

### 通过标准

- [ ] 别人可以从仓库按说明构建和运行镜像；
- [ ] 容器停止时进程能优雅结束，健康检查反映真正的服务可用性；
- [ ] 生产镜像只包含运行需要的文件、以非 root 运行，并通过环境注入配置。

---

## 如何使用配套示例工程

```bash
cd 15.docker-tutorial/example

# === 不依赖 Docker 的部分（任何装了 Node 24 + pnpm 的机器都能跑）===
pnpm install                  # 一次装齐（单一 lockfile）
pnpm test                     # vitest + inject：7 个测试
pnpm typecheck                # 全仓类型检查
pnpm build                    # api tsc + web vite build

# === 需要 Docker 的部分 ===
cp .env.example .env          # 本地开发口令（真实 .env 不入库）
pnpm compose:up               # docker compose up --build -d：db + api + web
curl http://localhost:3000/health/ready   # {"status":"ready"}
curl http://localhost:8080                # nginx 托管的前端
pnpm compose:logs             # 跟踪 api 日志
pnpm compose:down             # 停止（数据卷保留）

# 练习 4：镜像秘密审计
docker build -f docker/api.Dockerfile -t workboard-api:local .
pnpm audit:image
```

> 示例的 `pnpm dev` 走宿主机开发模式（api 需要 `apps/api/.env` 提供 `DATABASE_URL`，可指向 Compose 起的 db）。生产路径一律走镜像。

---

## 与本系列其他教程的关系

- **阶段 14（Monorepo）** 提供了本教程的仓库骨架：`pnpm-workspace.yaml`、单一 lockfile、包边界。第 6 章的 `pnpm deploy` 与第 14 章预告的 `turbo prune` 是两种裁剪思路，教程会对比。
- **阶段 7（Fastify）** 的 `/health/live`、`/health/ready`、错误 envelope 在这里被赋予运维含义（第 9 章）。
- **阶段 8（Supabase）** 的本地栈 `supabase start` 依赖 Docker runtime，第 11 章解释为什么。
- **阶段 16（GitHub Actions CI/CD）** 会把本教程的镜像构建搬进 CI：PR 门禁 + 镜像构建 + 部署。
- **毕业项目 Workboard（第六部分）** 的 M6 里程碑「Docker、部署」直接以本教程产出为起点。

---

## 官方资源

- Docker Get Started：<https://docs.docker.com/get-started/>
- Docker 构建最佳实践：<https://docs.docker.com/build/building/best-practices/>
- 多阶段构建：<https://docs.docker.com/build/building/multi-stage/>
- Dockerfile 参考：<https://docs.docker.com/reference/dockerfile/>
- Compose 启动顺序控制：<https://docs.docker.com/compose/how-tos/startup-order/>
- Compose 文件参考：<https://docs.docker.com/reference/compose-file/>
- Node.js Docker 最佳实践：<https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md>
- pnpm deploy：<https://pnpm.io/cli/deploy>
- Docker Scout：<https://docs.docker.com/scout/>
