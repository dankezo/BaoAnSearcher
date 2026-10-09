import { cachedQuery, stableKey } from '../queryCache'
import { getSupabase } from '../supabaseClient'
import type { AnalyticsQuery,AnalyticsOverview,DetailPage,Source,StrategicInsight,EntitySuggestion,Preset } from './types'
function supabase(){const client=getSupabase();if(!client)throw new Error('Chưa cấu hình Supabase.');return client}
async function session() {
  const {data}=await supabase().auth.getSession()
  if(!data.session) throw new Error('Cần đăng nhập để phân tích.')
  return data.session
}
export async function request<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T> {
  const s=await session()
  const auxiliary=path.endsWith('/awards')||path.endsWith('/company-profile')&&!(body as {refresh?:boolean})?.refresh
  const cacheKey=`baoan.analytics.aux.v3.${s.user.id}`,key=JSON.stringify([path,body])
  if(auxiliary)try{const records=JSON.parse(sessionStorage.getItem(cacheKey)||'{}');if(Object.hasOwn(records,key))return records[key]}catch{}
  const timeout=AbortSignal.timeout(90000)
  const response=await fetch(`${import.meta.env.VITE_API_BASE||''}${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.access_token}`},body:body?JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,timeout]):timeout})
  if(!response.ok){const v=await response.json().catch(()=>({}));throw new Error(v.error||v.detail||'Chưa tải được dữ liệu phân tích.')}
  const result=await response.json()
  if(auxiliary)try{const records=JSON.parse(sessionStorage.getItem(cacheKey)||'{}');records[key]=result;const keys=Object.keys(records);for(const old of keys.slice(0,Math.max(0,keys.length-32)))delete records[old];sessionStorage.setItem(cacheKey,JSON.stringify(records))}catch{}
  if(path.endsWith('/company-profile')&&(body as {refresh?:boolean})?.refresh)clearAnalyticsAux()
  return result
}
export function clearAnalyticsAux(){try{for(const key of Object.keys(sessionStorage))if(key.startsWith('baoan.analytics.aux.'))sessionStorage.removeItem(key)}catch{}}
async function cached<T>(path:string,body:unknown):Promise<T>{
  const s=await session()
  const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered((value as Record<string,unknown>)[key])])):value
  return cachedQuery(stableKey(`analytics-v2:${s.user.id}:${path}`,ordered(body)),()=>request<T>(path,body),{freshMs:300000,staleMs:300000})
}
export const loadOverview=(q:AnalyticsQuery)=>cached<AnalyticsOverview>('/api/analytics/overview',q)
export const loadDetail=(q:AnalyticsQuery,source:Source,page:number)=>cached<DetailPage>('/api/analytics/detail',{query:q,source,page})
export const loadCompetition=(q:AnalyticsQuery,source:Source,page:number)=>cached<DetailPage>('/api/analytics/detail',{query:q,source,page,panel:'competition'})
export const loadProducts=(q:AnalyticsQuery,source:Source)=>cached<DetailPage>('/api/analytics/detail',{query:q,source,panel:'products'})
export const loadInsight=(q:AnalyticsQuery,refresh=false,snapshot?:AnalyticsOverview)=>{const body={query:q,...(snapshot?{snapshot:{version:snapshot.version,query:snapshot.query,generatedAt:snapshot.generatedAt,sources:Object.fromEntries(Object.entries(snapshot.sources).map(([source,stats])=>[source,{...stats,rows:stats.rows.filter(row=>!['price_coordinate','unit_month','month_group'].includes(row.kind))}])),missing:snapshot.missing}}:{}),...(refresh?{refreshAt:Date.now()}:{})};return refresh?request<StrategicInsight>('/api/analytics/ai-insight',body):cached<StrategicInsight>('/api/analytics/ai-insight',body)}
export const loadSuggestions=(q:string,signal:AbortSignal)=>request<{items:EntitySuggestion[]}>(`/api/analytics/suggest?q=${encodeURIComponent(q)}`,undefined,signal)
export async function presets():Promise<Preset[]>{
  const {data,error}=await supabase().from('user_saved_filters').select('id,name,configuration,version').order('created_at',{ascending:false}).limit(100)
  if(error) throw new Error('Chưa đọc được bộ lọc đã lưu. Kiểm tra migration preset.')
  return data||[]
}
export async function savePreset(name:string,configuration:AnalyticsQuery){
  const s=await session()
  const {error}=await supabase().from('user_saved_filters').insert({name,configuration,version:1,user_id:s.user.id})
  if(error) throw new Error('Chưa lưu được bộ lọc. Kiểm tra kết nối và migration preset.')
}
export function remember(q:AnalyticsQuery,userId:string){try{const key=`baoan.analytics.history.${userId}`,stored=JSON.parse(localStorage.getItem(key)||'null');const history:AnalyticsQuery[]=stored?.version===1&&Array.isArray(stored.history)?stored.history:[];localStorage.setItem(key,JSON.stringify({version:1,history:[q,...history.filter(item=>JSON.stringify(item)!==JSON.stringify(q))].slice(0,20)}))}catch{/* Storage is optional. */}}
