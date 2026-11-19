# 第 9 章：部署——受保护环境、审批与 OIDC

> 本章目标：落地 deploy.yml——受信任分支守卫、environment 审批、逐 job 最小权限、OIDC 短期凭据、版本标识（commit sha）与健康验证；理解「部署权限与 PR 权限分离」。
>
> 关键概念：secrets/environment protection、环境审批、发布标识、OIDC 优先于长期静态密钥。｜ 动手练习：练习 3。

---

## 9.1 部署 job 的四道闸门

```
workflow_dispatch（手动）
   └─ if: github.ref == 'refs/heads/main'     ← 闸门 1：只允许受信任分支
        └─ build-and-push（packages: write）   ← 闸门 2：构建与推送权限只给这个 job
             └─ deploy（environment: production）← 闸门 3：环境审批 + environment secrets
                  └─ 健康验证                   ← 闸门 4：部署后必须证明活着
```

与 PR 验证的对比：**ci.yml 永远碰不到部署秘密**——它没有 environment、没有写权限、fork 也拿不到 secrets。两条权限链物理分离（路线图边界原话）。

## 9.2 environment：审批与秘密的容器

GitHub 仓库 Settings → Environments → New environment `production`：

- **Required reviewers**：添加审批人。deploy job 引用 `environment: production` 后会**暂停等待审批**，批准后才继续；
- **Environment secrets/variables**：`DEPLOY_WEBHOOK_URL`、`AWS_DEPLOY_ROLE_ARN` 等只在该环境可用——比仓库级 secrets 更小的暴露面；
- **Deployment branches**：可限制只有 main 能部署到该环境（与 `if:` 双保险）。

## 9.3 OIDC：用短期凭据替换长期密钥

传统做法：把云的长期 access key 存进 GitHub secrets——**长期有效、泄露即灾难**。OIDC（OpenID Connect）的做法：

> 几个词：**JWT** 是一种带签名的「身份令牌」（一段可验证的 JSON）；**claims** 是令牌里的一条条声明（如「我是哪个仓库/哪个环境」）；**sub**（subject）是其中「我是谁」那条。云侧靠核对 claims 来决定信不信你。

```
job 声明 id-token: write
   → GitHub OIDC provider 为该 job 签发短期 JWT（含 sub/aud/repository/environment 等 claims）
   → 云侧预先配置信任：只接受「本仓库 + production 环境 + main 分支」的 token
   → 云验证 claims 后颁发短期凭据（仅本次 job 有效，自动过期）
```

示例（AWS）：

```yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: aws-actions/configure-aws-credentials@v6
    with:
      role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
      aws-region: ${{ vars.AWS_REGION }}
```

云侧信任策略的 `sub` claim 要**尽可能具体**：`repo:owner/repo:environment:production` 比 `repo:owner/repo:*` 安全得多。注意：2026-07-15 之后新建的仓库默认使用含 owner/repo ID 的不可变 subject 格式，配置信任时以官方 OIDC reference 为准。

**没有 OIDC 的平台**才退回 secrets 静态凭据，并做到：最小权限、定期轮换、只放 environment secrets。

## 9.4 版本标识与健康验证

deploy.yml 的两个关键设计（完整文件见示例）：

1. **镜像 tag = commit sha**（`inputs.image_tag || github.sha`）：线上跑的是哪个 commit，永远可答；回滚 = 用旧 sha 重跑 workflow（第 10 章）；
2. **部署后健康验证**：循环 curl 生产 `/health/ready`（阶段 15 的端点），10 次失败则 job 红——**部署不以「命令执行完」为成功，以「服务真的可用」为成功**。

```yaml
- name: Verify production health
  env:
    HEALTH_URL: ${{ vars.PRODUCTION_HEALTH_URL }}
  run: |
    for i in $(seq 1 10); do
      if curl -fsS "$HEALTH_URL"; then exit 0; fi
      sleep 5
    done
    echo "health check failed — 按第 10 章回滚" >&2
    exit 1
```

## 9.5 常见坑

| 现象                          | 原因                                | 解决                                                 |
| ----------------------------- | ----------------------------------- | ---------------------------------------------------- |
| deploy job 直接跑了，没等审批 | environment 没配 required reviewers | 配置审批人                                           |
| OIDC 报 Not authorized        | 云侧信任的 sub/aud 不匹配           | 核对 claims；绑定 environment                        |
| 任何分支都能触发部署          | 只有 workflow_dispatch 没有 if 守卫 | `if: github.ref == 'refs/heads/main'` + 环境分支限制 |
| 部署「成功」但服务是坏的      | 没有健康验证                        | 9.4 的验证 step                                      |
| secrets 在 PR 里也能读        | 用了仓库级 secrets + 错误的事件     | environment secrets + 权限分离（第 3、7 章）         |

## 9.6 本章验收清单

- [ ] 完成练习 3：deploy.yml 四道闸门齐备，能逐条解释；
- [ ] production environment 配好审批与 secrets，deploy 会暂停等审批；
- [ ] 能解释 OIDC 的 claims 验证流程与 id-token: write；
- [ ] 镜像 tag 与 commit sha 一致，健康验证失败会让 job 红。

---

上一章：[← 第 8 章：artifacts 与 E2E 报告](./08-artifacts-and-e2e.md) ｜ 下一章：[第 10 章：迁移、发布与回滚 →](./10-migrations-release-rollback.md) ｜ 返回：[教程目录 README](./README.md)
