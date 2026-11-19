import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 开发期：Vite dev server 把 /api 代理到本地 API（解决跨域）。
// 生产期：这个代理不存在——由 nginx 承担同样的职责（docker/nginx.conf）。
// 这就是为什么「Vite dev server 不能当生产服务器」：它的代理、HMR 都是开发设施。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
