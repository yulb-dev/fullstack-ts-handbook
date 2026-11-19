# 第 6 章：PR 质量门禁——五道检查与合并闸门

> 本章目标：落地 ci.yml（format/lint/typecheck/test/build）；理解每道检查证明什么；把门禁配成分支保护的 required checks；完成「故意失败」实验（练习 1、4）。
>
> 关键概念：CI 质量门禁。｜ 动手练习：练习 1、练习 4（起步）。

---

## 6.1 五道检查各自证明什么

| 检查      | 命令                | 证明什么                               | 失败意味着        |
| --------- | ------------------- | -------------------------------------- | ----------------- |
| format    | `pnpm format:check` | 风格一致（prettier）                   | 有人没跑格式化    |
| lint      | `pnpm lint`         | 静态规则（eslint + typescript-eslint） | 可疑模式/未用变量 |
| typecheck | `pnpm typecheck`    | 类型契约（tsc --noEmit）               | 类型漂移          |
| test      | `pnpm test`         | 行为正确（vitest：单元 + inject 集成） | 回归              |
| build     | `pnpm build`        | 可构建（tsc emit + vite build）        | 产物坏了          |

顺序按**成本递增**：格式秒级、构建分钟级。便宜的先跑，失败早暴露。示例的 test 覆盖 shared 纯函数边界（状态机/分页）与 api 的 2xx/400/404/409 路径——**门禁的价值取决于测试覆盖失败路径的程度**（阶段 12 的原则）。

## 6.2 完整 ci.yml

与示例工程一致：

```yaml
name: CI
on:
  pull_request:

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: pnpm
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Format
        run: pnpm format:check
      - name: Lint
        run: pnpm lint
      - name: Typecheck
        run: pnpm typecheck
      - name: Unit & integration tests
        run: pnpm test
      - name: Build
        run: pnpm build
```

设计要点：只用 `pull_request`（fork 安全，第 3 章）；顶层只读权限（第 7 章）；每个检查独立 step——**失败时 UI 直接指出是哪道检查**，而不是混在一个大脚本里。

## 6.3 配成 required checks（合并闸门）

workflow 跑绿只是「有检查」；**阻止合并**需要分支保护（第 11 章详解配置）：

```
Settings → Branches → Add branch protection rule（main）
  ✓ Require a pull request before merging
  ✓ Require status checks to pass before merging
      → 搜索并添加 "quality"（job 名）
  ✓ Require branches to be up to date before merging
```

配好后，PR 页面的 Merge 按钮在 quality 绿之前是灰的——**门禁从「自觉」变成「强制」**。

## 6.4 练习 1 + 4：跑通门禁并故意弄红它

```bash
# 练习 1：把 example 推成独立仓库，开一个 PR（哪怕只改一行注释）
# → Actions 页签看到 CI run，五道检查依次绿

# 练习 4：故意制造失败
git checkout -b probe/break-ci
# 在 packages/shared/src/index.ts 把 canTransition 的 done 终态改坏：
#   done: ["todo"],   ← 让「done 出终态」测试失败
git commit -am "probe: break state machine" && git push
# 开 PR → quality 红 → 点进 test step → 日志精确指出哪个测试、期望什么、实际什么
# 同时 PR 页面 Merge 按钮被禁用（required check 未过）
```

**定位演练**：从红叉到根因的路径应该是「PR 页 → quality job → test step → 失败断言」，全程不超过两次点击。这就是「失败可定位」。

## 6.5 常见坑

| 现象                              | 原因                              | 解决                                         |
| --------------------------------- | --------------------------------- | -------------------------------------------- |
| required check 一直 pending       | 保护规则里的名字与 job 名不匹配   | 用 job 名（quality），不是 workflow 名（CI） |
| 门禁绿但合并后 main 红            | 没要求分支最新（base 变了没重跑） | 勾 Require branches to be up to date         |
| format 检查在 CI 红、本地绿       | 本地没跑 prettier --write         | 提交前 `pnpm format`；或加 pre-commit 钩子   |
| 所有检查挤一个 step，失败不知哪道 | 图省事合并 run                    | 每道检查独立 step                            |

## 6.6 本章验收清单

- [ ] 完成练习 1：PR 触发五道检查并全绿；
- [ ] main 配好 required checks，红 PR 无法合并；
- [ ] 完成练习 4：故意失败 → 两次点击内定位到失败断言；
- [ ] 能说出五道检查各自证明什么。

---

上一章：[← 第 5 章：锁定工具链与缓存](./05-toolchain-and-cache.md) ｜ 下一章：[第 7 章：权限、秘密与 fork 安全 →](./07-permissions-secrets-security.md) ｜ 返回：[教程目录 README](./README.md)
