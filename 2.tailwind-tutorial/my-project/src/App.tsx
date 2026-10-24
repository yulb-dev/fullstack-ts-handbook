import { AppHeader } from "./components/AppHeader";
import { BoardPage } from "./pages/BoardPage";
import { useTheme } from "./lib/useTheme";
import { TASKS } from "./data/tasks";

/**
 * App —— 应用外壳（第 10 章 10.2 综合实战）
 * 主题状态在此提升，AppHeader 消费；BoardPage 只管布局与数据
 */
export default function App() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="min-h-dvh bg-app-bg text-app-text">
      <AppHeader theme={theme} onThemeChange={setTheme} />
      <BoardPage tasks={TASKS} />
    </div>
  );
}
