import { getSupabase } from '../supabaseClient'

export async function regulatoryRequest(params = {}, body, signal) {
  const session = await getSupabase()?.auth.getSession()
  const token = session?.data?.session?.access_token
  if (!token) throw new Error('Đăng nhập tài khoản Bảo An để mở kho pháp luật.')
  const response = await fetch(`/api/regulatory?${new URLSearchParams(params)}`, {
    method: body ? 'POST' : 'GET', signal,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || `Không tải được kho pháp luật (${response.status}).`)
  return result
}
