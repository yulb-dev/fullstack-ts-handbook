import type { Theme } from "../lib/useTheme";
import { cn } from "../lib/cn";

/** 三态循环顺序：浅色 → 深色 → 跟随系统 → 浅色… */
const NEXT_THEME: Record<Theme, Theme> = {
  light: "dark",
  dark: "system",
  system: "light",
};

const THEME_LABELS: Record<Theme, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

/**
 * ThemeToggle —— 三态主题切换按钮（第 7 章 7.6）
 * 图标用条件渲染而非冲突类；aria-label 随当前态同步，屏幕阅读器可感知
 */
export function ThemeToggle({
  theme,
  onChange,
  className,
}: {
  theme: Theme;
  onChange: (next: Theme) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "cursor-pointer rounded-lg p-2 text-app-text-muted",
        "hover:bg-app-surface-raised hover:text-app-text",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent",
        className,
      )}
      aria-label={`切换主题（当前：${THEME_LABELS[theme]}）`}
      title={THEME_LABELS[theme]}
      onClick={() => onChange(NEXT_THEME[theme])}
    >
      {theme === "light" && (
        // 太阳
        <svg
          className="size-5"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2ZM10 15a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 15ZM2 10a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 2 10ZM15 10a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 15 10ZM4.34 4.34a.75.75 0 0 1 1.06 0l1.06 1.06a.75.75 0 0 1-1.06 1.06L4.34 5.4a.75.75 0 0 1 0-1.06ZM13.6 13.6a.75.75 0 0 1 1.06 0l1.06 1.06a.75.75 0 1 1-1.06 1.06l-1.06-1.06a.75.75 0 0 1 0-1.06ZM15.66 4.34a.75.75 0 0 1 0 1.06l-1.06 1.06a.75.75 0 1 1-1.06-1.06l1.06-1.06a.75.75 0 0 1 1.06 0ZM6.4 13.6a.75.75 0 0 1 0 1.06l-1.06 1.06a.75.75 0 0 1-1.06-1.06l1.06-1.06a.75.75 0 0 1 1.06 0ZM10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
        </svg>
      )}
      {theme === "dark" && (
        // 月亮
        <svg
          className="size-5"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M17.293 13.293A8 8 0 0 1 6.707 2.707a8.001 8.001 0 1 0 10.586 10.586Z" />
        </svg>
      )}
      {theme === "system" && (
        // 显示器（跟随系统）
        <svg
          className="size-5"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M3 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-3.06l.4.9c.14.32-.02.7-.33.9a.76.76 0 0 1-.4.11H8.39a.76.76 0 0 1-.4-.11.74.74 0 0 1-.33-.9l.4-.9H4a1 1 0 0 1-1-1V4Zm1.5.5v7h11v-7h-11ZM6 17a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 6 17Z" />
        </svg>
      )}
    </button>
  );
}
