import { createClient } from '@supabase/supabase-js'

export function supabaseEnv() {
  const url = (
    process.env.SUPABASE_URL
    || process.env.NEXT_PUBLIC_SUPABASE_URL
    || process.env.VITE_SUPABASE_URL
    || ''
  ).trim().replace(/\/$/, '')
  const anon = (
    process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_ANON_KEY
    || ''
  ).trim()
  return { url, anon }
}

export function supabaseAsUser(accessToken) {
  const { url, anon } = supabaseEnv()
  if (!url || !anon) {
    const err = new Error('Supabase chưa cấu hình trên server.')
    err.status = 503
    throw err
  }
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function supabaseAsServiceRole() {
  const { url } = supabaseEnv()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw Object.assign(new Error('Chưa cấu hình kho lưu phân tích.'), { status: 503 })
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
