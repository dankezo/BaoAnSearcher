import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(new URL('../tidb/004_data_registry_meta.sql', import.meta.url), 'utf8')

test('data registry migration creates exactly the lightweight metadata contract', () => {
  for (const needle of [
    'CREATE TABLE IF NOT EXISTS data_registry_meta',
    'dataset_code',
    'total_records BIGINT',
    "ENUM('healthy', 'syncing', 'warning')",
    'r2_download_url',
    'file_size_mb',
    "'DAV'", "'MSC_PRICE'", "'MSC_BID'", "'VSS'",
    'LEFT JOIN app_metadata',
  ]) assert.ok(sql.includes(needle), needle)
  const executableSql = sql.replace(/--.*$/gm, '')
  assert.doesNotMatch(executableSql, /COUNT\s*\(\s*\*\s*\)/i)
})
