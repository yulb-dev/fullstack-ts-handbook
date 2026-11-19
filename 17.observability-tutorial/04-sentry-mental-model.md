# 第 4 章：Sentry 心智模型

> 本章目标：理解 Sentry 的核心概念——错误事件、issue grouping、release/environment、DSN、性能事务与采样；建立「Sentry 管错误、OTel 管 trace」的分工认知。
>
> 关键概念：Sentry 的错误事件、issue grouping、release/environment、source maps、性能事务与采样。

---

## 4.1 Sentry 是什么

Sentry 是**错误监控与性能追踪平台**。SDK 在应用里捕获异常/性能数据，发送到 Sentry 服务端，聚合成可检索、可告警的 issue。它回答「哪里出错、影响谁、从哪个版本开始」。

## 4.2 核心概念

| 概念                 | 含义                                                                |
| -------------------- | ------------------------------------------------------------------- |
| 事件 Event           | 一次错误/性能上报（含堆栈、上下文、标签）                           |
| Issue                | 相似事件的聚合（grouping）——同一个 bug 的 1000 次发生归为一个 issue |
| DSN                  | 项目的上报地址（含公钥），告诉 SDK「发到哪个项目」                  |
| release              | 版本标识（本教程用 commit sha / APP_VERSION）——「哪个版本引入的」   |
| environment          | 环境（development/staging/production）——「在哪个环境」              |
| source maps          | 把压缩后的堆栈还原成源码位置                                        |
| 性能事务 Transaction | 一次操作的耗时追踪（与 OTel trace 有重叠，需分工，第 9 章）         |
| 采样 Sampling        | 只上报一部分事件/事务，控制成本                                     |

## 4.3 issue grouping：为什么 1000 次报错是一个 issue

Sentry 按堆栈指纹把相似事件聚合成 issue。意义：

- 你看到的是「这个 bug 发生了 1000 次、影响 200 用户、从 release abc 开始」，而不是 1000 条噪声；
- **release 让回归可定位**：「这个 issue 首次出现在 release xyz」→ 直接锁定那次发布；
- **environment 让噪声隔离**：development 的测试错误不该和 production 混在一起。

这就是为什么 release/environment 必须正确配置（练习 1 的验收点）。

## 4.4 DSN 与隐私

DSN 形如 `https://<公钥>@o<org>.ingest.sentry.io/<project>`。它含**公钥**，可以放前端（浏览器 SDK 需要它）。但：

- DSN 不是秘密，**SENTRY_AUTH_TOKEN（上传 source maps 用）才是秘密**，绝不放前端；
- 事件默认会带用户身份/请求体等——必须用 `dataCollection` 关闭敏感采集（第 6、10 章）。

## 4.5 Sentry 与 OTel 的分工（关键认知）

Sentry v8+ 底层用 OTel 做 tracing；v11 进一步允许「OTel 拥有 tracing，Sentry 只管错误」。两种模式：

| 模式                          | 配置                                                                                    | 适用                     |
| ----------------------------- | --------------------------------------------------------------------------------------- | ------------------------ |
| Sentry 管 tracing             | 默认 init + tracesSampleRate                                                            | 只用 Sentry、不另接 OTel |
| **OTel 管 tracing**（本教程） | `enableOpenTelemetrySetup: false` + `openTelemetryIntegration()`，不设 tracesSampleRate | 已有/要用 OTel 管线      |

本教程选第二种：trace 导出到自己的 collector/Jaeger，Sentry 只收错误并关联到活跃 span。**避免同一个请求被插桩两遍**（路线图核心概念⑧，第 9 章详解）。

## 4.6 常见坑

| 现象                 | 原因                                   | 解决                                       |
| -------------------- | -------------------------------------- | ------------------------------------------ |
| 找不到自己触发的错误 | environment/release 没配，混进别的环境 | 正确配置 environment + release             |
| 堆栈是压缩代码       | 没上传 source maps                     | 第 5 章上传策略                            |
| 同一请求两套 span    | Sentry 与 OTel 都开了 tracing          | enableOpenTelemetrySetup: false（第 9 章） |
| 事件里有用户密码     | 默认采集请求体                         | dataCollection 关闭（第 6、10 章）         |

## 4.7 本章验收清单

- [ ] 能解释事件/issue/grouping/release/environment/DSN；
- [ ] 能解释 release 如何定位回归；
- [ ] 能区分 DSN（公钥）与 AUTH_TOKEN（秘密）；
- [ ] 能说出 Sentry 与 OTel 的两种分工模式及本教程的选择。

---

上一章：[← 第 3 章：requestId 与错误 envelope](./03-request-id-error-envelope.md) ｜ 下一章：[第 5 章：Sentry 前端接入 →](./05-sentry-react.md) ｜ 返回：[教程目录 README](./README.md)
