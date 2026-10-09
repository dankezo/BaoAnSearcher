import test from 'node:test'
import assert from 'node:assert/strict'
import {crawlCompany,isPublicCompanySourceIp,companyNameMatches} from '../api-lib/analytics/company.js'
import {collectCandidates,validBaseline,retryEligible,checkpointAttempt,parseArgs} from '../scripts/enrich_company_profiles.mjs'

const legal='CÔNG TY CỔ PHẦN BẢO AN PHARMA'
const html=`<html><head><title>${legal} | Liên hệ</title><meta property="og:image" content="/logo.png"></head><body>${legal}; Mã số thuế: 0103984595; Địa chỉ: 12 Hà Nội. Điện thoại: 02412345678</body></html>`
const jsonResponse=body=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}})
function pageFetch(url){
 if(url.endsWith('/logo.png'))return Promise.resolve(new Response(Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]),{status:200,headers:{'content-type':'image/png'}}))
 return Promise.resolve(new Response(html,{status:200,headers:{'content-type':'text/html; charset=utf-8'}}))
}
const lookupImpl=async()=>[{address:'8.8.8.8',family:4}]

test('company query matching rejects Bao Anh and non-public source address ranges',()=>{
 assert.equal(companyNameMatches(legal,'Công ty cổ phần Bảo An Pharma'),true)
 assert.equal(companyNameMatches(legal,'Công ty cổ phần Bảo Anh Pharma'),false)
 assert.equal(companyNameMatches('Công ty TNHH Bảo An Pharma',legal),false)
 assert.equal(companyNameMatches(legal,'Công ty CP Bảo An Pharma'),true)
 assert.equal(isPublicCompanySourceIp('2001:db8::1'),false)
 assert.equal(isPublicCompanySourceIp('fc00::1'),false)
 assert.equal(isPublicCompanySourceIp('2606:4700:4700::1111'),true)
})

test('crawl makes no provider request without configured keys',async()=>{
 let requests=0
 const result=await crawlCompany('Bảo An Pharma',{env:{},fetchImpl:async()=>{requests++;throw Error('unexpected')}})
 assert.equal(result.status,'unavailable');assert.equal(requests,0)
})

test('Gemini grounded identity requires literal source evidence; official host and image are checked',async()=>{
 const fetchImpl=async(url,options={})=>{
  if(url.includes('generativelanguage.googleapis.com'))return jsonResponse({steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify({legalName:legal,taxId:'0103984595',address:'12 Hà Nội',phone:'02412345678',website:'https://baoanpharma.example',sourceUrls:['https://fake.example/not-a-citation']})}]},{type:'tool_call',content:[{type:'search_result',annotations:[{type:'url_citation',url:'https://baoanpharma.example/profile'}]}]}]})
  return pageFetch(url)
 }
 const result=await crawlCompany('Công ty cổ phần Bảo An Pharma',{env:{GEMINI_API_KEY:'mock'},fetchImpl,lookupImpl})
 assert.equal(result.status,'verified');assert.equal(result.legalName,legal)
 assert.deepEqual(result.sourceUrls,['https://baoanpharma.example/profile'])
 assert.equal(result.website,'https://baoanpharma.example');assert.equal(result.imageUrl,'https://baoanpharma.example/logo.png')
})

test('Groq fallback only trusts URLs from opened browser tool results, never model prose',async()=>{
 let sourceRequests=0
 const fetchImpl=async(url)=>{
  if(url.includes('generativelanguage.googleapis.com'))return new Response('',{status:429})
  if(url.includes('api.groq.com'))return jsonResponse({choices:[{message:{content:'```json\n'+JSON.stringify({legalName:legal,taxId:'0103984595',address:'12 Hà Nội',sourceUrls:['https://model-invented.example']})+'\n```',executed_tools:[{name:'browser.search',output:'https://exa.ai/search'},{name:'browser.open',output:'L0:\nL1: URL: https://baoanpharma.example/profile'}]}}]})
  sourceRequests++;return pageFetch(url)
 }
 const result=await crawlCompany('Công ty cổ phần Bảo An Pharma',{env:{GEMINI_API_KEY:'mock',GROQ_API_KEY:'mock'},fetchImpl,lookupImpl})
 assert.equal(result.status,'verified');assert.deepEqual(result.sourceUrls,['https://baoanpharma.example/profile']);assert.equal(sourceRequests,1)

 const ungrounded=await crawlCompany('Công ty cổ phần Bảo An Pharma',{env:{GROQ_API_KEY:'mock'},fetchImpl:async url=>url.includes('api.groq.com')?jsonResponse({choices:[{message:{content:JSON.stringify({legalName:legal,sourceUrls:['https://model-invented.example']}),executed_tools:[{name:'browser.search',output:'L0: https://exa.ai/search'}]}}]}):Promise.reject(Error('should not fetch model URL')),lookupImpl})
 assert.equal(ungrounded.status,'unavailable')
})

test('private DNS destinations are rejected before opening a cited page',async()=>{
 let pageRequests=0
 const fetchImpl=async url=>url.includes('generativelanguage.googleapis.com')?jsonResponse({steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify({legalName:legal})}]},{type:'tool_call',content:[{type:'search_result',annotations:[{type:'url_citation',url:'https://private.example/profile'}]}]}]}):(pageRequests++,pageFetch(url))
 const result=await crawlCompany('Công ty cổ phần Bảo An Pharma',{env:{GEMINI_API_KEY:'mock'},fetchImpl,lookupImpl:async()=>[{address:'10.0.0.7',family:4}]})
 assert.equal(result.status,'unavailable');assert.equal(pageRequests,0)
})

test('candidate collection is folded/distinct across source roles; invalid baseline and retry backoff are safe',()=>{
 const candidates=collectCandidates({davRows:[{manufacturer:'Công ty Dược Bảo An',registrant:'Nhà thuốc Bắc Hà'}],mscPriceRows:[{winner:'CÔNG TY DƯỢC BẢO AN',manufacturer:'Nhà máy Bảo An'}],mscTenderRows:[{winner:'Nhà thầu Vĩnh Phúc'}],vssRows:[{supplier:'Nhà thầu Vĩnh Phúc',manufacturer:'Nhà máy Bảo An'}]})
 assert.equal(candidates.length,4)
 assert.deepEqual(candidates.find(x=>x.name==='Công ty Dược Bảo An')?.sources,['dav','msc_prices'])
 const baseline={completedAt:'2026-10-01T00:00:00Z',identityVerifiedAt:'2026-10-01T00:01:00Z',counts:{dav_drugs:10,msc_prices:10,msc_tenders:8,vss_bids:9}}
 assert.equal(validBaseline(baseline,{dav_drugs:10,msc_prices:10,msc_tenders:8,vss_bids:9}),true)
 assert.equal(validBaseline(baseline,{dav_drugs:10,msc_prices:9,msc_tenders:8,vss_bids:9}),false)
 assert.equal(validBaseline(baseline,{dav_drugs:11,msc_prices:10,msc_tenders:8,vss_bids:9}),false)
 assert.equal(validBaseline({...baseline,identityVerifiedAt:null},{dav_drugs:10,msc_prices:10,msc_tenders:8,vss_bids:9}),false)
 assert.equal(retryEligible(undefined,Date.parse('2026-10-01')),true)
 assert.equal(retryEligible({status:'pending',nextAttemptAt:'2027-01-01'},Date.parse('2026-10-01')),false)
 assert.equal(retryEligible({status:'web_verified'},Date.parse('2027-01-02')),false)
 const state={attempts:{}}
 checkpointAttempt(state,{key:'bao an pharma',name:'Bảo An Pharma'},'pending',Date.parse('2026-10-01'))
 assert.equal(state.attempts['bao an pharma'].name,'Bảo An Pharma')
 assert.equal(state.attempts['bao an pharma'].attempts,1)
 assert.ok(Date.parse(state.attempts['bao an pharma'].nextAttemptAt)>Date.parse('2026-10-01'))
 checkpointAttempt(state,{key:'bao an pharma',name:'Bảo An Pharma'},'web_verified',Date.parse('2026-10-02'))
 assert.equal(state.attempts['bao an pharma'].status,'web_verified');assert.equal(retryEligible(state.attempts['bao an pharma']),false)
 assert.deepEqual(parseArgs([]),{yesRemote:false,limit:10})
 assert.deepEqual(parseArgs(['--yes-remote','--limit','100']),{yesRemote:true,limit:50})
})


test('identity fields from a different cited company are never merged into the requested firm',async()=>{
 const fetchImpl=async url=>url.includes('generativelanguage.googleapis.com')?jsonResponse({steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify({legalName:legal,taxId:'9998887776',address:'55 Singapore Road'})}]},{type:'tool_call',content:[{type:'search_result',annotations:[{type:'url_citation',url:'https://baoanpharma.example/profile'},{type:'url_citation',url:'https://othercompany.example/profile'}]}]}]}):new Response(url.includes('othercompany')?'<html><body>Other Company; Mã số thuế: 9998887776; 55 Singapore Road</body></html>':html,{headers:{'content-type':'text/html'}})
 const result=await crawlCompany('Công ty cổ phần Bảo An Pharma',{env:{GEMINI_API_KEY:'mock'},fetchImpl,lookupImpl})
 assert.equal(result.legalName,legal);assert.equal(result.taxId,null);assert.equal(result.address,null);assert.equal(result.status,'partial')
})
