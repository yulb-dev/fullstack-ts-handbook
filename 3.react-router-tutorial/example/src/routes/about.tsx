import { Link } from "react-router";

// 纯静态页面：不需要 loader
export default function About() {
  return (
    <main>
      <h1>关于</h1>
      <p>
        这是《React Router 从 0 到 1 新手教程》的配套示例，演示 Data Mode 下的
        路由嵌套、loader/action、pending UI、错误边界、URL 状态、懒加载与测试。
      </p>
      <p>
        <Link to="/">返回首页</Link>
      </p>
    </main>
  );
}
