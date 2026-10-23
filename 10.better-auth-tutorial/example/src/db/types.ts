import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema.js";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
