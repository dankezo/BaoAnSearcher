import assert from 'node:assert/strict'
import {test} from 'node:test'
import {recentAwards} from '../api-lib/analytics/awards.js'
import {normalizeQuery,sourceQuery} from '../api-lib/analytics/core.js'

function mockAdapter(){
 const calls=[],relations=[]
 return {calls,relations,relation:async(source,q,purpose)=>{relations.push({source,q,purpose});return `SELECT * FROM ${source}_facts`},query:async(source,sql,args)=>{calls.push({source,sql,args});return sql.includes('COUNT(DISTINCT')?[{total:2}]:source==='msc_tenders'?[{tender_no:'IB-1',package_name:'Package headline',package_status:'Đã có kết quả',package_bid_price:'99.90'}]:[{id:'IB-1',tender_no:'IB-1',date:'2026-10-01',name:'Drug name',amount:'12.50',quantity:'2',line_count:2} ]}}
}

test('MSC awards scope once, group stable tender packages and sum decimal facts',async()=>{
 const adapter=mockAdapter()
 const result=await recentAwards(adapter,{mode:'company',role:'all',entityMatch:'contains',entity:'A%_ Pharma',months:'all',source:'msc_prices',sort:'amount'})
 const [count,list]=adapter.calls
 assert.equal(result.totalDistinctPackages,2)
 assert.match(count.sql,/COUNT\(DISTINCT NULLIF\(tender_no,''\)\)/)
 assert.match(count.sql,/date IS NULL/);assert.deepEqual(count.args.slice(0,3),['%a!%!_ pharma%','%a!%!_ pharma%','1900-01-01']);assert.match(count.args[3],/^\d{4}-\d{2}-\d{2}$/)
 assert.match(list.sql,/COALESCE\(NULLIF\(tender_no,''\),id\) AS id/)
 assert.match(list.sql,/GROUP BY COALESCE\(NULLIF\(tender_no,''\),id\)/)
 assert.match(list.sql,/SUM\(amount\) AS amount/);assert.match(list.sql,/SUM\(quantity\) AS quantity/)
 assert.match(list.sql,/COUNT\(\*\) AS line_count/);assert.match(list.sql,/MAX\(date\) AS date/)
 assert.match(list.sql,/ORDER BY CAST\(SUM\(amount\) AS DECIMAL\(28,3\)\) DESC/)
 assert.equal(list.args.length,4);assert.equal(list.args[2],'1900-01-01');assert.equal(list.args[3],count.args[3])
 assert.equal(result.items[0].name,'Drug name');assert.equal(result.items[0].package_name,'Package headline')
 assert.equal(result.items[0].status,'Đã có kết quả');assert.equal(result.items[0].package_bid_price,'99.90')
 const headers=adapter.calls.find(call=>call.source==='msc_tenders')
 assert.match(headers.sql,/tender_no IN \(\?\)/);assert.deepEqual(headers.args,['IB-1'])
 assert.doesNotMatch(headers.sql,/SUM\(amount\)/)
 const headerRelation=adapter.relations.find(call=>call.source==='msc_tenders')
 assert.deepEqual([headerRelation.q.mode,headerRelation.q.entity,headerRelation.q.filters,headerRelation.purpose],['macro','',{},'detail'])
})

test('missing package headers leave grouped medicine rows intact',async()=>{
 const adapter=mockAdapter();adapter.relation=async(source,q,purpose)=>{if(source==='msc_tenders')throw new Error('header source unavailable');return `SELECT * FROM ${source}_facts`}
 const result=await recentAwards(adapter,{mode:'macro',months:12,source:'msc_prices'})
 assert.equal(result.items.length,1);assert.equal(result.items[0].amount,'12.50');assert.equal(result.items[0].package_name,undefined)
})

test('award package matching retains the shared sourceQuery predicate and parameter escaping',async()=>{
 const adapter=mockAdapter(),q=normalizeQuery({mode:'drug',entity:"x' OR 1=1 --",months:6,start:'2026-05-01',end:'2026-10-08'})
 const {p}=await sourceQuery(adapter,q,'msc_prices','detail')
 const result=await recentAwards(adapter,{query:q,source:'msc_prices'})
 assert.ok(p.args.includes("x' or 1=1 --"))
 const list=adapter.calls.find(call=>call.source==='msc_prices'&&!call.sql.includes('COUNT(DISTINCT'))
 assert.ok(list.args.includes("x' or 1=1 --"));assert.ok(!list.sql.includes("x' OR 1=1"))
 assert.equal(list.args.at(-2),'2026-05-01');assert.equal(list.args.at(-1),'2026-10-08')
 assert.equal(result.items.length,1)
})

test('VSS remains line-level with honest package coverage and all-time undated rows',async()=>{
 const adapter=mockAdapter()
 const result=await recentAwards(adapter,{mode:'macro',months:'all',source:'vss',sort:'recent'})
 const list=adapter.calls[0]
 assert.equal(result.totalDistinctPackages,null);assert.equal(result.packageIdentityAvailable,false)
 assert.match(result.packageCountUnavailableReason,/không cung cấp mã gói ổn định/)
 assert.match(list.sql,/date IS NULL/);assert.doesNotMatch(list.sql,/GROUP BY/)
 assert.match(list.sql,/ORDER BY \(date IS NULL\) ASC, date DESC/)
})


test('MSC links resolve to package profiles by TBMT and never fall back to generic lists',async()=>{
 const profile='https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?id=profile-uuid&notifyNo=IB-1'
 const adapter=mockAdapter(),original=adapter.query
 adapter.query=async(source,sql,args)=>sql.includes('package_headers')?[{tender_no:'IB-1',source_url:profile}]:original(source,sql,args)
 const result=await recentAwards(adapter,{mode:'macro',source:'msc_prices'})
 assert.equal(result.items[0].source_url,profile)
 const missing=await recentAwards(mockAdapter(),{mode:'macro',source:'msc_prices'})
 assert.equal(missing.items[0].source_url,'')
})
