import {
  Type,
  type Static,
  type TSchema,
  type TString,
  type TUnsafe,
} from "typebox";
import { ErrorCatalog, type ErrorCode } from "../errors/app-error.js";

/**
 * 生成一个指向共享 schema 的 $ref，同时保留 TypeScript 类型。
 *
 * TypeBox 1.x 的 Type.Ref('Task') 在类型层面只能推断为 unknown，
 * 所以这里用 Type.Unsafe 告诉 TypeScript：“这个 $ref 的值就是 Static<T>”。
 * 运行时产物仍然只是 { $ref: 'Task' }，真正的结构由 app.addSchema 注册。
 */
export function ref<T extends TSchema>(schema: T): TUnsafe<Static<T>> {
  const id = (schema as { $id?: unknown }).$id;
  if (typeof id !== "string") {
    throw new Error("只有带 $id 的 schema 才能被引用");
  }
  return Type.Unsafe<Static<T>>(Type.Ref(id));
}

export const Uuid = Type.String({
  format: "uuid",
  description: "UUID 格式的资源 ID",
});

/**
 * 可为 null 的字符串：生成 { type: ['string', 'null'], ... }。
 *
 * 为什么不用 Type.Union([Type.String(), Type.Null()])？
 * Fastify 默认开启了 Ajv 的类型转换（coerceTypes），anyOf 会按顺序尝试每个分支，
 * null 在第一个 string 分支里就被转成了 ""。而 type 数组只有在“所有类型都不匹配”时才转换，
 * null 本身匹配 'null'，就会原样保留。
 */
export function Nullable<T extends TString>(
  schema: T,
): TUnsafe<Static<T> | null> {
  return Type.Unsafe<Static<T> | null>({ ...schema, type: ["string", "null"] });
}

export const IsoDateTime = Type.String({
  format: "date-time",
  description: "ISO 8601 时间，UTC",
});

// ---------- 错误响应 ----------

export const ErrorDetailSchema = Type.Object(
  {
    location: Type.String({
      description: "body / querystring / params / headers",
    }),
    field: Type.String({
      description: "JSON Pointer 风格的字段路径，例如 /title",
    }),
    rule: Type.String({ description: "违反的校验规则，例如 minLength" }),
    message: Type.String(),
  },
  { $id: "ErrorDetail" },
);

export const ErrorResponseSchema = Type.Object(
  {
    statusCode: Type.Integer({
      description: "与 HTTP 状态码相同，方便只拿到 body 的调用方",
    }),
    code: Type.String({
      description: "稳定的机器可读错误码，客户端应据此分支",
      examples: ["TASK_NOT_FOUND"],
    }),
    message: Type.String({
      description: "给人看的说明，不保证稳定，不要用它做判断",
    }),
    requestId: Type.String({
      description: "本次请求的 ID，排查问题时提供给服务端",
    }),
    details: Type.Optional(Type.Array(ref(ErrorDetailSchema))),
  },
  { $id: "ErrorResponse", description: "所有非 2xx 响应的统一结构" },
);

export type ErrorResponse = Static<typeof ErrorResponseSchema>;

const ErrorResponseRef = ref(ErrorResponseSchema);

/**
 * 为路由生成错误响应声明，例如 errorResponses(400, 401, 404)。
 * 每个状态码都用同一个 ErrorResponse 结构，并在文档里列出该状态码对应的错误码。
 * （列出的是整个 API 的错误码目录中该状态码下的所有 code，不一定每个都会在这个路由出现。）
 */
export function errorResponses<const S extends number>(
  ...statusCodes: S[]
): Record<S, typeof ErrorResponseRef> {
  const result = {} as Record<S, typeof ErrorResponseRef>;
  for (const status of statusCodes) {
    const codes = (Object.keys(ErrorCatalog) as ErrorCode[]).filter(
      (code) => ErrorCatalog[code].statusCode === status,
    );
    // description 会成为 OpenAPI 中该响应的说明
    result[status] = Type.Unsafe<ErrorResponse>(
      Type.Ref("ErrorResponse", {
        description: `错误码目录中对应 ${status} 的 code：${codes.join("、") || "见 ErrorResponse"}`,
      }),
    );
  }
  return result;
}

// ---------- 分页与排序 ----------

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * 分页参数对客户端是可选的（文档里不会标成 required），
 * 运行时 Ajv 会用 default 补齐；但 TypeScript 只看到 `page?: number`，
 * 所以业务代码里用同一组常量兜底，保证两边默认值不会漂移。
 */
export const PageQuery = {
  page: Type.Optional(
    Type.Integer({
      minimum: 1,
      default: DEFAULT_PAGE,
      description: "页码，从 1 开始",
    }),
  ),
  pageSize: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_PAGE_SIZE,
      default: DEFAULT_PAGE_SIZE,
      description: `每页条数，最大 ${MAX_PAGE_SIZE}`,
    }),
  ),
};

export const PageMetaSchema = Type.Object(
  {
    page: Type.Integer(),
    pageSize: Type.Integer(),
    total: Type.Integer({ description: "满足筛选条件的总条数" }),
    totalPages: Type.Integer(),
  },
  { $id: "PageMeta" },
);

export type PageMeta = Static<typeof PageMetaSchema>;
