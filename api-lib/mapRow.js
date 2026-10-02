/** Turso snake_case → SPA keys (server-side). Keep originals + camelCase aliases. */
export function snakeToCamelKey(key) {
  return String(key || '').replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

const DATE_MIN_Y = 2000
const DATE_MAX_Y = 2035

export function sanitizeDateValue(v) {
  if (v == null || v === '') return null
  const s = String(v).trim()
  const m = s.match(/^(\d{4})/)
  if (!m) return null
  const y = parseInt(m[1], 10)
  if (y < DATE_MIN_Y || y > DATE_MAX_Y) return null
  return s
}

const VSS_DATE_KEYS = [
  'tungay_hd', 'denngay_hd', 'congbo', 'tungay', 'denngay', 'created_date',
  'tungayHd', 'denngayHd', 'createdDate',
]

export function mapTursoRow(row) {
  if (!row || typeof row !== 'object') return row
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    out[k] = v
    const camel = snakeToCamelKey(k)
    if (camel !== k && !(camel in out)) out[camel] = v
  }
  if ('conHieuLuc' in out || 'con_hieu_luc' in out) {
    const raw = out.conHieuLuc ?? out.con_hieu_luc
    out.conHieuLuc = raw === true || raw === 1 || raw === '1'
  }
  if (Array.isArray(out.tagId)) out.tagId = out.tagId[0] || ''
  if (Array.isArray(out.tag_id)) out.tag_id = out.tag_id[0] || ''

  for (const k of VSS_DATE_KEYS) {
    if (k in out) {
      const clean = sanitizeDateValue(out[k])
      out[k] = clean
      const camel = snakeToCamelKey(k)
      if (camel !== k) out[camel] = clean
    }
  }
  return out
}

export function mapTursoItems(items) {
  return (items || []).map(mapTursoRow)
}
