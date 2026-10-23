import type {
  FastifyError,
  FastifyInstance,
  FastifySchemaValidationError,
} from "fastify";
import fp from "fastify-plugin";
import type { ErrorResponse, FieldError } from "../contract/common";
import { AppError } from "../domain/errors";

const LOCATION: Record<string, FieldError["in"]> = {
  body: "body",
  querystring: "query",
  params: "params",
  headers: "headers",
};

/** JSON Pointer（/tags/0/name）→ 点号路径（tags.0.name），与 React Hook Form 字段名对齐 */
function pointerToPath(pointer: string): string[] {
  if (!pointer) return [];
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** Ajv 的英文 message 面向开发者；这里给出面向用户的中文兜底文案 */
function humanMessage(v: FastifySchemaValidationError): string {
  const p = v.params as Record<string, unknown>;
  switch (v.keyword) {
    case "required":
      return "必填";
    case "minLength":
      return `至少 ${p.limit} 个字符`;
    case "maxLength":
      return `最多 ${p.limit} 个字符`;
    case "minimum":
      return `不能小于 ${p.limit}`;
    case "maximum":
      return `不能大于 ${p.limit}`;
    case "format":
      return `格式不正确（应为 ${p.format}）`;
    case "enum":
      return "取值不在允许范围内";
    case "type":
      return `类型不正确（应为 ${p.type}）`;
    case "additionalProperties":
      return "不允许提交该字段";
    case "pattern":
      return "格式不正确";
    default:
      return v.message ?? "不合法";
  }
}

export function toFieldErrors(error: FastifyError): FieldError[] {
  const where = LOCATION[error.validationContext ?? "body"] ?? "body";
  return (error.validation ?? []).map((v) => {
    const segments = pointerToPath(v.instancePath);
    const p = v.params as Record<string, unknown>;
    // required / additionalProperties 的 instancePath 指向父对象，字段名在 params 里
    if (v.keyword === "required" && typeof p.missingProperty === "string") {
      segments.push(p.missingProperty);
    }
    if (
      v.keyword === "additionalProperties" &&
      typeof p.additionalProperty === "string"
    ) {
      segments.push(p.additionalProperty);
    }
    return {
      in: where,
      path: segments.join("."),
      rule: v.keyword,
      message: humanMessage(v),
    };
  });
}

function envelope(
  requestId: string,
  code: ErrorResponse["error"]["code"],
  message: string,
  fields?: FieldError[],
): ErrorResponse {
  return { error: { code, message, requestId, ...(fields ? { fields } : {}) } };
}

/**
 * 统一错误出口：任何错误都变成同一种 envelope。
 * 响应里只放「用户能理解、调用方能处理」的信息；排查细节只进日志。
 */
export const errorHandlerPlugin = fp(async function errorHandler(
  app: FastifyInstance,
) {
  app.setErrorHandler<FastifyError | AppError>((error, request, reply) => {
    const requestId = request.id;

    // ① 契约校验失败（Fastify + Ajv 按 route schema 自动校验）
    if ("validation" in error && error.validation) {
      const fields = toFieldErrors(error);
      request.log.info({ fields }, "request validation failed");
      return reply
        .code(400)
        .send(
          envelope(
            requestId,
            "VALIDATION_FAILED",
            "提交的数据有误，请检查标出的字段",
            fields,
          ),
        );
    }

    // ② 业务层主动抛出的可预期错误
    if (error instanceof AppError) {
      const level = error.statusCode >= 500 ? "error" : "info";
      request.log[level](
        { code: error.code, ...error.options.logContext },
        error.message,
      );
      if (error.options.headers) reply.headers(error.options.headers);
      return reply
        .code(error.statusCode)
        .send(
          envelope(requestId, error.code, error.message, error.options.fields),
        );
    }

    // ③ Fastify 自身的 4xx：JSON 语法错误、媒体类型不支持、请求体过大……
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      request.log.info({ err: error }, "client error");
      const code = status === 429 ? "RATE_LIMITED" : "BAD_REQUEST";
      const message =
        status === 429 ? "请求太频繁，请稍后再试" : "请求格式不正确";
      return reply.code(status).send(envelope(requestId, code, message));
    }

    // ④ 其余都是 bug 或基础设施故障：完整错误进日志，响应只给 requestId
    request.log.error({ err: error }, "unhandled error");
    return reply
      .code(500)
      .send(envelope(requestId, "INTERNAL", "服务器开小差了，请稍后重试"));
  });

  app.setNotFoundHandler((request, reply) => {
    return reply
      .code(404)
      .send(envelope(request.id, "NOT_FOUND", "接口不存在"));
  });
});
