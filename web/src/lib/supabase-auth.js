/**
 * Supabase Auth helpers (Vite SPA equivalent of lib/supabase-auth.ts).
 * signInWithPassword / signOut / getUser — used by AuthProvider.
 */
export {
  getSupabase,
  supabaseConfigured,
  isCompanyEmail,
  ALLOWED_EMAIL_DOMAIN,
} from '../supabaseClient'

export async function signInWithPassword(email, password) {
  const { getSupabase } = await import('../supabaseClient')
  const sb = getSupabase()
  if (!sb) throw new Error('Supabase chưa cấu hình')
  return sb.auth.signInWithPassword({ email, password })
}

export async function signOut() {
  const { getSupabase } = await import('../supabaseClient')
  const sb = getSupabase()
  if (!sb) return
  return sb.auth.signOut()
}

export async function getUser() {
  const { getSupabase } = await import('../supabaseClient')
  const sb = getSupabase()
  if (!sb) return { data: { user: null }, error: null }
  return sb.auth.getUser()
}

let refreshing
export async function authenticatedFetch(url, options = {}) {
  const { getSupabase } = await import('../supabaseClient')
  const sb = getSupabase()
  if (!sb) throw new Error('Chưa cấu hình Supabase Auth.')
  const initial = await sb.auth.getSession()
  if (initial.error) throw initial.error
  const session = initial.data.session
  if (!session) throw Object.assign(new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'), { status: 401 })
  const send = token => fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } })
  const response = await send(session.access_token)
  if (response.status !== 401) return response
  if (options.signal?.aborted) throw options.signal.reason
  // Concurrent dashboard requests share one refresh; retry each request once.
  const current = await sb.auth.getSession()
  if (current.data.session?.user.id !== session.user.id) throw Object.assign(new Error('Phiên tài khoản đã thay đổi. Vui lòng tải lại trang.'), { status: 401 })
  const alreadyRenewed = current.data.session?.access_token !== session.access_token
  if (!alreadyRenewed) refreshing ||= sb.auth.refreshSession().finally(() => { refreshing = undefined })
  const renewed = alreadyRenewed ? current : await refreshing
  if (renewed.error || !renewed.data.session) throw Object.assign(new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'), { status: 401 })
  if (renewed.data.session.user.id !== session.user.id) throw Object.assign(new Error('Phiên tài khoản đã thay đổi. Vui lòng tải lại trang.'), { status: 401 })
  const retried = await send(renewed.data.session.access_token)
  if (retried.status === 401) throw Object.assign(new Error('Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.'), { status: 401 })
  return retried
}
