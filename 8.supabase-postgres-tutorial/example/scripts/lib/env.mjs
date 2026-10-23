// 读取环境变量的小工具：缺失就立即失败，而不是带着 undefined 继续运行。
import { createClient } from '@supabase/supabase-js'

export function requireEnv(name) {
  const value = process.env[name]
  if (!value || value.includes('replace_me')) {
    throw new Error(`缺少环境变量 ${name}：请先把 .env.example 复制为 .env.local 并填写`)
  }
  return value
}

// 只允许在本地栈上运行的脚本（创建测试用户、演示数据）调用它。
// 判断依据是 URL 本身，而不是 APP_ENV：变量名可以被写错，地址指向哪里才是事实。
export function assertLocalSupabase(url) {
  const { hostname } = new URL(url)
  if (!['127.0.0.1', 'localhost'].includes(hostname)) {
    throw new Error(`拒绝执行：${url} 不是本地栈。这个脚本只能用于本地开发。`)
  }
}

// 服务端/脚本里创建客户端：不持久化会话，也不自动刷新令牌
export function serverClient(key) {
  return createClient(requireEnv('SUPABASE_URL'), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// 演示用的本地登录账号（由 create-dev-users.mjs 创建）
export const DEV_USERS = [
  { email: 'erin@example.test', password: 'local-only-erin-123', displayName: 'Erin' },
  { email: 'grace@example.test', password: 'local-only-grace-123', displayName: 'Grace' },
]

// 以某个用户身份登录，返回带有该用户会话的客户端（与浏览器里的用法相同）
export async function signedInClient(user) {
  const client = serverClient(requireEnv('SUPABASE_PUBLISHABLE_KEY'))
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password })
  if (error) throw new Error(`${user.email} 登录失败：${error.message}（先运行 npm run dev:users）`)
  return client
}
