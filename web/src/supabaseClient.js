/**
 * Shared Supabase browser client (Vite SPA).
 * Supports VITE_* and NEXT_PUBLIC_* env names (Vercel / docs often use NEXT_PUBLIC_).
 */
import { createClient } from '@supabase/supabase-js'

const url = (
  import.meta.env.VITE_SUPABASE_URL
  || import.meta.env.NEXT_PUBLIC_SUPABASE_URL
  || ''
).trim()

const anon = (
  import.meta.env.VITE_SUPABASE_ANON_KEY
  || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || ''
).trim()

export const ALLOWED_EMAIL_DOMAIN = 'baoanpharma.com'

export const supabaseConfigured = !!(url && anon)

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let client = null

export function getSupabase() {
  if (!supabaseConfigured) return null
  if (!client) {
    client = createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      },
    })
  }
  return client
}

export function isCompanyEmail(email) {
  const e = String(email || '').trim().toLowerCase()
  if (!e.includes('@')) return false
  return e.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)
}
