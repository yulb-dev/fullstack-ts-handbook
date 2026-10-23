// 第 8、10 章：服务端直连 Postgres。
// 连接串里的身份（本地是 postgres）决定权限：它是表的所有者并拥有 bypassrls，RLS 对它不生效。
import pg from 'pg'
import { requireEnv } from './lib/env.mjs'

const BOB = '22222222-2222-4222-8222-222222222222'

// 一个进程一个连接池；脚本结束时关闭。长驻服务在模块顶层创建一次，不要每个请求 new 一个。
const pool = new pg.Pool({ connectionString: requireEnv('DATABASE_URL'), max: 2 })

// 1. 以连接身份直接查询：看到全部组织的数据
const all = await pool.query('select current_user, count(*)::int as tasks from public.tasks group by 1')
console.log('直连身份：', all.rows)

// 2. 在一个事务里“扮演”某个已验证的用户，让 RLS 生效。
//    前提：BOB 这个 id 来自服务端已验证签名的 JWT，绝不能直接取自请求参数。
//    set local / set_config(..., true) 只在当前事务内有效，事务结束自动失效，
//    因此在 transaction pooler 下也不会“串”到别的请求。
const client = await pool.connect()
try {
  await client.query('begin')
  await client.query('set local role authenticated')
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: BOB, role: 'authenticated' }),
  ])
  const asBob = await client.query('select current_user, count(*)::int as tasks from public.tasks group by 1')
  console.log('扮演 Bob：', asBob.rows)
  await client.query('commit')
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  client.release()
}

await pool.end()
