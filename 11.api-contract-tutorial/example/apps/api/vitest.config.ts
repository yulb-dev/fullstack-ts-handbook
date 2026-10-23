import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // PGlite 首次初始化较慢
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
