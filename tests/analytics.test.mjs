import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {normalizeQuery,overview,detail,queryKey,provinceKeys,savedOverview} from '../api-lib/analytics/core.js'
import {suggestionItems} from '../api-lib/analytics/suggestions.js'
import {memo,clearAnalyticsCache} from '../api-lib/analytics/cache.js'
import {readSnapshot} from '../api-lib/analytics/snapshot.js'
import {insight,rules} from '../api-lib/analytics/insight.js'

test('calendar windows clamp leap dates; previous span is inclusive; invalid dates rejected',()=>{
  const leap=normalizeQuery({start:'2024-02-29',end:'2024-03-02'},'2024-03-02')
  assert.equal(leap.previousStart,'2023-02-28')
  const previous=normalizeQuery({start:'2024-02-29',end:'2024-03-02',comparison:'previous'})
  assert.equal(previous.previousEnd,'2024-02-28');assert.equal(previous.previousStart,'2024-02-26')
  assert.throws(()=>normalizeQuery({start:'2026-02-30'}),/Ngày/)
  assert.throws(()=>normalizeQuery({filters:{group:'6'}}),/Nhóm/)
})
test('autocomplete identifies company roles, SDK and exact regions without unrelated fields',()=>{
  const rows=[{field:'winner',value:'Công ty cổ phần dược mỹ phẩm Bảo An',cnt:100},{field:'cty_dang_ky',value:'Công ty cổ phần dược mỹ phẩm Bảo An',cnt:3},{field:'nuocsx',value:'Dược mỹ phẩm Bảo An'},{field:'sodk',value:'VN-001-26'},{field:'buyer',value:'Bệnh viện DEMO'}]
  const items=suggestionItems(rows,'bao an duoc my pham')
  assert.equal(items.length,1);assert.equal(items[0].mode,'company');assert.equal(items[0].role,'all');assert.deepEqual(items[0].roles,['registrant','winner'])
  assert.deepEqual(suggestionItems([{field:'manufacturer',value:'Hà Nội',cnt:999},{field:'manufacturer',value:'Công ty ở Hà Nội'}],'Hà Nội').map(i=>[i.mode,i.territoryField,i.label]),[['territory','province','Hà Nội']])
  assert.equal(suggestionItems([{field:'sodk',value:'Công ty Cổ phần Dược phẩm Vĩnh Phúc'}],'Công ty Cổ phần Dược phẩm Vĩnh Phúc')[0].mode,'company')
  assert.equal(suggestionItems(rows,'VN-001-26')[0].entityField,'registration')
  assert.deepEqual(suggestionItems([...rows,{field:'sodk',value:'Công văn Đông Nam Bộ về SDK'}],'Đông Nam Bộ').map(i=>[i.mode,i.territoryField,i.label]),[['territory','region','Đông Nam Bộ']])
})
test('territory scopes match prefixed provinces, regions and exact facilities separately',async()=>{
  const calls=[],adapter={relation:async()=> 'SELECT 1',query:async(s,sql,args)=>{calls.push({s,sql,args});return []}}
  await overview(adapter,{mode:'territory',territoryField:'region',entity:'Đồng bằng sông Cửu Long'})
  const region=calls.find(c=>c.s==='vss');assert.match(region.sql,/province_key IN/);assert.ok(region.args.includes('thanh pho can tho'));assert.ok(region.args.includes('tinh tien giang'))
  calls.length=0;await overview(adapter,{mode:'territory',territoryField:'facility',entity:'Bệnh viện DEMO'})
  assert.match(calls.find(c=>c.s==='vss').sql,/facility_key = \?/)
  assert.ok(provinceKeys('TP. Hồ Chí Minh').includes('thanh pho ho chi minh'))
  assert.throws(()=>normalizeQuery({mode:'territory',territoryField:'region',entity:'khu vực giả'}),/Khu vực/)
})
test('shared in-flight cache does one database load and retries a rejected factory',async()=>{
  clearAnalyticsCache();let calls=0
  const factory=async()=>{calls++;await new Promise(r=>setTimeout(r,10));return {sources:{}}}
  await Promise.all([memo('a',factory),memo('a',factory)]);await memo('a',factory)
  assert.equal(calls,1)
  await assert.rejects(memo('b',()=>Promise.reject(new Error('offline'))))
  assert.deepEqual(await memo('b',()=>({ok:true})),{ok:true})
})
test('overview never combines MSC/VSS; related tenders use existence rather than a multiplying join',async()=>{
  let tenderCalls=0
  const adapter={relation:async s=>{if(s==='msc_tenders')tenderCalls++;return 'SELECT 1'},query:async (s,sql)=>{if(s==='msc_tenders')assert.match(sql,/tender_no IN \(SELECT tender_no/);return [{kind:'summary',period:'current',label:'',amount:s==='vss'?'300':'100',count:1}]}}
  const data=await overview(adapter,{mode:'drug',entity:'Ambroxol'})
  assert.equal(data.sources.msc_prices.rows[0].amount,'100');assert.equal(data.sources.vss.rows[0].amount,'300');assert.equal(tenderCalls,1)
  assert.equal(data.sources.msc_tenders.status,'available');assert.equal(data.sources.vss.comparisonMissing,true)
})
test('detail is bounded, stable and injection stays a parameter',async()=>{
  let seen
  const adapter={relation:async()=> 'SELECT 1',query:async(s,sql,args)=>{seen={sql,args};return Array.from({length:51},(_,i)=>({id:i}))}}
  const page=await detail(adapter,{source:'msc_prices',page:2,query:{mode:'drug',entity:"x' OR 1=1 --"}})
  assert.equal(page.items.length,50);assert.equal(page.hasMore,true);assert.match(seen.sql,/LIMIT 51 OFFSET 100/)
  assert.ok(!seen.sql.includes("x' OR"));assert.ok(seen.args.includes("x' or 1=1 --"))
})
test('R2 matching snapshot returns without DB; wrong query and stale manifest are rejected',async()=>{
  const old=process.env.ANALYTICS_SNAPSHOT_BASE_URL;process.env.ANALYTICS_SNAPSHOT_BASE_URL='https://snapshots.example/analytics/'
  try{
    clearAnalyticsCache();const q=normalizeQuery({});let calls=0
    const data={version:2,query:q,sources:{msc_prices:{rows:[]}}}
    const fetch=async()=>({ok:true,json:async()=>++calls===1?{generatedAt:new Date().toISOString(),entries:[{key:queryKey(q),path:'v/one.json'}]}:data})
    assert.equal((await readSnapshot(q,fetch)).snapshot,true)
    clearAnalyticsCache();let legacyCalls=0;assert.equal(await readSnapshot(q,async()=>({ok:true,json:async()=>++legacyCalls===1?{generatedAt:new Date().toISOString(),entries:[{key:queryKey(q),path:'v/legacy.json'}]}:{...data,version:1}})),null)
    assert.equal(await readSnapshot({...q,filters:{group:'1'}},fetch),null)
    clearAnalyticsCache();assert.equal(await readSnapshot(q,async()=>({ok:true,json:async()=>({generatedAt:'2020-01-01',entries:[]})})),null)
  }finally{if(old===undefined)delete process.env.ANALYTICS_SNAPSHOT_BASE_URL;else process.env.ANALYTICS_SNAPSHOT_BASE_URL=old}
})
test('local SQLite actual shared engine: decimal sums, distinct SDK and source separation',()=>{
  const folder=mkdtempSync(join(tmpdir(),'baoan-analytics-'))
  try{
    execFileSync('python',['-m','tests.analytics_fixture',folder],{cwd:process.cwd(),env:{...process.env,PYTHONUTF8:'1'}})
    const run=body=>JSON.parse(execFileSync('node',['scripts/analytics_local.mjs'],{input:JSON.stringify({action:'overview',body}),encoding:'utf8',env:{...process.env,ANALYTICS_DB_DIR:folder},timeout:30000}))
    const data=run({mode:'drug',entity:'Ambroxol',start:'2026-02-01',end:'2026-03-31'})
    const summary=s=>data.sources[s].rows.find(r=>r.kind==='summary'&&r.period==='current')
    assert.equal(data.sources.msc_prices.status,'available')
    assert.equal(summary('msc_prices').amount,'340.75');assert.equal(summary('vss').amount,'300.75');assert.equal(summary('dav').active,1)
    const prices=data.sources.msc_prices.rows.find(r=>r.kind==='group'&&r.period==='current')
    assert.equal(prices.min_price,'20');assert.equal(prices.max_price,'100.25')
    assert.equal(data.sources.msc_tenders.status,'available');assert.equal(summary('msc_tenders').count,2)
    assert.equal(data.sources.msc_tenders.rows.find(r=>r.kind==='status'&&r.label==='Đã có kết quả'&&r.period==='current').count,1)
    const overlapping=run({mode:'drug',entity:'Ambroxol',months:24,start:'2025-02-01',end:'2026-03-31'})
    assert.equal(overlapping.sources.msc_prices.rows.find(r=>r.kind==='summary'&&r.period==='current').amount,'740.75')
    assert.equal(overlapping.sources.msc_prices.rows.find(r=>r.kind==='summary'&&r.period==='previous').amount,'400')
    const company=run({mode:'company',role:'all',entity:'Phương Đông DEMO',start:'2026-02-01',end:'2026-03-31'})
    assert.equal(company.sources.msc_prices.status,'available');assert.equal(company.sources.msc_prices.rows.find(r=>r.kind==='summary'&&r.period==='current').amount,'27066633760497024.74505')
    assert.equal(company.sources.vss.rows.find(r=>r.kind==='summary'&&r.period==='current').amount,'300.75')
    assert.equal(company.sources.dav.rows.find(r=>r.kind==='summary'&&r.period==='current').count,2)
    for(const period of ['current','previous']){
      const rows=data.sources.msc_prices.rows.filter(r=>r.kind==='unit'&&r.period===period)
      assert.equal(rows.length,1);assert.equal(rows[0].label,'viên')
      assert.equal(rows[0].amount,data.sources.msc_prices.rows.find(r=>r.kind==='summary'&&r.period===period).amount)
    }
    writeFileSync(join(folder,'company_profiles.json'),JSON.stringify({'don vi mah demo':{legalName:'Đơn vị MAH DEMO',officeProvince:'Hà Nội'},'phuong dong demo':{legalName:'Phương Đông DEMO',factoryProvince:'Bắc Ninh'}}))
    const territory=run({mode:'territory',entity:'Hà Nội',territoryField:'province',months:'all'})
    assert.equal(territory.sources.dav.status,'available')
    assert.equal(territory.sources.dav.rows.find(r=>r.kind==='summary'&&r.period==='current').total_registrations,1)
    const factory=run({mode:'company',entity:'Phương Đông DEMO',role:'all',companyFocus:'manufacturer',months:'all',filters:{province:'Bắc Ninh'}})
    assert.equal(factory.sources.dav.rows.find(r=>r.kind==='summary'&&r.period==='current').total_registrations,1)
    const wrongOffice=run({mode:'territory',entity:'Bắc Ninh',territoryField:'province',months:'all'})
    assert.equal(wrongOffice.sources.dav.rows.find(r=>r.kind==='summary'&&r.period==='current')?.total_registrations||0,0)
    const large=run({mode:'drug',entity:'Diosmin',start:'2026-02-01',end:'2026-03-31'})
    assert.equal(large.sources.msc_prices.rows.find(r=>r.kind==='summary'&&r.period==='current').amount,'27066633760496683.99505')
  }finally{rmSync(folder,{recursive:true,force:true})}
})
test('invalid AI response does not invent recommendations for an empty scope',async()=>{
  const oldKey=process.env.GEMINI_API_KEY,oldModel=process.env.ANALYTICS_GEMINI_MODEL
  process.env.GEMINI_API_KEY='test';process.env.ANALYTICS_GEMINI_MODEL='test-model';clearAnalyticsCache()
  try{const data={query:normalizeQuery({}),sources:Object.fromEntries(['msc_prices','msc_tenders','vss','dav'].map(s=>[s,{status:'available',rows:[]}])),missing:{}}
    const value=await insight(data,async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"actions":[{"detail":"Invented","source":"unknown"}]}'}]}}]})}))
    assert.equal(value.method,'rules');assert.equal(value.actions.length,0);assert.match(value.evidence[0].detail,/Chưa có bản ghi/)
  }finally{if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey;if(oldModel===undefined)delete process.env.ANALYTICS_GEMINI_MODEL;else process.env.ANALYTICS_GEMINI_MODEL=oldModel}
})


test('data recommendations identify the selected company strongest market and expiring registrations',()=>{
 const rows=[{kind:'summary',period:'current',amount:'100',count:10},{kind:'summary',period:'previous',amount:'200',count:15},{kind:'province',period:'current',label:'Hà Nội',amount:'70',count:7}]
 const value=rules({query:normalizeQuery({mode:'company',entity:'Company DEMO',role:'all'}),sources:{msc_prices:{status:'available',rows},vss:{status:'available',rows:[]},dav:{status:'available',rows:[{kind:'summary',period:'current',expiring:3,unknown_expiry:1}]}}})
 assert.match(value.evidence[0].detail,/Company DEMO.*giảm 50.0%/)
 assert.ok(value.actions.some(a=>/Hà Nội.*70.0%/.test(a.detail)))
 assert.match(value.actions[0].detail,/3 SĐK/)
})

test('manufacturer company focus highlights customer companies instead of the focused manufacturer',()=>{
 const rows=[{kind:'summary',period:'current',amount:'100',count:10},{kind:'company',period:'current',label:'Nhà thầu A',amount:'65',count:5},{kind:'manufacturer',period:'current',label:'Nhà sản xuất đang xem',amount:'95',count:9}]
 const value=rules({query:normalizeQuery({mode:'company',companyFocus:'manufacturer',entity:'Nhà sản xuất đang xem',role:'all'}),sources:{msc_prices:{status:'available',rows},vss:{status:'unavailable',rows:[]},dav:{status:'unavailable',rows:[]}}})
 assert.ok(value.evidence.some(item=>/Nhà thầu Nhà thầu A chiếm 65.0%/.test(item.detail)))
 assert.ok(!value.evidence.some(item=>item.detail.includes('Nhà sản xuất đang xem chiếm')))
 assert.ok(value.actions.some(item=>/nhà thầu đứng đầu với 65.0%/.test(item.detail)))
})

test('unit totals cover all facts beyond the coordinate cap and all-role matches never duplicate a fact',()=>{
 const folder=mkdtempSync(join(tmpdir(),'baoan-units-'))
 try{
  execFileSync('python',['-m','tests.analytics_fixture',folder],{env:{...process.env,PYTHONUTF8:'1'}})
  execFileSync('python',['-c',`
import json,sqlite3,sys
from pathlib import Path
from server.common import fold
c=sqlite3.connect(Path(sys.argv[1])/'msc_prices.sqlite3')
for period,price in [('2026',100),('2025',50)]:
 for i in range(250):
  row=dict(ingredient='Unit coverage DEMO',name='Unit coverage DEMO',strength=str(i)+'mg',dosage_form='Viên',group_name='Nhóm 4',unit='Viên' if i%2 else 'Túi',unit_price=price,quantity=1,published=period+'-02-28',winner='Distributor DEMO',manufacturer='Distributor DEMO',registration='DEMO-unit-'+str(i))
  c.execute('insert into records values(?,?,?,?)',('prices',period+'-'+str(i),json.dumps(row,ensure_ascii=False),fold(' '.join(str(v) for v in row.values()))))
c.commit()
`,folder],{env:{...process.env,PYTHONUTF8:'1'}})
  const run=body=>JSON.parse(execFileSync('node',['scripts/analytics_local.mjs'],{input:JSON.stringify({action:'overview',body}),encoding:'utf8',env:{...process.env,ANALYTICS_DB_DIR:folder},timeout:30000}))
  const periods={start:'2026-02-01',end:'2026-03-31'}
  const data=run({mode:'drug',entity:'Unit coverage DEMO',...periods}),rows=data.sources.msc_prices.rows
  assert.equal(rows.filter(r=>r.kind==='price_coordinate').length,200)
  for(const [period,value] of [['current','12500'],['previous','6250']]){
   const units=rows.filter(r=>r.kind==='unit'&&r.period===period)
   assert.equal(units.length,2);assert.ok(units.every(r=>r.amount===value&&r.count===125))
   assert.equal(units.reduce((sum,r)=>sum+Number(r.amount),0),Number(rows.find(r=>r.kind==='summary'&&r.period===period).amount))
  }
  const company=run({mode:'company',role:'all',entity:'Distributor DEMO',...periods})
  const summary=company.sources.msc_prices.rows.find(r=>r.kind==='summary'&&r.period==='current')
  assert.equal(summary.count,250);assert.equal(summary.amount,'25000')
 }finally{rmSync(folder,{recursive:true,force:true})}
})


test('saved analysis keeps original ALL end date and facts, validates scope and source shape',()=>{
 const q=normalizeQuery({mode:'company',entity:'Historical DEMO',months:'all'},'2026-03-31')
 const data={version:2,query:q,generatedAt:'2026-03-31T10:00:00Z',sources:Object.fromEntries(['msc_prices','msc_tenders','vss','dav'].map(s=>[s,{status:'available',rows:[{kind:'summary',period:'current',amount:123,count:1}]}])),missing:{}}
 const restored=savedOverview(data,{mode:'company',entity:'Historical DEMO',months:'all'})
 assert.equal(restored.query.end,'2026-03-31');assert.equal(restored.sources.msc_prices.rows[0].amount,123)
 assert.throws(()=>savedOverview(data,{...q,entity:'Different DEMO'}),/khớp/)
 assert.throws(()=>savedOverview({...data,sources:{...data.sources,vss:{status:'available',rows:[null]}}},q),/Dòng/)
 assert.throws(()=>savedOverview({...data,sources:{}},q),/Nguồn/)
})
