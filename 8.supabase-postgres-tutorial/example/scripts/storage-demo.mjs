// 第 11 章：私有桶的上传、元数据登记、签名 URL，以及越权访问为何失败。
// 先运行 npm run dev:users 与 npm run demo:rls（为 Erin 准备组织和任务）。
import { randomUUID } from 'node:crypto'
import { assertLocalSupabase, requireEnv, signedInClient, DEV_USERS } from './lib/env.mjs'

assertLocalSupabase(requireEnv('SUPABASE_URL'))
const [ERIN, GRACE] = DEV_USERS
const BUCKET = 'task-attachments'

const erin = await signedInClient(ERIN)
const { data: { user } } = await erin.auth.getUser()

const { data: task, error: taskError } = await erin
  .from('active_tasks')
  .select('id, org_id, number, title')
  .eq('created_by', user.id)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle()
if (taskError) throw taskError
if (!task) throw new Error('Erin 还没有任务：先运行 npm run demo:rls')

// 路径约定：{org_id}/{task_id}/{随机名}-{原文件名}
// 第一段是组织 id —— storage.objects 上的策略就靠它判断“你是不是这个组织的成员”。
// 随机前缀避免同名覆盖，也让 URL 不可被猜测。
const fileName = 'meeting-notes.txt'
const path = `${task.org_id}/${task.id}/${randomUUID()}-${fileName}`
const body = new Blob(['周会纪要：首屏图片改为响应式。'], { type: 'text/plain' })

const upload = await erin.storage.from(BUCKET).upload(path, body, { contentType: 'text/plain' })
if (upload.error) throw upload.error
console.log('✓ 上传成功：', path)

// 文件和数据库行是两个系统：上传成功后再写元数据；失败要能清理（见第 11 章“一致性”）
const meta = await erin.from('attachments').insert({
  org_id: task.org_id,
  task_id: task.id,
  object_path: path,
  file_name: fileName,
  content_type: 'text/plain',
  size_bytes: body.size,
})
if (meta.error) {
  await erin.storage.from(BUCKET).remove([path])
  throw meta.error
}
console.log('✓ 附件元数据已登记')

// 私有桶没有可用的公开地址
const { data: publicUrl } = erin.storage.from(BUCKET).getPublicUrl(path)
const publicResponse = await fetch(publicUrl.publicUrl)
console.log(`✗ 用公开地址访问私有文件：HTTP ${publicResponse.status}`)

// 签名 URL：有效期内任何拿到链接的人都能下载 —— 所以有效期要短，链接不要写进日志或长期存储
const signed = await erin.storage.from(BUCKET).createSignedUrl(path, 60)
if (signed.error) throw signed.error
const signedResponse = await fetch(signed.data.signedUrl)
console.log(`✓ 60 秒签名 URL 下载：HTTP ${signedResponse.status}，内容 = ${await signedResponse.text()}`)

// 其他组织的用户：既不能直接下载，也不能为它签名
const grace = await signedInClient(GRACE)
const graceDownload = await grace.storage.from(BUCKET).download(path)
console.log(`✗ Grace 下载：${graceDownload.error?.message}`)
const graceSign = await grace.storage.from(BUCKET).createSignedUrl(path, 60)
console.log(`✗ Grace 生成签名 URL：${graceSign.error?.message}`)

// 桶级限制：不在 allowed_mime_types 里的类型直接被拒绝
const badType = await erin.storage
  .from(BUCKET)
  .upload(`${task.org_id}/${task.id}/${randomUUID()}-tool.exe`, new Blob(['MZ']), {
    contentType: 'application/x-msdownload',
  })
console.log(`✗ 上传可执行文件：${badType.error?.message}`)
