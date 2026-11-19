import pg from "pg";

// 只暴露最小查询能力，方便测试用 stub 替换（依赖注入边界）。
export type Queryable = Pick<pg.Pool, "query">;

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
  });
}
