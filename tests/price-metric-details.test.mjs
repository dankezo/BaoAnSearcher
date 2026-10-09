import assert from 'node:assert/strict'
import test from 'node:test'
import { mapWindow } from '../api-lib/mapPayload.js'
import { mscPriceSlice, shapePriceRows } from '../api-lib/metricSlice.js'
import { buildPortfolio, compareAwards, mscProfileUrl } from '../api-lib/portfolioCloud.js'

test('12 month window crosses year and includes the current month through today', () => {
  const window = mapWindow(12, new Date(2026, 9, 5, 12))
  const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  assert.equal(localDate(window.curFrom), '2025-11-01')
  assert.equal(localDate(window.now), '2026-10-05')
})

test('price series keeps unknown group and separate units in monthly breakdowns', () => {
  const window = mapWindow(12, new Date(2026, 9, 5, 12))
  const payload = shapePriceRows([
    { published: '2025-11-10', province: 'Hà Nội', group_name: 'N1', unit: 'Viên', qty: 100, revenue: 120000, cnt: 1, minPrice: 1200, maxPrice: 1200 },
    { published: '2025-11-11', province: 'Hà Nội', group_name: 'Nhóm 1', unit: 'Viên', qty: 100, revenue: 130000, cnt: 1, minPrice: 1300, maxPrice: 1300 },
    { published: '2025-11-12', province: 'Hà Nội', group_name: 'N2', unit: 'Lọ', qty: 2, revenue: 40000, cnt: 1, minPrice: 20000, maxPrice: 20000 },
    { published: '2025-11-13', province: 'Hà Nội', group_name: '', unit: 'Viên', qty: 5, revenue: 5000, cnt: 1, minPrice: 1000, maxPrice: 1000 },
  ], window)

  assert.equal(payload.series.length, 12)
  assert.equal(payload.series[0].key, '2025-11')
  assert.equal(payload.series.at(-1).key, '2026-10')
  const point = payload.series[0]
  assert.equal(point.revenue, 295000)
  assert.deepEqual(new Set(point.breakdown.map((line) => line.unit)), new Set(['Viên', 'Lọ']))
  assert.equal(point.breakdown.find((line) => !line.group).revenue, 5000)
  const knownGroupRevenue = payload.groups.reduce((sum, amount) => sum + amount, 0)
  const unknownGroupRevenue = point.breakdown.filter((line) => !line.group).reduce((sum, line) => sum + line.revenue, 0)
  assert.equal(knownGroupRevenue + unknownGroupRevenue, payload.revenue)
})

test('filtered MSC price metric uses shared whereFor predicates instead of rollup', async () => {
  const filters = {
    ingredient: 'paracetamol', group_name: ['N1'], buyer: 'Bệnh viện A', province: 'Hà Nội',
    manufacturer: 'Nhà máy B', country: 'Việt Nam', route: 'Uống', dosage_form: 'Viên nén',
    medicine_type: 'Generic', publishedFrom: '2026-01-01',
  }
  let captured
  const payload = await mscPriceSlice(async (sql, args) => {
    captured = { sql, args }
    return { rows: [] }
  }, filters, 12)
  assert.equal(payload.source, 'tiflash')
  assert.match(captured.sql, /FROM msc_prices/)
  assert.doesNotMatch(captured.sql, /FROM agg_msc_price_daily_units/)
  for (const field of ['ingredient_f', 'group_name', 'buyer', 'province_f', 'manufacturer', 'country', 'route', 'dosage_form', 'medicine_type']) {
    assert.ok(captured.sql.includes(field), `missing ${field} predicate`)
  }
  for (const value of ['paracetamol%', 'N1', '%Bệnh viện A%', '%ha noi%', '%Nhà máy B%', '%Việt Nam%', '%Uống%', '%Viên nén%', '%Generic%', '2026-01-01']) {
    assert.ok(captured.args.includes(value), `missing bound filter ${value}`)
  }
})

test('compact metric transports aggregate rows once without double-counting provinces', async () => {
  const window = mapWindow(12)
  const date = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  const curFrom = date(window.curFrom)
  const prevFrom = date(window.prevFrom)
  const prevEnd = date(window.prevEnd)
  const today = date(window.now)
  const calls = []
  const rows = [
    { metric_scope: 'series', published: curFrom, province: '', group_name: 'N1', unit: 'Viên', revenue: 100, qty: 10, cnt: 2 },
    { metric_scope: 'series', published: curFrom, province: '', group_name: 'N2', unit: 'Lọ', revenue: 50, qty: 2, cnt: 1 },
    { metric_scope: 'series', published: prevFrom, province: '', group_name: 'N1', unit: 'Viên', revenue: 80, qty: 8, cnt: 1 },
    { metric_scope: 'province', published: curFrom, province: 'Hà Nội', group_name: 'N1', unit: '', revenue: 60, qty: 6, cnt: 1 },
    { metric_scope: 'province', published: curFrom, province: 'Hà Nội', group_name: 'N2', unit: '', revenue: 50, qty: 2, cnt: 1 },
    { metric_scope: 'province', published: curFrom, province: 'Đà Nẵng', group_name: 'N1', unit: '', revenue: 40, qty: 4, cnt: 1 },
    { metric_scope: 'province', published: prevFrom, province: 'Hà Nội', group_name: 'N1', unit: '', revenue: 30, qty: 3, cnt: 1 },
    { metric_scope: 'province', published: prevFrom, province: 'Đà Nẵng', group_name: 'N1', unit: '', revenue: 50, qty: 5, cnt: 1 },
  ]
  const payload = await mscPriceSlice(async (sql, args) => {
    calls.push({ sql, args })
    return { rows }
  }, { ingredient: 'paracetamol' }, 12)

  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /WITH filtered AS \(/)
  assert.match(calls[0].sql, /GROUP BY DATE_FORMAT\(day,'%Y-%m-01'\), group_name, unit/)
  assert.match(calls[0].sql, /'province' AS metric_scope/)
  assert.doesNotMatch(calls[0].sql, /SELECT \* FROM msc_prices/)
  assert.deepEqual(calls[0].args, [
    'paracetamol%', prevFrom, today, curFrom, prevEnd, curFrom, curFrom, prevFrom, curFrom, curFrom, prevFrom,
  ])

  assert.equal(payload.revenue, 150)
  assert.equal(payload.prevRevenue, 80)
  assert.equal(payload.topProvinces.reduce((sum, row) => sum + row.value, 0), payload.revenue)
  assert.equal(payload.groupViews['1'].topProvinces[0].name, 'Hà Nội')
  assert.equal(payload.groupViews['1'].topProvinces[0].value, 60)
  assert.equal(payload.groupViews['1'].topProvinces[1].name, 'Đà Nẵng')
  assert.equal(payload.groupViews['1'].topProvinces[1].value, 40)
})

test('compact metric rejects a response at the TiDB 10k row cap', async () => {
  await assert.rejects(
    () => mscPriceSlice(async () => ({ rows: Array.from({ length: 10000 }, () => ({})) }), { ingredient: 'paracetamol' }, 12),
    /vượt giới hạn API/,
  )
})

test('portfolio compares newest eligible same-group and same-unit award pair', () => {
  const award = (date, price, group = 'N1', unit = 'Viên') => ({
    date, price, ingredient: 'Paracetamol', strength: '500 mg', dosageForm: 'Viên nén', group, unit,
  })
  const result = compareAwards(
    [award('2025-01-01', 100), award('2026-04-01', 200), award('2026-06-01', 50, 'N2')],
    [award('2025-02-01', 150), award('2026-05-01', 250), award('2026-07-01', 10, 'N3'), award('2026-08-01', 1, 'N1', 'Lọ')],
  )
  assert.equal(result.comparisonOwnAward.date, '2026-04-01')
  assert.equal(result.comparisonAward.date, '2026-05-01')
  assert.equal(result.priceDeltaPct, 25)
})

test('profile links require an official profile URL with an actual id', () => {
  assert.equal(mscProfileUrl('https://muasamcong.mpi.gov.vn/profile?id=real-123'), 'https://muasamcong.mpi.gov.vn/profile?id=real-123')
  assert.equal(mscProfileUrl('https://muasamcong.mpi.gov.vn/profile?notifyNo=123'), '')
  assert.equal(mscProfileUrl('https://example.com/profile?id=123'), '')
  assert.equal(mscProfileUrl('http://muasamcong.mpi.gov.vn/profile?id=123'), '')
})

test('portfolio resolves an award landing page through the actual matching tender profile', async () => {
  const profile = 'https://muasamcong.mpi.gov.vn/contractor-selection?id=real-profile&notifyNo=IB2500086079'
  const payload = await buildPortfolio(async (sql, args) => {
    if (sql.includes('FROM msc_prices')) return { rows: [{ registration: '893110464723', name: 'Adofebrat', tender_no: 'IB2500086079', published: '2025-08-04', unit_price: 3150, quantity: 100, unit: 'Viên', source_url: 'https://muasamcong.mpi.gov.vn/web/guest/winning-bid-data' }] }
    if (sql.includes('FROM msc_tenders')) {
      assert.deepEqual(args, ['IB2500086079'])
      return { rows: [{ tender_no: 'IB2500086079', source_url: profile }] }
    }
    return { rows: [] }
  })
  assert.equal(payload.rows.find(row => row.regNumber === '893110464723').latestAward.sourceUrl, profile)
})
