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
    let value = row?.value
    try {
      value = typeof value === 'string' ? JSON.parse(value) : value
    } catch { /* keep string */ }

    let count = value?.count ?? value?.synced ?? null
    let stats = null
    if (section === 'dav') {
      const [tot, hl, tags] = await Promise.all([
        db.execute('SELECT COUNT(*) AS c FROM dav_drugs'),
        db.execute('SELECT COUNT(*) AS c FROM dav_drugs WHERE con_hieu_luc = 1'),
        db.execute('SELECT tag_id AS id, COUNT(*) AS c FROM dav_drugs GROUP BY tag_id'),
      ])
      count = Number(tot.rows[0]?.c || 0)
      stats = {
        total: count,
        hieuLuc: Number(hl.rows[0]?.c || 0),
        byTag: Object.fromEntries((tags.rows || []).map((r) => [r.id || 'none', Number(r.c || 0)])),
      }
    } else if (section === 'vss') {
      const tot = await db.execute('SELECT COUNT(*) AS c FROM vss_bids')
      count = Number(tot.rows[0]?.c || count || 0)
      stats = { total: count }
    } else if (section === 'msc' || section === 'msc_prices') {
      const [p, t] = await Promise.all([
        db.execute('SELECT COUNT(*) AS c FROM msc_prices'),
        db.execute('SELECT COUNT(*) AS c FROM msc_tenders'),
      ])
      count = Number(p.rows[0]?.c || 0)
      stats = { prices: count, tenders: Number(t.rows[0]?.c || 0), total: count }
    }

    if (!row && !stats) return json(res, 200, null)
    return json(res, 200, {
      ...(value && typeof value === 'object' ? value : value != null ? { value } : {}),
      updated: value?.updated || value?.synced_at || row?.updated_at || null,
      count,
      stats,
    })
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || String(e) })
  }
}
