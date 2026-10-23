import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// 用 vitest/config 的 defineConfig，可同时写 Vite 配置与 test 配置。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
});
