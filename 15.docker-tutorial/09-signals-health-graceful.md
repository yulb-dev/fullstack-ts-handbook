# 第 9 章：信号、健康检查与优雅关闭

> 本章目标：理解 PID 1 与信号传递（exec vs shell 形式、--init）；实现 SIGTERM 优雅关闭（先停 HTTP 再放连接池）；区分 liveness 与 readiness 并写对 healthcheck；理解 Fastify 为什么必须监听 0.0.0.0。
>
> 关键概念：进程信号传递、SIGTERM 优雅关闭、Fastify 监听 0.0.0.0、readiness 与 liveness。

---

## 9.1 docker stop 到底做了什么

先补两个基础概念：

- **PID（进程号）**：操作系统给每个进程的唯一编号。**PID 1** 是容器里第一个启动的进程（「始祖」），Docker 的信号只发给它；
- **信号（signal）**：操作系统发给进程的「通知」。**SIGTERM** = 「请你优雅退出」（可捕获、可做清理）；**SIGKILL** = 「立即强杀」（不可捕获、不容清理）；**SIGINT** = 键盘 Ctrl+C。

「优雅关闭」就是：进程收到 SIGTERM 后，先把手头的事做完（处理完在途请求、释放连接）再退出，而不是被强杀。

```
docker stop <容器>
   │  1. 发 SIGTERM 给容器内 PID 1
   │  2. 等宽限期（默认 10s，-t 可调）
   └─ 3. 还没退出？发 SIGKILL（强杀，不可捕获）
```

优雅关闭的全部机会都在第 1~2 步之间。两个前提缺一不可：

1. **信号能到达你的进程**：PID 1 必须是 node，而不是包了一层的 shell；
2. **进程捕获并处理 SIGTERM**：Node 默认对 SIGTERM 的行为是直接退出——不处理就等于没有优雅关闭。

## 9.2 PID 1 陷阱：exec 形式 vs shell 形式

```dockerfile
CMD node dist/server.js            # shell 形式：实际执行 /bin/sh -c "node dist/server.js"
CMD ["node", "dist/server.js"]     # exec 形式：node 直接是 PID 1
```

shell 形式下 `/bin/sh` 是 PID 1，**sh 不会把 SIGTERM 转发给子进程**：你的 node 收不到信号，10 秒后被 SIGKILL 强杀——在途请求断掉、连接池没释放。

验证方法：

```bash
docker exec <容器> ps aux   # PID 1 应该是 node，不是 sh
```

> 需要 shell 能力（如入口脚本做初始化）时，脚本最后一行用 `exec "$@"` 把进程「交棒」给应用（postgres 官方镜像的 entrypoint 就是这么写的）；或者用 `docker run --init` / Compose `init: true` 引入 tini（一个极小的初始化进程）作为 PID 1，负责转发信号与收割僵尸进程（已退出但未被回收的进程）。**单进程 Node 服务用 exec 形式 CMD 就够了**。

## 9.3 优雅关闭的实现

`apps/api/src/server.ts`（与示例工程一致）：

```ts
const env = readEnv();
const pool = createPool(env.DATABASE_URL);
const app = buildApp({ db: pool });

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return; // 防重入：连续两次 SIGTERM 不重复关闭
  shuttingDown = true;
  app.log.info({ signal }, "shutting down gracefully");
  try {
    await app.close(); // 1. 停止接受新连接，等在途请求完成
    await pool.end(); // 2. 释放数据库连接池
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "error during shutdown");
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT")); // 本地 Ctrl+C 同样优雅

await app.listen({ port: env.PORT, host: "0.0.0.0" });
```

顺序的意义：**先 HTTP 后数据库**。反过来先关池，在途请求会全部报错。`app.close()` 是 Fastify 的优雅关闭钩子（触发 onClose 插件钩子、排空连接）。

宿主机验证（第 6 章已做过）：`kill -TERM <pid>` 后日志出现 `shutting down gracefully`，进程退出码 0。容器里等价于 `docker stop`。

## 9.4 监听 0.0.0.0：容器网络的必然要求

```ts
await app.listen({ port: env.PORT, host: "0.0.0.0" });
```

- `127.0.0.1`：只接受**容器自己回环**的连接。端口映射的流量从容器网卡进来，不是回环 → 连接被拒绝；
- `0.0.0.0`：接受容器所有网卡的连接 → 端口映射、容器间通信都可达。

「监听 0.0.0.0 会不会不安全？」——容器的网络隔离由 Docker 保证；暴露面由 `-p` 绑定地址控制（第 7 章）。**容器内监听 0.0.0.0 + 按需发布端口**是标准组合。

## 9.5 liveness vs readiness：两种健康，两个用途

|                | liveness（存活）            | readiness（就绪）                           |
| -------------- | --------------------------- | ------------------------------------------- |
| 回答的问题     | 进程是不是活着/卡死？       | 现在能不能服务真实流量？                    |
| 本项目实现     | `GET /health/live` → 恒 200 | `GET /health/ready` → `SELECT 1` 成功才 200 |
| 失败的后果     | 编排器**重启**容器          | 编排器**摘流量**（不重启）                  |
| 该不该查数据库 | **不该**                    | **该**                                      |

为什么 liveness 不查数据库？数据库挂了 → liveness 失败 → 重启 API → 数据库还是挂 → 再重启……**重启风暴**，而重启根本治不好数据库。readiness 查数据库：数据库挂了 → 摘流量 → 数据库恢复 → 自动接回流量。

示例工程的实现（`app.ts`）：

```ts
app.get("/health/live", async () => ({ status: "ok" }));

app.get("/health/ready", async (request, reply) => {
  try {
    await db.query("SELECT 1");
    return { status: "ready" };
  } catch (err) {
    request.log.warn({ err }, "readiness check failed");
    return reply.code(503).send({ status: "unavailable" });
  }
});
```

## 9.6 HEALTHCHECK：让 Docker 知道「真实可用性」

Dockerfile 或 Compose 里声明健康探测。slim 镜像没有 curl，用 Node 自带 fetch：

```dockerfile
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

- `start_period`：启动宽限期，期间的失败不计入 retries（给应用启动时间）；
- 探测的是 **readiness**：数据库不可达时容器标记为 unhealthy，Compose 的 `service_healthy` 依赖就会等待（第 10 章）；
- `docker ps` 的 STATUS 列会显示 `Up (healthy)` / `Up (unhealthy)`；`docker inspect --format '{{json .State.Health}}'` 看每次探测记录。

> 注意：Docker 本身**不会**因 unhealthy 自动重启容器（那是编排器如 K8s/Swarm 的职责）；healthcheck 的价值在于**把真实可用性暴露给编排决策**。

## 9.7 常见坑

| 现象                            | 原因                                                | 解决                                         |
| ------------------------------- | --------------------------------------------------- | -------------------------------------------- |
| docker stop 总是等 10s 才停     | shell 形式 CMD，SIGTERM 没到 node                   | exec 形式 CMD；或 --init                     |
| 停止时在途请求报错              | 没处理 SIGTERM / 先关了连接池                       | 9.3 的实现与顺序                             |
| 端口映射了但连接被拒绝          | 监听了 127.0.0.1                                    | host: "0.0.0.0"                              |
| 数据库一挂 API 就被重启循环     | liveness 查了数据库                                 | liveness 只证进程活着；readiness 才查依赖    |
| 容器 Up 但 Compose 依赖方一直等 | healthcheck 探测失败（如探了 readiness 而 db 未起） | 看 `docker inspect .State.Health` 的失败输出 |

## 9.8 本章验收清单

- [ ] 能说出 docker stop 的三步与两个优雅前提；
- [ ] `docker exec <容器> ps aux` 确认 PID 1 是 node；
- [ ] `docker stop` 时日志出现优雅关闭记录，退出码 0；
- [ ] 能解释 liveness/readiness 的分工与「重启风暴」反模式；
- [ ] healthcheck 探测 readiness，`docker ps` 能看到 healthy 状态。

---

上一章：[← 第 8 章：配置与秘密](./08-env-and-secrets.md) ｜ 下一章：[第 10 章：Compose 编排全栈 →](./10-compose-full-stack.md) ｜ 返回：[教程目录 README](./README.md)
