/**
 * component 项目专用 setup 文件（vitest.config.ts 中 setupFiles 指向这里）：
 * 1. 注册 jest-dom 匹配器（toBeInTheDocument、toBeDisabled 等）
 * 2. 每个测试结束后自动卸载 React 树并清空 DOM —— Testing Library 的 cleanup
 *    （globals: true 时 RTL 会自动注册 cleanup；我们没开 globals，所以显式调用）
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
