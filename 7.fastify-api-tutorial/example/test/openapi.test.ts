import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { SEED_IDS } from "../src/data/seed.js";
import { API_DOC_VERSION } from "../src/plugins/docs.js";
import {
  ErrorDetailSchema,
  ErrorResponseSchema,
} from "../src/schemas/common.js";
import { TaskSchema } from "../src/schemas/task.js";
import { createTestApp } from "./helpers.js";

interface OpenApiDocument {
  openapi: string;
  info: { version: string };
  paths: Record<
    string,
    Record<
      string,
      {
        parameters?: { in: string; name: string; required: boolean }[];
        responses: Record<
          string,
          { content?: Record<string, { schema: unknown }> }
        >;
      }
    >
  >;
  components: {
    schemas: Record<string, { properties?: Record<string, unknown> }>;
    securitySchemes: Record<string, unknown>;
  };
}

describe("OpenAPI 文档", () => {
  async function getDocument(): Promise<OpenApiDocument> {
    const app = await createTestApp();
    await app.ready();
    return app.swagger() as unknown as OpenApiDocument;
  }

  it("从路由 schema 生成 OpenAPI 3.1，带版本号与安全方案", async () => {
    const doc = await getDocument();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.version).toBe(API_DOC_VERSION);
    expect(doc.components.securitySchemes).toHaveProperty("bearerAuth");
  });

  it("只包含对外的 /v1 路由；/healthz 通过 hide 隐藏", async () => {
    const doc = await getDocument();
    expect(Object.keys(doc.paths).sort()).toEqual([
      "/v1/admin/users/{userId}",
      "/v1/me",
      "/v1/tasks",
      "/v1/tasks/{taskId}",
    ]);
  });

  it("带 $id 的共享 schema 进入 components.schemas，并通过 $ref 引用", async () => {
    const doc = await getDocument();
    expect(Object.keys(doc.components.schemas).sort()).toEqual([
      "ErrorDetail",
      "ErrorResponse",
      "PageMeta",
      "PublicUser",
      "Task",
      "TaskList",
    ]);
    const getTask = doc.paths["/v1/tasks/{taskId}"]?.get;
    expect(
      getTask?.responses["200"]?.content?.["application/json"]?.schema,
    ).toEqual({ $ref: "#/components/schemas/Task" });
    expect(
      getTask?.responses["404"]?.content?.["application/json"]?.schema,
    ).toEqual({ $ref: "#/components/schemas/ErrorResponse" });
  });

  it("params / querystring / headers 被映射成 OpenAPI parameters", async () => {
    const doc = await getDocument();
    const list = doc.paths["/v1/tasks"]?.get?.parameters ?? [];
    expect(list.map((p) => `${p.in}:${p.name}:${p.required}`)).toEqual([
      "query:page:false",
      "query:pageSize:false",
      "query:sort:false",
      "query:status:false",
      "query:assigneeId:false",
    ]);
    const patch = doc.paths["/v1/tasks/{taskId}"]?.patch?.parameters ?? [];
    expect(patch.map((p) => `${p.in}:${p.name}:${p.required}`)).toEqual([
      "path:taskId:true",
      "header:if-match:false",
    ]);
  });

  it("文档中的 Task 不含内部字段", async () => {
    const doc = await getDocument();
    expect(
      Object.keys(doc.components.schemas.Task?.properties ?? {}),
    ).not.toContain("internalNote");
  });
});

describe("API Reference 页面", () => {
  const credentials = { username: "docs", password: "s3cret" };
  const basic = {
    authorization: `Basic ${Buffer.from("docs:s3cret").toString("base64")}`,
  };

  it("默认（ui: none）不暴露任何文档页面", async () => {
    const app = await createTestApp();
    expect((await app.inject({ url: "/docs/" })).statusCode).toBe(404);
  });

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

    const spec = await app.inject({
      url: "/docs/openapi.json",
      headers: basic,
    });
    expect(spec.json().paths).toHaveProperty("/v1/tasks");
  });

  it("Swagger UI：同样可以挂载，文档 JSON 在 /docs/json", async () => {
    const app = await createTestApp({
      docs: { ui: "swagger-ui", basicAuth: credentials },
    });
    expect((await app.inject({ url: "/docs/json" })).statusCode).toBe(401);

    const spec = await app.inject({ url: "/docs/json", headers: basic });
    expect(spec.statusCode).toBe(200);
    expect(spec.json().components.schemas).toHaveProperty("Task");
  });

  it("文档路由本身不会出现在 OpenAPI paths 里", async () => {
    const app = await createTestApp({ docs: { ui: "scalar" } });
    await app.ready();
    const paths = Object.keys(
      (app.swagger() as unknown as OpenApiDocument).paths,
    );
    expect(paths.some((path) => path.startsWith("/docs"))).toBe(false);
  });

  it("契约测试：真实响应能通过文档里声明的 schema 校验", async () => {
    // 响应序列化只“过滤/转换”，不做完整校验；这里用 TypeBox 再校验一遍输出
    const app = await createTestApp();
    const single = await app.inject({
      url: `/v1/tasks/${SEED_IDS.aliceTask}`,
      headers: { authorization: "Bearer alice-token" },
    });
    expect(Value.Check(TaskSchema, single.json())).toBe(true);

    const error = await app.inject({
      url: "/v1/tasks/oops",
      headers: { authorization: "Bearer alice-token" },
    });
    // ErrorResponse 通过 $ref 引用了 ErrorDetail，校验时要把被引用的 schema 作为上下文传入
    expect(
      Value.Check(
        { ErrorDetail: ErrorDetailSchema },
        ErrorResponseSchema,
        error.json(),
      ),
    ).toBe(true);
  });
});
