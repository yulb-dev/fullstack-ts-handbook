import { sentryVitePlugin } from "@sentry/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// source maps 上传策略（第 5 章）：
// - build.sourcemap: true 生成 map；
// - 仅当配置了 SENTRY_AUTH_TOKEN（CI/发布环境）才上传到 Sentry，
//   上传后删除公开产物里的 .map（避免源码泄漏给终端用户）。
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default defineConfig({
  plugins: [
    react(),
    ...(uploadSourceMaps
      ? sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
          release: { name: process.env.APP_VERSION },
          sourcemaps: {
            assets: "./dist/**",
            filesToDeleteAfterUpload: "./dist/**/*.map",
          },
        })
      : []),
  ],
  build: { sourcemap: true },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
});
