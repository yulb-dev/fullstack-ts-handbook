# Workboard · Docker 示例工程

阶段 15 教程的配套示例：Fastify API + React/Vite 前端 + Postgres，全部容器化。

## 不依赖 Docker 的验证（任何 Node 24 + pnpm 机器）

```bash
pnpm install        # 单一 lockfile
pnpm test           # apps/api：vitest + inject，7 个测试（stub 数据库）
pnpm typecheck      # 全仓 tsc
pnpm build          # api tsc → dist；web vite build → dist

# 多阶段构建的核心逻辑（无需 Docker）：
pnpm --filter @workboard/api deploy --prod /tmp/workboard-prod-api
ls /tmp/workboard-prod-api/node_modules   # 只有 fastify、pg 及传递依赖
```

## 完整容器化（需要 Docker Desktop / Engine + Compose v2）

```bash
cp .env.example .env
docker compose up --build -d
docker compose ps                          # db / api / web 均 Up (healthy)

curl http://localhost:3000/health/live     # {"status":"ok"}
curl http://localhost:3000/health/ready    # {"status":"ready"}
curl http://localhost:8080                 # nginx 托管的前端
curl -X POST http://localhost:8080/api/tasks \
  -H 'content-type: application/json' -d '{"title":"你好容器"}'

docker compose logs -f api
docker compose stop api                    # 观察优雅关闭日志
docker compose down                        # 停止（卷保留）
docker compose down -v                     # 连数据卷一起删（下次 up 全新重建）
```

## 镜像秘密审计（练习 4）

```bash
docker build -f docker/api.Dockerfile -t workboard-api:local .
pnpm audit:image
```

## 宿主机开发模式（可选）

```bash
docker compose up -d db                    # 只起数据库
echo 'DATABASE_URL=postgres://workboard:workboard_dev@localhost:5432/workboard' > apps/api/.env
pnpm dev                                   # api(tsx watch) + web(vite) 并行
```

## 结构

```
apps/api/          Fastify：env 校验 / pg 池 / buildApp 工厂 / 优雅关闭 / inject 测试
apps/web/          React + Vite：任务列表 + 创建表单（dev 代理 /api → :3000）
docker/            api.Dockerfile（多阶段+非 root）、web.Dockerfile（→nginx）、nginx.conf
initdb/            postgres 首次启动自动执行的 schema + 种子
scripts/           audit-image.sh（五项秘密审计）
compose.yaml       db + api + web，healthcheck + service_healthy 就绪依赖
```

详见教程各章：[../README.md](../README.md)。
