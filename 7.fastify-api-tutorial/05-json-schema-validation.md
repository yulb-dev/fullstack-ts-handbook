# 第 5 章：JSON Schema 与请求校验

[上一章](./04-lifecycle-and-hooks.md) · [目录](./README.md) · [下一章](./06-typebox.md)

第 2 章结尾的练习里，`?excited=yes` 被当成了字符串 `'yes'`，代码无法分辨它是不是一个合法值。本章用 **JSON Schema** 给请求的四个部分（params、querystring、headers、body）写下规则，让 Fastify 在调用 handler **之前**完成检查。

为了看清 JSON Schema 本身，本章**手写原始 JSON**。下一章再用 TypeBox 改写成更简洁、带类型推断的形式——你会发现生成的东西和本章手写的几乎一模一样。

## 5.1 Fastify 怎样校验一个请求

```text
启动时：路由 schema ──Ajv 编译──▶ 校验函数（每个路由、每个部分各一个）
请求时：params ─▶ body ─▶ querystring ─▶ headers   依次校验，第一个失败就停止，返回 400
```

两个要点：

1. **编译发生在启动时**。Ajv 把 schema 转换成高度优化的 JavaScript 函数，请求进来时只是调用它，所以校验几乎不增加开销。也因此，**schema 写错（比如 `$ref` 指向不存在的 id）会导致启动失败**，而不是运行时才发现。
2. 四个部分**按顺序**校验，前一个失败就不再检查后面的。所以一个请求即使 body 和 query 都有问题，错误信息也只会说其中一个。

Fastify 官方文档有一条重要警告：**schema 应当视为应用代码**。Ajv 和 fast-json-stringify 会用 `new Function()` 生成代码，**永远不要用用户输入拼接 schema**。

## 5.2 JSON Schema 速成

JSON Schema 本身也是一个 JSON 对象，描述“另一个 JSON 值应该长什么样”。下面是最常用的关键字，足够覆盖本书的全部需求：

```json
{
  "type": "object",
  "required": ["title"],
  "properties": {
    "title": { "type": "string", "minLength": 1, "maxLength": 120 },
    "priority": { "enum": ["low", "medium", "high"] },
    "description": { "type": ["string", "null"], "maxLength": 2000 },
    "assigneeId": { "type": ["string", "null"], "format": "uuid" },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "maxItems": 10,
      "uniqueItems": true
    },
    "estimate": { "type": "integer", "minimum": 1, "maximum": 100 }
  },
  "additionalProperties": false
}
```

| 关键字                                            | 含义                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                                            | 值的类型：`string`、`number`、`integer`、`boolean`、`object`、`array`、`null`；也可以是数组，如 `["string", "null"]` 表示“字符串或 null” |
| `properties`                                      | 对象每个属性的子 schema                                                                                                                  |
| `required`                                        | 必须出现的属性名列表。**没列在这里的属性都是可选的**                                                                                     |
| `additionalProperties`                            | 是否允许 `properties` 之外的属性。`false` 表示不允许                                                                                     |
| `minLength` / `maxLength` / `pattern`             | 字符串长度、正则                                                                                                                         |
| `format`                                          | 语义格式：`uuid`、`email`、`date-time`、`uri` 等（Fastify 内置了 ajv-formats）                                                           |
| `minimum` / `maximum`                             | 数值范围                                                                                                                                 |
| `enum` / `const`                                  | 只允许列出的值 / 只允许一个值                                                                                                            |
| `items` / `minItems` / `maxItems` / `uniqueItems` | 数组元素与数量                                                                                                                           |
| `anyOf` / `oneOf` / `allOf`                       | 组合：满足任一 / 恰好一个 / 全部                                                                                                         |
| `default`                                         | 默认值（Fastify 会用它补齐缺失字段，见 5.4）                                                                                             |
| `description` / `examples` / `title`              | 注释性信息，不影响校验，但会进入 API 文档                                                                                                |

两个新手常犯的错：

- `required` 写在**对象层级**，而不是写在属性里。`{ "title": { "type": "string", "required": true } }` 是错误写法。
- 一个属性“可以为 null”和“可以不传”是两件事：前者用 `"type": ["string", "null"]`，后者是“不放进 `required`”。

> Fastify 文档中的示例都使用 JSON Schema Draft 7，内置的 Ajv 默认也按这个版本工作。本书用到的关键字在 Draft 7 和更新的 2020-12 版本中含义一致。

## 5.3 四个位置，各写一份 schema

在路由选项的 `schema` 里，用 `params`、`querystring`（也可以写 `query`）、`headers`、`body` 分别声明规则。下面是 TaskHub 几个路由的“原始 JSON Schema 版本”。

### params：路径参数

```ts
app.get(
  "/tasks/:taskId",
  {
    schema: {
      params: {
        type: "object",
        required: ["taskId"],
        properties: {
          taskId: { type: "string", format: "uuid" },
        },
      },
    },
  },
  handler,
);
```

`GET /v1/tasks/abc` 会在进入 handler 之前得到 400，handler 再也不用写 `if (!isUuid(taskId))`。

### querystring：查询参数

```ts
app.get(
  "/tasks",
  {
    schema: {
      querystring: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, default: 1 },
          pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          sort: {
            enum: [
              "createdAt",
              "-createdAt",
              "priority",
              "-priority",
              "title",
              "-title",
            ],
            default: "-createdAt",
          },
          status: { enum: ["todo", "doing", "done"] },
          assigneeId: { type: "string", format: "uuid" },
        },
        additionalProperties: false,
      },
    },
  },
  handler,
);
```

URL 里的一切本来都是字符串，`?page=2` 中的 `2` 是 `'2'`。声明 `type: 'integer'` 后，Fastify 会把它**转换**成数字 `2`（5.4 节）。

`sort` 用 `enum` 做**白名单**：只有这六个值能通过。这一点在第 10 章讲分页契约时非常关键——永远不要把客户端传来的字段名直接拼进数据库排序语句。

### headers：请求头

```ts
app.patch(
  "/tasks/:taskId",
  {
    schema: {
      headers: {
        type: "object",
        properties: {
          "if-match": { type: "string", pattern: '^"[0-9]+"$' },
        },
      },
    },
  },
  handler,
);
```

请求头有两个特别之处：

1. **Node.js 收到的请求头名全部是小写**。Fastify 会把 headers schema 里的属性名、`required` 列表也转成小写再编译，所以写 `'If-Match'` 也能工作；但用 `patternProperties` 这类正则匹配头名时，Fastify 无法改写正则，必须自己写成小写。本书统一写小写，避免混乱。
2. **不要给 headers 设置 `additionalProperties: false`**。每个请求都带着 `host`、`user-agent`、`accept` 等大量头，开启后它们会被移除或导致校验失败。只声明你关心的头即可。

### body：请求体

```ts
app.post(
  "/tasks",
  {
    schema: {
      body: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 120 },
          description: { type: ["string", "null"], maxLength: 2000 },
          priority: { enum: ["low", "medium", "high"] },
          assigneeId: { type: ["string", "null"], format: "uuid" },
        },
        additionalProperties: false,
      },
    },
  },
  handler,
);
```

注意 `format: 'uuid'` 和 `maxLength` 这类关键字**只对字符串生效**，值为 `null` 时会被直接跳过，所以 `type: ['string', 'null']` 配合它们正好表达“要么是合法 UUID，要么是 null”。

body 校验只对 `Content-Type: application/json` 的请求生效（除非你用 `content` 字段为不同媒体类型分别声明 schema）。Fastify 还内置了 `text/plain` 解析器：发送 `text/plain` 时 body 是一个字符串，会因为 `type: 'object'` 校验失败；发送 Fastify 不认识的类型（比如 `application/xml`）则直接得到 415。

## 5.4 Fastify 的 Ajv 默认配置，以及它带来的后果

Fastify 并不是用 Ajv 的默认配置，而是用了这样一组基线配置（来自 Fastify 文档与 `@fastify/ajv-compiler` 源码）：

```js
{
  coerceTypes: 'array',    // 尝试把值转换成 schema 要求的类型
  useDefaults: true,       // 用 default 补齐缺失的属性
  removeAdditional: true,  // additionalProperties: false 时，移除多余属性（而不是报错）
  allErrors: false         // 遇到第一个错误就停止（防 DoS）
}
```

这四个配置**都会修改你的数据**或影响错误数量，必须清楚它们的行为。下面的输出都来自真实运行。

### `coerceTypes`：类型转换

对 querystring、params、headers 来说，这是必需的——它们天生全是字符串：

```text
GET /q?ids=1             → { "ids": [1] }       单个值被包成数组（'array' 模式），再转成整数
GET /q?ids=a             → 400 querystring/ids/0 must be integer
headers x-api-version: 2 → request.headers['x-api-version'] === 2（number）
```

但这个配置**同样作用于 body**。用 `{ title: string, done: boolean, n: integer }` 的 schema 测试：

```text
POST {"title": 123, "done": "true", "n": "5"}  → 200，body 变成 {"title":"123","done":true,"n":5}
POST {"title": null}                           → 200，body 变成 {"title":""}
```

数字 `123` 被悄悄转成字符串 `"123"`，`null` 被转成空字符串 `""`。对于一个严格的 JSON API，这通常不是你想要的。

更隐蔽的坑在 `anyOf` 上。很多人会把“字符串或 null”写成：

```json
{ "anyOf": [{ "type": "string", "maxLength": 2000 }, { "type": "null" }] }
```

Ajv 按顺序尝试每个分支，在第一个分支里就把 `null` **转换成了 `""`**，于是校验通过、值也变了。TaskHub 在开发时就踩到了这个坑：客户端明确传了 `"description": null`，存进去的却是空字符串。Fastify 文档对此也有专门的警告。

解决办法是改用 **type 数组**：`{ "type": ["string", "null"] }`。Ajv 只有在“所有列出的类型都不匹配”时才会转换，`null` 本身就匹配 `'null'`，于是原样保留。第 6 章的 `Nullable()` 工具函数就是为此而写，配套工程里也有对应的回归测试。

如果你的 API 要求 body 完全不做类型转换（例如 `"title": 123` 必须被拒绝），Fastify 文档给出了做法：为 `body` 与其他部分分别配置不同的 Ajv 实例（`setValidatorCompiler` 或 `schemaController`）。这会让共享 schema 的管理更复杂，TaskHub 选择保留 Fastify 默认配置，并用 schema 写法规避 `null` 的问题。这是一个需要团队明确做出的取舍，而不是默认就安全的事。

### `useDefaults`：补默认值

```text
GET /v1/tasks              → handler 看到 { page: 1, pageSize: 20, sort: '-createdAt' }
```

客户端什么都没传，Ajv 按 `default` 补齐。这让 handler 不用到处写 `?? 20`——但要注意，**TypeScript 并不知道这件事**，第 6 章会处理这个落差。

### `removeAdditional`：移除未声明的字段

```text
POST /v1/tasks {"title":"写周报","ownerId":"<Bob 的 ID>","status":"done"}
→ handler 看到 { title: '写周报' }
```

在 `additionalProperties: false` 的对象上，Fastify **不报错，而是直接删掉**多余字段。这是防御**批量赋值（mass assignment）**的第一道防线：客户端无法通过多传字段，修改 `ownerId`、`status` 这些不该由它决定的值。

这个行为有两面：

- **好处**：老客户端多传了已经废弃的字段，不会突然收到 400。
- **代价**：客户端拼错字段名（`titel`）时不会得到任何提示，字段被静默丢弃。

还有一个细节：`minProperties`、`required` 这类检查发生在移除**之前**。TaskHub 的 PATCH 要求 `minProperties: 1`，请求 `{ "ownerId": "..." }` 能通过这项检查，随后 `ownerId` 被移除，handler 拿到一个空对象。所以 service 层要能正确处理“实际上什么都没改”的情况（TaskHub 原样返回任务、不增加版本号，并有测试覆盖）。

### `allErrors: false`：只报第一个错误

Ajv 默认在遇到第一个错误时停止。Fastify 特意保持这个设置，因为 `allErrors: true` 会让攻击者构造出让校验器做大量无用功的输入，存在拒绝服务风险。代价是客户端一次只能看到一个错误。

例外是 `anyOf`/`oneOf`：Ajv 需要尝试每个分支，所以每个失败分支的错误都会被收集起来。这也是第 6 章建议“纯字符串枚举用 `enum`，别用 `anyOf` + `const`”的原因之一。

## 5.5 校验失败时发生了什么

没有自定义错误处理器时，Fastify 返回：

```json
{
  "statusCode": 400,
  "code": "FST_ERR_VALIDATION",
  "error": "Bad Request",
  "message": "body/n must be integer"
}
```

在错误对象上，Fastify 额外附加了两个属性，供自定义错误处理器使用：

- `error.validation`：Ajv 的原始错误数组，每项有 `instancePath`、`keyword`、`params`、`message`、`schemaPath`；
- `error.validationContext`：出错的部位，`'body'`、`'params'`、`'querystring'` 或 `'headers'`。

第 9 章会把它转换成 TaskHub 的统一格式：

```json
{
  "statusCode": 400,
  "code": "VALIDATION_FAILED",
  "message": "请求参数不符合接口约定",
  "requestId": "…",
  "details": [
    {
      "location": "params",
      "field": "/taskId",
      "rule": "format",
      "message": "must match format \"uuid\""
    }
  ]
}
```

注意转换时我们**没有**透传 `schemaPath`（如 `#/properties/taskId/format`）：它暴露的是服务端 schema 的内部结构，对客户端没有用处。Fastify 文档也提醒，默认情况下校验细节会出现在响应里，如有需要应通过 `setErrorHandler` 自行裁剪。

如果某个路由需要自己处理校验错误（比如表单提交后重新渲染页面），可以设置路由选项 `attachValidation: true`，错误会挂到 `request.validationError` 上，handler 照常执行。API 服务一般不需要这样做。

## 5.6 校验之外的输入防线

JSON Schema 管的是“形状”。Fastify 在解析阶段还有几道防线，值得知道它们的存在：

| 防线              | 默认行为                                                                                            | 相关选项                                     |
| ----------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 请求体大小        | 超过 1 MiB 返回 413                                                                                 | `bodyLimit`（全局或路由级）                  |
| 原型污染          | JSON 中出现 `__proto__`、`constructor.prototype` 时拒绝请求（实测返回 400，错误码与非法 JSON 相同） | `onProtoPoisoning`、`onConstructorPoisoning` |
| 非法 JSON         | 返回 400 `FST_ERR_CTP_INVALID_JSON_BODY`                                                            | —                                            |
| 未知 Content-Type | 返回 415 `FST_ERR_CTP_INVALID_MEDIA_TYPE`                                                           | `addContentTypeParser`                       |

还有一条来自 Fastify 文档的明确警告：**不要在校验阶段访问数据库**。Ajv 支持 `$async` 异步校验，但 Fastify 建议不要用于初始校验，因为它会把昂贵的数据库查询暴露在任何人都能触发的位置，容易被用来做拒绝服务攻击。需要查库的检查放到 `preHandler` 或业务层——这正是第 8 章的主题。

## 5.7 练习

1. 为 `GET /v1/tasks` 加一个可选的 `tag` 查询参数，允许传多个（`?tag=a&tag=b`），每个 1~20 字符，最多 5 个。写出 schema。
2. 下面这个 body schema 有三个问题，找出来：

   ```json
   {
     "type": "object",
     "properties": {
       "title": { "type": "string", "required": true },
       "priority": { "anyOf": [{ "const": "low" }, { "const": "high" }] },
       "dueDate": { "type": "string" }
     }
   }
   ```

3. 请求 `PATCH /v1/tasks/abc`，body 是 `{"title": 1}`。客户端会收到关于哪个部位的错误？为什么？

**参考答案**

1. ```json
   "tag": { "type": "array", "items": { "type": "string", "minLength": 1, "maxLength": 20 }, "maxItems": 5 }
   ```
   放在 `querystring.properties` 下。得益于 `coerceTypes: 'array'`，只传一个 `?tag=a` 也会被转换成 `['a']`。
2. （1）`required` 写错了位置，应写成对象层级的 `"required": ["title"]`；（2）`priority` 用 `anyOf` + `const`，错误信息冗长，用 `"enum": ["low", "high"]` 更好；（3）`dueDate` 只限定为字符串，应加 `"format": "date"` 或 `"date-time"`；另外缺少 `additionalProperties: false`，客户端可以多传任意字段。
3. 只会收到 **params** 的错误（`taskId` 不是 UUID）。Fastify 按 params → body → querystring → headers 的顺序校验，第一个失败就停止。

## 本章验收

- [ ] 能手写包含 `type`、`required`、`properties`、`additionalProperties`、`enum`、`format`、`minimum/maximum` 的 JSON Schema。
- [ ] 能为 params、querystring、headers、body 分别写 schema，知道 headers 的大小写规则和不应限制额外属性。
- [ ] 能解释 Fastify 的四个 Ajv 默认配置，各举一个它修改数据的实际例子。
- [ ] 能解释 `anyOf` + `null` 在类型转换下的陷阱，以及用 type 数组规避的原理。
- [ ] 知道校验错误对象上的 `validation` 与 `validationContext`，以及为什么不能在校验阶段查数据库。

官方阅读：[Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)、[Understanding JSON Schema](https://json-schema.org/understanding-json-schema/)、[Ajv：类型转换](https://ajv.js.org/coercion.html)、[Ajv：修改数据](https://ajv.js.org/guide/modifying-data.html)。

下一章，[用 TypeBox 让 schema 和类型合二为一](./06-typebox.md)。
