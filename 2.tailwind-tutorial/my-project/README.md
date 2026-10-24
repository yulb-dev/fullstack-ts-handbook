# TaskBoard —— Tailwind 教程综合实战（第 10 章 10.2）

把第 5~9 章的成果组装成的完整看板应用：响应式（1→2→3 列）+ 三态深色模式（浅色/深色/跟随系统，防 FOUC）+ 组件化（variant API / `cn()`）+ 移动端汉堡菜单。技术栈：React 19 + TypeScript + Vite + Tailwind CSS v4（CSS-first 配置）。

## 运行

```bash
pnpm install
pnpm run dev      # 开发
pnpm run build    # 生产构建（tsc -b && vite build）
pnpm run lint     # ESLint
```

## 目录结构与章节对应

```
my-project/
├── index.html               # head 内联防闪屏脚本（第 7 章 7.3）
├── src/
│   ├── main.tsx             # 入口，import './index.css'
│   ├── index.css            # @import "tailwindcss" + theme.css + base 层
│   ├── theme.css            # 全部设计 token（第 8 章 8.9），色值只允许出现在这里
│   ├── types.ts             # Task / Assignee / tone / priority 领域模型
│   ├── lib/
│   │   ├── cn.ts            # shadcn-ui/cn（clsx+tailwind-merge 的 drop-in 替代，第 9 章 9.1）
│   │   └── useTheme.ts      # 三态主题 hook（第 7 章 7.3）
│   ├── data/
│   │   └── tasks.ts         # 看板示例数据
│   ├── components/
│   │   ├── AppHeader.tsx    # 两层骨架 + 移动端菜单 + 主题切换（第 10 章 10.2）
│   │   ├── ThemeToggle.tsx  # 三态切换按钮（第 7 章 7.6）
│   │   ├── TaskCard.tsx     # 第 9 章 9.5 成品组件
│   │   ├── StatsTable.tsx   # overflow-x-auto 响应式表格（第 5 章 5.7）
│   │   └── Button.tsx       # variant API 示范（第 9 章 9.1/9.2）
│   └── pages/
│       └── BoardPage.tsx    # 只做布局：grid gap-4 md:grid-cols-2 lg:grid-cols-3
└── vite.config.ts           # @tailwindcss/vite 插件
```

## 验收要点（对照第 10 章 10.2）

- 断点：375px 单列 + 汉堡菜单；768px 两列 + 桌面导航；1024px 三列；统计表 `overflow-x-auto` 可横滑；
- 主题：三态循环切换，刷新无闪屏，`<html>` 的 `dark` 类随态变化；
- 可访问性：汉堡按钮 `aria-expanded`/`aria-controls` 同步、卡片标题为真 `<button>`、时间为 `<time dateTime>`、焦点环可见、`motion-reduce` 尊重系统设置；
- 色值审计：`theme.css` 之外无硬编码 `#hex` / `rgb()`（状态徽标仅用 Tailwind 色板类 + `/透明度`）；
- 无动态拼接类名：tone/priority 均为完整类名映射；
- 生产构建 CSS 产物约 21 KB（gzip 约 5 KB）。
