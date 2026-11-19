# Workboard · 可观测性示例工程

阶段 17 教程的配套示例：Fastify + Pino 结构化日志 + OpenTelemetry trace + Sentry 错误监控。

## 零配置本地演练（无需 Docker / Sentry 账号）

```bash
pnpm install
pnpm test                 # api 10 个测试（含 span 与日志关联断言）
pnpm typecheck
pnpm build

# 启动 API：console span + 内存仓储 + Sentry 禁用发送
pnpm smoke:api
# 另开终端：
curl -X POST http://localhost:3000/api/tasks -H 'content-type: application/json' -d '{"title":"你好"}'
curl -X POST http://localhost:3000/api/tasks -H 'content-type: application/json' -d '{"title":"FAIL_DB"}'
# 观察 API 终端：JSON 日志含 reqId/trace_id/span_id；console 打印 http/task.create span
```

## 前端演练

```bash
pnpm --filter @workboard/web dev   # http://localhost:5173
# 创建任务输入 FAIL_DB → 页面显示 requestId；点「触发前端渲染异常」→ ErrorBoundary 兜底
# 配置 VITE_SENTRY_DSN 后，错误真实上报 Sentry（按 release/environment 查找）
```

## 完整 trace 后端（需要 Docker）

```bash
cp .env.example .env
docker compose up --build -d
# Jaeger UI: http://localhost:16686 → 选 workboard-api 服务查 trace
curl -X POST http://localhost:3000/api/tasks -H 'content-type: application/json' -d '{"title":"trace 演练"}'
```

## 结构

```
apps/api/   instrumentation.ts（OTel+Sentry 分工）/ logger.ts（mixin+redact）/ app.ts（requestId+手动span）
apps/web/   instrument.ts（Sentry React）/ App.tsx（requestId 关联上报 + ErrorBoundary）
docker/     多阶段 Dockerfile（CMD 带 OTel ESM hook）
compose.yaml + otel-collector-config.yaml   API → Collector → Jaeger
```

详见教程各章：[../README.md](../README.md)。
