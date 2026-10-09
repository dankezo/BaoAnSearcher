/**
 * Hybrid cloud search: Supabase Auth session → Vercel /api/tender → Turso.
 * Falls back to Supabase RPC if Turso API is unavailable (503).
 */
import { getSupabase, supabaseConfigured } from './supabaseClient'
import { mapTursoItems } from './tursoMap'
import { buildDavRpcParams } from './services/davRpc'
import { cachedQuery, stableKey } from './queryCache'

export { supabaseConfigured, getSupabase }

/** Prefer Turso hybrid when auth is configured (API verifies JWT). */
export const tursoHybridEnabled = supabaseConfigured

function fold(text) {
  const s = String(text ?? '').toLowerCase().replace(/đ/g, 'd')
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function foldParam(v) {
  const s = fold(v || '').trim()
  return s || null
}

async function accessToken() {
  const sb = getSupabase()
  if (!sb) throw new Error('Chưa cấu hình Supabase Auth.')
  const { data, error } = await sb.auth.getSession()
  if (error) throw new Error(error.message)
  const token = data.session?.access_token
  if (!token) throw new Error('Unauthorized — vui lòng đăng nhập lại.')
  return token
}

const abortByKey = new Map()

async function rawTender(path, body, { method = 'POST', abortKey } = {}) {
  const token = await accessToken()
  const controller = new AbortController()
  if (abortKey) {
    abortByKey.get(abortKey)?.abort()
    abortByKey.set(abortKey, controller)
  }
  const timeout = setTimeout(() => controller.abort(), 55_000)
  try {
    const res = await fetch(path, {
      method,
      signal: controller.signal,
      headers: {
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
      },
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
    })
    const text = await res.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = { error: text }
    }
    if (!res.ok) {
      const err = new Error(payload?.error || text || res.statusText)
      err.status = res.status
      throw err
    }
    if (!payload || typeof payload !== 'object' || payload.error) throw new Error('API dữ liệu chưa sẵn sàng.')
    return payload
  } finally {
    clearTimeout(timeout)
    if (abortKey && abortByKey.get(abortKey) === controller) abortByKey.delete(abortKey)
  }
}

async function tenderFetch(path, body, options = {}) {
  const method = options.method || 'POST'
  const key = stableKey(`${method} ${path}`, method === 'POST' ? body : null)
  return cachedQuery(key, () => rawTender(path, body, options), {
    freshMs: options.freshMs ?? 10000,
    staleMs: options.staleMs ?? 60000,
  })
}

export function cloudMap(body) {
  return tenderFetch('/api/metrics/map', body || {}, {
    freshMs: 20000,
    staleMs: 120000,
    abortKey: 'metrics:map',
  })
}

export function cloudBootstrap(section) {
  const safe = encodeURIComponent(section || 'vss')
  return tenderFetch(`/api/tender/bootstrap?section=${safe}`, null, {
    method: 'GET',
    freshMs: 30000,
    staleMs: 120000,
  })
}

export async function cloudSuggest(section, field, q) {
  const params = new URLSearchParams({
    section: String(section || 'vss'),
    field: String(field || ''),
    q: String(q || ''),
  })
  const payload = await tenderFetch(`/api/tender/suggest?${params}`, null, {
    method: 'GET',
    freshMs: 20000,
    staleMs: 60000,
    abortKey: `suggest:${section}:${field}`,
  })
  return payload?.items || []
}

function normalizePage(payload, page, size) {
  return {
    total: payload?.total ?? null,
    page: payload?.page ?? page,
    size: payload?.size ?? size,
    hasMore: payload?.hasMore === true,
    nextCursor: payload?.nextCursor || null,
    items: mapTursoItems(payload?.items || []),
  }
}

function filterParam(v) {
  if (v == null || v === '') return null
  if (Array.isArray(v)) {
    const xs = v.map((x) => String(x ?? '').trim()).filter(Boolean)
    return xs.length ? xs.join('|') : null
  }
  const s = String(v).trim()
  return s || null
}

async function supabaseVss(filters, page, size) {
  const sb = getSupabase()
  const f = filters || {}
  let nam = null
  const namRaw = filterParam(f.nam)
  if (namRaw) {
    const first = namRaw.split('|')[0]
    const n = parseInt(first, 10)
    if (!Number.isNaN(n)) nam = n
  }
  const { data, error } = await sb.rpc('search_vss_bids', {
    p_q: foldParam(f.q),
    p_hoatchat: foldParam(f.hoatchat) || filterParam(f.hoatchat),
    p_sodk: filterParam(f.sodk),
    p_loai: filterParam(f.loai),
    p_nhomthau: filterParam(f.nhomthau),
    p_loai_thau: filterParam(f.loai_thau),
    p_duongdung: filterParam(f.duongdung),
    p_ma_tinh: filterParam(f.ma_tinh),
    p_nuocsx: filterParam(f.nuocsx),
    p_nam: nam,
    p_tu_ngay: f.tuNgay || null,
    p_den_ngay: f.denNgay || null,
    p_page: page,
    p_size: size,
  })
  if (error) throw new Error(error.message || String(error))
  const payload = typeof data === 'string' ? JSON.parse(data) : data
  return {
    total: payload?.total ?? 0,
    page: payload?.page ?? page,
    size: payload?.size ?? size,
    items: payload?.items || [],
  }
}

/** Cloud search — Turso first, Supabase RPC fallback. */
/**
 * @param {{ filters?: object, page?: number, size?: number, cursor?: Record<string, string> | null }} [opts]
 */
export async function cloudVssSearch({ filters = {}, page = 0, size = 100, cursor = null } = {}) {
  if (!supabaseConfigured) throw new Error('Chưa cấu hình Supabase (VITE_SUPABASE_URL / ANON_KEY).')
  try {
    const payload = await tenderFetch('/api/tender/search', {
      kind: 'vss',
      filters,
      page,
      size,
      cursor,
    }, { abortKey: 'search:vss' })
    return normalizePage(payload, page, size)
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw e
    // Turso API missing / not deployed yet → legacy Supabase
    return supabaseVss(filters, page, size)
  }
}

/**
 * @param {{ filters?: object, page?: number, size?: number, cursor?: Record<string, string> | null }} [opts]
 */
export async function cloudDavSearch({ filters = {}, page = 0, size = 100, cursor = null } = {}) {
  if (!supabaseConfigured) throw new Error('Chưa cấu hình Supabase (VITE_SUPABASE_URL / ANON_KEY).')
  try {
    const payload = await tenderFetch('/api/tender/search', {
      kind: 'dav',
      filters,
      page,
      size,
      cursor,
    }, { abortKey: 'search:dav' })
    return normalizePage(payload, page, size)
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw e
    if (filters.tenderGroup?.length) throw new Error('Chưa tải được nhóm thầu từ nguồn chính. Nguồn DAV dự phòng chưa hỗ trợ bộ lọc nhóm; vui lòng thử lại.')
    const sb = getSupabase()
    const { data, error } = await sb.rpc('search_dav_drugs', buildDavRpcParams(filters, page, size))
    if (error) throw new Error(error.message || String(error))
    const payload = typeof data === 'string' ? JSON.parse(data) : data
    return {
      total: payload?.total ?? 0,
      page: payload?.page ?? page,
      size: payload?.size ?? size,
      items: mapTursoItems(payload?.items || []),
    }
  }
}

/**
 * @param {{ kind?: string, filters?: object, page?: number, size?: number, cursor?: Record<string, string> | null }} [opts]
 */
export async function cloudMscSearch({ kind = 'prices', filters = {}, page = 0, size = 100, cursor = null } = {}) {
  if (!supabaseConfigured) throw new Error('Chưa cấu hình Supabase (VITE_SUPABASE_URL / ANON_KEY).')
  try {
    const payload = await tenderFetch('/api/tender/search', {
      kind: kind === 'tenders' ? 'msc_tenders' : 'msc_prices',
      filters,
      page,
      size,
      cursor,
    }, { abortKey: `search:msc:${kind}:${stableKey('f', { filters, cursor, size })}` })
    return normalizePage(payload, page, size)
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw e
    const sb = getSupabase()
    const f = filters || {}
    const { data, error } = await sb.rpc('search_msc', {
      p_kind: kind === 'tenders' ? 'tenders' : 'prices',
      p_q: foldParam(f.q),
      p_page: page,
      p_size: size,
    })
    if (error) throw new Error(error.message || String(error))
    const payload = typeof data === 'string' ? JSON.parse(data) : data
    return {
      total: payload?.total ?? 0,
      page: payload?.page ?? page,
      size: payload?.size ?? size,
      items: mapTursoItems(payload?.items || []),
    }
  }
}

export async function cloudMeta(section) {
  if (!supabaseConfigured) return null
  try {
    const boot = await cloudBootstrap(section)
    return boot?.meta || null
  } catch {
    return null
  }
}

export function cloudMapFacilityIngredients(body) {
  return tenderFetch('/api/metrics/map/facility-ingredients', body, { freshMs: 20000, abortKey: 'map:facility' })
}

/** The Cloud admin view fetches only the four registry rows from TiDB. */
export function cloudDataRegistry() {
  return tenderFetch('/api/admin/datasets', null, {
    method: 'GET', freshMs: 5000, staleMs: 30000, abortKey: 'admin:data-registry',
  })
}

/** Resolve an authenticated direct R2 CSV URL; no file bytes pass through Vercel. */
export function cloudDatasetDownload(code) {
  return tenderFetch(`/api/admin/datasets/download/${encodeURIComponent(code)}`, null, {
    method: 'GET', freshMs: 0, staleMs: 0,
  })
}

/** Explicit count endpoint retained for offline reports only; never call it in a table flow. */
export async function cloudCount(kind, filters) {
  const payload = await tenderFetch('/api/tender/count', { kind, filters }, { abortKey: `count:${kind}` })
  const total = Number(payload?.total)
  return Number.isFinite(total) ? total : null
}

/** Pre-aggregated metric cards. Uses the bootstrap payload when it already has them. */
export async function cloudMetrics(section, { force = false } = {}) {
  if (!supabaseConfigured) return null
  if (!force) {
    const boot = await cloudBootstrap(section)
    if (boot?.metrics_summary?.cards?.length >= 4 || (section !== 'dav' && boot?.metrics_summary?.cards)) {
      if (section !== 'dav' && section !== 'msc_prices' && section !== 'msc_tenders') return boot.metrics_summary
    }
  }
  return tenderFetch('/api/tender/metrics', { section, force }, { abortKey: `metrics:${section}` })
}

export function cloudMetricsSlice(body) {
  return tenderFetch('/api/tender/metrics', { ...(body || {}), slice: true }, {
    freshMs: 20000,
    staleMs: 120000,
    abortKey: `slice:${body?.section || ''}`,
  })
}

export function cloudCatalog() {
  return tenderFetch('/api/tender/metrics', { section: 'baoan' }, { freshMs: 60000, staleMs: 300000, abortKey: 'baoan-catalog' })
}

export function cloudPortfolio(id, registration) {
  return tenderFetch('/api/tender/metrics', {
    section: 'portfolio',
    id: id ?? null,
    registration: registration ?? null,
  }, { freshMs: 60000, staleMs: 300000, abortKey: id == null ? 'portfolio' : `portfolio:${id}` })
}

export function cloudMatchReport(body) {
  return tenderFetch('/api/tender/metrics', { section: 'msc_match', ...(body || {}) }, {
    freshMs: 15000,
    staleMs: 60000,
    abortKey: `match:${body?.level || 'all'}`,
  })
}
