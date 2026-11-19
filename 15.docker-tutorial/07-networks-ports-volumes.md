# 第 7 章：网络、端口与数据卷——容器如何互联与持久化

> 本章目标：理解 bridge 网络与容器 DNS（服务名即主机名）、端口映射的方向、volume 与 bind mount 的区别；用两个容器手动组网，为第 10 章 Compose 打底。
>
> 关键概念：端口映射、volume、network。

---

## 7.1 容器的网络隔离

每个容器有自己的网络命名空间：自己的网卡、自己的 `127.0.0.1`。两个推论：

1. **容器里的 `localhost` 不是宿主**：API 容器里写 `DATABASE_URL=...@localhost:5432` 连的是 API 容器自己，不是数据库容器；
2. **容器之间默认不互通**：要互通必须加入同一个网络。

## 7.2 自定义 bridge 网络 + DNS

```bash
# 1. 建网络
docker network create workboard-net

# 2. 数据库加入网络（--name 成为网络内的 DNS 名）
docker run -d --name db --network workboard-net \
  -e POSTGRES_USER=workboard -e POSTGRES_PASSWORD=workboard_dev -e POSTGRES_DB=workboard \
  -v workboard-pgdata:/var/lib/postgresql postgres:18

# 3. API 加入同一网络，DATABASE_URL 的主机名写容器名 db
docker run --rm --network workboard-net -p 3000:3000 \
  -e DATABASE_URL=postgres://workboard:workboard_dev@db:5432/workboard \
  workboard-api:local

curl http://localhost:3000/health/ready   # {"status":"ready"}
```

关键机制：**自定义 bridge 网络内置 DNS**，容器名（或 `--network-alias`）自动解析为容器 IP。所以 `DATABASE_URL` 里写 `db` 而不是 IP——IP 会随重建变化，名字不会。

> 默认的 `bridge` 网络**没有**这个 DNS（只能靠 IP 或已废弃的 `--link`）。这就是为什么 Compose 总是为项目创建自定义网络（第 10 章）。

## 7.3 端口映射：方向与绑定地址

```bash
-p 3000:3000          # 宿主 3000 → 容器 3000（所有宿主网卡）
-p 127.0.0.1:3000:3000 # 只绑宿主回环：外部机器访问不到（更安全）
-p 8080:3000          # 宿主 8080 → 容器 3000（宿主端口可以不同）
```

三个易混点：

1. **左边宿主，右边容器**。`EXPOSE 3000` 只是声明，不做映射；
2. **容器间通信不走宿主端口**：API 连 `db:5432` 用的是容器端口，db 不需要 `-p` 也能被同网络的 API 访问。`-p 5432:5432` 只是为了让你宿主机的 psql/客户端能连；
3. **生产数据库通常不映射宿主端口**：只让同网络的 API 访问，缩小暴露面。本教程 compose 里映射 5432 是为了本地调试方便。

这也解释了第 6 章为什么 Fastify 必须监听 `0.0.0.0`：监听 `127.0.0.1` 时，端口映射进来的流量（到达容器网卡而非回环）会被拒绝。

## 7.4 volume vs bind mount

|          | 命名卷（volume）                 | 绑定挂载（bind mount）                            |
| -------- | -------------------------------- | ------------------------------------------------- |
| 写法     | `-v pgdata:/var/lib/postgresql`  | `-v $(pwd)/initdb:/docker-entrypoint-initdb.d:ro` |
| 管理者   | Docker（存于 daemon 管理的目录） | 你（宿主任意路径）                                |
| 适合     | 数据库数据等「容器产生的状态」   | 配置文件、初始化 SQL 等「宿主提供的输入」         |
| 可移植性 | 好（不依赖宿主路径）             | 差（依赖宿主目录结构）                            |
| 生产     | 推荐                             | 谨慎（路径与权限问题多）                          |

本教程的 postgres 同时用了两者：

```bash
-v workboard-pgdata:/var/lib/postgresql                    # 数据 → 命名卷
-v ./initdb:/docker-entrypoint-initdb.d:ro                 # 初始化 SQL → 绑定挂载（只读）
```

`/docker-entrypoint-initdb.d` 是 postgres 官方镜像的约定：**首次启动（数据目录为空）时**按文件名顺序执行其中的 `.sql`/`.sh`。示例工程的 `initdb/01-schema.sql` 建表 + 种子数据就是这样进库的。注意「仅首次」：卷里已有数据时改 SQL 不会重跑——要重建得 `docker compose down -v`（删卷，第 10 章）。

## 7.5 数据持久化实验（网络版）

```bash
# 通过 API 创建一条任务（写进 db 容器的卷）
curl -X POST http://localhost:3000/api/tasks \
  -H 'content-type: application/json' -d '{"title":"持久化验证"}'

# 删掉两个容器，网络保留
docker stop db && docker rm db

# 重建 db（同一个卷、同一个网络、同一个名字）
docker run -d --name db --network workboard-net \
  -e POSTGRES_USER=workboard -e POSTGRES_PASSWORD=workboard_dev -e POSTGRES_DB=workboard \
  -v workboard-pgdata:/var/lib/postgresql postgres:18

# 数据还在（API 容器无需重建：DNS 名 db 不变）
curl http://localhost:3000/api/tasks
```

## 7.6 常见坑

| 现象                                    | 原因                         | 解决                                                |
| --------------------------------------- | ---------------------------- | --------------------------------------------------- |
| API 连不上 db（ECONNREFUSED localhost） | 容器里 localhost 是自己      | DATABASE_URL 主机名写服务名/容器名                  |
| `getaddrinfo ENOTFOUND db`              | 两个容器不在同一自定义网络   | `--network workboard-net`；或交给 Compose           |
| 宿主能连 db，外部机器也能连             | `-p 5432:5432` 绑了所有网卡  | 不需要外部访问就 `-p 127.0.0.1:5432:5432` 或不映射  |
| 改了 initdb SQL 没生效                  | 卷已有数据，初始化只在首次跑 | `docker compose down -v` 后重建（会丢数据，仅本地） |
| 容器重建后 IP 变了，连接串失效          | 连接串写了 IP                | 写容器名/服务名，靠 DNS                             |

## 7.7 本章验收清单

- [ ] 能解释「容器里的 localhost 不是宿主」；
- [ ] 手动建网络、组网两个容器，API 用 `db:5432` 连通数据库；
- [ ] 能区分 `-p` 的方向、`EXPOSE` 的纯声明性、容器间通信不走宿主端口；
- [ ] 能区分 volume 与 bind mount 的适用场景；
- [ ] 完成持久化实验：删 db 容器重建后数据还在、API 无需改配置。

---

上一章：[← 第 6 章：多阶段构建与生产镜像](./06-multi-stage-production.md) ｜ 下一章：[第 8 章：配置与秘密 →](./08-env-and-secrets.md) ｜ 返回：[教程目录 README](./README.md)
