import pg from "pg";

export type Queryable = Pick<pg.Pool, "query">;

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 3_000,
  });
}
