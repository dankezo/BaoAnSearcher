/**
 * Verify Supabase Auth JWT (Bearer) before any Turso query.
 * Env: NEXT_PUBLIC_SUPABASE_URL | VITE_SUPABASE_URL
 *      NEXT_PUBLIC_SUPABASE_ANON_KEY | VITE_SUPABASE_ANON_KEY
 */
import { createClient } from '@supabase/supabase-js'

const ALLOWED_DOMAIN = 'baoanpharma.com'

function supabaseEnv() {
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL
    || process.env.VITE_SUPABASE_URL
    || process.env.SUPABASE_URL
    || ''
  ).trim()
  const anon = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_ANON_KEY
    || process.env.SUPABASE_ANON_KEY
    || ''
  ).trim()
  return { url, anon }
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<{ user: object, accessToken: string }>}
 */
export async function requireUser(req) {
  const auth = req.headers.authorization || req.headers.Authorization || ''
  const m = String(auth).match(/^Bearer\s+(.+)$/i)
  if (!m) {
    const err = new Error('Unauthorized')
    err.status = 401
    throw err
  }
  const accessToken = m[1].trim()
  const { url, anon } = supabaseEnv()
  if (!url || !anon) {
    const err = new Error('Supabase Auth chưa cấu hình trên server.')
    err.status = 503
    throw err
  }
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await sb.auth.getUser(accessToken)
  if (error || !data?.user) {
    const err = new Error('Unauthorized')
    err.status = 401
    throw err
  }
  const email = String(data.user.email || '').toLowerCase()
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    const err = new Error('Tài khoản không thuộc quyền quản trị nội bộ')
    err.status = 403
    throw err
  }
  return { user: data.user, accessToken }
}

export function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

export async function readJson(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}
