/**
 * GET /api/tender/suggest?section=&field=&q=
 * High-cardinality typeahead. Province and tender group stay in static JSON.
 */
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireUser, json } from '../auth.js'
import { beginTiming } from '../timing.js'
import { searchBackend } from '../backend.js'
import { suggestSupabase, SUGGEST_FIELDS } from '../supabaseSearch.js'
import { fold } from '../turso.js'
import * as tidbDb from '../db/tidb.js'

const staticPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/public/data/suggest-static.json')
let staticDoc

function staticValues() {
  if (!staticDoc) staticDoc = JSON.parse(readFileSync(staticPath, 'utf8'))
  return staticDoc
}

function fromStatic(section, field, q) {
  const doc = staticValues()
  const bucket = doc[section] || (String(section).startsWith('msc') ? doc.msc : null) || {}
  const list = bucket[field] || []
  const needle = fold(q)
  return list.filter((item) => {
    const value = typeof item === 'string' ? item : item.value
    const label = typeof item === 'string' ? item : (item.label || item.value)
    return !needle || fold(value).includes(needle) || fold(label).includes(needle)
  }).map((item) => (typeof item === 'string' ? item : item.value)).slice(0, 8)
}

async function suggestTidb(section, field, q) {
  const spec = SUGGEST_FIELDS[section] || (String(section).startsWith('msc') ? SUGGEST_FIELDS.msc_prices : null)
  const column = spec?.columns?.[field]
  const needle = fold(q).trim()
  if (!spec || !column || needle.length < 2) return []
  try {
    const rs = await tidbDb.query(
      'SELECT value FROM suggest_values WHERE section = ? AND field = ? AND value LIKE ? ORDER BY cnt DESC LIMIT 8',
      [section, field, `%${needle}%`],
    )
    return (rs.rows || []).map((row) => String(row.value ?? '').trim()).filter(Boolean)
  } catch {
    return []
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method not allowed' })
  }
  const timing = beginTiming('GET /api/tender/suggest')
  try {
    const auth0 = performance.now()
    const { accessToken } = await requireUser(req)
    timing.add('auth', performance.now() - auth0)
    const url = new URL(req.url || '/', 'https://app.baoanpharma.com')
    const section = String(url.searchParams.get('section') || 'vss').toLowerCase()
    const field = String(url.searchParams.get('field') || '')
    const q = String(url.searchParams.get('q') || '')
    const low = fromStatic(section, field, q)
    const lowFields = new Set(['ma_tinh', 'ten_tinh', 'nhomthau', 'province', 'group_name'])
    if (lowFields.has(field)) {
      return json(res, 200, { items: low }, timing)
    }
    const backend = searchBackend()
    if (backend === 'turso') {
      return json(res, 200, { items: [] }, timing)
    }
    const db0 = performance.now()
    const items = backend === 'tidb'
      ? await suggestTidb(section, field, q)
      : await suggestSupabase(accessToken, section, field, q)
    timing.noteDb(performance.now() - db0)
    return json(res, 200, { items }, timing)
  } catch (e) {
    return json(res, e.status || 500, { error: e.message || String(e) }, timing)
  }
}
