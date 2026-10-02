import { getTurso } from '../turso.js'

export const dialect = 'turso'

export async function query(sql, args = []) {
  const rs = await getTurso().execute({ sql, args })
  return { rows: rs.rows || [] }
}
