import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { sessionKey } from "./features/auth/session";
import { ApiContext, createBrowserApi, csrf } from "./lib/api";
import { createQueryClient } from "./lib/query-client";
import "./styles.css";

const api = createBrowserApi();
const queryClient = createQueryClient({
  onUnauthenticated: () => {
    // 会话失效：清空所有服务端缓存，回到登录页
    csrf.set(null);
    queryClient.clear();
    queryClient.setQueryData(sessionKey, null);
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <ApiContext.Provider value={api}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ApiContext.Provider>
  </StrictMode>,
);
