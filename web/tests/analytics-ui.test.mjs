import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import Module from 'node:module'
import React from 'react'
import {create,act} from 'react-test-renderer'
import {fileURLToPath} from 'node:url'
let calls=0,resolvePage
const result=await build({entryPoints:[fileURLToPath(new URL('../src/analytics/DetailTable.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',external:['react','react/jsx-runtime'],plugins:[{name:'mock-client',setup(b){b.onResolve({filter:/^\.\/client$/},()=>({path:'client',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const loadDetail=(...args)=>globalThis.__analyticsTestLoad(...args);`,loader:'js'}))}}]})
const compiled=new Module('analytics-ui-test');compiled.paths=Module._nodeModulePaths(process.cwd());compiled._compile(result.outputFiles[0].text,'analytics-ui-test.cjs')
const DetailTable=compiled.exports.default
test('closed detail sends no request; opened detail pages on demand and ignores late response',async()=>{
 globalThis.__analyticsTestLoad=()=>{calls++;return new Promise(r=>{resolvePage=r})}
 const q={mode:'drug',entity:'Ambroxol',role:'winner',months:12,comparison:'yoy',filters:{}}
 let view
 await act(async()=>{view=create(React.createElement(DetailTable,{query:q,source:'msc_prices',onEntity:()=>{}}))})
 assert.equal(calls,0)
 await act(async()=>{view.root.findAllByType('button')[0].props.onClick()})
 assert.equal(calls,1)
 const resolveOld=resolvePage
 await act(async()=>{view.update(React.createElement(DetailTable,{query:{...q,entity:'Diosmin'},source:'msc_prices',onEntity:()=>{}}))})
 assert.equal(calls,2)
 await act(async()=>{resolveOld({source:'msc_prices',page:0,items:[{id:'old',name:'OLD_RESPONSE'}],hasMore:false});resolvePage({source:'msc_prices',page:0,items:[],hasMore:false})})
 assert.ok(!JSON.stringify(view.toJSON()).includes('OLD_RESPONSE'))
 await act(async()=>{view.unmount()});delete globalThis.__analyticsTestLoad
})
