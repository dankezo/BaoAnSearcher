const API_BASE = import.meta.env.VITE_API_BASE || ''

async function request(path, opts = {}) {
  const { timeoutMs = 55000, ...fetchOpts } = opts
  const ctrl = new AbortController()
  const external = fetchOpts.signal
  if (external) {
    if (external.aborted) ctrl.abort()
    else external.addEventListener('abort', () => ctrl.abort(), { once: true })
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(fetchOpts.headers || {}) },
      ...fetchOpts,
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || res.statusText)
    }
    return res.json()
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new Error('Hết thời gian chờ API (có thể server đang bận crawl). Thử lại sau vài giây.')
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export async function health() {
  try {
    return await request('/api/health')
  } catch {
    return null
  }
}

export const api = {
  health,
  status: () => request('/api/status'),
  secrets: () => request('/api/secrets'),
  saveSecrets: (body) => request('/api/secrets', { method: 'POST', body: JSON.stringify(body) }),
  dm93: () => request('/api/dm93'),
  davSearch: (body) => request('/api/dav/search', { method: 'POST', body: JSON.stringify(body) }),
  davCrawl: (body) => request('/api/dav/crawl', { method: 'POST', body: JSON.stringify(body || {}) }),
  davCrawlStop: () => request('/api/dav/crawl/stop', { method: 'POST', body: '{}' }),
  davValidity: () => request('/api/dav/validity/rebuild', { method: 'POST', body: '{}' }),
  mscSearch: (body) => request('/api/msc/search', { method: 'POST', body: JSON.stringify(body) }),
  mscPrices: (body) => request('/api/msc/crawl/prices', { method: 'POST', body: JSON.stringify(body) }),
  mscTenders: (body) => request('/api/msc/crawl/tenders', { method: 'POST', body: JSON.stringify(body) }),
  vssSearch: (body) => request('/api/vss/search', { method: 'POST', body: JSON.stringify(body) }),
  vssCrawl: (body) => request('/api/vss/crawl', { method: 'POST', body: JSON.stringify(body || {}) }),
  vssCrawlStop: () => request('/api/vss/crawl/stop', { method: 'POST', body: '{}' }),
  vssImport: (body) => request('/api/vss/import', { method: 'POST', body: JSON.stringify(body || {}) }),
  supabaseSync: (body) => request('/api/supabase/sync', { method: 'POST', body: JSON.stringify(body || {}), timeoutMs: 600000 }),
}

/* ------------------------------------------------------------------ */
/* Text utilities (mirror server/common.fold)                          */
/* ------------------------------------------------------------------ */

/** Lower-case, strip Vietnamese diacritics, đ → d. */
export function fold(text) {
  const s = String(text ?? '').toLowerCase().replace(/đ/g, 'd')
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Case/diacritic-insensitive "contains" using every whitespace-separated word. */
export function containsWords(haystack, needle) {
  const n = fold(needle).trim()
  if (!n) return true
  const h = fold(haystack)
  return n.split(/\s+/).every((w) => h.includes(w))
}

/** Extract 20xx year from a date-ish string or nam field. */
export function extractYear(row, keys = ['nam', 'congbo', 'tungay', 'tungay_hd', 'denngay_hd', 'ngayCap', 'ngayHetHan', 'published', 'created_date']) {
  if (row?.nam != null && String(row.nam).trim() !== '') {
    const y = String(row.nam).trim()
    if (/^20\d{2}$/.test(y)) return y
  }
  for (const k of keys) {
    const s = String(row?.[k] ?? '')
    const m = s.match(/(20\d{2})/)
    if (m) return m[1]
  }
  return ''
}

/**
 * VSS year filter: Excel has no "nam" column — catalog year = tungay_hd (→ congbo → tungay).
 * "Năm X" matches contracts effective in calendar year X (overlap tungay_hd…denngay_hd) or announced in X.
 * Does not use created_date alone.
 */
export function matchesYear(row, nam) {
  const y = String(nam ?? '').trim()
  if (!y || !/^20\d{2}$/.test(y)) return true
  if (String(row?.nam ?? '').trim() === y) return true
  const fields = [row?.tungay_hd, row?.denngay_hd, row?.congbo, row?.tungay, row?.denngay]
  if (fields.some((v) => String(v ?? '').includes(y))) return true
  const start = String(row?.tungay_hd || row?.tungay || '').slice(0, 10)
  const end = String(row?.denngay_hd || row?.denngay || '').slice(0, 10)
  if (start.length >= 4 && end.length >= 4 && start <= `${y}-12-31` && end >= `${y}-01-01`) return true
  return false
}

/** Sort rows by the first non-empty date-like field, newest first. */
export function sortByDateDesc(items, keys) {
  return [...(items || [])].sort((a, b) => {
    const da = keys.map((k) => String(a?.[k] ?? '')).find((v) => v) || ''
    const db = keys.map((k) => String(b?.[k] ?? '')).find((v) => v) || ''
    return db.localeCompare(da)
  })
}

/**
 * Apply simple client-side filters to an item list.
 * spec: [{ value, keys: ['field', ...] }] — each non-empty value must match at least one key.
 */
export function applyClientFilters(items, spec) {
  const active = spec.filter((s) => s && String(s.value ?? '').trim() !== '')
  if (!active.length) return items
  return items.filter((row) =>
    active.every(({ value, keys, exact }) =>
      keys.some((k) => {
        const v = row[k]
        if (v == null) return false
        return exact ? fold(v).trim() === fold(value).trim() : containsWords(v, value)
      }),
    ),
  )
}

/* ------------------------------------------------------------------ */
/* Static (GitHub Pages) data                                           */
/* ------------------------------------------------------------------ */

const staticCache = new Map()

/** Static Pages fallback: load gzipped JSON if present. Cached per name. */
export function loadStaticGz(name) {
  if (staticCache.has(name)) return staticCache.get(name)
  const p = (async () => {
    try {
      const res = await fetch(`./data/${name}.json.gz`)
      if (!res.ok) throw new Error('no gz')
      const buf = await res.arrayBuffer()
      const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength))
      const isGzip = head[0] === 0x1f && head[1] === 0x8b
      if (!isGzip) {
        // Server (e.g. Vite dev) already sent Content-Encoding: gzip → browser decoded it.
        return JSON.parse(new TextDecoder().decode(buf))
      }
      if (typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('gzip')
        const stream = new Response(buf).body.pipeThrough(ds)
        const text = await new Response(stream).text()
        return JSON.parse(text)
      }
      throw new Error('no DecompressionStream')
    } catch {
      try {
        const plain = await fetch(`./data/${name}.json`)
        if (plain.ok) return plain.json()
      } catch { /* ignore */ }
      return null
    }
  })()
  staticCache.set(name, p)
  p.then((v) => { if (v == null) staticCache.delete(name) })
  return p
}

/** Derive "last updated" from a static export payload (no server). */
export function staticUpdated(payload, fields = ['_collected_at', 'collected_at', 'created_date']) {
  if (!payload) return null
  const u = payload.updated
  if (typeof u === 'string' && u) return u
  if (u && typeof u === 'object' && typeof u.updated === 'string') return u.updated // export ships meta_info() here
  if (typeof payload.meta?.updated === 'string') return payload.meta.updated
  if (typeof payload.exported_at === 'string') return payload.exported_at
  let best = null
  for (const it of payload.items || []) {
    for (const f of fields) {
      const v = it?.[f]
      if (v && (!best || String(v) > best)) best = String(v)
    }
  }
  return best
}

/* ------------------------------------------------------------------ */
/* Status / freshness                                                   */
/* ------------------------------------------------------------------ */

let statusPromise = null
let statusAt = 0

/** Cached /api/status (5s). Returns null when API is unavailable. */
export function getStatus(force = false) {
  const now = Date.now()
  if (!force && statusPromise && now - statusAt < 5000) return statusPromise
  statusAt = now
  statusPromise = api.status().catch(() => null)
  return statusPromise
}

/** Static build may ship ./data/status.json (optional). */
let staticStatusPromise = null
export function getStaticStatus() {
  if (!staticStatusPromise) {
    staticStatusPromise = fetch('./data/status.json')
      .then((r) => (r.ok && /json/i.test(r.headers.get('content-type') || '') ? r.json() : null))
      .catch(() => null)
  }
  return staticStatusPromise
}

/** Extract {updated, count} for a section from a status payload. */
export function sectionMeta(status, section) {
  const s = status?.[section]
  if (!s) return { updated: null, count: null }
  const meta = s.meta || {}
  const count = meta.count ?? s.count ?? (meta.prices != null ? (meta.prices || 0) + (meta.tenders || 0) : null)
  return { updated: meta.updated || s.updated || null, count, state: s.state, message: s.message }
}

/** Format ISO-ish timestamps to dd/MM/yyyy HH:mm (Vietnamese). */
export function fmtDateTime(v) {
  if (!v) return ''
  const s = String(v)
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/)
  if (!m) return s
  return m[4] ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : `${m[3]}/${m[2]}/${m[1]}`
}

export function fmtDate(v) {
  if (!v) return ''
  const s = String(v)
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return s
}

export function relativeTime(v) {
  if (!v) return ''
  const t = new Date(String(v).replace(' ', 'T')).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const min = Math.round(diff / 60000)
  if (min < 1) return 'vừa xong'
  if (min < 60) return `${min} phút trước`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} giờ trước`
  const d = Math.round(h / 24)
  if (d < 30) return `${d} ngày trước`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo} tháng trước`
  return `${Math.round(mo / 12)} năm trước`
}

export const DAV_LOOKUP = 'https://dichvucong.dav.gov.vn/congbothuoc/index'

export function openDavLookup(tenThuoc) {
  try {
    navigator.clipboard?.writeText(tenThuoc || '')
  } catch { /* ignore */ }
  window.open(DAV_LOOKUP, '_blank', 'noopener,noreferrer')
}
