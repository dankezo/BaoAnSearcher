/**
 * SEARCH_BACKEND=turso|tidb|supabase
 * Default supabase: Turso reads are retired. Set turso only for rollback.
 */
export function searchBackend() {
  const raw = String(process.env.SEARCH_BACKEND || 'supabase').trim().toLowerCase()
  if (raw === 'turso' || raw === 'tidb' || raw === 'supabase') return raw
  return 'supabase'
}

export function backendUnavailable(backend) {
  const err = new Error(
    backend === 'tidb'
      ? 'TiDB chưa cấu hình. Đặt TIDB_DATABASE_URL hoặc TIDB_HOST, TIDB_USER, TIDB_DATABASE.'
      : 'Kho dữ liệu chưa cấu hình.',
  )
  err.status = 503
  return err
}
