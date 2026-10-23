/**
 * 契约漂移检查（第 4 章）：
 * 1. 从当前服务端代码重新导出 OpenAPI 到临时目录；
 * 2. 用临时 OpenAPI 重新生成客户端类型；
 * 3. 与仓库里提交的 openapi.json / generated/openapi.ts 逐字节比较。
 * 任何不一致都说明「有人改了接口却没重新生成」，CI 直接失败。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tmp = resolve(root, ".contract-tmp");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const run = (args) => execFileSync("pnpm", args, { cwd: root, stdio: "inherit" });

run(["--filter", "@taskflow/api", "exec", "tsx", "src/scripts/export-openapi.ts", `${tmp}/openapi.json`]);
run([
  "--filter", "@taskflow/api-client", "exec",
  "openapi-typescript", `${tmp}/openapi.json`, "--output", `${tmp}/openapi.ts`,
]);

const pairs = [
  ["packages/api-client/openapi.json", `${tmp}/openapi.json`],
  ["packages/api-client/src/generated/openapi.ts", `${tmp}/openapi.ts`],
];

let stale = false;
for (const [committed, fresh] of pairs) {
  let before = "";
  try {
    before = readFileSync(resolve(root, committed), "utf8");
  } catch {
    // 文件不存在也算过期
  }
  if (before !== readFileSync(fresh, "utf8")) {
    console.error(`✗ ${committed} 已过期`);
    stale = true;
  } else {
    console.log(`✓ ${committed} 与服务端代码一致`);
  }
}
rmSync(tmp, { recursive: true, force: true });

if (stale) {
  console.error("\n契约产物与代码不一致：请运行 pnpm contract:generate 并提交生成结果。");
  process.exit(1);
}
