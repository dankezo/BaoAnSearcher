/**
 * One-shot: create Turso performance indexes (same as sync_to_turso._ensure_indexes).
 * Usage: node scripts/ensure_turso_indexes.mjs
 * Env: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 */
import { createClient } from '@libsql/client'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const p of [resolve(root, '.env'), resolve(root, 'web/.env.local')]) {
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
}

const url = (process.env.TURSO_DATABASE_URL || '').trim()
const authToken = (process.env.TURSO_AUTH_TOKEN || '').trim()
if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN')
  process.exit(1)
}

const stmts = [
  'CREATE INDEX IF NOT EXISTS idx_dav_tag_id ON dav_drugs(tag_id)',
  'CREATE INDEX IF NOT EXISTS idx_dav_ngay_cap ON dav_drugs(ngay_cap DESC, ngay_gia_han DESC, id)',
  'CREATE INDEX IF NOT EXISTS idx_dav_search ON dav_drugs(search)',
  'CREATE INDEX IF NOT EXISTS idx_vss_loai ON vss_bids(loai)',
  'CREATE INDEX IF NOT EXISTS idx_vss_loai_nam ON vss_bids(loai, nam)',
  'CREATE INDEX IF NOT EXISTS idx_vss_tungay_fp ON vss_bids(tungay_hd DESC, fingerprint)',
  'CREATE INDEX IF NOT EXISTS idx_vss_search ON vss_bids(search)',
  'CREATE INDEX IF NOT EXISTS idx_msc_prices_pub ON msc_prices(published DESC, source_id)',
  'CREATE INDEX IF NOT EXISTS idx_msc_tenders_pub ON msc_tenders(published DESC, source_id)',
  'CREATE INDEX IF NOT EXISTS idx_msc_prices_search ON msc_prices(search)',
  'CREATE INDEX IF NOT EXISTS idx_msc_tenders_search ON msc_tenders(search)',
]

const db = createClient({ url, authToken })
for (const sql of stmts) {
  try {
    await db.execute(sql)
    console.log('OK', sql.slice(0, 60))
  } catch (e) {
    console.warn('WARN', sql.slice(0, 40), e.message)
  }
}
console.log('done')
