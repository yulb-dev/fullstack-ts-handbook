# 第 12 章：Swagger UI 与 Scalar——文档页面与安全暴露

[上一章](./11-openapi-with-fastify-swagger.md) · [目录](./README.md) · [下一章](./13-logging-with-pino.md)

上一章得到了一份 OpenAPI 文档，但它是一大段 JSON，前端同事不会想直接读它。本章把它渲染成可浏览、可试调的网页，并且回答一个经常被忽视的问题：**这个页面应该给谁看？**

## 12.1 生成器与渲染器

先把职责分清楚：

```text
路由 schema ──@fastify/swagger──▶ OpenAPI 文档（JSON）──Scalar 或 Swagger UI──▶ 网页
                 生成器                                        渲染器
```

- **@fastify/swagger** 是生成器：从路由收集信息，产出 OpenAPI 文档。它提供 `app.swagger()` 方法，本身**不提供网页**。
- **Swagger UI** 和 **Scalar** 都是渲染器：读取一份 OpenAPI 文档，渲染成 API 参考页面（API reference），并提供“在页面里直接发请求试一试”的功能。

两个渲染器做的是**同一件事**，选一个就够了。同时挂两个只会增加维护成本和暴露面。TaskHub 的配套工程两个都支持，是为了让你能对比，通过配置 `DOCS_UI=scalar|swagger-ui|none` 选择其一。

|                                    | Scalar（`@scalar/fastify-api-reference`）           | Swagger UI（`@fastify/swagger-ui`）            |
| ---------------------------------- | --------------------------------------------------- | ---------------------------------------------- |
| 维护方                             | Scalar                                              | Fastify 官方插件，封装 SmartBear 的 Swagger UI |
| 界面                               | 较现代，三栏布局，内置 API 客户端                   | 经典界面，很多开发者熟悉                       |
| 与 @fastify/swagger 的关系         | 自动发现并读取                                      | 需要先注册 @fastify/swagger                    |
| 页面地址（`routePrefix: '/docs'`） | `/docs/`                                            | `/docs/`                                       |
| OpenAPI JSON 地址                  | `/docs/openapi.json`（以及 `.yaml`）                | `/docs/json`（以及 `/docs/yaml`）              |
| 保护页面的 hook 选项               | `hooks: { onRequest, preHandler }`                  | `uiHooks: { onRequest, preHandler }`           |
| 前端资源                           | 由插件从本服务的 `${routePrefix}/js/scalar.js` 提供 | 由插件从 `${routePrefix}/static/` 提供         |

## 12.2 接入 Scalar

最简单的用法只需要一行注册：

```ts
import scalar from "@scalar/fastify-api-reference";

await app.register(scalar, { routePrefix: "/docs" });
```

Scalar 的官方文档说明，它按以下优先级寻找 OpenAPI 文档：`configuration.content` → `configuration.url` → 已注册的 `@fastify/swagger`。我们已经注册了 `@fastify/swagger`，所以什么都不用传。

常用选项：

| 选项                       | 默认                                               | 说明                                                                    |
| -------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| `routePrefix`              | `/reference`                                       | 页面挂载的路径                                                          |
| `configuration`            | —                                                  | Scalar 通用配置：`title`、`theme`、`layout` 等                          |
| `openApiDocumentEndpoints` | `{ json: '/openapi.json', yaml: '/openapi.yaml' }` | 在 `routePrefix` 下额外暴露文档文件的位置                               |
| `hooks`                    | —                                                  | 应用于插件**所有**路由（页面、JS、文档文件）的 `onRequest`/`preHandler` |
| `logLevel`                 | —                                                  | 插件路由的日志级别，可以设为 `'silent'`                                 |

注意 Scalar 文档中的一句话：它暴露的 `openapi.json`/`openapi.yaml` 端点**带有宽松的 CORS 头**，方便外部工具读取。如果你的文档不应该被任意网站读取，就必须通过 `hooks` 保护它们（12.5 节）。

实测（配套工程中开启 Scalar 时）：

```text
GET /docs              → 301，Location: /docs/
GET /docs/             → 200，text/html（Scalar 页面）
GET /docs/openapi.json → 200，application/json（与 app.swagger() 内容一致）
```

## 12.3 接入 Swagger UI

```ts
import swaggerUi from "@fastify/swagger-ui";

await app.register(swaggerUi, {
  routePrefix: "/docs",
  uiConfig: { docExpansion: "list", deepLinking: true },
});
```

常用选项：`routePrefix`（默认 `/documentation`）、`uiConfig`（透传给 Swagger UI 的配置）、`uiHooks`（保护文档路由的 hook）、`staticCSP`（为静态资源加 CSP 头）、`transformSpecification`（按请求动态修改返回的文档）、`theme`、`logo` 等。

它暴露的地址是 `/docs/`（页面）、`/docs/json`、`/docs/yaml`，以及 `/docs/static/*` 静态资源。

## 12.4 TaskHub 的文档插件（渲染部分）

接上一章 `src/plugins/docs.ts` 的下半部分：

```ts
if (options.ui === "none") return;

const routePrefix = options.routePrefix ?? "/docs";
const onRequest = options.basicAuth
  ? createBasicAuthHook(options.basicAuth)
  : undefined;

if (options.ui === "scalar") {
  await app.register(scalar, {
    routePrefix,
    logLevel: "warn",
    ...(onRequest ? { hooks: { onRequest } } : {}),
    configuration: { title: "TaskHub API Reference" },
  });
} else {
  await app.register(swaggerUi, {
    routePrefix,
    logLevel: "warn",
    ...(onRequest ? { uiHooks: { onRequest } } : {}),
  });
}
```

三个设计决定：

1. **`ui === 'none'` 时仍然注册 `@fastify/swagger`**，只是不挂页面。这样 `app.swagger()` 和 `npm run openapi:export` 在任何环境都能用，CI 可以导出文档做破坏性变更检查，而生产环境不对外暴露任何文档路由。
2. **`logLevel: 'warn'`**：打开文档页面会加载 JS、CSS 等多个资源，不需要为它们记 info 级的请求日志。
3. **两个渲染器的 hook 选项名字不同**（`hooks` vs `uiHooks`），封装在同一个插件里，外部只需要传 `basicAuth`。

## 12.5 文档的安全暴露

API 文档列出了每一个接口、每一个参数、每一种错误码。对你的前端同事，这是说明书；对攻击者，这是地图。下面是 TaskHub 的做法。

### 第一层：按环境决定是否开放

```ts
// src/config.ts
docs: {
  // 生产环境默认不暴露文档，需要时显式打开
  ui: readEnum(env.DOCS_UI, ['scalar', 'swagger-ui', 'none'] as const, nodeEnv === 'production' ? 'none' : 'scalar'),
  ...(username && password ? { basicAuth: { username, password } } : {})
}
```

- 开发环境默认 Scalar，方便调试；
- 生产环境默认 `none`，要开放必须**显式**设置 `DOCS_UI`；
- 测试中 `buildApp()` 默认 `{ ui: 'none' }`，配套测试也验证了“默认不暴露任何文档页面”。

“默认安全，显式开放”比“默认开放，记得关闭”可靠得多——后者总有一天会有人忘记。

### 第二层：需要开放时加访问控制

如果预发环境或内部网络需要文档，至少加一层认证。TaskHub 用 Basic Auth（浏览器原生支持，访问页面时会弹出登录框）：

```ts
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // 长度不同也要做一次比较，避免通过耗时差异猜出长度
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function createBasicAuthHook(credentials: {
  username: string;
  password: string;
}) {
  return async function docsBasicAuth(request: FastifyRequest) {
    const header = request.headers.authorization ?? "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      const username = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);
      // 两项都比较完再判断，不用 && 短路，避免通过耗时判断用户名是否正确
      const usernameOk = safeEqual(username, credentials.username);
      const passwordOk = safeEqual(password, credentials.password);
      if (separator > 0 && usernameOk && passwordOk) return;
    }
    throw new AppError("UNAUTHORIZED", {
      headers: { "www-authenticate": 'Basic realm="api-docs"' },
    });
  };
}
```

要点：

- 用 `crypto.timingSafeEqual` 做常量时间比较，避免攻击者通过响应时间的细微差异逐字符猜测密码。这也是 `@fastify/swagger-ui` README 中示例的做法。
- 失败时返回 401 并带 `WWW-Authenticate: Basic realm="api-docs"`，浏览器看到这个头才会弹出登录框。错误响应仍然走统一的错误模型。
- 这个 hook 通过 `hooks`/`uiHooks` 作用于**插件的所有路由**：页面、JS 资源、`openapi.json` 全部受保护。Scalar 那个带宽松 CORS 头的 `openapi.json` 端点也就不再能被匿名读取。
- Basic Auth 以近似明文的方式（Base64）传输凭证，**只能在 HTTPS 下使用**。生产环境更好的做法是把文档放在公司内部的 SSO 之后，或者干脆不部署文档页面，而是把导出的 `openapi.json` 发布到内部的文档平台。

配套测试：

```ts
it("Scalar：页面与 openapi.json 都受 Basic Auth 保护", async () => {
  const app = await createTestApp({
    docs: { ui: "scalar", basicAuth: credentials },
  });

  const anonymous = await app.inject({ url: "/docs/openapi.json" });
  expect(anonymous.statusCode).toBe(401);
  expect(anonymous.headers["www-authenticate"]).toContain("Basic");

  const page = await app.inject({ url: "/docs/", headers: basic });
  expect(page.statusCode).toBe(200);
  expect(page.headers["content-type"]).toContain("text/html");

  const spec = await app.inject({ url: "/docs/openapi.json", headers: basic });
  expect(spec.json().paths).toHaveProperty("/v1/tasks");
});
```

### 第三层：文档里只写可以公开的东西

即使文档只给内部人员看，也要假设它**终将被外部看到**（截图、转发、误配置）。检查清单：

| 不要出现在文档里                         | TaskHub 的做法                                                 |
| ---------------------------------------- | -------------------------------------------------------------- |
| 内部接口、运维接口                       | `/healthz` 设置 `hide: true`                                   |
| 内部字段（备注、版本号、审计字段）       | 响应 schema 根本不声明它们，文档自然没有                       |
| 内网主机名、IP                           | `servers: [{ url: '/' }]`                                      |
| 真实或示例 token、密码、密钥             | 安全方案的描述里只说明“在 Authorization 头里携带 Bearer token” |
| 真实用户数据作为 `examples`              | 示例使用虚构数据（如“整理发布清单”）                           |
| 内部实现细节（表名、服务名、技术栈版本） | `description` 只描述行为和契约                                 |

### 第四层：小心“试一试”

Scalar 和 Swagger UI 都能直接从页面发送请求。如果文档部署在生产环境，并且用户在页面里填了**真实的生产 token**，那么点击“发送”就会**真的**创建、修改、删除生产数据。这不是 bug，而是功能，但很多人没意识到。这也是生产环境默认关闭文档的另一个原因。

### 关于 CSP

如果你的服务配置了内容安全策略（CSP，例如通过 `@fastify/helmet`），文档页面的脚本和样式可能被拦截。两个插件都提供了相应支持：`@fastify/swagger-ui` 有 `staticCSP`、`transformStaticCSP` 选项，`@fastify/swagger` 提供 `app.swaggerCSP` 帮助拼装策略；Scalar 从本服务提供脚本（`'self'` 即可覆盖），并支持通过 `configuration.nonce` 在严格 CSP 下运行。具体配置以各插件 README 为准。

## 12.6 动手：打开文档页面

```bash
cd fastify-api-tutorial/example
npm run dev
```

开发环境默认使用 Scalar。浏览器访问 `http://127.0.0.1:3000/docs`，你会看到：

- 按 `tasks`、`users` 分组的操作列表，名字来自 `summary`；
- 每个操作的参数、请求体、各状态码的响应，以及 `Task`、`ErrorResponse` 等模型；
- `pageSize` 旁边显示默认值 20、最大值 100；`sort` 显示为枚举；
- 页面上的认证（Authentication）区域可以填入 Bearer token。本地种子数据中可用的 token 是 `alice-token`、`bob-token`、`admin-token`（写在本书 README 里，而不是文档页面里）。

具体的布局和交互以你安装的 Scalar / Swagger UI 版本为准；它们展示的内容全部来自同一份 OpenAPI 文档。

想换成 Swagger UI 对比：

```bash
DOCS_UI=swagger-ui npm run dev
```

想体验 Basic Auth：

```bash
DOCS_USERNAME=docs DOCS_PASSWORD=change-me npm run dev
```

## 12.7 练习

1. 某同事为了方便，在生产环境设置了 `DOCS_UI=scalar` 但没有设置 Basic Auth。列出这会暴露哪些信息、带来哪些风险。
2. 为什么 `createBasicAuthHook` 要挂在文档插件的 `hooks`/`uiHooks` 上，而不是在根实例上 `addHook('onRequest', ...)` 并判断 URL 是否以 `/docs` 开头？
3. 团队想在内部文档平台上展示 API，但不想在任何服务器上部署文档页面。怎样利用本书已有的代码实现？

**参考答案**

1. 暴露：全部对外接口的路径、参数、约束、错误码、数据模型；可以被任何人读取的 `openapi.json`（带宽松 CORS）。风险：给攻击者提供了完整的攻击面地图；有人用真实 token 在页面上“试一试”会直接操作生产数据。至少应加访问控制，最好在生产环境关闭。
2. 插件的 hook 只作用于插件自己注册的路由，范围精确、不会遗漏插件新增的端点（比如某个版本的 Scalar 新加了一个资源路径）；而按 URL 前缀判断容易写错（`/docs` 与 `/docsXYZ`、末尾斜杠等），也会给所有其他路由增加一次无谓的判断。
3. 在 CI 中运行 `npm run openapi:export`（`ui: 'none'` 也能工作），把生成的 `openapi.json` 上传到内部文档平台（Scalar、Swagger UI 都有可以单独部署的版本，也可以读取静态文件）。生产服务器上不挂任何文档路由。

## 本章验收

- [ ] 能说清 @fastify/swagger 与 Scalar/Swagger UI 的分工，以及“二选一即可”的原因。
- [ ] 能分别接入 Scalar 和 Swagger UI，知道它们各自的页面与 JSON 地址、hook 选项名。
- [ ] 能用环境配置让生产环境默认不暴露文档。
- [ ] 能为文档路由加上访问控制，并解释常量时间比较和 HTTPS 的必要性。
- [ ] 能列出不应出现在文档中的信息，并说明“试一试”在生产环境的风险。

官方阅读：[@fastify/swagger-ui README](https://github.com/fastify/fastify-swagger-ui)、[Scalar：Fastify 集成](https://scalar.com/products/api-references/integrations/fastify)、[@fastify/swagger：Integration（CSP）](https://github.com/fastify/fastify-swagger#integration)。

下一章，[用 Pino 写出可检索、不泄密的结构化日志](./13-logging-with-pino.md)。
