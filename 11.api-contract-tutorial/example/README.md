# TaskFlow 契约示例工程

《API 合约与端到端数据流整合》教程的配套代码。全部代码已通过类型检查与测试。

```
example/
├── apps/
│   ├── api/                 Fastify + TypeBox + Drizzle（服务端，契约的源头）
│   └── web/                 React + RHF + Zod + TanStack Query（只依赖 api-client）
├── packages/
│   └── api-client/          openapi.json + 生成的类型 + openapi-fetch 封装
├── scripts/check-contract.mjs   契约漂移检查
└── .github/workflows/ci.yml     CI：漂移检查 / OpenAPI lint / typecheck / test / breaking
```

## 运行

```bash
pnpm install

# 测试与类型检查（不需要数据库：测试用 PGlite）
pnpm typecheck
pnpm test
pnpm contract:check

# 方式 A：无 Docker，内存数据库启动 API（自动迁移 + 种子数据）
pnpm --filter @taskflow/api dev:memory

# 方式 B：Docker Postgres
docker compose up -d
cp apps/api/.env.example apps/api/.env
pnpm --filter @taskflow/api db:migrate
pnpm --filter @taskflow/api seed
pnpm dev:api

# 另开终端启动前端（/api 由 Vite 代理到 3000 端口）
pnpm dev:web
```

- 前端：<http://localhost:5173>，用 `alice@example.com`（负责人）、`bob@example.com`（只读）、`carol@example.com`（非成员）登录。
- API 文档：<http://localhost:3000/docs>，原始契约：<http://localhost:3000/docs/openapi.json>。

## 修改接口后的固定流程

```bash
# 1. 改 apps/api/src/contract/*.ts 或路由 schema
# 2. 重新生成契约与客户端类型
pnpm contract:generate
# 3. 让编译器告诉你哪里要跟着改
pnpm typecheck
# 4. 提交代码时，把 openapi.json 和 src/generated/openapi.ts 一起提交
```
