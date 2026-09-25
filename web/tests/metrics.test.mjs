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
  computeDavCompound, computeMscPriceCompound, computeVssCompound,
  buildProvinceTable, buildProvinceYoYTable, fetchAllPages,
} = compiled.exports

test('DAV keeps density/tags/forms/new-sdk cards on full sample', () => {
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
})

test('MSC price ranks provinces (not winners) and uses full sample', () => {
  const now = Date.now()
  const day = 86400000
  const rows = [
    { province: 'Hà Nội', published: new Date(now - 10 * day).toISOString().slice(0, 10), quantity: 100, unit_price: 1000 },
    { province: 'Hà Nội', published: new Date(now - 400 * day).toISOString().slice(0, 10), quantity: 50, unit_price: 1000 },
    { province: 'TP.HCM', published: new Date(now - 20 * day).toISOString().slice(0, 10), quantity: 200, unit_price: 1000 },
    { province: 'TP.HCM', published: new Date(now - 400 * day).toISOString().slice(0, 10), quantity: 10, unit_price: 1000 },
    { province: 'Đà Nẵng', published: new Date(now - 5 * day).toISOString().slice(0, 10), quantity: 10, unit_price: 1000 },
  ]
  const cards = computeMscPriceCompound(rows, rows.length)
  assert.ok(cards.find((c) => c.key === 'province_lead'))
  assert.ok(cards.find((c) => c.key === 'province_yoy'))
  assert.equal(cards.find((c) => c.key === 'share'), undefined)
  const lead = cards.find((c) => c.key === 'province_lead')
  assert.match(String(lead.mainValue), /HCM|Hà Nội|TP/)
  const yoy = buildProvinceYoYTable(rows, {
    nameKey: 'province',
    valueFn: (r) => (r.quantity || 0) * (r.unit_price || 0),
    dateKey: 'published',
  })
  assert.equal(yoy.length, 3)
  assert.ok(yoy.every((p) => p.name))
})

test('VSS province card shows leader name and keeps every province', () => {
  const rows = Array.from({ length: 70 }, (_, i) => ({
    ma_tinh: String(i + 1),
    ten_tinh: `Province ${i}`,
    thanhtien: i + 1,
    nhomthau: '1',
    ma_cskcb: 'A',
  }))
  rows.push({ ma_tinh: '1', thanhtien: 1000, nhomthau: '2', ma_cskcb: 'B' })
  rows.push({ thanhtien: 5 })
  const cards = computeVssCompound(rows, rows.length)
  const region = cards.find((c) => c.key === 'region')
  assert.ok(region)
  assert.match(String(region.mainValue), /Province/)
  assert.equal(cards.find((c) => c.key === 'runrate'), undefined)
  const ranks = buildProvinceTable(rows)
  assert.ok(ranks.length >= 71)
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
