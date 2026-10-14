import test from 'node:test'
import assert from 'node:assert/strict'
import Module from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { act, create } from 'react-test-renderer'

const dir=fileURLToPath(new URL('..',import.meta.url))
const bundle=await build({entryPoints:[`${dir}/src/AdminSection.jsx`],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react'],loader:{'.css':'empty'},plugins:[{name:'download-fixtures',setup(api){
 api.onResolve({filter:/\/(auth|SavedResults)$/},args=>({path:args.path,namespace:'saved-fixture'}))
 api.onLoad({filter:/.*/,namespace:'saved-fixture'},({path})=>({contents:path.endsWith('/auth')?'export const useAuth=()=>({user:{id:"owner"}})':`import React from 'react'; export default ()=>React.createElement('p',{},'Kết quả lưu');`}))
 api.onResolve({filter:/\/(api|supabaseCloud|components|DatasetDownload)$/},args=>({path:args.path,namespace:'fixture'}))
 api.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path.endsWith('/api')?'export const api={}; export const fmtDateTime=v=>v; export const relativeTime=()=>""; export const sectionMeta=()=>({})':path.endsWith('/supabaseCloud')?'export const cloudDataRegistry=()=>({}); export const cloudDatasetDownload=()=>({})':path.endsWith('/components')?'export const ErrorNote=()=>null; export const Field=()=>null; export const LoadingOverlay=()=>null':`import React from 'react'; export default props=>React.createElement('dialog',{'data-source':props.dataset.code,'data-local':props.localMode},React.createElement('button',{onClick:props.onClose},'Đóng'));`}))
}}]})
const compiled=new Module(`${dir}/tests/dataset-download.cjs`)
compiled.paths=Module._nodeModulePaths(dir);compiled._compile(bundle.outputFiles[0].text,'dataset-download.cjs')
const {DataRegistryHub}=compiled.exports
test('Data Hub opens the chosen source download in local mode and can close it',async()=>{
 let root
 try{
  await act(async()=>{root=create(React.createElement(DataRegistryHub,{localMode:true,registry:{datasets:['DAV','MSC_PRICE','MSC_BID','VSS'].map(code=>({code,name:code,status:'healthy'}))}}))})
  const downloads=root.root.findAllByType('button').filter(node=>node.children[0]==='Tải tùy chỉnh / Excel')
  assert.equal(downloads.length,4)
  assert.ok(!JSON.stringify(root.toJSON()).includes('Tải bản Snapshot (CSV)'))
  await act(async()=>downloads[3].props.onClick())
  const dialog=root.root.findByType('dialog')
  assert.equal(dialog.props['data-source'],'VSS');assert.equal(dialog.props['data-local'],true)
  await act(async()=>dialog.findByType('button').props.onClick())
  assert.equal(root.root.findAllByType('dialog').length,0)
 }finally{if(root)await act(async()=>root.unmount())}
})
