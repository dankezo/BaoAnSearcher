/**
 * POST /api/metrics/map
 * Province heat, summary cards, and facility dots from TiDB.
 */
import { requireUser, json, readJson } from '../auth.js'
import { searchBackend } from '../backend.js'
import * as tidbDb from '../db/tidb.js'
import { mapPayload, mapFacilityIngredients } from '../mapPayload.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  try {
    await requireUser(req)
    const body = await readJson(req)
    if (searchBackend() !== 'tidb') {
      return json(res, 503, {
        error: 'Chưa cấu hình dữ liệu bản đồ.',
        source: 'vss',
        months: 12,
        summary: null,
        provinces: [],
        regions: [],
        dots: [],
        ingredients: [],
      })
    }
    const payload = await (body.dotId ? mapFacilityIngredients : mapPayload)((sql, args) => tidbDb.query(sql, args), body || {})
    return json(res, 200, payload)
  } catch (error) {
    const status = error.status || 500
    if (status === 401 || status === 403) return json(res, status, { error: error.message || 'Unauthorized' })
    return json(res, 503, {
      error: 'Chưa tải được dữ liệu bản đồ theo bộ lọc. Vui lòng thử lại.',
      source: 'vss',
      months: 12,
      summary: { value: 0, prev: 0, yoy: 0, lots: 0, facilities: 0, trend: [], groups: [0, 0, 0, 0, 0], name: 'Bộ lọc hiện tại' },
      provinces: [],
      regions: [],
      dots: [],
      ingredients: [],
    })
  }
}
