# 第 4 章：job 编排——needs、matrix、concurrency

> 本章目标：用 needs 表达 job 依赖图；用 matrix 做多变体并行；用 concurrency 控制重复 run；掌握 job/step 间传值（outputs / GITHUB_ENV）。
>
> 关键概念：needs、matrix、concurrency。

---

## 4.1 needs：job 的依赖图

默认所有 job **并行**。`needs` 声明依赖：

```yaml
jobs:
  integration:
    runs-on: ubuntu-latest
    steps: [...]
  e2e:
    needs: integration # integration 成功后才跑
    runs-on: ubuntu-latest
    steps: [...]
```

语义细节：

- 依赖**失败则跳过**（不是失败）：e2e 显示 skipped——省 runner，也符合「先单元后 E2E」的成本梯度；
- 需要「无论成败都跑」（如清理/汇总）用 `if: always()`；
- 本教程 main.yml 的 `e2e needs integration` 就是这个梯度：便宜的检查先跑，贵的浏览器测试后跑。

## 4.2 matrix：一份 job 定义，多个变体

```yaml
jobs:
  test:
    strategy:
      fail-fast: false # 一个变体失败不取消其他（默认 true 会取消）
      matrix:
        node: [24, 26]
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ matrix.node }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
```

2×2 = 4 个并行 job。适用：多 Node 版本兼容、多 OS、多浏览器分片。`include`/`exclude` 可增删组合。**代价是 runner 时长翻倍**——本教程示例只用单变体，矩阵作为能力储备。

## 4.3 concurrency：重复 run 的治理

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

- 同 group 的 run **排队或取消**：PR 连续 push 时，旧 run 被取消（`cancel-in-progress: true`），只验证最新代码；
- **main 与部署要 `false`**：每次合并都要完整验证记录；部署取消到一半可能留下半更新状态；
- group 里带 `github.ref`：不同分支互不影响。

三条 workflow 的 concurrency 设计（与示例一致）：

| workflow   | group                  | cancel-in-progress | 理由                   |
| ---------- | ---------------------- | ------------------ | ---------------------- |
| ci.yml     | ci-…-${{ github.ref }} | true               | PR 只关心最新 push     |
| main.yml   | main-${{ github.ref }} | false              | 每次合并都要验证记录   |
| deploy.yml | deploy-production      | false              | 部署串行，绝不中途取消 |

## 4.4 job 与 step 间传值

```yaml
jobs:
  build:
    outputs:
      image_tag: ${{ steps.meta.outputs.tag }} # job output 绑定 step output
    steps:
      - id: meta
        run: echo "tag=${{ inputs.image_tag || github.sha }}" >> "$GITHUB_OUTPUT"
  deploy:
    needs: build
    steps:
      - run: echo "部署 ${{ needs.build.outputs.image_tag }}"
```

- **step → step（同 job）**：`$GITHUB_OUTPUT`（读作 `steps.<id>.outputs.*`）或 `$GITHUB_ENV`（后续 step 的环境变量）；
- **job → job**：`outputs` + `needs.<job>.outputs.*`；
- **文件**：artifacts（第 8 章）——job 之间不共享文件系统。

deploy.yml 的 `image_tag` 正是这条链：手动输入（回滚时填旧 sha）或默认当前 sha → build job 打 tag → deploy job 部署同一个 tag。**发布标识贯穿始终**。

## 4.5 常见坑

| 现象                     | 原因                                | 解决                                  |
| ------------------------ | ----------------------------------- | ------------------------------------- |
| 下游 job 一直 skipped    | 上游失败（needs 的默认语义）        | 看上游日志；确需执行用 `if: always()` |
| 矩阵一个挂全取消         | fail-fast 默认 true                 | `fail-fast: false`                    |
| 部署被新 push 取消到一半 | concurrency 用了 cancel-in-progress | 部署 group 设 false                   |
| needs 引用 outputs 是空  | 上游没声明 outputs / step 没 id     | 按 4.4 的链条逐环检查                 |

## 4.6 本章验收清单

- [ ] 能画出 main.yml 的 job 依赖图并解释 skipped 语义；
- [ ] 能写 matrix 并解释 fail-fast；
- [ ] 能解释三条 workflow 的 concurrency 差异及理由；
- [ ] 能用 outputs 把 image_tag 从 build 传到 deploy。

---

上一章：[← 第 3 章：事件与触发器](./03-events-and-triggers.md) ｜ 下一章：[第 5 章：锁定工具链与缓存 →](./05-toolchain-and-cache.md) ｜ 返回：[教程目录 README](./README.md)
