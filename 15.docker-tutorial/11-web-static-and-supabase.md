# 第 11 章：前端静态发布与 Supabase 本地栈

> 本章目标：把 Vite 前端构建为静态文件并用 nginx 发布（SPA fallback + /api 反向代理）；说清「为什么 Vite dev server 不能当生产服务器」；理解 Supabase 本地栈与 Docker runtime 的关系。
>
> 关键概念：Supabase 本地栈依赖 Docker runtime、服务启动顺序与 ready≠started。｜ 动手练习：练习 2。

---

## 11.1 前端生产化的正确姿势

React SPA 的生产形态是**一堆静态文件**（`vite build` 的 `dist/`：带 hash 的 JS/CSS + index.html）。serving 它们只需要一个静态文件服务器 + 两条路由规则：

1. **SPA fallback**：前端路由的路径（如 `/tasks/123`）在磁盘上不存在，要回退到 `index.html` 让前端路由接管；
2. **API 反向代理**：浏览器请求同源的 `/api/*`，由服务器转发给 API——避免 CORS、统一入口。

开发期这两件事 Vite dev server 都做了（`server.proxy` + 内置 fallback），所以容易误以为「dev server 也能上生产」。**不能**：

- dev server 带 HMR、源码映射、未压缩的模块图，性能与安全都不适合生产；
- 它的设计目标是开发体验，不是并发 serving；Vite 官方明确 `vite preview` 也不是生产服务器；
- 把 dev server 打进镜像 = 把源码和开发依赖带进生产（第 6 章的反面）。

## 11.2 web 的多阶段 Dockerfile

`docker/web.Dockerfile`（与示例工程一致）：

```dockerfile
# syntax=docker/dockerfile:1
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

FROM nginx:1.29-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
```

与 API 镜像同构（base/deps/build/runtime），但 runtime 换成 nginx：**最终镜像里没有 Node、没有 node_modules、没有源码**——只有静态文件和 nginx 配置，几十 MB。

## 11.3 nginx.conf：两条规则

`docker/nginx.conf`：

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # 规则 2：/api 反向代理到 API 容器（服务名 DNS，第 7、10 章）
    location /api/ {
        proxy_pass http://api:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 规则 1：SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 带 hash 的静态资源长缓存
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
```

注意 `proxy_pass http://api:3000;` **不带尾部路径**：`/api/tasks` 原样转发为 `api:3000/api/tasks`。若写成 `proxy_pass http://api:3000/;` 则会剥掉 `/api` 前缀——两种写法语义不同，是最常见的 nginx 配置错误之一。

> 非 root 说明：nginx 官方镜像 master 进程以 root 启动（绑定 80 端口），worker 降权到 nginx 用户。更严格的场景可用 `nginxinc/nginx-unprivileged` 变体（监听 8080、全程非 root）。本教程用官方镜像 + Compose 端口映射 `8080:80`。

## 11.4 验证（练习 2）

```bash
docker compose up --build -d
open http://localhost:8080          # 页面加载、能创建任务（经 nginx 代理到 api）

# SPA fallback 验证：直接访问前端路由路径不 404
curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/tasks/123   # 200

# 代理验证：同源 /api 直达 API
curl http://localhost:8080/api/tasks
```

对比实验：`pnpm --filter @workboard/web preview` 能在本地预览生产构建（`preview.proxy` 默认继承 `server.proxy`，所以 /api 也能通）。但官方明确 preview 只是**本地预览工具**：没有生产级的并发能力、安全头与运维设施——「能预览」不等于「能上生产」。

## 11.5 Supabase 本地栈为什么依赖 Docker

阶段 8 用过 `supabase start`。它的本质是：**Supabase CLI 用 Docker 拉起一组容器**——Postgres、GoTrue（鉴权）、PostgREST、Realtime、Storage、Studio 等。所以：

- **Docker runtime 是 supabase 本地栈的硬依赖**：没有 Docker，`supabase start` 直接失败；
- 本地栈的每个组件都是容器，同样遵守本教程的规则：started ≠ ready（CLI 会等健康检查）、数据在卷里（`supabase stop` 保留、`supabase stop --no-backup` 清除）；
- 本教程的 compose 用「裸 postgres」是为了讲清机制；真实项目若用 Supabase 本地栈，API 的 `DATABASE_URL` 指向 CLI 打印的本地连接串即可，容器化原理完全一致。

> 边界提醒（阶段 8 已述）：Supabase 本地栈是**开发环境**。生产用托管 Supabase 或自托管 Postgres，不要把本地栈的 compose 直接当生产部署。

## 11.6 常见坑

| 现象                              | 原因                            | 解决                                             |
| --------------------------------- | ------------------------------- | ------------------------------------------------ |
| 刷新前端路由 404                  | 没有 SPA fallback               | `try_files $uri $uri/ /index.html`               |
| /api 请求 404 或路径不对          | proxy_pass 尾部斜杠剥了前缀     | `proxy_pass http://api:3000;`（不带尾路径）      |
| 页面白屏，资源 404                | dist 没拷对位置 / base 路径不对 | 确认拷到 /usr/share/nginx/html；Vite base 默认 / |
| 把 `vite preview` 当生产          | preview 无代理、非生产设计      | nginx/平台静态托管                               |
| `supabase start` 报 Docker 不可用 | 没装/没起 Docker                | 先完成第 2 章                                    |

## 11.7 本章验收清单

- [ ] 完成练习 2：web 镜像构建成功，nginx 托管页面可用、能创建任务；
- [ ] 能解释 SPA fallback 与 /api 代理各自解决什么；
- [ ] 能说出「dev server 不当生产服务器」的三条理由；
- [ ] 能解释 Supabase 本地栈与 Docker 的依赖关系；
- [ ] 能区分 `proxy_pass` 带/不带尾部路径的语义。

---

上一章：[← 第 10 章：Compose 编排全栈](./10-compose-full-stack.md) ｜ 下一章：[第 12 章：镜像维护与综合验收 →](./12-capstone-and-acceptance.md) ｜ 返回：[教程目录 README](./README.md)
