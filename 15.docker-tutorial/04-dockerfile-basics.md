# 第 4 章：Dockerfile 基础——第一个 API 镜像

> 本章目标：掌握 Dockerfile 核心指令与构建上下文；为 Workboard API 写出第一个能跑的镜像（故意保留「 naive 版」的问题，第 5、6 章逐层优化）；理解 `.dockerignore` 为什么是第一道安全防线。
>
> 关键概念：entrypoint/cmd、Dockerfile 与 .dockerignore。｜ 动手练习：练习 1（起步）。

---

## 4.1 准备被打包的应用

配套示例 `example/apps/api` 是一个最小 Fastify 服务（完整代码见示例工程，这里给出理解 Dockerfile 所需的全部结构）：

```
apps/api/
├── package.json          # deps: fastify、pg；scripts: build=tsc、start=node dist/server.js
├── tsconfig.json         # outDir: dist
├── src/
│   ├── env.ts            # 启动时校验 PORT / DATABASE_URL / NODE_ENV，缺失即失败
│   ├── db.ts             # pg 连接池工厂
│   ├── app.ts            # buildApp({ db }) 工厂：/health/live、/health/ready、/api/tasks
│   └── server.ts         # 读 env → 建池 → buildApp → listen 0.0.0.0 → SIGTERM 优雅关闭
└── test/app.test.ts      # vitest + inject（不需要真实数据库）
```

两个为容器化做的设计，现在点明、后面反复用到：

1. **配置全部来自环境变量**（`env.ts` 启动即校验）——镜像里没有任何配置，第 8 章展开；
2. **`buildApp` 工厂与 `server.ts` 分离**——测试用 inject（Fastify 提供的「不起端口、直接模拟发请求」的测试方法，阶段 12 详讲）不起端口，生产用 server 起端口，同一份 app。

先在宿主机确认它能构建：

```bash
cd example
pnpm install
pnpm --filter @workboard/api build   # tsc → apps/api/dist/
```

## 4.2 构建上下文与 .dockerignore

`docker build -f docker/api.Dockerfile -t workboard-api:naive .` 的最后那个 `.` 是**构建上下文**：Docker 会把这个目录（递归）打包发给 daemon。**上下文里有什么，COPY 才可能拷什么**；上下文越大，构建越慢，泄密面越大。

所以第一件事不是写 Dockerfile，而是写 `.dockerignore`（放仓库根）：

```text
node_modules
**/node_modules
dist
**/dist
coverage
**/coverage
.git
.github
.env
.env.*
*.log
*.tsbuildinfo
.vite
.turbo
.DS_Store
*.md
docs
```

三条理由，按重要性排序：

1. **安全**：`.env` 一旦进上下文，任何 `COPY . .` 都会把它烘焙进镜像层——即使后续层删掉它，`docker history` 仍能读到（第 8 章审计）。**不进上下文 = 物理上不可能进镜像**；
2. **正确性**：宿主机的 `node_modules` 是 macOS/Windows 的二进制，拷进 Linux 镜像会直接跑坏；必须在镜像内重新安装；
3. **速度**：`node_modules` 几百 MB，每次构建都传输一遍纯属浪费。

> `.dockerignore` 与 `.gitignore` 语法类似但**职责不同**：前者管「进不进构建上下文」，后者管「进不进 Git」。两个都要写，且 `.env` 两边都要排除。

## 4.3 核心指令速览

| 指令                | 作用                               | 本教程用法                    |
| ------------------- | ---------------------------------- | ----------------------------- |
| `FROM image[:tag]`  | 基础镜像，开启一个构建阶段         | `node:24-bookworm-slim`       |
| `WORKDIR /app`      | 设置工作目录（不存在则创建）       | 一律绝对路径，不用 `RUN cd`   |
| `COPY src dest`     | 从上下文/阶段拷文件                | 清单先行、源码后行（第 5 章） |
| `RUN cmd`           | 构建时执行命令，产生新层           | 装依赖、编译                  |
| `ENV K=V`           | 烘焙环境变量进镜像                 | 只放非秘密（`NODE_ENV`）      |
| `ARG NAME`          | 构建参数（仅构建期可见）           | 不放秘密（第 8 章）           |
| `EXPOSE 3000`       | 声明监听端口（纯文档，不发布端口） | 配合 `-p` 才真正映射          |
| `USER node`         | 切换运行用户                       | 非 root（第 6 章）            |
| `CMD ["node", ...]` | 默认启动命令（exec 形式）          | PID 1 信号（第 9 章）         |
| `HEALTHCHECK`       | 容器内健康探测                     | 第 9 章                       |

## 4.4 naive 版 Dockerfile：能跑，但别上生产

`docker/api.naive.Dockerfile`（教学对照用，示例工程不含此文件，你可以自己创建体验）：

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workboard/api build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
```

构建并运行（需要本机 Docker；db 用第 2 章的容器）：

```bash
docker build -f docker/api.naive.Dockerfile -t workboard-api:naive .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgres://workboard:workboard_dev@host.docker.internal:5432/workboard \
  workboard-api:naive
curl http://localhost:3000/health/live   # {"status":"ok"}
```

> `host.docker.internal` 是 Docker Desktop 提供的「容器访问宿主」特殊域名（Linux 上需 `--add-host=host.docker.internal:host-gateway`）。第 7 章讲容器网络后会换成更干净的容器间通信。

它「能跑」，但有四个生产级问题，逐章解决：

| 问题                                            | 后果                                         | 解决章节 |
| ----------------------------------------------- | -------------------------------------------- | -------- |
| `COPY . .` 在装依赖之前                         | 改一行源码 → 依赖全部重装                    | 第 5 章  |
| 单阶段：源码、devDependencies、构建工具全进镜像 | 镜像臃肿、攻击面大                           | 第 6 章  |
| 默认 root 运行                                  | 容器逃逸（攻击者从容器突破到宿主）时危害放大 | 第 6 章  |
| 没有 HEALTHCHECK                                | 编排器无法知道真实可用性                     | 第 9 章  |

## 4.5 常见坑

| 现象                                   | 原因                                             | 解决                                        |
| -------------------------------------- | ------------------------------------------------ | ------------------------------------------- |
| 构建时 `sending build context` 几个 GB | 没有 .dockerignore，node_modules/.git 全进上下文 | 写 .dockerignore                            |
| 镜像里能读到 `.env`                    | COPY . . 把它带进去了                            | .dockerignore 排除 + 第 8 章审计            |
| `pnpm: not found`                      | 镜像里没有 pnpm                                  | `corepack enable`（读 packageManager 字段） |
| 容器里跑的是 macOS 编译的二进制        | 宿主机 node_modules 被 COPY 进去                 | .dockerignore 排除 node_modules，镜像内重装 |
| `EXPOSE` 了但宿主访问不到              | EXPOSE 只是声明                                  | `docker run -p 3000:3000` 才发布端口        |

## 4.6 本章验收清单

- [ ] 能解释构建上下文是什么、`.dockerignore` 的三条理由；
- [ ] 写出 naive 版 Dockerfile 并成功构建、运行、curl 通 `/health/live`；
- [ ] 能列出 naive 版的四个生产级问题及对应解决章节；
- [ ] 能区分 `ENV` 与 `ARG` 的可见期（为第 8 章铺垫）。

---

上一章：[← 第 3 章：镜像、容器与层](./03-images-containers-layers.md) ｜ 下一章：[第 5 章：构建缓存与锁文件 →](./05-build-cache-and-lockfile.md) ｜ 返回：[教程目录 README](./README.md)
