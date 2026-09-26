/**
 * Drop non-compact columns on Turso (VSS/MSC only — NEVER touch dav_drugs).
 * Usage: node scripts/drop_non_compact_turso.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envText = readFileSync(join(root, '.env'), 'utf8')
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => {
    const i = l.indexOf('=')
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
  }),
)

const url = (env.TURSO_DATABASE_URL || '').trim()
const authToken = (env.TURSO_AUTH_TOKEN || '').trim()
if (!url || !authToken) {
  console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN')
  process.exit(1)
}

const client = createClient({ url, authToken })

/** dav_drugs intentionally omitted — keep full DAV schema. */
const KEEP = {
  vss_bids: new Set([
    'fingerprint', 'search', 'hoatchat', 'sodk', 'ten', 'duongdung', 'hamluong', 'donvitinh',
    'soluong', 'gia', 'thanhtien', 'nhomthau', 'nhasx', 'nuocsx', 'ma_tinh', 'ma_cskcb',
    'tungay_hd', 'denngay_hd', 'ten_tinh', 'ten_cskcb', 'loai_thau', 'loai', 'nam', 'congbo', 'updated_at',
  ]),
  msc_prices: new Set([
    'source_id', 'search', 'name', 'ingredient', 'strength', 'registration', 'unit_price', 'quantity',
    'unit', 'group_name', 'medicine_type', 'manufacturer', 'country', 'buyer', 'province',
    'tender_no', 'published', 'winner', 'source_url', 'updated_at',
  ]),
  msc_tenders: new Set([
    'source_id', 'search', 'tender_no', 'name', 'buyer', 'province', 'published', 'close_date',
    'status_label', 'status_code', 'bid_price', 'bid_form', 'source_url', 'updated_at',
  ]),
}

async function colsOf(table) {
  const rs = await client.execute(`PRAGMA table_info(${table})`)
  return rs.rows.map((r) => r.name)
}

const report = []
for (const [table, keep] of Object.entries(KEEP)) {
  const cols = await colsOf(table)
  const drop = cols.filter((c) => !keep.has(c))
  console.log(`[${table}] have=${cols.length} drop=${drop.length}`, drop.join(', ') || '(none)')
  for (const col of drop) {
    const t0 = Date.now()
    try {
      await client.execute(`ALTER TABLE ${table} DROP COLUMN ${col}`)
      console.log(`  DROPPED ${table}.${col} (${Date.now() - t0}ms)`)
    } catch (e) {
      console.error(`  FAIL ${table}.${col}: ${e.message}`)
    }
  }
  const after = await colsOf(table)
  report.push({ table, before: cols, dropped: drop, after })
  console.log(`  after (${after.length}):`, after.join(', '))
}

writeFileSync(join(root, 'scripts/_drop_non_compact_report.json'), JSON.stringify(report, null, 2))
console.log('DONE (dav_drugs untouched)')
