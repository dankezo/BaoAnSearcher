import { createHash } from 'node:crypto'
import { query } from './db/tidb.js'
import { memo } from './analytics/cache.js'

const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value
export function sharedCacheKey(scope,input,version,day=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'})) {
  return createHash('sha256').update(JSON.stringify(['catalog-v1',scope,ordered(input),version,day])).digest('hex')
}

// Call only after authorization, for TiDB catalogues shared by every staff user.
// Supabase RLS queries and private account data must never enter this cache.
export async function sharedQuery(scope,input,factory,{queryImpl=query,ttlSeconds=86400}={}) {
  let version
  try {
    version=await memo('catalog-version',async()=>{
      const result=await queryImpl("SELECT key_name, total_records, UNIX_TIMESTAMP(updated_at) AS stamp FROM app_metadata ORDER BY key_name")
      const scopes=await queryImpl('SELECT UNIX_TIMESTAMP(MAX(fetched_at)) AS stamp FROM msc_scope_lots')
      const registry=await queryImpl('SELECT dataset_code, UNIX_TIMESTAMP(last_synced_at) AS stamp FROM data_registry_meta ORDER BY dataset_code')
      return {datasets:result.rows,scopes:scopes.rows,registry:registry.rows,deploy:process.env.VERCEL_URL||'local'}
    },30000)
  } catch {return factory()}
  const key=sharedCacheKey(scope,input,{...version,cached:undefined})
  const result=await memo(`catalog:${key}`,async()=>{
    try {
      const result=await queryImpl('SELECT payload FROM shared_query_cache WHERE cache_key=? AND expires_at>UTC_TIMESTAMP() LIMIT 1',[key])
      if(result.rows?.[0]?.payload){
        const payload=JSON.parse(result.rows[0].payload)
        return {value:payload,cacheHit:true}
      }
    } catch {/* A cache outage must not prevent a catalogue lookup. */}
    const payload=await factory(),text=JSON.stringify(payload)
    if(Buffer.byteLength(text)<=4_000_000)try {
      await queryImpl('INSERT INTO shared_query_cache(cache_key,payload,expires_at) VALUES (?,?,TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP())) ON DUPLICATE KEY UPDATE payload=VALUES(payload),expires_at=VALUES(expires_at)',[key,text,ttlSeconds])
      await queryImpl('DELETE FROM shared_query_cache WHERE expires_at<=UTC_TIMESTAMP() LIMIT 100')
    } catch {/* Cache writes are best effort. */}
    return {value:payload,cacheHit:false}
  },30000)
  return {...result.value,sharedCached:Boolean(result.cached||result.cacheHit)}
}
