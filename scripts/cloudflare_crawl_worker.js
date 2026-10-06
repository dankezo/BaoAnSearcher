import { DurableObject } from "cloudflare:workers";
const SOURCE_URL="https://muasamcong.mpi.gov.vn/web/guest/contractor-selection?p_p_id=egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2&p_p_lifecycle=0&p_p_state=normal&p_p_mode=view&_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render=index&indexSelect=-1";
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
  if(!env.CRAWL_KEY || request.headers.get('Authorization')!=='Bearer '+env.CRAWL_KEY)return new Response('Unauthorized',{status:401});
  if(url.pathname==='/quota')return Response.json({limit_ms:480000,reserved_or_used_ms:this.total(),remaining_ms:Math.max(0,480000-this.total()),window:'rolling_24_hours',priority:'msc_tenders'});
  if(request.method==='POST' && url.pathname==='/vss/probe'){
   try{
    const r=await fetch('https://quanlythuocv1.vss.gov.vn/kqdt/export?ngaycongbo=02%2F10%2F2026&loai=1',{signal:AbortSignal.timeout(20000)});
    const text=await r.text();return Response.json({source:'vss',status:r.status,bytes:text.length,rows:(text.match(/<Row[ >]/g)||[]).length});
   }catch{return Response.json({source:'vss',error:'network_unavailable'},{status:502})}
  }
  if(request.method!=='POST' || url.pathname!=='/msc/search')return new Response('Not found',{status:404});
  let input;try{input=await request.json()}catch{return new Response('Invalid JSON',{status:400})}
  if(!Number.isInteger(input.page)||input.page<0||input.page>199)return new Response('Invalid page',{status:400});
  const body=structuredClone(BASE_PAYLOAD);body.pageNumber=input.page;
  const cached=this.ctx.storage.kv.get('page:'+input.page);
  if(cached?.expires>Date.now())return Response.json(cached.data,{headers:{'X-Crawl-Cache':'hit','X-Crawl-Budget-Ms':String(this.total())}});
  const id=crypto.randomUUID();
  const reserved=this.ctx.storage.transactionSync(()=>{
   const ledger=this.usage();if(ledger.reduce((n,x)=>n+x.ms,0)+90000>480000)return false;
   ledger.push({id,at:Date.now(),ms:90000});this.ctx.storage.kv.put('usage',ledger);return true;
  });
  if(!reserved)return Response.json({error:'daily_msc_browser_budget_reached',retry_after:'next rolling 24-hour window'},{status:429});
  try {
   const response=await env.BROWSER.quickAction('content',{
    url:SOURCE_URL,actionTimeout:45000,gotoOptions:{waitUntil:'domcontentloaded',timeout:25000},
    addScriptTag:[{content:SEARCH_SCRIPT.replace('PAYLOAD',JSON.stringify(body))}],
    waitForSelector:{selector:'#baoan-search-result',timeout:40000}
   });
   const data=await response.json();const content=data.result||'';
   const meter=response.headers.get('X-Browser-Ms-Used');
   if(meter && /^\d+$/.test(meter))this.ctx.storage.transactionSync(()=>{
    const ledger=this.usage();const entry=ledger.find(x=>x.id===id);if(entry)entry.ms=Number(meter)+5000;
    this.ctx.storage.kv.put('usage',ledger);
   });
   const match=content.match(/<pre[^>]*id="baoan-search-result"[^>]*>([\s\S]*?)<\/pre>/);
   if(!data.success||!match)return Response.json({error:'incomplete_cloud_search'},{status:502});
   const decoded=match[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
   const result=JSON.parse(decoded);
   if(result.status!==200||!Array.isArray(result.page?.content)||!Number.isInteger(result.page.totalPages))return Response.json({error:'invalid_source_response'},{status:502});
   if(result.page.content.some(row=>![1,'1',true].includes(row.isMedicine)))return Response.json({error:'wrong_medicine_filter'},{status:502});
   const output={page:result.page};this.ctx.storage.kv.put('page:'+input.page,{expires:Date.now()+1800000,data:output});
   return Response.json(output,{headers:{'Cache-Control':'no-store','X-Crawl-Cache':'miss','X-Crawl-Budget-Ms':String(this.total())}});
  }catch{return Response.json({error:'public_source_unavailable'},{status:502})}
 }
}

export default {
 async fetch(request,env){
  if(new URL(request.url).pathname==='/health')return Response.json({service:'BaoAn public crawl',browser:!!env.BROWSER,budget_ms:480000});
  if(!env.CRAWL_KEY||request.headers.get('Authorization')!=='Bearer '+env.CRAWL_KEY)return new Response('Unauthorized',{status:401});
  return env.BUDGET.get(env.BUDGET.idFromName('msc-priority')).fetch(request);
 }
};