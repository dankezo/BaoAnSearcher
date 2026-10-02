import { connect } from '@tidbcloud/serverless'

export const dialect = 'tidb'

let connection = null
let connectionUrl = ''

export function tidbUrl() {
  const direct = String(process.env.TIDB_DATABASE_URL || '').trim()
  if (direct) return direct
  const host = String(process.env.TIDB_HOST || '').trim()
  const user = String(process.env.TIDB_USER || '').trim()
  const database = String(process.env.TIDB_DATABASE || '').trim()
  const password = String(process.env.TIDB_PASSWORD || '')
  const port = String(process.env.TIDB_PORT || '4000').trim()
  if (!host || !user || !database) return ''
  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`
}

function client() {
  const url = tidbUrl()
  if (!url) {
    const err = new Error('TiDB chưa cấu hình. Đặt TIDB_DATABASE_URL hoặc TIDB_HOST, TIDB_USER, TIDB_DATABASE.')
    err.status = 503
    throw err
  }
  if (!connection || connectionUrl !== url) {
    connection = connect({ url })
    connectionUrl = url
  }
  return connection
}

export async function query(sql, args = []) {
  const rs = await client().execute(sql, args)
  const rows = Array.isArray(rs) ? rs : (rs?.rows || [])
  return { rows }
}
