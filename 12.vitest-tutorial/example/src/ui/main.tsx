import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TaskPage } from "@/ui/task-page.js";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

createRoot(container).render(
  <StrictMode>
    <TaskPage />
  </StrictMode>,
);
