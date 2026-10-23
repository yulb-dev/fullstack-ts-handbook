import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * 仅服务于 vite dev / vite build 的配置。
 * 测试使用 vitest.config.ts（Vitest 优先读取它，不会合并这份文件），
 * 两份配置都定义 @ 别名，保证 dev 与测试解析一致。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      // 前端 fetch("/api/...") 转发到本地 Fastify（npm run api）
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
