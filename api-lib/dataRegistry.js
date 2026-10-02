/**
 * The Data Management Hub intentionally reads four metadata rows only.
 * Catalog-table COUNT(*) belongs in the asynchronous sync job, never here.
 */
import * as tidbDb from './db/tidb.js'

export const DATASET_CODES = new Set(['DAV', 'MSC_PRICE', 'MSC_BID', 'VSS'])

const ORDER = "FIELD(dataset_code, 'DAV', 'MSC_PRICE', 'MSC_BID', 'VSS')"

function asNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function shape(row) {
  return {
    id: asNumber(row.id),
    code: String(row.dataset_code || ''),
    name: String(row.dataset_name || ''),
    description: String(row.description || ''),
    totalRecords: asNumber(row.total_records),
    status: ['healthy', 'syncing', 'warning'].includes(row.status) ? row.status : 'warning',
    lastSyncedAt: row.last_synced_at || null,
    r2DownloadUrl: row.r2_download_url || null,
    fileSizeMb: row.file_size_mb == null ? null : asNumber(row.file_size_mb),
  }
}

export async function listDataRegistry() {
  const result = await tidbDb.query(
    `SELECT id, dataset_code, dataset_name, description, total_records, status,
            last_synced_at, r2_download_url, file_size_mb
       FROM data_registry_meta
      ORDER BY ${ORDER}`,
  )
  return (result.rows || []).map(shape)
}

export async function getDataRegistry(code) {
  const result = await tidbDb.query(
    `SELECT id, dataset_code, dataset_name, description, total_records, status,
            last_synced_at, r2_download_url, file_size_mb
       FROM data_registry_meta
      WHERE dataset_code = ? LIMIT 1`,
    [String(code || '').toUpperCase()],
  )
  return result.rows?.[0] ? shape(result.rows[0]) : null
}
