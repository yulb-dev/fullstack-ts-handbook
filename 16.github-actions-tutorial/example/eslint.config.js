import tseslint from "typescript-eslint";

// ESLint 9+ 扁平配置（flat config）。typescript-eslint 把 TS 解析与推荐规则打包好。
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // 教学示例保持克制：只保留高信号规则
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
);
