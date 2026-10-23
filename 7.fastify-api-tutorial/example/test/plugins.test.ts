import Fastify from "fastify";
import fp from "fastify-plugin";
import { describe, expect, it } from "vitest";
import authPlugin from "../src/plugins/auth.js";
import { createTestApp } from "./helpers.js";

describe("插件装配与封装", () => {
  it("fastify-plugin 包装的装饰器对根实例可见，普通 register 的不可见", async () => {
    const app = await createTestApp();
    await app.ready();

    // db / auth 用 fastify-plugin 包装：根实例和所有子作用域都能用
    expect(app.hasDecorator("db")).toBe(true);
    expect(app.hasDecorator("authenticate")).toBe(true);
    expect(app.hasRequestDecorator("user")).toBe(true);

    // tasks 路由插件是普通 register：它的装饰器被封装在自己的作用域里
    expect(app.hasDecorator("taskService")).toBe(false);
    expect(app.hasRequestDecorator("task")).toBe(false);
  });

  it("同一个插件，包不包 fastify-plugin 的差别", async () => {
    const plain = async (instance: ReturnType<typeof Fastify>) => {
      instance.decorate("answer", 42);
    };

    const encapsulated = Fastify();
    await encapsulated.register(plain);
    await encapsulated.ready();
    expect(encapsulated.hasDecorator("answer")).toBe(false);

    const shared = Fastify();
    await shared.register(fp(plain));
    await shared.ready();
    expect(shared.hasDecorator("answer")).toBe(true);
  });

  it("声明了依赖的插件，缺少依赖时启动失败（而不是运行到一半才报错）", async () => {
    const app = Fastify();
    app.register(authPlugin); // auth 依赖 db，但这里没有注册 db
    await expect(app.ready()).rejects.toThrow(/db/);
  });

  it("/v1 下的路由都经过 authenticate，/healthz 不受影响（hook 的作用域）", async () => {
    const app = await createTestApp();
    expect((await app.inject({ url: "/healthz" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/v1/tasks" })).statusCode).toBe(401);
  });

  it("认证放在 onRequest：未登录请求在解析 body 之前就被拒绝", async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { "content-type": "application/json" },
      payload: "{broken json",
    });
    // 如果先解析 body，这里会是 400 INVALID_JSON
    expect(response.statusCode).toBe(401);
  });
});

describe("请求生命周期中 hook 的执行顺序", () => {
  async function buildProbe() {
    const calls: string[] = [];
    const app = Fastify();

    app.addHook("onRequest", async () => {
      calls.push("onRequest");
    });
    app.addHook("preParsing", async (_request, _reply, payload) => {
      calls.push("preParsing");
      return payload;
    });
    app.addHook("preValidation", async () => {
      calls.push("preValidation");
    });
    app.addHook("preHandler", async () => {
      calls.push("preHandler");
    });
    app.addHook("preSerialization", async (_request, _reply, payload) => {
      calls.push("preSerialization");
      return payload;
    });
    app.addHook("onError", async () => {
      calls.push("onError");
    });
    app.addHook("onSend", async (_request, _reply, payload) => {
      calls.push("onSend");
      return payload;
    });
    app.addHook("onResponse", async () => {
      calls.push("onResponse");
    });

    app.post(
      "/probe",
      {
        // 路由级 hook 总是排在同类共享 hook 之后
        preHandler: async () => {
          calls.push("route preHandler");
        },
        schema: {
          body: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } },
          },
        },
      },
      async () => {
        calls.push("handler");
        return { ok: true };
      },
    );

    await app.ready();
    return { app, calls };
  }

  it("正常请求：依次经过全部阶段", async () => {
    const { app, calls } = await buildProbe();
    const response = await app.inject({
      method: "POST",
      url: "/probe",
      payload: { name: "x" },
    });
    expect(response.statusCode).toBe(200);
    await app.close(); // close 会等待 onResponse 执行完
    expect(calls).toEqual([
      "onRequest",
      "preParsing",
      "preValidation",
      "preHandler",
      "route preHandler",
      "handler",
      "preSerialization",
      "onSend",
      "onResponse",
    ]);
  });

  it("校验失败：跳过 preHandler 和 handler，进入 onError，但 onSend/onResponse 仍会执行", async () => {
    const { app, calls } = await buildProbe();
    const response = await app.inject({
      method: "POST",
      url: "/probe",
      payload: { other: 1 },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
    expect(calls).toEqual([
      "onRequest",
      "preParsing",
      "preValidation",
      "onError",
      "onSend",
      "onResponse",
    ]);
  });
});
