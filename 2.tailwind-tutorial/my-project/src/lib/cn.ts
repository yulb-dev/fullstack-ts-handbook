/**
 * cn —— 全项目统一的类名组合入口（第 9 章 9.1）
 * 底层使用 shadcn-ui/cn：clsx + tailwind-merge 的零依赖 drop-in 替代，
 * 同 API、同输出，条件拼接（clsx 语义）+ 冲突消解（tailwind-merge 语义）一次完成。
 * 组件一律从本文件导入，保证全项目只有一个 cn 实现。
 */
export { cn } from "cn";
