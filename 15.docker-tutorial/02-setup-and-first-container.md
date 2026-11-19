# 第 2 章：安装与第一个容器

> 本章目标：装好 Docker 并验证；跑通第一个容器；用 postgres 容器建立「镜像 → 容器 → 端口映射 → 环境变量 → 数据卷」的直觉；掌握日常容器操作命令。
>
> 关键概念：镜像、容器、端口映射、volume、network 的初步手感。

---

## 2.1 安装 Docker

**macOS / Windows**：安装 [Docker Desktop](https://docs.docker.com/get-started/get-docker/)。它包含 Docker Engine、CLI、Compose 插件和一个 Linux VM。个人与小团队免费（大型企业需订阅，以官网条款为准）。

**Linux（Ubuntu 示例）**：按官方文档装 `docker-ce` 与 `docker-compose-plugin`，然后：

```bash
sudo usermod -aG docker $USER   # 免 sudo（重新登录生效）
```

验证安装（三条都要成功）：

```bash
docker version            # Client + Server 都有版本号
docker compose version    # Compose v2 插件，形如 Docker Compose version v2.x
docker run --rm hello-world
```

`hello-world` 的输出里有一句值得读的话：它说明了「客户端 → daemon → 拉镜像 → 创建容器 → 运行 → 输出流回终端」的完整链路。

> **坑**：`docker compose`（空格）是 v2 插件；`docker-compose`（连字符）是已停止维护的 v1。本教程一律用前者。

## 2.2 第一个「有用的」容器：Postgres

本机装 Postgres 要下安装包、建用户、配权限、设开机启动。用容器只要一行：

```bash
docker run -d \
  --name workboard-db \
  -e POSTGRES_USER=workboard \
  -e POSTGRES_PASSWORD=workboard_dev \
  -e POSTGRES_DB=workboard \
  -p 5432:5432 \
  -v workboard-pgdata:/var/lib/postgresql \
  postgres:18
```

逐 flag 拆解（这五个 flag 覆盖本章全部核心概念）：

| flag                                      | 含义                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `-d`                                      | detached：后台运行，终端不被占用                                      |
| `--name workboard-db`                     | 给容器起名，后续命令可以用名字代替 ID                                 |
| `-e KEY=VALUE`                            | **运行时注入环境变量**：postgres 镜像的 entrypoint 用它们初始化数据库 |
| `-p 5432:5432`                            | **端口映射**：宿主 5432 → 容器 5432。左边宿主，右边容器               |
| `-v workboard-pgdata:/var/lib/postgresql` | **命名数据卷**：数据库数据存在卷里，容器删了数据还在                  |

验证数据库真的可用：

```bash
docker ps                                   # STATUS 应为 Up
docker exec -it workboard-db psql -U workboard -d workboard -c 'SELECT version();'
```

`docker exec` 在**运行中的容器里**执行命令——这里用容器自带的 psql 客户端连库。能看到 PostgreSQL 18.x 的版本输出，说明数据库已就绪。

> **注意**：`docker ps` 显示 Up 只代表进程活着。postgres 首次启动要初始化数据目录，需要几秒到几十秒；「容器 started ≠ 数据库 ready」，第 9、10 章用 healthcheck 严格处理这个问题。

## 2.3 日常操作命令速览

```bash
docker ps                     # 运行中的容器
docker ps -a                  # 包括已退出的
docker logs workboard-db      # 看日志（-f 跟踪，--tail 50 只看末尾）
docker exec -it workboard-db bash   # 进容器开个 shell（排查用）
docker stop workboard-db      # 发 SIGTERM，宽限期后 SIGKILL（第 9 章）
docker start workboard-db     # 再次启动（数据还在，因为用了 volume）
docker rm workboard-db        # 删除容器（先 stop；-f 强删）
docker volume ls              # 数据卷列表
docker volume inspect workboard-pgdata
```

做一个**持久化实验**，建立对 volume 的直觉：

```bash
# 1. 写一条数据
docker exec -it workboard-db psql -U workboard -d workboard \
  -c "CREATE TABLE probe(id int); INSERT INTO probe VALUES (42);"

# 2. 删除容器（数据卷不动）
docker stop workboard-db && docker rm workboard-db

# 3. 用同一个卷重新起容器
docker run -d --name workboard-db \
  -e POSTGRES_USER=workboard -e POSTGRES_PASSWORD=workboard_dev -e POSTGRES_DB=workboard \
  -p 5432:5432 -v workboard-pgdata:/var/lib/postgresql postgres:18

# 4. 数据还在
docker exec -it workboard-db psql -U workboard -d workboard -c 'SELECT * FROM probe;'
#  id
# ----
#  42
```

**容器是 ephemeral（用完即毁）的，数据属于卷。** 这是十二要素应用（12-Factor）的进程观：容器可以随时被销毁重建，状态外置。

## 2.4 清理

```bash
docker stop workboard-db && docker rm workboard-db
docker volume rm workboard-pgdata    # 连数据一起删（实验环境才这么做）
```

## 2.5 常见坑

| 现象                                                     | 原因                                    | 解决                                                  |
| -------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| `Cannot connect to the Docker daemon`                    | Docker Desktop 没启动 / Linux 服务没起  | 启动 Desktop；Linux `sudo systemctl start docker`     |
| `port is already allocated`                              | 宿主 5432 被本机 Postgres 占用          | 停掉本机服务，或映射 `-p 5433:5432`                   |
| 容器 Up 但 psql 连不上                                   | 首次初始化未完成（started ≠ ready）     | 等几秒；`docker logs` 看到 `database system is ready` |
| 删容器后数据没了                                         | 没挂 volume，数据写在容器可写层         | 用 `-v 命名卷:/var/lib/postgresql`                    |
| postgres 18 挂 `/var/lib/postgresql/data` 后「数据丢了」 | 18 镜像挂载点改为 `/var/lib/postgresql` | 按本教程挂 `/var/lib/postgresql`                      |
| `docker-compose: command not found`                      | 用了 v1 的命令名                        | 用 `docker compose`（v2 插件）                        |

## 2.6 本章验收清单

- [ ] `docker version` / `docker compose version` / `hello-world` 三条验证全部通过；
- [ ] 用一行 `docker run` 起了 postgres 18，并用 `docker exec` + psql 连上；
- [ ] 能解释 `-d` / `-e` / `-p` / `-v` 各自做什么；
- [ ] 完成持久化实验：删容器重建后数据还在；
- [ ] 能说出「容器 started ≠ 数据库 ready」的一个具体表现。

---

上一章：[← 第 1 章：为什么需要 Docker](./01-why-docker.md) ｜ 下一章：[第 3 章：镜像、容器与层 →](./03-images-containers-layers.md) ｜ 返回：[教程目录 README](./README.md)
