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

/**
 * Explicit allowlist (Outlook OAuth + password staff).
 * Only these emails may enter the app after login.
 */
export const ALLOWED_EMAILS = [
  'sales@baoanpharma.com',
  'importer@baoanpharma.com',
  'admin@baoanpharma.com',
  'sonnguyen@baoanpharma.com',
  'tuanvu@baoanpharma.com',
].map((e) => e.toLowerCase())

/** Absolute session cap when "Ghi nhớ đăng nhập" is on. */
export const REMEMBER_DAYS = 30
const REMEMBER_FLAG = 'baoan.auth.remember'
const REMEMBER_UNTIL = 'baoan.auth.rememberUntil'

export const supabaseConfigured = !!(url && anon)

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let client = null

function rememberEnabled() {
  try {
    return localStorage.getItem(REMEMBER_FLAG) !== '0'
  } catch {
    return true
  }
}

function rememberStillValid() {
  try {
    const until = Number(localStorage.getItem(REMEMBER_UNTIL) || 0)
    if (!until) return true
    return Date.now() <= until
  } catch {
    return true
  }
}

export function setRememberPreference(remember) {
  try {
    if (remember) {
      localStorage.setItem(REMEMBER_FLAG, '1')
      localStorage.setItem(
        REMEMBER_UNTIL,
        String(Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000),
      )
    } else {
      localStorage.setItem(REMEMBER_FLAG, '0')
      localStorage.removeItem(REMEMBER_UNTIL)
    }
  } catch { /* private mode */ }
}

export function getRememberPreference() {
  return rememberEnabled()
}

function authStorage() {
  if (typeof window === 'undefined') return undefined
  return rememberEnabled() ? window.localStorage : window.sessionStorage
}

/** Drop cached client so next getSupabase() picks new storage / remember flag. */
export function resetSupabaseClient() {
  client = null
}

export function getSupabase() {
  if (!supabaseConfigured) return null
  if (!client) {
    client = createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storage: authStorage(),
        storageKey: 'baoan.supabase.auth',
      },
    })
  }
  return client
}

export function isCompanyEmail(email) {
  const e = String(email || '').trim().toLowerCase()
  if (!e.includes('@')) return false
  if (ALLOWED_EMAILS.includes(e)) return true
  return e.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)
}

/** Stricter gate used after OAuth / password — must be explicitly allowed. */
export function isAllowedEmail(email) {
  const e = String(email || '').trim().toLowerCase()
  return ALLOWED_EMAILS.includes(e)
}

export function appRedirectUrl() {
  if (typeof window === 'undefined') return 'https://app.baoanpharma.com/'
  const base = import.meta.env.BASE_URL || '/'
  const path = base.endsWith('/') ? base : `${base}/`
  return `${window.location.origin}${path}`
}

/** If remember-until expired, clear session keys. Returns false when expired. */
export function enforceRememberWindow() {
  if (!rememberEnabled()) return true
  if (rememberStillValid()) return true
  try {
    localStorage.removeItem(REMEMBER_UNTIL)
    localStorage.removeItem('baoan.supabase.auth')
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('sb-') && k.includes('auth-token')) localStorage.removeItem(k)
    }
  } catch { /* ignore */ }
  resetSupabaseClient()
  return false
}
