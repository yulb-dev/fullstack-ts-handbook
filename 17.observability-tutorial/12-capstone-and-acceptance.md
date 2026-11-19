# 第 12 章：综合验收

> 本章目标：对照路线图阶段 17 的每一条核心概念、动手练习与通过标准给出可验证证据；确认排障闭环成立。
>
> 关键概念：本章串联全部八条核心概念。｜ 动手练习：全部四个。

---

## 12.1 综合演练

```bash
cd 17.observability-tutorial/example
pnpm install && pnpm test          # 10 个测试：失败路径 + span + 日志关联
pnpm typecheck && pnpm build

# 练习 2、3：结构化日志 + server span
pnpm smoke:api
curl -X POST http://localhost:3000/api/tasks -H 'content-type: application/json' -d '{"title":"FAIL_DB"}'
# 验证：JSON 日志含 reqId/trace_id/span_id；console 打印 POST + task.create(ERROR) span

# 练习 1：前端异常（配 VITE_SENTRY_DSN 后真实上报）
pnpm --filter @workboard/web dev   # 点「触发前端渲染异常」

# 练习 4：第 11 章六步排障演练 + 复盘

# 完整 trace 后端（需 Docker）
docker compose up --build -d      # Jaeger http://localhost:16686
```

## 12.2 逐项验收：对照路线图给出证据

### 核心概念清单

| 核心概念                                                                           | 证据（章节 / 文件）                               | ✓   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------- | --- |
| Sentry：错误事件、issue grouping、release/environment、source maps、性能事务与采样 | 第 4~6 章 + instrument.ts + vite.config.ts        | ☐   |
| OTel：API/SDK、traces/spans、attributes/resources、propagation、exporter/collector | 第 7、8 章 + instrumentation.ts + collector 配置  | ☐   |
| 日志、指标、追踪的区别                                                             | 第 1 章三支柱表 + 第 10 章 SLI/SLO                | ☐   |
| Fastify/Pino 结构化日志：requestId/route/duration/statusCode/error code            | 第 2、3 章 + logger.ts + 实测日志                 | ☐   |
| 前后端关联：浏览器 trace/请求头/后端 span/requestId                                | 第 9 章 + tags.requestId + mixin trace_id         | ☐   |
| 采样与成本                                                                         | 第 10 章采样策略 + 尾采样                         | ☐   |
| 隐私与安全：屏蔽 token/Cookie/密码/个人信息；审查 breadcrumbs/请求体/source maps   | 第 2、6、10 章 redact + dataCollection + 审查清单 | ☐   |
| 告警阈值、SLO/错误率/延迟、部署后回归与复盘                                        | 第 10 章 SLO 思路 + 第 11 章复盘                  | ☐   |
| 避免重复 instrumentation，明确 Sentry 与 OTel 范围                                 | 第 9 章 enableOpenTelemetrySetup:false + 范围表   | ☐   |

### 动手练习

| 练习                                                         | 证据                           | ✓   |
| ------------------------------------------------------------ | ------------------------------ | --- |
| 练习 1：前端异常按 release/environment 在 Sentry 找到        | 第 5 章 + App.tsx Boom 按钮    | ☐   |
| 练习 2：Fastify 结构化日志，requestId 入错误响应与日志       | 第 3 章 + app.test.ts 同源断言 | ☐   |
| 练习 3：OTel instrument API 看到 server span，导出可检查后端 | 第 8 章 + console/Jaeger       | ☐   |
| 练习 4：创建任务失败排障演练 UI→API→trace→DB→权限            | 第 11 章六步                   | ☐   |

### 通过标准

| 通过标准                                                       | 证据                               | ✓   |
| -------------------------------------------------------------- | ---------------------------------- | --- |
| 至少一个关键业务流程可串联定位                                 | 第 11 章创建任务链路 + 第 9 章关联 | ☐   |
| Sentry 环境/release 正确，source maps 策略清楚，无凭据泄露     | 第 5、6、10 章                     | ☐   |
| 能解释 trace/span、attributes、sampling、requestId、错误码用途 | 第 7、9、10 章                     | ☐   |
| 有一份短故障复盘：症状/影响/根因/修复/预防                     | 第 11 章复盘模板                   | ☐   |

## 12.3 常见坑（全局层面）

| 现象                   | 原因                       | 解决                                |
| ---------------------- | -------------------------- | ----------------------------------- |
| 三个工具都装了但串不起 | 缺 requestId/trace_id 关联 | 第 9 章；用测试钉死                 |
| 排障靠翻海量日志       | 无结构化字段               | 第 2、3 章                          |
| 遥测泄密               | 未脱敏                     | 第 10 章三层防线                    |
| 升级后插桩失效         | 版本支持矩阵变化           | 第 8 章；升级前复核（路线图附录 B） |

## 12.4 本章（及全教程）验收清单

- [ ] 完成 12.1 综合演练；
- [ ] 对照 12.2 逐条打勾，每项有证据；
- [ ] 能向同事演示一次完整的串联定位；
- [ ] 有一份故障复盘。

---

## 结语：你已经拥有的能力

走完这 12 章，「出错了」不再是终点，而是四个有答案的问题：

- **哪里出错**：Sentry 事件按 release/environment 聚合，堆栈经 source maps 还原；
- **影响谁**：requestId + 脱敏后的标签；
- **经过哪些服务**：OTel trace 从 server span 到业务 span 到 DB span；
- **如何复现**：结构化日志 + trace + envelope 由 requestId/trace_id 串联，附复盘。

并且你守住了两条红线：隐私脱敏、避免重复 instrumentation。

至此，路线图第五部分（工程化、部署、可观测性）全部完成。第六部分的毕业项目 Workboard 将综合运用全部 17 个阶段——从 React 前端到 Fastify 后端、从数据库到鉴权、从测试到 CI/CD、从容器到可观测性——交付一个真正可运维的全栈系统。

---

上一章：[← 第 11 章：排障演练与复盘](./11-incident-drill.md) ｜ 返回：[教程目录 README](./README.md)
