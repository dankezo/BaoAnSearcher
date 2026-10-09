// Aggregate only; deliberately excludes private Bao An portfolio coordinates.
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {cloudAdapter} from '../api-lib/analytics/cloud.js'
import {overview,normalizeQuery,queryKey} from '../api-lib/analytics/core.js'
import {createHash} from 'node:crypto'
if(!process.argv.includes('--build')){console.log('Dry run. Pass --build after a successful data sync.');process.exit(0)}
const outArg=process.argv.indexOf('--out'),out=resolve(outArg>=0?process.argv[outArg+1]:'data/analytics-snapshots')
const q=normalizeQuery({mode:'macro'}),version=new Date().toISOString().replace(/[:.]/g,'-'),directory=resolve(out,version)
await mkdir(directory,{recursive:true})
const relation=await cloudAdapter.relation('msc_prices')
const candidates=[]
for(const [mode,column,count] of [['drug','ingredient',500],['company','company',100]]){
 const rows=await cloudAdapter.query('msc_prices',`SELECT ${column} AS entity,SUM(amount) AS amount FROM (${relation}) canonical WHERE date>=? AND date<=? AND ${column} IS NOT NULL AND ${column}<>'' GROUP BY ${column} ORDER BY amount DESC LIMIT ${count}`,[q.start,q.end])
 candidates.push(...rows.map(r=>({...q,mode,entity:r.entity,...(mode==='company'?{role:'all'}:{})})))
}
const entries=[]
for(const item of [q,...candidates]){
 const data=await overview(cloudAdapter,item)
 if(Object.values(data.sources).some(s=>s.status==='unavailable'))throw new Error('Snapshot incomplete; keep previous manifest.')
 const key=queryKey(item),filename=createHash('sha256').update(key).digest('hex')+'.json'
 await writeFile(resolve(directory,filename),JSON.stringify(data))
 entries.push({key,path:`${version}/${filename}`})
}
await writeFile(resolve(out,'manifest.json'),JSON.stringify({version:1,generatedAt:new Date().toISOString(),entries}))
console.log(`Prepared ${entries.length} aggregate snapshots.`)
