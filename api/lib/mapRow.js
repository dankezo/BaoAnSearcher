/** Turso snake_case → SPA camelCase */
export function mapTursoRow(row) {
  if (!row || typeof row !== 'object') return row
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    const camel = String(k).replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    out[camel] = v
  }
  if ('conHieuLuc' in out) {
    out.conHieuLuc = out.conHieuLuc === true || out.conHieuLuc === 1 || out.conHieuLuc === '1'
  }
  if (Array.isArray(out.tagId)) out.tagId = out.tagId[0] || ''
  return out
}

export function mapTursoItems(items) {
  return (items || []).map(mapTursoRow)
}
