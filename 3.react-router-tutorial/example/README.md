# Concert Hub · React Router Data Mode 示例

这是《React Router 从 0 到 1 新手教程》的配套可运行示例，覆盖了教程全部核心概念。

## 运行

```bash
npm install
npm run dev        # 开发服务器（默认 http://localhost:5173）
```

其它命令：

```bash
npm run build      # 生产构建（可看到按路由拆分的 chunk，尤其 admin/report）
npm run preview    # 预览构建产物
npm run test       # 单元测试（watch）
npm run test:run   # 单元测试（跑一次）
npm run typecheck  # TypeScript 类型检查
```

> ⚠️ 环境要求：Node ≥ 20，React ≥ 19.2（`react-router@8` 的 peerDependency）。
> 若首次 `npm install` 提示 React 版本冲突，请确保安装的是 React 19.2+。

## 建议的体验路径（对照教程章节）

| 操作 | 观察点 | 章节 |
| --- | --- | --- |
| 首页 → 演唱会 | 顶部进度条、NavLink 高亮 | 5、7 |
| 进入某城市，搜索/排序/翻页 | **URL 变化**；复制 URL 到新标签打开结果一致 | 3、7 |
| 城市之间快速来回点击 | Network 面板里旧请求被 **canceled** | 3 |
| 详情页点「收藏」 | 按钮立刻变化，但 **URL 不变、不进历史** | 5 |
| 新建演唱会：先提交空表单 | 停在页面、字段错误、**输入不丢** | 4 |
| 新建：填对后提交 | 自动 **redirect** 到详情页 | 4 |
| 访问 `/concerts/chicago/999` | 友好的 **404**（loader throw） | 6 |
| 访问 `/some-random-url` | 兜底 **404**（`path:"*"`） | 6 |
| 未登录访问 `/admin/report` | **redirect** 到登录页 | 3、6 |
| 以「普通用户」登录后再访问 `/admin/report` | **403** 无权限页 | 6 |
| 以「管理员」登录后访问 `/admin/report` | 正常显示；首次访问才下载其 **lazy chunk** | 8 |

## 目录结构

```
src/
├─ main.tsx            # 入口：渲染 RouterProvider
├─ router.tsx          # 路由表（系统的「地图」）
├─ api.ts              # mock 数据层（带延迟 + AbortSignal）
├─ auth.ts             # 极简登录态
├─ styles.css
└─ routes/
   ├─ root.tsx         # 全局布局 + 进度条
   ├─ root-error.tsx   # 根错误边界（404/403/500 分发）
   ├─ not-found.tsx    # URL 未匹配兜底
   ├─ home.tsx / about.tsx / login.tsx
   ├─ concerts/{layout,city,detail,new,edit}.tsx
   ├─ concerts/detail.test.tsx  # loader/action/组件 测试示例
   └─ admin/report.tsx # 受保护 + lazy
```

> 数据保存在内存中，刷新页面会重置（这是教学示例的有意简化）。
