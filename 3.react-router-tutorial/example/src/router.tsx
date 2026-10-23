import { createBrowserRouter } from "react-router";

import Root from "./routes/root";
import RootErrorBoundary from "./routes/root-error";
import NotFound from "./routes/not-found";

import Home, { loader as homeLoader } from "./routes/home";
import About from "./routes/about";
import Login, { action as loginAction } from "./routes/login";

import ConcertsLayout, { loader as concertsLayoutLoader } from "./routes/concerts/layout";
import ConcertsCity, { loader as cityLoader } from "./routes/concerts/city";
import ConcertDetail, {
  loader as detailLoader,
  action as favoriteAction,
} from "./routes/concerts/detail";
import NewConcert, { action as newAction } from "./routes/concerts/new";
import EditConcert, {
  loader as editLoader,
  action as editAction,
} from "./routes/concerts/edit";

// 整个应用的「路由地图」：页面层级、URL、loader/action、错误边界、lazy 全在这里。
export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    ErrorBoundary: RootErrorBoundary, // 第 6 章：根兜底错误边界
    children: [
      { index: true, Component: Home, loader: homeLoader },
      { path: "about", Component: About },
      { path: "login", Component: Login, action: loginAction },

      {
        path: "concerts",
        Component: ConcertsLayout, // 第 2 章：区块布局
        loader: concertsLayoutLoader,
        children: [
          { index: true, Component: ConcertsCity, loader: cityLoader },
          { path: ":city", Component: ConcertsCity, loader: cityLoader }, // 第 3、7 章
          { path: "new", Component: NewConcert, action: newAction }, // 第 4 章
          {
            path: ":city/:concertId",
            Component: ConcertDetail,
            loader: detailLoader, // 第 3、6 章：找不到 throw 404
            action: favoriteAction, // 第 5 章：fetcher 收藏
          },
          {
            path: ":city/:concertId/edit",
            Component: EditConcert,
            loader: editLoader,
            action: editAction,
          },
        ],
      },

      {
        // 第 6 章权限 + 第 8 章 lazy：受保护且重型的后台报表，按需加载
        path: "admin/report",
        lazy: async () => {
          const mod = await import("./routes/admin/report");
          return { Component: mod.default, loader: mod.loader };
        },
      },

      { path: "*", Component: NotFound }, // 第 2、6 章：URL 未匹配兜底
    ],
  },
]);
