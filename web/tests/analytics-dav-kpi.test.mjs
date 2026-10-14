import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import Module from 'node:module'
import React from 'react'
import {create,act} from 'react-test-renderer'
import {fileURLToPath} from 'node:url'

const mocks={
 '../auth':'export const useAuth=()=>({user:null})',
 './client':'export const loadOverview=async()=>globalThis.__davOverview; export const remember=()=>{}; export const clearAnalyticsAux=()=>{}',
 '../queryCache':'export const resetQueryCache=()=>{}',
 '../savedResultStore':'export const tableSnapshot=()=>({}); export const saveResult=async()=>({})',
 './Charts':'export const count=v=>String(v); export const money=v=>String(v); export const Trend=()=>null,GroupChart=()=>null,CompanyGroups=()=>null,TenderChart=()=>null,PriceComparison=()=>null',
 './ui':`import React from 'react'; export const Card=({title,children})=>React.createElement('section',{'data-title':title},children)`,
 './pdf':'export const exportPdf=()=>{}; export const exportHtml=()=>{}; export const reportHtml=()=>""',
}
const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/analytics/AnalyticsApp.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',external:['react','react-dom','react/jsx-runtime'],plugins:[{name:'mock-panels',setup(b){
 b.onResolve({filter:/^\.\.?\//},args=>args.path==='./types'?undefined:({path:args.path,namespace:'mock'}))
 b.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:mocks[path]||'export default ()=>null',loader:'js'}))
}}]})
const compiled=new Module('dav-kpi-test');compiled.paths=Module._nodeModulePaths(fileURLToPath(new URL('..',import.meta.url)));compiled._compile(bundle.outputFiles[0].text,'dav-kpi-test.cjs')
const AnalyticsApp=compiled.exports.default

test('company DAV KPI shows recorded SDK separately from known active and unknown expiry',async()=>{
 const previous={window:globalThis.window,location:globalThis.location}
 const query={mode:'company',entity:'Hoàng Đức',role:'all',months:12,comparison:'yoy',filters:{}}
 globalThis.location={search:'?analyticsReport='+encodeURIComponent(JSON.stringify(query))}
 globalThis.window={addEventListener(){},removeEventListener(){}}
 globalThis.__davOverview={query:{...query,start:'2025-11-01',end:'2026-10-12'},generatedAt:'2026-10-12T00:00:00Z',missing:{},sources:Object.fromEntries(['msc_prices','msc_tenders','vss','dav'].map(source=>[source,{status:'available',rows:source==='dav'?[{kind:'summary',period:'current',count:4,total_registrations:4,active:0,unknown_expiry:4}]:[]}]))}
 let view
 try{
  await act(async()=>{view=create(React.createElement(AnalyticsApp))})
  const card=view.root.findAllByType('section').find(node=>node.props['data-title']==='DAV · Số đăng ký')
  assert.equal(card.findAllByType('p').find(node=>node.props.className==='analytics-number').children.join(''),'4')
  const badges=card.findAllByType('span')
  assert.equal(badges.find(node=>node.children[0]==='Còn hạn xác định ').findByType('b').children.join(''),'0')
  assert.equal(badges.find(node=>node.children[0]==='Chưa rõ hạn ').findByType('b').children.join(''),'4')
 }finally{
  if(view)await act(async()=>view.unmount())
  Object.assign(globalThis,previous);delete globalThis.__davOverview
 }
})

test('MSC KPI leads with distinct package count and keeps value alongside',async()=>{
 const previous={window:globalThis.window,location:globalThis.location}
 const query={mode:'drug',entity:'Piroxicam',role:'winner',months:12,comparison:'yoy',filters:{}}
 globalThis.location={search:'?analyticsReport='+encodeURIComponent(JSON.stringify(query))};globalThis.window={addEventListener(){},removeEventListener(){}}
 globalThis.__davOverview={query:{...query,start:'2025-11-01',end:'2026-10-12'},generatedAt:'2026-10-12T00:00:00Z',missing:{},sources:Object.fromEntries(['msc_prices','msc_tenders','vss','dav'].map(source=>[source,{status:'available',rows:[{kind:'summary',period:'current',count:91,won_packages:3,amount:1200000}]}]))}
 let view
 try{await act(async()=>{view=create(React.createElement(AnalyticsApp))});const card=view.root.findAllByType('section').find(node=>node.props['data-title']==='MSC · Đơn giá');assert.equal(card.findAllByType('p').find(node=>node.props.className==='analytics-number').children.join(''),'3');assert.ok(card.findAllByType('p').some(node=>node.children.join('')==='Gói trúng trong kỳ'));assert.equal(card.findAllByType('p').find(node=>node.props.className==='analytics-award-count').children.join(''),'Giá trị: 1200000 · mã TBMT riêng')}
 finally{await act(async()=>view?.unmount());Object.assign(globalThis,previous);delete globalThis.__davOverview}
})
