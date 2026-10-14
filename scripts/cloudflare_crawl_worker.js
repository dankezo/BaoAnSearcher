import { DurableObject } from "cloudflare:workers";
const SOURCE_URL="https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?p_p_id=egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2&p_p_lifecycle=0&p_p_state=normal&p_p_mode=view&_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=index&indexSelect=-1";
const YCBG_URL="https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?render=index";
const YCBG_SERVICE="/o/egp-portal-contractor-selection-v2/services/get-request-quote";
const YCBG_PAGE_PAYLOAD={pageSize:'50',pageNumber:0,query:[{index:'es-contractor-selection',keyWord:'thầu thuốc',matchType:'all-1',matchFields:['notifyNo','name'],filters:[{fieldName:'type',searchType:'in',fieldValues:['es-ycbg']}]}]};
const SEARCH_SCRIPT="(() => {\n      const wanted=PAYLOAD; let started=false;\n      const finish=value=>{if(document.getElementById('baoan-search-result'))return;const e=document.createElement('pre');e.id='baoan-search-result';e.textContent=JSON.stringify(value);document.body.appendChild(e)};\n      const timer=setTimeout(()=>finish({error:'search_timeout'}),35000);\n      const poll=setInterval(()=>{\n        const v=Array.from(document.querySelectorAll('[id]')).map(e=>e.__vue__).find(v=>v && typeof v.axiosSearch==='function');\n        if(!v || started || typeof axios==='undefined')return;\n        started=true;clearInterval(poll);\n        axios.interceptors.response.use(r=>{\n          let sent;try{sent=JSON.parse(r.config.data);if(Array.isArray(sent))sent=sent[0]}catch{return r}\n          if(r.config.url.split('?')[0]===v.elasticSearch && Number(sent.pageNumber)===wanted.pageNumber && Number(sent.pageSize)===Number(wanted.pageSize) && JSON.stringify(sent.query)===JSON.stringify(wanted.query)){\n            clearTimeout(timer);finish({status:r.status,page:r.data&&r.data.page});\n          }\n          return r;\n        },err=>{if(err.config&&err.config.url.split('?')[0]===v.elasticSearch){clearTimeout(timer);finish({error:'search_http_error'})}return Promise.reject(err)});\n        v.quickSearchPayload.pageSize=wanted.pageSize;v.currentPage=wanted.pageNumber;v.axiosSearch(wanted);\n      },250);\n    })()";
const BASE_PAYLOAD={"pageSize": "50", "pageNumber": 0, "query": [{"index": "es-contractor-selection", "keyWord": "", "matchType": "all-1", "matchFields": ["notifyNo", "bidName"], "filters": [{"fieldName": "type", "searchType": "in", "fieldValues": ["es-notify-contractor"]}, {"fieldName": "isMedicine", "searchType": "in", "fieldValues": [1]}, {"fieldName": "caseKHKQ", "searchType": "not_in", "fieldValues": ["1"]}]}]};

export class CrawlBudget extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;}
 usage(){return (this.ctx.storage.kv.get('usage')||[]).filter(x=>x.at>Date.now()-86400000);}
 total(){return this.usage().reduce((n,x)=>n+x.ms,0);}
 async fetch(request,env) {
  env=this.env;
  const url=new URL(request.url);
  if(url.pathname==='/health')return Response.json({service:'BaoAn public crawl',browser:!!env.BROWSER});
  const auth=request.headers.get('Authorization');
  const ycbgOnly=url.pathname.startsWith('/ycbg/')||url.pathname==='/quota';
  const crawlAuthorized=[env.CRAWL_KEY,env.CRAWL_APP_KEY].filter(Boolean).some(key=>auth==='Bearer '+key);
  const ycbgAuthorized=ycbgOnly&&!!env.YCBG_KEY&&auth==='Bearer '+env.YCBG_KEY;
  if(!crawlAuthorized&&!ycbgAuthorized)return new Response('Unauthorized',{status:401});
  if(url.pathname==='/quota')return Response.json({limit_ms:480000,reserved_or_used_ms:this.total(),remaining_ms:Math.max(0,480000-this.total()),window:'rolling_24_hours',priority:'msc_tenders'});
  if(request.method==='POST' && url.pathname==='/vss/probe'){
   try{
    const r=await fetch('https://quanlythuocv1.vss.gov.vn/kqdt/export?ngaycongbo=02%2F10%2F2026&loai=1',{signal:AbortSignal.timeout(20000)});
    const text=await r.text();return Response.json({source:'vss',status:r.status,bytes:text.length,rows:(text.match(/<Row[ >]/g)||[]).length});
   }catch{return Response.json({source:'vss',error:'network_unavailable'},{status:502})}
  }
  if(request.method==='POST'&&url.pathname==='/ycbg/search')return this.ycbgSearch(request);
  if(request.method==='POST'&&url.pathname==='/ycbg/details')return this.ycbgDetails(request);
  if(request.method!=='POST' || url.pathname!=='/msc/search')return new Response('Not found',{status:404});
  let input;try{input=await request.json()}catch{return new Response('Invalid JSON',{status:400})}
  if(!Number.isInteger(input.page)||input.page<0||input.page>199)return new Response('Invalid page',{status:400});
  const body=structuredClone(BASE_PAYLOAD);body.pageNumber=input.page;
  const cached=this.ctx.storage.kv.get('page:'+input.page);
  if(!input.fresh&&cached?.expires>Date.now())return Response.json(cached.data,{headers:{'X-Crawl-Cache':'hit','X-Crawl-Budget-Ms':String(this.total())}});
  const id=crypto.randomUUID();
  const reserved=this.ctx.storage.transactionSync(()=>{
   const ledger=this.usage();if(ledger.reduce((n,x)=>n+x.ms,0)+90000>480000)return false;
   const startAt=Math.max(Date.now(),this.ctx.storage.kv.get('next_browser_at')||0);
   ledger.push({id,at:startAt,ms:90000});this.ctx.storage.kv.put('usage',ledger);
   this.ctx.storage.kv.put('next_browser_at',startAt+11000);return {startAt};
  });
  if(!reserved)return Response.json({error:'daily_msc_browser_budget_reached',retry_after:'next rolling 24-hour window'},{status:429});
  const fail=(code,status=502,retryAfter=0)=>{
   console.warn(JSON.stringify({event:'msc_search_failed',page:input.page,code}));
   return Response.json({error:code,...(retryAfter?{retry_after_seconds:retryAfter}:{})},{status,headers:retryAfter?{'Retry-After':String(retryAfter)}:{}});
  };
  try {
   // Free Quick Actions must start at least ten seconds apart, even after a fast page.
   const waitMs=reserved.startAt-Date.now();if(waitMs>0)await scheduler.wait(waitMs);
   const browserStarted=Date.now();
   const response=await env.BROWSER.quickAction('content',{
    url:SOURCE_URL,actionTimeout:45000,gotoOptions:{waitUntil:'domcontentloaded',timeout:25000},
    addScriptTag:[{content:SEARCH_SCRIPT.replace('PAYLOAD',JSON.stringify(body))}],
    waitForSelector:{selector:'#baoan-search-result',timeout:40000}
   });
   const data=await response.json();const content=data.result||'';
   const meter=response.headers.get('X-Browser-Ms-Used');
   this.ctx.storage.transactionSync(()=>{
    const ledger=this.usage();const entry=ledger.find(x=>x.id===id);if(entry)entry.ms=(meter&&/^\d+$/.test(meter)?Number(meter):Date.now()-browserStarted)+5000;
    this.ctx.storage.kv.put('usage',ledger);
   });
   const match=content.match(/<pre[^>]*id="baoan-search-result"[^>]*>([\s\S]*?)<\/pre>/);
   if(!data.success||!match){
    const message=JSON.stringify(data.errors||[]);
    if(response.status===429||/429|too many requests|time limit exceeded/i.test(message)){
     this.ctx.storage.transactionSync(()=>this.ctx.storage.kv.put('usage',this.usage().filter(x=>x.id!==id)));
     return fail(/time limit exceeded/i.test(message)?'browser_daily_limit_reached':'browser_rate_limited',429,Number(response.headers.get('Retry-After'))||11);
    }
    return fail('incomplete_cloud_search');
   }
   const decoded=match[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
   const result=JSON.parse(decoded);
   if(result.status!==200||!Array.isArray(result.page?.content)||!Number.isInteger(result.page.totalPages))return fail(result.error==='search_timeout'?'msc_search_timeout':result.error==='search_http_error'?'msc_search_http_error':'invalid_source_response');
   if(result.page.content.some(row=>![1,'1',true].includes(row.isMedicine)))return Response.json({error:'wrong_medicine_filter'},{status:502});
   const output={page:result.page};this.ctx.storage.kv.put('page:'+input.page,{expires:Date.now()+1800000,data:output});
   return Response.json(output,{headers:{'Cache-Control':'no-store','X-Crawl-Cache':'miss','X-Crawl-Budget-Ms':String(this.total())}});
  }catch(error){
   const message=String(error?.message||'');
   if(error?.status===429||/429|too many requests|time limit exceeded/i.test(message)){
    this.ctx.storage.transactionSync(()=>this.ctx.storage.kv.put('usage',this.usage().filter(x=>x.id!==id)));
    return fail(/time limit exceeded/i.test(message)?'browser_daily_limit_reached':'browser_rate_limited',429,11);
   }
   return fail('public_source_unavailable');
  }
 }

 async reserve(id) {
  return this.ctx.storage.transactionSync(()=>{
   const ledger=this.usage();if(ledger.reduce((n,x)=>n+x.ms,0)+90000>480000)return false;
   const startAt=Math.max(Date.now(),this.ctx.storage.kv.get('next_browser_at')||0);
   ledger.push({id,at:startAt,ms:90000});this.ctx.storage.kv.put('usage',ledger);
   this.ctx.storage.kv.put('next_browser_at',startAt+11000);return {startAt};
  });
 }

 async browserAction(id,url,script,selector,actionTimeout=45000) {
  const reserved=await this.reserve(id);
  if(!reserved)return {error:Response.json({error:'daily_msc_browser_budget_reached',retry_after:'next rolling 24-hour window'},{status:429})};
  const waitMs=reserved.startAt-Date.now();if(waitMs>0)await scheduler.wait(waitMs);
  const browserStarted=Date.now();
  try {
   const response=await this.env.BROWSER.quickAction('content',{
    url,actionTimeout,gotoOptions:{waitUntil:'domcontentloaded',timeout:25000},
    addScriptTag:[{content:script}],waitForSelector:{selector,timeout:Math.min(120000,actionTimeout)}
   });
   const meter=response.headers.get('X-Browser-Ms-Used');
   this.ctx.storage.transactionSync(()=>{
    const ledger=this.usage();const entry=ledger.find(x=>x.id===id);
    if(entry)entry.ms=(meter&&/^\d+$/.test(meter)?Number(meter):Date.now()-browserStarted)+5000;
    this.ctx.storage.kv.put('usage',ledger);
   });
   const data=await response.json();
   const providerMessage=JSON.stringify(data.errors||[]);
   if(response.status===429||/429|too many requests|time limit exceeded/i.test(providerMessage)){
    this.ctx.storage.transactionSync(()=>this.ctx.storage.kv.put('usage',this.usage().filter(x=>x.id!==id)));
    return {error:Response.json({error:/time limit exceeded/i.test(providerMessage)?'browser_daily_limit_reached':'browser_rate_limited'},{status:429,headers:{'Retry-After':response.headers.get('Retry-After')||'11'}})};
   }
   if(!data.success)return {error:Response.json({error:'incomplete_ycbg_browser_action'},{status:502})};
   return {content:data.result||''};
  }catch(error){
   const message=String(error?.message||'');
   if(error?.status===429||/429|too many requests|time limit exceeded/i.test(message)){
    this.ctx.storage.transactionSync(()=>this.ctx.storage.kv.put('usage',this.usage().filter(x=>x.id!==id)));
    return {error:Response.json({error:/time limit exceeded/i.test(message)?'browser_daily_limit_reached':'browser_rate_limited'},{status:429,headers:{'Retry-After':'11'}})};
   }
   return {error:Response.json({error:'public_ycbg_source_unavailable'},{status:502})};
  }
 }

 async ycbgSearch(request) {
  let input;try{input=await request.json()}catch{return new Response('Invalid JSON',{status:400})}
  if(!Number.isInteger(input.page)||input.page<0||input.page>999)return new Response('Invalid page',{status:400});
  const key='ycbg:page:'+input.page,cached=this.ctx.storage.kv.get(key);
  if(!input.fresh&&cached?.expires>Date.now())return Response.json(cached.data,{headers:{'X-Crawl-Cache':'hit','X-Crawl-Budget-Ms':String(this.total())}});
  const body=structuredClone(YCBG_PAGE_PAYLOAD);body.pageNumber=input.page;
  const script=`(()=>{const wanted=${JSON.stringify(body)};let started=false;const finish=value=>{if(document.getElementById('baoan-ycbg-search-result'))return;const e=document.createElement('pre');e.id='baoan-ycbg-search-result';e.textContent=JSON.stringify(value);document.body.appendChild(e)};setTimeout(()=>finish({error:'timeout'}),35000);const poll=setInterval(()=>{const v=Array.from(document.querySelectorAll('[id]')).map(e=>e.__vue__).find(v=>v&&typeof v.axiosSearch==='function');if(!v||started||typeof axios==='undefined')return;started=true;clearInterval(poll);axios.interceptors.response.use(r=>{let sent;try{sent=JSON.parse(r.config.data);if(Array.isArray(sent))sent=sent[0]}catch{return r}if(r.config.url.split('?')[0]===v.elasticSearch&&Number(sent.pageNumber)===wanted.pageNumber&&Number(sent.pageSize)===Number(wanted.pageSize)&&JSON.stringify(sent.query)===JSON.stringify(wanted.query))finish({status:r.status,page:r.data&&r.data.page});return r},err=>{if(err.config&&err.config.url.split('?')[0]===v.elasticSearch)finish({error:'search_http_error'});return Promise.reject(err)});v.quickSearchPayload.pageSize=wanted.pageSize;v.currentPage=wanted.pageNumber;v.axiosSearch(wanted)},250)})()`;
  const id=crypto.randomUUID(),result=await this.browserAction(id,YCBG_URL,script,'#baoan-ycbg-search-result');
  if(result.error)return result.error;
  const parsed=readPre(result.content,'baoan-ycbg-search-result');
  if(parsed?.status!==200||!Array.isArray(parsed.page?.content)||!Number.isInteger(parsed.page.totalPages)||!Number.isInteger(parsed.page.totalElements)||parsed.page.totalPages>1000||parsed.page.content.some(row=>!String(row.notifyNo||'').startsWith('RQ')||!String(row.id||'').match(/^[a-zA-Z0-9-]{1,64}$/)))return Response.json({error:'invalid_ycbg_source_response'},{status:502});
  const data={page:parsed.page};this.ctx.storage.kv.put(key,{expires:Date.now()+1800000,data});
  return Response.json(data,{headers:{'Cache-Control':'no-store','X-Crawl-Cache':'miss','X-Crawl-Budget-Ms':String(this.total())}});
 }

 async ycbgDetails(request) {
  let input;try{input=await request.json()}catch{return new Response('Invalid JSON',{status:400})}
  const ids=input.ids;
  if(!Array.isArray(ids)||ids.length<1||ids.length>8||ids.some(id=>typeof id!=='string'||! /^[a-zA-Z0-9-]{1,64}$/.test(id))||new Set(ids).size!==ids.length)return new Response('Invalid IDs',{status:400});
  const results=new Map();let missing=[];
  for(const id of ids){const cached=this.ctx.storage.kv.get('ycbg:detail:'+id);if(!input.fresh&&cached?.expires>Date.now())results.set(id,cached.detail);else missing.push(id)}
  // Public details work directly from the edge; reserve browser time for fallback.
  for(const row of await directYcbgDetails(missing)){
   if(!row.detail)continue;
   results.set(row.id,row.detail);
   if(new TextEncoder().encode(JSON.stringify(row.detail)).length<120000)this.ctx.storage.kv.put('ycbg:detail:'+row.id,{expires:Date.now()+21600000,detail:row.detail});
  }
  missing=missing.filter(id=>!results.has(id));
  if(missing.length){
   const script=`(()=>{const ids=${JSON.stringify(missing)};let started=false;const results=[];const finish=()=>{let e=document.getElementById('baoan-ycbg-details-result');if(!e){e=document.createElement('pre');e.id='baoan-ycbg-details-result';document.body.appendChild(e)}e.textContent=JSON.stringify({results});let done=document.getElementById('baoan-ycbg-details-complete');if(!done){done=document.createElement('i');done.id='baoan-ycbg-details-complete';document.body.appendChild(done)}};const timeout=setTimeout(finish,35000);const poll=setInterval(async()=>{if(started||typeof axios==='undefined')return;started=true;clearInterval(poll);let next=0;await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{while(next<ids.length){const id=ids[next++];try{const r=await axios.post(${JSON.stringify(YCBG_SERVICE)},{id},{timeout:8000});const d=r.data;if(!d?.bidoRequestQuote||String(d.bidoRequestQuote.id)!==id)throw new Error('invalid_detail');results.push({id,detail:d})}catch{results.push({id,error:'detail_fetch_failed'})}}}));clearTimeout(timeout);finish()},250)})()`;
   const id=crypto.randomUUID(),action=await this.browserAction(id,YCBG_URL,script,'#baoan-ycbg-details-complete',45000);
   if(action.error)return action.error;
   const parsed=readPre(action.content,'baoan-ycbg-details-result');
   if(!Array.isArray(parsed?.results))return Response.json({error:'invalid_ycbg_detail_response'},{status:502});
   for(const row of parsed.results){
    if(!ids.includes(row.id))continue;
    if(row.detail?.bidoRequestQuote&&String(row.detail.bidoRequestQuote.id)===row.id){
     results.set(row.id,row.detail);if(new TextEncoder().encode(JSON.stringify(row.detail)).length<120000)this.ctx.storage.kv.put('ycbg:detail:'+row.id,{expires:Date.now()+21600000,detail:row.detail});
    }else results.set(row.id,{error:'detail_fetch_failed'});
   }
  }
  return Response.json({results:ids.map(id=>({id,...(results.get(id)?.error?{error:results.get(id).error}:{detail:results.get(id)})}))},{headers:{'Cache-Control':'no-store','X-Crawl-Cache':missing.length?'miss':'hit','X-Crawl-Budget-Ms':String(this.total())}});
 }
}

async function directYcbgDetails(ids){
 return Promise.all(ids.map(async id=>{
  try{
   const response=await fetch(new URL(YCBG_SERVICE,YCBG_URL).href,{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://muasamcong.mpi.gov.vn','Referer':YCBG_URL},body:JSON.stringify({id}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)return {id,error:'upstream_'+response.status};
   const detail=await response.json();
   return String(detail?.bidoRequestQuote?.id||'')===id?{id,detail}:{id,error:'invalid_detail_id'};
  }catch{return {id,error:'source_unavailable'}}
 }));
}

function readPre(content,id){
 const match=String(content||'').match(new RegExp(`<pre[^>]*id="${id}"[^>]*>([\\s\\S]*?)</pre>`));
 if(!match)return null;
 try{return JSON.parse(match[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'))}catch{return null}
}

export default {
 async fetch(request,env){
  if(new URL(request.url).pathname==='/health')return Response.json({service:'BaoAn public crawl',browser:!!env.BROWSER,budget_ms:480000});
  const path=new URL(request.url).pathname,auth=request.headers.get('Authorization');
  const ycbgOnly=path.startsWith('/ycbg/')||path==='/quota';
  const crawlAuthorized=[env.CRAWL_KEY,env.CRAWL_APP_KEY].filter(Boolean).some(key=>auth==='Bearer '+key);
  const ycbgAuthorized=ycbgOnly&&!!env.YCBG_KEY&&auth==='Bearer '+env.YCBG_KEY;
  if(!crawlAuthorized&&!ycbgAuthorized)return new Response('Unauthorized',{status:401});
  if(path==='/ycbg/details'&&request.method==='POST'){
   let input;try{input=await request.clone().json()}catch{return new Response('Invalid JSON',{status:400})}
   const ids=input.ids;
   if(Array.isArray(ids)&&ids.length>0&&ids.length<=8&&ids.every(id=>typeof id==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(id))&&new Set(ids).size===ids.length){
    const results=await directYcbgDetails(ids);
    if(results.every(row=>row.detail))return Response.json({results},{headers:{'Cache-Control':'no-store','X-YCBG-Source':'edge-api'}});
   }
  }
  return env.BUDGET.get(env.BUDGET.idFromName('msc-priority')).fetch(request);
 }
};
