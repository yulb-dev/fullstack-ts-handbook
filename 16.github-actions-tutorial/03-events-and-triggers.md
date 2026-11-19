# 第 3 章：事件与触发器——什么代码在什么信任级别下运行

> 本章目标：掌握 push / pull_request / workflow_dispatch / schedule 四类触发器与过滤；理解 fork PR 的信任边界（pull_request vs pull_request_target）——这是 CI 安全的第一道分水岭。
>
> 关键概念：event 触发器、fork PR 的不可信代码边界（入门）。

---

## 3.1 四类常用触发器

```yaml
on:
  push:
    branches: [main] # 推送到 main（合并 PR 后）
    paths: ["apps/**", "packages/**", "pnpm-lock.yaml"] # 路径过滤：只改文档不跑
  pull_request: # PR 创建/更新（默认 opened/synchronize/reopened）
    branches: [main] # 目标分支是 main 的 PR
  workflow_dispatch: # 手动触发（可带 inputs，部署用）
    inputs:
      image_tag:
        description: "要部署的镜像 tag"
        required: false
        default: ""
  schedule:
    - cron: "0 2 * * 1" # 每周一 02:00 UTC（定时重建/扫描，阶段 15 的维护节奏）
```

过滤的语义要点：

- `branches` 在 push 里指**被推送的分支**，在 pull_request 里指**目标分支**；
- `paths` / `paths-ignore` 按变更文件过滤——monorepo 里「只改 README 不跑全量 CI」靠它（更精细的 affected 过滤见阶段 14 第 12 章）；
- `schedule` 用 UTC cron，且**只在默认分支生效**。

## 3.2 fork PR：不可信代码的信任边界

这是路线图点名的安全要点。两种 PR 事件的本质区别：

|              | `pull_request`                        | `pull_request_target`                  |
| ------------ | ------------------------------------- | -------------------------------------- |
| 运行的代码   | **PR 合并后的代码**（含 fork 的改动） | **目标分支（base）的代码**             |
| secrets      | fork PR **拿不到**                    | **能拿到**                             |
| GITHUB_TOKEN | 只读                                  | 可写（取决于配置）                     |
| 缓存         | 与 base 隔离                          | **与 base 共享**                       |
| 适用         | 跑测试、构建等验证                    | 需要特权上下文的操作（如给 PR 打标签） |

**致命组合**：`pull_request_target` + checkout PR 的 head 代码 + 执行它。等于「用仓库的 secrets 和写权限，运行陌生人写的代码」——攻击者提一个 PR 就能偷走所有秘密（GitHub Security Lab 称之为 _pwn request_）。

规则：

1. **默认只用 `pull_request`**：fork PR 无 secrets、只读 token，跑测试天然安全；
2. 需要特权时用 `pull_request_target`，但**绝不 checkout/执行不可信代码**；
3. 更复杂的「验证后特权操作」用 `workflow_run` 拆分，并把上游 artifact 当不可信输入审查。

本教程的 ci.yml 只用 `pull_request`，且顶层 `permissions: contents: read`——即使有人提恶意 PR，也读不到任何秘密、写不了任何东西。

## 3.3 事件上下文：github context 速览

workflow 里 `${{ github.* }}` 读取事件上下文，常用的：

| 表达式              | 含义                        | 本教程用途               |
| ------------------- | --------------------------- | ------------------------ |
| `github.ref`        | 完整引用（refs/heads/main） | 部署守卫 `if:`           |
| `github.ref_name`   | 分支名                      | concurrency 分组         |
| `github.sha`        | commit sha                  | 镜像 tag = 发布标识      |
| `github.base_ref`   | PR 目标分支                 | affected 过滤（阶段 14） |
| `github.event_name` | 触发事件名                  | 条件分支                 |
| `github.repository` | owner/repo                  | GHCR 镜像名              |

> **安全提醒**：`github.event.pull_request.title` 等**用户可控字段**绝不能直接插进 `run:` 脚本——脚本注入攻击（第 7 章详解）。

## 3.4 常见坑

| 现象                              | 原因                                 | 解决                                          |
| --------------------------------- | ------------------------------------ | --------------------------------------------- |
| PR 改了文档也跑全量 CI            | 没配 paths 过滤                      | `paths-ignore: ["**/*.md"]` 或 affected 过滤  |
| fork PR 里 secrets 是空           | pull_request 的设计如此              | 正确行为；需要秘密的验证放 main/部署 workflow |
| schedule 不跑                     | cron 在非默认分支 / 仓库 60 天无活动 | 放默认分支；保持活跃                          |
| 用 pull_request_target 跑 PR 测试 | 信任边界错误                         | 改回 pull_request                             |

## 3.5 本章验收清单

- [ ] 能写出带 branches/paths 过滤的 push 与 pull_request 触发；
- [ ] 能解释 pull_request 与 pull_request_target 在代码来源、secrets、token、缓存上的四点差异；
- [ ] 能说出 pwn request 的致命组合并避免它；
- [ ] 知道哪些 github context 字段是用户可控的。

---

上一章：[← 第 2 章：心智模型与第一个 workflow](./02-mental-model-first-workflow.md) ｜ 下一章：[第 4 章：job 编排 →](./04-jobs-needs-matrix-concurrency.md) ｜ 返回：[教程目录 README](./README.md)
