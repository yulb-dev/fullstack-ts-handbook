import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/**
 * Button —— variant API 示范（第 9 章 9.1/9.2）
 * 样式定制优先走枚举 props（方案 A），className 仅作受控逃生舱（方案 B，经 cn 合并）
 */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md" | "lg";
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        // 基础样式（v4：cursor 默认不是 pointer，需要显式加）
        "inline-flex cursor-pointer items-center justify-center rounded-lg font-medium transition",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent",
        "disabled:pointer-events-none disabled:opacity-50",
        // 变体：每个值映射完整类名，不做动态拼接（第 9 章 9.4）
        {
          "bg-app-accent text-app-accent-contrast hover:bg-app-accent-hover":
            variant === "primary",
          "border border-app-border bg-app-surface text-app-text hover:bg-app-surface-raised":
            variant === "secondary",
          "text-app-danger hover:bg-app-danger-soft": variant === "danger",
        },
        {
          "px-3 py-1.5 text-sm": size === "sm",
          "px-4 py-2.5 text-sm": size === "md",
          "px-5 py-3 text-base": size === "lg",
        },
        className,
      )}
      {...props}
    />
  );
}
