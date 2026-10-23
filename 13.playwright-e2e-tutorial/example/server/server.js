// TaskBoard lite —— 仅供 Playwright 教程使用的演示应用。
// 零运行时依赖：只用 node:http 与内存数据，重启即重置。
// 刻意保留完整语义化标记（label / role / dialog），供 E2E 定位与可访问性教学使用。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? '127.0.0.1';
const PAGE_SIZE = 5;

// ---------------------------------------------------------------------------
// 内存数据（种子固定，task id 自增，重启后重置）
// ---------------------------------------------------------------------------
const users = [
  { id: 'u-alice', name: 'Alice', email: 'alice@taskboard.dev', password: 'alice123' },
  { id: 'u-bob', name: 'Bob', email: 'bob@taskboard.dev', password: 'bob123' },
  { id: 'u-carol', name: 'Carol', email: 'carol@taskboard.dev', password: 'carol123', role: 'admin' },
];

const workspaces = [
  { id: 'ws-alpha', name: 'Alpha' },
  { id: 'ws-beta', name: 'Beta' },
];

// members[userId] = { workspaceId: role }
const members = {
  'u-alice': { 'ws-alpha': 'member' },
  'u-bob': { 'ws-beta': 'member' },
  'u-carol': { 'ws-alpha': 'admin', 'ws-beta': 'admin' },
};

let nextTaskId = 100;
const newId = () => `t-${nextTaskId++}`;

// tasks[workspaceId] = Task[]；种子数据固定，保证分页/筛选演示可复现
const tasks = {
  'ws-alpha': [
    { id: newId(), title: '设计登录页', status: 'todo', assignee: 'Alice', notes: '' },
    { id: newId(), title: '搭建 API 骨架', status: 'doing', assignee: 'Alice', notes: '' },
    { id: newId(), title: '编写种子数据', status: 'done', assignee: 'Carol', notes: '仅限管理员可见的备注' },
    { id: newId(), title: '配置 CI', status: 'todo', assignee: 'Carol', notes: '' },
    { id: newId(), title: '修复导航样式', status: 'todo', assignee: 'Alice', notes: '' },
    { id: newId(), title: '梳理路线图', status: 'doing', assignee: 'Carol', notes: '' },
    { id: newId(), title: '补充 README', status: 'todo', assignee: 'Alice', notes: '' },
  ],
  'ws-beta': [
    { id: newId(), title: 'Beta 发布计划', status: 'todo', assignee: 'Bob', notes: '' },
    { id: newId(), title: 'Beta 数据迁移', status: 'doing', assignee: 'Bob', notes: '' },
  ],
};

const sessions = new Map(); // token -> userId

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

const sendError = (res, status, code, message) =>
  sendJson(res, status, { error: { code, message } });

function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}

function parseCookies(req) {
  const header = req.headers.cookie ?? '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function readBody(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('invalid json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** 返回当前会话用户；未登录时直接回 401 并返回 null */
function requireUser(req, res) {
  const token = parseCookies(req).sb_session;
  const userId = token && sessions.get(token);
  const user = userId && users.find((u) => u.id === userId);
  if (!user) {
    sendError(res, 401, 'unauthorized', '请先登录');
    return null;
  }
  return user;
}

/**
 * 校验用户对 workspace 的访问权。
 * 约定（供越权测试使用）：不是成员一律 403 forbidden——即使 workspace 不存在，
 * 也不回 404，避免泄露「这个 ID 是否存在」。
 */
function requireWorkspace(req, res, user, workspaceId) {
  const role = members[user.id]?.[workspaceId];
  if (!role) {
    sendError(res, 403, 'forbidden', '无权访问该工作区');
    return null;
  }
  return role;
}

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role ?? 'member',
});

// ---------------------------------------------------------------------------
// API 路由
// ---------------------------------------------------------------------------
async function handleApi(req, res, url) {
  const { pathname } = url;

  // GET /api/health —— webServer 就绪探测
  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true });
  }

  // POST /api/login
  if (req.method === 'POST' && pathname === '/api/login') {
    const body = await readBody(req);
    const user = users.find(
      (u) => u.email === String(body.email ?? '') && u.password === String(body.password ?? ''),
    );
    if (!user) return sendError(res, 401, 'invalid_credentials', '邮箱或密码不正确');
    const token = crypto.randomUUID();
    sessions.set(token, user.id);
    res.setHeader(
      'set-cookie',
      `sb_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800`,
    );
    return sendJson(res, 200, { user: publicUser(user) });
  }

  // 以下路由都需要登录
  const user = requireUser(req, res);
  if (!user) return;

  // POST /api/logout
  if (req.method === 'POST' && pathname === '/api/logout') {
    const token = parseCookies(req).sb_session;
    if (token) sessions.delete(token);
    res.setHeader('set-cookie', 'sb_session=; Path=/; HttpOnly; Max-Age=0');
    return sendNoContent(res);
  }

  // GET /api/me
  if (req.method === 'GET' && pathname === '/api/me') {
    return sendJson(res, 200, { user: publicUser(user) });
  }

  // GET /api/workspaces —— 只返回「我是成员」的工作区
  if (req.method === 'GET' && pathname === '/api/workspaces') {
    const mine = workspaces.filter((ws) => members[user.id]?.[ws.id]);
    return sendJson(res, 200, {
      workspaces: mine.map((ws) => ({ ...ws, role: members[user.id][ws.id] })),
    });
  }

  // 带 workspaceId 的路由：GET/POST /api/tasks、PATCH/DELETE /api/tasks/:id
  let workspaceId = url.searchParams.get('workspaceId');
  let taskId = null;
  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch) {
    taskId = decodeURIComponent(taskMatch[1]);
    // 先在所有工作区里定位任务，确定它所属的 workspace。
    // 注意：找不到时不能直接回 404——那会和「存在但无权」的 403 形成差异，
    // 泄露资源存在性。统一交给 requireWorkspace 用假 id 回 403。
    const owner = Object.keys(tasks).find((wsId) =>
      tasks[wsId].some((t) => t.id === taskId),
    );
    workspaceId = owner ?? '__unknown__';
  } else if (pathname === '/api/tasks' && !workspaceId) {
    return sendError(res, 400, 'bad_request', '缺少 workspaceId 参数');
  }
  if (!/^\/api\/tasks(\/|$)/.test(pathname)) {
    return sendError(res, 404, 'not_found', '接口不存在');
  }

  const role = requireWorkspace(req, res, user, workspaceId);
  if (!role) return;

  // GET /api/tasks?workspaceId=&status=&q=&page=
  if (req.method === 'GET' && pathname === '/api/tasks') {
    const status = url.searchParams.get('status');
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const pageRaw = url.searchParams.get('page') ?? '1';
    const page = Number(pageRaw);
    if (!/^\d+$/.test(pageRaw) || page < 1) {
      return sendError(res, 400, 'bad_request', 'page 必须是不小于 1 的整数');
    }
    let items = tasks[workspaceId];
    if (status) {
      if (!['todo', 'doing', 'done'].includes(status)) {
        return sendError(res, 400, 'bad_request', 'status 取值无效');
      }
      items = items.filter((t) => t.status === status);
    }
    if (q) items = items.filter((t) => t.title.toLowerCase().includes(q));
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const start = (page - 1) * PAGE_SIZE;
    return sendJson(res, 200, {
      items: items.slice(start, start + PAGE_SIZE),
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages,
    });
  }

  // POST /api/tasks?workspaceId=
  if (req.method === 'POST' && pathname === '/api/tasks') {
    const body = await readBody(req);
    const title = String(body.title ?? '').trim();
    if (!title || title.length > 80) {
      return sendError(res, 400, 'bad_request', '标题长度需在 1~80 个字符之间');
    }
    const status = body.status ?? 'todo';
    if (!['todo', 'doing', 'done'].includes(status)) {
      return sendError(res, 400, 'bad_request', 'status 取值无效');
    }
    const task = {
      id: newId(),
      title,
      status,
      assignee: body.assignee ? String(body.assignee) : user.name,
      notes: '',
    };
    tasks[workspaceId].push(task);
    return sendJson(res, 201, { task });
  }

  // GET /api/tasks/:id —— 单任务详情（供测试的 API 复核使用）
  if (req.method === 'GET' && taskMatch) {
    const task = tasks[workspaceId].find((t) => t.id === taskId);
    if (!task) return sendError(res, 403, 'forbidden', '无权访问该工作区');
    return sendJson(res, 200, { task });
  }

  // PATCH /api/tasks/:id —— 状态流转；notes 仅管理员可改
  if (req.method === 'PATCH' && taskMatch) {
    const body = await readBody(req);
    const task = tasks[workspaceId].find((t) => t.id === taskId);
    // 任务不存在时同样回 403，与「无权访问」保持一致，不泄露存在性
    if (!task) return sendError(res, 403, 'forbidden', '无权访问该工作区');
    if (body.status !== undefined) {
      if (!['todo', 'doing', 'done'].includes(body.status)) {
        return sendError(res, 400, 'bad_request', 'status 取值无效');
      }
      task.status = body.status;
    }
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title || title.length > 80) {
        return sendError(res, 400, 'bad_request', '标题长度需在 1~80 个字符之间');
      }
      task.title = title;
    }
    if (body.notes !== undefined) {
      if (role !== 'admin') {
        return sendError(res, 403, 'forbidden', '只有管理员能修改内部备注');
      }
      task.notes = String(body.notes);
    }
    return sendJson(res, 200, { task });
  }

  // DELETE /api/tasks/:id（filter 对不存在的 id 天然幂等，无需额外判空）
  if (req.method === 'DELETE' && taskMatch) {
    tasks[workspaceId] = tasks[workspaceId].filter((t) => t.id !== taskId);
    return sendNoContent(res);
  }

  return sendError(res, 405, 'method_not_allowed', '方法不允许');
}

// ---------------------------------------------------------------------------
// 静态文件
// ---------------------------------------------------------------------------
async function serveStatic(req, res, url) {
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = join(__dirname, '..', 'public', normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

// ---------------------------------------------------------------------------
// 服务器
// ---------------------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (err) {
    const status = err.status ?? 500;
    if (!res.headersSent) {
      sendError(res, status, status === 500 ? 'internal' : 'bad_request', err.message);
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`TaskBoard lite listening on http://${HOST}:${PORT}`);
});
