import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 开发期同源代理：浏览器只和 5173 打交道，没有跨源，也就没有 CORS 与预检（第 8 章）
      // changeOrigin 保持默认 false：Host 仍是 localhost:5173，服务端的同源 Origin 校验能通过
      // 目标写 127.0.0.1 而不是 localhost：避免 Node 把 localhost 解析成 IPv6 的 ::1 而连不上
      "/api": { target: "http://127.0.0.1:3000" },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
