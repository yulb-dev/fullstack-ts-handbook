import { createAuthClient } from "better-auth/client";

// 这里只包含公开地址；不要导入服务端 auth 或数据库。
const API = "http://localhost:4000";
const authClient = createAuthClient({
  baseURL: API,
  fetchOptions: { credentials: "include" },
});
const element = (id: string) => document.getElementById(id)!;
const show = (value: string) => {
  element("message").textContent = value;
};
const workspaceId = () =>
  (element("workspace-id") as HTMLInputElement).value.trim();
const taskPath = () =>
  `/api/workspaces/${encodeURIComponent(workspaceId())}/tasks`;

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    credentials: "include",
    ...(method === "GET"
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        }),
  });
  if (!response.ok) {
    if (response.status === 401) clearPrivateData();
    throw new Error(`请求被拒绝（HTTP ${response.status}）`);
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}
function clearPrivateData() {
  element("identity").textContent = "未登录";
  element("workspace-list").textContent = "";
  element("task-list").replaceChildren();
  (element("workspace-id") as HTMLInputElement).value = "";
}
async function run(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    show(error instanceof Error ? error.message : "网络失败");
  }
}
function button(id: string, action: () => Promise<void>) {
  element(id).addEventListener("click", () => {
    void run(action);
  });
}
function form(id: string, action: (data: FormData) => Promise<void>) {
  const node = element(id) as HTMLFormElement;
  node.addEventListener("submit", (event) => {
    event.preventDefault();
    const submit = node.querySelector("button")!;
    if (submit.disabled) return;
    submit.disabled = true;
    void run(async () => {
      try {
        await action(new FormData(node));
      } finally {
        node
          .querySelectorAll<HTMLInputElement>('input[type="password"]')
          .forEach((i) => {
            i.value = "";
          });
      }
    }).finally(() => {
      submit.disabled = false;
    });
  });
}
const field = (data: FormData, key: string) => String(data.get(key) ?? "");
async function me() {
  element("identity").textContent = JSON.stringify(
    await api("/api/me"),
    null,
    2,
  );
}
form("signup", async (data) => {
  const result = await authClient.signUp.email({
    name: field(data, "name"),
    email: field(data, "email"),
    password: field(data, "password"),
    callbackURL: location.origin,
  });
  if (result.error) throw new Error("注册未完成，请检查输入或稍后重试");
  show("如果该邮箱可以注册，请查看验证邮件；本地模式在 API 终端预览。");
});
form("signin", async (data) => {
  clearPrivateData();
  const result = await authClient.signIn.email({
    email: field(data, "email"),
    password: field(data, "password"),
  });
  if (result.error)
    throw new Error(
      result.error.status === 403
        ? "请先验证邮箱"
        : "邮箱或密码不正确，或请求过于频繁",
    );
  await me();
  show("登录成功。身份不等于 workspace 权限。");
});
button("github", async () => {
  const result = await authClient.signIn.social({
    provider: "github",
    callbackURL: location.origin,
  });
  if (result.error) throw new Error("GitHub 登录未完成，请检查配置");
});
button("signout", async () => {
  const result = await authClient.signOut();
  if (result.error) throw new Error("退出失败，请重试");
  clearPrivateData();
  show("当前会话已撤销。");
});
button("revoke", async () => {
  const result = await authClient.revokeOtherSessions();
  if (result.error) throw new Error("撤销失败");
  show("其他会话已撤销。");
});
button("me", me);
form("forgot", async (data) => {
  const result = await authClient.requestPasswordReset({
    email: field(data, "email"),
    redirectTo: location.origin,
  });
  if (result.error) throw new Error("请求未完成，请稍后重试");
  show("如果账号存在且支持密码登录，将收到重置邮件。");
});
form("reset", async (data) => {
  const token = new URL(location.href).searchParams.get("token");
  if (!token) throw new Error("请先打开邮件中的有效重置链接");
  const result = await authClient.resetPassword({
    token,
    newPassword: field(data, "password"),
  });
  if (result.error) throw new Error("链接已失效或密码不符合要求");
  history.replaceState(null, "", location.pathname);
  clearPrivateData();
  show("密码已更新，旧会话已撤销，请重新登录。");
});
form("workspace", async (data) => {
  const workspace = await api<{ id: string }>("/api/workspaces", "POST", {
    name: field(data, "name"),
  });
  (element("workspace-id") as HTMLInputElement).value = workspace.id;
  show("已创建 workspace，你是它的 owner。");
});
button("workspaces", async () => {
  element("workspace-list").textContent = JSON.stringify(
    await api("/api/workspaces"),
    null,
    2,
  );
});
form("member", async (data) => {
  await api(
    `/api/workspaces/${encodeURIComponent(workspaceId())}/members`,
    "POST",
    { userId: field(data, "userId"), role: field(data, "role") },
  );
  show("成员已添加。这是已有用户 ID 的教学入口，不是邮件邀请。");
});
form("task", async (data) => {
  await api(taskPath(), "POST", { title: field(data, "title") });
  await loadTasks();
});
async function loadTasks() {
  const list =
    await api<
      { id: string; title: string; done: boolean; createdBy: string }[]
    >(taskPath());
  element("task-list").replaceChildren();
  for (const task of list) {
    const row = document.createElement("p");
    row.textContent = `${task.done ? "已完成" : "未完成"}：${task.title}（创建者 ${task.createdBy}）`;
    for (const [label, method] of [
      ["切换完成状态", "PATCH"],
      ["删除", "DELETE"],
    ] as const) {
      const node = document.createElement("button");
      node.textContent = label;
      node.addEventListener("click", () => {
        void run(async () => {
          await api(
            `${taskPath()}/${task.id}`,
            method,
            method === "PATCH" ? { done: !task.done } : {},
          );
          await loadTasks();
        });
      });
      row.append(node);
    }
    element("task-list").append(row);
  }
}
button("tasks", loadTasks);
void run(me);
