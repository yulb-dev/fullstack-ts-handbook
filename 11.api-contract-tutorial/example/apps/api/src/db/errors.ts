import { DrizzleQueryError } from "drizzle-orm";

type PgErrorLike = { code?: string; constraint?: string };

/** Drizzle 把驱动错误包在 DrizzleQueryError.cause 里，这里统一取出原始错误 */
function unwrap(err: unknown): PgErrorLike | undefined {
  const inner = err instanceof DrizzleQueryError ? err.cause : err;
  if (typeof inner === "object" && inner !== null && "code" in inner) {
    return inner as PgErrorLike;
  }
  return undefined;
}

/** 只认「指定约束」的唯一冲突，别把所有 23505 都翻译成同一句话 */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = unwrap(err);
  return e?.code === "23505" && e.constraint === constraint;
}
