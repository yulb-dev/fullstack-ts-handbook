import { writeFile } from "node:fs/promises";
import { buildApp } from "../app.js";

/**
 * 把当前代码生成的 OpenAPI 文档写到 openapi.json。
 * 在 CI 里和上一个发布版本的文件做 diff，就能在合并前发现破坏性变更。
 */
const app = await buildApp();
await app.ready();
const document = app.swagger();
await writeFile("openapi.json", JSON.stringify(document, null, 2) + "\n");
await app.close();
console.log(
  `openapi.json written: ${Object.keys(document.paths ?? {}).length} paths`,
);
