import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import Module from 'node:module'
const result = await build({entryPoints:['src/api.js'],bundle:true,write:false,platform:'node',format:'cjs',define:{'import.meta.env':'{}'}})
const mod = new Module(import.meta.url)
mod._compile(result.outputFiles[0].text,'msc-meta.cjs')
test('tender tab never uses unit-price catalogue count',()=>{
 const status={msc:{count:450000,meta:{prices:450000,tenders:10041}}}
 assert.equal(mod.exports.sectionMeta(status,'msc_tenders').count,10041)
 assert.equal(mod.exports.sectionMeta(status,'msc_prices').count,450000)
 assert.equal(mod.exports.sectionMeta({msc:{count:450000,meta:{prices:450000}}},'msc_tenders').count,null)
})
