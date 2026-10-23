import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { TaskForm } from "@/ui/task-form.js";
import { useCreateTask } from "@/ui/use-create-task.js";
import { useDraftStore } from "@/ui/draft-store.js";

function CreateTaskPanel() {
  const mutation = useCreateTask();
  const draftTitle = useDraftStore((s) => s.draftTitle);
  const setDraftTitle = useDraftStore((s) => s.setDraftTitle);

  return (
    <section>
      <h2>新建任务</h2>
      <TaskForm
        onSubmit={async (values) => {
          await mutation.mutateAsync(values);
          setDraftTitle(values.title);
        }}
      />
      {mutation.isSuccess && (
        <p role="status">已创建：{draftTitle || "新任务"}</p>
      )}
    </section>
  );
}

/** 页面组装：QueryClient 在这里创建一次，通过 Provider 注入整棵树 */
export function TaskPage() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <main>
        <h1>TaskDesk Lite</h1>
        <CreateTaskPanel />
      </main>
    </QueryClientProvider>
  );
}
