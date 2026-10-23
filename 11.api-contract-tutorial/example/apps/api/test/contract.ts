import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";

/**
 * 用「已发布的 openapi.json」校验真实响应 —— 契约测试。
 * Fastify 的响应 schema 只负责序列化，不会拒绝错误的数据（例如非法枚举值），
 * 所以必须在测试里用独立校验器再检查一次。
 */
const doc = JSON.parse(
  readFileSync(
    new URL("../../../packages/api-client/openapi.json", import.meta.url),
    "utf8",
  ),
);

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(doc, "openapi.json");

export function assertMatchesSchema(name: string, value: unknown) {
  const validate = ajv.getSchema(`openapi.json#/components/schemas/${name}`);
  if (!validate) throw new Error(`契约里没有 schema：${name}`);
  if (!validate(value)) {
    throw new Error(
      `响应不符合契约 ${name}：${JSON.stringify(validate.errors, null, 2)}`,
    );
  }
}

export const openapiDoc = doc as {
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
  paths: Record<
    string,
    Record<
      string,
      {
        operationId?: string;
        security?: unknown[];
        responses: Record<string, unknown>;
      }
    >
  >;
};
