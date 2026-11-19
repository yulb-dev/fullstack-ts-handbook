# 第 12 章：镜像维护与综合验收

> 本章目标：建立镜像的长期维护节奏（扫描、依赖更新、可重建性）；做一次从零到全栈的综合演练；对照路线图阶段 15 的每一条核心概念、动手练习与通过标准给出可验证证据。
>
> 关键概念：镜像扫描、依赖更新与可重建性、不把开发热更新配置复制进生产镜像。｜ 动手练习：全部四个。

---

## 12.1 镜像是快照，维护是节奏

镜像不可变带来可复现，也带来一个义务：**构建那一刻的依赖与基础镜像，之后不会自己更新**。安全补丁不会自动进镜像。维护节奏：

| 动作               | 频率建议     | 命令/工具                                                      |
| ------------------ | ------------ | -------------------------------------------------------------- |
| 重建拿基础镜像补丁 | 每周/每两周  | `docker build --pull ...`（第 5 章）                           |
| 依赖更新           | 跟随 PR 节奏 | Dependabot/Renovate 提 PR → CI 验证 → 合并 → 重建              |
| 镜像漏洞扫描       | 每次构建后   | `docker scout cves workboard-api:local`（或 Trivy）            |
| 从零可重建验证     | 每次大改后   | `docker build --pull --no-cache ...` + `compose down -v && up` |

```bash
# Docker Scout：列出镜像中的 CVE（需要 Docker Desktop / scout 插件）
docker scout cves workboard-api:local
docker scout recommendations workboard-api:local   # 基础镜像更新建议
```

扫描结果要**读**而不是只看分数：基础镜像的 CVE 多数靠 `--pull` 重建解决；依赖的 CVE 靠升级 lockfile 解决；「无修复版本」的条目评估可达性后记录决策。**不要为了分数把镜像删到不能跑**。

## 12.2 可重建性：两个思想实验

1. **「 registry 明天删了 postgres:18 这个 tag」**：你的构建会失败吗？关键系统用 digest 钉死（`postgres:18@sha256:...`）+ 私有 registry 缓存基础镜像。代价是失去自动补丁，要用 Dependabot 的 docker ecosystem 定期提 digest 更新 PR——**可复现与及时补丁的平衡，用「钉死 + 自动更新 PR」兼得**；
2. **「新同事明天入职」**：他只需要仓库 + Docker + `.env.example`。`docker compose up --build -d` 就是他的全部环境搭建。第 10 章的 `down -v && up` 演练就是这个思想的直接验证。

## 12.3 综合演练：从零到全栈再到审计

```bash
# === 0. 模拟全新环境 ===
git status                          # 确认 Dockerfile/compose/lockfile 都已提交
docker compose down -v 2>/dev/null  # 清掉旧容器与卷

# === 1. 构建（练习 1、2）===
docker build --pull -f docker/api.Dockerfile -t workboard-api:local .
docker build --pull -f docker/web.Dockerfile -t workboard-web:local .
docker images | grep workboard      # 体积：api ~200MB 级，web 几十 MB

# === 2. 起全栈（练习 3）===
cp .env.example .env
docker compose up -d                # 用刚构建的镜像
docker compose ps                   # 三个服务 Up (healthy)
curl http://localhost:3000/health/ready     # {"status":"ready"}
curl -X POST http://localhost:8080/api/tasks \
  -H 'content-type: application/json' -d '{"title":"综合演练"}'   # 经 nginx 代理创建成功

# === 3. 优雅关闭验证 ===
docker compose stop api             # 日志出现 shutting down gracefully
docker compose logs api | tail -3
docker compose start api

# === 4. 秘密审计（练习 4）===
pnpm audit:image                    # 五项检查全过
docker scout cves workboard-api:local   # 扫描并阅读结果

# === 5. 可重建性验证 ===
docker compose down -v
docker compose up --build -d        # 从仓库内容完整重建
curl http://localhost:3000/health/ready     # 再次 ready
```

每一步都符合预期，你就达成了阶段 15 的全部通过标准。

## 12.4 逐项验收：对照路线图给出证据

### 核心概念清单

| 核心概念                                                                | 证据（章节 / 文件 / 命令）                                                       | ✓   |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --- |
| 镜像、容器、layer、registry、端口映射、volume、network、entrypoint/cmd  | 第 2、3 章概念 + 第 7 章手动组网实验                                             | ☐   |
| Dockerfile：锁文件优先、依赖缓存层、.dockerignore、多阶段、生产镜像缩小 | 第 4 章 .dockerignore；第 5 章缓存实验；第 6 章 docker/api.Dockerfile + 体积对比 | ☐   |
| 非 root、最小运行时、信号传递、SIGTERM 优雅关闭                         | 第 6 章 USER node；第 9 章 exec CMD + server.ts + stop 验证                      | ☐   |
| Compose：服务依赖、健康检查、网络、volume、环境变量                     | 第 10 章 compose.yaml + ps healthy + down -v 重建                                | ☐   |
| 配置与秘密：运行时注入，不进镜像层/构建参数/仓库                        | 第 8 章注入链 + audit-image.sh 五项检查                                          | ☐   |
| Fastify 监听 0.0.0.0、容器/宿主端口、readiness 与 liveness              | 第 9 章 server.ts + app.ts 两个健康端点 + 第 7 章端口辨析                        | ☐   |
| Supabase 本地栈依赖 Docker；started ≠ ready                             | 第 11 章 11.5；第 10 章 service_healthy                                          | ☐   |
| 镜像扫描、依赖更新、可重建性；不复制热更新配置进生产                    | 第 12 章维护节奏 + scout；第 11 章 nginx 替代 dev server                         | ☐   |

### 动手练习

| 练习                                                                     | 证据                                                  | ✓   |
| ------------------------------------------------------------------------ | ----------------------------------------------------- | --- |
| 练习 1：api 的 production multi-stage Dockerfile，pnpm lockfile 固定依赖 | docker/api.Dockerfile + 第 5 章实验 + 第 6 章体积对比 | ☐   |
| 练习 2：web 静态 build + 静态服务器发布，不用 dev server                 | docker/web.Dockerfile + nginx.conf + 第 11 章验证     | ☐   |
| 练习 3：Compose 起 API 与依赖，带 healthcheck，容器内连正确数据库        | compose.yaml + 第 10 章「来自 compose」写入验证       | ☐   |
| 练习 4：inspect/镜像层检查确认无秘密烘焙                                 | scripts/audit-image.sh + 第 8 章故意泄露实验          | ☐   |

### 通过标准

| 通过标准                                        | 证据                                           | ✓   |
| ----------------------------------------------- | ---------------------------------------------- | --- |
| 别人可以从仓库按说明构建和运行镜像              | 12.3 第 5 步：down -v 后从仓库完整重建         | ☐   |
| 容器停止时进程优雅结束，健康检查反映真实可用性  | 12.3 第 3 步 + 第 9 章 liveness/readiness 分工 | ☐   |
| 生产镜像只含运行所需文件、非 root、环境注入配置 | 第 6 章 runtime 三样 + USER node + 第 8 章审计 | ☐   |

## 12.5 常见坑（维护层面）

| 现象                       | 原因                     | 解决                                                 |
| -------------------------- | ------------------------ | ---------------------------------------------------- |
| 镜像半年没重建，CVE 一堆   | 没有 --pull 重建节奏     | 12.1 的维护表，写进团队日历/CI 定时任务              |
| 钉了 digest 后再没拿到补丁 | 钉死但无更新机制         | Dependabot docker ecosystem 自动提更新 PR            |
| 生产镜像里有 tsx watch     | 开发启动方式被复制进生产 | CMD 是 node dist/server.js；dev 配置只存在于开发脚本 |
| 扫描分数好看但镜像跑不起来 | 为删 CVE 删了必要依赖    | 读扫描报告，按可达性决策，而不是只看分数             |

## 12.6 本章（及全教程）验收清单

- [ ] 完成 12.3 综合演练五步，全部符合预期；
- [ ] 对照 12.4 逐条打勾，每项都有可验证证据；
- [ ] 能说出镜像维护的四个动作与频率；
- [ ] 能解释「钉 digest + 自动更新 PR」如何平衡可复现与补丁；
- [ ] 知道下一步：阶段 16 把镜像构建与质量门禁搬进 GitHub Actions。

---

## 结语：你已经拥有的能力

走完这 12 章，「在我机器上能跑」这句话从你的团队消失了：

- 环境被版本化：Dockerfile + compose.yaml + lockfile 都在 Git 里，新人一条命令重建；
- 镜像被审计：非 root、无秘密、只含运行所需，每一层都能解释；
- 运行被治理：优雅关闭、真实健康检查、就绪依赖，停止和故障都有确定行为。

接下来，阶段 16（GitHub Actions CI/CD）会把「构建镜像 + 跑测试 + 部署」变成自动化门禁——你在这里建立的每一条红线（frozen lockfile、秘密不进产物、非 root），都会成为 CI 里的检查项。

---

上一章：[← 第 11 章：前端静态发布与 Supabase 本地栈](./11-web-static-and-supabase.md) ｜ 返回：[教程目录 README](./README.md)
