# 第 5 章：锁定工具链与缓存——全新 runner 的可复现安装

> 本章目标：用 packageManager + pnpm/action-setup + setup-node 锁定工具链；frozen lockfile 保证依赖一致；配置 pnpm store 缓存加速；牢记「缓存加速但不保正确性」。
>
> 关键概念：锁定 pnpm/Node 版本、frozen lockfile、cache 加速但不依赖缓存保障正确性。

---

## 5.1 工具链三件套

CI 的第一条军规：**runner 上的 Node 与 pnpm 版本必须与仓库声明一致**，而不是「runner 预装了什么就用什么」。

```yaml
- uses: actions/checkout@v7
- uses: pnpm/action-setup@v6 # 读 package.json 的 packageManager: pnpm@12.11.2
- uses: actions/setup-node@v7
  with:
    node-version: 24 # 与 engines / 本地一致
    cache: pnpm # 内置 pnpm store 缓存
- run: pnpm install --frozen-lockfile
```

顺序有讲究：**action-setup 必须在 setup-node 之前**——`cache: pnpm` 需要调用 `pnpm store path` 定位缓存目录，pnpm 不在就报错。

> 版本演进提示：`setup-node` v6 起，只有 npm 项目自动启用缓存，pnpm/yarn 必须显式 `cache:`；另有新的 `pnpm/setup@v1` 可一步装 pnpm + Node（要求 pnpm ≥11）。本教程用「action-setup + setup-node」组合，因为它对 pnpm 12 与缓存的控制最直白。

## 5.2 frozen lockfile：可复现的护栏

**lockfile（锁文件，如 `pnpm-lock.yaml`）**记录每个依赖的精确版本，是「依赖树的唯一真相」（阶段 14 详讲）。

`pnpm install --frozen-lockfile`：package.json 与 lockfile 不一致 → **直接失败**。它把「依赖树」钉死在仓库声明上：

- 全新 runner 装出的依赖树 = 你本地的依赖树 = 上次 CI 的依赖树；
- 有人改了 package.json 忘提交 lockfile → CI 立刻红，而不是悄悄装出新版本。

**验证实验**：本地改 `apps/api/package.json` 加一个依赖但不更新 lockfile，推 PR → Install 步失败，日志明确报 lockfile 不匹配。这就是「不依赖个人机器缓存」的直接证据。

## 5.3 缓存：加速，不是正确性来源

`cache: pnpm` 背后是 actions/cache：以 lockfile 哈希为 key 缓存 pnpm store。命中 → 跳过下载；未命中 → 全量下载后保存。

手动等价写法（理解原理用）：

```yaml
- name: pnpm store path
  id: pnpm-cache
  run: echo "dir=$(pnpm store path)" >> "$GITHUB_OUTPUT"
- uses: actions/cache@v6
  with:
    path: ${{ steps.pnpm-cache.outputs.dir }}
    key: ${{ runner.os }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}
    restore-keys: ${{ runner.os }}-pnpm-
```

三条原则（路线图原话的展开）：

1. **key 必须绑定 lockfile 哈希**：依赖变了 key 就变，否则用旧依赖；
2. **缓存命中 ≠ 构建正确**：正确性由 frozen + 测试保证。删掉缓存 CI 也必须能跑（只是慢）——第 11 章会做这个实验；
3. **绝不把秘密放进缓存**：缓存可能被其他分支甚至不可信工作流读取（第 7 章）。

## 5.4 与 Turborepo 缓存的分工（承接阶段 14）

|          | Actions cache（本章）       | Turborepo 缓存（阶段 14）         |
| -------- | --------------------------- | --------------------------------- |
| 缓存什么 | pnpm store（依赖包）        | 任务产物与日志（build/test 输出） |
| 命中前提 | 你给的 key（lockfile 哈希） | 任务 hash（inputs+env+依赖+配置） |
| 收益     | 少下载                      | 少重跑                            |

两者叠加：CI 先恢复依赖（本章），turbo 再恢复任务产物。本教程示例不用 turbo，把 Actions 侧讲透；叠加方式见阶段 14 第 12 章。

## 5.5 常见坑

| 现象                                | 原因                                        | 解决                                                  |
| ----------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| `Unable to locate executable: pnpm` | setup-node 在 action-setup 之前             | 调整顺序                                              |
| CI 装出与本地不同的版本             | 没用 frozen / lockfile 没提交               | frozen + 提交 lockfile                                |
| 缓存命中但依赖是旧的                | key 没绑 lockfile                           | `hashFiles('pnpm-lock.yaml')`                         |
| pnpm 版本与本地不一致               | 没写 packageManager / action 指定了别的版本 | packageManager 字段 + action-setup 省略 version       |
| `ERR_PNPM_IGNORED_BUILDS`           | pnpm 10+ 默认不跑安装脚本                   | pnpm-workspace.yaml 的 allowBuilds（阶段 14/15 同款） |

## 5.6 本章验收清单

- [ ] 三件套顺序正确，CI 日志显示 pnpm 12.11.2 / Node 24；
- [ ] 完成 frozen lockfile 失败实验；
- [ ] 能解释 cache key 为什么绑 lockfile、为什么缓存不保正确性；
- [ ] 能区分 Actions cache 与 Turbo 缓存。

---

上一章：[← 第 4 章：job 编排](./04-jobs-needs-matrix-concurrency.md) ｜ 下一章：[第 6 章：PR 质量门禁 →](./06-pr-quality-gates.md) ｜ 返回：[教程目录 README](./README.md)
