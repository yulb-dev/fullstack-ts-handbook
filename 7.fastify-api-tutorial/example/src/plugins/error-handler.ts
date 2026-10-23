import type { FastifyError, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import {
  AppError,
  ErrorCatalog,
  type ErrorCode,
  type ErrorDetail,
} from "../errors/app-error.js";
import type { ErrorResponse } from "../schemas/common.js";

interface NormalizedError {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
  headers?: Record<string, string>;
}

/** Fastify 自身产生的、可以安全映射成稳定错误码的错误 */
const FRAMEWORK_ERRORS: Record<string, ErrorCode> = {
  FST_ERR_CTP_INVALID_JSON_BODY: "INVALID_JSON",
  FST_ERR_CTP_EMPTY_JSON_BODY: "INVALID_JSON",
  FST_ERR_CTP_BODY_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  FST_ERR_CTP_INVALID_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
};

function fromCatalog(code: ErrorCode): NormalizedError {
  return { code, ...ErrorCatalog[code] };
}

/** 把 Ajv 的错误对象转换成对外的 details；不暴露 schemaPath 等内部结构 */
function toValidationDetails(error: FastifyError): ErrorDetail[] {
  const location = error.validationContext ?? "request";
  return (error.validation ?? []).map((issue) => {
    const missing =
      issue.keyword === "required"
        ? (issue.params as { missingProperty?: string }).missingProperty
        : undefined;
    return {
      location,
      field: missing ? `${issue.instancePath}/${missing}` : issue.instancePath,
      rule: issue.keyword,
      message: issue.message ?? "invalid value",
    };
  });
}

/**
 * 错误归一化：任何错误进来，都变成 { statusCode, code, message, details? }。
 * 关键原则：只有“我们明确认识的错误”才把信息返回给客户端，其余一律当作 500 并隐藏细节。
 */
export function normalizeError(error: FastifyError | Error): NormalizedError {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      ...(error.headers ? { headers: error.headers } : {}),
    };
  }

  const fastifyError = error as FastifyError;
  if (fastifyError.validation) {
    return {
      ...fromCatalog("VALIDATION_FAILED"),
      details: toValidationDetails(fastifyError),
    };
  }

  if (fastifyError.statusCode === 429) return fromCatalog("RATE_LIMITED");

  const mapped = fastifyError.code
    ? FRAMEWORK_ERRORS[fastifyError.code]
    : undefined;
  if (mapped) return fromCatalog(mapped);

  const status = fastifyError.statusCode;
  if (status !== undefined && status >= 400 && status < 500) {
    // 其他框架层 4xx：保留状态码，但不透传 message，避免泄露实现细节
    return { ...fromCatalog("BAD_REQUEST"), statusCode: status };
  }

  return fromCatalog("INTERNAL_ERROR");
}

export function buildErrorResponse(
  normalized: NormalizedError,
  request: FastifyRequest,
): ErrorResponse {
  return {
    statusCode: normalized.statusCode,
    code: normalized.code,
    message: normalized.message,
    requestId: request.id,
    ...(normalized.details ? { details: normalized.details } : {}),
  };
}

/**
 * 全局错误处理插件。必须用 fastify-plugin 包装，
 * 否则 setErrorHandler 只对这个插件自己的（空）作用域生效。
 */
export default fp(
  async function errorHandlerPlugin(app) {
    app.setErrorHandler(function (error: FastifyError, request, reply) {
      const normalized = normalizeError(error);

      if (normalized.statusCode >= 500) {
        // 完整错误（含 stack、cause）只进日志
        request.log.error({ err: error }, "unhandled error");
      } else {
        // 4xx 是调用方的问题，用 info 记录错误码即可，避免告警噪音
        request.log.info(
          { code: normalized.code, statusCode: normalized.statusCode },
          "request rejected",
        );
      }

      if (normalized.headers) reply.headers(normalized.headers);
      return reply
        .code(normalized.statusCode)
        .send(buildErrorResponse(normalized, request));
    });

    // 没有匹配到任何路由时，也返回同样结构的错误
    app.setNotFoundHandler(function () {
      throw new AppError("ROUTE_NOT_FOUND");
    });
  },
  { name: "error-handler", fastify: "5.x" },
);
