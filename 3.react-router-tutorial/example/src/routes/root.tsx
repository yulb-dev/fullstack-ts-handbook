import { Outlet, NavLink, useNavigation, useFetchers } from "react-router";

// 全局布局：header/nav + 全局 pending 进度条 + <Outlet/>（第 2、5 章）
export default function Root() {
  const navigation = useNavigation();
  const fetchers = useFetchers();

  // 只要「有导航目标」或「有任意 fetcher 在忙」，就显示进度条
  const busy = Boolean(navigation.location) || fetchers.some((f) => f.state !== "idle");

  return (
    <div>
      <div className="progress" data-busy={busy} aria-hidden="true" />

      <header>
        <nav>
          <NavLink to="/" end>
            首页
          </NavLink>
          <NavLink to="/concerts">演唱会</NavLink>
          <NavLink to="/admin/report">后台报表</NavLink>
          <NavLink to="/about">关于</NavLink>
          <NavLink to="/login">登录</NavLink>
        </nav>
      </header>

      {/* 匹配到的子路由渲染在这里 */}
      <Outlet />

      <footer>© 2026 Concert Hub · React Router Data Mode 教学示例</footer>
    </div>
  );
}
