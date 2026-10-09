import {test} from 'node:test'
import assert from 'node:assert/strict'
import {discoverLinks} from '../../lib/regulatory/discovery.js'
import {crawlSource} from '../../lib/regulatory/crawler.js'

const source={id:'dav',name:'DAV',url:'https://dav.gov.vn/tin-tuc',kind:'html',keywords:'thuốc, đấu thầu'}
const now=Date.parse('2026-10-08T00:00:00Z')
const result=(title,url,publishedDate='2026-10-07')=>({title,url,publishedDate})
const json=(data)=>({ok:true,json:async()=>data})

test('Exa discovery filters host, scheme, dates, relevance, and PDF results',async()=>{
  let request
  const links=await discoverLinks(source,{exaApiKey:'exa-secret',jinaApiKey:'jina-secret',now,fetchImpl:async(url,init)=>{request={url,init};return json({results:[
    result('Công bố danh mục thuốc đấu thầu','https://dav.gov.vn/tin/danh-muc-thuoc'),
    result('Công bố thuốc khác','https://evil.test/tin/thuoc'),
    result('Công bố danh mục thuốc','http://dav.gov.vn/tin/http'),
    result('Công bố danh mục thuốc','https://dav.gov.vn/tin/old','2026-09-07'),
    result('Công bố danh mục thuốc','https://dav.gov.vn/tin/future','2026-10-09'),
    result('Công bố danh mục thuốc','https://dav.gov.vn/files/list.pdf'),
    result('Hoạt động hội nghị','https://dav.gov.vn/tin/conference')
  ]})}})
  assert.equal(links.provider,'exa');assert.equal(links.links.length,1);assert.equal(links.links[0].url,'https://dav.gov.vn/tin/danh-muc-thuoc')
  const body=JSON.parse(request.init.body);assert.deepEqual(body.includeDomains,['dav.gov.vn']);assert.ok(body.startPublishedDate)
  assert.equal(request.url,'https://api.exa.ai/search');assert.equal(request.init.headers['x-api-key'],'exa-secret');assert.ok(!request.url.includes('secret'));assert.ok(!request.init.body.includes('secret'))
})

test('falls from Exa to Jina and filters Jina results with the same source and date rules',async()=>{
  const calls=[]
  const links=await discoverLinks(source,{exaApiKey:'e',jinaApiKey:'j',now,fetchImpl:async(url,init)=>{calls.push({url,init});return url.includes('exa.ai')?json({results:[result('Danh mục thuốc','https://other.gov.vn/a')]}):json({data:[result('Thông tư về đấu thầu thuốc','https://dav.gov.vn/tin/thong-tu'),result('Thông tư về thuốc','https://dav.gov.vn/tin/stale','2026-09-01')]})}})
  assert.equal(links.provider,'jina');assert.equal(links.links.length,1);assert.equal(calls.length,2)
  assert.equal(calls[0].url,'https://api.exa.ai/search');assert.ok(calls[1].url.startsWith('https://s.jina.ai/'));assert.equal(calls[1].init.headers.Authorization,'Bearer j')
  for(const {url,init} of calls){assert.ok(!url.includes('Bearer'));assert.ok(!init.body?.includes('Bearer'))}
})

test('does not call providers without keys or after caller deadline expires',async()=>{
  let calls=0
  const fetchImpl=async()=>{calls++;throw Error('must not fetch')}
  assert.deepEqual(await discoverLinks(source,{exaApiKey:'',jinaApiKey:'',fetchImpl}),{links:[],provider:'',attempted:false,message:''})
  const expired=await discoverLinks(source,{exaApiKey:'x',jinaApiKey:'y',deadline:Date.now()-1,fetchImpl})
  assert.equal(expired.attempted,false);assert.equal(calls,0)
})

test('discovered original URL is parsed and ingested by the crawler',async()=>{
  const saved=[],calls=[],updates=[]
  const db={rpc:async(name)=>name==='regulatory_claim'?{data:true,error:null}:{data:true,error:null},from(table){return {
    insert:async()=>({data:null,error:null}),
    update:row=>({eq:async()=>{updates.push({table,row});return {data:null,error:null}}}),
    select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})}),
    upsert:async row=>{if(table==='regulatory_http_cache')return{data:null,error:null};return{data:null,error:null}}
  }}}
  db.rpc=async(name,args)=>{if(name==='regulatory_ingest')saved.push(args.p_row);return{data:true,error:null}}
  const article='<!doctype html><html><head><meta property="og:title" content="Quyết định về danh mục thuốc đấu thầu"></head><body><div class="detail-sapo">Cơ quan công bố danh mục thuốc.</div><div class="detail-content"><p>Thông tin để rà soát đấu thầu thuốc.</p></div></body></html>'
  const result=await crawlSource(db,{...source,interval_hours:24},{force:true,limit:2,get:async url=>{calls.push(url);return url===source.url?'<html><body>Danh sách chưa có liên kết.</body></html>':article},exaApiKey:'exa-secret',jinaApiKey:'',discoveryFetch:async url=>json({results:[resultItem]}),deadline:Date.now()+5000})
  assert.equal(result.state,'ok');assert.equal(result.count,1);assert.equal(result.discovery_provider,'exa');assert.deepEqual(calls,[source.url,'https://dav.gov.vn/tin/original'])
  assert.equal(saved.length,1);assert.equal(saved[0].source_url,'https://dav.gov.vn/tin/original');assert.equal(saved[0].title,'Quyết định về danh mục thuốc đấu thầu');assert.equal(saved[0].origin,'crawl')
  assert.equal(saved[0].published_at,null,'search-provider date must not replace missing publisher evidence')
  assert.equal(updates.find(value=>value.table==='regulatory_sources').row.last_error,null,'successful discovery is not a source error')
})

const resultItem=result('Quyết định về danh mục thuốc đấu thầu','https://dav.gov.vn/tin/original')
