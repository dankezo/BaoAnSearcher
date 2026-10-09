import {test} from 'node:test'
import assert from 'node:assert/strict'
import {detail} from '../api-lib/analytics/core.js'

test('product ranking separates strength, group and units; registrants come only from matching DAV registrations',async()=>{
 const calls=[],adapter={relation:async source=>`SELECT * FROM ${source}_facts`,query:async(source,sql,args)=>{
  calls.push({source,sql,args})
  return source==='dav'?[{registration:'VD-001',registrant:'Registrant A'},{registration:'VD-001',registrant:'Registrant B'},{registration:'unrelated',registrant:'Wrong registrant'}]:[{id:'a',name:'Product',registration:'893100 (VD-001)',strength:'500mg',form:'Viên nén',unit:'Viên',group_key:'4',amount:'123.45'},{id:'b',name:'Missing SDK',registration:null,company:'Winner'}]
 }}
 const result=await detail(adapter,{query:{mode:'drug',entity:'Paracetamol'},source:'msc_prices',panel:'products'})
 assert.equal(result.items[0].registrant,'Registrant A; Registrant B')
 assert.equal(result.items[1].registrant,null)
 assert.equal(result.items[0].strength,'500mg');assert.equal(result.items[0].group_key,'4')
 assert.match(calls[0].sql,/GROUP BY name,strength,form,unit,registration,group_key/)
 assert.match(calls[0].sql,/LIMIT 30$/);assert.ok(calls[1].args.includes('vd-001'))
 assert.ok(!calls[1].sql.includes('893100'));assert.equal(result.registrantUnavailable,false)
 adapter.query=async source=>{if(source==='dav')throw new Error('offline');return [{registration:'VD-001',name:'Product'}]}
 const unavailable=await detail(adapter,{source:'vss',panel:'products'})
 assert.equal(unavailable.items.length,1);assert.equal(unavailable.registrantUnavailable,true)
 await assert.rejects(detail(adapter,{source:'dav',panel:'products'}),/Sản phẩm cần/)
})
