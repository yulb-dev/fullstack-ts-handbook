// 第 11 章：文件生命周期的服务端任务。
//   1) 分批硬删除“回收站里超过 30 天”的任务（级联删除附件元数据，触发器把文件路径写入清理队列）
//   2) 消费清理队列：用 secret key 调用 Storage API 删除文件，成功后出队，失败记录原因等待重试
// 可以由 cron、CI 定时任务或常驻 worker 调用。只运行一个实例；需要并发时再引入锁（见第 11 章）。
import pg from 'pg'
import { requireEnv, serverClient } from './lib/env.mjs'

const RETENTION = '30 days'
const BATCH = 100

const pool = new pg.Pool({ connectionString: requireEnv('DATABASE_URL'), max: 1 })
const admin = serverClient(requireEnv('SUPABASE_SECRET_KEY'))

try {
  // 1. 分批清理：每批一个短事务，避免一次删除几十万行造成长时间持锁
  let purged = 0
  for (;;) {
    const { rows } = await pool.query('select private.purge_deleted_tasks($1::interval, 500) as n', [RETENTION])
    purged += rows[0].n
    if (rows[0].n === 0) break
  }
  console.log(`回收站：硬删除 ${purged} 条任务`)

  // 2. 消费清理队列
  for (;;) {
    const { rows } = await pool.query(
      `select id, bucket_id, object_path
         from private.storage_cleanup_queue
        where attempts < 5
        order by id
        limit $1`,
      [BATCH],
    )
    if (rows.length === 0) break

    const byBucket = new Map()
    for (const row of rows) {
      byBucket.set(row.bucket_id, [...(byBucket.get(row.bucket_id) ?? []), row])
    }
    for (const [bucket, items] of byBucket) {
      const { error } = await admin.storage.from(bucket).remove(items.map((i) => i.object_path))
      const ids = items.map((i) => i.id)
      if (error) {
        await pool.query(
          `update private.storage_cleanup_queue
              set attempts = attempts + 1, last_error = $2
            where id = any($1::bigint[])`,
          [ids, error.message],
        )
        console.error(`删除失败（${bucket}，${ids.length} 个）：${error.message}`)
      } else {
        await pool.query('delete from private.storage_cleanup_queue where id = any($1::bigint[])', [ids])
        console.log(`已删除 ${ids.length} 个文件（${bucket}）`)
      }
    }
  }
} finally {
  await pool.end()
}
