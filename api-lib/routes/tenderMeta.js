/**
 * GET/POST /api/tender/meta?section=vss|dav|msc
 * Catalog totals come from app_metadata (one row per dataset), not COUNT(*).
 * Auth: Bearer <supabase access_token>
 */
import { performance } from 'node:perf_hooks'
import { requireUser, json, readJson } from '../auth.js'
import { beginTiming } from '../timing.js'
import { readBootstrap } from '../catalog.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  const timing = beginTiming(`${req.method} /api/tender/meta`)
  try {
    const auth0 = performance.now()
    const { accessToken } = await requireUser(req)
    timing.add('auth', performance.now() - auth0)
    const body = req.method === 'POST' ? await readJson(req) : {}
    const section = String(
      body.section || req.query?.section || 'vss',
    ).toLowerCase()
    const db0 = performance.now()
    const boot = await readBootstrap(section, accessToken)
    timing.noteDb(performance.now() - db0)
    return json(res, 200, boot.meta, timing)
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || String(e) }, timing)
  }
}
