# 第 6 章：多阶段构建与生产镜像——只带运行需要的东西

> 本章目标：用多阶段构建把「构建环境」与「运行环境」分离；用 `pnpm deploy --prod` 裁出纯生产依赖；以非 root 运行；对比镜像体积；并在**没有 Docker 的机器上**验证部署产物的正确性。
>
> 对应核心概念：**② 多阶段构建与生产镜像缩小；③ 非 root 用户、最小运行时依赖。** 对应练习：**练习 1（完成）。**

---

## 6.1 单阶段的浪费

naive 版镜像里有什么？源码、TypeScript、vitest、tsx、全部 devDependencies、pnpm 缓存……而运行只需要：**Node 运行时 + 生产依赖 + 编译产物**。其余都是体积与攻击面。

多阶段构建（multi-stage）的思路：一个 Dockerfile 里写多个 `FROM`，每个是一个独立阶段；**最终镜像只 COPY 前面阶段的产物**，构建工具链全部留在前面的阶段里，不进最终镜像。

## 6.2 pnpm deploy：裁出纯生产依赖

pnpm 为 monorepo 提供了专门的部署命令：

```bash
pnpm --filter @workboard/api deploy --prod /prod/api
```

它把 `@workboard/api` 连同**解析后的生产依赖**复制到 `/prod/api`：

- 只有 `dependencies`（fastify、pg），没有 devDependencies；
- 是**独立、无 workspace 符号链接**的 node_modules——可以直接拷进任何镜像运行；
- 有 workspace 内部依赖时会一并注入（本例 api 无内部依赖；若有，pnpm 12 需配合 `injectWorkspacePackages`）。

> **与 `turbo prune` 的对比**（阶段 14 第 12 章预告过）：`turbo prune @workboard/api --docker` 裁出的是「目标包 + 依赖包的**源码** + 精简 lockfile」，之后仍要在镜像里 install + build；`pnpm deploy` 裁出的是「**可直接运行的产物**」。两者可组合：prune 负责缩小构建上下文，deploy 负责产出运行目录。本教程用 deploy，因为它一步到位且不需要 turbo。

## 6.3 完整的生产 Dockerfile

`docker/api.Dockerfile`（与示例工程一致）：

```dockerfile
# syntax=docker/dockerfile:1

# ---------- base：锁定 Node 大版本，启用 corepack ----------
FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

# ---------- deps：锁文件优先，依赖层独立于源码层 ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

# ---------- build：编译 TS，并裁出「只含生产依赖」的部署目录 ----------
FROM base AS build
COPY --from=deps /app ./
COPY . .
RUN pnpm --filter @workboard/api build \
  && pnpm --filter @workboard/api deploy --prod /prod/api

# ---------- runtime：只带运行需要的文件 ----------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/api/node_modules ./node_modules
COPY --from=build /prod/api/package.json ./package.json
COPY --from=build /app/apps/api/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

逐点解释：

1. **四个阶段**：base（共享底座）→ deps（依赖层，第 5 章的缓存设计）→ build（编译 + 裁剪）→ runtime（最终镜像）。BuildKit 只构建目标阶段依赖的阶段；
2. **runtime 只有三样**：生产 node_modules、package.json（`node` 解析 ESM 需要它声明 `"type": "module"`）、dist。源码、tsconfig、测试、构建工具都不在；
3. **`USER node`**：node 官方镜像自带 uid=1000 的 `node` 用户。非 root 意味着：即使应用被攻破，容器内也不是 root，逃逸难度大增。**这是路线图的安全红线项**；
4. **`ENV NODE_ENV=production`**：这是非秘密的运行模式声明，可以烘焙；数据库密码等秘密绝不这样写（第 8 章）；
5. **`CMD ["node", "dist/server.js"]`**：exec 形式，node 直接做 PID 1（第 9 章）。

## 6.4 构建与体积对比

```bash
docker build -f docker/api.Dockerfile -t workboard-api:local .
docker images | grep workboard-api
# workboard-api   local    ...   ~200MB 级（node slim + 生产依赖 + dist）
# workboard-api   naive    ...   明显更大（源码 + 全部 devDependencies）
```

进一步缩小可选 `node:24-alpine`（musl libc，更小），但要注意原生模块兼容性；本教程用 `bookworm-slim`（glibc，兼容性最稳）。**先正确，再小**。

## 6.5 没有 Docker 也能验证：宿主机演练

多阶段构建的核心逻辑（deploy 裁剪 + 产物可运行）**不依赖 Docker**，在宿主机就能验证——本教程编写时就是这样验证的：

```bash
pnpm --filter @workboard/api build
pnpm --filter @workboard/api deploy --prod /tmp/workboard-prod-api

# 检查裁剪结果：node_modules 里只有 fastify、pg 及其传递依赖
ls /tmp/workboard-prod-api/node_modules

# 直接运行部署产物（指向一个不可达的数据库，验证失败路径）
cd /tmp/workboard-prod-api
NODE_ENV=production PORT=3100 \
  DATABASE_URL=postgres://workboard:workboard_dev@127.0.0.1:59999/workboard \
  node dist/server.js &

curl http://127.0.0.1:3100/health/live    # {"status":"ok"}        ← 进程活着
curl http://127.0.0.1:3100/health/ready   # {"status":"unavailable"} 503 ← 数据库不可达
curl -X POST http://127.0.0.1:3100/api/tasks \
  -H 'content-type: application/json' -d '{"title":"冒烟"}'
# {"error":{"code":"INTERNAL_ERROR","message":"服务器内部错误","requestId":"req-1"}} 500

kill -TERM %1   # 日志出现 "shutting down gracefully"，进程干净退出
```

这组实验同时验证了：裁剪正确、env 注入生效、liveness/readiness 分工、错误 envelope 不泄漏内部细节、SIGTERM 优雅关闭。**Docker 只是把这套已验证的产物装进隔离环境**。

## 6.6 常见坑

| 现象                          | 原因                                          | 解决                                                      |
| ----------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| 运行时报 `Cannot find module` | runtime 阶段漏拷 node_modules 或 package.json | 三样都拷（6.3）；ESM 需要 package.json 的 type 字段       |
| 镜像里仍有源码/测试           | 从 build 阶段拷了整个目录                     | 只拷 /prod/api 的 node_modules + dist                     |
| `EACCES` 写文件失败           | USER node 后目录属主是 root                   | 需要写的目录 `COPY --chown=node:node` 或挂 volume         |
| deploy 后 workspace 依赖丢失  | pnpm 12 对 workspace 依赖需 inject            | 无内部依赖时不涉及；有时配 `injectWorkspacePackages=true` |
| alpine 镜像原生模块报错       | musl vs glibc                                 | 换 bookworm-slim，或确认依赖提供 musl 预编译              |

## 6.7 本章验收清单

- [ ] 能解释多阶段构建「构建环境 ≠ 运行环境」的分离思想；
- [ ] 完成练习 1：api 的多阶段 Dockerfile 构建成功，`docker images` 对比体积明显小于 naive 版；
- [ ] `docker image inspect workboard-api:local --format '{{.Config.User}}'` 输出 `node`；
- [ ] 完成 6.5 宿主机演练，五个观察点全部符合预期；
- [ ] 能说出 `pnpm deploy` 与 `turbo prune` 的分工差异。

---

上一章：[← 第 5 章：构建缓存与锁文件](./05-build-cache-and-lockfile.md) ｜ 下一章：[第 7 章：网络、端口与数据卷 →](./07-networks-ports-volumes.md) ｜ 返回：[教程目录 README](./README.md)
