import { z } from "zod";

export const MAX_PAGE_SIZE = 100;

/**
 * 分页解析是典型的「边界值密集区」：
 * - 缺省 → 第 1 页、默认 20 条
 * - 字符串数字（查询串里全是字符串）→ 正常解析
 * - 越界 / 非整数 / 负数 / 非数字 → 抛 ZodError，由上层映射成 400
 */
export function parsePagination(
  input: { page?: unknown; pageSize?: unknown } = {},
) {
  const schema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  });
  const parsed = schema.parse(input);
  return {
    page: parsed.page,
    pageSize: parsed.pageSize,
    offset: (parsed.page - 1) * parsed.pageSize,
    limit: parsed.pageSize,
  };
}
