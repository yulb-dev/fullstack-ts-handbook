# TaskBoard lite（Playwright E2E 教程配套示例）

一个**零运行时依赖**的演示应用 + 一套完整的 Playwright 端到端测试。应用只用 `node:http` 与内存数据实现（重启即重置），包含登录、多工作区、任务增删改查、搜索/筛选/分页与角色权限——恰好覆盖教程全部教学场景，又小到可以通读源码。

## 快速开始

```bash
npm install                  # 安装 @playwright/test
npx playwright install       # 首次需下载浏览器（或只装 chromium）
npm test                     # 启动应用并运行全部 E2E 测试
```

其他常用命令：

```bash
npm run app            # 只启动应用：http://127.0.0.1:4173
npm run test:chromium  # 只在 Chromium 上运行
npm run test:headed    # 有头模式，肉眼看浏览器执行
npm run test:ui        # UI Mode（watch + 时间旅行调试）
npm run test:debug     # Playwright Inspector 单步调试
npm run report         # 打开 HTML 测试报告
```

## 测试账号（仅本地学习用）

| 用户  | 邮箱                  | 密码       | 工作区      | 角色   |
| ----- | --------------------- | ---------- | ----------- | ------ |
| Alice | `alice@taskboard.dev` | `alice123` | Alpha       | member |
| Bob   | `bob@taskboard.dev`   | `bob123`   | Beta        | member |
| Carol | `carol@taskboard.dev` | `carol123` | Alpha、Beta | admin  |

## 目录结构

```text
example/
├── server/server.js          # 被测应用：node:http + 内存数据（约 350 行，可通读）
├── public/                   # 前端：原生 ESM，无框架无构建
│   ├── index.html            # 语义化标记（label/role/dialog），供定位器教学
│   ├── app.js
│   └── styles.css
├── playwright.config.ts      # webServer、baseURL、projects、重试与诊断产物
├── tests/
│   ├── auth.setup.ts         # setup 项目：登录一次，保存 storageState
│   ├── fixtures.ts           # 自定义 seed fixture：唯一标题 + API 造数
│   ├── journey.spec.ts       # 关键旅程：创建→改状态→搜索→筛选→登出
│   ├── tenancy.spec.ts       # 跨工作区越权（403、存在性不泄露、双角色协作）
│   ├── guest.spec.ts         # 未登录视角（重置 storageState）
│   └── resilient.spec.ts     # 网络失败、加载态、表单校验、分页、键盘交互
└── .github/workflows/playwright.yml
```

## 约定

- 服务器默认监听 `127.0.0.1:4173`，可用环境变量 `PORT` 覆盖（见 `.env.example`）。
- 非成员访问任何工作区资源一律返回 `403 forbidden`（包括资源不存在时），避免泄露存在性。
- `playwright/.auth/`（storageState 会话文件）与 `test-results/`、`playwright-report/` 均已被 `.gitignore` 排除，**不要提交**。
- 内存数据随服务器重启重置；测试并行运行时靠「标题含 testId」保证互不干扰。
