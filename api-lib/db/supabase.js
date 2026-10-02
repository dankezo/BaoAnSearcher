/**
 * Supabase has no raw-SQL HTTP for the user JWT.
 * Search and count go through PostgREST in supabaseSearch.js.
 * query() exists so the three adapters share the same module shape.
 */
export const dialect = 'supabase'

export async function query() {
  const err = new Error('Supabase không nhận SQL thô. Tìm kiếm đi qua PostgREST.')
  err.status = 501
  throw err
}
