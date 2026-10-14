import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import Module from 'node:module'
import React from 'react'
import {create,act} from 'react-test-renderer'
import {fileURLToPath} from 'node:url'

const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/analytics/RecentAwards.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',external:['react','react-dom','react/jsx-runtime'],define:{'import.meta.env':'{}'},plugins:[{name:'mock-awards-request',setup(b){b.onResolve({filter:/^\.\/client$/},()=>({path:'client',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const request=(...args)=>globalThis.__awardsRequest(...args)',loader:'js'}))}}]})
const compiled=new Module('awards-ui-test');compiled.paths=Module._nodeModulePaths(process.cwd());compiled._compile(bundle.outputFiles[0].text,'awards-ui-test.cjs')
const RecentAwards=compiled.exports.default

test('awards reset pages without stale requests, abort replaced requests, and offer a retry after network failure',async()=>{
 const calls=[]
 globalThis.__awardsRequest=(path,body,signal)=>new Promise((resolve,reject)=>{calls.push({path,body,signal,resolve,reject});signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')))})
 const query={mode:'drug',entity:'Paracetamol',role:'winner',months:12,comparison:'yoy',filters:{}}
 let view
 try{
  await act(async()=>{view=create(React.createElement(RecentAwards,{query}))})
  const finish=async()=>act(async()=>calls.at(-1).resolve({source:calls.at(-1).body.source,page:calls.at(-1).body.page,items:[],hasMore:true,totalDistinctPackages:100}))
  const click=async label=>act(async()=>view.root.findAllByType('button').find(button=>button.children.join('')===label).props.onClick())
  await finish();await click('Sau')
  assert.equal(calls.at(-1).body.page,1)
  const previous=calls.at(-1),before=calls.length
  await click('VSS · Trúng thầu')
  assert.equal(previous.signal.aborted,true)
  assert.equal(calls.length,before+1);assert.equal(calls.at(-1).body.page,0);assert.equal(calls.at(-1).body.source,'vss')
  await act(async()=>calls.at(-1).reject(new TypeError('Failed to fetch')))
  assert.match(JSON.stringify(view.toJSON()),/Kết nối bị gián đoạn/)
  await click('Thử lại');assert.equal(calls.length,before+2)
  const pending=calls.at(-1);await act(async()=>view.unmount());assert.equal(pending.signal.aborted,true)
 }finally{delete globalThis.__awardsRequest}
})

test('mobile awards open the related scope by tap or keyboard and keep the same data when switching views',async()=>{
 const previousWindow=globalThis.window
 globalThis.window={matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}})}
 const related=[],opened=[],calls=[]
 const row={id:'sample',name:'Thuốc mẫu',ingredient:'Lacidipin',registration:'590110425723',amount:420000,facility:'Bệnh viện mẫu',province:'Hà Nội',line_count:1}
 globalThis.__awardsRequest=async(path,body)=>{calls.push({path,body});return{source:'msc_prices',page:0,items:[row],hasMore:false,totalDistinctPackages:1}}
 const query={mode:'drug',entity:'Lacidipin',role:'winner',months:'all',comparison:'none',start:'2025-06-01',end:'2026-10-01',filters:{group:['2']}}
 let view
 try{
  await act(async()=>{view=create(React.createElement(RecentAwards,{query,onRelated:q=>related.push(q),onOpenPackage:r=>opened.push(r)}))})
  const ingredient=view.root.findAllByType('span').find(node=>node.props.role==='button'&&node.children[0]==='Lacidipin')
  const event={preventDefault(){},stopPropagation(){}}
  act(()=>ingredient.props.onClick(event))
  assert.equal(related[0].entity,'Lacidipin');assert.deepEqual(related[0].filters,query.filters)
  assert.equal(opened.length,0)
  act(()=>ingredient.props.onKeyDown({...event,key:'Enter'}))
  assert.equal(related.length,2)
  act(()=>view.root.findAllByType('button').find(node=>node.props['aria-label']==='Xem chi tiết dòng 1').props.onClick())
  assert.equal(opened[0].id,row.id);assert.equal(opened[0].source,'msc_prices')
  assert.equal(view.root.findAllByType('button').filter(node=>node.children.join('')==='Bảng').length,0)
  assert.ok(view.root.findAllByType('article').length>0)
  assert.match(JSON.stringify(view.toJSON()),/Lacidipin/)
  assert.equal(calls.length,1,'view change must not refetch or alter the query')
 }finally{act(()=>view?.unmount());delete globalThis.__awardsRequest;globalThis.window=previousWindow}
})


test('related awards retain contractor column for both a single company and multiple winners',async()=>{
 const previousWindow=globalThis.window
 globalThis.window={matchMedia:()=>({matches:true,addEventListener(){},removeEventListener(){}})}
 globalThis.__awardsRequest=async()=>({source:'msc_prices',page:0,items:[{id:'single',company:'Nhà thầu DEMO',company_count:1,name:'Thuốc A',amount:100},{id:'multiple',company:null,company_count:2,manufacturer_count:2,name:'Gói B',line_count:2,amount:200}],hasMore:false,totalDistinctPackages:2})
 let view
 try{
  await act(async()=>{view=create(React.createElement(RecentAwards,{query:{mode:'drug',entity:'Paracetamol',role:'winner',months:12,comparison:'yoy',filters:{}}}))})
  const output=JSON.stringify(view.toJSON())
  assert.match(output,/Nhà thầu DEMO/)
  assert.match(output,/2 nhà thầu/)
  assert.match(output,/2 nhà sản xuất/)
 }finally{act(()=>view?.unmount());delete globalThis.__awardsRequest;globalThis.window=previousWindow}
})
