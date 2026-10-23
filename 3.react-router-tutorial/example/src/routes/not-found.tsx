import { Link } from "react-router";

// URL 未匹配到任何路由时的兜底页（第 2、6 章）
export default function NotFound() {
  return (
    <main>
      <h1>404 · 页面走丢了</h1>
      <p>你访问的地址不存在。</p>
      <p>
        <Link to="/">回到首页</Link>
      </p>
    </main>
  );
}
