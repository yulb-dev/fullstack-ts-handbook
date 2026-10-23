import { defineRelations } from "drizzle-orm";
import * as schema from "@/db/schema.js";

/**
 * drizzle-orm 1.0 RC 使用 defineRelations（RQB v2）组织关系配置。
 * TaskDesk Lite 只有一张表、没有外键关系，所以这里是空配置；
 * db 实例仍然要传它，Db 类型也以它为参数（见 client.ts）。
 */
export const relations = defineRelations(schema, () => ({}));
