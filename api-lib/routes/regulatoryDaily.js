import { timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { json } from '../auth.js'
import { checked } from '../../lib/regulatory/store.js'
import { crawlSource } from '../../lib/regulatory/crawler.js'
import { analyzeDaily } from '../../lib/regulatory/ai.js'
import {seedSources} from '../../lib/regulatory/seed.js'

export const config = { maxDuration: 300 }
export function authorized(header, secret) {
  if (!secret) return false
  const a=Buffer.from(String(header||'')), b=Buffer.from(`Bearer ${secret}`)
  return a.length===b.length && timingSafeEqual(a,b)
}
export default async function handler(req,res) {
  if (!authorized(req.headers.authorization,process.env.CRON_SECRET)) return json(res,401,{error:'Unauthorized'})
  if (req.method!=='GET') return json(res,405,{error:'Method not allowed'})
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json(res,503,{error:'Crawler chưa cấu hình.'})
  const db=createClient(process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})}})
  try {
    // Authenticated operational retry; leases and HTTP cache still apply.
    const refresh = new URL(req.url, 'https://localhost').searchParams.get('refresh') === '1'
    const deadline=Date.now()+200000
    await seedSources(db)
    const sources=checked(await db.from('regulatory_sources').select('*').eq('enabled',true).order('last_attempt',{ascending:true,nullsFirst:true}).limit(20))
    const results=[]
    for(const source of sources) {
      if(Date.now()>deadline-20000) break
      // Cron jitter must not cause every-other-day runs for the 24h default.
      // Longer admin-selected intervals remain respected. Cache/lease still apply.
      const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date())
      const attemptedToday = source.last_attempt && new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(source.last_attempt))===today
      results.push(await crawlSource(db,source,{force:refresh||(source.interval_hours<=24&&!attemptedToday),limit:6,deadline:Math.min(deadline,Date.now()+60000)}))
    }
    const ai=await analyzeDaily(db)
    checked(await db.from('regulatory_http_cache').delete().lt('checked_at',new Date(Date.now()-14*86400000).toISOString()))
    return json(res,200,{ok:true,partial:results.length<sources.length||results.some(r=>r.state==='error'||r.state==='partial'||r.previous_error),results,ai})
  } catch { return json(res,500,{error:'Lượt cập nhật chưa hoàn tất; xem trạng thái từng nguồn.'}) }
}
