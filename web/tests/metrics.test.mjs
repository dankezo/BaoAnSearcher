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
const { computeDavCompound, computeMscPriceCompound, computeVssCompound, buildProvinceTable, METRICS_YEAR, fetchAllPages } = compiled.exports

test('DAV includes old registrations even when there are many current-year rows', () => {
  const rows = Array.from({length: 50}, (_, i) => ({soDangKy: String(i), hoatChat: 'Ingredient '+i, ngayCap: i < 25 ? `${METRICS_YEAR}-01-01` : '2018-01-01', monthsLeft: 30}))
  const cards = computeDavCompound(rows, rows.length)
  assert.equal(cards.find(c => c.key === 'life').mainValue, '50')
  assert.equal(cards.find(c => c.key === 'density').mainValue, '50')
})

test('MSC and VSS do not fall back to prior years when the current year is empty', () => {
  const msc = computeMscPriceCompound([{published: `${METRICS_YEAR-1}-01-01`, quantity: 100, unit_price: 100}], 1)
  assert.equal(msc.find(c => c.key === 'share').mainValue, '0%')
  assert.equal(msc.find(c => c.key === 'discount').mainValue, '—')
  const vss = computeVssCompound([{nam: METRICS_YEAR-1, ten_cskcb:'Old', thanhtien:1000}], 1)
  assert.equal(vss.find(c => c.key === 'cskcb').mainValue, '0')
  assert.equal(vss.find(c => c.key === 'region').mainValue, '0')
})

test('Province ranking keeps every province, zero values, and missing names', () => {
  const rows = Array.from({length:70}, (_,i)=>({ma_tinh:String(i+1),ten_tinh:'Province '+i,thanhtien:i,nhomthau:'1',ma_cskcb:'A'}))
  rows.push({ma_tinh:'1',thanhtien:100,nhomthau:'2',ma_cskcb:'B'})
  rows.push({ma_tinh:'71',thanhtien:10})
  rows.push({thanhtien:5})
  const ranks = buildProvinceTable(rows)
  assert.equal(ranks.length,72)
  const first = ranks.find(p=>p.code==='1')
  assert.equal(first.name,'Province 0')
  assert.equal(first.count,2)
  assert.equal(first.facilities,2)
  assert.equal(first.groups[1],100)
  assert.ok(ranks.every(p=>p.name.trim() && p.name!=='—'))
  assert.ok(Math.abs(ranks.reduce((n,p)=>n+p.share,0)-100)<1e-8)
})

test('Full metrics pagination continues past the former 500-page limit', async () => {
  const rows = await fetchAllPages(async page=>({total:503, items:[{id:page}]}), {size:1,cap:Infinity})
  assert.equal(rows.length,503)
  assert.equal(rows.at(-1).id,502)
})

test('Switching panes cancels obsolete background pagination', async () => {
  let cancelled = false
  let calls = 0
  await assert.rejects(fetchAllPages(async () => { calls++; cancelled=true; return {total:10, items:[1]} }, {size:1, shouldCancel:()=>cancelled}), {name:'AbortError'})
  assert.equal(calls,1)
})
