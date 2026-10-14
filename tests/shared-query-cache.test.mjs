import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sharedQuery,sharedCacheKey} from '../api-lib/sharedQueryCache.js'
import {clearAnalyticsCache} from '../api-lib/analytics/cache.js'
import {radarPage} from '../api-lib/routes/tenderSearch.js'
import {mapTursoItems} from '../api-lib/mapRow.js'

test('shared catalogue cache survives a new process, separates filters and invalidates on sync',async()=>{
 clearAnalyticsCache()
 const store=new Map();let version=1,synced=1,loads=0
 const queryImpl=async(sql,args=[])=>{
  if(sql.includes('FROM app_metadata'))return {rows:[{key_name:'msc_total',total_records:75,stamp:version}]}
  if(sql.includes('FROM msc_scope_lots'))return {rows:[{stamp:version}]}
  if(sql.includes('FROM data_registry_meta'))return {rows:[{dataset_code:'MSC_BID',stamp:synced}]}
  if(sql.startsWith('SELECT payload'))return {rows:store.has(args[0])?[{payload:store.get(args[0])}]:[]}
  if(sql.startsWith('INSERT'))store.set(args[0],args[1])
  return {rows:[]}
 }
 const load=async()=>{loads++;return {items:[{name:'Shared catalogue'}],cached:68}}
 await Promise.all([sharedQuery('search',{q:'a'},load,{queryImpl}),sharedQuery('search',{q:'a'},load,{queryImpl})]);assert.equal(loads,1)
 const memoryHit=await sharedQuery('search',{q:'a'},load,{queryImpl});assert.equal(memoryHit.cached,68);assert.equal(memoryHit.sharedCached,true)
 clearAnalyticsCache();const persisted=await sharedQuery('search',{q:'a'},load,{queryImpl});assert.equal(persisted.sharedCached,true);assert.equal(persisted.cached,68);assert.equal(loads,1)
 await sharedQuery('search',{q:'b'},load,{queryImpl});assert.equal(loads,2)
 version++;clearAnalyticsCache();await sharedQuery('search',{q:'a'},load,{queryImpl});assert.equal(loads,3)
 synced++;clearAnalyticsCache();await sharedQuery('search',{q:'a'},load,{queryImpl});assert.equal(loads,4,'same row count still invalidates when source sync finishes')
 assert.equal(sharedCacheKey('s',{b:2,a:1},1,'2026-10-13'),sharedCacheKey('s',{a:1,b:2},1,'2026-10-13'))
 assert.notEqual(sharedCacheKey('s',{},1,'2026-10-13'),sharedCacheKey('s',{},1,'2026-10-14'))
 clearAnalyticsCache()
})

test('failed cache or factory never poisons later reads',async()=>{
 clearAnalyticsCache()
 const queryImpl=async()=>{throw new Error('offline')}
 assert.deepEqual(await sharedQuery('s',{},async()=>({items:[]}),{queryImpl}),{items:[]})
 await assert.rejects(sharedQuery('s',{},async()=>{throw new Error('lookup failed')},{queryImpl}),/lookup failed/)
 clearAnalyticsCache()
})

test('radar preserves every scope line and watch field without oversized explanations or aliases',()=>{
 const lines=Array.from({length:100},(_,i)=>({name:'Drug '+i,code:String(i),strength:'10mg',form:'Viên nén',group:'4',unit:'Viên',qty:100,price:20,match:'exact',status:'MATCH',hits:[{reg:'SAMPLE',large:'x'.repeat(10000)}],legalBasis:'x'.repeat(1000)}))
 const original={items:[{tender_no:'IB1',ingredient:'Drug',scope_lines:lines,search:'large internal index'}],hasMore:true,nextCursor:{source_id:'1'}}
 const compact=radarPage(original),mapped=mapTursoItems(compact.items)
 assert.equal(compact.items[0].scope_lines.length,100);assert.equal(compact.hasMore,true);assert.deepEqual(compact.nextCursor,original.nextCursor)
 assert.equal(mapped[0].scopeLines,undefined);assert.equal(compact.items[0].scope_lines[0].hits,undefined)
 assert.equal(compact.items[0].scope_lines[0].match,'exact');assert.equal(compact.items[0].ingredient,'Drug')
 assert.ok(Buffer.byteLength(JSON.stringify(compact))<Buffer.byteLength(JSON.stringify(original))*.1)
})
