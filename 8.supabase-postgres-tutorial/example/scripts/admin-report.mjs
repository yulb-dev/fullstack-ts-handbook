// 第 8 章：服务端使用 secret key。它以 service_role 身份访问，绕过所有 RLS。
// 所以：只在你控制的服务器/定时任务里使用；在调用之前，由你的代码自己完成权限判断。
import { requireEnv, serverClient } from './lib/env.mjs'

const admin = serverClient(requireEnv('SUPABASE_SECRET_KEY'))

// 跨所有组织的运营报表：普通用户的会话永远查不到这么多数据
const { data, error } = await admin
  .from('organizations')
  .select('slug, seat_limit, memberships(count), projects(key, tasks(count))')
  .order('slug')

if (error) throw error
for (const org of data) {
  const projects = org.projects.map((p) => `${p.key}:${p.tasks[0].count}`).join(', ')
  console.log(`${org.slug.padEnd(16)} 成员 ${org.memberships[0].count}/${org.seat_limit}  任务 ${projects}`)
}

// 计费逻辑才能修改的列：客户端没有 seat_limit 的 update 权限，服务端可以
// （真实系统中，这一步应在“支付成功”的 webhook 里、校验签名之后执行）
// await admin.from('organizations').update({ seat_limit: 20 }).eq('slug', 'acme')
