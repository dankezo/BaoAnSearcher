/**
 * GET/POST /api/tender/meta?section=vss|dav|msc
 * Auth: Bearer <supabase access_token>
 */
import { requireUser, json, readJson } from '../lib/auth.js'
import { getTurso } from '../lib/turso.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  try {
    await requireUser(req)
    const body = req.method === 'POST' ? await readJson(req) : {}
    const section = String(
      body.section || req.query?.section || 'vss',
    ).toLowerCase()
    const db = getTurso()
    const rs = await db.execute({
      sql: 'SELECT value, updated_at FROM app_meta WHERE key = ? LIMIT 1',
      args: [section],
    })
    const row = rs.rows[0]
    if (!row) return json(res, 200, null)
    let value = row.value
    try {
      value = typeof value === 'string' ? JSON.parse(value) : value
    } catch { /* keep string */ }
    return json(res, 200, {
      ...(value && typeof value === 'object' ? value : { value }),
      updated: value?.updated || value?.synced_at || row.updated_at,
      count: value?.count ?? value?.synced ?? null,
    })
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || String(e) })
  }
}
