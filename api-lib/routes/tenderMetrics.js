/**
 * POST /api/tender/metrics
 * Body: { section: 'dav'|'vss'|'msc_prices'|'msc_tenders'|'msc' }
 * Auth: Bearer <supabase access_token>
 * Returns pre-aggregated metric cards (+ optional province tables).
 */
import { performance } from 'node:perf_hooks'
import { requireUser, json, readJson } from '../auth.js'
import { getTurso } from '../turso.js'
import { computeSectionMetrics, metricsCacheKey } from '../metricsCompute.js'
import { beginTiming, traceDb } from '../timing.js'
import { searchBackend } from '../backend.js'
import { readBootstrap } from '../catalog.js'
import { emptyMetrics, readSection } from '../metricsRollup.js'
import { slicePayload } from '../metricSlice.js'
import { baoanCatalogItems } from '../baoanCatalog.js'
import { buildPortfolio } from '../portfolioCloud.js'
import * as tidbDb from '../db/tidb.js'

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
  const timing = beginTiming(`${req.method} /api/tender/metrics`)
  let section = 'dav'
  let isSlice = false
  try {
    const auth0 = performance.now()
    const { accessToken } = await requireUser(req)
    timing.add('auth', performance.now() - auth0)
    const body = req.method === 'POST' ? await readJson(req) : {}
    section = String(body.section || req.query?.section || 'dav').toLowerCase()
    const force = Boolean(body.force || req.query?.force)
    const backend = searchBackend()
    const query = (sql, args) => tidbDb.query(sql, args)
    isSlice = Boolean(body.slice || body.mode === 'slice' || section === 'msc_match')
    if (isSlice) {
      const db0 = performance.now()
      const payload = await slicePayload(query, { ...body, section })
      timing.noteDb(performance.now() - db0)
      return json(res, 200, payload, timing)
    }
    if (section === 'baoan') {
      return json(res, 200, { items: baoanCatalogItems() }, timing)
    }
    if (section === 'portfolio') {
      const db0 = performance.now()
      const payload = await buildPortfolio(query, body.id ?? null, body.registration ?? null)
      timing.noteDb(performance.now() - db0)
      return json(res, 200, payload, timing)
    }
    if (backend === 'tidb') {
      const db0 = performance.now()
      const payload = await readSection((sql, args) => tidbDb.query(sql, args), section)
      timing.noteDb(performance.now() - db0)
      return json(res, 200, payload, timing)
    }
    if (backend !== 'turso') {
      const db0 = performance.now()
      const boot = await readBootstrap(section, accessToken)
      timing.noteDb(performance.now() - db0)
      if (boot.metrics_summary?.cards) return json(res, 200, boot.metrics_summary, timing)
      return json(res, 200, emptyMetrics(section), timing)
    }
    const db = traceDb(getTurso(), timing)
    const key = metricsCacheKey(section)

    if (!force) {
      const cached = await readCache(db, key)
      if (cached) {
        return json(res, 200, cached, timing)
      }
    }

    const payload = await computeSectionMetrics(db, section)
    await writeCache(db, key, payload)
    return json(res, 200, { ...payload, cached: false }, timing)
  } catch (e) {
    if (e.status === 401 || e.status === 403 || e.status === 400) {
      return json(res, e.status, { error: e.message || String(e) }, timing)
    }
    if (isSlice) return json(res, 503, { error: 'Chưa tính được chỉ số theo bộ lọc. Vui lòng thử lại.' }, timing)
    if (section === 'portfolio') return json(res, 503, { error: 'Chưa tải được danh mục và lịch sử trúng thầu. Vui lòng thử lại.' }, timing)
    return json(res, 200, emptyMetrics(section), timing)
  }
}
