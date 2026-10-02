/**
 * GET /api/tender/bootstrap?section=vss|dav|msc
 * One payload for dataVersion + meta + cached metrics.
 */
import { performance } from 'node:perf_hooks'
import { requireUser, json } from '../auth.js'
import { beginTiming } from '../timing.js'
import { readBootstrap } from '../catalog.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }
  const timing = beginTiming(`${req.method} /api/tender/bootstrap`)
  try {
    const auth0 = performance.now()
    const { accessToken } = await requireUser(req)
    timing.add('auth', performance.now() - auth0)
    const url = new URL(req.url || '/', 'https://app.baoanpharma.com')
    const section = String(url.searchParams.get('section') || 'vss').toLowerCase()
    const db0 = performance.now()
    const payload = await readBootstrap(section, accessToken)
    timing.noteDb(performance.now() - db0)
    return json(res, 200, payload, timing)
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || String(e) }, timing)
  }
}
