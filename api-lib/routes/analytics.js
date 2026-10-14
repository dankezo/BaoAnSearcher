import { requireUser, json } from '../auth.js'
import { overview, detail, suggest, normalizeQuery, queryKey, savedOverview, fold } from '../analytics/core.js'
import { cloudAdapter } from '../analytics/cloud.js'
import { memo } from '../analytics/cache.js'
import { insight,regulatoryContext } from '../analytics/insight.js'
import {supabaseAsUser} from '../supabaseClient.js'
import { readSnapshot } from '../analytics/snapshot.js'
import { portfolioCoordinates, companyStrategy } from '../analytics/portfolio.js'
import { recentAwards } from '../analytics/awards.js'
import { companyProfiles } from '../analytics/companyStore.js'
async function readQuery(req) {
  const chunks=[];let length=0
  const limit=new URL(req.url,'https://localhost').pathname.endsWith('/ai-insight')?1048576:16000
  for await(const chunk of req){length+=chunk.length;if(length>limit)throw Object.assign(new Error('Dữ liệu phân tích quá lớn.'),{status:413});chunks.push(chunk)}
  try {const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value}
  catch {throw Object.assign(new Error('Bộ lọc không hợp lệ.'),{status:400})}
}
export default async function handler(req,res) {
  const {accessToken}=await requireUser(req)
  const action = new URL(req.url,'https://localhost').pathname.split('/').pop()
  if(action==='suggest') return json(res,200,await memo(`suggest:${fold(req.query?.q||new URL(req.url,'https://localhost').searchParams.get('q')||'')}`,()=>suggest(cloudAdapter,req.query?.q||new URL(req.url,'https://localhost').searchParams.get('q')||'')))
  const body=await readQuery(req)
  const q=normalizeQuery(body.query||body)
  if(action==='awards') return json(res,200,await memo(`awards:${queryKey(q)}:${body.scope?queryKey(body.scope):''}:${body.source}:${body.sort}:${body.page||0}`,()=>recentAwards(cloudAdapter,q,body)))
  if(action==='company-profile') return json(res,200,await companyProfiles(q,Boolean(body.refresh),body.legalName))
  if(action==='detail') return json(res,200,await memo(`detail:${queryKey(q)}:${body.source}:${body.page||0}:${body.panel||'rows'}:${body.tenderNo||''}`,()=>detail(cloudAdapter,{...body,query:q})))
  if(action==='overview'&&String(req.headers.accept||'').includes('application/x-ndjson')){
    res.statusCode=200
    res.setHeader('Content-Type','application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control','no-store')
    const emit=value=>{if(!res.destroyed)res.write(JSON.stringify(value)+'\n')}
    emit({type:'start'})
    try{
      const run=()=>overview(cloudAdapter,q,(source,stats)=>emit({type:'source',source,status:stats.status,durationMs:stats.durationMs}),progress=>emit({type:'progress',...progress}))
      const data=await memo(`overview:${queryKey(q)}`,async()=>q.mode==='territory'?await run():await readSnapshot(q)||await run())
      const result=q.mode==='company'?{...data,baoanCoordinates:await memo('baoan:coordinates',()=>portfolioCoordinates(cloudAdapter))}:data
      emit({type:'complete',data:result})
    }catch{emit({type:'error',error:'Chưa tổng hợp được dữ liệu. Vui lòng thử lại.'})}
    res.end()
    return
  }
  const data=action==='ai-insight'&&body.snapshot?savedOverview(body.snapshot,body.query):await memo(`overview:${queryKey(q)}`,async()=>q.mode==='territory'?await overview(cloudAdapter,q):await readSnapshot(q)||await overview(cloudAdapter,q))
  const strategy=action==='ai-insight'&&q.mode==='company'?await memo(`company-strategy:${queryKey(q)}`,()=>companyStrategy(cloudAdapter,q)):undefined
  const result=action==='ai-insight'?await insight({...data,...await regulatoryContext(supabaseAsUser(accessToken)),companyStrategy:strategy,_refreshAt:body.refreshAt}):q.mode==='company'?{...data,baoanCoordinates:await memo('baoan:coordinates',()=>portfolioCoordinates(cloudAdapter))}:data
  return json(res,200,result)
}
