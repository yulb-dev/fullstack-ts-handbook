import { useState } from "react";
import type { Theme } from "../lib/useTheme";
import { cn } from "../lib/cn";
import { ThemeToggle } from "./ThemeToggle";

/**
 * AppHeader —— 顶栏（第 10 章 10.2）
 * 两层骨架：外层全宽 border-b 底色，内层 max-w 居中容器
 * 桌面导航 hidden md:flex，移动端汉堡按钮 md:hidden + 条件渲染菜单
 */
export function AppHeader({
  theme,
  onThemeChange,
}: {
  theme: Theme;
  onThemeChange: (next: Theme) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-b border-app-border bg-app-surface">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <span className="text-lg font-bold tracking-tight text-app-text">
          📋 TaskBoard
        </span>

        {/* 桌面导航：md 以上显示 */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="主导航">
          <a
            href="#"
            className="rounded-lg bg-app-surface-raised px-3 py-2 text-sm font-medium text-app-text"
          >
            看板
          </a>
          <a
            href="#"
            className="rounded-lg px-3 py-2 text-sm font-medium text-app-text-muted hover:bg-app-surface-raised hover:text-app-text"
          >
            日程
          </a>
          <a
            href="#"
            className="rounded-lg px-3 py-2 text-sm font-medium text-app-text-muted hover:bg-app-surface-raised hover:text-app-text"
          >
            报表
          </a>
        </nav>

        <div className="flex items-center gap-2">
          {/* 主题切换按钮（第 7 章 7.6） */}
          <ThemeToggle theme={theme} onChange={onThemeChange} />

          {/* 汉堡按钮：只在 md 以下显示，带完整可访问性属性 */}
          <button
            type="button"
            className="cursor-pointer rounded-lg p-2 text-app-text-muted hover:bg-app-surface-raised
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent md:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg
              className="size-5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              {menuOpen ? (
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              ) : (
                <path d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75ZM2 10.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* 移动菜单：条件渲染，互斥类都在完整字符串里（第 9 章原则） */}
      <nav
        id="mobile-menu"
        className={cn(
          "border-t border-app-border md:hidden",
          !menuOpen && "hidden",
        )}
        aria-label="移动端导航"
      >
        <div className="space-y-1 px-4 py-3">
          <a
            href="#"
            className="block rounded-lg bg-app-surface-raised px-3 py-2 text-base font-medium text-app-text"
          >
            看板
          </a>
          <a
            href="#"
            className="block rounded-lg px-3 py-2 text-base font-medium text-app-text-muted hover:bg-app-surface-raised"
          >
            日程
          </a>
          <a
            href="#"
            className="block rounded-lg px-3 py-2 text-base font-medium text-app-text-muted hover:bg-app-surface-raised"
          >
            报表
          </a>
        </div>
      </nav>
    </header>
  );
}
