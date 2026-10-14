import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../scripts/cloudflare_crawl_worker.js', import.meta.url), 'utf8')
  .replace(/^import[^\n]+\n/, '').replace('export class CrawlBudget', 'class CrawlBudget')
  .replace('export default', 'const worker =')
let now=Date.now(),waits=[]
let sourceFetch = async () => Response.json({}, {status:503})
class TestDate extends Date {static now(){return now}}
const { CrawlBudget, worker: workerDefault } = runInNewContext(source + '\n;({ CrawlBudget, worker })', {
  DurableObject: class {}, Response, Request, URL, TextEncoder, AbortSignal, fetch:(...args)=>sourceFetch(...args), Date:TestDate, crypto: webcrypto, structuredClone,
  scheduler:{wait:async ms=>{waits.push(ms);now+=ms}},console:{warn(){}},
})

function fixture() {
  const values = new Map()
  const ctx = { storage: {
    kv: { get: key => structuredClone(values.get(key)), put: (key, value) => values.set(key, structuredClone(value)) },
    transactionSync: callback => callback(),
  } }
  let calls = 0
  const page = { content: [{ id: 'public-id', isMedicine: 1 }], totalPages: 200 }
  const env = { CRAWL_KEY: 'test-key', YCBG_KEY: 'ycbg-key', BROWSER: { quickAction: async () => {
    calls++
    const result = JSON.stringify({ status: 200, page })
    return Response.json({ success: true, result: `<pre id="baoan-search-result">${result}</pre>` })
  } } }
  const request = (page,extra={},path='/msc/search',key='test-key') => new Request('https://crawl.baoanpharma.com'+path, {
    method: 'POST', headers: { Authorization: 'Bearer '+key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page,...extra }),
  })
  return { ctx, env, request, calls: () => calls }
}

test('native YCBG details validate source IDs without consuming browser time',async()=>{
  sourceFetch=async(url,input)=>{
    assert.equal(url,'https://muasamcong.mpi.gov.vn/o/egp-portal-contractor-selection-v2/services/get-request-quote')
    return Response.json({bidoRequestQuote:{id:JSON.parse(input.body).id}})
  }
  try{
    const f=fixture(),worker=new CrawlBudget(f.ctx,f.env)
    const response=await worker.fetch(f.request(0,{ids:['native-a','native-b']},'/ycbg/details','ycbg-key'))
    assert.equal(response.status,200)
    assert.deepEqual((await response.json()).results.map(r=>r.detail.bidoRequestQuote.id),['native-a','native-b'])
    assert.equal(f.calls(),0)
    assert.equal(worker.total(),0)
    assert.ok(f.ctx.storage.kv.get('ycbg:detail:native-a'))
  }finally{sourceFetch=async()=>Response.json({},{status:503})}
})

test('persistent quota rejects a new reservation when measured browser usage fills the budget', async () => {
  const f = fixture()
  const run=f.env.BROWSER.quickAction
  f.env.BROWSER.quickAction=async()=>{const response=await run();response.headers.set('X-Browser-Ms-Used','85000');return response}
  for (let page = 0; page < 5; page++) {
    // A fresh instance must retain the reservation from earlier requests.
    assert.equal((await new CrawlBudget(f.ctx, f.env).fetch(f.request(page))).status, 200)
  }
  assert.equal((await new CrawlBudget(f.ctx, f.env).fetch(f.request(5))).status, 429)
  assert.equal(f.calls(), 5)
})

test('missing usage header charges actual action time and fresh refresh bypasses only the data cache',async()=>{
  const f=fixture(),run=f.env.BROWSER.quickAction
  f.env.BROWSER.quickAction=async()=>{now+=15000;return run()}
  const actor=new CrawlBudget(f.ctx,f.env)
  await actor.fetch(f.request(0));assert.equal(actor.total(),20000)
  await actor.fetch(f.request(0,{fresh:true}));assert.equal(actor.total(),40000);assert.equal(f.calls(),2)
})

test('a repeated request uses cached public data without another browser reservation', async () => {
  const f = fixture()
  const actor = new CrawlBudget(f.ctx, f.env)
  const first = await actor.fetch(f.request(0))
  const next = await actor.fetch(f.request(0))
  assert.equal(next.headers.get('X-Crawl-Cache'), 'hit')
  assert.equal(first.headers.get('X-Crawl-Budget-Ms'), next.headers.get('X-Crawl-Budget-Ms'))
  assert.equal(f.calls(), 1)
})

test('fresh pages share a persistent eleven-second start interval',async()=>{
  const f=fixture();waits=[]
  await new CrawlBudget(f.ctx,f.env).fetch(f.request(0))
  await new CrawlBudget(f.ctx,f.env).fetch(f.request(1))
  assert.deepEqual(waits,[11000]);assert.equal(f.calls(),2)
})

test('provider rate limits are reported correctly and do not consume browser reservations',async()=>{
  const f=fixture();f.env.BROWSER.quickAction=async()=>Response.json({success:false,errors:[{message:'429 Too many requests'}]},{status:429,headers:{'Retry-After':'12'}})
  const actor=new CrawlBudget(f.ctx,f.env),response=await actor.fetch(f.request(0))
  assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'12')
  assert.equal((await response.json()).error,'browser_rate_limited');assert.equal(actor.total(),0)
  f.env.BROWSER.quickAction=async()=>{throw Object.assign(new Error('Browser time limit exceeded for today'),{status:429})}
  assert.equal((await (await actor.fetch(f.request(1))).json()).error,'browser_daily_limit_reached');assert.equal(actor.total(),0)
})

test('YCBG search validates pages and caches successful pages within the shared budget',async()=>{
  const f=fixture();let calls=0
  f.env.BROWSER.quickAction=async()=>{calls++;return Response.json({success:true,result:'<pre id="baoan-ycbg-search-result">{"status":200,"page":{"content":[{"id":"y1","notifyNo":"RQ1"}],"totalPages":1,"totalElements":1}}</pre>'})}
  const actor=new CrawlBudget(f.ctx,f.env)
  const first=await actor.fetch(f.request(0,{},'/ycbg/search'))
  assert.equal(first.status,200);assert.equal((await first.json()).page.totalElements,1)
  const cached=await actor.fetch(f.request(0,{},'/ycbg/search'))
  assert.equal(cached.headers.get('X-Crawl-Cache'),'hit');assert.equal(calls,1)
  assert.equal((await actor.fetch(f.request(1000,{},'/ycbg/search'))).status,400)
})

test('YCBG detail batches validate IDs and cache only source-matched detail records',async()=>{
  const f=fixture();let calls=0
  f.env.BROWSER.quickAction=async()=>{calls++;return Response.json({success:true,result:'<pre id="baoan-ycbg-details-result">{"results":[{"id":"y1","detail":{"bidoRequestQuote":{"id":"y1"}}}]}</pre>'})}
  const actor=new CrawlBudget(f.ctx,f.env),request=ids=>new Request('https://crawl.baoanpharma.com/ycbg/details',{method:'POST',headers:{Authorization:'Bearer test-key','Content-Type':'application/json'},body:JSON.stringify({ids})})
  const first=await actor.fetch(request(['y1']));assert.equal(first.status,200);assert.equal((await first.json()).results[0].detail.bidoRequestQuote.id,'y1')
  const cached=await actor.fetch(request(['y1']));assert.equal(cached.headers.get('X-Crawl-Cache'),'hit');assert.equal(calls,1)
  assert.equal((await actor.fetch(request(Array.from({length:9},(_,i)=>'y'+i)))).status,400)
})

test('YCBG routes retain the worker authentication boundary',async()=>{
  const f=fixture(),request=new Request('https://crawl.baoanpharma.com/ycbg/search',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"page":0}'})
  assert.equal((await new CrawlBudget(f.ctx,f.env).fetch(request)).status,401)
})

test('dedicated YCBG key is scoped to YCBG and quota at both Worker and Durable Object gates',async()=>{
  const f=fixture(),actor=new CrawlBudget(f.ctx,f.env)
  f.env.BROWSER.quickAction=async()=>Response.json({success:true,result:'<pre id="baoan-ycbg-search-result">{"status":200,"page":{"content":[],"totalPages":0,"totalElements":0}}</pre>'})
  const ycbg=f.request(0,{},'/ycbg/search','ycbg-key')
  assert.equal((await actor.fetch(ycbg)).status,200)
  const msc=f.request(0,{},'/msc/search','ycbg-key')
  assert.equal((await actor.fetch(msc)).status,401)
  const quota=new Request('https://crawl.baoanpharma.com/quota',{headers:{Authorization:'Bearer ycbg-key'}})
  assert.equal((await actor.fetch(quota)).status,200)
  const routed={...f.env,BUDGET:{idFromName:()=> 'id',get:()=>({fetch:req=>actor.fetch(req)})}}
  assert.equal((await workerDefault.fetch(f.request(0,{},'/ycbg/search','ycbg-key'),routed)).status,200)
  assert.equal((await workerDefault.fetch(msc,routed)).status,401)
})
