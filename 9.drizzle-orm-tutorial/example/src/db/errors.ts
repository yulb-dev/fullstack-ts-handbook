import { DrizzleQueryError } from "drizzle-orm";

// Postgres 错误码（SQLSTATE），完整列表见 https://www.postgresql.org/docs/current/errcodes-appendix.html
export const PG_ERROR = {
  UNIQUE_VIOLATION: "23505",
  FOREIGN_KEY_VIOLATION: "23503",
  NOT_NULL_VIOLATION: "23502",
  CHECK_VIOLATION: "23514",
  SERIALIZATION_FAILURE: "40001",
  DEADLOCK_DETECTED: "40P01",
} as const;

type PgErrorLike = { code?: string; constraint?: string; detail?: string };

/** Drizzle 把驱动抛出的错误包在 DrizzleQueryError.cause 里，这里统一取出原始错误 */
function unwrap(err: unknown): PgErrorLike | undefined {
  const inner = err instanceof DrizzleQueryError ? err.cause : err;
  if (typeof inner === "object" && inner !== null && "code" in inner) {
    return inner as PgErrorLike;
  }
  return undefined;
}

export function pgErrorCode(err: unknown): string | undefined {
  return unwrap(err)?.code;
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = unwrap(err);
  if (e?.code !== PG_ERROR.UNIQUE_VIOLATION) return false;
  return constraint === undefined || e.constraint === constraint;
}

export function violatedConstraint(err: unknown): string | undefined {
  return unwrap(err)?.constraint;
}
