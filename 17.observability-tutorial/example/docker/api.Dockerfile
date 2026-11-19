# syntax=docker/dockerfile:1
# 与阶段 15 相同的多阶段模式；CMD 需先加载 OTel ESM hook 与 instrumentation。
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
RUN pnpm --filter @workboard/api build \
    && pnpm --filter @workboard/api deploy --prod /prod/api

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/api/node_modules ./node_modules
COPY --from=build /prod/api/package.json ./package.json
COPY --from=build /app/apps/api/dist ./dist
USER node
EXPOSE 3000
# ESM 自动插桩需要 hook.mjs；instrumentation 必须先于 server 加载
CMD ["node", "--import", "@opentelemetry/instrumentation/hook.mjs", "--import", "./dist/instrumentation.js", "dist/server.js"]