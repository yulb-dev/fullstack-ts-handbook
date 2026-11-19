# 第 11 章：排障演练与复盘——「创建任务失败」全链路定位

> 本章目标：完成一次完整的排障演练（练习 4）——从 UI 错误定位到 API 请求、trace、DB 操作与权限判断；写出故障复盘。
>
> 对应练习：**练习 4。** 对应通过标准：**至少一个关键业务流程可串联定位 + 一份短故障复盘。**

---

## 11.1 演练 setup

```bash
cd 17.observability-tutorial/example
pnpm smoke:api          # console span + 内存仓储（零配置）
# 另开终端起前端：pnpm --filter @workboard/web dev
```

故障注入：创建任务时标题输入 `FAIL_DB`——仓储模拟数据库故障（`repository.ts` 抛错）。这是**可控的故障注入**，让排障路径可重复演练。

## 11.2 全链路定位（六步）

```
=== 第 1 步：UI 现象 ===
页面显示「INTERNAL_ERROR: 服务器内部错误（requestId: req-2）」
→ 拿到 requestId: req-2（前端从 envelope 读取并显示）

=== 第 2 步：Sentry 事件 ===
前端 captureException 带 tags.requestId=req-2
→ Sentry 按 requestId 搜到事件，看堆栈与 release/environment

=== 第 3 步：后端日志 ===
按 reqId=req-2 过滤日志：
{"level":50,"reqId":"req-2","trace_id":"d9ae...","statusCode":500,"code":"INTERNAL_ERROR","err":{...stack...}}
→ 拿到 trace_id 与内部错误堆栈（envelope 不泄漏，日志里有）

=== 第 4 步：trace ===
按 trace_id 在 Jaeger（或 console span）找 trace：
POST（server span）→ task.create（ERROR 状态 + exception 事件）
→ 看出错在 task.create 这段业务操作

=== 第 5 步：DB 操作 ===
task.create span 的 exception：simulated database outage
（真实 PG 场景：pg client span 会显示具体 SQL 与错误）
→ 定位到数据库写入失败

=== 第 6 步：权限判断（另一条失败路径）===
带 x-demo-role: viewer 创建 → 403 FORBIDDEN
日志：{"level":40,"reqId":"req-3","role":"viewer","msg":"authorization denied"}
→ 区分「权限拒绝」（4xx，预期）与「系统故障」（5xx，异常）
```

**关键**：每一步都用上一步拿到的 ID（requestId → trace_id）跳转，而不是盲目翻日志。这就是「串联定位」。

## 11.3 为什么这条链成立

| 跳转          | 靠的关联               | 哪章建立   |
| ------------- | ---------------------- | ---------- |
| UI → Sentry   | tags.requestId         | 第 5 章    |
| Sentry → 日志 | requestId == reqId     | 第 3、6 章 |
| 日志 → trace  | trace_id（mixin 注入） | 第 2、9 章 |
| trace → DB    | span 树 + exception    | 第 8 章    |

缺任何一环，链就断。这正是路线图「错误、日志与 trace 不只是各自存在」的含义。

## 11.4 故障复盘模板

演练后写一份短复盘（路线图通过标准要求）：

```markdown
## 故障复盘：创建任务失败

- 症状：用户创建任务返回 500，页面显示 INTERNAL_ERROR
- 影响：创建任务功能不可用；读功能正常；影响所有写请求
- 根因：数据库连接中断（演练为 FAIL_DB 注入；真实场景如连接池耗尽/网络抖动）
- 定位路径：requestId req-2 → 日志 trace_id d9ae → task.create span ERROR → DB 写入异常
- 修复：恢复数据库连接；连接池加超时与重试；readiness 摘流量
- 预防：
  1. DB 连接池监控 + 告警（错误率突增）
  2. readiness 探针覆盖 DB（阶段 15），故障时自动摘流量
  3. 写路径加幂等键，避免重试重复创建（阶段 11）
  4. 定期演练本排障路径，确保关联不断
```

复盘的五要素：**症状、影响、根因、修复、预防**。重点在「预防」——把这次故障变成下次的护栏。

## 11.5 常见坑

| 现象                               | 原因                      | 解决                                  |
| ---------------------------------- | ------------------------- | ------------------------------------- |
| 拿到 requestId 却搜不到日志        | 日志没带 reqId / 查错环境 | 确认结构化日志 + environment          |
| 日志有 trace_id 但 Jaeger 没 trace | 采样丢了 / exporter 没配  | 错误 trace 强制留；检查 OTLP endpoint |
| 分不清 4xx 与 5xx                  | 错误码不规范              | 稳定 code 枚举；4xx 不刷 Sentry       |
| 复盘只写「修好了」                 | 缺预防                    | 五要素齐全，预防落到护栏              |

## 11.6 本章验收清单

- [ ] 完成练习 4：六步全链路定位，每步用上一步的 ID；
- [ ] 能区分权限拒绝（4xx）与系统故障（5xx）的观测差异；
- [ ] 写出一份五要素齐全的故障复盘；
- [ ] 能解释这条链每一环靠什么关联。

---

上一章：[← 第 10 章：采样、隐私与成本](./10-sampling-privacy-cost.md) ｜ 下一章：[第 12 章：综合验收 →](./12-capstone-and-acceptance.md) ｜ 返回：[教程目录 README](./README.md)
