/**
 * POST /api/tender/count
 * Body: { kind, filters }
 * Returns { total } without blocking the page query.
 */
import { performance } from 'node:perf_hooks'
import { requireUser, json, readJson } from '../auth.js'
import { beginTiming } from '../timing.js'
import { searchBackend } from '../backend.js'
import { countSupabase } from '../supabaseSearch.js'
import { countSearch } from './tenderSearch.js'
import * as tursoDb from '../db/turso.js'
import * as tidbDb from '../db/tidb.js'

const ADAPTERS = { turso: tursoDb, tidb: tidbDb }

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }
  const timing = beginTiming('POST /api/tender/count')
  try {
    const auth0 = performance.now()
    const { accessToken } = await requireUser(req)
    timing.add('auth', performance.now() - auth0)
    const body = await readJson(req)
    const kind = String(body.kind || 'vss').toLowerCase()
    const backend = searchBackend()
    const db0 = performance.now()
    const total = backend === 'supabase'
      ? await countSupabase(accessToken, kind, body.filters)
      : await countSearch(ADAPTERS[backend] || tursoDb, kind, body.filters)
    timing.noteDb(performance.now() - db0)
    return json(res, 200, { total }, timing)
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || String(e) }, timing)
  }
}
