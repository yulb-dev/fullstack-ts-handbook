# TaskDesk Lite —— Vitest 教程配套工程

一个贯穿 [Vitest 教程](../README.md) 全部章节的迷你全栈应用：纯逻辑 domain、依赖注入的 service、Fastify API、React 表单，以及 PGlite（WASM 版 Postgres）承载的数据库集成测试。

## 快速开始

```bash
npm ci          # 或 npm install（.npmrc 已配置 legacy-peer-deps，原因见文件内注释）
npm test        # 跑全部三个测试项目：unit / component / integration
```

其他命令：

```bash
npm run test:watch    # watch 模式
npm run test:shuffle  # 乱序执行，检验测试是否互相独立
npm run coverage      # 生成覆盖率报告（终端 + coverage/index.html）
npm run typecheck     # tsc --noEmit
npm run db:generate   # 修改 src/db/schema.ts 后生成新迁移
npm run api           # 启动本地 Fastify（PGlite 数据落在 .pgdata/）
npm run dev           # 启动 Vite 前端（/api 代理到 127.0.0.1:3000）
```

## 目录结构

```text
src/
├── domain/        # 纯函数：状态机、权限、分页、日期、Zod schema、ID 生成
├── services/      # 业务服务 + 端口接口 + 内存仓储（测试替身）
├── api/           # Fastify app factory、鉴权 hook、统一错误 envelope
├── db/            # Drizzle schema、PGlite 客户端、数据库仓储
└── ui/            # React 表单、TanStack Query mutation、Zustand 草稿 store
test/
├── unit/          # 纯逻辑与 service 单元测试（node 环境）
├── component/     # React Testing Library 组件测试（jsdom 环境）
└── integration/   # app.inject API 测试 + PGlite 数据库测试
drizzle/           # 迁移文件（测试与本地开发共用同一套）
```

## 环境要求

- Node.js ≥ 22.12（Vitest 5 的最低要求）
- 无需安装 Postgres / Docker：数据库测试使用内存 PGlite

## 与章节的对应关系

每章正文中的代码都来自本工程；章节里会标注对应文件路径。测试基线：Node v24、Vitest 5.0.5、React 19、Fastify 5、drizzle-orm 1.0.0-rc.4。
