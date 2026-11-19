# syntax=docker/dockerfile:1
# ============================================================
# Workboard API 生产镜像：多阶段构建
# 构建: docker build -f docker/api.Dockerfile -t workboard-api:local .
# ============================================================

# ---------- base：锁定 Node 大版本，启用 corepack ----------
FROM node:24-bookworm-slim AS base
WORKDIR /app
# corepack 会读取 package.json 的 packageManager 字段，激活 pnpm@12.11.2
RUN corepack enable

# ---------- deps：锁文件优先，依赖层独立于源码层 ----------
# 只拷贝清单文件：源码天天变，lockfile 不常变。
# 这一层命中缓存时，整个依赖安装直接跳过（第 5 章）。
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
# frozen lockfile：清单与锁文件不一致就直接失败，而不是悄悄改锁文件
RUN pnpm install --frozen-lockfile

# ---------- build：编译 TS，并裁出「只含生产依赖」的部署目录 ----------
FROM base AS build
COPY --from=deps /app ./
COPY . .
RUN pnpm --filter @workboard/api build \
  && pnpm --filter @workboard/api deploy --prod /prod/api

# ---------- runtime：只带运行需要的文件 ----------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# pnpm deploy 产出的是独立、无 workspace 符号链接的生产 node_modules
COPY --from=build /prod/api/node_modules ./node_modules
COPY --from=build /prod/api/package.json ./package.json
COPY --from=build /app/apps/api/dist ./dist
# node 官方镜像自带 uid=1000 的 node 用户：非 root 运行
USER node
EXPOSE 3000
# exec 形式：node 直接成为 PID 1，能收到 SIGTERM（第 9 章）
CMD ["node", "dist/server.js"]