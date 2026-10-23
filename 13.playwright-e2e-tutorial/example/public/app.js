// TaskBoard lite 前端逻辑：无框架、无构建，原生 ESM。
// 状态集中保存在 `state`，每次数据变化后整体重渲染任务区。
const $ = (id) => document.getElementById(id);

const STATUS_LABEL = { todo: '待办', doing: '进行中', done: '已完成' };

const state = {
  user: null,
  workspaces: [],
  workspaceId: null,
  status: 'all',
  q: '',
  page: 1,
  totalPages: 1,
  total: 0,
  tasks: [],
  loading: false,
  error: null,
  errorKind: null, // 'load'（列表加载失败，可重试）| 'action'（增删改失败）
  dialogTaskId: null,
};

// ---------------------------------------------------------------------------
// API 封装：统一处理 JSON、错误与「会话过期」
// ---------------------------------------------------------------------------
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? `请求失败（${res.status}）`);
    err.status = res.status;
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------------------
// 视图切换
// ---------------------------------------------------------------------------
function showLogin() {
  $('login-view').hidden = false;
  $('app-view').hidden = true;
}

function showApp() {
  $('login-view').hidden = true;
  $('app-view').hidden = false;
  $('current-user').textContent = `${state.user.name}（${state.user.email}）`;
}

// ---------------------------------------------------------------------------
// 数据加载
// ---------------------------------------------------------------------------
async function loadBootstrap() {
  const [me, ws] = await Promise.all([api('/api/me'), api('/api/workspaces')]);
  state.user = me.user;
  state.workspaces = ws.workspaces;
  state.workspaceId = ws.workspaces[0]?.id ?? null;
  showApp();
  renderWorkspaceSelect();
  await loadTasks();
}

async function loadTasks() {
  if (!state.workspaceId) return;
  state.loading = true;
  state.error = null;
  renderTasks();
  try {
    const params = new URLSearchParams({ workspaceId: state.workspaceId, page: String(state.page) });
    if (state.status !== 'all') params.set('status', state.status);
    if (state.q) params.set('q', state.q);
    const data = await api(`/api/tasks?${params}`);
    state.tasks = data.items;
    state.page = data.page;
    state.totalPages = data.totalPages;
    state.total = data.total;
    state.errorKind = null;
  } catch (err) {
    state.error = err.status === 401 ? '登录已过期，请重新登录' : `加载任务失败：${err.message}`;
    state.errorKind = 'load';
    state.tasks = [];
  } finally {
    state.loading = false;
    renderTasks();
  }
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------
function renderWorkspaceSelect() {
  const select = $('workspace-select');
  select.replaceChildren(
    ...state.workspaces.map((ws) => {
      const option = document.createElement('option');
      option.value = ws.id;
      option.textContent = ws.name;
      option.selected = ws.id === state.workspaceId;
      return option;
    }),
  );
}

function renderTasks() {
  $('tasks-loading').hidden = !state.loading;
  const errorEl = $('tasks-error');
  if (state.error) {
    errorEl.textContent = state.error;
    errorEl.hidden = false;
  } else {
    errorEl.hidden = true;
  }
  // 只有「列表加载失败」才展示重试按钮；增删改失败只提示不重试
  $('tasks-retry').hidden = state.errorKind !== 'load';

  const list = $('task-list');
  list.replaceChildren(
    ...state.tasks.map((task) => {
      const li = document.createElement('li');
      li.className = 'card task-item';

      const title = document.createElement('h3');
      const titleBtn = document.createElement('button');
      titleBtn.type = 'button';
      titleBtn.className = 'task-title';
      titleBtn.textContent = task.title;
      titleBtn.addEventListener('click', () => openDialog(task.id));
      title.append(titleBtn);

      const badge = document.createElement('span');
      badge.className = `badge badge-${task.status}`;
      badge.textContent = STATUS_LABEL[task.status];

      const meta = document.createElement('p');
      meta.className = 'meta';
      meta.textContent = `负责人：${task.assignee}`;

      const actions = document.createElement('div');
      actions.className = 'task-actions';

      const statusSelect = document.createElement('select');
      statusSelect.setAttribute('aria-label', `修改「${task.title}」的状态`);
      for (const [value, label] of Object.entries(STATUS_LABEL)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = `设为${label}`;
        option.selected = value === task.status;
        statusSelect.append(option);
      }
      statusSelect.addEventListener('change', async () => {
        await patchTask(task.id, { status: statusSelect.value });
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '删除';
      del.setAttribute('aria-label', `删除「${task.title}」`);
      del.addEventListener('click', async () => {
        try {
          await api(`/api/tasks/${task.id}?workspaceId=${state.workspaceId}`, { method: 'DELETE' });
          await loadTasks();
        } catch (err) {
          state.error = `删除失败：${err.message}`;
          state.errorKind = 'action';
          renderTasks();
        }
      });

      actions.append(statusSelect, del);
      li.append(title, badge, meta, actions);
      return li;
    }),
  );

  $('tasks-empty').hidden = state.loading || state.tasks.length > 0 || Boolean(state.error);
  $('page-info').textContent = `第 ${state.page} / ${state.totalPages} 页，共 ${state.total} 条`;
  $('prev-page').disabled = state.page <= 1;
  $('next-page').disabled = state.page >= state.totalPages;
}

async function patchTask(id, patch) {
  try {
    await api(`/api/tasks/${id}?workspaceId=${state.workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    await loadTasks();
    return true;
  } catch (err) {
    if (state.dialogTaskId === id) {
      const el = $('task-detail-error');
      el.textContent = `保存失败：${err.message}`;
      el.hidden = false;
    } else {
      state.error = `更新失败：${err.message}`;
      state.errorKind = 'action';
      renderTasks();
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// 任务详情对话框
// ---------------------------------------------------------------------------
function openDialog(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  state.dialogTaskId = taskId;
  $('task-title').value = task.title;
  $('task-status').value = task.status;
  $('task-assignee').textContent = task.assignee;
  $('task-detail-error').hidden = true;
  // 内部备注仅管理员可见可改（服务端同样有 403 校验）
  const isAdmin = state.user.role === 'admin';
  $('notes-field').hidden = !isAdmin;
  if (isAdmin) $('task-notes').value = task.notes ?? '';
  $('task-dialog').showModal();
}

$('task-form').addEventListener('submit', async (event) => {
  event.preventDefault(); // 阻止 method="dialog" 的默认关闭行为
  const patch = { title: $('task-title').value, status: $('task-status').value };
  if (state.user.role === 'admin') patch.notes = $('task-notes').value;
  const ok = await patchTask(state.dialogTaskId, patch);
  if (ok) {
    $('task-dialog').close();
    state.dialogTaskId = null;
  }
});

$('close-dialog').addEventListener('click', () => {
  $('task-dialog').close();
  state.dialogTaskId = null;
});

// ---------------------------------------------------------------------------
// 登录 / 登出
// ---------------------------------------------------------------------------
$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = $('login-error');
  errorEl.hidden = true;
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        email: $('email').value.trim(),
        password: $('password').value,
      }),
    });
    $('login-form').reset();
    await loadBootstrap();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});

$('signout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  state.user = null;
  state.tasks = [];
  showLogin();
});

// ---------------------------------------------------------------------------
// 工具栏：搜索、筛选、分页、切换工作区
// ---------------------------------------------------------------------------
$('search-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    state.q = event.target.value.trim();
    state.page = 1;
    loadTasks();
  }
});

$('status-filter').addEventListener('change', (event) => {
  state.status = event.target.value;
  state.page = 1;
  loadTasks();
});

$('prev-page').addEventListener('click', () => {
  if (state.page > 1) {
    state.page -= 1;
    loadTasks();
  }
});

$('tasks-retry').addEventListener('click', () => {
  loadTasks();
});

$('next-page').addEventListener('click', () => {
  if (state.page < state.totalPages) {
    state.page += 1;
    loadTasks();
  }
});

$('workspace-select').addEventListener('change', (event) => {
  state.workspaceId = event.target.value;
  state.page = 1;
  state.q = '';
  state.status = 'all';
  $('search-input').value = '';
  $('status-filter').value = 'all';
  loadTasks();
});

$('new-task-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = $('new-task-error');
  errorEl.hidden = true;
  const input = $('new-task-title');
  const title = input.value.trim();
  if (!title) {
    errorEl.textContent = '标题不能为空';
    errorEl.hidden = false;
    input.focus();
    return;
  }
  try {
    await api(`/api/tasks?workspaceId=${state.workspaceId}`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
    input.value = '';
    state.page = 1;
    await loadTasks();
  } catch (err) {
    errorEl.textContent = `新建失败：${err.message}`;
    errorEl.hidden = false;
  }
});

// ---------------------------------------------------------------------------
// 启动：有会话直接进应用，否则显示登录页
// ---------------------------------------------------------------------------
(async function init() {
  try {
    const me = await api('/api/me');
    // 先渲染一次加载态再拉数据：避免「会话已恢复但列表还在飞」的窗口期里
    // 既不显示 loading 也不显示数据（也给了测试一个可断言的确定状态）
    state.user = me.user;
    state.loading = true;
    showApp();
    renderTasks();
    await loadBootstrap();
  } catch {
    showLogin();
  }
})();
