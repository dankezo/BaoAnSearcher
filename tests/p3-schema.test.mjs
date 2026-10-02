import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const sql = readFileSync(new URL('../tidb/002_perf_schema.sql', import.meta.url), 'utf8')
const mscMetricSql = readFileSync(new URL('../tidb/005_msc_price_metric_rollup.sql', import.meta.url), 'utf8')

test('P3 schema keeps typed values, raw text, fold columns, rollup, and TiFlash', () => {
  for (const needle of [
    'DECIMAL(15,2)',
    'DECIMAL(20,2)',
    'DATE NULL',
    'SMALLINT NULL',
    'gia_raw',
    'tungay_hd_raw',
    'hoatchat_f',
    'ten_f',
    'ten_tinh_f',
    'hoat_chat_f',
    'agg_vss_monthly',
    'suggest_values',
    'PRIMARY KEY (loai, nam, ym, ma_tinh, nhomthau)',
    'PRIMARY KEY (section, field, value)',
    'idx_vss_loai_nam_tinh',
    "ALTER TABLE vss_bids SET TIFLASH REPLICA 1",
    "ALTER TABLE dav_drugs SET TIFLASH REPLICA 1",
    "ALTER TABLE msc_prices SET TIFLASH REPLICA 1",
    "ALTER TABLE msc_tenders SET TIFLASH REPLICA 1",
    "LIKE '%word%'",
  ]) {
    assert.ok(sql.includes(needle), needle)
  }
  assert.equal(sql.includes('CREATE TABLE msc_records'), false)
  assert.equal(sql.includes('ALTER TABLE msc_records'), false)
})

test('MSC price metric rollup has a compact month and dimension key', () => {
  for (const needle of [
    'CREATE TABLE IF NOT EXISTS agg_msc_price_monthly',
    'PRIMARY KEY (ym, province, group_name)',
    'idx_agg_msc_price_monthly_ym',
  ]) assert.ok(mscMetricSql.includes(needle), needle)
})
