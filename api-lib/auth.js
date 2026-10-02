/**
 * Verify Supabase Auth JWT before any data query.
 * AUTH_MODE=local verifies the JWT here (JWKS cache). AUTH_MODE=remote calls Supabase getUser.
 */
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose'
import { createClient } from '@supabase/supabase-js'
import { supabaseEnv } from './supabaseClient.js'

const ALLOWED_EMAILS = new Set([
  'sales@baoanpharma.com',
  'importer@baoanpharma.com',
  'admin@baoanpharma.com',
  'sonnguyen@baoanpharma.com',
  'tuanvu@baoanpharma.com',
  'qa.cursor@baoanpharma.com',
])

const jwksCache = new Map()

function authMode() {
  const raw = String(process.env.AUTH_MODE || 'local').trim().toLowerCase()
  return raw === 'remote' ? 'remote' : 'local'
}

function bearer(req) {
  const auth = req.headers.authorization || req.headers.Authorization || ''
  const m = String(auth).match(/^Bearer\s+(.+)$/i)
  if (!m) {
    const err = new Error('Unauthorized')
    err.status = 401
    throw err
  }
  return m[1].trim()
}

export function emailAllowed(email) {
  return ALLOWED_EMAILS.has(String(email || '').toLowerCase())
}

function emailFromPayload(payload) {
  return payload?.email || payload?.user_metadata?.email || ''
}

async function jwks(url, anon) {
  const hit = jwksCache.get(url)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.set
  const res = await fetch(`${url}/auth/v1/.well-known/jwks.json`, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  })
  if (!res.ok) {
    const err = new Error('Không lấy được khóa xác thực.')
    err.status = 503
    throw err
  }
  const body = await res.json()
  const set = createLocalJWKSet(body)
  jwksCache.set(url, { at: Date.now(), set })
  return set
}

async function verifyLocal(accessToken) {
  const { url, anon } = supabaseEnv()
  if (!url || !anon) {
    const err = new Error('Supabase Auth chưa cấu hình trên server.')
    err.status = 503
    throw err
  }
  const header = decodeProtectedHeader(accessToken)
  const secret = (process.env.SUPABASE_JWT_SECRET || '').trim()
  let payload
  if (header.alg === 'HS256' && secret) {
    const checked = await jwtVerify(accessToken, new TextEncoder().encode(secret), {
      issuer: `${url}/auth/v1`,
      audience: 'authenticated',
    })
    payload = checked.payload
  } else {
    const checked = await jwtVerify(accessToken, await jwks(url, anon), {
      issuer: `${url}/auth/v1`,
      audience: 'authenticated',
    })
    payload = checked.payload
  }
  const email = String(emailFromPayload(payload)).toLowerCase()
  if (!emailAllowed(email)) {
    const err = new Error('Tài khoản chưa được cấp quyền truy cập')
    err.status = 403
    throw err
  }
  return {
    user: { id: payload.sub, email },
    accessToken,
  }
}

async function verifyRemote(accessToken) {
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
  if (!emailAllowed(email)) {
    const err = new Error('Tài khoản chưa được cấp quyền truy cập')
    err.status = 403
    throw err
  }
  return { user: data.user, accessToken }
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<{ user: object, accessToken: string }>}
 */
export async function requireUser(req) {
  const accessToken = bearer(req)
  if (authMode() === 'remote') return verifyRemote(accessToken)
  try {
    return await verifyLocal(accessToken)
  } catch (error) {
    if (error.status) throw error
    const err = new Error('Unauthorized')
    err.status = 401
    throw err
  }
}

export function json(res, status, body, timing) {
  const t0 = performance.now()
  const text = JSON.stringify(body)
  const serializeMs = performance.now() - t0
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  if (timing) {
    timing.add('serialize', serializeMs)
    const rows = Array.isArray(body?.items)
      ? body.items.length
      : Array.isArray(body?.cards)
        ? body.cards.length
        : null
    timing.finish(res, { rows, bytes: Buffer.byteLength(text), status })
  }
  res.end(text)
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
