// 第 8 章：通过 Auth 管理 API 创建“能登录”的本地测试用户。
// 管理 API 需要 secret key，所以这是一个服务端脚本，并且只允许连本地栈。
import { assertLocalSupabase, requireEnv, serverClient, DEV_USERS } from './lib/env.mjs'

assertLocalSupabase(requireEnv('SUPABASE_URL'))
const admin = serverClient(requireEnv('SUPABASE_SECRET_KEY'))

for (const user of DEV_USERS) {
  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    // user_metadata 用户自己可以修改：只能放展示用信息，绝不能放权限（第 9 章）
    user_metadata: { display_name: user.displayName },
  })

  if (error?.code === 'email_exists') {
    console.log(`已存在：${user.email}`)
    continue
  }
  if (error) throw error
  console.log(`已创建：${user.email}（id = ${data.user.id}）`)
}

console.log('\n这些账号只存在于本地数据库；下一次 supabase db reset 后需要重新运行本脚本。')
