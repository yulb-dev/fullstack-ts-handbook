# 第 1 章：全景与环境搭建

> 本章目标：搞清楚四个库各自解决什么问题、怎么协作，然后**从 0 搭好一个能跑的项目**，并成功渲染第一个 shadcn/ui（Base UI）组件。
> 对应路线图能力点：**[1] 设计系统所有权** 的起点。

---

## 1.1 先建立心智模型：四个库的分工

新手最容易犯的错，是把 shadcn/ui、Base UI、React Hook Form、Zod 当成「四个竞争的 UI 库」去选。其实它们是**四层不同职责**，叠在一起用：

```
┌─────────────────────────────────────────────────────────────┐
│  你的业务代码（LaunchPad 表单页）                              │
├─────────────────────────────────────────────────────────────┤
│  shadcn/ui   →  "拥有源码"的成品组件层                        │
│                 Button / Dialog / Input / Select / Field...   │
│                 拷贝进你的项目，你可以随便改                    │
├─────────────────────────────────────────────────────────────┤
│  Base UI     →  无样式、可访问的"行为原语"层                   │
│                 负责焦点管理、键盘交互、ARIA、弹层定位           │
│                 （shadcn/ui 的底层地基；也可单独用）            │
├─────────────────────────────────────────────────────────────┤
│  Tailwind CSS→  样式层：给上面两层"上妆"                       │
└─────────────────────────────────────────────────────────────┘

        ┌──────────────────────┐   ┌──────────────────────┐
        │  React Hook Form     │   │  Zod                 │
        │  表单"状态机"         │←──│  数据"契约 + 校验规则" │
        │  值/脏/ touched/错误  │   │  schema / parse      │
        └──────────────────────┘   └──────────────────────┘
              （通过 zodResolver 连接）
```

用一句话记住每一层：

| 库                        | 一句话定位                                            | 关键事实                                                                       |
| ------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| **shadcn/ui**             | 不是 npm 依赖，而是**把组件源码拷进你项目**的分发方式 | 你拥有源码，可以改；官方 2026-07 起默认底层用 Base UI                          |
| **Base UI**               | 一组**无样式**的可访问 React 组件原语                 | 包名 `@base-ui/react`；不捆绑任何 CSS；由 Radix/Floating UI/MUI 的作者团队打造 |
| **React Hook Form (RHF)** | 表单**状态管理**库，主打性能与灵活                    | 基于**非受控** + ref，减少重渲染                                               |
| **Zod**                   | TypeScript 优先的**运行时校验 + 类型推导**            | schema 即类型来源，`parse`/`safeParse`，前后端可复用                           |

> **它们怎么连起来？** 你用 shadcn/ui（底层是 Base UI）拿到可访问的组件外壳 → 用 RHF 管这些组件的值和状态 → 用 Zod 定义校验规则 → 通过 `@hookform/resolvers/zod` 的 `zodResolver` 把 Zod 挂到 RHF 上。提交后，同一套 Zod schema 还能在服务端再校验一次，形成闭环。这条链路会在第 8 章完整打通。

### 为什么是 Base UI 而不是 Radix？

- **历史**：shadcn/ui 早期底层是 Radix UI。2025 年 12 月 `npx shadcn create` 上线后，可以二选一；2026 年 1 月补齐了 Base UI 全套文档；**2026 年 7 月起 Base UI 成为新项目默认**。
- **关系**：Base UI 由 Radix、Floating UI、Material UI 的创作者共同打造，API 设计上刻意贴近 Radix，方便迁移。它额外提供了 Combobox/Autocomplete 等更复杂组件、嵌套 Dialog、hover 触发菜单等更深的能力，且有全职团队维护。
- **对你的影响**：shadcn/ui 的**对外 API 不变**——不管你选 Radix 还是 Base UI，你写的都是：

  ```tsx
  // 底层是 Radix 还是 Base UI，这行都一样
  import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
  ```

  变化主要在**组件源码内部**（第 2 章会看到）和**直接用 Base UI 原语时的写法**（Radix 用 `asChild`，Base UI 用 `render` prop，第 3 章详讲）。

---

## 1.2 前置要求

- Node.js ≥ 20（Vite 7 要求）；
- 一个包管理器：`npm` / `pnpm` / `bun` / `yarn` 任选（本教程用 `pnpm`，命令等价替换即可）；
- 会 React 基础（组件、props、state、hooks）；
- 会 Tailwind 基础（不熟悉可先读本仓库的 [`tailwind-tutorial`](../2.tailwind-tutorial/README.md)）。

---

## 1.3 从 0 创建项目

### 第 1 步：用 Vite 建一个 React + TS 项目

```bash
pnpm create vite@latest launchpad --template react-ts
cd launchpad
pnpm install
```

启动看看：

```bash
pnpm dev
# 打开终端提示的地址（通常 http://localhost:5173）
```

### 第 2 步：装 Tailwind CSS v4

Tailwind v4 是 **CSS-first** 配置，不再需要 `tailwind.config.js`。官方推荐用 `@tailwindcss/vite` 插件：

```bash
pnpm add tailwindcss @tailwindcss/vite
```

修改 `vite.config.ts`，加入 Tailwind 插件：

```ts
// vite.config.ts
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

> `@` 别名是 shadcn/ui 的默认约定（组件都 import 自 `@/components/...`），这里一起配好。TypeScript 项目还需在 `tsconfig.json` 和 `tsconfig.app.json` 的 `compilerOptions` 里加：
>
> ```json
> {
>   "compilerOptions": {
>     "baseUrl": ".",
>     "paths": { "@/*": ["./src/*"] }
>   }
> }
> ```

把 `src/index.css` 的内容**整个替换**为一行 Tailwind 引入：

```css
/* src/index.css */
@import "tailwindcss";
```

确认 `src/main.tsx` 里引入了它（Vite 模板默认已引入 `./index.css`）。

### 第 3 步：初始化 shadcn/ui（选择 Base UI）

```bash
pnpm dlx shadcn@latest init
```

CLI 会问几个问题，关键的一个是**选底层组件库**：

```
? Which components would you like to use?  › Base UI   ← 选这个（默认）
                                                       （也可以选 Radix UI）
? Which color would you like as base color? › Neutral / Slate / Zinc ...
```

`init` 会做三件事：

1. 生成 `components.json`（shadcn 的项目配置，第 2 章详解）；
2. 往 `src/index.css` 注入一整套 **design tokens**（CSS 变量 + `@theme inline`）；
3. 创建 `src/lib/utils.ts`（里面有 `cn()` 工具函数）。

> 如果你想体验官方的预设流程，也可以用 `pnpm dlx shadcn@latest create`，它能预览颜色/字体/圆角在真实组件上的效果，适合搭设计系统前先定调。学习期用 `init` 足够。

### 第 4 步：加几个组件试水

```bash
pnpm dlx shadcn@latest add button input label card
```

命令执行后，去看 `src/components/ui/` 目录——**你会发现 button.tsx、input.tsx 等源码文件已经躺在你项目里了**。这正是 shadcn/ui 的核心：源码归你。

---

## 1.4 跑通第一个组件

把 `src/App.tsx` 换成下面的内容，验证一切正常：

```tsx
// src/App.tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function App() {
  return (
    <div className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>LaunchPad</CardTitle>
          <CardDescription>
            环境已就绪，开始搭建你的第一个可访问表单。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="instance-name">实例名称</Label>
            <Input id="instance-name" placeholder="api-server-01" />
          </div>
          <Button type="button">开通实例</Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

`pnpm dev`，你应该看到一张居中卡片、一个带 label 的输入框和一个按钮。**注意几个细节，后面章节会反复用到**：

- `bg-background` / `text-foreground` 这些类名不是 Tailwind 原生的，而是 shadcn 通过 `@theme inline` 把 CSS 变量映射出来的 **design token**（第 2 章）；
- `<Label htmlFor="instance-name">` 和 `<Input id="instance-name">` 通过 id 关联——这是**可访问性**的第一课（第 4 章）；
- `Button` 支持 `type="button"`，因为它内部用 Base UI 的 `useRender`/`render` 机制渲染成真正的 `<button>`（第 3 章）。

---

## 1.5 推荐的项目结构

随着教程推进，建议把代码组织成这样（后面章节会逐步填充）：

```
launchpad/
├── src/
│   ├── components/
│   │   └── ui/                 # shadcn 拷入的组件源码（你拥有它）
│   │       ├── button.tsx
│   │       ├── dialog.tsx
│   │       ├── field.tsx
│   │       ├── input.tsx
│   │       └── ...
│   ├── features/
│   │   └── launch/             # LaunchPad 业务模块
│   │       ├── launch-schema.ts    # Zod schema（第 5、9 章）
│   │       ├── launch-form.tsx     # RHF 表单（第 6~9 章）
│   │       └── confirm-dialog.tsx  # 可访问确认弹窗（第 4 章）
│   ├── lib/
│   │   └── utils.ts            # cn() 等工具（shadcn 生成）
│   ├── server/
│   │   └── validate.ts         # 服务端复用同一套 Zod（第 8 章）
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css               # Tailwind + design tokens
├── components.json             # shadcn 配置
├── vite.config.ts
└── package.json
```

> 把 schema 单独放 `launch-schema.ts` 是有意为之：**同一份 schema 要能被前端表单和后端接口同时 import**，这是「客户端校验只是体验、服务端校验才是安全边界」这条铁律能落地的前提（第 8 章）。

---

## 1.6 本章练习

1. **跑起来**：完成上面 4 步，让第一个组件页面正常显示。
2. **改 token 感受效果**：打开 `src/index.css`，找到 `--primary` 变量，把它的值改一改，观察按钮颜色变化（先别深究，第 2 章会讲透）。
3. **加一个 Dialog**：执行 `pnpm dlx shadcn@latest add dialog`，打开 `src/components/ui/dialog.tsx`，找找里面 import 的是 `@base-ui/react` 还是 `@radix-ui/*`——亲眼确认你的项目走的是哪条底层路线。
4. **思考题**：为什么 shadcn 要把组件源码拷进你的项目，而不是让你 `import` 一个 npm 包？（第 2 章揭晓）

---

## 1.7 本章验收清单

学完本章，你应该能：

- [ ] 说清 shadcn/ui、Base UI、RHF、Zod **四层分工**，以及它们如何串联；
- [ ] 解释为什么 2026-07 之后 shadcn 默认用 Base UI，且**对外 API 不变**；
- [ ] 用 Vite + Tailwind v4 + `shadcn init` **从 0 搭好项目**；
- [ ] 配好 `@` 别名（vite + tsconfig 两处都要）；
- [ ] 成功 `add` 组件并渲染，理解组件源码**已拷入 `src/components/ui/`**；
- [ ] 知道推荐的目录结构，尤其是 **schema 独立文件** 的意义。

---

## 1.8 常见坑速查

| 现象                                 | 原因                                                | 解决                                                          |
| ------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------- |
| `@/components/ui/button` 找不到模块  | 只配了 vite alias，没配 tsconfig `paths`            | 两处都要配（见 1.3 第 2 步）                                  |
| 页面没有任何样式                     | `index.css` 没写 `@import "tailwindcss"` 或没被引入 | 检查 index.css 内容与 main.tsx 引入                           |
| 弹层（Dialog/Popover）被别的元素盖住 | 缺少 portal 层叠隔离                                | Base UI 建议在应用根节点加 `isolation: isolate`（见第 3 章）  |
| `shadcn init` 找不到 Tailwind        | Tailwind v4 未正确安装/配置                         | 确认 `@tailwindcss/vite` 已加入 plugins                       |
| 组件源码里 import 的是 Radix         | init 时选了 Radix                                   | 想换 Base UI 需重新 init 或手动迁移，建议新项目直接选 Base UI |

---

下一章：[shadcn/ui 的「拥有源码」模型 →](./02-shadcn-ownership-model.md)
