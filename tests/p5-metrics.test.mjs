import assert from 'node:assert/strict'
import test from 'node:test'
import {
  davTiflashSql,
  emptyMetrics,
  mscPricesTiflashSql,
  mscTendersTiflashSql,
  readSection,
  shapeVss,
  vssFacilitySql,
  vssRollupSql,
  vssTiflashSql,
} from '../api-lib/metricsRollup.js'
import { mscPriceSlice } from '../api-lib/metricSlice.js'

const FACTS = ['vss_bids', 'dav_drugs', 'msc_prices', 'msc_tenders']

function assertSafe(sql) {
  for (const table of FACTS) {
    if (sql.includes(table)) {
      assert.match(sql, new RegExp(`READ_FROM_STORAGE\\(TIFLASH\\[${table}\\]\\)`))
    }
  }
  assert.doesNotMatch(sql, /SELECT \*/)
}

test('VSS rollup SQL stays on agg_vss_monthly', () => {
  const built = vssRollupSql(2026)
  assert.match(built.sql, /FROM agg_vss_monthly/)
  assert.deepEqual(built.args, ['Tân dược', 2026])
  for (const table of FACTS) assert.doesNotMatch(built.sql, new RegExp(table))
})

test('fact fallbacks carry a TiFlash hint', () => {
  const sqls = [
    vssFacilitySql(2026).sql,
    vssTiflashSql(2026).sql,
    ...davTiflashSql().map((item) => item.sql),
    mscPricesTiflashSql(2026).sql,
    mscTendersTiflashSql(2026).sql,
  ]
  for (const sql of sqls) assertSafe(sql)
})

test('rollup rows become value, group, and province cards', () => {
  const payload = shapeVss([
    { ma_tinh: '01', nhomthau: '1', ym: '2026-01', sum_thanhtien: '1000.00', cnt: 2 },
    { ma_tinh: '79', nhomthau: 'N2', ym: '2026-02', sum_thanhtien: '3000.00', cnt: 1 },
  ], 2026, { cskcb_n: 4 })
  assert.equal(payload.total, 3)
  assert.equal(payload.cards[0].key, 'total')
  assert.equal(payload.cards[2].mainValue, '4')
  assert.equal(payload.provinces[0].code, '79')
  assert.equal(payload.provinces[0].name, 'Hồ Chí Minh')
  const groups = payload.cards[1].subMetrics
  assert.equal(groups[0].id, 'g1')
  assert.notEqual(groups[1].count, '—')
})

test('a rollup hit does not scan facts, and a failure stays an empty 200 body', async () => {
  const calls = []
  const payload = await readSection(async (sql) => {
    calls.push(sql)
    if (sql.includes('agg_vss_monthly')) {
      return { rows: [{ ma_tinh: '', nhomthau: '', ym: '', sum_thanhtien: '10.00', cnt: 1 }] }
    }
    throw new Error('tiflash down')
  }, 'vss', 2026)
  assert.equal(payload.source, 'rollup')
  assert.equal(payload.cards.length, 4)
  assert.equal(payload.cards[2].mainValue, '—')
  assert.ok(calls.some((sql) => sql.includes('agg_vss_monthly')))
  assert.ok(calls.every((sql) => !sql.includes('vss_bids') || sql.includes('READ_FROM_STORAGE(TIFLASH[vss_bids])')))

  const empty = await readSection(async () => {
    const error = new Error('TiDB chưa cấu hình')
    error.status = 503
    throw error
  }, 'vss', 2026)
  assert.deepEqual(empty, emptyMetrics('vss'))
})

test('an empty rollup falls back to TiFlash SQL', async () => {
  const calls = []
  const payload = await readSection(async (sql) => {
    calls.push(sql)
    return { rows: [] }
  }, 'dav', 2026)
  assert.equal(payload.source, 'tiflash')
  assert.ok(calls.every((sql) => sql.includes('READ_FROM_STORAGE(TIFLASH[dav_drugs])')))
  assert.ok(calls.every((sql) => !sql.includes('vss_bids')))
})

test('MSC price default metric reads the monthly rollup and returns twelve monthly points', async () => {
  const calls = []
  const payload = await mscPriceSlice(async (sql) => {
    calls.push(sql)
    assert.match(sql, /FROM agg_msc_price_daily_units/)
    return {
      rows: [
        { published: '2025-11-01', province: 'Hà Nội', group_name: 'Nhóm 1', revenue: '10', qty: '2', cnt: 1 },
        { published: '2026-10-01', province: 'Hà Nội', group_name: 'Nhóm 1', revenue: '20', qty: '3', cnt: 2 },
      ],
    }
  }, {}, 12)
  assert.equal(payload.source, 'rollup')
  assert.equal(payload.series.length, 12)
  assert.equal(payload.series[0].key, '2025-11')
  assert.equal(payload.series.at(-1).key, '2026-10')
  assert.equal(payload.revenue, 30)
  assert.equal(payload.quantity, 5)
  assert.equal(calls.length, 1)
  assert.ok(calls.every((sql) => !sql.includes('FROM msc_prices')))
})
