# FullStack TS Handbook

以 TypeScript 为主线的现代全栈学习手册：从前端样式、路由、状态管理，到后端 API、数据库、ORM、鉴权与接口契约，每个专题都由「编号章节 + 可运行的 `example` 示例」组成，并配套学习路线图与毕业项目手册。

## 目录结构

```text
fullstack-ts-handbook/
├── 2.tailwind-tutorial/                 # Tailwind CSS
├── 3.react-router-tutorial/             # React Router（数据模式）
├── 4.tanstack-query-zustand-tutorial/   # TanStack Query + Zustand
├── 5.accessible-forms-tutorial/         # 表单与无障碍（shadcn/RHF/Zod）
├── 7.fastify-api-tutorial/              # Fastify API
├── 8.supabase-postgres-tutorial/        # Supabase / PostgreSQL
├── 9.drizzle-orm-tutorial/              # Drizzle ORM
├── 10.better-auth-tutorial/             # Better Auth
├── 11.api-contract-tutorial/            # API 契约
├── 专项/                                 # 各主题的独立长文与 PDF 版本
├── docs/
│   ├── roadmap/                         # 全栈技术栈学习路线图
│   └── flowops/                         # FlowOps 毕业项目开发手册
└── assets/images/                       # 文档图片资源
```

## 教程专题

| 目录                                 | 主题                     | 说明                                              |
| ------------------------------------ | ------------------------ | ------------------------------------------------- |
| `2.tailwind-tutorial/`               | Tailwind CSS             | 从 CSS 基础到 v3/v4 对比与实战项目                |
| `3.react-router-tutorial/`           | React Router             | 数据模式（loader/action）、嵌套路由、懒加载与测试 |
| `4.tanstack-query-zustand-tutorial/` | TanStack Query + Zustand | 服务端状态与客户端状态管理                        |
| `5.accessible-forms-tutorial/`       | 表单与无障碍             | shadcn/ui、React Hook Form、Zod                   |
| `7.fastify-api-tutorial/`            | Fastify                  | 插件、校验、错误模型、OpenAPI 与测试              |
| `8.supabase-postgres-tutorial/`      | Supabase / PostgreSQL    | 关系模型、迁移、RLS、连接池与备份                 |
| `9.drizzle-orm-tutorial/`            | Drizzle ORM              | Schema 建模、迁移、事务、查询与性能               |
| `10.better-auth-tutorial/`           | Better Auth              | 会话、CSRF、OAuth、组织与 RBAC                    |
| `11.api-contract-tutorial/`          | API 契约                 | Monorepo、Schema 即契约、代码生成与 CI            |
| `专项/`                              | 专题合集                 | 各主题的单文件长文与 PDF 版本                     |

## 路线图与毕业项目

- [全栈技术栈学习路线图（PDF）](./docs/roadmap/fullstack_tech_stack_learning_roadmap.pdf) — 整体学习顺序与技术选型
- [FlowOps 开发手册](./docs/flowops/FlowOps_开发手册.md) — 综合运用上述技术栈的企业级多租户工单/流程协同平台设计

## 使用说明

每个教程目录下的章节按编号顺序阅读，`example/` 目录为配套示例代码，进入后安装依赖即可运行（多数使用 npm 或 pnpm）。

```bash
cd <教程目录>/example
npm install
npm run dev
```

## 注意事项

- 根目录及各 `example/` 下的 `.env` 文件包含本地配置，已被 `.gitignore` 忽略，请勿提交真实密钥。
- 部分示例依赖本地 Supabase / PostgreSQL 环境，请参考对应章节完成初始化。
