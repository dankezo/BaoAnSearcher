/**
 * POST /api/tender/search
 * Body: { kind: 'vss'|'dav'|'msc_prices'|'msc_tenders', filters, page, size }
 * Auth: Bearer <supabase access_token>
 */
import { performance } from 'node:perf_hooks'
import { requireUser, json, readJson } from '../auth.js'
import { mapTursoItems } from '../mapRow.js'
import { beginTiming } from '../timing.js'
import { searchBackend } from '../backend.js'
import { searchSupabase } from '../supabaseSearch.js'
import { buildSearchSql, cursorOf } from '../db/searchSql.js'
import * as tursoDb from '../db/turso.js'
import * as tidbDb from '../db/tidb.js'
import { attachScope } from '../scopeMatch.js'

const ADAPTERS = { turso: tursoDb, tidb: tidbDb }

async function rowsOf(db, sql, args) {
  if (db?.dialect && typeof db.query === 'function') {
    const rs = await db.query(sql, args)
    return rs.rows || []
  }
  const rs = await db.execute({ sql, args })
  return rs.rows || []
}

function normalizeKind(kind) {
  const value = String(kind || 'vss').toLowerCase()
  if (value === 'prices') return 'msc_prices'
  if (value === 'tenders') return 'msc_tenders'
  return value
}

async function runSearch(db, kind, filters, page, size, cursor) {
  const dialect = db?.dialect || 'turso'
  const built = buildSearchSql({ kind, filters, page, size, cursor, dialect })
  if (built.empty) return { total: null, page, size, hasMore: false, items: [], nextCursor: null }
  const rows = await rowsOf(db, built.sql, built.args)
  const hasMore = rows.length > size
  const items = hasMore ? rows.slice(0, size) : rows
  if (normalizeKind(kind) === 'msc_tenders') attachScope(items)
  return {
    total: null,
    page,
    size,
    hasMore,
    items,
    nextCursor: cursorOf(kind, items[items.length - 1]),
  }
}

export async function searchVss(db, filters, page, size, options = {}) {
  return runSearch(db, 'vss', filters, page, size, options.cursor || null)
}

export async function searchDav(db, filters, page, size, options = {}) {
  return runSearch(db, 'dav', filters, page, size, options.cursor || null)
}

export async function searchMsc(db, kind, filters, page, size, options = {}) {
  return runSearch(db, normalizeKind(kind), filters, page, size, options.cursor || null)
}

export async function countSearch(db, kind, filters) {
  const dialect = db?.dialect || 'turso'
  const built = buildSearchSql({ kind: normalizeKind(kind), filters, dialect })
  if (built.empty) return 0
  const rows = await rowsOf(db, built.countSql, built.countArgs)
  const row = rows[0] || {}
  const value = row.total ?? row.TOTAL ?? Object.values(row)[0]
  const total = Number(value)
  return Number.isFinite(total) ? total : 0
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }
  const timing = beginTiming('POST /api/tender/search')
  try {
    const auth0 = performance.now()
    const { accessToken } = await requireUser(req)
    timing.add('auth', performance.now() - auth0)
    const body = await readJson(req)
    const kind = normalizeKind(body.kind)
    const page = Math.max(0, parseInt(body.page, 10) || 0)
    const size = Math.min(2000, Math.max(1, parseInt(body.size, 10) || 100))
    const backend = searchBackend()
    const db0 = performance.now()
    let payload
    if (backend === 'supabase') {
      payload = await searchSupabase(accessToken, kind, body.filters, page, size, body.cursor || null)
    } else {
      const db = ADAPTERS[backend] || tursoDb
      payload = await runSearch(db, kind, body.filters, page, size, body.cursor || null)
    }
    timing.noteDb(performance.now() - db0)
    payload = { ...payload, items: mapTursoItems(payload.items) }
    return json(res, 200, payload, timing)
  } catch (e) {
    const status = e.status || 500
    return json(res, status, { error: e.message || String(e) }, timing)
  }
}
