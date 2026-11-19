# 第 12 章：综合验收

> 本章目标：把三条 workflow 串成一次完整演练（PR → 合并 → main 验证 → 部署 → 回滚）；对照路线图阶段 16 的每一条核心概念、动手练习与通过标准给出可验证证据。
>
> 关键概念：本章串联全部八条核心概念。｜ 动手练习：全部四个。

---

## 12.1 全链路演练

把 example 复制为独立仓库推上 GitHub，配好分支保护与 production environment，然后：

```
=== 第一幕：PR 门禁（练习 1）===
1. 开 PR（改一行注释）→ ci.yml 五道检查绿
2. 开 probe PR 改坏状态机 → quality 红 → Merge 禁用（练习 4）
3. 修复 → 新 run 绿 → 合并

=== 第二幕：main 验证（练习 2）===
4. 合并触发 main.yml：integration → e2e（生产构建 + chromium）
5. 故意弄挂一个 E2E 断言再合并 → e2e 红
6. 下载 playwright-report artifact → show-trace 定位 → 修复

=== 第三幕：部署（练习 3）===
7. Actions → Deploy → Run workflow（main）
8. build-and-push：GHCR 出现 api:<sha> 镜像
9. deploy 暂停等审批 → 批准 → webhook 部署 → 健康验证绿

=== 第四幕：回滚 ===
10. 再 Run workflow，image_tag 填上一个 sha → 部署旧版本 → 健康验证绿
11. 对照第 10 章 runbook 逐步执行
```

## 12.2 逐项验收：对照路线图给出证据

### 核心概念清单

| 核心概念                                                       | 证据（章节 / 文件）                                  | ✓   |
| -------------------------------------------------------------- | ---------------------------------------------------- | --- |
| workflow、event、job、step、runner、needs、matrix、concurrency | 第 2~4 章 + 三条 workflow 的 job 图与 concurrency 表 | ☐   |
| 锁定 pnpm/Node、frozen lockfile、cache 加速但不保正确性        | 第 5 章三件套 + 第 11 章删缓存实验                   | ☐   |
| CI 质量门禁：format/lint、typecheck、test、build、E2E smoke    | ci.yml 五道检查 + main.yml e2e                       | ☐   |
| permissions 最小化、secrets/environment、fork 边界             | 第 3、7 章 + deploy.yml 逐 job 权限                  | ☐   |
| Cache 与 artifacts 区别；保存报告/coverage/trace               | 第 8 章对比表 + main.yml 失败上传                    | ☐   |
| 迁移与部署顺序；expand-migrate-contract                        | 第 10 章三阶段 + 迁移先测后应用                      | ☐   |
| 分支保护、required checks、环境审批、回滚、发布标识            | 第 6、9、11 章 + tag=sha + runbook                   | ☐   |
| OIDC 优先于长期静态密钥                                        | 第 9 章 OIDC 流程 + id-token: write                  | ☐   |

### 动手练习

| 练习                                                     | 证据                             | ✓   |
| -------------------------------------------------------- | -------------------------------- | --- |
| 练习 1：PR workflow 跑 lint/typecheck/Vitest/build       | ci.yml + 12.1 第一幕             | ☐   |
| 练习 2：main workflow 集成/E2E + 失败报告与 trace        | main.yml + 12.1 第二幕           | ☐   |
| 练习 3：部署 job 受信任分支/受保护环境/限制 GITHUB_TOKEN | deploy.yml + 12.1 第三幕         | ☐   |
| 练习 4：故意失败验证门禁与日志定位                       | 第 6、11 章 + 12.1 第一幕第 2 步 | ☐   |

### 通过标准

| 通过标准                                                   | 证据                                                | ✓   |
| ---------------------------------------------------------- | --------------------------------------------------- | --- |
| 全新 runner 按锁文件安装，不依赖个人机器缓存               | 托管 runner 每次干净 + frozen + 删缓存实验          | ☐   |
| 密钥从 Secrets/Environment/OIDC 来，不进代码/日志/artifact | 第 7、9 章 + 第 8 章产物安全边界                    | ☐   |
| 部署有版本标识、健康验证、可执行回滚                       | tag=sha + 健康验证 step + 第 10 章 runbook + 第四幕 | ☐   |

## 12.3 常见坑（全链路层面）

| 现象                       | 原因                           | 解决                                  |
| -------------------------- | ------------------------------ | ------------------------------------- |
| PR 绿、main 红             | main 多了 E2E/集成层           | 本地先跑 pnpm e2e；理解两层验证的分工 |
| 部署成功但用户报错         | 健康验证只查了 live 没查 ready | 验证 readiness（阶段 15 第 9 章）     |
| 回滚后数据异常             | 破坏性迁移                     | 第 10 章兼容策略；前滚修复            |
| 三条 workflow 权限越配越大 | 图省事顶层给 write             | 回到第 7 章：顶层只读、按 job 提升    |

## 12.4 本章（及全教程）验收清单

- [ ] 完成 12.1 四幕演练；
- [ ] 对照 12.2 逐条打勾，每项有证据；
- [ ] 能向同事讲清「为什么 PR 与部署的权限必须分离」；
- [ ] 知道下一步：阶段 17 建立错误/日志/trace 的排障闭环。

---

## 结语：你已经拥有的能力

走完这 12 章，你的仓库有了完整的工程证据链：

- **合并有门禁**：五道检查 + required checks，坏代码进不了 main；
- **验证有层次**：PR 快检、main 重检（E2E），失败留下 trace 与报告；
- **部署有闸门**：受信任分支 + 环境审批 + OIDC 短期凭据 + 版本标识 + 健康验证；
- **回滚有流程**：旧 sha 重跑即可，兼容迁移策略保证旧代码能跑。

但「部署成功」只是开始——线上真正出问题时，你需要回答「哪里出错、影响谁、经过哪些服务、如何复现」。这正是阶段 17（Sentry + OpenTelemetry + 结构化日志）要建立的能力。

---

上一章：[← 第 11 章：分支保护与失败定位](./11-branch-protection-and-debugging.md) ｜ 返回：[教程目录 README](./README.md)
