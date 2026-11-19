# 第 3 章：镜像、容器与层

> 本章目标：把第 2 章的手感升级为概念——镜像/容器/layer/registry 的精确含义、写时复制、镜像的分发与版本标识；学会用 `inspect` / `history` 观察镜像内部。
>
> 关键概念：镜像、容器、layer、registry、entrypoint/cmd 的区别。

---

## 3.1 镜像：只读的层叠模板

镜像（image）是**只读**的文件系统快照 + 元数据（启动命令、环境变量、暴露端口等），由若干**层（layer）**叠成：

```
┌─────────────────────────┐
│ 层 5: COPY dist/         │  ← 你的构建产物
│ 层 4: RUN pnpm install   │  ← 依赖
│ 层 3: COPY package.json  │  ← 清单
│ 层 2: RUN corepack enable│
│ 层 1: node:24-slim 基础层 │  ← 来自官方镜像
└─────────────────────────┘
```

三个关键性质：

1. **层是共享的**：两个镜像都 `FROM node:24-bookworm-slim`，基础层在磁盘上只存一份；拉镜像时只下载缺失的层。这是 Docker 省空间、省带宽的核心机制。
2. **层是不可变的**：构建后不能改。要改就构建新镜像。这保证「同一个镜像在任何机器上内容一致」。
3. **每条 Dockerfile 指令产生一层**（粗略地说）：所以指令顺序直接决定缓存效率——第 5 章的主题。

## 3.2 容器：镜像 + 可写层 + 隔离进程

`docker run` 时，Docker 在镜像顶部加一个**可写层**，然后启动进程：

```
容器 A ─┐                ┌─ 容器 B
可写层 A │                │ 可写层 B     ← 各自的修改互不影响
────────┴────────────────┴────────
        共享的只读镜像层（同一份）
```

这就是**写时复制（copy-on-write）**：容器里改文件，改的是可写层的副本；删容器，可写层丢弃，镜像毫发无损。第 2 章的实验由此解释：数据写在可写层 → 删容器就没了；写在 volume → 绕过可写层，独立存续。

**一个镜像可以起任意多个容器**：`docker run postgres:18` 十次就是十个互不干扰的数据库（记得映射不同宿主端口）。

## 3.3 registry：镜像的仓库

registry 是存储与分发镜像的服务。镜像名的完整结构：

```
registry.example.com:5000/team/workboard-api:1.4.2
└────────┬──────────────┘ └──────┬───────┘ └─┬─┘
     registry 地址          仓库名（命名空间/镜像）  tag
```

- 省略 registry 时默认 `docker.io`（Docker Hub）；`postgres:18` 实际是 `docker.io/library/postgres:18`；
- **tag 是可变的**：`postgres:18` 今天和三个月后可能指向不同内容（官方会滚动更新补丁）。要绝对可复现，用 **digest** 钉死：`postgres:18@sha256:...`（第 12 章讨论取舍）；
- 常用命令：

```bash
docker pull postgres:18          # 拉镜像
docker tag workboard-api:local registry.example.com/team/workboard-api:1.4.2
docker push registry.example.com/team/workboard-api:1.4.2
docker images                    # 本地镜像列表
```

## 3.4 观察镜像内部：inspect 与 history

这两个命令是第 8 章秘密审计的基础，现在就学会：

```bash
# 元数据：启动命令、环境变量、用户、暴露端口
docker image inspect postgres:18 --format '{{json .Config}}' | head -c 600

# 每一层是哪条指令产生的、多大
docker history postgres:18
```

`inspect` 输出里重点看四个字段：

| 字段                | 含义                     | 审计关注点                     |
| ------------------- | ------------------------ | ------------------------------ |
| `Config.Cmd`        | 默认启动命令             | 是否 exec 形式（第 9 章）      |
| `Config.Entrypoint` | 入口命令                 | 与 Cmd 的拼接关系（3.5）       |
| `Config.Env`        | **烘焙进镜像的环境变量** | 有没有秘密混进来（第 8 章）    |
| `Config.User`       | 运行用户                 | 是否为空（空 = root，第 6 章） |

## 3.5 ENTRYPOINT 与 CMD：入口和默认参数

两者共同决定容器启动时执行什么：

- **ENTRYPOINT**：镜像的「主命令」，把镜像变成「那个命令本身」；
- **CMD**：默认参数（或没有 ENTRYPOINT 时的完整命令）。

```dockerfile
ENTRYPOINT ["psql"]
CMD ["--help"]
```

```bash
docker run my-psql                    # 执行 psql --help
docker run my-psql -U workboard -l    # 执行 psql -U workboard -l（覆盖 CMD）
```

对应用镜像，最常见的写法是**只用 CMD**：

```dockerfile
CMD ["node", "dist/server.js"]
```

为什么用 JSON 数组（exec 形式）而不是 `CMD node dist/server.js`（shell 形式）？因为 shell 形式会让 `/bin/sh` 成为 PID 1，你的 node 进程收不到 `docker stop` 发的 SIGTERM——第 9 章会完整展开这个坑。

## 3.6 容器生命周期

```
created → running → paused ⇄ running → exited（停止）→ removed（删除）
              ↑________restart________|
```

`docker run` = `create` + `start`。`--rm` 让容器退出后自动删除（适合一次性任务）。`--restart unless-stopped` 让 daemon 在容器异常退出时自动拉起（生产常用；Compose 里同名配置）。

## 3.7 常见坑

| 现象                             | 原因                           | 解决                                                    |
| -------------------------------- | ------------------------------ | ------------------------------------------------------- |
| 同一 tag 两次构建内容不同        | tag 可变，基础镜像被滚动更新   | 关键场景用 digest 钉死；定期 `--pull` 重建（第 12 章）  |
| 容器里删了文件，镜像体积却没变小 | 删除发生在新的层，旧层内容仍在 | 在同一层内完成「下载+使用+清理」；多阶段构建（第 6 章） |
| `docker run` 覆盖不了启动命令    | 命令写在 ENTRYPOINT 里         | 用 `--entrypoint` 覆盖，或理解 ENTRYPOINT/CMD 分工      |
| 以为 `Config.Env` 是运行时配置   | 它是**构建时烘焙**的           | 秘密绝不放 ENV；运行时 `-e` 注入（第 8 章）             |

## 3.8 本章验收清单

- [ ] 能解释层的共享与不可变性，以及它带来的两个好处；
- [ ] 能解释写时复制，并由此说明「为什么数据要放 volume」；
- [ ] 能拆解一个完整镜像名（registry/仓库/tag/digest）；
- [ ] 会用 `docker image inspect` 找到 Cmd/Entrypoint/Env/User；
- [ ] 能区分 ENTRYPOINT 与 CMD，并说出 exec 形式的重要性。

---

上一章：[← 第 2 章：安装与第一个容器](./02-setup-and-first-container.md) ｜ 下一章：[第 4 章：Dockerfile 基础 →](./04-dockerfile-basics.md) ｜ 返回：[教程目录 README](./README.md)
