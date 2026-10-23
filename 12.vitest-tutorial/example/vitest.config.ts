import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * 三个测试项目共用一份根配置（Vitest 5 中 inline project 默认 extends: true）：
 * react 插件与 @ 别名在这里定义一次，unit / component / integration 都能继承。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        // 纯逻辑单元测试：跑在 Node 环境，不需要 DOM，速度最快
        test: {
          name: "unit",
          root: fileURLToPath(new URL(".", import.meta.url)),
          include: ["test/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // React 组件测试：jsdom 环境 + Testing Library setup 文件
        test: {
          name: "component",
          root: fileURLToPath(new URL(".", import.meta.url)),
          include: ["test/component/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./test/setup-component.ts"],
        },
      },
      {
        // API 与数据库集成测试：真实 Fastify app.inject + PGlite
        test: {
          name: "integration",
          root: fileURLToPath(new URL(".", import.meta.url)),
          include: ["test/integration/**/*.test.ts"],
          environment: "node",
          // PGlite 首次初始化较慢
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // 入口文件只做「组装」，没有值得单测的分支，排除在覆盖率之外
      exclude: ["src/api/server.ts", "src/ui/main.tsx"],
      reporter: ["text", "html"],
    },
  },
});
