# 第 10 章：Compose 编排全栈——一条命令起停整个环境

> 本章目标：把第 7 章的手动组网升级为声明式编排——完整 compose.yaml（db + api + web）、`depends_on` 的就绪语义、healthcheck、网络/volume/环境变量插值；掌握 up/down/logs/ps 日常操作与「从干净环境重建」的验证。
>
> 对应核心概念：**④ Compose 的服务依赖、健康检查、网络、volume、环境变量；⑦ 启动顺序与 ready≠started。** 对应练习：**练习 3。**

---

## 10.1 为什么需要 Compose

第 7 章手动组网要敲三条长命令，还要记住网络名、容器名、环境变量。Compose 把这些声明进一份 `compose.yaml`（进 Git）：

- **服务即容器**：每个 service 声明镜像/构建方式、端口、环境、卷、依赖；
- **自动组网**：Compose 为项目创建专属 bridge 网络，**服务名即 DNS 名**（第 7 章的机制自动生效）；
- **依赖编排**：按 `depends_on` 决定创建/启动/停止顺序；
- **变量插值**：`${VAR:-default}` 从 shell 环境或项目根 `.env` 读取。

## 10.2 完整 compose.yaml

与示例工程一致（逐段解释见后）：

```yaml
services:
  db:
    image: postgres:18
    environment:
      POSTGRES_USER: workboard
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-workboard_dev}
      POSTGRES_DB: workboard
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql
      - ./initdb:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s

  api:
    build:
      context: .
      dockerfile: docker/api.Dockerfile
    environment:
      NODE_ENV: production
      PORT: "3000"
      DATABASE_URL: postgres://workboard:${POSTGRES_PASSWORD:-workboard_dev}@db:5432/workboard
    ports:
      - "3000:3000"
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 15s

  web:
    build:
      context: .
      dockerfile: docker/web.Dockerfile
    ports:
      - "8080:80"
    depends_on:
      api:
        condition: service_healthy

volumes:
  pgdata:
```

## 10.3 就绪依赖：depends_on 的两种形态

```yaml
depends_on: [db]                          # 短形式：只保证 db 先「启动」
depends_on:
  db:
    condition: service_healthy            # 长形式：等 db「健康」才启动 api
```

**短形式是第 1 章那个 crash 循环的根源**：postgres 容器 started 后还要初始化几秒，API 立刻连接就 `ECONNREFUSED`。长形式 + healthcheck 才表达「数据库 ready」：

- `service_started`：容器启动即可（默认）；
- `service_healthy`：healthcheck 通过才算就绪；
- `service_completed_successfully`：一次性任务（如迁移 job）成功退出后才继续。

配套细节：`pg_isready` 是 postgres 镜像自带的探测工具；`$${POSTGRES_USER}` 的双 `$` 是 Compose 转义——让变量在**容器内**展开而不是被 Compose 插值。

## 10.4 网络、卷、环境变量的自动装配

- **网络**：无需声明，Compose 创建 `example_default` 网络，三个服务都在其中；`DATABASE_URL` 的 `db`、nginx 的 `proxy_pass http://api:3000` 都靠服务名 DNS；
- **卷**：顶层 `volumes: pgdata:` 声明命名卷，实际名是 `example_pgdata`（项目前缀防冲突）；
- **环境变量**：`${POSTGRES_PASSWORD:-workboard_dev}` 先读 shell 环境，再读项目根 `.env`，都没有用默认值。**`.env` 不入库**（第 8 章），`.env.example` 入库当模板。

## 10.5 日常操作与重建验证

```bash
cp .env.example .env
docker compose up --build -d     # 构建 + 后台启动（按依赖顺序）
docker compose ps                # 三个服务都应是 Up (healthy)
docker compose logs -f api       # 跟踪日志
docker compose exec db psql -U workboard -d workboard -c 'SELECT * FROM tasks;'

# 练习 3 的验证：API 在容器内连的是正确的数据库
curl http://localhost:3000/health/ready          # {"status":"ready"}
curl -X POST http://localhost:3000/api/tasks -H 'content-type: application/json' -d '{"title":"来自 compose"}'
docker compose exec db psql -U workboard -d workboard -c "SELECT title FROM tasks ORDER BY created_at DESC LIMIT 1;"
# 能看到「来自 compose」→ 写进了 db 容器的库

docker compose down              # 停止并删除容器/网络（卷保留）
docker compose down -v           # 连卷一起删 → 下次 up 是全新数据库（initdb 重跑）
```

**可复现性验收**：`docker compose down -v && docker compose up --build -d` 后，schema + 种子数据自动重建，API ready，前端可用——这就是「别人能从仓库按说明重建环境」的直接证据。

## 10.6 常见坑

| 现象                                 | 原因                           | 解决                                          |
| ------------------------------------ | ------------------------------ | --------------------------------------------- |
| api 启动即 ECONNREFUSED              | depends_on 短形式，db 未 ready | `condition: service_healthy` + db healthcheck |
| `variable is not set` 警告           | .env 没建且无默认值            | cp .env.example .env；或写 `:-default`        |
| healthcheck 里 `$POSTGRES_USER` 是空 | 被 Compose 插值吃掉了          | 写 `$${POSTGRES_USER}` 让容器内展开           |
| 改了代码但 up 后还是旧行为           | 没加 --build，用了旧镜像       | `up --build`；或 `docker compose build api`   |
| 改了 initdb SQL 不生效               | 卷已有数据                     | `down -v` 重建（仅本地）                      |
| 端口冲突                             | 宿主 5432/3000/8080 被占       | 改 ports 左边宿主端口                         |

## 10.7 本章验收清单

- [ ] 完成练习 3：`docker compose up --build -d` 一键起全栈，三个服务 healthy；
- [ ] 能解释 `service_started` / `service_healthy` / `service_completed_successfully` 的区别；
- [ ] 验证 API 容器内写入的数据出现在 db 容器的库里；
- [ ] `down -v` 后重建，环境从仓库内容完整恢复；
- [ ] 能解释 `$${VAR}` 转义与 `.env` 插值链。

---

上一章：[← 第 9 章：信号、健康检查与优雅关闭](./09-signals-health-graceful.md) ｜ 下一章：[第 11 章：前端静态发布与 Supabase 本地栈 →](./11-web-static-and-supabase.md) ｜ 返回：[教程目录 README](./README.md)
