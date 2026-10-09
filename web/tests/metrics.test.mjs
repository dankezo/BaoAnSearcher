import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { act, create } from 'react-test-renderer'

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

const visualBundle = await build({
  entryPoints: [`${fileURLToPath(new URL('..', import.meta.url))}/src/metrics.jsx`],
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'], define: { 'import.meta.env': '{}' },
})
const visualModule = new Module('metrics-render-test')
visualModule.paths = Module._nodeModulePaths(fileURLToPath(new URL('..', import.meta.url)))
visualModule._compile(visualBundle.outputFiles[0].text, 'metrics-render-test.cjs')
const { MscPriceSlice, MonthTrend, pricePointTooltip, trendRangeLabel } = visualModule.exports

const textOf = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.children ? textOf(node.children) : node?.props ? textOf(node.props.children) : ''

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
  assert.match(cards.find((c) => c.key === 'density').title, /SĐK\/HC/)
  assert.ok(cards.find((c) => c.key === 'new_sdk').subMetrics.some((s) => s.id === 'expire_6m'))
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

test('price tooltip keeps units separate, calculates weighted price, and uses exact revenue', () => {
  const point = { breakdown: [
    { group: '1', unit: 'viên', qty: 30_000, revenue: 37_500_000, minPrice: 1_000, maxPrice: 1_500 },
    { group: '2', unit: 'lọ', qty: 8, revenue: 20_000, minPrice: 2_500, maxPrice: 2_500 },
    { group: '', unit: 'ống', qty: 3, revenue: 10, minPrice: 3, maxPrice: 4 },
  ] }
  const total = pricePointTooltip(point)
  assert.match(total.total, /30\.000 viên/)
  assert.match(total.total, /8 lọ/)
  assert.match(total.total, /3 ống/)
  assert.equal(total.lines.length, 3)
  assert.match(total.lines[0], /^N1: 30\.000 viên × 1\.250 \(giá BQ\) = 37\.500\.000 VNĐ$/)
  assert.match(total.lines[1], /^N2: 8 lọ × 2\.500 = 20\.000 VNĐ$/)
  assert.match(total.lines[2], / = 10 VNĐ$/)
  const selected = pricePointTooltip(point, '1')
  assert.equal(selected.lines.length, 1)
  assert.match(selected.lines[0], /^30\.000 viên × 1\.250 \(giá BQ\)/)
  assert.doesNotMatch(selected.lines[0], /^N1:/)
  assert.equal(trendRangeLabel(), 'Xu hướng 12 tháng gần nhất')
})

test('group selection switches the metric view, retains baseline, and resets outside', async () => {
  const handlers = {}
  const previousDocument = globalThis.document
  globalThis.document = {
    addEventListener: (name, handler) => { handlers[name] = handler },
    removeEventListener: name => { delete handlers[name] },
  }
  let provincePicks = 0
  const point = (revenue, key) => ({ key, revenue, breakdown: [{ group: '1', unit: 'viên', qty: 10, revenue, minPrice: 1, maxPrice: 1 }] })
  const view = {
    revenue: 100_000, months: 12, yoy: 0, groups: [100_000, 0, 0, 0, 0],
    topProvinces: [{ name: 'Tổng tỉnh', value: 100_000 }],
    coverage: { records: 2, previousRecords: 1, from: '2025-11', to: '2026-10' },
    series: [point(100_000, '2026-09'), point(100_000, '2026-10')],
    groupViews: { '1': {
      revenue: 30_000, months: 12, yoy: 0, groups: [30_000, 0, 0, 0, 0],
      topProvinces: [{ name: 'Nhóm tỉnh', value: 30_000 }],
      coverage: { records: 1, previousRecords: 1, from: '2025-11', to: '2026-10' },
      series: [point(30_000, '2026-09'), point(30_000, '2026-10')],
    } },
  }
  let root
  try {
    await act(async () => { root = create(React.createElement('div', null,
      React.createElement(MscPriceSlice, { view, loading: false, onProvince: () => { provincePicks++ } }),
      React.createElement('table', { id: 'price-table' }, React.createElement('tbody', null, React.createElement('tr', null, React.createElement('td', null, 'Bảng giữ nguyên')))),
    )) })
    const pick = () => root.root.findAllByType('button').find(button => textOf(button.props.children).trim() === 'N1')
    await act(async () => pick().props.onClick())
    assert.equal(pick().props['aria-pressed'], true)
    let text = textOf(root.toJSON())
    assert.match(text, /30\.000/)
    assert.equal(textOf(root.root.findByProps({ id: 'price-table' })), 'Bảng giữ nguyên')
    assert.match(JSON.stringify(root.toJSON()), /Tổng ·/)
    assert.equal(provincePicks, 0)
    await act(async () => handlers.pointerdown({ target: {} }))
    assert.equal(pick().props['aria-pressed'], false)
    text = textOf(root.toJSON())
    assert.match(text, /100\.000/)
    assert.equal(provincePicks, 0)
  } finally {
    await act(async () => root?.unmount())
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})


test('price point remains open after clicking and leaving, with separate quantity rows', async () => {
  const previousDocument = global.document
  global.document = {addEventListener(){},removeEventListener(){}}
  let view
  try {
    await act(async () => { view=create(React.createElement(MonthTrend,{series:[{key:'2026-04',revenue:101000,breakdown:[{group:'1',unit:'viên',qty:100,revenue:100000},{group:'2',unit:'lọ',qty:2,revenue:1000}]}]})) })
    let point=view.root.findByProps({className:'price-trend-point'})
    await act(async () => { point.props.onClick() })
    const region=view.root.findByProps({'aria-label':'Chi tiết điểm doanh thu'})
    assert.match(textOf(region),/Tháng 2026-04/)
    assert.match(textOf(region),/Đã giữ điểm/)
    assert.equal(region.findAllByType('tbody')[0].findAllByType('tr').length,2)
    assert.equal(region.findAllByType('thead')[0].findAllByType('th').length,4)
    await act(async () => { view.root.findByProps({className:'price-trend'}).props.onMouseLeave();point.props.onBlur({relatedTarget:null}) })
    assert.equal(view.root.findAllByProps({'aria-label':'Chi tiết điểm doanh thu'}).length,1)
    await act(async () => { view.root.findByProps({'aria-label':'Đóng chi tiết điểm'}).props.onClick() })
    assert.equal(view.root.findAllByProps({'aria-label':'Chi tiết điểm doanh thu'}).length,0)
  } finally { await act(async()=>view?.unmount());global.document=previousDocument }
})
