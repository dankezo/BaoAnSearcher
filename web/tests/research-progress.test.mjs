import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import Module from 'node:module'
import {fileURLToPath} from 'node:url'
import React from 'react'
import {act,create} from 'react-test-renderer'

const dir=fileURLToPath(new URL('..',import.meta.url))
const built=await build({entryPoints:[`${dir}/src/analytics/ResearchProgress.tsx`],bundle:true,write:false,platform:'node',format:'cjs',external:['react','react/jsx-runtime']})
const module=new Module(`${dir}/tests/research-progress.cjs`);module.paths=Module._nodeModulePaths(dir);module._compile(built.outputFiles[0].text,'research-progress.cjs')
const Progress=module.exports.default

test('progress advances only on completed queries and never invents AI percentages',async()=>{
 const initial={loading:true,researching:false,complete:false,error:false}
 const queries=Object.fromEntries(['msc_prices','msc_tenders','vss','dav'].map(source=>[source,{source,completed:0,total:2}]))
 let tree
 try{
  await act(async()=>{tree=create(React.createElement(Progress,initial))})
  assert.equal(tree.root.findByType('progress').props.value,undefined)
  await act(async()=>tree.update(React.createElement(Progress,{...initial,queries})))
  assert.equal(tree.root.findByType('strong').children.join(''),'0/8')
  assert.equal(tree.root.findByType('progress').props.value,0)
  await act(async()=>tree.update(React.createElement(Progress,{...initial,queries:{...queries,dav:{source:'dav',completed:2,total:2}},sources:['dav']})))
  assert.equal(tree.root.findByType('strong').children.join(''),'2/8')
  assert.equal(tree.root.findByType('progress').props.value,2)
  assert.match(JSON.stringify(tree.toJSON()),/MSC · Đơn giá/)
  await act(async()=>tree.update(React.createElement(Progress,{...initial,loading:false,researching:true})))
  assert.equal(tree.root.findByType('strong').children.join(''),'AI');assert.equal(tree.root.findByType('progress').props.value,undefined)
  await act(async()=>tree.update(React.createElement(Progress,{...initial,loading:false,complete:true,error:true})))
  assert.doesNotMatch(JSON.stringify(tree.toJSON()),/100%/)
  await act(async()=>tree.update(React.createElement(Progress,{...initial,loading:false,complete:true})))
  assert.equal(tree.root.findByType('strong').children.join(''),'100%')
 }finally{await act(async()=>tree?.unmount())}
})
