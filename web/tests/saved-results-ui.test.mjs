import {test} from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import {fileURLToPath} from 'node:url'
import {build} from 'esbuild'
import React from 'react'
import {act,create} from 'react-test-renderer'
const dir=fileURLToPath(new URL('..',import.meta.url))
const bundle=await build({entryPoints:[`${dir}/src/SavedResults.jsx`],bundle:true,write:false,platform:'node',format:'cjs',external:['react'],loader:{'.css':'empty'},plugins:[{name:'saved-fixtures',setup(b){
 b.onResolve({filter:/\/(auth|components|analytics\/ui|TenderMarketReport|savedResultStore)$/},args=>({path:args.path,namespace:'fixture'}))
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path.endsWith('/auth')?'export const useAuth=()=>({user:{id:"owner"}})':path.endsWith('/components')?'export const DataTable=()=>null;export const DetailModal=()=>null':path.endsWith('/savedResultStore')?'export const RESULT_SOURCES={vss:"VSS"};export const listResults=(...a)=>globalThis.__savedList(...a);export const loadResult=(...a)=>globalThis.__savedLoad(...a);export const deleteResult=async()=>{};export const exportSavedExcel=()=>{};export const printSavedResult=()=>{};export const savedPrintHtml=r=>r.snapshot.html':'export default ()=>null;export const Dialog=()=>null'}))
}}]})
const compiled=new Module(`${dir}/tests/saved-ui.cjs`);compiled.paths=Module._nodeModulePaths(dir);compiled._compile(bundle.outputFiles[0].text,'saved-ui.cjs')
test('an already-open saved results list refreshes after a new snapshot is saved',async()=>{
 const previous=globalThis.window,events=new EventTarget();globalThis.window=events
 let calls=0,items=[],tree;globalThis.__savedList=async()=>{calls++;return {items,hasMore:false}}
 try{
  await act(async()=>{tree=create(React.createElement(compiled.exports.default))})
  assert.equal(calls,1);assert.match(JSON.stringify(tree.toJSON()),/Chưa có kết quả lưu/)
  items=[{id:'new',name:'Saved Lacidipin',source:'vss',row_count:34,created_at:'2026-10-11T00:00:00Z'}]
  await act(async()=>{events.dispatchEvent(new Event('baoan-saved-results-updated'))})
  assert.equal(calls,2);assert.match(JSON.stringify(tree.toJSON()),/Saved Lacidipin/)
  await act(async()=>tree.unmount());events.dispatchEvent(new Event('baoan-saved-results-updated'));assert.equal(calls,2)
 }finally{globalThis.window=previous;delete globalThis.__savedList}
})

test('saved research opens as a report and tabs reuse each original snapshot',async()=>{
 const previous=globalThis.window;globalThis.window=new EventTarget()
 const items=['a','b'].map(id=>({id,name:'Nghiên cứu '+id,source:'analytics',row_count:1,created_at:'2026-10-13T00:00:00Z'}))
 let calls=0,tree;globalThis.__savedList=async()=>({items,hasMore:false});globalThis.__savedLoad=async id=>{calls++;return {...items.find(item=>item.id===id),snapshot:{kind:'analytics',rows:[{}],columns:[],html:'<p>Snapshot '+id+'</p>'}}}
 try{
  await act(async()=>{tree=create(React.createElement(compiled.exports.default))})
  const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):text(node?.children||[])
  const named=name=>tree.root.findAllByType('button').find(button=>text(button).includes(name))
  await act(async()=>named('Nghiên cứu a').props.onClick())
  assert.equal(tree.root.findAllByType('iframe').length,1);assert.match(tree.root.findByType('iframe').props.srcDoc,/Snapshot a/)
  await act(async()=>named('Danh sách bản lưu').props.onClick())
  await act(async()=>named('Nghiên cứu b').props.onClick())
  await act(async()=>named('Nghiên cứu a').props.onClick())
  assert.equal(calls,2);assert.match(tree.root.findByType('iframe').props.srcDoc,/Snapshot a/)
  assert.equal(tree.root.findByType('iframe').props.sandbox,'')
 }finally{await act(async()=>tree?.unmount());globalThis.window=previous;delete globalThis.__savedLoad;delete globalThis.__savedList}
})
