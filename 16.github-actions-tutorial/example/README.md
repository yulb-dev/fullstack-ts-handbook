# Workboard · CI/CD 示例工程

阶段 16 教程的配套示例：pnpm workspace + 三条 GitHub Actions workflow。

## 本地验证（与 CI 门禁等价的命令）

```bash
pnpm install --frozen-lockfile
pnpm format:check     # prettier
pnpm lint             # eslint 9 扁平配置
pnpm typecheck        # 全仓 tsc
pnpm test             # shared 7 个 + api 8 个测试（不含 e2e）
pnpm build            # shared → api → web（pnpm -r 按依赖拓扑排序）

# E2E（跑在生产构建上，需先 build）
pnpm --filter @workboard/e2e exec playwright install chromium   # 首次
pnpm e2e
```

## 让 workflow 真实运行

本文档仓库里的 `.github/workflows/` 不会被 GitHub 执行（只认仓库根）。把本目录复制为独立仓库：

```bash
cp -r 16.github-actions-tutorial/example ~/workboard-ci   # 不含 node_modules
cd ~/workboard-ci && git init && git add . && git commit -m "init"
# 推上 GitHub 后：
# 1. 开 PR → ci.yml 五道门禁
# 2. 合并 → main.yml 集成 + E2E
# 3. 配 production environment（审批 + secrets）→ 手动跑 deploy.yml
```

## 结构

```
.github/workflows/   ci.yml（PR 门禁）/ main.yml（集成+E2E+产物）/ deploy.yml（部署）
apps/api/            Fastify + 内存仓储 + 状态机（inject 测试）
apps/web/            React + Vite（列表/创建/推进状态）
packages/shared/     同构纯函数：状态机 + 分页（types→src、default→dist 双导出）
e2e/                 Playwright 冒烟（webServer 起 api dist + web preview）
docker/              部署用多阶段 Dockerfile（阶段 15 模式）
```

详见教程各章：[../README.md](../README.md)。