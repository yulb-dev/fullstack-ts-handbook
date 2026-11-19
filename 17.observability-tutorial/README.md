# Sentry + OpenTelemetry + 结构化日志：从 0 到 1 建立可排障的全栈应用

你的应用已经能登录、能 CRUD、有测试、有 CI、能部署。但上线后的第一个深夜告警会把你打回原形：

- 用户说「创建任务失败了」，你问「什么时候、哪个账号、报什么错」——**一问三不知**；
- 日志里只有一句 `Error: something went wrong`，没有 requestId、没有 trace，**无法定位是哪次请求**；
- 前端 Sentry 报了一个错，后端日志里翻不到对应请求——**前后端各说各话**；
- 装了 Sentry 又装了 OTel，结果同一个请求被插桩两遍，**span 重复、数据打架**；
- 错误事件里带着用户的 Cookie 和请求体里的密码——**排障工具变成了泄密源**；
- 高吞吐服务无条件记录所有 trace，**账单爆炸**。

这些问题的共同根源：**「出错了」没有被升级成可回答的问题**。

这份教程带你为贯穿项目 **Workboard** 建立排障闭环，让任何一次故障都能回答四个问题：

```
哪里出错？   → Sentry 错误事件（release / environment / 堆栈）
影响谁？     → requestId + 用户/租户标签（脱敏后）
经过哪些服务？→ OpenTelemetry trace（server span → 业务 span → DB span）
如何复现？   → 结构化日志 + trace + 错误 envelope 串联，附故障复盘
```

并守住两条红线：**隐私脱敏**（token/Cookie/密码/个人信息不进遥测）与**避免重复 instrumentation**（Sentry 管错误、OTel 管 trace，分工明确）。

---

## 学完之后你将能够

1. 说清**日志、指标、追踪**三支柱的区别：事件细节、聚合趋势、一次请求跨服务的因果链；
2. 用 **Fastify 内置 Pino** 输出结构化日志：requestId、route、duration、statusCode、error code 等可查询字段，并做 **redact 脱敏**；
3. 让 **requestId 贯穿三处**：响应头 `x-request-id`、错误 envelope、日志字段（同一来源）；
4. 接入 **Sentry**：错误事件、issue grouping、release/environment、source maps 上传策略、性能事务与采样；前端 React 19 错误钩子 + ErrorBoundary，后端显式捕获并打 requestId tag；
5. 接入 **OpenTelemetry**：API/SDK、trace/span、attributes/resources、context propagation、exporter 与 collector；用 NodeSDK + 自动插桩看到 server span，用手动 span 标注业务操作；
6. **关联前后端**：日志注入 trace_id/span_id，Sentry 事件带 requestId tag，理解 sentry-trace/baggage 与 traceparent 的传播取舍；
7. 设计**采样与成本策略**，做**隐私脱敏**，建立**告警阈值/SLO/错误率/延迟**的基本思路；
8. **避免重复 instrumentation**：Sentry `enableOpenTelemetrySetup: false` + `openTelemetryIntegration()`，OTel 拥有 tracing；
9. 完成一次**「创建任务失败」排障演练**并写出故障复盘。

---

## 版本说明（2026 年 11 月核对）

示例工程已在本机全量验证：typecheck、10 个测试（含 span 与日志关联断言）、build、以及 dev/生产两条启动路径的真实 span 输出与优雅关闭。Sentry 真实上报与 Jaeger 可视化需要账号/Docker，配置按官方文档核对。

| 组件                         | 版本       | 说明                                               |
| ---------------------------- | ---------- | -------------------------------------------------- |
| Node.js                      | 24         | 与全库口径一致                                     |
| Fastify                      | 5          | 内置 Pino 9/10                                     |
| @sentry/node / @sentry/react | 11.13      | v11：OTel 分工用 `enableOpenTelemetrySetup` 控制   |
| @opentelemetry/api           | 1.10       | API 与 SDK 分离                                    |
| @opentelemetry/sdk-node      | 0.301      | NodeSDK 一站式初始化                               |
| @opentelemetry/sdk-trace     | 3.1        | **3.x：span processor 构造器改为 options 对象**    |
| @opentelemetry/resources     | 3.1        | `resourceFromAttributes`                           |
| auto-instrumentations-node   | 0.83       | http/pg/dns 等；**fastify 插桩仅支持 Fastify 3/4** |
| @sentry/vite-plugin          | 11.13      | source maps 上传（env 门控）                       |
| Vite / React / Vitest        | 8 / 19 / 5 | 前端与测试                                         |

> **三个容易踩的版本坑（都是本教程实测踩到的）**
>
> 1. **OTel JS 各信号成熟度不一致**：traces/metrics 已 Stable，logs 仍 Development，浏览器插桩 experimental。不要假定三者 API 成熟度相同（路线图边界原话）。
> 2. **`@opentelemetry/sdk-trace` 3.x 的 `SimpleSpanProcessor`/`BatchSpanProcessor` 构造器改为 `{ exporter }` 对象**，旧教程的 `new SimpleSpanProcessor(exporter)` 会类型报错且运行时不导出。
> 3. **`@opentelemetry/instrumentation-fastify` 当前仅支持 Fastify 3/4**，对 Fastify 5 静默不生效。http 自动插桩已提供 server span，业务细节用手动 span 补充。

---

## 适合谁

- 已完成阶段 7（Fastify）、15（Docker）、16（CI/CD）的读者最佳；
- 听说过 Sentry/OTel 但没接过，或接了却「各装各的、串不起来」的人；
- 想为团队建立「故障可定位、隐私不泄漏、成本可控」可观测性体系的人。

---

## 贯穿项目：Workboard（可观测性切片）

配套 `example/` 零配置可本地演练（无需 Sentry 账号/Docker）：

```
example/
├── apps/
│   ├── api/
│   │   ├── src/instrumentation.ts   # OTel NodeSDK + Sentry 分工初始化（--import 先加载）
│   │   ├── src/logger.ts            # Pino mixin 注入 trace_id/span_id + redact 脱敏
│   │   ├── src/app.ts               # requestId 贯穿 + 手动 task.create span + 错误捕获
│   │   ├── src/repository.ts        # 内存/PG 双仓储（FAIL_DB 故障注入）
│   │   └── test/                    # 10 个测试：失败路径 + span + 日志关联
│   └── web/
│       ├── src/instrument.ts        # Sentry React 初始化
│       └── src/App.tsx              # requestId 关联上报 + ErrorBoundary + 故障按钮
├── docker/api.Dockerfile            # CMD 带 OTel ESM hook
├── compose.yaml                     # API + Postgres + Collector + Jaeger
├── otel-collector-config.yaml       # OTLP → Jaeger
└── .env.example                     # 全部可选，零配置可跑
```

---

## 章节目录

| 章节     | 标题                                                           | 你将掌握                                                       | 对应核心概念 |
| -------- | -------------------------------------------------------------- | -------------------------------------------------------------- | ------------ |
| 第 1 章  | [可观测性是什么](./01-why-observability.md)                    | 可观测性/Sentry/OTel 是什么、三支柱区别                        | ③            |
| 第 2 章  | [结构化日志与 Pino](./02-structured-logging-pino.md)           | 可查询字段、redact、子 logger                                  | ④            |
| 第 3 章  | [requestId 与错误 envelope](./03-request-id-error-envelope.md) | requestId 贯穿三处、错误契约、测试                             | ④ · 练习 2   |
| 第 4 章  | [Sentry 心智模型](./04-sentry-mental-model.md)                 | 事件/issue grouping/release/environment/DSN                    | ①            |
| 第 5 章  | [Sentry 前端接入](./05-sentry-react.md)                        | React 19 错误钩子、ErrorBoundary、source maps                  | ① · 练习 1   |
| 第 6 章  | [Sentry 后端接入](./06-sentry-node.md)                         | 显式捕获 + requestId tag、隐私 dataCollection                  | ① ⑦          |
| 第 7 章  | [OpenTelemetry 心智模型](./07-otel-mental-model.md)            | trace/span/attributes/resources/propagation/exporter/collector | ②            |
| 第 8 章  | [OTel Node 插桩实战](./08-otel-node-instrumentation.md)        | NodeSDK、ESM hook、手动 span、版本坑                           | ② · 练习 3   |
| 第 9 章  | [关联与传播](./09-correlation-and-propagation.md)              | 日志↔trace↔Sentry、前后端传播、避免重复插桩                    | ⑤ ⑧          |
| 第 10 章 | [采样、隐私与成本](./10-sampling-privacy-cost.md)              | 采样策略、脱敏、告警/SLO                                       | ⑥ ⑦          |
| 第 11 章 | [排障演练与复盘](./11-incident-drill.md)                       | 创建任务失败全链路定位、复盘模板                               | · 练习 4     |
| 第 12 章 | [综合验收](./12-capstone-and-acceptance.md)                    | 逐项验收                                                       | 全部         |

## 学习路线建议

```
第 1 章（三支柱）★ 先分清日志/指标/追踪
   └─> 第 2、3 章（结构化日志 + requestId）★ 最便宜、最先做
         └─> 第 4~6 章（Sentry 错误监控）★ 练习 1、2
               └─> 第 7、8 章（OTel trace）★ 练习 3
                     └─> 第 9 章（关联）★ 把三者串起来的关键
                           └─> 第 10 章（采样/隐私/成本）★ 红线
                                 └─> 第 11 章（排障演练）★ 练习 4
                                       └─> 第 12 章（综合验收）
```

- 第 2、3 章是地基（没有结构化日志和 requestId，后面都串不起来）；
- 第 9 章是「闭环」的核心，第 10 章是安全红线，都值得反复读。

---

## 逐项验收清单（总表）

以下条目直接对应路线图阶段 17 的核心概念清单。第 12 章给出每项证据。

### ① Sentry：错误事件、issue grouping、release/environment、source maps、性能事务与采样

- [ ] 能解释事件如何聚合成 issue、release/environment 的作用；
- [ ] 前端异常按 release/environment 在 Sentry 找到（练习 1）；
- [ ] source maps 上传策略清楚（生成→上传→删公开 map）。

### ② OTel：API/SDK、traces/spans、attributes/resources、context propagation、exporter 与 collector

- [ ] 能解释这些概念及彼此关系；
- [ ] instrument 一条 API 请求看到 server span，按环境导出到可检查后端（练习 3）。

### ③ 日志、指标、追踪的区别

- [ ] 能说出三者各自回答什么问题。

### ④ Fastify/Pino 结构化日志

- [ ] 日志含 requestId/route/duration/statusCode/error code；
- [ ] requestId 写入错误响应与日志字段（练习 2）。

### ⑤ 前后端关联

- [ ] 日志含 trace_id/span_id；Sentry 事件含 requestId tag；
- [ ] 能解释 sentry-trace/baggage 与 traceparent 的传播取舍。

### ⑥ 采样与成本

- [ ] 能设计 tracesSampleRate / OTel sampler 策略；
- [ ] 能解释高吞吐服务为何不能无条件全量记录。

### ⑦ 隐私与安全

- [ ] token/Cookie/密码/个人信息被脱敏（redact + dataCollection）；
- [ ] 审查过 breadcrumbs、请求体、source maps 的泄漏面。

### ⑧ 避免重复 instrumentation

- [ ] Sentry `enableOpenTelemetrySetup: false` + `openTelemetryIntegration()`；
- [ ] 能解释 Sentry 与 OTel 各自的采集/传输/展示范围。

### 必须完成的动手练习

- [ ] 练习 1：触发前端异常并在 Sentry 按 release/environment 找到（第 5 章）；
- [ ] 练习 2：Fastify 结构化请求日志，requestId 入错误响应与日志（第 3 章）；
- [ ] 练习 3：OTel instrument API 请求看到 server span，导出到可检查后端（第 8 章）；
- [ ] 练习 4：「创建任务失败」排障演练：UI→API→trace→DB→权限（第 11 章）。

### 通过标准

- [ ] 至少一个关键业务流程可串联定位（错误/日志/trace 不是各自存在）；
- [ ] Sentry 环境/release 配置正确，source maps 策略清楚，事件无凭据泄露；
- [ ] 能解释 trace/span、attributes、sampling、requestId、业务错误码的不同用途；
- [ ] 有一份短故障复盘：症状、影响、根因、修复、预防措施。

---

## 如何使用配套示例工程

```bash
cd 17.observability-tutorial/example
pnpm install
pnpm test          # 10 个测试（含 span/日志关联）
pnpm typecheck && pnpm build

# 零配置演练（console span + 内存仓储 + Sentry 禁用）
pnpm smoke:api
curl -X POST http://localhost:3000/api/tasks -H 'content-type: application/json' -d '{"title":"FAIL_DB"}'
# 观察 JSON 日志的 reqId/trace_id/span_id 与 console 的 span

# 前端：pnpm --filter @workboard/web dev
# 完整 trace 后端（需 Docker）：docker compose up --build -d → Jaeger http://localhost:16686
```

---

## 与本系列其他教程的关系

- **阶段 7（Fastify）** 的错误 envelope 与 Pino 日志在这里被赋予排障含义；
- **阶段 15（Docker）** 的 health/readiness 与优雅关闭在这里延伸为「关闭前冲刷遥测」；
- **阶段 16（CI/CD）** 的发布标识（commit sha）在这里成为 Sentry release / OTel service.version；
- **毕业项目 Workboard（第六部分）** 的 M6 里程碑「Sentry、OTel、结构化日志、一次故障复盘」直接以本教程产出为终点。

---

## 官方资源

- Sentry JavaScript/React：<https://docs.sentry.io/platforms/javascript/guides/react/>
- Sentry Node.js：<https://docs.sentry.io/platforms/javascript/guides/node/>
- Sentry Fastify：<https://docs.sentry.io/platforms/javascript/guides/fastify/>
- Sentry OTel 自定义管线：<https://docs.sentry.io/platforms/javascript/guides/node/opentelemetry/custom-setup/>
- OpenTelemetry JavaScript：<https://opentelemetry.io/docs/languages/js/>
- OTel Node 入门：<https://opentelemetry.io/docs/languages/js/getting-started/nodejs/>
- OTel 插桩：<https://opentelemetry.io/docs/languages/js/instrumentation/>
- OTel 导出器：<https://opentelemetry.io/docs/languages/js/exporters/>
- Pino：<https://getpino.io/>
