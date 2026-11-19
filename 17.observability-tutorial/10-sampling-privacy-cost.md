# 第 10 章：采样、隐私与成本——让可观测性可持续

> 本章目标：设计 trace/错误采样策略控制成本；系统做隐私脱敏；建立告警阈值与 SLO/错误率/延迟的基本思路。
>
> 关键概念：采样与成本、隐私与安全、告警阈值/SLO/错误率/延迟。

---

## 10.1 为什么不能全量记录

高吞吐服务（每秒数千请求）若无条件记录所有 trace：

- **存储/带宽成本爆炸**：每个 trace 多个 span，全量上报账单惊人；
- **后端过载**：collector/存储被打满；
- **噪声**：99% 的成功 trace 没人看。

原则：**错误全量、性能采样**。出错的请求最有价值，必须留；成功的请求按比例抽样看趋势。

## 10.2 采样策略

| 层              | 配置                                     | 建议                               |
| --------------- | ---------------------------------------- | ---------------------------------- |
| Sentry 性能事务 | `tracesSampleRate`（0~1）                | 生产 0.1 甚至更低                  |
| Sentry 错误     | 默认全量                                 | 错误不采样（或用 beforeSend 限流） |
| OTel trace      | sampler（如 `TraceIdRatioBasedSampler`） | 生产按比例；错误 trace 强制留      |
| 前端 replay     | replaysSessionSampleRate / OnError       | 会话低采样、出错全采               |

OTel 侧本教程本地全量（便于观察），生产可在 NodeSDK 配 `sampler`，或在 **collector 做尾采样**（tail sampling：等 trace 完整后，只保留含错误/慢的 trace）——collector 采样的优势是能看到整条 trace 再决定。

> 注意：本教程 Sentry 关了 tracing（第 9 章），所以 `tracesSampleRate` 不生效；trace 采样归 OTel。若用 Sentry 管 tracing 才配它。

## 10.3 隐私脱敏：三层防线

| 层     | 手段                                                                           |
| ------ | ------------------------------------------------------------------------------ |
| 日志   | Pino redact（authorization/cookie/password/token/secret）                      |
| Sentry | dataCollection 关 userInfo/cookies/httpBodies/urlQueryParams + beforeSend 审查 |
| trace  | span attributes 不放敏感值；collector 脱敏处理器                               |

**审查清单**（路线图要求逐项过）：

- **breadcrumbs**：Sentry 默认记录导航/控制台/请求面包屑——可能含 URL 里的 token、console 打印的敏感值；
- **请求体**：默认可能采集——含密码/个人信息，必须关；
- **source maps**：含源码——上传后删公开 map（第 5 章）；
- **span attributes**：手动 setAttribute 时别放密码/token；
- **日志**：redact 兜底，但最好一开始就不记录。

原则：**遥测数据按「会被很多人看到」对待**——Sentry/Jaeger 的访问权限往往比生产数据库宽。

## 10.4 告警与 SLO 思路

可观测性的终点是「主动发现问题」而非「等用户报障」：

- **SLI**（指标）：错误率（5xx/总请求）、延迟（p95/p99）、可用性；
- **SLO**（目标）：如「99.9% 请求成功、p99 < 500ms」；
- **告警阈值**：错误率突增、p99 超标、某 issue 首次出现（回归）；
- **部署后回归**：新版本发布后盯错误率/延迟（结合阶段 16 的 release 标识）；
- **故障复盘**：每次事故写复盘（第 11 章模板）。

本教程聚焦「能定位」；告警/SLO 是建立在此之上的运营层，思路在此给出，具体阈值按业务定。

## 10.5 常见坑

| 现象                  | 原因                      | 解决                                 |
| --------------------- | ------------------------- | ------------------------------------ |
| 账单爆炸              | trace 全量                | 错误全量 + 性能采样/尾采样           |
| 事件里有密码          | 请求体/breadcrumbs 没审查 | dataCollection + beforeSend + redact |
| 源码泄漏              | map 公开                  | 上传后删                             |
| 告警太多没人看        | 阈值拍脑袋                | 基于 SLO 设阈值；区分症状与原因      |
| 采样把错误 trace 丢了 | 头部按比例采样            | 错误强制留 / 尾采样                  |

## 10.6 本章验收清单

- [ ] 能设计「错误全量、性能采样」策略；
- [ ] 能解释尾采样与头部采样的区别；
- [ ] 三层脱敏防线 + 五项审查清单都落实；
- [ ] 能说出 SLI/SLO/告警的关系与部署后回归思路。

---

上一章：[← 第 9 章：关联与传播](./09-correlation-and-propagation.md) ｜ 下一章：[第 11 章：排障演练与复盘 →](./11-incident-drill.md) ｜ 返回：[教程目录 README](./README.md)
