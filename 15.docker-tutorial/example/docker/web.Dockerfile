# syntax=docker/dockerfile:1
# ============================================================
# Workboard Web 生产镜像：静态构建 + nginx
# 构建: docker build -f docker/web.Dockerfile -t workboard-web:local .
# 关键认知：Vite dev server 是开发设施；生产环境 serving 的是 build 产物。
# ============================================================

FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app ./
COPY . .
RUN pnpm --filter @workboard/web build

# ---------- runtime：nginx 只托管静态文件 + 反向代理 /api ----------
FROM nginx:1.29-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
# nginx 官方镜像默认 master 以 root 起、worker 降权到 nginx 用户；
# 教程第 11 章讨论更严格的 unprivileged 变体。