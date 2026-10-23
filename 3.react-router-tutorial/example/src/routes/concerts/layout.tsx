import { Outlet, NavLink, useLoaderData } from "react-router";
import { CITIES } from "../../api";

// 区块布局的 loader：为侧边栏准备城市列表（会与子路由 loader 并行执行，第 5 章）
export async function loader() {
  return { cities: CITIES as readonly string[] };
}

// 区块布局：左侧城市导航 + <Outlet/>（第 2 章）
export default function ConcertsLayout() {
  const { cities } = useLoaderData() as { cities: readonly string[] };
  return (
    <div className="concerts-layout">
      <aside>
        <h2>城市</h2>
        <ul>
          {cities.map((city) => (
            <li key={city}>
              <NavLink to={`/concerts/${city}`}>{city}</NavLink>
            </li>
          ))}
        </ul>
        <p>
          <NavLink to="/concerts/new">＋ 新建演唱会</NavLink>
        </p>
      </aside>

      {/* 匹配到的 concerts 子路由渲染在这里 */}
      <div style={{ flex: 1 }}>
        <Outlet />
      </div>
    </div>
  );
}
