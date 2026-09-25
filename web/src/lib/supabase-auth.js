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
