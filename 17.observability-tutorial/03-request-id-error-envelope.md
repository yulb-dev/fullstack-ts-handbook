# 第 3 章：requestId 与错误 envelope——把一次请求钉死

> 本章目标：让 requestId 贯穿响应头、错误 envelope、日志三处（同一来源）；建立稳定错误契约；用测试证明关联成立（练习 2）。
>
> 关键概念：requestId 写入错误响应与日志字段。｜ 动手练习：练习 2。

---

## 3.1 requestId：排障的「身份证号」

一次请求会产生多条日志、一个 trace、可能一个 Sentry 事件。**requestId 是把它们串起来的唯一线索**。用户报障时给出 requestId（页面上显示），你就能精确捞出那次请求的一切。

关键原则：**单一来源**。本教程用 Fastify 的 `request.id` 作为唯一 requestId，三处都从它取：

```ts
// 1. 响应头：让前端/客户端能拿到
app.addHook("onRequest", async (request, reply) => {
  reply.header("x-request-id", request.id);
});

// 2. 错误 envelope：失败时返回给调用方
return reply.code(500).send({
  error: {
    code: "INTERNAL_ERROR",
    message: "服务器内部错误",
    requestId: request.id,
  },
});

// 3. 日志：Fastify 自动把 request.id 作为 reqId 带入每条日志
request.log.error({ err, statusCode, code }, "request failed");
```

> 反面教材：自己 `uuid()` 生成一个 requestId 放 envelope，而日志用 Fastify 的 reqId——**两个 ID 对不上**，关联断裂。这是阶段 12 实测踩过的坑，务必单一来源。

## 3.2 稳定错误 envelope

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "服务器内部错误",
    "requestId": "req-2"
  }
}
```

- **code**：稳定的机器可读错误码（VALIDATION_ERROR / FORBIDDEN / NOT_FOUND / INTERNAL_ERROR），前端据此分支处理；
- **message**：人类可读，但 **5xx 不泄漏内部细节**（堆栈/SQL/密钥留在服务端日志）；
- **requestId**：关联线索。

统一错误出口（`app.ts` 的 setErrorHandler）：

```ts
app.setErrorHandler((err: unknown, request, reply) => {
  const error = err as { statusCode?: number; message?: string };
  const statusCode =
    typeof error.statusCode === "number" ? error.statusCode : 500;
  const code =
    statusCode === 400
      ? "VALIDATION_ERROR"
      : statusCode >= 500
        ? "INTERNAL_ERROR"
        : "REQUEST_ERROR";
  request.log.error({ err, statusCode, code }, "request failed"); // 内部细节进日志
  if (statusCode >= 500) {
    Sentry.captureException(err, {
      tags: { requestId: request.id, errorCode: code },
    }); // 第 6 章
  }
  return reply.code(statusCode).send({
    error: {
      code,
      message:
        statusCode >= 500 ? "服务器内部错误" : (error.message ?? "请求错误"),
      requestId: request.id,
    },
  });
});
```

**内部细节与对外信息的边界**：日志保留排查所需上下文（err.stack），envelope 只给安全信息。这正是路线图阶段 11「错误可被 UI 解释，服务端日志保留上下文，不泄露内部细节」的落地。

## 3.3 用测试证明关联（练习 2）

`test/app.test.ts` 的关键断言：

```ts
it("响应头 x-request-id 与错误 envelope 的 requestId 同源", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/tasks",
    payload: {},
  });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.requestId).toBe(res.headers["x-request-id"]);
});

it("模拟数据库故障 → 500，envelope 不泄漏内部细节", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/tasks",
    payload: { title: "FAIL_DB" },
  });
  expect(res.statusCode).toBe(500);
  expect(res.json().error.message).not.toContain("connection terminated");
  expect(res.json().error.requestId).toBe(res.headers["x-request-id"]);
});
```

运行 `pnpm test`：10 个测试覆盖 requestId 同源、403/400/500 失败路径、不泄密、span 与日志关联。**关联不是「看起来对」，而是被测试钉死的契约**。

## 3.4 常见坑

| 现象                               | 原因                            | 解决                           |
| ---------------------------------- | ------------------------------- | ------------------------------ |
| envelope 的 requestId 与日志对不上 | 两个来源（自造 uuid vs req.id） | 单一来源 request.id            |
| 500 响应里带堆栈/SQL               | 直接把 err.message 返回         | 5xx 用通用 message，细节进日志 |
| 前端拿不到 requestId               | 没设响应头                      | onRequest 设 x-request-id      |
| 错误码不稳定                       | 每次随手写字符串                | 固定 code 枚举                 |

## 3.5 本章验收清单

- [ ] 完成练习 2：requestId 贯穿响应头/envelope/日志，测试证明同源；
- [ ] 错误 envelope 稳定，5xx 不泄密；
- [ ] 能解释「单一来源」为什么重要；
- [ ] 失败路径（400/403/500）都有测试。

---

上一章：[← 第 2 章：结构化日志与 Pino](./02-structured-logging-pino.md) ｜ 下一章：[第 4 章：Sentry 心智模型 →](./04-sentry-mental-model.md) ｜ 返回：[教程目录 README](./README.md)
