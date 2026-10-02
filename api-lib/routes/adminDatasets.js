/** GET /api/admin/datasets — four small TiDB metadata rows, never catalog data. */
import { requireUser, json } from '../auth.js'
import { performance } from 'node:perf_hooks'
import { listDataRegistry } from '../dataRegistry.js'
import { beginTiming } from '../timing.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  const timing = beginTiming('GET /api/admin/datasets')
  try {
    await requireUser(req)
    const started = performance.now()
    const datasets = await listDataRegistry()
    timing.noteDb(performance.now() - started)
    return json(res, 200, { datasets }, timing)
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || String(error) }, timing)
  }
}
