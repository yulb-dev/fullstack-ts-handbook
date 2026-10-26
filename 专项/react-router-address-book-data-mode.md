# React Router 官方 Address Book 教程 · Data Mode 8.5 中文实战

> 本文是 React Router 官方 [Address Book 教程](https://reactrouter.com/tutorials/address-book) 的**中文改写版**。
> 官方那篇用的是 **Framework Mode**（`create-react-router`、`routes.ts`、`clientLoader`、`Route.ComponentProps`、`react-router.config.ts` 里的 `ssr`/`prerender`……）。
> 本文把它**整体替换成 React Router 8.5 的 Data Mode 写法**（`createBrowserRouter` + `RouterProvider` + route object + `useLoaderData` 等 hook），并翻译成中文，功能与教学节奏与官方保持一致。

我们会从零构建一个小而功能完整的**通讯录（Address Book）**应用，用来管理你的联系人。它没有数据库、也不追求「生产就绪」，好让我们把注意力完全放在 React Router 提供的能力上。跟着做大约需要 30–45 分钟；如果只是读，也很快。

> 👉 **每次看到这个手势，就代表你需要在应用里动手做点什么！**
> 其余文字都是背景说明与原理讲解，帮助你理解得更透彻。我们开始吧。

---

## 版本与环境

| 工具         | 版本   | 说明                                                                       |
| ------------ | ------ | -------------------------------------------------------------------------- |
| Node.js      | ≥ 20   | React Router v8 / Vite 需要较新的 Node                                     |
| React        | ≥ 19.2 | **React Router v8 要求 React 19.2+**（硬性 peerDependency）                |
| react-router | ^8.5   | 主包，统一从 `react-router` 导入                                           |
| Vite         | ≥ 6    | 用它做开发服务器与打包（Data Mode 不绑定打包器，换成 Webpack/Rspack 亦可） |

> 💡 **关于模式**：React Router 有三种模式——Declarative ⊂ Data ⊂ Framework，能力依次递增，代价是交给框架的架构控制权越来越多。本文用 **Data Mode**：它提供 `loader`/`action`/`useNavigation`/`useFetcher`/路由级错误边界等全部「数据能力」，但**不接管你的构建与服务端**。若你日后需要 SSR / 预渲染 / 类型安全的 `href`，再平滑升级到 Framework Mode 即可（本文最后一节给出差异对照）。
> 本仓库的 [`3.react-router-tutorial/`](../3.react-router-tutorial/README.md) 是一套系统化的 Data Mode 章节教程；本文则是官方 Address Book 的 Data Mode 实战译本，二者可互为补充。

排版约定（沿用本仓库习惯）：💡 概念/心智模型；⚠️ 常见坑；📌 **Data Mode 相对官方 Framework 版的改写说明**；👉 动手操作。

---

## 📌 Framework → Data Mode 改写对照表

官方那篇的每个 Framework 概念，在本文里的 Data Mode 对应物如下。**先扫一眼有个整体印象，遇到具体章节再回来看即可。**

| 官方 Framework Mode                                                                              | 本文 Data Mode 8.5                                                         | 说明                                                           |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `npx create-react-router@latest --template ...`                                                  | `npm create vite@latest ... -- --template react-ts` + `npm i react-router` | Framework 用官方 CLI 模板；Data Mode 自带打包器（这里用 Vite） |
| `app/routes.ts`（`route`/`index`/`layout`）                                                      | `createBrowserRouter([...])` 的路由对象数组                                | 路由配置从「文件约定」变成「显式 JS 对象」                     |
| `app/root.tsx` 里的 `Layout` + `<html>` + `<Scripts>`                                            | Vite 的 `index.html` + `main.tsx` 渲染 `<RouterProvider>`                  | HTML 外壳交给打包器，不再由 React 组件产出                     |
| `clientLoader`（SPA）/ `loader`（SSR）二选一                                                     | 只有 `loader`（SPA 中就在浏览器里运行）                                    | Data Mode 没有 client/server loader 之分                       |
| `Route.ComponentProps` + `{ loaderData }` prop                                                   | `useLoaderData<typeof loader>()` hook                                      | 数据用 hook 读取，类型靠泛型                                   |
| `Route.LoaderArgs` / `Route.ActionArgs`                                                          | `LoaderFunctionArgs` / `ActionFunctionArgs`                                | 直接从 `react-router` 导入类型                                 |
| 自动生成的 `./+types/root` 等                                                                    | 手动泛型（`typeof loader` / `typeof action`）                              | Data Mode 没有类型代码生成                                     |
| `export function ErrorBoundary({ error })`                                                       | 路由对象上的 `ErrorBoundary` + `useRouteError()`                           | 错误边界挂在路由对象上，而非文件导出                           |
| `HydrateFallback` / `prerender` / `ssr` 配置                                                     | 不适用（纯客户端 SPA）                                                     | 需要 SSR/预渲染请升级到 Framework Mode                         |
| `layout("layouts/sidebar.tsx", [...])`                                                           | pathless 路由对象 `{ Component: SidebarLayout, children: [...] }`          | 布局路由 = 有 `Component`、无 `path`                           |
| `redirect` / `data` / `Form` / `Link` / `NavLink` / `useNavigation` / `useFetcher` / `useSubmit` | **完全一致**（均从 `react-router` 导入）                                   | 这些 API 两种模式通用，是本文改写量最小的部分                  |

---

## 准备工作（Setup）

官方用的是 `create-react-router` 模板；Data Mode 下我们**自己用 Vite 起一个 React + TS 工程**，再把官方模板的「数据层 + 样式」搬进来。

👉 **生成基础工程**

```shellscript nonumber
npm create vite@latest address-book -- --template react-ts
cd address-book
npm install
```

👉 **安装 React Router 与数据层依赖**

```shellscript nonumber
npm install react-router
# 官方模板的 data.ts 用到这三个库（假数据库的排序/搜索/断言）
npm install match-sorter sort-by tiny-invariant
```

👉 **准备数据层与样式**

- 在 `src/` 下新建 `data.ts`，内容见下方（**忠实照搬官方模板的假数据库**，与 React Router 无关，只是给 loader/action 调用的数据源）。
- 官方模板还带了一份 `app.css`（侧边栏、详情页、表单、加载态等全部样式）。本文不逐行讲解 CSS——**直接从官方模板复制**：把 [模板 `app.css`](https://raw.githubusercontent.com/remix-run/react-router/main/tutorials/address-book/app/app.css) 的内容保存为 `src/app.css` 即可。

```ts filename=src/data.ts
////////////////////////////////////////////////////////////////////////////////
// 🛑 这个文件里的内容和 React Router 无关，它只是一个「假数据库」
////////////////////////////////////////////////////////////////////////////////

import { matchSorter } from "match-sorter";
// @ts-expect-error - sort-by 没有类型声明，但它只是个很小的函数
import sortBy from "sort-by";
import invariant from "tiny-invariant";

type ContactMutation = {
  id?: string;
  first?: string;
  last?: string;
  avatar?: string;
  twitter?: string;
  notes?: string;
  favorite?: boolean;
};

export type ContactRecord = ContactMutation & {
  id: string;
  createdAt: string;
};

////////////////////////////////////////////////////////////////////////////////
// 这只是一张假的 DB 表。真实应用里你会连真实数据库或调用已有的 API。
const fakeContacts = {
  records: {} as Record<string, ContactRecord>,

  async getAll(): Promise<ContactRecord[]> {
    return Object.keys(fakeContacts.records)
      .map((key) => fakeContacts.records[key])
      .sort(sortBy("-createdAt", "last"));
  },

  async get(id: string): Promise<ContactRecord | null> {
    return fakeContacts.records[id] || null;
  },

  async create(values: ContactMutation): Promise<ContactRecord> {
    const id = values.id || Math.random().toString(36).substring(2, 9);
    const createdAt = new Date().toISOString();
    const newContact = { id, createdAt, ...values };
    fakeContacts.records[id] = newContact;
    return newContact;
  },

  async set(id: string, values: ContactMutation): Promise<ContactRecord> {
    const contact = await fakeContacts.get(id);
    invariant(contact, `No contact found for ${id}`);
    const updatedContact = { ...contact, ...values };
    fakeContacts.records[id] = updatedContact;
    return updatedContact;
  },

  destroy(id: string): null {
    delete fakeContacts.records[id];
    return null;
  },
};

////////////////////////////////////////////////////////////////////////////////
// 一些供路由 loader / action 调用的辅助函数
export async function getContacts(query?: string | null) {
  // 故意加 500ms 延迟：模拟真实世界的网络耗时，后面做搜索转圈/乐观 UI 时才看得出效果
  await new Promise((resolve) => setTimeout(resolve, 500));
  let contacts = await fakeContacts.getAll();
  if (query) {
    contacts = matchSorter(contacts, query, {
      keys: ["first", "last"],
    });
  }
  return contacts.sort(sortBy("last", "createdAt"));
}

export async function createEmptyContact() {
  const contact = await fakeContacts.create({});
  return contact;
}

export async function getContact(id: string) {
  return fakeContacts.get(id);
}

export async function updateContact(id: string, updates: ContactMutation) {
  const contact = await fakeContacts.get(id);
  if (!contact) {
    throw new Error(`No contact found for ${id}`);
  }
  await fakeContacts.set(id, { ...contact, ...updates });
  return contact;
}

export async function deleteContact(id: string) {
  fakeContacts.destroy(id);
}

// 种子数据：官方模板里约 30 条，这里保留 4 条示意，其余可从官方模板 data.ts 末尾复制。
[
  {
    avatar:
      "https://sessionize.com/image/124e-400o400o2-wHVdAuNaxi8KJrgtN3ZKci.jpg",
    first: "Shruti",
    last: "Kapoor",
    twitter: "@shrutikapoor08",
  },
  {
    avatar:
      "https://sessionize.com/image/1940-400o400o2-Enh9dnYmrLYhJSTTPSw3MH.jpg",
    first: "Glenn",
    last: "Reyes",
    twitter: "@glnnrys",
  },
  {
    avatar:
      "https://sessionize.com/image/9273-400o400o2-3tyrUE3HjsCHJLU5aUJCja.jpg",
    first: "Ryan",
    last: "Florence",
  },
  {
    avatar:
      "https://sessionize.com/image/d14d-400o400o2-pyB229HyFPCnUcZhHf3kWS.png",
    first: "Oscar",
    last: "Newman",
    twitter: "@__oscarnewman",
  },
].forEach((contact) => {
  fakeContacts.create({
    ...contact,
    id: `${contact.first.toLowerCase().split(" ").join("_")}-${contact.last.toLocaleLowerCase()}`,
  });
});
```

👉 **改写入口：用 `RouterProvider` 渲染，而不是 `App`**

Vite 模板自带 `src/main.tsx` + `src/App.tsx`。Data Mode 下我们**删掉 `App.tsx`**（或留着不管），把 `main.tsx` 改成挂载路由器；HTML 外壳沿用 Vite 的 `index.html`。

```tsx filename=src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router";

import { router } from "./router";
import "./app.css"; // 从官方模板复制来的样式

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
```

📌 **这就是 Framework 与 Data Mode 最直观的区别**：Framework 版没有 `main.tsx`，HTML（`<html>`/`<head>`/`<Scripts>`）由 `app/root.tsx` 的 `Layout` 导出产出；Data Mode 则把 HTML 外壳交给 Vite 的 `index.html`，React 只负责在 `#root` 里渲染 `<RouterProvider>`。

👉 **确认 `index.html` 是标准 Vite 外壳**

```html filename=index.html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React Router Contacts</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

此刻还没有 `router.tsx`，所以先别急着 `npm run dev`——我们在下一节创建它。

---

## 根路由（The Root Route）

Data Mode 里没有「`app/root.tsx` 这个特殊文件」的概念。**根路由就是你传给 `createBrowserRouter` 的数组里最外层的那个路由对象**：它通常承载全局布局（这里的侧边栏），以及全局的 `ErrorBoundary`。

👉 **创建路由表 `src/router.tsx` 与根组件 `src/routes/root.tsx`**

先建目录与文件：

```shellscript nonumber
mkdir src/routes
touch src/router.tsx src/routes/root.tsx
```

`root.tsx` 里放整个应用的「外壳」——左侧边栏。此时我们**先写死两条联系人链接**，稍后再用真实数据替换：

```tsx filename=src/routes/root.tsx
import { Form } from "react-router";

export default function Root() {
  return (
    <>
      <div id="sidebar">
        <h1>React Router Contacts</h1>
        <div>
          <Form id="search-form" role="search">
            <input
              aria-label="Search contacts"
              id="q"
              name="q"
              placeholder="Search"
              type="search"
            />
            <div aria-hidden hidden={true} id="search-spinner" />
          </Form>
          <Form method="post">
            <button type="submit">New</button>
          </Form>
        </div>
        <nav>
          <ul>
            <li>
              <a href={`/contacts/1`}>Your Name</a>
            </li>
            <li>
              <a href={`/contacts/2`}>Your Friend</a>
            </li>
          </ul>
        </nav>
      </div>
    </>
  );
}
```

然后在 `router.tsx` 里用 `createBrowserRouter` 把它注册为根路由：

```tsx filename=src/router.tsx
import { createBrowserRouter } from "react-router";

import Root from "./routes/root";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
  },
]);
```

💡 `createBrowserRouter` 接收一个**路由对象数组**。每个对象的常见字段：`path`（URL 片段）、`Component`（渲染的组件）、`loader`（进入前加载数据）、`action`（处理提交）、`ErrorBoundary`（错误边界）、`children`（子路由）、`index`（索引路由）、`lazy`（懒加载）。**这张数组就是你整个应用的「路由真相来源」**——页面层级、URL、每个路由的数据逻辑都在这里一览无余。

👉 **启动应用**

```shellscript nonumber
npm run dev
```

打开 Vite 提示的地址（默认 [http://localhost:5173](http://localhost:5173)），你会看到左侧边栏已经渲染出来了，但右边还是一片空白——因为我们还没有子路由，也没渲染 `<Outlet/>`。

📌 **关于全局错误边界**：Framework 版在 `app/root.tsx` 里 `export function ErrorBoundary(...)`。Data Mode 里，我们把 `ErrorBoundary` 作为**根路由对象的一个属性**，并用 `useRouteError()` 读取错误。这一节先不加，等讲到「抛出 Response（404）」时再补上，届时你能更清楚它为什么放在根部。

---

## 联系人路由 UI（The Contact Route UI）

现在点击侧边栏里的条目会跳到默认的空白/404。我们来创建一个能匹配 `/contacts/1` 的路由。

👉 **创建联系人路由组件**

```shellscript nonumber
touch src/routes/contact.tsx
```

文件放哪都行，但为了整洁，我们把所有路由组件都放进 `src/routes/` 目录。

> 💡 Data Mode 不像 Framework 那样有「文件即路由」的约定——**路由和文件的对应关系，完全由你在 `router.tsx` 里显式声明**。这既是负担（要手写映射），也是自由（文件想怎么组织就怎么组织）。

👉 **在路由表里注册它**

```tsx filename=src/router.tsx
import { createBrowserRouter } from "react-router";

import Root from "./routes/root";
import Contact from "./routes/contact";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [{ path: "contacts/:contactId", Component: Contact }],
  },
]);
```

在 React Router 里，`:` 让某一段 URL 变成**动态段**。上面这行让以下 URL 都能匹配到 `Contact` 组件：

- `/contacts/123`
- `/contacts/abc`

其中 `contactId` 就是动态段的名字，稍后可以在 loader/组件里通过 `params.contactId` 读到。

👉 **填入联系人组件的 UI**

就是一堆元素，直接复制粘贴即可：

```tsx filename=src/routes/contact.tsx
import { Form } from "react-router";

import type { ContactRecord } from "../data";

export default function Contact() {
  const contact = {
    first: "Your",
    last: "Name",
    avatar: "https://placecats.com/200/200",
    twitter: "your_handle",
    notes: "Some notes",
    favorite: true,
  };

  return (
    <div id="contact">
      <div>
        <img
          alt={`${contact.first} ${contact.last} avatar`}
          key={contact.avatar}
          src={contact.avatar}
        />
      </div>

      <div>
        <h1>
          {contact.first || contact.last ? (
            <>
              {contact.first} {contact.last}
            </>
          ) : (
            <i>No Name</i>
          )}
          <Favorite contact={contact} />
        </h1>

        {contact.twitter ? (
          <p>
            <a href={`https://twitter.com/${contact.twitter}`}>
              {contact.twitter}
            </a>
          </p>
        ) : null}

        {contact.notes ? <p>{contact.notes}</p> : null}

        <div>
          <Form action="edit">
            <button type="submit">Edit</button>
          </Form>

          <Form
            action="destroy"
            method="post"
            onSubmit={(event) => {
              const response = confirm(
                "Please confirm you want to delete this record.",
              );
              if (!response) {
                event.preventDefault();
              }
            }}
          >
            <button type="submit">Delete</button>
          </Form>
        </div>
      </div>
    </div>
  );
}

function Favorite({ contact }: { contact: Pick<ContactRecord, "favorite"> }) {
  const favorite = contact.favorite;

  return (
    <Form method="post">
      <button
        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
        name="favorite"
        value={favorite ? "false" : "true"}
      >
        {favorite ? "★" : "☆"}
      </button>
    </Form>
  );
}
```

现在如果点击侧边栏链接、或直接访问 [`/contacts/1`](http://localhost:5173/contacts/1)，会发现……**页面没有任何变化？**

别急，这正是下一节要解决的问题。

---

## 嵌套路由与 Outlet（Nested Routes and Outlets）

React Router 支持**嵌套路由**。要让子路由渲染进父级布局里，父组件必须渲染一个 [`<Outlet/>`](https://api.reactrouter.com/v8/functions/react_router.Outlet.html)。我们来修好它——打开 `src/routes/root.tsx`，在里面渲染一个 `<Outlet/>`。

👉 **渲染 `<Outlet/>`**

```tsx filename=src/routes/root.tsx
import { Form, Outlet } from "react-router";

export default function Root() {
  return (
    <>
      <div id="sidebar">{/* 其它元素 */}</div>
      <div id="detail">
        <Outlet />
      </div>
    </>
  );
}
```

现在子路由（`Contact`）就会通过 `<Outlet/>` 渲染到右侧的 `#detail` 区域里了。

💡 **心智模型**：`<Outlet/>` 是父布局里的一个「占位插槽」。URL 匹配到哪个子路由，`<Outlet/>` 就渲染哪个子组件。父布局（侧边栏）在子路由之间切换时**不会重新挂载**——这正是「共享布局」的关键：切换联系人时，左侧列表不会闪一下重新加载。

---

## 客户端路由（Client Side Routing）

你可能注意到，也可能没注意到：点击侧边栏链接时，浏览器其实是在对下一个 URL 发起**整页文档请求**（因为那是普通的 `<a href>`），而不是客户端路由——这会让整个应用重新挂载。

**客户端路由**让应用在不重新加载整页的情况下更新 URL，从而立即渲染新 UI。我们用 [`<Link>`](https://api.reactrouter.com/v8/variables/react_router.Link.html) 来实现。

👉 **把侧边栏的 `<a href>` 换成 `<Link to>`**

```tsx filename=src/routes/root.tsx
import { Form, Link, Outlet } from "react-router";

export default function Root() {
  return (
    <>
      <div id="sidebar">
        {/* 其它元素 */}
        <nav>
          <ul>
            <li>
              <Link to={`/contacts/1`}>Your Name</Link>
            </li>
            <li>
              <Link to={`/contacts/2`}>Your Friend</Link>
            </li>
          </ul>
        </nav>
      </div>
      {/* 其它元素（含 #detail + <Outlet/>） */}
    </>
  );
}
```

你可以打开浏览器开发者工具的 Network 面板确认：点击链接时**不再请求新的 HTML 文档**了，取而代之的是（稍后会出现的）数据请求。

💡 `<Link>` 与 `<a>` 的区别，就是「单页应用」与「多页网站」的区别：`<a href>` 让浏览器重新拉取整个页面；`<Link to>` 让 React Router 拦截点击、只更新 URL 并重渲染必要的部分，同时保留滚动位置、组件状态等客户端状态。

---

## 加载数据（Loading Data）

URL 片段、布局、数据这三者往往是**耦合**在一起的（甚至可以说「三位一体」）。在这个应用里已经能看出来：

| URL 片段              | 组件               | 数据       |
| --------------------- | ------------------ | ---------- |
| `/`                   | `<Root>`（侧边栏） | 联系人列表 |
| `contacts/:contactId` | `<Contact>`        | 单个联系人 |

正因为这种天然的耦合，React Router 提供了一套**数据约定**，让你能轻松地把数据送进路由组件——这就是 `loader`。

📌 **Data Mode 的关键差异**：官方 Framework 版在纯 SPA 阶段用的是 `clientLoader`，开启 SSR 后再换成 `loader`。**Data Mode 没有这个区分**——它只有 `loader`。因为我们做的是纯客户端 SPA，这个 `loader` 就在**浏览器里**运行（而不是服务器上）。所以下文自始至终都用 `loader`，不再出现 `clientLoader`。

在 Data Mode 里，我们把 loader 定义在路由组件文件里并导出，再在 `router.tsx` 里挂到对应路由对象上——**数据逻辑紧挨着它的组件**，好找也好测。

👉 **在 `root.tsx` 里导出 `loader`，并用 `useLoaderData` 渲染数据**

```tsx filename=src/routes/root.tsx
import { Form, Link, Outlet, useLoaderData } from "react-router";

import { getContacts } from "../data";

export async function loader() {
  const contacts = await getContacts();
  return { contacts };
}

export default function Root() {
  const { contacts } = useLoaderData<typeof loader>();

  return (
    <>
      <div id="sidebar">
        <h1>React Router Contacts</h1>
        <div>
          <Form id="search-form" role="search">
            <input
              aria-label="Search contacts"
              id="q"
              name="q"
              placeholder="Search"
              type="search"
            />
            <div aria-hidden hidden={true} id="search-spinner" />
          </Form>
          <Form method="post">
            <button type="submit">New</button>
          </Form>
        </div>
        <nav>
          {contacts.length ? (
            <ul>
              {contacts.map((contact) => (
                <li key={contact.id}>
                  <Link to={`contacts/${contact.id}`}>
                    {contact.first || contact.last ? (
                      <>
                        {contact.first} {contact.last}
                      </>
                    ) : (
                      <i>No Name</i>
                    )}
                    {contact.favorite ? <span>★</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              <i>No contacts</i>
            </p>
          )}
        </nav>
      </div>
      <div id="detail">
        <Outlet />
      </div>
    </>
  );
}
```

👉 **把 `loader` 挂到根路由对象上**

```tsx filename=src/router.tsx
import { createBrowserRouter } from "react-router";

import Root, { loader as rootLoader } from "./routes/root";
import Contact from "./routes/contact";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    loader: rootLoader, // ← 进入路由「之前」先把数据加载好
    children: [{ path: "contacts/:contactId", Component: Contact }],
  },
]);
```

就这样！React Router 现在会**自动让这份数据与 UI 保持同步**。侧边栏应该变成了真实的联系人列表。

💡 **`loader` 何时运行**：在路由组件渲染**之前**。当用户导航到某个路由时，React Router 会先并行调用该路由分支上所有的 `loader`，等数据就绪后再渲染组件，并把结果通过 `useLoaderData()` 交给你。你不再需要 `useEffect` + `useState` + `loading` 标志位这套手写模板。

---

## 类型安全（Type Safety）

你可能注意到，我们用 `useLoaderData<typeof loader>()` 拿到数据时，**根本没有手写类型**，但 `contacts` 已经被正确推断为 `ContactRecord[]`。

📌 **Data Mode 的类型方案**：Framework 版会为每个路由**自动生成** `./+types/root` 里的 `Route.ComponentProps`、`Route.LoaderArgs` 等类型。Data Mode **没有类型代码生成**，改用 TypeScript 的泛型：

- `useLoaderData<typeof loader>()`：把 loader 的返回类型「灌」进 hook，`loaderData` 自动获得类型。
- `useActionData<typeof action>()`：同理。
- loader/action 的入参：用从 `react-router` 导入的 `LoaderFunctionArgs` / `ActionFunctionArgs`。

也就是说，`typeof loader` 就是我们「手动的类型生成」——loader 返回什么，组件就拿到什么，改一处、类型全程跟着变。

> ⚠️ 如果你写 `useLoaderData()` 而不带泛型，返回类型会是 `unknown`/`any`，就享受不到类型检查了。**养成带 `typeof loader` 的习惯。**

---

## 📌 首屏初始加载（对应官方的 HydrateFallback）

官方 Framework 版有一节讲 `HydrateFallback`：因为它是 SSR/水合（hydration）模型，页面在客户端「水合」完成前会有一段白屏，于是用 `HydrateFallback` 顶一个加载动画。

**Data Mode 的纯客户端 SPA 没有「水合」这一步**，所以严格来说不需要 `HydrateFallback`。它的行为是：`createBrowserRouter` + `<RouterProvider>` 在**首次渲染路由树之前**，会先把初始 URL 匹配到的 loader 跑完。也就是说，首屏不是「先白屏再水合」，而是「数据就绪后一次性渲染」。

如果你确实想在初始 loader 期间显示一个开屏加载态，Data Mode 的做法是在 `RouterProvider` **外层**根据 `router.state.initialized` 判断：

```tsx filename=src/main.tsx（可选增强，非必需）
// ...
<RouterProvider router={router} />
// router.state.initialized === false 时，路由树尚未渲染；
// 如需开屏 splash，可在 RouterProvider 之外自行包一层判断，
// 或给根路由配置 HydrateFallback（Data Mode 亦支持，用于「未初始化」时渲染）。
```

本文后续不依赖这个开屏态，**你可以先跳过**，专注路由本身。

---

## 索引路由（Index Routes）

当应用刚加载、还没进入任何联系人页面时，你会看到右侧列表旁边是一大片空白。

这是因为：当一个路由有子路由、而你又正处在父路由自身的路径（`/`）上时，`<Outlet/>` **没有任何子路由可渲染**（`contacts/:contactId` 匹配不了 `/`）。你可以把**索引路由**理解成「用来填补这块空白的默认子路由」。

👉 **为根路由创建一个索引路由**

```shellscript nonumber
touch src/routes/home.tsx
```

```tsx filename=src/router.tsx
import Root, { loader as rootLoader } from "./routes/root";
import Home from "./routes/home";
import Contact from "./routes/contact";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    loader: rootLoader,
    children: [
      { index: true, Component: Home }, // ← 索引路由：匹配父路径 "/" 本身
      { path: "contacts/:contactId", Component: Contact },
    ],
  },
]);
```

👉 **填入索引组件的内容**

没什么特别的，复制粘贴即可：

```tsx filename=src/routes/home.tsx
export default function Home() {
  return (
    <p id="index-page">
      This is a demo for React Router.
      <br />
      Check out{" "}
      <a href="https://reactrouter.com">the docs at reactrouter.com</a>.
    </p>
  );
}
```

瞧！右侧不再是空白了。索引路由常用来放仪表盘、统计、信息流等「默认页」，它同样可以拥有自己的 `loader`/`action`。

💡 **索引路由 vs 普通子路由**：索引路由用 `{ index: true }`（没有 `path`），它匹配的是**父路由路径本身**；普通子路由有 `path`，匹配的是父路径 + 自己的路径。一个父路由下最多有一个索引路由。

---

## 添加一个「关于」路由（Adding an About Route）

在处理「用户可交互的动态数据」之前，我们先加一个内容基本不变的静态页面——「关于」页再合适不过了。

👉 **创建 about 路由**

```shellscript nonumber
touch src/routes/about.tsx
```

别忘了在 `router.tsx` 里注册它：

```tsx filename=src/router.tsx
children: [
  { index: true, Component: Home },
  { path: "contacts/:contactId", Component: Contact },
  { path: "about", Component: About },
],
```

👉 **填入关于页 UI**

同样没什么特别的，复制粘贴：

```tsx filename=src/routes/about.tsx
import { Link } from "react-router";

export default function About() {
  return (
    <div id="about">
      <Link to="/">← Go to demo</Link>
      <h1>About React Router Contacts</h1>

      <div>
        <p>
          This is a demo application showing off some of the powerful features
          of React Router, including dynamic routing, nested routes, loaders,
          actions, and more.
        </p>

        <h2>Features</h2>
        <p>Explore the demo to see how React Router handles:</p>
        <ul>
          <li>Data loading and mutations with loaders and actions</li>
          <li>Nested routing with parent/child relationships</li>
          <li>URL-based routing with dynamic segments</li>
          <li>Pending and optimistic UI</li>
        </ul>

        <h2>Learn More</h2>
        <p>
          Check out the official documentation at{" "}
          <a href="https://reactrouter.com">reactrouter.com</a> to learn more
          about building great web applications with React Router.
        </p>
      </div>
    </div>
  );
}
```

👉 **在侧边栏加一个通往关于页的链接**

```tsx filename=src/routes/root.tsx
export default function Root() {
  return (
    <>
      <div id="sidebar">
        <h1>
          <Link to="about">React Router Contacts</Link>
        </h1>
        {/* 其它元素 */}
      </div>
      {/* 其它元素 */}
    </>
  );
}
```

现在访问 [`/about`](http://localhost:5173/about)，页面就出来了。

> ⚠️ 但你会发现一个问题：**关于页也带着左侧边栏**，而且它其实**并不需要联系人数据**。下一节我们就用一个「布局路由」把侧边栏和数据加载**限定在需要的路由范围内**。

---

## 布局路由（Layout Routes）

我们并不希望关于页被嵌套进侧边栏布局里。把侧边栏抽成一个**布局路由**，就能让它只在需要的时候渲染；同时也避免在关于页去加载全部联系人数据。

📌 **Data Mode 里「布局路由」怎么写**：Framework 版用 `layout("layouts/sidebar.tsx", [...])`。Data Mode 里，布局路由就是一个**有 `Component`、但没有 `path` 的路由对象**（业内叫 pathless layout route），它的 `children` 就是被它包裹的路由。它渲染 `<Outlet/>` 来放置子路由。

👉 **创建侧边栏布局路由**

```shellscript nonumber
mkdir src/layouts
touch src/layouts/sidebar.tsx
```

先让它只返回一个 `<Outlet/>`：

```tsx filename=src/layouts/sidebar.tsx
import { Outlet } from "react-router";

export default function SidebarLayout() {
  return <Outlet />;
}
```

👉 **把首页与联系人路由挪到侧边栏布局之下**

用一个无 `path` 的布局路由把 `Home` 和 `Contact` 包起来，`about` 留在布局之外：

```tsx filename=src/router.tsx
import { createBrowserRouter } from "react-router";

import Root from "./routes/root";
import SidebarLayout, { loader as sidebarLoader } from "./layouts/sidebar";
import Home from "./routes/home";
import Contact from "./routes/contact";
import About from "./routes/about";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      {
        // 无 path 的布局路由：侧边栏 + 联系人数据都收敛到这里
        Component: SidebarLayout,
        loader: sidebarLoader,
        children: [
          { index: true, Component: Home },
          { path: "contacts/:contactId", Component: Contact },
        ],
      },
      { path: "about", Component: About }, // 不在侧边栏布局内
    ],
  },
]);
```

👉 **把布局与数据加载都搬进侧边栏布局**

原本 `root.tsx` 里的侧边栏 UI 和 `loader` 整体迁到 `sidebar.tsx`：

```tsx filename=src/layouts/sidebar.tsx
import { Form, Link, Outlet, useLoaderData } from "react-router";

import { getContacts } from "../data";

export async function loader() {
  const contacts = await getContacts();
  return { contacts };
}

export default function SidebarLayout() {
  const { contacts } = useLoaderData<typeof loader>();

  return (
    <>
      <div id="sidebar">
        <h1>
          <Link to="about">React Router Contacts</Link>
        </h1>
        <div>
          <Form id="search-form" role="search">
            <input
              aria-label="Search contacts"
              id="q"
              name="q"
              placeholder="Search"
              type="search"
            />
            <div aria-hidden hidden={true} id="search-spinner" />
          </Form>
          <Form method="post">
            <button type="submit">New</button>
          </Form>
        </div>
        <nav>
          {contacts.length ? (
            <ul>
              {contacts.map((contact) => (
                <li key={contact.id}>
                  <Link to={`contacts/${contact.id}`}>
                    {contact.first || contact.last ? (
                      <>
                        {contact.first} {contact.last}
                      </>
                    ) : (
                      <i>No Name</i>
                    )}
                    {contact.favorite ? <span>★</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              <i>No contacts</i>
            </p>
          )}
        </nav>
      </div>
      <div id="detail">
        <Outlet />
      </div>
    </>
  );
}
```

然后 `root.tsx` 里的 `Root` **只需返回一个 `<Outlet/>`**，并删掉不再用到的 import 和 `loader`（**务必删掉 root 的 loader**，否则关于页仍会去加载联系人数据）：

```tsx filename=src/routes/root.tsx
import { Outlet } from "react-router";

export default function Root() {
  return <Outlet />;
}
```

经过这番搬移，关于页**既不再加载联系人数据，也不再被塞进侧边栏布局**了。

💡 **为什么要分层**：现在路由树是 `Root（全局外壳 + 错误边界）` → `SidebarLayout（侧边栏 + 联系人数据）` → `Home / Contact`，而 `About` 直接挂在 `Root` 下。**布局路由让你能精确控制「哪些页面共享哪套布局与数据」**——这是把「页面层级」表达清楚的核心手段。

---

## 📌 预渲染与 SSR（Framework 专属，本文取舍）

官方接下来有两节——「Pre-rendering a Static Route（预渲染关于页）」和「Server-Side Rendering（开启 SSR）」——它们都依赖 Framework Mode 的 `react-router.config.ts`：

```ts filename=react-router.config.ts（Framework Mode 专属，Data Mode 没有这个文件）
import { type Config } from "@react-router/dev/config";

export default {
  ssr: true,
  prerender: ["/about"],
} satisfies Config;
```

**Data Mode 是纯客户端 SPA，没有 `ssr`/`prerender` 这些配置项**，`loader` 一律在浏览器里运行。所以：

- 这两节在本文里**没有对应的可操作代码**，我们直接跳过。
- 关于页刷新时会有一瞬间的空白（因为要等客户端 JS 加载 + loader 跑完），这是 SPA 的固有特性。
- 如果你确实需要「首屏服务端渲染」或「把某些页面在构建时预渲染成静态 HTML」，正确做法是**升级到 Framework Mode**（`@react-router/dev`）。好消息是：`loader`/`action`/`useFetcher`/错误边界这些**概念完全一致**，主要变化是「文件即路由」和类型自动生成。

> 一句话：**Data Mode 给你「数据能力 + 架构自由」，但不含 SSR/预渲染；需要时再升级到 Framework Mode。**

---

## loader 中的 URL 参数（URL Params in Loaders）

👉 **点击侧边栏里的某个联系人链接**

我们又能看到之前那个静态的联系人页面了，只有一个区别：**URL 里现在是这条记录真实的 ID**。

还记得路由定义里的 `:contactId` 吗？这些**动态段**会匹配该位置上任意（变化的）值。我们把 URL 里的这些值称为「URL 参数」，简称「params」。

`params` 会以「动态段名 → 值」的形式传给 loader。比如我们的段叫 `:contactId`，那么值就通过 `params.contactId` 传入。params 最常见的用途，就是**按 ID 查一条记录**。我们来试试。

👉 **给联系人页加 `loader`，并用 `useLoaderData` 取数据**

```tsx filename=src/routes/contact.tsx
import { Form, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import invariant from "tiny-invariant";

import { getContact } from "../data";
import type { ContactRecord } from "../data";

export async function loader({ params }: LoaderFunctionArgs) {
  invariant(params.contactId, "Missing contactId param");
  const contact = await getContact(params.contactId);
  return { contact };
}

export default function Contact() {
  const { contact } = useLoaderData<typeof loader>();

  return (
    <div id="contact">
      {/* 用真实的 contact 渲染，替换掉之前写死的假数据 */}
      {/* ... 与前面相同的 JSX ... */}
    </div>
  );
}

// Favorite 组件保持不变
```

> 💡 `invariant(params.contactId, ...)` 来自 `tiny-invariant`（准备工作里装过）。它有两个作用：一是运行时断言，二是**帮 TypeScript 把 `params.contactId` 的类型从 `string | undefined` 收窄成 `string`**——因为 Data Mode 的 `LoaderFunctionArgs` 里 params 的值都是可选的。

📌 **类型差异**：官方 Framework 版写 `loader({ params }: Route.LoaderArgs)`，`params.contactId` 由代码生成保证是 `string`。Data Mode 用 `LoaderFunctionArgs`，`params.contactId` 是 `string | undefined`，所以要用 `invariant`（或非空断言 `!`）收窄。

此时 `contact` 的类型是 `ContactRecord | null`——因为 `getContact` 在找不到时会返回 `null`。这就引出了下一节。

---

## 抛出 Response（Throwing Responses）

`loaderData.contact` 可能是 `null`。我们当然可以在组件里到处判断「联系人为空怎么办」，但更「Web 原味」的做法是**返回一个正经的 404**。而且我们可以在 loader 里一次性解决所有问题。

👉 **找不到联系人时 `throw new Response`**

```tsx filename=src/routes/contact.tsx
export async function loader({ params }: LoaderFunctionArgs) {
  invariant(params.contactId, "Missing contactId param");
  const contact = await getContact(params.contactId);
  if (!contact) {
    throw new Response("Not Found", { status: 404 });
  }
  return { contact };
}
```

这样一来，如果联系人不存在，这条路径上的代码执行就**立刻中止**，React Router 转而去渲染**错误路径**。组件因此只需专注「一切正常」的快乐路径 😁。

> 💡 v7/v8 也可以用 `throw data("Not Found", { status: 404 })`（`data` 从 `react-router` 导入），语义等价、更轻量。本文沿用官方的 `throw new Response(...)`。两者都会被 `isRouteErrorResponse()` 识别。

👉 **在根路由加上全局错误边界**

抛出的 404 需要有人接住。我们把它交给**根路由的 `ErrorBoundary`**——它是整个应用最外层的兜底。

```shellscript nonumber
touch src/routes/root-error.tsx
```

```tsx filename=src/routes/root-error.tsx
import { isRouteErrorResponse, useRouteError } from "react-router";

export default function RootError() {
  const error = useRouteError();

  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    // 这是我们在 loader 里 throw 的 Response（如 404）
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    // 这是意料之外的程序异常（仅开发环境展示堆栈）
    details = error.message;
    stack = error.stack;
  }

  return (
    <main id="error-page">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre>
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
```

👉 **把 `ErrorBoundary` 挂到根路由对象上**

```tsx filename=src/router.tsx
import Root from "./routes/root";
import RootError from "./routes/root-error";
// ...

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    ErrorBoundary: RootError, // ← 全局兜底错误边界
    children: [
      /* SidebarLayout、About... */
    ],
  },
]);
```

📌 **Data Mode 的错误边界**：Framework 版在 `root.tsx` 里 `export function ErrorBoundary({ error })`，错误通过 **props** 传入。Data Mode 把 `ErrorBoundary` 作为**路由对象的属性**，并在组件里用 **`useRouteError()`** 这个 hook 读取错误。功能一致，只是「文件导出 + props」变成了「路由配置 + hook」。

💡 **就近原则**：错误会冒泡到**最近的**错误边界。这里我们只在根部放了一个兜底边界；你也可以给某个子路由单独配 `ErrorBoundary`，让错误只在该区域内呈现（比如详情页出错时，侧边栏仍然可用）。

---

## 数据变更（Data Mutations）

我们马上就要创建第一个联系人了，但先聊聊 HTML。

React Router 把 **HTML 表单导航**作为数据变更的原语——在 JavaScript 大爆发之前，这曾是网页提交数据的唯一方式。别被它的简单骗了！React Router 里的表单，既有客户端应用级别的 UX，又保留了「老派 Web」模型的简单。

对有些开发者来说可能陌生：HTML `<form>` 其实和点击链接一样，会**触发一次浏览器导航**。区别只在请求本身——链接只能改 URL，而 `<form>` 还能改请求方法（`GET` vs `POST`）和请求体（`POST` 表单数据）。

在没有客户端路由时，浏览器会自动序列化 `<form>` 的数据：`POST` 放进请求体，`GET` 放进 [`URLSearchParams`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams)。React Router 做的是同样的事，只不过它**不把请求发给服务器**，而是用客户端路由把请求发给路由的 [`action`](https://reactrouter.com/start/data/actions) 函数。

我们可以点一下应用里的「New」按钮来验证。

📌 **Data Mode 里的「405」**：官方 Framework 版说「服务器上没有代码处理这个表单导航，于是返回 405」。Data Mode 是纯客户端的，没有服务器；此时 React Router 会在**客户端**抛出一个 405 语义的错误（「该路由没有 `action` 来处理 POST」），并被我们刚加的根 `ErrorBoundary` 捕获显示。原因是一样的：**目标路由还没有 `action`**。

---

## 创建联系人（Creating Contacts）

我们通过导出一个 `action` 函数来创建新联系人。当用户点击「New」按钮时，表单会 `POST` 到这个 action。

📌 **create action 放在哪个路由？** 官方 Framework 版把它放在 `root.tsx`。但在 Data Mode 里要遵守一条规则（来自官方 `<Form>` API 文档）：

> **`<Form>` 的 `action` 若未指定，默认提交到「渲染它的那个路由」（the closest route in context）。**

我们的「New」表单是由 **`SidebarLayout`** 渲染的，所以 `<Form method="post">`（不带 `action`）会提交到 **SidebarLayout 路由**。因此我们把 create `action` 挂在 SidebarLayout 上——效果与官方版一致，且接线路径明确、无需依赖任何「冒泡」假设。

👉 **在 `sidebar.tsx` 里导出 `action`**

```tsx filename=src/layouts/sidebar.tsx
import { Form, Link, Outlet, useLoaderData } from "react-router";

import { createEmptyContact, getContacts } from "../data";

export async function loader() {
  const contacts = await getContacts();
  return { contacts };
}

export async function action() {
  const contact = await createEmptyContact();
  return { contact };
}

// SidebarLayout 组件保持不变
```

👉 **把 `action` 挂到 SidebarLayout 路由对象上**

```tsx filename=src/router.tsx
import SidebarLayout, {
  loader as sidebarLoader,
  action as sidebarAction,
} from "./layouts/sidebar";
// ...

{
  Component: SidebarLayout,
  loader: sidebarLoader,
  action: sidebarAction, // ← 处理「New」按钮的 POST
  children: [
    { index: true, Component: Home },
    { path: "contacts/:contactId", Component: Contact, loader: contactLoader },
  ],
},
```

搞定！点一下「New」按钮，你应该会看到列表里冒出一条新记录 🥳。

`createEmptyContact` 只是创建一条**没有姓名、没有任何数据的空记录**——但它确实创建了一条记录，保证！

> 🧐 等一下……侧边栏是怎么自动更新的？我们在哪里调用了 `action`？重新拉数据的代码在哪？`useState`、`onSubmit`、`useEffect` 呢？！

这正是「老派 Web」编程模型显灵的地方。[`<Form>`](https://api.reactrouter.com/v8/variables/react_router.Form.html) 阻止了浏览器把请求发给服务器，转而用 [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/fetch) 把它发给你路由的 `action`。

在 Web 语义里，`POST` 通常意味着「有数据要变了」。按照约定，React Router 把它当作一个提示：**在 `action` 结束后，自动重新验证（revalidate）页面上的数据**。于是侧边栏的 `loader` 被自动重新调用，列表随之刷新。

事实上，因为这一切都只是 HTML 和 HTTP，即使你**禁用 JavaScript**，它依然能工作（在 Framework/SSR 场景下）：浏览器会自己序列化表单、发起文档请求，服务端渲染后返回。最终 UI 是一样的。不过我们当然会保留 JavaScript，因为我们要做出比「转圈的 favicon + 静态文档」好得多的体验。

---

## 更新数据（Updating Data）

来给新建的空记录填点信息吧。

和创建数据一样，更新数据也用 [`<Form>`](https://api.reactrouter.com/v8/variables/react_router.Form.html)。我们在 `src/routes/` 下新建一个编辑路由。

👉 **创建编辑联系人路由**

```shellscript nonumber
touch src/routes/edit-contact.tsx
```

👉 **在路由表里注册（作为 SidebarLayout 的子路由）**

```tsx filename=src/router.tsx
children: [
  { index: true, Component: Home },
  { path: "contacts/:contactId", Component: Contact, loader: contactLoader },
  {
    path: "contacts/:contactId/edit",
    Component: EditContact,
    loader: editLoader,
  },
],
```

👉 **填入编辑页 UI**

都是见过的东西，复制粘贴即可：

```tsx filename=src/routes/edit-contact.tsx
import { Form, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import invariant from "tiny-invariant";

import { getContact } from "../data";

export async function loader({ params }: LoaderFunctionArgs) {
  invariant(params.contactId, "Missing contactId param");
  const contact = await getContact(params.contactId);
  if (!contact) {
    throw new Response("Not Found", { status: 404 });
  }
  return { contact };
}

export default function EditContact() {
  const { contact } = useLoaderData<typeof loader>();

  return (
    <Form key={contact.id} id="contact-form" method="post">
      <p>
        <span>Name</span>
        <input
          aria-label="First name"
          defaultValue={contact.first}
          name="first"
          placeholder="First"
          type="text"
        />
        <input
          aria-label="Last name"
          defaultValue={contact.last}
          name="last"
          placeholder="Last"
          type="text"
        />
      </p>
      <label>
        <span>Twitter</span>
        <input
          defaultValue={contact.twitter}
          name="twitter"
          placeholder="@jack"
          type="text"
        />
      </label>
      <label>
        <span>Avatar URL</span>
        <input
          aria-label="Avatar URL"
          defaultValue={contact.avatar}
          name="avatar"
          placeholder="https://example.com/avatar.jpg"
          type="text"
        />
      </label>
      <label>
        <span>Notes</span>
        <textarea defaultValue={contact.notes} name="notes" rows={6} />
      </label>
      <p>
        <button type="submit">Save</button>
        <button type="button">Cancel</button>
      </p>
    </Form>
  );
}
```

现在点击你刚建的那条新记录，再点「Edit」按钮，就能看到编辑页了。

> 💡 注意 `<Form key={contact.id}>` 上的 `key`：当你在不同联系人之间切换编辑时，`key` 变化会让 React **重建这个表单**，从而用新联系人的数据重置所有 `defaultValue`。否则 React 会复用同一个表单 DOM，输入框里还留着上一个联系人的值。

---

## 用 `FormData` 更新联系人（Updating Contacts with FormData）

刚建的编辑路由已经渲染了一个 `<Form method="post">`。我们要做的只是**给它加上 `action`**。React Router 会序列化表单、用 `fetch` 以 `POST` 发出，并自动重新验证所有数据。

这个 `<Form method="post">` 没有指定 `action`，所以它提交到「渲染它的路由」——也就是编辑路由本身。因此 `action` 就加在 `edit-contact.tsx` 里。

👉 **给编辑路由加 `action`**

```tsx filename=src/routes/edit-contact.tsx
import { Form, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import invariant from "tiny-invariant";

import { getContact, updateContact } from "../data";

export async function action({ params, request }: ActionFunctionArgs) {
  invariant(params.contactId, "Missing contactId param");
  const formData = await request.formData();
  const updates = Object.fromEntries(formData);
  await updateContact(params.contactId, updates);
  return redirect(`/contacts/${params.contactId}`);
}

// loader 与组件保持不变
```

👉 **别忘了在路由表里挂上 `action`**

```tsx filename=src/router.tsx
{
  path: "contacts/:contactId/edit",
  Component: EditContact,
  loader: editLoader,
  action: editAction, // ← 处理保存
},
```

填好表单、点 Save，你就会看到更新后的联系人页面。

---

## 变更原理讨论（Mutation Discussion）

> 😑 它是能用了，但我完全不知道发生了什么……

我们深入看一下。

打开 `src/routes/edit-contact.tsx`，看看 `<Form>` 里的元素。注意每个输入框都有一个 `name`：

```tsx filename=src/routes/edit-contact.tsx
<input
  aria-label="First name"
  defaultValue={contact.first}
  name="first"
  placeholder="First"
  type="text"
/>
```

没有 JavaScript 时，表单提交后浏览器会创建 [`FormData`](https://developer.mozilla.org/en-US/docs/Web/API/FormData) 并把它作为请求体发给服务器。前面说过，React Router 会拦下这一步、模拟浏览器行为，改用 [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/fetch) 把带着 `FormData` 的请求发给你的 `action`。

表单里的每个字段都能用 `formData.get(name)` 取到。比如上面的输入框，可以这样拿到姓和名：

```tsx nocopy
export async function action({ params, request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const firstName = formData.get("first");
  const lastName = formData.get("last");
  // ...
}
```

因为字段有点多，我们用 [`Object.fromEntries`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/fromEntries) 把它们一次性收集成一个对象——这正好是 `updateContact` 想要的形状：

```tsx nocopy
const updates = Object.fromEntries(formData);
updates.first; // "Some"
updates.last; // "Name"
```

除了 `action` 函数本身，这里用到的 API **都不是 React Router 提供的**：[`request`](https://developer.mozilla.org/en-US/docs/Web/API/Request)、[`request.formData`](https://developer.mozilla.org/en-US/docs/Web/API/Request/formData)、`Object.fromEntries` 全都来自 **Web 平台标准**。这也是 React Router 的设计哲学：尽量用 Web 原生能力，而不是发明私有概念。

再看 `action` 结尾的 [`redirect`](https://api.reactrouter.com/v8/functions/react_router.redirect.html)：

```tsx nocopy
export async function action({ params, request }: ActionFunctionArgs) {
  invariant(params.contactId, "Missing contactId param");
  const formData = await request.formData();
  const updates = Object.fromEntries(formData);
  await updateContact(params.contactId, updates);
  return redirect(`/contacts/${params.contactId}`);
}
```

`action` 和 `loader` 都能返回一个 `Response`（很合理，毕竟它们收到的是一个 [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request)！）。`redirect` 这个辅助函数只是让「返回一个告诉应用『换个地址』的 [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response)」变得更简单。

没有客户端路由时，如果服务器在 `POST` 之后重定向，新页面会去拉最新数据再渲染。前面讲过，React Router 模拟了这个模型：在 `action` 调用后**自动重新验证页面上的数据**——这就是为什么保存表单后侧边栏会自动更新。没有客户端路由时不存在「额外的重新验证代码」，所以在 React Router 里也不需要！

最后一点：没有 JavaScript 时，`redirect` 是一次普通的服务端重定向；有了 JavaScript，它变成一次**客户端重定向**，因此用户不会丢失滚动位置、组件状态等客户端状态。

---

## 把新记录重定向到编辑页（Redirecting new records to the edit page）

既然学会了重定向，就把「创建联系人」的 action 改成**创建后直接跳到编辑页**：

👉 **重定向到新记录的编辑页**

```tsx filename=src/layouts/sidebar.tsx
export async function action() {
  const contact = await createEmptyContact();
  return redirect(`/contacts/${contact.id}/edit`);
}
```

记得把 `redirect` 加进 `react-router` 的导入：`import { Form, Link, Outlet, redirect, useLoaderData } from "react-router";`。现在点「New」，会直接落到这条新记录的编辑页——比「建一条空记录、再自己去列表里找它点开」体验好多了。

---

## 激活链接样式（Active Link Styling）

现在记录多起来了，光看侧边栏已经分不清「当前正在看哪一条」。用 [`NavLink`](https://api.reactrouter.com/v8/variables/react_router.NavLink.html) 就能解决。

👉 **把侧边栏里的 `<Link>` 换成 `<NavLink>`**

```tsx filename=src/layouts/sidebar.tsx
import { Form, Link, NavLink, Outlet, useLoaderData } from "react-router";

// loader / action 保持不变

export default function SidebarLayout() {
  const { contacts } = useLoaderData<typeof loader>();

  return (
    <>
      <div id="sidebar">
        {/* 其它元素 */}
        <nav>
          {contacts.length ? (
            <ul>
              {contacts.map((contact) => (
                <li key={contact.id}>
                  <NavLink
                    className={({ isActive, isPending }) =>
                      isActive ? "active" : isPending ? "pending" : ""
                    }
                    to={`contacts/${contact.id}`}
                  >
                    {contact.first || contact.last ? (
                      <>
                        {contact.first} {contact.last}
                      </>
                    ) : (
                      <i>No Name</i>
                    )}
                    {contact.favorite ? <span>★</span> : null}
                  </NavLink>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              <i>No contacts</i>
            </p>
          )}
        </nav>
      </div>
      <div id="detail">
        <Outlet />
      </div>
    </>
  );
}
```

注意我们给 `className` 传的是一个**函数**。当用户所在 URL 与 `<NavLink to>` 匹配时，`isActive` 为 `true`；当它**即将**激活（数据还在加载）时，`isPending` 为 `true`。这样我们既能标出「用户现在在哪」，又能在点击链接、数据还在加载时**立刻给出反馈**。

---

## 全局 Pending UI（Global Pending UI）

用户在应用里导航时，React Router 会**把旧页面继续留在屏幕上**，直到下一页的数据加载完成。你可能已经感觉到：在列表间点击时，应用有点「不跟手」。我们给用户一点反馈，让它不至于显得卡死。

React Router 在幕后管理着所有状态，并把你需要的那些暴露出来，用来构建动态 Web 应用。这里我们用 [`useNavigation`](https://api.reactrouter.com/v8/functions/react_router.useNavigation.html) 这个 hook。

👉 **用 `useNavigation` 添加全局 pending UI**

```tsx filename=src/layouts/sidebar.tsx
import {
  Form,
  Link,
  NavLink,
  Outlet,
  useLoaderData,
  useNavigation,
} from "react-router";

export default function SidebarLayout() {
  const { contacts } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  return (
    <>
      {/* 侧边栏 */}
      <div
        className={navigation.state === "loading" ? "loading" : ""}
        id="detail"
      >
        <Outlet />
      </div>
    </>
  );
}
```

`useNavigation` 返回当前的导航状态，`navigation.state` 是 `"idle"`、`"loading"`、`"submitting"` 三者之一。

这里我们在非 idle 时给主区域加一个 `"loading"` 类，CSS 会在短暂延迟后做一个柔和的淡出（延迟是为了避免快速加载时 UI 闪烁）。你当然也可以换成任何你想要的效果，比如顶部进度条或转圈图标。

💡 **`navigation` 对象里还有更多可用信息**：`navigation.location`（正在去往的位置）、`navigation.formData`（正在提交的表单数据）等，后面做搜索转圈和乐观 UI 时会用到。

---

## 删除记录（Deleting Records）

回头看联系人路由里的删除按钮：

```tsx filename=src/routes/contact.tsx
<Form
  action="destroy"
  method="post"
  onSubmit={(event) => {
    const response = confirm("Please confirm you want to delete this record.");
    if (!response) {
      event.preventDefault();
    }
  }}
>
  <button type="submit">Delete</button>
</Form>
```

注意 `action` 指向 `"destroy"`。和 `<Link to>` 一样，`<Form action>` 也可以是一个**相对值**。由于这个表单渲染在 `contacts/:contactId` 路由里，相对的 `destroy` 在点击时会把表单提交到 `contacts/:contactId/destroy`。

到这里，让删除按钮工作所需的知识你都已经掌握了。不妨在往下看之前先自己试试？你需要：

1. 一个新路由（`contacts/:contactId/destroy`）
2. 该路由上的一个 `action`
3. `data.ts` 里的 `deleteContact`
4. 之后 `redirect` 到某处

👉 **创建 destroy 路由**

```shellscript nonumber
touch src/routes/destroy-contact.tsx
```

这个路由**只有 action、没有组件**——它从来不负责渲染 UI，只负责「处理删除并重定向」。Data Mode 允许路由对象只有 `action`。

```tsx filename=src/routes/destroy-contact.tsx
import { redirect } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import invariant from "tiny-invariant";

import { deleteContact } from "../data";

export async function action({ params }: ActionFunctionArgs) {
  invariant(params.contactId, "Missing contactId param");
  await deleteContact(params.contactId);
  return redirect("/");
}
```

👉 **在路由表里注册（SidebarLayout 的子路由）**

```tsx filename=src/router.tsx
import { action as destroyAction } from "./routes/destroy-contact";

// SidebarLayout.children 里追加：
{ path: "contacts/:contactId/destroy", action: destroyAction },
```

现在打开某条记录、点「Delete」按钮——它工作了！

> 😅 我还是没搞懂为什么这一切能跑通

当用户点击提交按钮时：

1. `<Form>` 阻止浏览器默认的「发一个文档 `POST` 请求给服务器」行为，改为用客户端路由 + [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/fetch) 模拟浏览器发出一个 `POST`。
2. `<Form action="destroy">` 相对解析后匹配到新路由 `contacts/:contactId/destroy`，把请求发给它。
3. 该路由的 `action` 执行删除并 `redirect("/")`；重定向后，React Router 调用页面上所有相关的 `loader` 去拿最新数据（这就是「revalidation」）。侧边栏的联系人列表因此刷新，被删的记录消失了。

加一个 `<Form>`、加一个 `action`，剩下的 React Router 都替你做了。

---

## 取消按钮（Cancel Button）

编辑页上有个「Cancel」按钮，目前还没行为。我们希望它像浏览器的「后退」按钮一样工作。

这需要给按钮加一个点击处理器，并用到 [`useNavigate`](https://api.reactrouter.com/v8/functions/react_router.useNavigate.html)。

👉 **用 `useNavigate` 实现取消按钮**

```tsx filename=src/routes/edit-contact.tsx
import { Form, redirect, useLoaderData, useNavigate } from "react-router";

// loader / action 保持不变

export default function EditContact() {
  const { contact } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <Form key={contact.id} id="contact-form" method="post">
      {/* 各个输入框 */}
      <p>
        <button type="submit">Save</button>
        <button onClick={() => navigate(-1)} type="button">
          Cancel
        </button>
      </p>
    </Form>
  );
}
```

现在用户点「Cancel」，就会后退一条浏览器历史记录。

> 🧐 为什么按钮上没有 `event.preventDefault()`？

因为 `<button type="button">` 本身就是 HTML 里「让这个按钮不提交所在表单」的标准做法（表单里默认的 `type` 是 `submit`，所以显式写 `type="button"` 很关键）。`navigate(-1)` 只做后退，不涉及表单提交，无需 `preventDefault`。

---

## `URLSearchParams` 与 `GET` 提交

到目前为止，我们所有的交互 UI 要么是「改变 URL 的链接」，要么是「把数据 POST 给 action 的表单」。搜索框很特别，它**两者的味道都有一点**：它是一个 `<form>`，但它只改变 URL，并不改动数据。

看看提交搜索表单时会发生什么：

👉 **在搜索框里输入一个名字，然后按回车**

注意浏览器地址栏现在把你的查询词以 [`URLSearchParams`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams) 的形式放进了 URL：

```
http://localhost:5173/?q=ryan
```

因为它不是 `<Form method="post">`（默认是 `GET`），React Router 模拟浏览器行为，把 [`FormData`](https://developer.mozilla.org/en-US/docs/Web/API/FormData) 序列化进 `URLSearchParams`，而不是请求体。

`loader` 能从 `request` 里拿到这些 search params。我们用它来过滤列表：

👉 **当有 `URLSearchParams` 时过滤列表**

```tsx filename=src/layouts/sidebar.tsx
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const contacts = await getContacts(q);
  return { contacts };
}
```

因为这是 `GET` 而非 `POST`，React Router **不会**调用 `action`。提交一个 `GET` 表单和点击一个链接是一回事：**只有 URL 变了**。

这也意味着它是一次普通的页面导航——你可以点浏览器「后退」回到之前的状态。

💡 **把状态放进 URL 的好处**：搜索结果现在是**可分享、可前进后退、可刷新**的。把 `?q=ryan` 这样的筛选条件放进 URL，而不是塞进组件的 `useState`，是 Data Mode（乃至整个 React Router）最推崇的状态归属原则之一。

---

## 让 URL 与表单状态同步（Synchronizing URLs to Form State）

这里有两个可以很快解决掉的 UX 问题：

1. 搜索之后点「后退」，输入框里还留着你输入的值，但列表已经不再过滤了。
2. 搜索之后刷新页面，输入框里的值没了，但列表却是过滤后的。

换句话说，**URL 和输入框的状态不同步了**。

我们先解决 (2)：让输入框以 URL 里的值作为初始值。

👉 **从 `loader` 返回 `q`，并把它设为输入框的默认值**

```tsx filename=src/layouts/sidebar.tsx
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const contacts = await getContacts(q);
  return { contacts, q }; // ← 把 q 也返回出去
}

export default function SidebarLayout() {
  const { contacts, q } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  return (
    <>
      <div id="sidebar">
        {/* 其它元素 */}
        <div>
          <Form id="search-form" role="search">
            <input
              aria-label="Search contacts"
              defaultValue={q || ""}
              id="q"
              name="q"
              placeholder="Search"
              type="search"
            />
            <div aria-hidden hidden={true} id="search-spinner" />
          </Form>
          {/* New 按钮表单 */}
        </div>
        {/* 联系人列表 */}
      </div>
      {/* #detail + Outlet */}
    </>
  );
}
```

现在搜索后刷新页面，输入框会显示查询词了。

接着解决问题 (1)：点「后退」时更新输入框。我们用 React 的 `useEffect` 直接操作 DOM 里输入框的值。

👉 **让输入框的值与 `URLSearchParams` 同步**

```tsx filename=src/layouts/sidebar.tsx
import { useEffect } from "react";

export default function SidebarLayout() {
  const { contacts, q } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  useEffect(() => {
    const searchField = document.getElementById("q");
    if (searchField instanceof HTMLInputElement) {
      searchField.value = q || "";
    }
  }, [q]);

  // 其余代码不变
}
```

> 🤔 这里不该用受控组件 + React State 吗？

当然可以做成受控组件，只是那样你会有**更多的同步点**（既要同步 URL→state，又要同步 state→输入）。用不用由你决定。下面给出受控写法供参考：

<details>
<summary>展开查看受控组件写法</summary>

```tsx filename=src/layouts/sidebar.tsx
import { useEffect, useState } from "react";

export default function SidebarLayout() {
  const { contacts, q } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  // 查询词现在需要保存在 state 里
  const [query, setQuery] = useState(q || "");

  // 仍然需要 useEffect，在前进/后退时把 URL 的 q 同步进 state
  useEffect(() => {
    setQuery(q || "");
  }, [q]);

  return (
    <>
      <div id="sidebar">
        {/* 其它元素 */}
        <Form id="search-form" role="search">
          <input
            aria-label="Search contacts"
            id="q"
            name="q"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search"
            type="search"
            value={query} // ← 从 defaultValue 换成 value
          />
          {/* 其它元素 */}
        </Form>
        {/* 其它元素 */}
      </div>
      {/* 其它元素 */}
    </>
  );
}
```

</details>

好了，现在点「后退 / 前进 / 刷新」，输入框的值都应该和 URL、结果列表保持一致了。

---

## 在 `onChange` 时提交表单（Submitting Form's onChange）

这里有个产品决策：有时你希望用户**主动提交表单**才过滤结果，有时你希望**边输入边过滤**。前者我们已经实现了，来看看后者怎么做。

我们已经见过 `useNavigate`，这里用它的「表亲」——[`useSubmit`](https://api.reactrouter.com/v8/functions/react_router.useSubmit.html)。

```tsx filename=src/layouts/sidebar.tsx
import {
  Form,
  Link,
  NavLink,
  Outlet,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";

export default function SidebarLayout() {
  const { contacts, q } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submit = useSubmit();

  // useEffect 同步逻辑保持不变

  return (
    <>
      <div id="sidebar">
        {/* 其它元素 */}
        <div>
          <Form
            id="search-form"
            onChange={(event) => submit(event.currentTarget)}
            role="search"
          >
            {/* 输入框 + spinner */}
          </Form>
          {/* New 按钮表单 */}
        </div>
        {/* 联系人列表 */}
      </div>
      {/* #detail + Outlet */}
    </>
  );
}
```

现在你一边输入，表单就一边自动提交了！

注意传给 `submit` 的参数：`submit` 会序列化并提交你传给它的任意表单。我们传的是 `event.currentTarget`——即事件绑定到的那个 DOM 节点（也就是 `<form>` 本身）。

---

## 添加搜索转圈（Adding Search Spinner）

在真实应用里，这个搜索多半是要去一个「大到没法一次性全发给前端过滤」的数据库里查记录。所以这个 demo 故意加了假的网络延迟（还记得 `data.ts` 里 `getContacts` 的 500ms 吗）。

没有任何加载指示时，搜索会显得很迟钝。即便我们能让数据库更快，用户的网络延迟也始终存在、且不受我们控制。

为了更好的体验，我们给搜索加一点即时的 UI 反馈——再次请出 `useNavigation`。

👉 **加一个变量，判断「是否正在搜索」**

```tsx filename=src/layouts/sidebar.tsx
export default function SidebarLayout() {
  const { contacts, q } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const searching =
    navigation.location &&
    new URLSearchParams(navigation.location.search).has("q");

  // 其余代码不变
}
```

当什么都没发生时，`navigation.location` 是 `undefined`；当用户导航时，它会在数据加载期间被填上「下一个位置」。我们再用 `location.search` 判断这次导航是不是一次搜索。

👉 **用新的 `searching` 状态给搜索表单元素加类名**

```tsx filename=src/layouts/sidebar.tsx
<Form
  id="search-form"
  onChange={(event) => submit(event.currentTarget)}
  role="search"
>
  <input
    aria-label="Search contacts"
    className={searching ? "loading" : ""}
    defaultValue={q || ""}
    id="q"
    name="q"
    placeholder="Search"
    type="search"
  />
  <div aria-hidden hidden={!searching} id="search-spinner" />
</Form>
```

加分项：搜索时**不要**让主区域也淡出（否则每敲一个字整屏都在闪）：

```tsx filename=src/layouts/sidebar.tsx
<div
  className={navigation.state === "loading" && !searching ? "loading" : ""}
  id="detail"
>
  <Outlet />
</div>
```

现在搜索框左侧应该有一个漂亮的转圈指示了。

---

## 管理历史栈（Managing the History Stack）

由于每次按键都会提交表单，输入 "alex" 再逐字退格，会在浏览器历史里塞进一大堆记录 😂。我们显然不想要这样。

解决办法是：用**替换（replace）**当前历史记录，而不是往里 push 新记录。

👉 **在 `submit` 里使用 `replace`**

```tsx filename=src/layouts/sidebar.tsx
<Form
  id="search-form"
  onChange={(event) => {
    const isFirstSearch = q === null;
    submit(event.currentTarget, {
      replace: !isFirstSearch,
    });
  }}
  role="search"
>
  {/* 输入框 + spinner */}
</Form>
```

先快速判断这是不是「第一次搜索」，再决定是否替换。这样第一次搜索会新增一条历史记录，之后的每次按键都只是替换当前记录。用户想退出搜索时，只需点一次「后退」，而不是七次。

---

## 不导航的表单（Forms Without Navigation）

到目前为止，我们所有的表单都会改变 URL。这类流程很常见，但同样常见的需求是：**提交表单但不引发导航**。

为此我们有 [`useFetcher`](https://api.reactrouter.com/v8/functions/react_router.useFetcher.html)。它让我们能与 `action`/`loader` 通信，却**不触发导航**。

联系人页上的 ★（收藏）按钮就很适合用它：我们既不是在创建、也不是在删除记录，更不想切换页面——只想改变当前页面上的一点数据。

👉 **把 `<Favorite>` 的表单改成 fetcher 表单**

```tsx filename=src/routes/contact.tsx
import { Form, useFetcher, useLoaderData } from "react-router";

// loader 保持不变

function Favorite({ contact }: { contact: Pick<ContactRecord, "favorite"> }) {
  const fetcher = useFetcher();
  const favorite = contact.favorite;

  return (
    <fetcher.Form method="post">
      <button
        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
        name="favorite"
        value={favorite ? "false" : "true"}
      >
        {favorite ? "★" : "☆"}
      </button>
    </fetcher.Form>
  );
}
```

这个表单不再引发导航，只是简单地「fetch」到 `action`。说到这个……在我们创建 `action` 之前它还不能用。

👉 **在联系人路由上创建 `action`（收藏切换）**

```tsx filename=src/routes/contact.tsx
import { Form, useFetcher, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import invariant from "tiny-invariant";

import { getContact, updateContact } from "../data";

export async function action({ params, request }: ActionFunctionArgs) {
  invariant(params.contactId, "Missing contactId param");
  const formData = await request.formData();
  return updateContact(params.contactId, {
    favorite: formData.get("favorite") === "true",
  });
}

// loader 与组件保持不变
```

👉 **在路由表里挂上这个 action**

```tsx filename=src/router.tsx
import Contact, {
  loader as contactLoader,
  action as favoriteAction,
} from "./routes/contact";

// SidebarLayout.children 里：
{
  path: "contacts/:contactId",
  Component: Contact,
  loader: contactLoader,
  action: favoriteAction,
},
```

`<fetcher.Form method="post">` 由联系人页渲染，所以它的「closest route」就是联系人路由本身，收藏 action 自然挂在这里。

好了，现在可以去点用户名旁边的星星了！你会发现**两处星星（标题旁的和侧边栏里的）会自动同步更新**。因为 `<fetcher.Form method="post">` 的运作几乎和我们一直用的 `<Form>` 一模一样：它调用 `action`，然后所有数据被自动重新验证——连错误的捕获方式都一致。

只有**一个关键区别**：它不是导航，所以 **URL 不变、历史栈也不受影响**。

---

## 乐观 UI（Optimistic UI）

你可能注意到，上一节点收藏按钮时，应用有点「不跟手」——同样，我们加了网络延迟，因为真实世界里你一定会有延迟。

为了给用户反馈，我们本可以用 `fetcher.state` 把星星做成加载态（很像之前的 `navigation.state`），但这次我们能做得更漂亮：用一种叫**「乐观 UI（Optimistic UI）」**的策略。

fetcher 知道即将提交给 `action` 的 [`FormData`](https://developer.mozilla.org/en-US/docs/Web/API/FormData)，它就挂在 `fetcher.formData` 上。我们用它来**立即**更新星星的状态，哪怕网络请求还没回来。如果这次更新最终失败了，UI 会自动回退到真实数据。

👉 **从 `fetcher.formData` 读取「乐观值」**

```tsx filename=src/routes/contact.tsx
function Favorite({ contact }: { contact: Pick<ContactRecord, "favorite"> }) {
  const fetcher = useFetcher();
  const favorite = fetcher.formData
    ? fetcher.formData.get("favorite") === "true"
    : contact.favorite;

  return (
    <fetcher.Form method="post">
      <button
        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
        name="favorite"
        value={favorite ? "false" : "true"}
      >
        {favorite ? "★" : "☆"}
      </button>
    </fetcher.Form>
  );
}
```

现在点击星星时，它会**立即**变成新状态——先给用户「已经成功了」的确定感，真实的网络结果随后到达再校准。

💡 **乐观 UI 的本质**：用「你即将提交的数据」先渲染出「预期结果」，把网络延迟从用户的感知里藏起来。`fetcher.formData` 让这件事异常简单，因为提交中的数据 React Router 已经帮你拿在手里了。

---

## 完整路由表回顾

跟到这里，整个应用已经完成。下面是最终的 `src/router.tsx`——**它是这个应用所有页面层级、URL、数据加载/提交、错误边界与布局关系的「一张地图」**，值得回头对照每一章看一遍：

```tsx filename=src/router.tsx
import { createBrowserRouter } from "react-router";

import Root from "./routes/root";
import RootError from "./routes/root-error";
import SidebarLayout, {
  loader as sidebarLoader,
  action as sidebarAction,
} from "./layouts/sidebar";
import Home from "./routes/home";
import About from "./routes/about";
import Contact, {
  loader as contactLoader,
  action as favoriteAction,
} from "./routes/contact";
import EditContact, {
  loader as editLoader,
  action as editAction,
} from "./routes/edit-contact";
import { action as destroyAction } from "./routes/destroy-contact";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root, // 只渲染 <Outlet/>
    ErrorBoundary: RootError, // 全局兜底错误边界（接住 404 等）
    children: [
      {
        // 无 path 的布局路由：侧边栏 UI + 联系人数据 + 新建 action
        Component: SidebarLayout,
        loader: sidebarLoader, // 读 ?q= 过滤联系人
        action: sidebarAction, // 处理「New」→ 创建并重定向到编辑页
        children: [
          { index: true, Component: Home }, // "/" 默认页
          {
            path: "contacts/:contactId",
            Component: Contact,
            loader: contactLoader, // 按 id 取联系人，找不到 throw 404
            action: favoriteAction, // fetcher 收藏切换（不改 URL）
          },
          {
            path: "contacts/:contactId/edit",
            Component: EditContact,
            loader: editLoader, // 回填表单
            action: editAction, // 保存 FormData 后 redirect 回详情页
          },
          {
            path: "contacts/:contactId/destroy",
            action: destroyAction, // 只有 action、没有组件
          },
        ],
      },
      { path: "about", Component: About }, // 不在侧边栏布局内，也不加载联系人数据
    ],
  },
]);
```

对照一下，每个能力落在哪：

- **页面层级** = `children` 嵌套 + `<Outlet/>`（根路由 → 布局路由 → 页面）
- **URL** = `path` / `index` / `:contactId` / `?q=` 查询参数
- **加载数据** = 各路由 `loader` + `useLoaderData<typeof loader>()`
- **提交数据** = 各路由 `action` + `<Form>` / `useSubmit` / `<fetcher.Form>`
- **导航状态** = `useNavigation`（全局 pending、搜索转圈）
- **无导航提交 + 乐观 UI** = `useFetcher` + `fetcher.formData`
- **错误处理** = 根路由 `ErrorBoundary` + `useRouteError` + `throw new Response(..., {status:404})`
- **可分享状态** = 搜索词进 URL（`URLSearchParams`）+ `replace` 管理历史栈

---

## 部署到静态服务器：SPA fallback（务必配置）

⚠️ **这是 Data Mode 部署最容易踩的坑。** `createBrowserRouter` 用浏览器 History API，URL 长这样：`/contacts/1`、`/about`。开发时 Vite 的 dev server 会自动把所有路径回退到 `index.html`，所以你**本地永远碰不到这个问题**；但一旦部署到静态服务器，用户**直接访问或刷新深层 URL**（如 `/contacts/1`）时，服务器会去找名为 `contacts/1` 的文件——找不到，返回 404。

**解决办法**：让服务器把所有「未命中静态文件」的路径都回退到 `index.html`，由 React Router 在客户端接管路由。

- **Nginx**：`try_files $uri $uri/ /index.html;`
- **Vercel**：加 `rewrites`，把 `/(.*)` 重写到 `/index.html`。
- **Netlify**：`_redirects` 文件里写 `/*  /index.html  200`。
- **GitHub Pages**（纯静态、且部署在子路径）：需要给路由器加 `basename`：`createBrowserRouter(routes, { basename: "/repo-name" })`。

---

## 结语

就这样！感谢你跟着把 React Router 走了一遍。希望这个教程能给你打下扎实的基础，去构建出色的用户体验。

React Router 能做的远不止这些——`<Await>` 流式数据、`handle` + `useMatches` 做面包屑、`useBlocker` 拦截未保存的离开、`middleware`（v8 新增）收敛横切逻辑等等，都值得进一步探索。请务必翻一翻完整的 [React Router API 文档](https://api.reactrouter.com/v8/modules/react_router.html) 😀

### 本文相对官方 Framework 版，到底改了什么（速查）

- ✅ **脚手架**：`create-react-router` → Vite `react-ts` + `npm i react-router`。
- ✅ **路由配置**：`app/routes.ts`（文件约定）→ `createBrowserRouter([...])`（路由对象数组）。
- ✅ **HTML 外壳**：`root.tsx` 的 `Layout`/`<Scripts>` → Vite `index.html` + `main.tsx` 的 `<RouterProvider>`。
- ✅ **数据加载**：`clientLoader`/`loader` 二选一 → 统一 `loader`（SPA 中在浏览器运行）。
- ✅ **数据读取**：`{ loaderData }: Route.ComponentProps` → `useLoaderData<typeof loader>()`。
- ✅ **参数类型**：`Route.LoaderArgs`/`Route.ActionArgs` → `LoaderFunctionArgs`/`ActionFunctionArgs` + `invariant` 收窄 params。
- ✅ **错误边界**：`export function ErrorBoundary({error})` → 路由对象 `ErrorBoundary` + `useRouteError()`。
- ✅ **create action 位置**：root → **SidebarLayout**（因为 `<Form>` 无 `action` 时提交到「渲染它的路由」）。
- ⏭️ **跳过**：`HydrateFallback`、`prerender`、`ssr`（Framework 专属，Data Mode 是纯客户端 SPA）。
- 🟰 **完全一致**：`Form`、`Link`、`NavLink`、`Outlet`、`redirect`、`useNavigation`、`useSubmit`、`useFetcher`、`useNavigate`、乐观 UI、revalidation 语义。

---

> 想更系统地学 Data Mode（含 loader/action 单元测试、`lazy` 代码拆分、错误分类、URL 状态管理等），欢迎阅读本仓库的 [**React Router 从 0 到 1 新手教程（Data Mode 实战）**](../3.react-router-tutorial/README.md)——那是一套 10 章的完整课程，配套可运行的 Concert Hub 示例工程。
