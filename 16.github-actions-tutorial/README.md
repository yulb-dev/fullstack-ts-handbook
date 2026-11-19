# GitHub Actions CI/CD：从 0 到 1 搭建可审计、最小权限、失败可定位的自动化门禁

你已经能写全栈应用、能把测试跑绿、能把应用装进 Docker 镜像。但只要「合并代码」和「部署上线」还是人工动作，一类事故就会反复发生：

- 有人本地忘了跑测试就提 PR，合并后 main 分支红了，**全组被阻塞**；
- 「我本地是好的」——CI 没锁 Node/pnpm 版本，runner 装出来的依赖树和你本地不一样；
- 部署靠运维手敲命令，**没有版本标识**，出问题不知道线上跑的是哪个 commit，回滚靠猜；
- 一个 fork PR 的工作流读到了仓库 secrets——因为 `pull_request_target` 用错了；
- CI 缓存里混进了密钥，被不可信分支读走；
- E2E 挂了只有一句「exit code 1」，没有 trace、没有报告，**无法定位**。

这些问题的共同根源：**质量与部署没有被建模成「可审计的自动化流程」**。

这份教程带你从零掌握 GitHub Actions，为贯穿项目 **Workboard** 搭建三层流水线：

```
PR 门禁   →  format / lint / typecheck / test / build，全绿才允许合并
main 验证 →  集成测试 + 生产构建上的 E2E，失败上传 trace 与报告
部署      →  受保护环境 + 人工审批 + OIDC 短期凭据 + 版本标识 + 健康验证 + 可回滚
```

并守住三条红线：**最小权限、秘密不进代码/日志/缓存/artifact、部署与 PR 权限分离**。

---

## 学完之后你将能够

1. 说清 **workflow、event、job、step、runner、needs、matrix、concurrency** 的精确语义，并画出 job 依赖图；
2. 锁定 **Node/pnpm 版本**（`packageManager` + `pnpm/action-setup` + `setup-node`），用 **frozen lockfile** 保证全新 runner 可复现安装；用 cache 加速但**不依赖缓存保障正确性**；
3. 搭建 **PR 质量门禁**：format/lint、typecheck、unit/integration test、build，并配成分支保护的 required checks；
4. 做 **权限最小化**：`permissions` 顶层收紧、按 job 提升；理解 **fork PR 的不可信代码边界**（`pull_request` vs `pull_request_target`）、脚本注入与第三方 action 钉 SHA；
5. 分清 **cache 与 artifacts**：前者加速、后者存证；会上传测试报告、coverage、Playwright trace 等诊断产物；
6. 设计**部署 job**：只允许受信任分支 + 受保护环境（审批）部署；`GITHUB_TOKEN` 权限收紧；**OIDC 短期凭据**优先于长期静态密钥；
7. 处理**迁移与部署顺序**：先测试迁移、expand-migrate-contract 兼容性策略；部署有**版本标识、健康验证与可执行的回滚**；
8. 故意制造失败，验证**合并门禁与日志足以定位失败步骤**。

---

## 版本说明（2026 年 11 月核对）

示例工程的全部脚本（format/lint/typecheck/test/build/e2e）已在本机验证通过；workflow 语法与 action 版本按官方文档核对（GitHub Actions 本身需在真实仓库运行）。

| 组件                       | 版本    | 说明                                                       |
| -------------------------- | ------- | ---------------------------------------------------------- |
| Node.js                    | 24      | `setup-node` 锁定；与全库口径一致                          |
| pnpm                       | 12.11.2 | `packageManager` 字段锁定，`pnpm/action-setup` 读取        |
| actions/checkout           | v7      | 最新主版本（v5 起 node24 运行时）                          |
| actions/setup-node         | v7      | v6 起 pnpm 缓存需显式 `cache: pnpm`                        |
| pnpm/action-setup          | v6      | 支持 pnpm 12；省略 version 时读 `packageManager`           |
| actions/cache              | v6      | 本教程主要用 setup-node 内置缓存，第 5 章讲手动 cache      |
| actions/upload-artifact    | v7      | 诊断产物上传                                               |
| docker/build-push-action   | v7      | 部署 job 构建镜像（配合 login-action@v4、setup-buildx@v4） |
| Playwright                 | 1.65    | E2E（深入见阶段 13 教程）                                  |
| ESLint / typescript-eslint | 9 / 8   | 扁平配置（flat config）                                    |
| Vitest                     | 5       | 单元/集成测试（深入见阶段 12 教程）                        |

> **两个容易踩的版本坑**
>
> 1. **action 主版本在快速演进**：网上大量教程还是 `checkout@v4` / `setup-node@v4`。本教程用核对过的主版本；你跟随实践时以各 action 仓库 README 为准，并理解「钉主版本 tag vs 钉 SHA」的取舍（第 7 章）。
> 2. **`setup-node` 的 `cache: pnpm` 要求 pnpm 已安装**：所以顺序必须是 `pnpm/action-setup` 在前、`setup-node` 在后，否则报 `Unable to locate executable file: pnpm`。

---

## 适合谁

- 已完成阶段 12（Vitest）、13（Playwright）、14（Monorepo）、15（Docker）的读者最佳；
- 用过 GitHub 但没写过 workflow，或抄过 workflow 却说不清 `permissions` / `needs` / `concurrency` 的人；
- 想为团队建立「合并有门禁、部署有审批、失败有证据」工程文化的人。

---

## 贯穿项目：Workboard（CI 切片）

配套 `example/` 是一个 pnpm workspace，业务刻意精简（内存仓储），把舞台留给流水线：

```
example/
├── .github/workflows/
│   ├── ci.yml                # PR 门禁：format/lint/typecheck/test/build
│   ├── main.yml              # main 验证：集成测试 + E2E + 失败产物上传
│   └── deploy.yml            # 部署：环境保护 + OIDC + GHCR 镜像 + 健康验证
├── apps/
│   ├── api/                  # Fastify：任务 CRUD + 状态机（8 个 inject 测试）
│   └── web/                  # React + Vite：列表 + 创建 + 推进状态
├── packages/shared/          # 同构纯函数：状态机 + 分页解析（7 个测试）
├── e2e/                      # Playwright 冒烟：跑在「生产构建」上
├── docker/api.Dockerfile     # 部署用镜像（阶段 15 的多阶段模式）
├── eslint.config.js          # ESLint 9 扁平配置
├── package.json              # packageManager + 门禁脚本
└── pnpm-workspace.yaml
```

> 注意：`example/.github/workflows/` 在本文档仓库里**不会真正运行**（GitHub 只认仓库根的 `.github/`）。学习时把 example 复制成一个独立仓库推上 GitHub，即可看到三条流水线真实跑起来。

---

## 章节目录

| 章节     | 标题                                                                          | 你将掌握                                                   | 对应核心概念 |
| -------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------ |
| 第 1 章  | [CI/CD 与 GitHub Actions 是什么](./01-why-ci-cd.md)                           | CI/CD 与 GitHub Actions 是什么、为什么需要                 | 总目标       |
| 第 2 章  | [心智模型与第一个 workflow](./02-mental-model-first-workflow.md)              | workflow/event/job/step/runner、触发与观察                 | ①            |
| 第 3 章  | [事件与触发器](./03-events-and-triggers.md)                                   | push/PR/dispatch/schedule、路径过滤、fork 事件边界         | ① ④          |
| 第 4 章  | [job 编排：needs、matrix、concurrency](./04-jobs-needs-matrix-concurrency.md) | 依赖图、矩阵、取消策略、job 间传值                         | ①            |
| 第 5 章  | [锁定工具链与缓存](./05-toolchain-and-cache.md)                               | packageManager、frozen lockfile、pnpm 缓存、缓存不保正确性 | ②            |
| 第 6 章  | [PR 质量门禁](./06-pr-quality-gates.md)                                       | 五道检查、required checks、故意失败实验                    | ③ · 练习 1   |
| 第 7 章  | [权限、秘密与 fork 安全](./07-permissions-secrets-security.md)                | 最小权限、secrets、脚本注入、钉 SHA                        | ④            |
| 第 8 章  | [artifacts 与 E2E 报告](./08-artifacts-and-e2e.md)                            | cache vs artifacts、main workflow、trace 上传              | ⑤ · 练习 2   |
| 第 9 章  | [部署：环境保护与 OIDC](./09-deploy-environments-oidc.md)                     | 审批、权限分离、短期凭据、发布标识                         | ④ ⑦ · 练习 3 |
| 第 10 章 | [迁移、发布与回滚](./10-migrations-release-rollback.md)                       | 迁移顺序、expand-migrate-contract、健康验证、回滚          | ⑥            |
| 第 11 章 | [分支保护与失败定位](./11-branch-protection-and-debugging.md)                 | 保护规则、日志/重跑/调试、本地 act                         | ⑦ · 练习 4   |
| 第 12 章 | [综合验收](./12-capstone-and-acceptance.md)                                   | 全链路演练、逐项验收                                       | 全部         |

## 学习路线建议

```
第 1 章（为什么）★ 门禁与部署到底解决什么
   └─> 第 2 章（第一个 workflow）
         └─> 第 3 章（事件）→ 第 4 章（job 编排）★ ① 的四个概念在这里闭环
               └─> 第 5 章（工具链与缓存）★ 可复现的地基
                     └─> 第 6 章（PR 门禁）★ 练习 1
                           └─> 第 7 章（安全）★ 红线章，必须全过
                                 └─> 第 8 章（artifacts 与 E2E）★ 练习 2
                                       └─> 第 9 章（部署与 OIDC）★ 练习 3
                                             └─> 第 10 章（迁移与回滚）
                                                   └─> 第 11 章（保护与调试）★ 练习 4
                                                         └─> 第 12 章（综合验收）
```

---

## 逐项验收清单（总表）

以下条目直接对应路线图阶段 16 的核心概念清单。第 12 章给出每项的证据。

### ① workflow / event / job / step / runner / needs / matrix / concurrency

- [ ] 能画出示例三条 workflow 的 job 依赖图；
- [ ] 能解释 needs 与 matrix 的区别、concurrency 的取消语义。

### ② 锁定 pnpm/Node、frozen lockfile、cache 加速但不保正确性

- [ ] `packageManager` + action-setup + setup-node 三件套锁定工具链；
- [ ] CI 用 `--frozen-lockfile`；cache key 绑定 lockfile 哈希。

### ③ CI 质量门禁

- [ ] PR workflow 跑 format/lint、typecheck、test、build；
- [ ] main workflow 跑集成/E2E smoke；门禁是 required checks。

### ④ permissions 最小化、secrets/environment、fork 边界

- [ ] 顶层 `permissions` 收紧，按 job 提升；
- [ ] 能解释 `pull_request` 与 `pull_request_target` 的信任差异；
- [ ] 秘密只从 Secrets/Environment/OIDC 来。

### ⑤ cache vs artifacts、诊断产物

- [ ] 能说出两者缓存内容、生命周期、用途的区别；
- [ ] 失败时上传测试报告/coverage/Playwright trace。

### ⑥ 迁移与部署顺序

- [ ] 先测试迁移再应用；能解释 expand-migrate-contract；
- [ ] 部署 job 与迁移 job 的顺序正确。

### ⑦ 分支保护、required checks、环境审批、回滚、发布标识

- [ ] main 有保护规则 + required checks；
- [ ] 部署有版本标识（commit sha）、健康验证、可执行回滚。

### ⑧ OIDC 优先于长期静态密钥

- [ ] 能解释 OIDC 的短期凭据机制与 `id-token: write`；
- [ ] 知道云侧信任配置的最小化（绑定 environment/branch）。

### 必须完成的动手练习

- [ ] 练习 1：PR workflow 自动跑 lint、typecheck、Vitest、build（第 6 章）；
- [ ] 练习 2：main workflow 执行集成/E2E，失败上传报告和 trace（第 8 章）；
- [ ] 练习 3：部署 job 只允许受信任分支/受保护环境，限制 GITHUB_TOKEN（第 9 章）；
- [ ] 练习 4：故意使一个检查失败，验证门禁与日志足以定位（第 6、11 章）。

### 通过标准

- [ ] 全新 runner 能按锁文件安装依赖，不依赖个人机器缓存；
- [ ] 密钥从 Secrets/Environment 或 OIDC 获得，不写入代码、日志和 artifact；
- [ ] 部署有版本标识、健康验证和可执行的回滚/恢复说明。

---

## 如何使用配套示例工程

```bash
cd 16.github-actions-tutorial/example
pnpm install
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build   # PR 门禁的本地等价物
pnpm --filter @workboard/e2e exec playwright install chromium                 # 首次装浏览器
pnpm e2e                                                                      # 生产构建上的冒烟

# 让 workflow 真实运行：把 example 复制为独立仓库推上 GitHub
# 然后按第 6/9/11 章配置分支保护与 production environment
```

---

## 与本系列其他教程的关系

- **阶段 14（Monorepo）** 第 12 章已给出 turbo 版 CI 雏形；本教程把 CI/CD 讲透，并改用「pnpm 原生脚本 + 三条 workflow」的最小结构，避免与 turbo 缓存概念纠缠（两者可叠加）。
- **阶段 15（Docker）** 的多阶段镜像在第 9 章被部署 job 构建并推上 GHCR。
- **阶段 12/13（Vitest/Playwright）** 的测试与 trace 在这里成为门禁与诊断产物。
- **阶段 17（可观测性）** 接棒：部署后的健康验证只是起点，错误/日志/trace 的排障闭环在下一阶段建立。

---

## 官方资源

- GitHub Actions 文档：<https://docs.github.com/en/actions>
- Workflow 语法：<https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax-for-github-actions>
- 安全加固（secure use reference）：<https://docs.github.com/en/actions/reference/security/secure-use>
- OIDC：<https://docs.github.com/en/actions/concepts/security/openid-connect>
- 事件触发器：<https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>
- 缓存依赖：<https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/cache-dependencies>
- 环境部署：<https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments>
- pnpm/action-setup：<https://github.com/pnpm/action-setup>
- actions/setup-node：<https://github.com/actions/setup-node>
