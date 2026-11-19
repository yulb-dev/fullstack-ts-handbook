# 第 8 章：配置与秘密——运行时注入，绝不烘焙

> 本章目标：分清 ENV / ARG / 运行时注入三种配置的可见期；建立「秘密不进镜像层、不进构建参数、不进仓库」的红线；用 `docker history` / `inspect` / 文件系统检查完成镜像秘密审计（练习 4）。
>
> 对应核心概念：**⑤ 配置与秘密：运行时注入。** 对应练习：**练习 4。**

---

## 8.1 三种配置的可见期

| 方式                                      | 何时存在                   | 谁能看到                                   | 能放秘密吗                   |
| ----------------------------------------- | -------------------------- | ------------------------------------------ | ---------------------------- |
| `ENV K=V`（Dockerfile）                   | 构建时烘焙，运行时默认继承 | **任何能拉到镜像的人**（`inspect` 直接读） | **绝不**                     |
| `ARG`（构建参数）                         | 仅构建期                   | `docker history` 能看到构建命令与参数值    | **绝不**                     |
| `-e` / `env_file` / Compose `environment` | 运行时注入                 | 容器内进程；宿主上有 Docker 权限的人       | 可以（本地）；生产用秘密管理 |

两条推论：

1. **`ENV DATABASE_URL=postgres://user:pass@...` 写进 Dockerfile = 把密码发给所有能拉镜像的人**。即使后面再 `ENV DATABASE_URL=` 覆盖，旧层的值仍在 `docker history` 里；
2. **`ARG DB_PASSWORD` + `--build-arg` 也不安全**：构建参数会留在镜像历史里。BuildKit 的 `--mount=type=secret` 才是构建期用秘密的正确方式（8.4）。

## 8.2 本项目的配置注入链

```
.env.example（入库，只是模板/本地开发口令）
   │  cp
   ▼
.env（不入库：.gitignore + .dockerignore 双重排除）
   │  docker compose 自动读取（变量插值）
   ▼
compose.yaml: environment: DATABASE_URL=postgres://workboard:${POSTGRES_PASSWORD}@db:5432/workboard
   │  运行时注入容器
   ▼
apps/api/src/env.ts: 启动即校验，缺失/非法立即失败
```

`env.ts` 的关键设计（完整代码见示例工程）：

```ts
export function readEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("缺少必需环境变量 DATABASE_URL（示例: postgres://...）");
  }
  // ... PORT / NODE_ENV 校验
}
```

**启动即失败**（fail fast）：配置错误在进程启动的第一秒暴露，而不是等到线上第一个请求。这是阶段 6（Node 工程基础）的通过标准，在容器场景同样成立。

## 8.3 镜像秘密审计（练习 4）

示例工程提供 `scripts/audit-image.sh`，对 `workboard-api:local` 做五项检查：

```bash
docker build -f docker/api.Dockerfile -t workboard-api:local .
pnpm audit:image        # = bash scripts/audit-image.sh workboard-api:local
```

五项检查与原理：

```bash
# 1. 构建历史：每层做了什么。重点看 COPY/ENV/ARG 有没有带进秘密
docker history --no-trunc workboard-api:local

# 2. 镜像元数据的环境变量：ENV 烘焙的值在这里现形
docker image inspect workboard-api:local --format '{{json .Config.Env}}'
# 期望只有 PATH、NODE_ENV=production 等非秘密项

# 3. 文件系统搜秘密文件
docker run --rm --entrypoint sh workboard-api:local -c \
  'find /app -maxdepth 4 \( -name ".env*" -o -name "*.pem" -o -name "*.key" \) -print'
# 期望无输出

# 4. 运行用户应为非 root
docker image inspect workboard-api:local --format '{{.Config.User}}'   # node

# 5. 历史中搜疑似秘密赋值
docker history --no-trunc workboard-api:local | grep -iE '(PASSWORD|SECRET|TOKEN|API_KEY)='
# 期望无匹配
```

**故意制造一次泄露来验证审计有效**（错误实验）：

```bash
# 临时把 .dockerignore 里的 .env 行删掉，并 echo 一个假密码进 .env
echo 'DATABASE_URL=postgres://workboard:FAKE_SECRET_123@db:5432/workboard' > .env
# （去掉 .dockerignore 的 .env 排除后）重建 naive 版镜像
docker build -f docker/api.naive.Dockerfile -t workboard-api:leak .
docker run --rm --entrypoint sh workboard-api:leak -c 'cat /app/.env'
# FAKE_SECRET_123 现形 → 审计第 3 项能抓住它
# 实验后恢复 .dockerignore、删除 .env 与 leak 镜像
```

> 真实事故中泄露的是真密码：**一旦烘焙进镜像并推送，唯一正确的处置是轮换秘密**（改密码），删镜像/删层都来不及——可能已被拉取。审计的意义是让这件事 never happen。

## 8.4 进阶：构建期确实需要秘密怎么办

个别场景（如构建时拉私有 npm 包）需要构建期秘密。正确方式是 BuildKit 的 secret mount——**秘密只在该 RUN 指令期间可见，不进任何层**：

```dockerfile
# syntax=docker/dockerfile:1
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
  pnpm install --frozen-lockfile
```

```bash
docker build --secret id=npmrc,src=$HOME/.npmrc -f docker/api.Dockerfile -t workboard-api:local .
```

本教程的依赖全部公开，用不到它；知道有这条合法路径即可，**不要用 ARG 凑合**。

## 8.5 生产环境的秘密从哪来

本地用 `.env` 足够；生产按平台选择：Docker/K8s Secrets、云厂商 Secret Manager、CI 的 Secrets/Environment（阶段 16）。共同原则：**秘密在运行时才到达进程，镜像与仓库永远不含秘密**。本教程的 compose 用 `${POSTGRES_PASSWORD:-workboard_dev}` 插值，生产部署时由平台注入真实值，同一份 compose 文件无需修改。

## 8.6 常见坑

| 现象                                      | 原因                     | 解决                                                 |
| ----------------------------------------- | ------------------------ | ---------------------------------------------------- |
| `inspect` 的 Env 里有数据库密码           | Dockerfile 写了 ENV 秘密 | 删 ENV，改运行时注入；**轮换已泄露密码**             |
| `history` 里有 `--build-arg PASSWORD=...` | 用 ARG 传秘密            | 改 `--mount=type=secret`；轮换密码                   |
| 镜像里有 .env                             | .dockerignore 没排除     | 排除 + 审计第 3 项                                   |
| 容器启动报「缺少 DATABASE_URL」           | 运行时没注入             | 这正是 fail-fast 设计：检查 `-e`/compose environment |
| 以为删了层就删了秘密                      | 层不可变，历史仍在       | 秘密一旦进镜像即视为泄露，轮换                       |

## 8.7 本章验收清单

- [ ] 能说出 ENV / ARG / 运行时注入的可见期差异；
- [ ] 完成练习 4：`pnpm audit:image` 五项检查全部通过；
- [ ] 完成「故意泄露」错误实验，理解为什么审计第 3 项能抓住它；
- [ ] 能解释「秘密进镜像 = 已泄露，必须轮换」；
- [ ] 知道构建期秘密的合法路径是 `--mount=type=secret`。

---

上一章：[← 第 7 章：网络、端口与数据卷](./07-networks-ports-volumes.md) ｜ 下一章：[第 9 章：信号、健康检查与优雅关闭 →](./09-signals-health-graceful.md) ｜ 返回：[教程目录 README](./README.md)
