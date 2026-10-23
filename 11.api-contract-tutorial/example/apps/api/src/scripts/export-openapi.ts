/**
 * 把 route schema 生成的 OpenAPI 文档写到磁盘（不连数据库、不监听端口）。
 * 用法：tsx src/scripts/export-openapi.ts <输出路径>
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { buildApp } from "../app";
import { loadConfig } from "../config";

const out = process.argv[2];
if (!out) throw new Error("用法：export-openapi.ts <输出路径>");

// 导出契约只需要「注册路由」，handler 不会执行；给一个内存库占位即可
const client = new PGlite();
const app = await buildApp({
  db: drizzle({ client }),
  // 契约不应随环境变化：固定使用一份与环境无关的配置
  config: { ...loadConfig({}), exposeDocs: false },
  logger: false,
});
await app.ready();

// 固定 2 空格缩进 + 末尾换行，保证同一份契约每次输出字节完全一致
const json = `${JSON.stringify(app.swagger(), null, 2)}\n`;
await writeFile(resolve(out), json);
await app.close();
await client.close();
console.log(`OpenAPI written to ${resolve(out)}`);
