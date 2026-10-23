// 第 8、9 章：从“客户端视角”验证 grants 与 RLS。
// 这里用 Node 运行，但只使用 publishable key + 用户登录会话，与浏览器中的代码完全相同。
import { assertLocalSupabase, requireEnv, serverClient, signedInClient, DEV_USERS } from './lib/env.mjs'

assertLocalSupabase(requireEnv('SUPABASE_URL'))
const [ERIN, GRACE] = DEV_USERS

function show(label, { data, error }) {
  if (error) console.log(`✗ ${label}：${error.code} ${error.message}`)
  else console.log(`✓ ${label}：`, JSON.stringify(data))
}

// 1. 未登录（anon 角色）：本应用没有给 anon 任何 grant，请求在策略之前就被拒绝
const anon = serverClient(requireEnv('SUPABASE_PUBLISHABLE_KEY'))
show('未登录读取 tasks', await anon.from('tasks').select('id').limit(1))

// 2. Erin 登录后创建自己的组织、项目和任务
const erin = await signedInClient(ERIN)
const slug = `erin-${Date.now().toString(36)}`

// created_by 不需要传：列默认值是 auth.uid()；策略再检查它确实等于当前用户
const orgResult = await erin.from('organizations').insert({ slug, name: 'Erin 的团队' }).select().single()
show('Erin 创建组织', orgResult)
const org = orgResult.data

const projectResult = await erin
  .from('projects')
  .insert({ org_id: org.id, key: 'DEMO', name: '演示项目' })
  .select('id, key')
  .single()
show('Erin（owner）创建项目', projectResult)
const project = projectResult.data

const tasksResult = await erin
  .from('tasks')
  .insert([
    { org_id: org.id, project_id: project.id, title: '写需求文档' },
    { org_id: org.id, project_id: project.id, title: '画交互稿' },
  ])
  .select('id, number, title')
show('Erin 创建两条任务（编号由数据库分配）', tasksResult)

// 3. Grace 是另一个用户：看不到、改不了、也写不进 Erin 的组织
const grace = await signedInClient(GRACE)
show('Grace 读取 Erin 组织的任务', await grace.from('tasks').select('id').eq('org_id', org.id))
show(
  'Grace 向 Erin 的组织插入任务',
  await grace.from('tasks').insert({ org_id: org.id, project_id: project.id, title: '越权' }),
)
show(
  'Grace 更新 Erin 的任务',
  await grace.from('tasks').update({ title: '篡改' }).eq('org_id', org.id).select('id'),
)

// 4. 列级权限：即使是 owner，也不能从客户端改编号计数器或席位上限
show('Erin 修改 next_task_number', await erin.from('projects').update({ next_task_number: 1 }).eq('id', project.id))
show('Erin 修改 seat_limit', await erin.from('organizations').update({ seat_limit: 999 }).eq('id', org.id))

// 5. 软删除：没有 delete 权限，只能更新 deleted_at；看板读 active_tasks 视图
const first = tasksResult.data[0]
show('Erin 硬删除任务', await erin.from('tasks').delete().eq('id', first.id))
show(
  'Erin 软删除任务',
  await erin.from('tasks').update({ deleted_at: new Date().toISOString() }).eq('id', first.id).select('id, deleted_at'),
)
show(
  '看板（active_tasks）',
  await erin.from('active_tasks').select('number, title').eq('project_id', project.id).order('number'),
)

// 6. 嵌套查询：PostgREST 根据外键自动识别关系
show(
  '任务 + 所属项目 + 标签',
  await erin
    .from('tasks')
    .select('number, title, projects(key), task_labels(labels(name))')
    .eq('org_id', org.id)
    .order('number'),
)

// 7. 稳定分页：排序必须有唯一的决胜列（第 5 章）
show(
  '第一页',
  await erin
    .from('active_tasks')
    .select('id, number, created_at')
    .eq('project_id', project.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(20),
)
