import { useEffect, useState } from "react";

/** 三态主题：浅色 / 深色 / 跟随系统（第 7 章 7.3） */
export type Theme = "light" | "dark" | "system";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** 把 theme 状态落到 localStorage + <html> 的 class 上 */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    // "跟随系统" = 移除用户偏好，回到 matchMedia 决策
    localStorage.removeItem("theme");
    root.classList.toggle("dark", getSystemTheme() === "dark");
  } else {
    localStorage.theme = theme;
    root.classList.toggle("dark", theme === "dark");
  }
}

export function useTheme() {
  // 惰性初始化：与 index.html 防 FOUC 脚本读的是同一个 key
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.theme as Theme | undefined) ?? "system",
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // 系统主题变化时（仅当处于 system 模式）跟随
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (!("theme" in localStorage)) {
        document.documentElement.classList.toggle("dark", mq.matches);
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return { theme, setTheme };
}
