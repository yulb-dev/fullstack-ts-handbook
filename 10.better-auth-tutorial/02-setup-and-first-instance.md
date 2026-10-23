# 第 2 章：从空目录建立服务端，创建第一个 Better Auth 实例

[上一章](./01-authentication-session-authorization.md) · [目录](./README.md) · [下一章](./03-models-adapter-and-first-migration.md)

本章只做一件事：让一个 Node + TypeScript 工程拥有清晰的配置入口与认证实例。数据库建表在下一章，HTTP 集成在第 4 章。把步骤拆开，遇到问题才知道是哪一层没有完成。

## 2.1 版本要成套，不能把旧文章与新 API 拼起来

本教程核对时，官方当前稳定文档是 **1.7.x**；npm 上 `better-auth`、`auth` CLI、`@better-auth/drizzle-adapter` 都为 **1.7.12**。本教程固定这些版本，不使用 1.8 beta。

技术基线：

| 项目                                | 本教程版本       | 原因                                                  |
| ----------------------------------- | ---------------- | ----------------------------------------------------- |
| Node.js                             | 24 LTS           | Fastify 5 与现代 Fetch API；`auth` CLI 需要至少 22.12 |
| Better Auth / CLI / Drizzle adapter | 1.7.12           | 同步发布，匹配当前稳定官方文档                        |
| Fastify / CORS                      | 5.12.7 / 11.3.1  | 相匹配的主版本                                        |
| Drizzle ORM / Kit                   | 0.45.4 / 0.31.11 | 使用 Better Auth 默认 Relations v1 适配路径           |
| TypeScript                          | 5.9.3            | strict 类型检查                                       |
| Postgres                            | 本地建议 17      | 真实部署请按团队支持版本选择                          |

工作区另一份 Drizzle 教程用了 1.0 RC / Relations v2。**这里有意使用稳定 0.45.4，不能照搬那份教程的 `defineRelations`。** Better Auth 官方现在也提供 `@better-auth/drizzle-adapter/relations-v2`；第 14 章解释何时换它。本教程所有普通查询使用 `.select().from()`，不会因为关系 API 不同而失去基础 SQL 可读性。

注意官方 Fastify 集成页的 Node ≥16 是该页示例的历史前提，不是现代依赖组合的运行下限。应同时满足实际安装包、Fastify 与 CLI 的要求。

## 2.2 两条学习路径

如果你希望先确认最终工程能运行，再理解每步：

```bash
cd better-auth-tutorial/example
npm ci
```

先按本章配置 `.env`，再按第 3 章执行数据库迁移。最终工程已经提供生成的 schema、迁移和 lockfile。

如果你要从空目录跟做：

```bash
mkdir harbor-auth
cd harbor-auth
npm init -y
npm pkg set type=module
npm install --save-exact better-auth@1.7.12 @better-auth/drizzle-adapter@1.7.12 fastify@5.12.7 @fastify/cors@11.3.1 drizzle-orm@0.45.4 pg@8.16.3 zod@4.1.12 dotenv@17.2.3
npm install -D --save-exact auth@1.7.12 drizzle-kit@0.31.11 typescript@5.9.3 tsx@4.23.15 @types/node@24.19.2 @types/pg@8.15.5
```

命令结束后保留 `package-lock.json`。后续协作者用 `npm ci`，不重新解算依赖。在 package.json 中加入以下 scripts（其他依赖保留 npm 已写入的内容），完整文件可对照 [package.json](./example/package.json)：

```json
"scripts": {
  "dev": "tsx watch src/server.ts",
  "web": "vite web --host 127.0.0.1 --port 5173 --strictPort",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "auth:generate": "auth generate --config ./src/auth-schema.config.ts --output ./src/db/auth-schema.ts --yes",
  "auth:check": "auth check schema --config ./src/auth.ts",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:check": "drizzle-kit check"
}
```

Vite 在第 5 章安装，测试依赖在第 15 章安装；脚本先准备好，不必现在全部运行。章节中的代码块有些是讲解用的局部片段，**每个涉及完整文件的步骤都提供了配套文件链接**；创建文件时以完整文件为基准，不需要自己猜省略的 imports 或 helper。

## 2.3 TypeScript 与目录

建立 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"]
  },
  "include": ["src", "test", "web", "drizzle.config.ts", "vitest.config.ts"]
}
```

为什么有 DOM？服务端会用标准 `Request`、`Response`、`Headers` 类型；这不意味着服务端代码运行在浏览器。

NodeNext 下，TypeScript 源文件之间写 `import "./env.js"`。TypeScript 能找到对应 `.ts`，实际编译后的导入也正确。不要为绕过错误随意混用 CommonJS 与 ESM。

最终目录先记住这些职责：

```text
src/
  env.ts                 环境变量校验
  auth-options.ts        认证配置与邮件回调
  auth-schema.config.ts  CLI 生成入口，无已生成 schema 依赖
  auth-factory.ts        使用真实 Drizzle schema 创建实例
  auth.ts                运行时实例
  db/
    auth-schema.ts       Better Auth CLI 生成
    app-schema.ts        自有业务表
    schema.ts            两类表的统一导出
    client.ts            pg 连接池与 Drizzle
    types.ts             数据库/事务共享类型
  app.ts                 可被测试调用的 Fastify 工厂
  server.ts              listen 与关闭资源
  services.ts            workspace/task 授权与数据库操作
web/                     最小交互页面
test/                    会话与越权测试
```

不是每个函数都必须建立一个类。这里拆分的理由是：CLI 可以生成尚不存在的 schema，测试可以替换数据库与邮件交付，服务进程可以明确关闭连接池。

## 2.4 配置三个不同的地址

本地使用：

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/harbor
BETTER_AUTH_URL=http://localhost:4000
WEB_ORIGIN=http://localhost:5173
BETTER_AUTH_SECRET=在这里填写你自己生成的值
NODE_ENV=development
MAIL_MODE=local
```

- `DATABASE_URL`：服务端连接数据库，不给浏览器。
- `BETTER_AUTH_URL`：浏览器看到的认证服务公开 origin。Better Auth 由它构造验证邮件和 OAuth 回调。
- `WEB_ORIGIN`：发起请求的页面 origin，用于 trusted origins 与 CORS。

本地 API 虽然在 4000，网页在 5173，仍要分别填写；端口不同就是不同 origin。统一使用 `localhost`，不要页面是 `127.0.0.1`、API 是 `localhost`。

Origin 的形状是 `协议://主机[:端口]`，没有路径。本教程配置校验拒绝尾部斜杠、路径与 URL 凭证，以便白名单能精确比较。

## 2.5 生成真正的 secret

在本机执行：

```bash
openssl rand -base64 32
```

把输出填进 `.env`。不要复制教程里的固定字符串，不要把密码或公司名称当作 secret。官方要求至少 32 字符且有高熵；满足长度不代表随机性足够。

同一环境下多个 API 实例必须用同一组密钥，否则 A 签发的 Cookie 到 B 可能无法验证。生产、测试、开发使用不同密钥。`.env` 加入 `.gitignore`；`.env.example` 只保留变量名与说明。

secret 负责 Better Auth 的签名、加密等机制，不是数据库密码，也不是用来给用户密码做普通 SHA256 的“盐”。第 11 章解释密码哈希。

## 2.6 先创建可读的最小实例

在临时学习文件 `src/first-auth.ts` 写：

```ts
import "dotenv/config";
import { betterAuth } from "better-auth";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: pool,
  trustedOrigins: ["http://localhost:5173"],
  emailAndPassword: { enabled: true },
});
```

逐项理解：

1. `betterAuth(options)` 建立服务端认证实例。
2. `database: pool` 使用内建 Postgres/Kysely 适配，不是 Drizzle adapter。
3. `emailAndPassword.enabled` 开启邮箱密码；默认并非替你开好全部登录方式。
4. `trustedOrigins` 扩展允许的页面来源。
5. `auth.handler` 是处理 HTTP 请求的入口；`auth.api` 是服务端方法入口。

这个文件是帮助看清最小对象的学习步骤，**不作为最终运行入口，不在这里执行 migrate**。下一章切换到 Drizzle adapter，并把全部表交给一条 Drizzle 迁移链管理。不要同时让两个迁移工具对同一认证表负责。

现在也还不能说“认证系统已经完成”：没有建表、挂 handler、客户端 Cookie、邮件或业务授权。

## 2.7 为什么最终工程要校验环境变量

`process.env.X as string` 只是类型断言，值可能仍为 `undefined`。开发时偷偷回退到 localhost，可能让生产邮件链接指向本机。

最终 [env.ts](./example/src/env.ts) 使用 Zod：

```ts
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_URL: z.url(),
  WEB_ORIGIN: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  MAIL_MODE: z.enum(["local", "resend"]).default("local"),
});
```

除此之外，代码还检查生产必须 HTTPS、不能打印认证邮件、GitHub 凭证成对配置。按照文件完整实现创建你的 `src/env.ts`；它不连接数据库，因此能被 CLI 与应用共同使用。

“启动时报错”常常比“发送了错误链接后才发现”更安全。配置检查也不能证明邮件域名已验证或代理已配置正确，这些需要后面的真实环境验收。

## 2.8 练习与参考判断

练习：故意把 secret 留空，或者把 `BETTER_AUTH_URL` 写为 `http://localhost:4000/api/auth`。先预测程序应该怎样失败。

参考：校验应拒绝空 secret；本教程 `BETTER_AUTH_URL` 要填 origin，`basePath: "/api/auth"` 单独配置。不要用错误地址通过断言消除类型报错。

再问：把 `BETTER_AUTH_SECRET` 放进 `VITE_BETTER_AUTH_SECRET` 后前端能不能更方便地登录？

参考：不能。Vite 的公开变量会进入浏览器包。客户端只需要公开地址与客户端 SDK，不需要服务端密钥或数据库连接。

## 2.9 本章验收

- [ ] 安装依赖有明确版本，并保留 lockfile。
- [ ] 能区分 API origin、页面 origin 与数据库 URL。
- [ ] 会生成密钥，理解多实例一致与环境隔离。
- [ ] 知道 `auth.handler` 和 `auth.api` 是不同调用入口。
- [ ] 没有提前对认证表运行两套 migration。

官方阅读：[Installation](https://better-auth.com/docs/installation)、[PostgreSQL](https://better-auth.com/docs/adapters/postgresql)、[CLI](https://better-auth.com/docs/concepts/cli)、[1.7 Upgrade Guide](https://better-auth.com/docs/guides/1-7-upgrade-guide)。
