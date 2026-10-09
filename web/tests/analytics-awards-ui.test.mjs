import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import Module from 'node:module'
import React from 'react'
import {create,act} from 'react-test-renderer'
import {fileURLToPath} from 'node:url'

const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/analytics/RecentAwards.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',external:['react','react/jsx-runtime'],plugins:[{name:'mock-awards-request',setup(b){b.onResolve({filter:/^\.\/client$/},()=>({path:'client',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const request=(...args)=>globalThis.__awardsRequest(...args)',loader:'js'}))}}]})
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
