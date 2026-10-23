import { ErrorBanner } from "./components/ErrorBanner";
import { LoginForm } from "./features/auth/LoginForm";
import { useLogout, useSession } from "./features/auth/session";
import { CreateTaskForm } from "./features/tasks/CreateTaskForm";
import { TaskList } from "./features/tasks/TaskList";
import { useProjects } from "./features/tasks/api";

function Workspace() {
  const projects = useProjects();
  if (projects.isPending) return <p>加载项目…</p>;
  if (projects.isError)
    return (
      <ErrorBanner error={projects.error} onRetry={() => projects.refetch()} />
    );

  const project = projects.data.items[0];
  if (!project) return <p>你还没有加入任何项目。</p>;

  // 前端按角色隐藏表单只是体验优化；真正的权限判断在服务端（第 9 章）
  const canWrite = project.myRole !== "viewer";
  return (
    <>
      <h2>{project.name}</h2>
      {canWrite ? (
        <CreateTaskForm projectId={project.id} />
      ) : (
        <p className="hint">你是只读成员，不能创建任务。</p>
      )}
      <TaskList projectId={project.id} canWrite={canWrite} />
    </>
  );
}

export function App() {
  const session = useSession();
  const logout = useLogout();

  if (session.isPending) return <p>加载中…</p>;
  if (session.isError)
    return (
      <ErrorBanner error={session.error} onRetry={() => session.refetch()} />
    );
  if (!session.data) return <LoginForm />;

  return (
    <main>
      <header>
        <span>你好，{session.data.user.displayName}</span>
        <button type="button" onClick={() => logout.mutate()}>
          退出
        </button>
      </header>
      <Workspace />
    </main>
  );
}
