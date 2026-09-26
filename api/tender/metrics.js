/**
 * POST /api/tender/metrics
 * Body: { section: 'dav'|'vss'|'msc_prices'|'msc_tenders'|'msc' }
 * Auth: Bearer <supabase access_token>
 * Returns pre-aggregated metric cards (+ optional province tables).
 */
import { requireUser, json, readJson } from '../lib/auth.js'
import { getTurso } from '../lib/turso.js'
import { computeSectionMetrics, metricsCacheKey } from '../lib/metricsCompute.js'

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

async function readCache(db, key) {
  try {
    const rs = await db.execute({
      sql: 'SELECT value, updated_at FROM app_meta WHERE key = ? LIMIT 1',
      args: [key],
    })
    const row = rs.rows[0]
    if (!row?.value) return null
    const updated = row.updated_at ? Date.parse(String(row.updated_at).replace(' ', 'T')) : NaN
    if (Number.isFinite(updated) && Date.now() - updated > CACHE_MAX_AGE_MS) return null
    const value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value
    if (!value?.cards) return null
    return { ...value, cached: true, cachedAt: row.updated_at || null }
  } catch {
    return null
  }
}

async function writeCache(db, key, payload) {
  try {
    const now = new Date().toISOString()
    await db.execute({
      sql:
        'INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?) '
        + 'ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
      args: [key, JSON.stringify({ ...payload, cached: undefined }), now],
    })
  } catch {
    /* cache write is best-effort */
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed' })
  }
  try {
    await requireUser(req)
    const body = req.method === 'POST' ? await readJson(req) : {}
    const section = String(body.section || req.query?.section || 'dav').toLowerCase()
    const force = Boolean(body.force || req.query?.force)
    const db = getTurso()
    const key = metricsCacheKey(section)

    if (!force) {
      const cached = await readCache(db, key)
      if (cached) {
        return json(res, 200, cached)
      }
    }

    const payload = await computeSectionMetrics(db, section)
    await writeCache(db, key, payload)
    return json(res, 200, { ...payload, cached: false })
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || String(e) })
  }
}
