import {test} from 'node:test'
import assert from 'node:assert/strict'
import {refreshTenders,tenderRow} from '../api-lib/tenderRefresh.js'
import apiHandler from '../api/index.js'

const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'})
const row=(id,published=today)=>({id,notifyNo:'IB-DEMO-'+id+'-00',bidName:'Thuốc DEMO',isMedicine:1,publicDate:published,investorName:'Bệnh viện DEMO',locations:[{provName:'Hà Nội'}],bidPrice:125000,bidCloseDate:'2026-10-30T08:00:00'})
function fixture(pages){
 let lease,calls=0;const writes=[],known=new Set(['IB-DEMO-KNOWN'])
 const queryImpl=async(sql,args=[])=>{
  if(sql.startsWith('INSERT INTO shared_query_cache')&&!lease)lease=args[1]
  if(sql.startsWith('SELECT payload'))return {rows:[{payload:lease,retry_after:120}]}
  if(sql.startsWith('SELECT tender_no'))return {rows:args.filter(no=>known.has(no)).map(tender_no=>({tender_no}))}
  if(sql.startsWith('INSERT INTO msc_tenders'))writes.push(args)
  if(sql.includes('COUNT(DISTINCT'))return {rows:[{total:20}]}
  if(sql.startsWith('UPDATE shared_query_cache'))lease=args[0]
  return {rows:[]}
 }
 const fetchImpl=async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer fixture-secret');assert.equal(JSON.parse(options.body).fresh,true);calls++;return Response.json(pages[calls-1])}
 return {deps:{queryImpl,fetchImpl,env:{MSC_CRAWL_KEY:'fixture-secret'}},calls:()=>calls,writes,lease:()=>JSON.parse(lease)}
}
test('refresh ingests new and changed public tenders, streams actual pages and blocks duplicate clicks',async()=>{
 const f=fixture([{page:{content:[row('known'),row('new')],totalPages:1}}]),events=[]
 const result=await refreshTenders(event=>events.push(event),f.deps)
 assert.equal(result.rows,2);assert.equal(result.added,1);assert.equal(result.pages,1);assert.equal(f.writes.length,1)
 assert.deepEqual(events.map(event=>event.pages),[0,1]);assert.equal(f.lease().state,'done')
 await assert.rejects(refreshTenders(()=>{},f.deps),error=>error.status===429&&error.retryAfter===120);assert.equal(f.calls(),1)
})
test('nonmedicine, malformed, repeated and unsorted source pages cannot be marked complete',async()=>{
 for(const content of [[{...row('bad'),isMedicine:0}],[{...row('bad'),publicDate:''}],[row('same'),row('same')],[row('old','2026-01-01'),row('new')]]){
  const f=fixture([{page:{content,totalPages:1}}]);await assert.rejects(refreshTenders(()=>{},f.deps));assert.equal(f.writes.length,0);assert.equal(f.lease().state,'error')
 }
 const f=fixture([{page:{content:[row('same')],totalPages:2}},{page:{content:[row('same')],totalPages:2}}])
 await assert.rejects(refreshTenders(()=>{},f.deps),/lặp gói/);assert.equal(f.writes.length,1);assert.equal(f.lease().rows,1)
})

test('empty in-range pages and incomplete scan limits cannot claim success',async()=>{
 const empty=fixture([{page:{content:[],totalPages:2}}]);await assert.rejects(refreshTenders(()=>{},empty.deps),/chưa đầy đủ/);assert.equal(empty.writes.length,0)
 const partial=fixture([0,1,2].map(i=>({page:{content:[row('page-'+i)],totalPages:4}})))
 await assert.rejects(refreshTenders(()=>{},partial.deps),/chưa xác nhận tải đủ/);assert.equal(partial.writes.length,3);assert.equal(partial.lease().state,'error')
 const revised=fixture([{page:{content:[{...row('revised-id'),notifyNo:'IB-DEMO-KNOWN-01'}],totalPages:1}}])
 assert.equal((await refreshTenders(()=>{},revised.deps)).added,0,'new revision IDs are not new tender packages')
})
test('source quota is actionable and never publishes a success',async()=>{
 const f=fixture([]);f.deps.fetchImpl=async()=>Response.json({error:'daily_msc_browser_budget_reached'},{status:429})
 await assert.rejects(refreshTenders(()=>{},f.deps),error=>error.status===429&&/hạn mức/.test(error.message));assert.equal(f.writes.length,0);assert.equal(f.lease().state,'error')
})
test('normalization retains tender identity, dates, money and source link without inventing a supplier',()=>{
 const data=tenderRow(row('sample'))
 assert.equal(data.tender_no,'IB-DEMO-SAMPLE');assert.equal(data.bid_price,'125000.00');assert.equal(data.close_date,'2026-10-30');assert.equal(data.province,'Hà Nội')
 assert.equal(new URL(data.source_url).searchParams.get('notifyId'),'sample');assert.equal(data.winner,undefined)
 assert.equal(tenderRow({...row('sample'),bidPrice:'unknown'}).bid_price,null)
 assert.equal(tenderRow({...row('sample'),bidPrice:undefined}).bid_price,null)
})

test('manual refresh route requires an authenticated staff session',async()=>{
 let body='';const headers={},res={setHeader:(key,value)=>{headers[key]=value},end:value=>{body=value;res.writableEnded=true}}
 await apiHandler({method:'POST',url:'/api/tender/refresh',headers:{}},res)
 assert.equal(res.statusCode,401);assert.equal(JSON.parse(body).error,'Unauthorized')
})
