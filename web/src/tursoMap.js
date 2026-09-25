/**
 * Turso/libSQL rows are snake_case; SPA expects camelCase (DAV/VSS/MSC flatten).
 */
export function snakeToCamelKey(key) {
  return String(key || '').replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

export function mapTursoRow(row) {
  if (!row || typeof row !== 'object') return row
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    out[snakeToCamelKey(k)] = v
  }
  // Booleans stored as 0/1 in SQLite
  if ('conHieuLuc' in out) {
    out.conHieuLuc = out.conHieuLuc === true || out.conHieuLuc === 1 || out.conHieuLuc === '1'
  }
  if (out.tagId != null && Array.isArray(out.tagId)) {
    out.tagId = out.tagId[0] || ''
  }
  return out
}

export function mapTursoItems(items) {
  return (items || []).map(mapTursoRow)
}
