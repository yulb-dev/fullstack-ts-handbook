/**
 * 依赖边界检查（第 2 章）：apps/web 只能通过 @taskflow/api-client 了解后端。
 * - package.json 不允许依赖 @taskflow/api；
 * - 源码不允许 import 服务端包，也不允许用相对路径「翻墙」进 apps/api。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const webDir = resolve(root, "apps/web");
const apiDir = resolve(root, "apps/api");
const problems = [];

const pkg = JSON.parse(readFileSync(join(webDir, "package.json"), "utf8"));
for (const field of ["dependencies", "devDependencies"]) {
  if (pkg[field]?.["@taskflow/api"]) {
    problems.push(`apps/web/package.json 的 ${field} 依赖了 @taskflow/api`);
  }
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|jsx|mts)$/.test(name)) yield full;
  }
}

const IMPORT = /(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
for (const file of walk(join(webDir, "src"))) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(IMPORT)) {
    const spec = match[1] ?? match[2];
    const forbiddenPackage = spec === "@taskflow/api" || spec.startsWith("@taskflow/api/");
    const escapesIntoApi =
      spec.startsWith(".") && resolve(dirname(file), spec).startsWith(apiDir);
    if (forbiddenPackage || escapesIntoApi) {
      problems.push(`${relative(root, file)} 引用了服务端代码：${spec}`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  console.error("\napps/web 只能依赖 @taskflow/api-client（生成的契约），不能直接依赖服务端实现。");
  process.exit(1);
}
console.log("✓ apps/web 没有直接依赖服务端实现");
