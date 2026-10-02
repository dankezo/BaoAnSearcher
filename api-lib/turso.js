/**
 * Turso (libSQL) client for serverless API — business data only.
 * Env: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 */
import { createClient } from '@libsql/client'

let client = null

export function getTurso() {
  const url = (process.env.TURSO_DATABASE_URL || '').trim()
  const authToken = (process.env.TURSO_AUTH_TOKEN || '').trim()
  if (!url || !authToken) {
    const err = new Error('Turso chưa cấu hình (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN).')
    err.status = 503
    throw err
  }
  if (!client) {
    client = createClient({ url, authToken })
  }
  return client
}

export function fold(text) {
  const s = String(text ?? '').toLowerCase().replace(/đ/g, 'd')
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
