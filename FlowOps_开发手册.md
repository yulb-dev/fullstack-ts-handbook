# FlowOps 企业级多租户工单与业务流程协同平台
## 产品需求、系统设计、数据库设计与开发实施手册

- 文档版本：1.0
- 状态：开发基线（可随 ADR 与版本迭代更新）
- 项目类型：作品集级、可部署的企业 SaaS 应用
- 核心架构：模块化单体（Modular Monolith）
- 默认技术栈：React + TypeScript + Vite；Fastify + TypeBox；Drizzle ORM + PostgreSQL；Better Auth；Supabase；pnpm + Turborepo；Vitest + Playwright；Docker + GitHub Actions；Sentry + OpenTelemetry

> 本手册是项目的工程起点，不代表所有功能已经实现。所有性能数字、可用性承诺、安全认证和测试覆盖率，只有在实际测量或验证后才能写入项目介绍。

---

# 0. 如何使用这份手册

本手册将产品需求（PRD）、技术设计（TDD）、数据库设计、API 约定、开发路线、测试策略和上线运维合并为一份可执行的基线文档。

建议把它拆入仓库的 `docs/`，并把本文件视为入口：

```text
docs/
├── product/
│   ├── prd.md
│   ├── domain-model.md
│   └── acceptance-criteria.md
├── architecture/
│   ├── architecture.md
│   ├── database.md
│   ├── api-conventions.md
│   └── adr/
├── security/
│   └── security.md
├── testing/
│   └── test-strategy.md
└── operations/
    ├── deployment.md
    └── runbook.md
```

执行原则：

1. 先做垂直业务闭环，再做横向基础设施；不要一开始就搭建复杂微服务。
2. 每个业务能力都必须包含数据库约束、API 校验、权限检查、错误处理、测试与审计，而不只是页面。
3. 所有租户业务查询必须有明确的组织上下文，不能相信客户端传来的 `organization_id` 就是授权证明。
4. API、数据库迁移和权限变化必须通过代码审查；不允许直接在生产数据库手工改结构。
5. 任何“已支持”的能力都应有可重复的验收步骤或自动化测试。

---

# 1. 产品概述（PRD）

## 1.1 产品愿景

FlowOps 是面向企业 IT 服务、内部运营和支持团队的多租户工单与流程协同平台。它将“请求进入—分派—处理—审批（可选）—解决—关闭—分析”串成可追踪的工作流。

它不是简单的待办清单。核心价值是：
- 将工单生命周期标准化，避免任务状态随意变化；
- 让组织、角色和数据边界可被系统强制执行；
- 保留谁在何时因何操作了什么的历史记录；
- 根据优先级与 SLA 目标识别超时风险；
- 让主管能查看工作量、积压、解决时长和 SLA 达成情况。

## 1.2 目标用户与角色

| 角色 | 主要诉求 | 典型权限 |
|---|---|---|
| 平台运维管理员（Platform Admin） | 管理平台级配置、处理平台级支持事项 | 仅平台级操作；默认不自动获得所有租户业务数据访问权 |
| 组织所有者（Owner） | 管理组织、成员、组织配置 | 管理成员和设置；可管理所有组织工单 |
| 组织管理员（Admin） | 配置团队、成员、流程和 SLA | 组织范围管理权限 |
| 主管/经理（Manager） | 分派工作、看团队指标、处理升级 | 查看组织工单；分派；查看报表 |
| 处理人（Agent） | 接收并解决工单 | 查看可访问工单；评论、状态流转、记录工作 |
| 请求人（Requester） | 提交请求并追踪进度 | 创建工单；查看自己有权访问的工单；补充信息 |
| 审计只读角色（Auditor） | 核查变更记录 | 只读查看获授权范围的审计信息 |

**角色原则：** 角色是权限模板，不是数据范围本身。每个 API 都要同时检查“用户是否属于该组织”“是否具备所需权限”“目标资源是否属于该组织”。

## 1.3 范围与非目标

### MVP 必须包含
- 注册/登录/登出与会话管理；
- 创建组织、加入组织、成员列表与角色管理；
- 工单创建、列表、详情、编辑、评论、指派、关闭；
- 明确的状态机和允许的状态转换；
- 工单历史记录与关键操作审计；
- 优先级、分类、负责人、请求人、标签；
- 搜索、筛选、排序、分页；
- 基础 SLA 策略和超时标记；
- 基础运营仪表盘；
- API 文档、自动化测试、容器化部署、CI；
- 安全的租户隔离和可观测性基础。

### 后续版本
- 多级审批；
- 附件上传；
- 邮件/站内通知；
- 保存的筛选视图；
- 批量操作；
- Webhook 与集成；
- 可配置字段和可视化流程编辑器；
- 事务 Outbox 与异步任务处理。

### 明确不做（首个版本）
- 微服务拆分；
- Kafka 等消息平台；
- Kubernetes；
- 复杂的 BPMN 流程设计器；
- 原生移动端；
- 复杂计费与订阅系统；
- AI 自动分类或自动处理。

## 1.4 核心业务流程

### 流程 A：请求人提交工单
1. 用户选择当前组织。
2. 填写标题、描述、分类、优先级及可选标签。
3. 前端进行即时校验，服务端再次校验。
4. API 在事务中创建工单、写入首条历史记录，并按策略初始化 SLA。
5. 返回工单编号与详情。
6. 工单列表和详情缓存失效或更新。

### 流程 B：主管分派工单
1. 主管打开待分派列表。
2. 选择负责人。
3. API 校验操作者权限、目标成员仍是组织成员、工单仍处于可分派状态。
4. 在事务中更新负责人和版本号，写入历史记录与审计事件。
5. 并发冲突时返回 `409 CONFLICT`，前端提示刷新并重新确认。

### 流程 C：处理工单
1. 处理人查看工单上下文与历史。
2. 通过评论补充信息，或执行状态转换。
3. 每次状态变化必须通过领域规则，不允许客户端直接任意设置状态。
4. API 在事务中更新工单、写历史；必要时更新 SLA 计时状态。
5. UI 展示最新状态、时间线和责任人。

### 流程 D：解决并关闭
1. 处理人将工单转为 `resolved`，必须填写解决说明。
2. 请求人或有权限的处理人确认后转为 `closed`。
3. 若请求人反馈未解决，可在规则允许时重新打开。
4. 系统保留解决、关闭、重开等历史事件。

### 流程 E：SLA 预警与报表
1. 创建工单时根据优先级匹配 SLA 策略。
2. 保存首次响应和解决目标时间。
3. 记录响应、解决、暂停、恢复等事件，计算是否超时。
4. 报表根据统一口径统计时间范围内的工单量、积压、解决时长和 SLA 达成率。
5. 所有报表查询都受组织权限和时间范围限制。

## 1.5 功能需求与验收条件

### FR-01 身份与会话
- 使用 Better Auth 管理身份、会话和必要的身份表。
- 不自行实现密码存储、密码重置或会话令牌算法。
- 登录用户必须通过服务端会话验证；前端路由守卫仅用于体验，不是安全边界。
- 验收：未登录请求受保护 API 返回 `401`；会话失效后无法继续访问受保护资源。

### FR-02 组织与成员
- 用户可创建组织并成为 Owner。
- 成员有组织内角色；一个用户可加入多个组织。
- 组织成员邀请可先以管理员添加成员/邀请记录实现，邮件发送列入后续版本。
- 验收：非成员不能读取组织成员列表；非管理员不能修改其他成员角色；不得移除组织最后一个 Owner。

### FR-03 工单管理
- 工单具备编号、标题、描述、状态、优先级、分类、请求人、负责人、创建/更新时间。
- 列表支持过滤、排序、分页；分页必须有上限。
- 工单详情包含评论、历史和 SLA 摘要。
- 验收：列表与详情权限一致；不存在跨组织 IDOR；无效负责人、状态或优先级被拒绝。

### FR-04 状态机
- 初始状态为 `new`。
- 推荐状态：`new`、`open`、`in_progress`、`pending`、`resolved`、`closed`、`cancelled`。
- 所有状态转换必须由服务端规则验证。
- `resolved` 必须有解决说明；`closed` 必须来自允许的状态；重开必须记录原因。
- 验收：不允许的状态转换返回 `409` 或明确的业务错误码；成功转换生成一条历史记录。

### FR-05 评论与历史
- 评论支持纯文本或受限 Markdown（MVP 可只支持纯文本）。
- 普通评论与系统事件分开建模。
- 评论的创建、编辑和删除规则需明确；MVP 可禁止编辑/删除已提交评论，降低审计歧义。
- 验收：无权用户无法读写评论；状态变更、指派、优先级变更必须进入历史。

### FR-06 SLA
- SLA 策略可按优先级定义首次响应目标与解决目标（分钟）。
- 工单创建时固化当时匹配到的目标，避免策略后来修改而改变历史工单目标。
- MVP 使用日历时间计算；工作日历和暂停计时列入增强版。
- 验收：超时计算可用固定时钟测试；更改策略不会静默改写既有工单的目标。

### FR-07 审计
- 对登录安全事件、成员角色变更、工单创建/状态变化/指派、SLA 策略变化等关键操作记录审计。
- 审计记录只追加，不提供普通业务 API 修改/删除。
- 审计日志不保存密码、会话令牌、完整敏感内容或密钥。
- 验收：业务变更与审计记录在同一事务内完成，或采用明确的可靠事件模式；失败时不出现“业务已改但必需审计缺失”的状态。

### FR-08 仪表盘与报表
- 提供按时间范围、优先级、状态、负责人筛选的指标。
- 指标口径写入文档，不能只靠前端临时计算。
- MVP 指标：新建量、未关闭积压量、已解决量、中位解决时长、SLA 达成率。
- 验收：边界日期、时区、空数据集和跨组织隔离有测试。

### FR-09 搜索、过滤与分页
- 支持标题/编号搜索、状态、优先级、负责人、创建时间范围。
- 所有排序字段采用白名单，不能把客户端输入拼接进 SQL。
- 页大小默认 20，最大 100。
- 验收：过滤条件组合正确；分页稳定；无效参数返回可读的 `400`。

### FR-10 通知（增强）
- 站内通知记录未读/已读状态。
- 外部邮件通过后台任务或 Outbox 发出，不能在业务事务中同步等待外部邮件服务。
- 验收：重复任务不会造成重复的关键副作用；失败有重试和可观测记录。

## 1.6 非功能需求（NFR）

| 类别 | 设计要求 | 验收方式 |
|---|---|---|
| 安全 | 服务端授权、租户隔离、输入校验、限流、秘密管理 | 安全测试与负向测试 |
| 一致性 | 工单更新、历史和审计保持原子性 | 事务与故障路径测试 |
| 可维护性 | 模块边界清晰、共享类型可控、迁移可追踪 | 代码审查、架构文档 |
| 可用性 | 加载/空/错误/无权限/冲突状态完整 | Playwright 流程测试 |
| 性能 | 常用列表有索引、分页上限、报表有时间范围 | EXPLAIN ANALYZE 与压测 |
| 可观测性 | 结构化日志、request ID、错误追踪、核心指标 | 故障演练 |
| 可部署性 | 可重复构建、迁移、健康检查、回滚方案 | 全新环境部署演练 |
| 可访问性 | 键盘可操作、表单标签明确、状态不只靠颜色 | 手工检查与自动化辅助检查 |

---

# 2. 系统架构（TDD）

## 2.1 架构选择

采用**模块化单体 + Monorepo**。单一 API 服务内部按领域模块分层，避免过早引入分布式系统。将来有明确的吞吐、团队隔离或独立部署需求，再考虑拆分。

```text
Browser
  └─ React SPA (Vite)
      ├─ React Router：路由、loader/action 边界
      ├─ TanStack Query：服务端状态、缓存、重试、失效
      ├─ Zustand：短生命周期客户端 UI 状态
      ├─ React Hook Form + Zod：表单与前端校验
      └─ generated/typed API client
             │ HTTPS / JSON
             ▼
       Fastify API
        ├─ Auth/session
        ├─ Organization & Membership
        ├─ Ticket & Workflow
        ├─ Comments & History
        ├─ SLA & Reports
        ├─ Audit
        └─ Notifications (later)
             │
             ├─ Drizzle ORM
             ▼
       PostgreSQL (Supabase or local Docker)
        ├─ application tables
        ├─ indexes / constraints
        └─ migration history
```

## 2.2 Monorepo 建议结构

```text
flowops/
├── apps/
│   ├── web/
│   │   ├── src/app/
│   │   ├── src/routes/
│   │   ├── src/features/
│   │   │   ├── auth/
│   │   │   ├── organizations/
│   │   │   ├── tickets/
│   │   │   ├── workflows/
│   │   │   ├── sla/
│   │   │   └── reports/
│   │   ├── src/components/
│   │   └── src/lib/
│   └── api/
│       └── src/
│           ├── app.ts
│           ├── plugins/
│           ├── modules/
│           │   ├── organizations/
│           │   ├── members/
│           │   ├── tickets/
│           │   ├── workflows/
│           │   ├── sla/
│           │   ├── reports/
│           │   └── audit/
│           ├── shared/
│           └── server.ts
├── packages/
│   ├── db/                 # Drizzle schema, migrations, seed
│   ├── api-client/         # 生成或封装的类型化客户端
│   ├── config/             # ESLint/TS 等共享配置
│   └── contracts/          # 仅放稳定的跨端契约（如确有需要）
├── e2e/
├── docs/
├── supabase/
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

**依赖规则：**
- `apps/web` 不直接依赖数据库包。
- `apps/api` 负责鉴权、授权、业务规则和数据访问。
- `packages/db` 不导入 Web UI 或 API 路由。
- 不要把所有类型机械地复制到共享包；优先从服务端 schema/OpenAPI 生成 API 契约。
- 禁止形成 `web -> api 内部实现` 这种跨应用依赖。

## 2.3 服务端分层

每个业务模块建议采用以下结构：

```text
tickets/
├── ticket.routes.ts       # HTTP 路由、schema、状态码
├── ticket.schemas.ts      # TypeBox 请求/响应 schema
├── ticket.service.ts      # 用例编排与事务边界
├── ticket.repository.ts   # Drizzle 查询
├── ticket.policy.ts       # 权限与领域规则
├── ticket.errors.ts       # 领域错误
└── ticket.test.ts
```

小模块可适度合并文件，但职责边界应保留。

请求处理链：

1. Fastify 解析请求；
2. TypeBox/JSON Schema 校验输入；
3. 读取并验证 Better Auth 会话；
4. 解析当前组织上下文；
5. 通过 policy 检查组织成员关系与操作权限；
6. service 执行业务规则和事务；
7. repository 执行受组织范围约束的查询；
8. 返回标准响应并写入结构化日志。

## 2.4 前端状态职责

- **React Router：** 路由层级、页面导航、受保护页面的体验性重定向。
- **TanStack Query：** 工单、成员、报表等服务端数据；缓存、刷新、失效、乐观更新（谨慎使用）。
- **Zustand：** 当前组织选择、侧边栏状态、临时多选等真正属于客户端的 UI 状态。
- **React Hook Form + Zod：** 表单状态和即时校验。
- **服务端仍是最终事实来源。** 前端隐藏按钮、路由守卫、Zustand 中的角色值都不能替代服务端授权。

## 2.5 API 规范

- 前缀：`/api/v1`
- JSON 字段：统一 `camelCase`。
- 数据库字段：统一 `snake_case`。
- 时间戳：ISO 8601 UTC；组织本地时区只用于显示与报表边界。
- 错误响应采用统一 envelope：

```json
{
  "error": {
    "code": "TICKET_INVALID_TRANSITION",
    "message": "This status transition is not allowed.",
    "requestId": "req_..."
  }
}
```

- 常用状态码：`200` 查询/更新成功，`201` 创建成功，`204` 无响应体成功，`400` 输入错误，`401` 未认证，`403` 已认证但无权操作，`404` 资源不存在或不应暴露，`409` 状态/版本冲突，`429` 限流，`500` 未预期错误。
- 对可能泄露跨租户资源存在性的请求，可统一返回 `404`。
- OpenAPI 文档必须与实际路由 schema 同源生成，避免手工维护两套定义。

## 2.6 事务与并发

工单状态变更的事务应至少包含：
1. 在组织范围内读取工单并验证版本；
2. 验证状态转换和业务条件；
3. 更新工单状态、`version` 和 `updated_at`；
4. 插入 `ticket_history`；
5. 插入 `audit_log`；
6. 提交事务。

使用乐观并发控制：客户端携带读取到的 `version`，更新时仅在数据库版本相同的条件下成功；否则返回 `409`。避免“最后写入者无提示地覆盖前一次更新”。

外部邮件、Webhook 等副作用不应在数据库事务中直接执行。增强版可采用 transactional outbox。

---

# 3. 数据库设计

## 3.1 通用约定

- 主键优先使用 UUID；工单对用户展示独立、可读的 `ticket_number`。
- 时间统一存储为 `timestamptz`，由服务端写 UTC 时间。
- 所有租户业务表必须有 `organization_id`，或通过严格可验证的父记录关系确定租户归属。
- 所有外键、唯一约束、非空约束和索引尽可能落到数据库层。
- 软删除只在业务确有恢复/保留需求时使用；审计记录采用追加式。
- Better Auth 所需的 user/session/account/verification 等表按其实际版本和配置生成，不要手工假设字段与库版本完全一致。
- 本章是逻辑设计基线；实际 Drizzle schema 需按所选数据库驱动、Better Auth 版本和迁移工具验证。

## 3.2 关系概览

```text
users (Better Auth)
  ├── organization_members ── organizations
  ├── tickets (requester_id)
  ├── tickets (assignee_id, nullable)
  ├── ticket_comments
  ├── ticket_history
  └── notifications

organizations
  ├── organization_members
  ├── tickets
  │    ├── ticket_comments
  │    ├── ticket_history
  │    └── ticket_sla
  ├── sla_policies
  ├── audit_logs
  └── approval_instances (phase 2)
```

## 3.3 表：organizations

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| id | uuid | PK |
| name | varchar(120) | NOT NULL |
| slug | varchar(80) | NOT NULL；全局唯一或按产品规则唯一 |
| timezone | varchar(64) | NOT NULL，默认 UTC |
| status | varchar(20) | active / suspended |
| created_by | uuid | FK -> auth user |
| created_at | timestamptz | NOT NULL |
| updated_at | timestamptz | NOT NULL |

索引与规则：
- `UNIQUE(slug)`；如果 slug 只要求组织内唯一，则没有意义，因为组织本身就是 slug 的来源，因此通常建议全局唯一。
- 禁止普通组织管理员直接把组织标记为平台级删除。
- `suspended` 组织的业务写操作必须由服务端策略拒绝。

## 3.4 表：organization_members

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK -> organizations |
| user_id | uuid | FK -> Better Auth user |
| role | varchar(20) | owner / admin / manager / agent / requester / auditor |
| status | varchar(20) | active / invited / suspended |
| joined_at | timestamptz | nullable |
| created_at | timestamptz | NOT NULL |
| updated_at | timestamptz | NOT NULL |

约束：
- `UNIQUE(organization_id, user_id)`。
- 查询索引 `(organization_id, status, role)`。
- `user_id` 不应被直接作为当前租户权限证明；每次请求都要检查当前组织中的 membership 状态。
- “最后一个 Owner 不可被降级/移除”需要事务内校验，并考虑并发；必要时使用锁或数据库函数。

## 3.5 表：tickets

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK -> organizations |
| ticket_number | bigint | 组织内递增编号；展示时可格式化 |
| title | varchar(200) | NOT NULL |
| description | text | NOT NULL |
| status | varchar(24) | new/open/in_progress/pending/resolved/closed/cancelled |
| priority | varchar(16) | low/normal/high/urgent |
| category | varchar(80) | nullable；MVP 可先用文本，后续规范化 |
| requester_id | uuid | FK -> user |
| assignee_id | uuid | nullable FK -> user |
| resolution | text | nullable；resolved 时要求非空 |
| due_at | timestamptz | nullable；可作为业务截止时间，不等同于 SLA |
| version | integer | NOT NULL DEFAULT 1；乐观锁 |
| created_at | timestamptz | NOT NULL |
| updated_at | timestamptz | NOT NULL |
| resolved_at | timestamptz | nullable |
| closed_at | timestamptz | nullable |

约束/索引：
- 唯一约束 `(organization_id, ticket_number)`。
- 列表索引建议 `(organization_id, status, updated_at DESC)`。
- 指派列表索引 `(organization_id, assignee_id, status, updated_at DESC)`。
- 请求人列表索引 `(organization_id, requester_id, created_at DESC)`。
- 创建时间报表索引 `(organization_id, created_at)`。
- 需要根据真实查询计划决定是否增加复合索引；避免盲目给每个字段单独建索引。
- `assignee_id`、`requester_id` 仅有用户 FK 还不够证明他们属于该组织。服务层必须验证；更严格的数据库设计可通过复合外键确保成员关系。

**工单编号并发：** 不要用 `SELECT MAX(ticket_number)+1`。可采用每组织计数器表并在事务中原子递增，或使用全局序列并接受非连续编号。编号不要求连续时，优先选择更简单可靠的全局序列/生成器。

## 3.6 表：ticket_comments

| 字段 | 类型 | 约束/说明 |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK -> organizations |
| ticket_id | uuid | FK -> tickets |
| author_id | uuid | FK -> user |
| body | text | NOT NULL |
| visibility | varchar(20) | public / internal |
| created_at | timestamptz | NOT NULL |
| updated_at | timestamptz | NOT NULL；如禁止编辑可省略 |

索引：
- `(organization_id, ticket_id, created_at ASC)`。
- 内部评论仅允许具备内部查看权限的角色读取；Requester 不可见 internal 评论。
- 评论创建 API 必须验证工单和组织上下文一致。

## 3.7 表：ticket_history

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK |
| ticket_id | uuid | FK |
| actor_id | uuid | FK -> user；系统事件可为空 |
| event_type | varchar(40) | created/status_changed/assigned/priority_changed/commented/resolved/reopened 等 |
| field_name | varchar(80) | nullable |
| old_value | jsonb | nullable |
| new_value | jsonb | nullable |
| message | text | nullable |
| created_at | timestamptz | NOT NULL |

索引：
- `(organization_id, ticket_id, created_at DESC)`。
- 该表服务于工单时间线；审计日志服务于安全/管理追溯，两者目的不同，不要混成一个表。
- old/new value 只存必要字段，避免把完整敏感内容复制到历史中。

## 3.8 表：sla_policies

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK |
| name | varchar(120) | NOT NULL |
| priority | varchar(16) | low/normal/high/urgent |
| first_response_minutes | integer | > 0 |
| resolution_minutes | integer | > 0 |
| is_active | boolean | NOT NULL |
| created_at | timestamptz | NOT NULL |
| updated_at | timestamptz | NOT NULL |

约束：
- 建议 `UNIQUE(organization_id, priority, is_active)` 不直接使用，因为数据库唯一约束对多个 active=false 记录的行为可能不符合业务期望；可使用部分唯一索引（若数据库支持）或服务端事务规则，保证每个组织每个优先级最多一个启用策略。
- 策略更新要记录审计事件。
- 若不同分类也影响 SLA，后续添加匹配条件与优先级规则，并写明冲突时的选择顺序。

## 3.9 表：ticket_sla

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK |
| ticket_id | uuid | FK |
| policy_id | uuid | FK；保留策略引用 |
| first_response_due_at | timestamptz | nullable |
| first_responded_at | timestamptz | nullable |
| resolution_due_at | timestamptz | nullable |
| resolved_at | timestamptz | nullable |
| first_response_breached | boolean | NOT NULL DEFAULT false |
| resolution_breached | boolean | NOT NULL DEFAULT false |
| created_at | timestamptz | NOT NULL |
| updated_at | timestamptz | NOT NULL |

约束/索引：
- `UNIQUE(ticket_id)`（一个工单一个当前 SLA 实例；如将来支持多阶段 SLA 再调整）。
- `(organization_id, resolution_due_at)` 用于扫描即将超时/已超时工单。
- 工单创建时复制目标时间；策略变更不应自动重写已存在工单的目标。

## 3.10 表：audit_logs

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK；平台级事件可 nullable，但需单独权限 |
| actor_id | uuid | nullable FK -> user |
| action | varchar(80) | NOT NULL |
| resource_type | varchar(80) | NOT NULL |
| resource_id | uuid | nullable |
| request_id | varchar(100) | nullable |
| ip_hash_or_ip | varchar(100) | 按隐私策略决定是否保存；优先评估必要性 |
| metadata | jsonb | 仅存最小必要信息 |
| created_at | timestamptz | NOT NULL |

约束/索引：
- `(organization_id, created_at DESC)`。
- `(organization_id, resource_type, resource_id, created_at DESC)`。
- 应用层禁止普通更新/删除；高合规要求可进一步设置数据库权限或触发器。
- 不要存 bearer token、cookie、密码、完整请求体或不必要的个人数据。

## 3.11 表：notifications（增强版）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK |
| recipient_id | uuid | FK -> user |
| type | varchar(60) | NOT NULL |
| title | varchar(200) | NOT NULL |
| body | text | nullable |
| resource_type | varchar(60) | nullable |
| resource_id | uuid | nullable |
| read_at | timestamptz | nullable |
| created_at | timestamptz | NOT NULL |

索引：
- `(recipient_id, read_at, created_at DESC)`。
- 对于跨租户通知，必须在读取时校验用户与组织关系。

## 3.12 表：approval_instances（第二阶段）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK |
| ticket_id | uuid | FK |
| status | varchar(20) | pending/approved/rejected/cancelled |
| requested_by | uuid | FK -> user |
| approver_id | uuid | FK -> user |
| decision_note | text | nullable |
| decided_at | timestamptz | nullable |
| created_at | timestamptz | NOT NULL |
| updated_at | timestamptz | NOT NULL |

若要支持多人/多阶段审批，应将审批流程定义、步骤和实例拆分建模；不要用一个 JSON 字段硬塞完整流程并期望可查询、可审计。

## 3.13 表关系与完整性策略

1. 所有租户业务数据必须可以追溯到 `organization_id`。
2. 外键保证引用对象存在；服务层负责授权和组织上下文验证。
3. 关键写入（工单 + history + audit + SLA）在同一数据库事务中完成。
4. 如果使用复合外键强化隔离，可在父表增加 `UNIQUE(organization_id, id)`，子表用 `(organization_id, ticket_id)` 引用父表的 `(organization_id, id)`，防止错误关联到其他组织的记录。
5. 删除组织的策略必须明确。MVP 建议停用组织，而非级联物理删除审计记录。
6. 迁移要支持从空数据库重建；种子数据不能包含真实用户秘密。

---

# 4. API 设计清单

所有端点位于 `/api/v1`。具体 JSON schema、响应字段和错误码应在开发中由 TypeBox schema 定义并自动生成 OpenAPI。

| 方法 | 路径 | 说明 | 主要权限 |
|---|---|---|---|
| GET | `/health/live` | 进程存活 | 公开/基础 |
| GET | `/health/ready` | DB 等依赖就绪 | 内部/部署检查 |
| GET | `/api/v1/me` | 当前用户与会话信息 | 登录用户 |
| GET | `/api/v1/organizations` | 当前用户所属组织 | 登录用户 |
| POST | `/api/v1/organizations` | 创建组织并成为 Owner | 登录用户 |
| GET | `/api/v1/organizations/:orgId/members` | 成员列表 | 组织成员/按策略 |
| PATCH | `/api/v1/organizations/:orgId/members/:memberId` | 修改成员角色/状态 | Owner/Admin |
| GET | `/api/v1/organizations/:orgId/tickets` | 工单列表 | 组织成员 |
| POST | `/api/v1/organizations/:orgId/tickets` | 创建工单 | Requester+ |
| GET | `/api/v1/organizations/:orgId/tickets/:ticketId` | 工单详情 | 资源可见者 |
| PATCH | `/api/v1/organizations/:orgId/tickets/:ticketId` | 修改允许字段 | 有对应权限 |
| POST | `/api/v1/organizations/:orgId/tickets/:ticketId/assign` | 指派工单 | Manager/Admin |
| POST | `/api/v1/organizations/:orgId/tickets/:ticketId/transitions` | 状态转换 | 依状态与角色 |
| GET | `/api/v1/organizations/:orgId/tickets/:ticketId/comments` | 评论列表 | 工单可见者 |
| POST | `/api/v1/organizations/:orgId/tickets/:ticketId/comments` | 添加评论 | 工单可见者 |
| GET | `/api/v1/organizations/:orgId/tickets/:ticketId/history` | 工单时间线 | 工单可见者 |
| GET | `/api/v1/organizations/:orgId/sla-policies` | SLA 策略列表 | Admin/Manager 视策略 |
| POST | `/api/v1/organizations/:orgId/sla-policies` | 创建 SLA 策略 | Owner/Admin |
| PATCH | `/api/v1/organizations/:orgId/sla-policies/:policyId` | 修改策略 | Owner/Admin |
| GET | `/api/v1/organizations/:orgId/reports/overview` | 概览指标 | Manager/Admin |
| GET | `/api/v1/organizations/:orgId/audit-logs` | 审计查询 | Owner/Admin/Auditor |

## 4.1 工单状态转换

| 当前状态 | 目标状态 | 默认允许角色 | 条件 |
|---|---|---|---|
| new | open | Agent/Manager/Admin | 工单已被接收 |
| new | cancelled | Requester/Manager/Admin | 提供取消原因 |
| open | in_progress | Assignee/Manager/Admin | 可开始处理 |
| open | pending | Assignee/Manager/Admin | 说明等待外部信息 |
| in_progress | pending | Assignee/Manager/Admin | 说明等待原因 |
| pending | in_progress | Assignee/Manager/Admin | 等待条件解除 |
| in_progress | resolved | Assignee/Manager/Admin | 必须填写 resolution |
| resolved | closed | Requester/Manager/Admin | 按组织策略确认 |
| resolved | in_progress | Requester/Manager/Admin | 重新打开并说明原因 |
| closed | in_progress | Admin/Manager | 如允许重开，必须记录原因 |

这些规则是产品默认值；实施时需要把每条转换写入服务端领域函数与测试，而不是散落在 UI 组件中。

## 4.2 工单列表查询参数

示例：
`GET /api/v1/organizations/{orgId}/tickets?status=open&priority=urgent&assigneeId=...&q=VPN&sort=updatedAt&direction=desc&page=1&pageSize=20`

规则：
- `status`、`priority`、`sort`、`direction` 使用枚举白名单。
- `pageSize` 最大 100。
- 对深分页和大数据量可演进到 cursor pagination。
- 过滤字段必须对应明确索引或经过查询计划验证。
- 查询中组织范围由已验证的 `orgId + membership` 决定，不能只靠客户端提交的 ID。

## 4.3 典型错误码

| 错误码 | HTTP | 含义 |
|---|---:|---|
| `AUTH_REQUIRED` | 401 | 未认证或会话无效 |
| `ORG_MEMBERSHIP_REQUIRED` | 404/403 | 不是组织成员（按防枚举策略选择） |
| `PERMISSION_DENIED` | 403 | 已认证但无操作权限 |
| `RESOURCE_NOT_FOUND` | 404 | 资源不存在或不在可见范围 |
| `VALIDATION_ERROR` | 400 | 请求格式/字段无效 |
| `TICKET_INVALID_TRANSITION` | 409 | 状态转换不允许 |
| `VERSION_CONFLICT` | 409 | 并发版本已变化 |
| `LAST_OWNER_PROTECTED` | 409 | 不能移除/降级最后一个 Owner |
| `SLA_POLICY_CONFLICT` | 409 | 存在冲突的启用策略 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |

---

# 5. 权限与租户隔离设计

## 5.1 每个请求的授权流程

1. 验证 Better Auth 会话。
2. 解析组织 ID（路由参数或当前组织选择）。
3. 查询 `organization_members`，确认 membership 为 active。
4. 检查角色权限。
5. 查询资源时把 `organization_id` 作为查询条件。
6. 对请求体中的 assignee/requester 等用户 ID，确认该用户是同一组织的有效成员且角色符合要求。
7. 执行事务。
8. 写入 history/audit。
9. 返回最小必要数据。

**危险写法：** `SELECT * FROM tickets WHERE id = :ticketId`，随后只在前端判断是否属于当前组织。

**推荐思路：** `SELECT ... FROM tickets WHERE id = :ticketId AND organization_id = :authorizedOrgId`，并在同一业务用例内完成权限和领域规则检查。

## 5.2 RBAC 权限矩阵（起始版）

| 操作 | Owner | Admin | Manager | Agent | Requester | Auditor |
|---|---:|---:|---:|---:|---:|---:|
| 查看组织设置 | ✓ | ✓ | 部分 | — | — | 只读部分 |
| 管理成员与角色 | ✓ | ✓ | — | — | — | — |
| 查看组织所有工单 | ✓ | ✓ | ✓ | 按策略 | 仅获授权工单 | 只读（如授予） |
| 创建工单 | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| 指派工单 | ✓ | ✓ | ✓ | — | — | — |
| 更新/处理工单 | ✓ | ✓ | ✓ | 负责/获授权工单 | 补充信息/按策略 | — |
| 关闭工单 | ✓ | ✓ | ✓ | 按策略 | 确认关闭（按策略） | — |
| 管理 SLA 策略 | ✓ | ✓ | 可选只读 | — | — | — |
| 查看运营报表 | ✓ | ✓ | ✓ | 可选个人范围 | — | 只读（按策略） |
| 查看审计日志 | ✓ | ✓ | 可选 | — | — | ✓ |

该表是产品策略基线。上线前要把每个权限映射到明确的服务端 policy，并为允许和拒绝路径都写测试。

---

# 6. 前端信息架构与页面清单

## 6.1 页面结构

```text
/auth/login
/auth/register
/onboarding/create-organization
/app
  /dashboard
  /tickets
  /tickets/new
  /tickets/:ticketId
  /my-work
  /reports
  /settings/members
  /settings/sla
  /settings/audit
```

## 6.2 主要页面

### 登录与组织选择
- 登录/注册/会话错误状态。
- 多组织用户可以切换当前组织。
- 当前组织选择保存在客户端只是 UI 偏好；每次 API 仍独立验证 membership。

### 工单列表
- 搜索框、状态/优先级/负责人/日期筛选。
- 表格列：编号、标题、状态、优先级、请求人、负责人、更新时间、SLA 状态。
- 必须有 loading、empty、error、permission denied、retry 状态。
- URL query string 保存可分享筛选条件；后续再做命名保存视图。

### 工单详情
- 标题、状态、优先级、负责人、请求人、描述。
- 状态转换按钮根据领域能力显示，但服务端仍再次校验。
- 评论时间线、历史时间线、SLA 摘要。
- 编辑冲突提示和刷新入口。

### 仪表盘
- 时间范围选择。
- 新建工单、未关闭积压、解决量、中位解决时长、SLA 达成率。
- 图表可从简单趋势图开始；图表不能替代具体可操作的列表。
- 指标口径、时区和过滤条件需一致。

### 成员与 SLA 设置
- 成员角色和状态管理。
- SLA 目标设置与冲突校验。
- 危险操作二次确认；最后一个 Owner 保护。
- 修改成功后展示结果并写入审计。

## 6.3 前端工程规范

- feature-first 组织目录，避免一个全局 `components/` 塞入所有业务。
- 组件分为 primitives、shared UI、feature components、route pages。
- API 调用集中在 query/mutation hooks 或 API client 层。
- Query key 必须包含组织 ID 与影响结果的过滤条件。
- 切换组织时，清理或隔离旧组织缓存，避免短暂展示前一组织数据。
- 不把服务端工单全集复制到 Zustand。
- 所有表单必须显示字段级错误，并处理服务端业务错误。

---

# 7. 开发路线图（按依赖推进，不设硬性时间限制）

每个阶段都应完成“实现、测试、文档、验收”四件事。不要因为页面能点通就认为里程碑完成。

## Phase 0：需求冻结与工程准备

**任务**
- 确认状态机、角色矩阵、MVP 范围、错误码。
- 建立 Git 仓库、分支策略、PR 模板、Issue 模板。
- 初始化 pnpm workspace 与 Turborepo。
- 添加格式化、lint、TypeScript strict、测试脚手架。
- 建立 `.env.example`，确保不提交秘密。

**交付物**
- PRD、架构图、ADR-001（选择模块化单体）。
- 可运行的 web/api 空壳。
- CI 能执行 lint、typecheck、unit tests。

**验收**
- 新开发者能按 README 在干净环境启动项目。
- CI 对故意引入的 lint/type 错误会失败。

## Phase 1：数据库基础与迁移

**任务**
- 启动本地 PostgreSQL 或 Supabase 开发实例。
- 配置 Drizzle schema、迁移生成/执行、seed。
- 建立 organizations、organization_members、tickets、comments、history、audit_logs。
- 加入必要外键、唯一约束、检查约束和索引。
- 设计 Better Auth 表映射并验证迁移。

**交付物**
- 初始 migration 与可重复 seed。
- ER 图、字段说明、迁移操作说明。

**验收**
- 空数据库可完整迁移。
- 重复执行 seed 不会生成不可控重复数据（或明确 seed 仅用于一次性环境）。
- 删除/更新违反约束的数据会被数据库拒绝。

## Phase 2：API 骨架与契约

**任务**
- 建立 Fastify app、插件注册、配置校验、统一错误处理。
- 接入 TypeBox schema 与 OpenAPI。
- 实现 `/health/live`、`/health/ready`。
- 加 request ID、结构化日志、基础限流。
- 统一 API 响应、分页和错误格式。

**交付物**
- 可访问的 OpenAPI/Swagger UI 或 Scalar 页面。
- API conventions 文档。
- API smoke tests。

**验收**
- 无效输入在业务逻辑执行前被拒绝。
- 未处理异常不会向客户端暴露堆栈或秘密。
- ready 检查能反映数据库不可用状态。

## Phase 3：身份认证与多租户基础

**任务**
- 配置 Better Auth。
- 实现 `/me`、创建组织、组织列表、成员查询。
- 抽象 `requireSession`、`requireOrganizationMembership`、`requirePermission`。
- 统一资源范围查询模式。
- 为跨租户访问建立负向测试。

**交付物**
- 身份与组织 API。
- 权限矩阵映射。
- 安全测试用例。

**验收**
- 用户 A 不能通过更换 URL 中的组织 ID 读取用户 B 的数据。
- 非成员不能访问成员列表和组织工单。
- 非管理员不能修改角色。
- 最后一个 Owner 不可被移除。

## Phase 4：工单纵向闭环

**任务**
- 实现创建、列表、详情、编辑、指派、评论、状态转换。
- 每个用例都将权限、领域规则、事务边界放在服务端。
- 同事务写 history 与 audit。
- 实现分页、过滤、排序、搜索。
- 加乐观锁 `version`。

**交付物**
- 可用的工单 API。
- 状态转换表与单元测试。
- 关键 API 集成测试。

**验收**
- 创建工单后可查询、评论、指派、推进状态、解决和关闭。
- 非法状态转换被拒绝。
- 并发更新可检测，不会静默覆盖。
- 工单、历史和审计不会出现部分提交。

## Phase 5：前端主流程

**任务**
- 实现登录、组织选择、仪表盘框架。
- 实现工单列表、筛选、详情、创建/编辑表单。
- 接入 TanStack Query 与类型化 API client。
- 使用 RHF + Zod 管理表单。
- 完善 loading、empty、error、unauthorized、conflict 状态。

**交付物**
- 从登录到工单关闭的完整 UI 流程。
- 关键页面截图或演示数据。
- Playwright 主流程测试。

**验收**
- 新用户可以创建组织和第一张工单。
- 不同角色看到合理的操作入口。
- 组织切换后不会显示上一组织的缓存数据。
- 服务端返回的字段错误能映射到表单。

## Phase 6：SLA 与运营报表

**任务**
- 实现 SLA 策略 CRUD 和策略冲突校验。
- 创建工单时生成 ticket_sla 快照。
- 实现首次响应、解决截止时间和超时状态。
- 定义报表指标 SQL 与边界条件。
- 添加适当索引并查看 EXPLAIN ANALYZE。

**交付物**
- SLA 设置页、工单 SLA 摘要、运营报表。
- 指标字典与 SQL 说明。
- 查询性能基线。

**验收**
- 固定时间的测试可验证 SLA 目标和超时边界。
- 报表时间范围、时区、空数据行为明确。
- 报表不能跨组织聚合数据。

## Phase 7：质量、安全与韧性

**任务**
- 单元测试：状态机、权限策略、SLA 计算、错误映射。
- 集成测试：API + 测试数据库 + 事务。
- E2E：登录、组织、创建工单、指派、评论、解决、关闭。
- 测试跨租户 IDOR、内部评论泄露、角色提升、越权导出。
- 检查依赖漏洞、秘密泄露、CORS、cookie/session 配置。
- 评估 N+1 查询、慢查询、分页性能。

**交付物**
- 测试策略与测试报告。
- 安全检查清单。
- 关键查询计划和修复记录。

**验收**
- 所有关键业务规则都有测试。
- 关键授权失败路径有测试，而不只是 happy path。
- CI 在测试失败、类型错误或 lint 错误时阻止合并。

## Phase 8：部署与可观测性

**任务**
- 编写多阶段 Dockerfile 与 docker-compose 本地运行配置。
- CI 执行 install、lint、typecheck、unit/integration tests、build。
- 建立部署环境变量、迁移执行顺序和健康检查。
- 接入 Sentry 错误上报与 OpenTelemetry trace/metrics/log correlation。
- 编写备份、恢复、回滚和故障排查手册。
- 做一次从空环境部署演练。

**交付物**
- 可部署应用、CI workflow、部署文档、runbook。
- 一段演示业务流程的视频或 GIF（可选）。
- 架构图与简历项目描述。

**验收**
- 不能依赖开发者本机状态完成部署。
- 迁移失败时部署应停止并清晰报错。
- 可通过 request ID 从 API 日志定位一次失败请求。
- 有数据库备份与恢复演练记录。

## Phase 9：企业化增强（按价值选择）

- 审批实例与审批决策；
- 站内通知和 transactional outbox；
- 附件上传与文件访问授权；
- 保存筛选视图、批量操作；
- 可配置工作日历与 SLA 暂停；
- 管理员审计搜索和导出；
- 组织数据保留与导出策略。

---

# 8. 测试策略与验收矩阵

## 8.1 测试分层

| 类型 | 工具建议 | 测什么 |
|---|---|---|
| 单元测试 | Vitest | 状态机、权限函数、SLA 时间计算、schema |
| API 集成测试 | Vitest + Fastify inject + 测试数据库 | 路由、认证、事务、错误码、数据库约束 |
| 组件测试 | Vitest + Testing Library（如采用） | 表单错误、状态显示、关键交互 |
| E2E | Playwright | 真实浏览器业务流程、角色差异、组织切换 |
| 安全负向测试 | Vitest/Playwright | IDOR、角色提升、内部评论泄露、跨租户查询 |
| 性能测试 | 选定的负载工具 + PostgreSQL EXPLAIN | 列表、搜索、报表、并发更新 |

## 8.2 必测场景

- 未登录访问工单 API -> `401`。
- 组织 A 成员请求组织 B 工单 -> `404` 或按策略 `403`。
- 组织 A 工单指派给非组织成员 -> 拒绝。
- Requester 读取 internal comment -> 不可见。
- Agent 尝试修改 SLA 策略 -> 拒绝。
- 非法状态转换 -> `409`。
- 两个客户端使用相同 `version` 更新 -> 一个成功，另一个收到冲突。
- 删除/降级最后一个 Owner -> 拒绝。
- 创建工单时审计插入失败 -> 整个事务回滚。
- SLA 恰好到期、早一秒、晚一秒的边界测试。
- 空报表、跨时区日期范围、夏令时变化（如支持本地日历）。
- 分页参数超限、未知排序字段、超长搜索词。
- 用户切换组织后，不得闪现前一组织的缓存数据。
- 会话过期后，前端显示重新登录路径，后端拒绝请求。

## 8.3 完成定义（Definition of Done）

一个功能只有同时满足以下条件才算完成：
- 需求与验收条件明确；
- 输入校验和错误码完整；
- 服务端授权与租户隔离完整；
- 数据约束与事务边界明确；
- 单元/集成测试覆盖核心路径；
- UI 有加载、空、错误和权限状态（若涉及 UI）；
- 日志不包含秘密或不必要的敏感数据；
- OpenAPI、README 或相关文档同步；
- CI 通过；
- 如涉及生产数据结构，迁移可从空库执行且有回滚/恢复说明。

---

# 9. 安全基线

## 9.1 身份与会话
- 使用 Better Auth 的正式配置与推荐会话机制。
- cookie 设置遵循 HTTPS、SameSite、Secure、HttpOnly 等环境要求。
- 校验 CORS 来源白名单；不要在生产使用任意 origin + credentials。
- 对登录、注册、密码重置等敏感端点实施速率限制。
- 不在日志、前端 storage 或错误消息中暴露 session token。

## 9.2 租户隔离
- 每个组织范围查询都必须显式带 organization scope。
- 对关联对象（assignee、comment、SLA policy）验证其所属组织。
- 建立跨租户负向测试，并在代码审查清单中强制检查。
- 如采用 PostgreSQL RLS，必须明确连接池、session context、绕过策略和迁移角色；RLS 是额外防线，不是免除服务端授权的理由。

## 9.3 输入与输出
- TypeBox 对所有请求参数、body、querystring 和响应 schema 进行定义。
- 对富文本、文件名、URL、搜索参数按用途进行校验。
- 限制请求体大小、分页大小、搜索长度。
- 错误消息不包含 SQL、堆栈、环境变量或秘密。

## 9.4 审计与隐私
- 仅记录必要的操作元数据。
- 定义审计日志保留期限和访问角色。
- 个人数据导出、组织删除、用户停用需有明确政策。
- 生产数据库最小权限；应用运行角色不应拥有不必要的 DDL 权限。
- 密钥放在部署平台的 secret manager，不进入仓库。

---

# 10. CI/CD 与运行手册

## 10.1 建议 CI 阶段

1. Checkout。
2. 安装指定 Node.js 与 pnpm 版本。
3. `pnpm install --frozen-lockfile`。
4. lint。
5. typecheck。
6. unit tests。
7. 启动测试数据库并执行迁移。
8. integration tests。
9. build。
10. Playwright E2E（可按 PR/主分支策略分层执行）。
11. 构建 Docker 镜像。
12. 部署阶段执行迁移、健康检查与 smoke test。

## 10.2 环境变量清单（示例）

```text
NODE_ENV=
PORT=
APP_BASE_URL=
DATABASE_URL=
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=
SENTRY_DSN=
OTEL_EXPORTER_OTLP_ENDPOINT=
```

说明：
- `.env.example` 只包含变量名和非敏感示例，不包含真实值。
- 生产 `BETTER_AUTH_SECRET` 必须使用高熵随机值。
- 数据库连接串不能出现在日志和错误上报中。
- Supabase 服务角色密钥绝不能发送到浏览器端。
- 变量命名和必需性以实际选用版本与部署平台为准。

## 10.3 运行手册最小内容

- 应用启动失败：检查配置校验输出、端口、依赖版本。
- 数据库不可达：检查网络、连接串、连接池、数据库状态。
- 迁移失败：停止部署，不要盲目重试破坏性迁移；核查迁移历史和数据库状态。
- 错误率上升：按时间、版本、路由和 request ID 定位；检查 Sentry trace 与日志。
- 慢查询：查看实际 SQL、`EXPLAIN (ANALYZE, BUFFERS)`、索引与返回行数。
- 错误租户数据风险：立即限制相关访问、保全日志、确认影响范围、修复并增加回归测试。
- 恢复流程：记录备份频率、恢复点目标（RPO）、恢复时间目标（RTO）以及定期演练结果。没有实际演练，不要声称恢复能力已验证。

## 10.4 备份与迁移策略
- 生产迁移采用向前兼容的 expand/contract 思路：先加列/表，再部署兼容代码，迁移数据，最后移除旧结构。
- 破坏性变更要分多次发布。
- 在恢复演练前确认备份是否包含数据库和必要的对象存储数据。
- 对迁移和备份记录执行时间、结果与负责人。

---

# 11. 性能设计与验证

## 11.1 优先关注的查询
- 工单列表按组织、状态、更新时间排序；
- 我的工单按组织、负责人、状态过滤；
- 工单详情及评论/历史时间线；
- SLA 即将到期/已超时列表；
- 按时间范围聚合的报表。

## 11.2 性能优化顺序
1. 确定真实慢查询与目标延迟。
2. 检查返回行数与分页方式。
3. 查看 `EXPLAIN ANALYZE`，判断扫描、排序、连接和估算偏差。
4. 依据真实过滤与排序组合建立复合索引。
5. 消除 N+1 查询，必要时使用批量查询。
6. 对报表控制时间范围；数据量增长后考虑预聚合或物化视图。
7. 只有在测量证明必要时才增加缓存。

不要在没有数据和基准的情况下声称“支持十万并发”或“查询小于 50ms”。可以在 README 记录测试环境、数据规模、查询和实际结果。

---

# 12. 关键架构决策记录（ADR 模板）

每个重要决策都记录：背景、候选方案、决策、理由、代价、复审触发条件。

## ADR-001：采用模块化单体
- 背景：项目需要完整业务闭环与企业级工程实践，但初期团队和负载有限。
- 选项：模块化单体、微服务。
- 决策：模块化单体。
- 理由：部署、调试、事务和测试简单；模块边界仍可保持清晰。
- 代价：需要约束模块依赖，避免内部耦合。
- 复审条件：模块出现独立扩缩容、独立发布或团队自治的真实需求。

## ADR-002：服务端 schema 作为 API 契约来源
- 决策：Fastify 路由使用 TypeBox/JSON Schema，生成 OpenAPI，再生成或封装前端类型化客户端。
- 代价：需要管理代码生成与版本同步。
- 验收：API schema 改动能被 CI 检查，文档不靠手工重复维护。

## ADR-003：工单使用乐观锁
- 决策：使用 `version` 字段检测并发更新。
- 代价：前端需要处理冲突并引导刷新。
- 验收：集成测试证明旧版本更新会失败且数据不丢失。

## ADR-004：历史与审计分表
- 决策：`ticket_history` 用于业务时间线；`audit_logs` 用于安全和管理追溯。
- 理由：保留期限、读取权限和事件粒度不同。
- 代价：一次关键业务写入需要在事务内写多张表。

## ADR-005：不在首版引入微服务/消息队列
- 决策：先完成模块化单体和事务一致性。
- 复审条件：异步副作用、吞吐量或部署边界出现可量化的瓶颈。

---

# 13. 仓库任务拆解（建议 Issue Backlog）

## Epic A：工程基础
- A1 初始化 pnpm workspace 与 Turbo pipeline
- A2 建立共享 TypeScript/ESLint 配置
- A3 配置 web/api 本地启动
- A4 配置 Docker Compose 数据库
- A5 配置 CI 基础检查
- A6 编写开发环境 README

## Epic B：数据库与认证
- B1 配置 Drizzle 与迁移
- B2 集成 Better Auth
- B3 建立 organizations/members
- B4 实现创建组织和组织列表
- B5 编写组织权限测试
- B6 添加 seed 数据

## Epic C：工单核心
- C1 定义状态机与领域错误
- C2 创建工单 API
- C3 工单列表过滤/分页/排序
- C4 工单详情 API
- C5 评论与历史
- C6 指派与状态转换
- C7 乐观锁
- C8 同事务审计

## Epic D：前端
- D1 登录与组织选择
- D2 工单列表与 URL filters
- D3 创建/编辑工单表单
- D4 工单详情与时间线
- D5 指派与状态转换 UI
- D6 错误、空态、加载态
- D7 E2E 主流程

## Epic E：SLA 与报表
- E1 SLA 策略表与 API
- E2 创建工单时 SLA 快照
- E3 SLA 计算服务与测试
- E4 报表指标定义
- E5 报表 API 与 UI
- E6 查询计划分析和索引调整

## Epic F：生产化
- F1 Docker 多阶段构建
- F2 GitHub Actions 完整流水线
- F3 部署与环境变量文档
- F4 Sentry
- F5 OpenTelemetry
- F6 安全负向测试
- F7 备份/恢复 runbook
- F8 部署演练与发布清单

每个 Issue 应包含：背景、范围、非目标、验收条件、依赖、测试要求、截图/日志证据。PR 尽量聚焦一个可审查的垂直改动。

---

# 14. README 与作品集交付标准

最终仓库至少应该有：

- 项目介绍与问题背景；
- 架构图和模块边界；
- 本地启动说明；
- `.env.example`；
- 数据库迁移和 seed 命令；
- API 文档入口；
- 测试命令与测试层级；
- 权限矩阵和租户隔离说明；
- 关键 ADR；
- CI 状态；
- 部署地址（若有）；
- 主要页面截图或演示视频；
- 性能测试方法、数据规模和实测结果；
- 已知限制与后续计划。

简历描述模板（只填写真实完成项）：

**FlowOps｜企业级多租户工单与业务流程协同平台**
- 基于 React、TypeScript、Fastify、Drizzle ORM 与 PostgreSQL 构建模块化单体应用，实现组织成员管理、工单生命周期、评论历史、SLA 和运营报表。
- 通过组织范围查询、服务端 RBAC、关联成员校验与跨租户负向测试，建立多租户访问控制。
- 使用 TypeBox/OpenAPI 统一 API 契约，配合 Vitest、Playwright 与 GitHub Actions 建立自动化质量门禁。
- 使用事务、乐观锁与审计事件处理并发更新和关键业务追溯；通过 Sentry/OpenTelemetry 提供错误定位与请求关联。
- 性能成果：仅填写真实测试环境、数据规模、查询和实测结果，不虚构吞吐量或延迟。

---

# 15. 发布前总验收清单

## 产品
- [ ] 用户能注册/登录、创建组织、切换组织。
- [ ] 组织角色管理和最后一个 Owner 保护有效。
- [ ] 工单可以创建、查询、指派、评论、流转、解决、关闭。
- [ ] 不合法的状态转换会被服务端拒绝。
- [ ] SLA 目标与报表指标口径有文档。
- [ ] 审计和工单历史可查看且权限正确。

## 数据与安全
- [ ] 关键表具备 FK、唯一约束、必要索引。
- [ ] 跨租户读取/写入负向测试通过。
- [ ] 内部评论不泄露给 Requester。
- [ ] 关键业务写入和审计在事务中一致。
- [ ] 会话、CORS、限流、秘密管理已检查。
- [ ] 日志不含密码、cookie、token 或数据库连接串。

## 工程质量
- [ ] lint、typecheck、单元测试、集成测试通过。
- [ ] Playwright 核心 E2E 通过。
- [ ] OpenAPI 文档与路由 schema 同源。
- [ ] 数据库迁移能从空数据库执行。
- [ ] CI 对失败测试和构建错误阻断合并。

## 交付与运维
- [ ] Docker 可重复构建。
- [ ] 全新环境可按文档启动。
- [ ] 部署健康检查有效。
- [ ] 错误追踪与 request ID 可用。
- [ ] 备份/恢复方案有明确步骤；如声称已验证，必须有演练记录。
- [ ] README、架构图、ADR、runbook 和演示材料齐全。

---

# 16. 实施时最重要的提醒

1. **不要先写 UI 再补权限。** 先让服务端授权模型和跨租户测试成立。
2. **不要把状态机写成散落的 if 语句。** 做成可测试的领域函数。
3. **不要把历史记录等同于普通日志。** 业务时间线和安全审计要分别建模。
4. **不要只测成功路径。** 企业系统的价值往往体现在拒绝越权、处理并发和恢复失败的能力上。
5. **不要为了“企业级”堆技术名词。** 模块化边界、事务、迁移、测试、可观测性和部署复现，比无必要的微服务更有说服力。
6. **先完成一条完整垂直切片。** 例如“登录 → 创建组织 → 创建工单 → 指派 → 状态流转 → 审计 → E2E”，再扩展 SLA 和报表。
7. **每个阶段都留证据。** 测试结果、查询计划、CI、部署演练、架构决策和演示视频，会让项目在简历与面试中更可信。
