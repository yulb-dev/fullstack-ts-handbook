# 第 11 章：分支保护与失败定位——让门禁长牙、让失败说话

> 本章目标：完整配置分支保护；掌握 CI 失败的定位工具链（日志、重跑、debug logging、本地 act）；完成练习 4 的完整闭环。
>
> 关键概念：分支保护、required checks。｜ 动手练习：练习 4（完成）。

---

## 11.1 分支保护：把门禁变成强制

Settings → Branches → Add rule（`main`），教学推荐配置：

| 选项                                      | 作用                                      |
| ----------------------------------------- | ----------------------------------------- |
| Require a pull request before merging     | 禁止直推 main，一切变更走 PR              |
| Require approvals (1)                     | 至少一人评审                              |
| Require status checks to pass             | 添加 `quality`（ci.yml 的 job 名）        |
| Require branches to be up to date         | base 变了必须重跑（防「绿 PR 合并后红」） |
| Do not allow bypassing the above settings | 管理员也不豁免（可选但推荐）              |

> 大团队可升级用 **Rulesets**（更细粒度、可叠加）；概念一致。required check 的名字是 **job 名**，不是 workflow 名——这是最常见的配错。

## 11.2 失败定位工具链

按成本从低到高：

1. **读失败 step 的日志**：90% 的答案在最后 50 行。vitest 的断言 diff、tsc 的错误码、pnpm 的 lockfile 报错都足够精确；
2. **Re-run failed jobs**：偶发失败（网络抖动）重跑验证；**连续两次同样失败就不是偶发**，去查代码/环境；
3. **Debug logging**：仓库 secrets 加 `ACTIONS_STEP_DEBUG=true`（或重跑时勾 Enable debug logging），输出每步的详细诊断；
4. **下载 artifacts**：E2E 的 trace/报告（第 8 章）；
5. **本地复现**：`pnpm install --frozen-lockfile && pnpm test` 用与 CI 完全相同的命令；必要时用 [act](https://github.com/nektos/act) 在本地 Docker 里跑 workflow（注意 act 与真实 runner 有差异，适合调脚本不适合验平台行为）。

## 11.3 练习 4 完整闭环

```
1. probe 分支故意改坏状态机（第 6 章）→ PR 红
2. 验证 Merge 按钮禁用（required check 生效）
3. 两次点击定位：quality → test step → 失败断言「done 出终态」
4. 修复 → push → concurrency 取消旧 run → 新 run 绿
5. Merge 按钮解锁 → 合并 → main.yml 接力验证
```

每一步都符合预期，说明门禁「长牙」了：**坏代码进不了 main，且任何人都能快速知道为什么**。

## 11.4 缓存正确性实验（承接第 5 章）

```
仓库 → Actions → Caches → 删除全部缓存
重跑 main workflow → 仍然全绿（只是 Install 变慢）
```

这证明「缓存只是加速器」：正确性来自 frozen lockfile + 测试，不来自缓存。反之，若删缓存后 CI 挂了，说明流程偷偷依赖了缓存里的东西——那是 bug。

## 11.5 常见坑

| 现象                       | 原因                                | 解决                                  |
| -------------------------- | ----------------------------------- | ------------------------------------- |
| 保护规则配了但 PR 还能合并 | check 名不匹配 / 规则没生效于该分支 | 用 job 名；确认分支 pattern           |
| 重跑一直绿但本地红         | 本地与 CI 工具链不一致              | 本地 corepack + frozen，与 CI 对齐    |
| debug 日志没出现           | secret 名错 / 没重跑                | ACTIONS_STEP_DEBUG=true 后重跑        |
| act 跑得过、GitHub 跑不过  | act 与托管 runner 环境差异          | act 只调脚本；平台行为以真实 run 为准 |

## 11.6 本章验收清单

- [ ] main 的保护规则完整，红 PR 无法合并、管理员不豁免；
- [ ] 完成练习 4 五步闭环；
- [ ] 会用重跑/debug logging/artifacts/本地复现四种手段；
- [ ] 完成删缓存实验，CI 仍绿。

---

上一章：[← 第 10 章：迁移、发布与回滚](./10-migrations-release-rollback.md) ｜ 下一章：[第 12 章：综合验收 →](./12-capstone-and-acceptance.md) ｜ 返回：[教程目录 README](./README.md)
