import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const result = await build({
  stdin: { contents: 'export * from "./src/metrics.jsx"; export { fetchAllPages } from "./src/components.jsx"', resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  define: { 'import.meta.env': '{}' },
})
const compiled = new Module('dashboard-test')
compiled._compile(result.outputFiles[0].text, 'dashboard-test.cjs')
const {
  METRICS_YEAR, VSS_METRICS_YEARS,
  computeDavCompound, computeMscPriceCompound, computeVssCompound,
  scopeMscMetricsRows, scopeVssMetricsRows,
  buildProvinceTable, buildProvinceYoYTable, fetchAllPages,
} = compiled.exports

test('DAV keeps density/tags/forms/new-sdk cards on full sample (all years)', () => {
  const now = Date.now()
  const rows = Array.from({ length: 50 }, (_, i) => ({
    soDangKy: String(i),
    hoatChat: i < 10 ? 'Paracetamol' : `Ingredient ${i}`,
    dangBaoChe: i % 4 === 0 ? 'Viên nén' : i % 4 === 1 ? 'Ống tiêm' : i % 4 === 2 ? 'Gói' : 'Sirô',
    ngayCap: new Date(now - (i < 5 ? 30 : i < 15 ? 120 : 400) * 86400000).toISOString().slice(0, 10),
    tagId: 'xanh',
  }))
  const cards = computeDavCompound(rows, rows.length)
  assert.ok(cards.find((c) => c.key === 'density'))
  assert.ok(cards.find((c) => c.key === 'tags'))
  assert.ok(cards.find((c) => c.key === 'forms'))
  assert.ok(cards.find((c) => c.key === 'new_sdk'))
  assert.equal(cards.find((c) => c.key === 'dm93'), undefined)
  assert.equal(cards.find((c) => c.key === 'life'), undefined)
  assert.ok(Number(cards.find((c) => c.key === 'new_sdk').mainValue.replace(/\./g, '')) >= 5)
  assert.match(String(cards.find((c) => c.key === 'density').subtitle), /Toàn bộ|đã nạp/)
})

test('MSC price ranks provinces on METRICS_YEAR sample only', () => {
  assert.equal(VSS_METRICS_YEARS.length, 1)
  assert.equal(VSS_METRICS_YEARS[0], METRICS_YEAR)
  const now = Date.now()
  const day = 86400000
  const y0 = new Date(METRICS_YEAR, 0, 15).toISOString().slice(0, 10)
  const old = new Date(METRICS_YEAR - 1, 5, 1).toISOString().slice(0, 10)
  const rows = [
    { province: 'Hà Nội', published: y0, quantity: 100, unit_price: 1000 },
    { province: 'Hà Nội', published: old, quantity: 50, unit_price: 1000 },
    { province: 'TP.HCM', published: new Date(now - 20 * day).toISOString().slice(0, 10), quantity: 200, unit_price: 1000 },
    { province: 'TP.HCM', published: old, quantity: 10, unit_price: 1000 },
    { province: 'Đà Nẵng', published: new Date(now - 5 * day).toISOString().slice(0, 10), quantity: 10, unit_price: 1000 },
  ]
  const scoped = scopeMscMetricsRows(rows)
  assert.equal(scoped.length, 3)
  assert.ok(scoped.every((r) => String(r.published).slice(0, 4) === String(METRICS_YEAR)))
  const cards = computeMscPriceCompound(rows, rows.length)
  assert.ok(cards.find((c) => c.key === 'province_lead'))
  assert.ok(cards.find((c) => c.key === 'province_yoy'))
  assert.equal(cards.find((c) => c.key === 'share'), undefined)
  const lead = cards.find((c) => c.key === 'province_lead')
  assert.match(String(lead.mainValue), /HCM|Hà Nội|TP/)
  assert.match(String(lead.subtitle), new RegExp(`đầu năm ${METRICS_YEAR}`))
  const yoy = buildProvinceYoYTable(scoped, {
    nameKey: 'province',
    valueFn: (r) => (r.quantity || 0) * (r.unit_price || 0),
    dateKey: 'published',
  })
  assert.equal(yoy.length, 3)
  assert.ok(yoy.every((p) => p.name))
})

test('VSS province card uses METRICS_YEAR rows only', () => {
  const rows = Array.from({ length: 70 }, (_, i) => ({
    ma_tinh: String(i + 1),
    ten_tinh: `Province ${i}`,
    thanhtien: i + 1,
    nhomthau: '1',
    ma_cskcb: 'A',
    nam: METRICS_YEAR,
  }))
  rows.push({ ma_tinh: '1', thanhtien: 1000, nhomthau: '2', ma_cskcb: 'B', nam: METRICS_YEAR })
  rows.push({ thanhtien: 5, nam: METRICS_YEAR - 1, ten_tinh: 'Old Province' })
  rows.push({ thanhtien: 5 })
  const scoped = scopeVssMetricsRows(rows)
  assert.ok(scoped.every((r) => Number(r.nam) === METRICS_YEAR))
  assert.ok(!scoped.some((r) => r.ten_tinh === 'Old Province'))
  const cards = computeVssCompound(rows, rows.length)
  const region = cards.find((c) => c.key === 'region')
  assert.ok(region)
  assert.match(String(region.mainValue), /Province/)
  assert.match(String(region.subtitle), new RegExp(`đầu năm ${METRICS_YEAR}`))
  assert.equal(cards.find((c) => c.key === 'runrate'), undefined)
  const ranks = buildProvinceTable(scoped)
  assert.ok(ranks.length >= 70)
  assert.ok(Math.abs(ranks.reduce((n, p) => n + p.share, 0) - 100) < 1e-8)
})

test('Full metrics pagination continues past the former 500-page limit', async () => {
  const rows = await fetchAllPages(async (page) => ({ total: 503, items: [{ id: page }] }), { size: 1, cap: Infinity })
  assert.equal(rows.length, 503)
  assert.equal(rows.at(-1).id, 502)
})

test('Switching panes cancels obsolete background pagination', async () => {
  let cancelled = false
  let calls = 0
  await assert.rejects(fetchAllPages(async () => { calls++; cancelled = true; return { total: 10, items: [1] } }, { size: 1, shouldCancel: () => cancelled }), { name: 'AbortError' })
  assert.equal(calls, 1)
})
