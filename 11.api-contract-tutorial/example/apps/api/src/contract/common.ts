import Type, { type Static, type TSchema, type TSchemaOptions } from "typebox";

/**
 * 把一个带 $id 的共享 schema 变成 `{ $ref: "<id>" }`，同时保留它的 TS 类型。
 * - 运行时：Fastify 用 addSchema 注册过的同名 schema 解析 $ref；
 * - OpenAPI：@fastify/swagger 把它输出为 `#/components/schemas/<id>`；
 * - 编译期：Type.Unsafe 让 handler 依然拿到精确的 Static 类型。
 */
export function ref<T extends TSchema>(schema: T, options?: TSchemaOptions) {
  const id = (schema as { $id?: unknown }).$id;
  if (typeof id !== "string") {
    throw new Error("ref() 只能用于带 $id 的共享 schema");
  }
  return Type.Unsafe<Static<T>>(Type.Ref(id, options));
}

// ───────────── 标量约定（第 12 章） ─────────────

/** 资源 ID：对外一律 UUID 字符串，不暴露自增序号 */
export const Id = Type.String({ format: "uuid" });

/** 时间点：UTC ISO 8601，例如 2026-10-22T08:30:00.000Z */
export const DateTime = Type.String({
  format: "date-time",
  description: "UTC 时间点，ISO 8601 格式，带 Z 后缀",
  examples: ["2026-10-22T08:30:00.000Z"],
});

/** 日历日期：没有时区，例如截止日 2026-10-30 */
export const CalendarDate = Type.String({
  format: "date",
  description: "日历日期 YYYY-MM-DD，不含时区",
  examples: ["2026-10-30"],
});

// ───────────── 统一错误 envelope（第 6 章） ─────────────

export const ErrorCode = Type.Enum(
  [
    "VALIDATION_FAILED",
    "BAD_REQUEST",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "CSRF_REJECTED",
    "NOT_FOUND",
    "CONFLICT",
    "IDEMPOTENCY_KEY_REUSED",
    "PRECONDITION_FAILED",
    "PRECONDITION_REQUIRED",
    "RATE_LIMITED",
    "INTERNAL",
  ],
  {
    $id: "ErrorCode",
    description: "机器可读错误码。客户端遇到未知值时必须按 message 兜底展示",
  },
);
export type ErrorCode = Static<typeof ErrorCode>;

export const FieldError = Type.Object(
  {
    in: Type.Enum(["body", "query", "params", "headers"]),
    path: Type.String({
      description:
        "点号路径，例如 title、tags.0；与 React Hook Form 的字段名一致",
    }),
    rule: Type.String({
      description: "失败的规则，例如 minLength、required、format、unique",
    }),
    message: Type.String(),
  },
  { $id: "FieldError", additionalProperties: false },
);
export type FieldError = Static<typeof FieldError>;

export const ErrorResponse = Type.Object(
  {
    error: Type.Object(
      {
        code: ref(ErrorCode),
        message: Type.String({
          description: "可直接展示给用户的说明，不含内部细节",
        }),
        requestId: Type.String({
          description: "与响应头 X-Request-Id 相同，用于排查",
        }),
        fields: Type.Optional(Type.Array(ref(FieldError))),
      },
      { additionalProperties: false },
    ),
  },
  { $id: "ErrorResponse", additionalProperties: false },
);
export type ErrorResponse = Static<typeof ErrorResponse>;

/** 为一组状态码批量声明「返回统一错误 envelope」 */
export function errorResponses<const Codes extends readonly number[]>(
  ...codes: Codes
) {
  const descriptions: Record<number, string> = {
    400: "请求格式或字段校验失败",
    401: "未登录或会话已过期",
    403: "已登录但无权执行该操作",
    404: "资源不存在或对当前用户不可见",
    409: "与现有数据冲突",
    412: "If-Match 版本不匹配，资源已被修改",
    422: "幂等键被用于不同的请求内容",
    428: "缺少必需的前置条件请求头",
    429: "请求过于频繁",
    500: "服务器内部错误",
  };
  const errorRef = (code: number) =>
    ref(ErrorResponse, { description: descriptions[code] ?? "错误" });
  return Object.fromEntries(codes.map((code) => [code, errorRef(code)])) as {
    [K in Codes[number]]: ReturnType<typeof errorRef>;
  };
}

// ───────────── 分页 envelope（第 12 章） ─────────────

/** 游标分页：items + nextCursor；nextCursor 为 null 表示没有下一页 */
export function CursorPage<T extends TSchema>(item: T, id: string) {
  return Type.Object(
    {
      items: Type.Array(item),
      nextCursor: Type.Union([Type.String(), Type.Null()], {
        description: "不透明游标。原样传回 ?cursor=，不要解析或拼接",
      }),
    },
    { $id: id, additionalProperties: false },
  );
}

export const PageLimit = Type.Integer({
  minimum: 1,
  maximum: 100,
  default: 20,
  description: "每页条数，默认 20，最大 100",
});
