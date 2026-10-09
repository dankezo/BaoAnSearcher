import { queryKey } from './core.js'
import { memo } from './cache.js'
export async function readSnapshot(q, fetchImpl=fetch) {
  const base=process.env.ANALYTICS_SNAPSHOT_BASE_URL
  if(!base || q.months!==12 || q.comparison!=='yoy' || Object.keys(q.filters).length || q.start!==`${q.start.slice(0,7)}-01`) return null
  try {
    const url=new URL(base)
    if(url.protocol!=='https:') return null
    const manifest=await memo('snapshot:manifest',async()=>{
      const r=await fetchImpl(new URL('manifest.json',base.endsWith('/')?base:base+'/'),{signal:AbortSignal.timeout(2500)})
      if(!r.ok) throw new Error('Snapshot manifest unavailable')
      return r.json()
    },60000)
    const item=manifest.entries?.find(e=>e.key===queryKey(q))
    if(!item || Date.now()-Date.parse(manifest.generatedAt)>48*3600000) return null
    const target=new URL(item.path,base.endsWith('/')?base:base+'/')
    if(target.origin!==url.origin || !target.pathname.startsWith(url.pathname.endsWith('/')?url.pathname:url.pathname+'/')) return null
    const r=await fetchImpl(target,{signal:AbortSignal.timeout(3000)})
    if(!r.ok) return null
    const data=await r.json()
    if(data.version!==2 || queryKey(data.query)!==queryKey(q) || !data.sources) return null
    return {...data,cached:true,snapshot:true}
  } catch {return null}
}
