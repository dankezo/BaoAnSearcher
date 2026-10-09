import {DatabaseSync} from 'node:sqlite'
import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const BASELINE=resolve(ROOT,'data/analytics_production_baseline.json')
const CHECKPOINT=resolve(ROOT,'data/company_web_enrichment_state.json')
const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().replace(/\s+/g,' ').trim()
const SOURCES=['dav_drugs','msc_prices','msc_tenders','vss_bids']
const CANDIDATE_SOURCES=['dav','msc_prices','msc_tenders','vss']
const DEFAULT_LIMIT=10,MAX_LIMIT=50

export function collectCandidates({davRows=[],mscPriceRows=[],mscTenderRows=[],vssRows=[]}={}){
 const result=new Map()
 const add=(name,source,role)=>{
  name=String(name||'').replace(/\s+/g,' ').trim();const key=fold(name)
  if(key.length<4||/^\d+$/.test(key))return
  const row=result.get(key)||{key,name,sources:[],roles:[]}
  if(!row.sources.includes(source))row.sources.push(source)
  if(!row.roles.includes(role))row.roles.push(role)
  result.set(key,row)
 }
 for(const row of davRows){add(row.manufacturer,'dav','manufacturer');add(row.registrant,'dav','registrant')}
 for(const row of mscPriceRows){add(row.winner,'msc_prices','company');add(row.manufacturer,'msc_prices','manufacturer')}
 for(const row of mscTenderRows)add(row.winner,'msc_tenders','company')
 for(const row of vssRows){add(row.supplier,'vss','company');add(row.manufacturer,'vss','manufacturer')}
 return [...result.values()].sort((a,b)=>a.key.localeCompare(b.key))
}

export function validBaseline(baseline,localCounts){
 if(!baseline||!baseline.completedAt||!Number.isFinite(Date.parse(baseline.completedAt))||!baseline.identityVerifiedAt||!Number.isFinite(Date.parse(baseline.identityVerifiedAt))||!baseline.counts)return false
 return SOURCES.every(source=>{
  const expected=Number(baseline.counts[source]),local=Number(localCounts?.[source])
  return Number.isSafeInteger(expected)&&expected>0&&Number.isSafeInteger(local)&&local===expected
 })
}

export function retryEligible(entry,now=Date.now()){
 if(!entry)return true
 if(entry.status==='web_verified')return false
 const due=Date.parse(entry.nextAttemptAt||'')
 return !Number.isFinite(due)||due<=now
}

function loadCheckpoint(){
 try{const value=JSON.parse(readFileSync(CHECKPOINT,'utf8'));return value&&typeof value.attempts==='object'?value:{version:1,attempts:{}}}
 catch{return {version:1,attempts:{}}}
}
function saveCheckpoint(state){mkdirSync(dirname(CHECKPOINT),{recursive:true});writeFileSync(CHECKPOINT,JSON.stringify(state,null,2)+'\n',{encoding:'utf8'})}
function loadEnv(){
 try{process.loadEnvFile(resolve(ROOT,'.env'))}catch{/* Optional; missing provider credentials do not block the dry run. */}
}
export function parseArgs(argv){
 let yesRemote=false,limit=DEFAULT_LIMIT
 for(let i=0;i<argv.length;i++){
  if(argv[i]==='--yes-remote')yesRemote=true
  else if(argv[i]==='--limit'){
   const value=Number(argv[++i]);if(!Number.isInteger(value)||value<0)throw new Error('--limit must be a non-negative integer.')
   limit=Math.min(value,MAX_LIMIT)
  }else throw new Error(`Unknown option: ${argv[i]}`)
 }
 return {yesRemote,limit}
}
function openReadonly(path){return new DatabaseSync(path,{readOnly:true})}
function localData(root=ROOT){
 const dbs={dav:openReadonly(resolve(root,'test zone/data/thuoc.sqlite3')),msc:openReadonly(resolve(root,'test zone/procurement/data/procurement.sqlite3')),vss:openReadonly(resolve(root,'data/vss_bhyt.sqlite3'))}
 try{
  const count=(db,sql)=>Number(db.prepare(sql).get().count||0)
  const localCounts={
   dav_drugs:count(dbs.dav,'SELECT COUNT(*) AS count FROM analytics_cloud_members'),
   msc_prices:count(dbs.msc,"SELECT COUNT(*) AS count FROM analytics_cloud_members WHERE kind='prices'"),
   msc_tenders:count(dbs.msc,"SELECT COUNT(*) AS count FROM analytics_cloud_members WHERE kind='tenders'"),
   vss_bids:count(dbs.vss,'SELECT COUNT(*) AS count FROM analytics_cloud_members')
  }
  const matched={
   dav_drugs:count(dbs.dav,'SELECT COUNT(*) AS count FROM drugs d JOIN analytics_cloud_members m ON m.id=d.id'),
   msc_prices:count(dbs.msc,"SELECT COUNT(*) AS count FROM records r JOIN analytics_cloud_members m ON m.kind=r.kind AND m.id=r.source_id WHERE r.kind='prices'"),
   msc_tenders:count(dbs.msc,"SELECT COUNT(*) AS count FROM records r JOIN analytics_cloud_members m ON m.kind=r.kind AND m.id=r.source_id WHERE r.kind='tenders'"),
   vss_bids:count(dbs.vss,"SELECT COUNT(*) AS count FROM bids d JOIN analytics_cloud_members m ON m.id=json_extract(d.raw,'$.fp_hash')")
  }
  if(!SOURCES.every(source=>matched[source]===localCounts[source]))throw new Error('Canonical production membership has missing local rows; no remote action was taken.')
  const candidates=collectCandidates({
   davRows:[...dbs.dav.prepare(`SELECT DISTINCT json_extract(d.raw,'$.congTySanXuat.tenCongTySanXuat') AS manufacturer FROM drugs d JOIN analytics_cloud_members m ON m.id=d.id WHERE json_extract(d.raw,'$.congTySanXuat.tenCongTySanXuat') IS NOT NULL`).all(),...dbs.dav.prepare(`SELECT DISTINCT json_extract(d.raw,'$.congTyDangKy.tenCongTyDangKy') AS registrant FROM drugs d JOIN analytics_cloud_members m ON m.id=d.id WHERE json_extract(d.raw,'$.congTyDangKy.tenCongTyDangKy') IS NOT NULL`).all()],
   mscPriceRows:dbs.msc.prepare("SELECT DISTINCT json_extract(r.normalized,'$.winner') AS winner,json_extract(r.normalized,'$.manufacturer') AS manufacturer FROM records r JOIN analytics_cloud_members m ON m.kind=r.kind AND m.id=r.source_id WHERE r.kind='prices'").all(),
   mscTenderRows:dbs.msc.prepare("SELECT DISTINCT json_extract(r.normalized,'$.winner') AS winner FROM records r JOIN analytics_cloud_members m ON m.kind=r.kind AND m.id=r.source_id WHERE r.kind='tenders'").all(),
   vssRows:dbs.vss.prepare("SELECT DISTINCT json_extract(d.raw,'$.tennhathau') AS supplier,json_extract(d.raw,'$.nhasx') AS manufacturer FROM bids d JOIN analytics_cloud_members m ON m.id=json_extract(d.raw,'$.fp_hash') WHERE json_extract(d.raw,'$.tennhathau') IS NOT NULL OR json_extract(d.raw,'$.nhasx') IS NOT NULL").all()
  })
  return {localCounts,candidates}
 }finally{for(const db of Object.values(dbs))db.close()}
}
function companyQuery(entity){return {mode:'company',entity,role:'all'}}
export function checkpointAttempt(state,candidate,status,now=Date.now()){
 const old=state.attempts[candidate.key]||{name:candidate.name,attempts:0}
 const attempts=old.attempts+1
 const delay=Math.min(14,2**Math.min(attempts-1,4))*24*60*60*1000
 state.attempts[candidate.key]={name:candidate.name,attempts,lastAttemptAt:new Date(now).toISOString(),nextAttemptAt:status==='web_verified'?null:new Date(now+delay).toISOString(),status}
}

export async function run({argv=process.argv.slice(2),root=ROOT,logger=console}={}){
 const {yesRemote,limit}=parseArgs(argv)
 loadEnv()
 let baseline=null
 try{baseline=JSON.parse(readFileSync(resolve(root,'data/analytics_production_baseline.json'),'utf8'))}catch{/* A dry run can still report local candidates before the canonical pull. */}
 let data
 try{data=localData(root)}catch(error){
  if(yesRemote)throw error
  const empty={mode:'dry-run',candidateCount:0,eligibleCount:0,baselineValid:false,localCounts:null,bySource:Object.fromEntries(CANDIDATE_SOURCES.map(source=>[source,0])),reason:'Verified production membership is missing; pull and verify the canonical baseline before enrichment.'}
  logger.log(JSON.stringify(empty));return empty
 }
 const {localCounts,candidates}=data,baselineValid=validBaseline(baseline,localCounts)
 if(yesRemote&&!baselineValid)throw new Error('Production baseline or matching local canonical row counts are missing/invalid; no remote action was taken.')
 const checkpoint=loadCheckpoint();let profiles={}
 try{profiles=JSON.parse(readFileSync(resolve(root,'data/company_profiles.json'),'utf8'))}catch{}
 const targets=candidates.filter(item=>item.roles.includes('company')||item.roles.includes('registrant')||profiles[item.key]?.factoryProvince)
 const priority=item=>/duoc my pham bao an|duoc pham va thuong mai phuong dong/.test(item.key)?0:/^(cong ty|cty)\b/.test(item.key)?profiles[item.key]?.officeProvince?2:1:3
 const eligible=targets.filter(item=>profiles[item.key]?.status!=='web_verified'&&retryEligible(checkpoint.attempts[item.key])).sort((a,b)=>priority(a)-priority(b)||a.key.localeCompare(b.key)).slice(0,limit)
 const counts={candidateCount:candidates.length,regionCandidateCount:targets.length,eligibleCount:eligible.length,baselineValid,localCounts,bySource:Object.fromEntries(CANDIDATE_SOURCES.map(source=>[source,candidates.filter(c=>c.sources.includes(source)).length]))}
 if(!yesRemote){logger.log(JSON.stringify({mode:'dry-run',...counts}));return counts}
 if(!limit||!eligible.length){logger.log(JSON.stringify({mode:'remote',processed:0,...counts}));return counts}
 const {companyProfiles}=await import('../api-lib/analytics/companyStore.js')
 let verified=0,failed=0
 for(const candidate of eligible){
  let status='pending'
  try{
   const result=await companyProfiles(companyQuery(candidate.name),true,candidate.name)
   const profile=(result.profiles||[]).find(item=>fold(item.legalName)===candidate.key&&item.status==='web_verified')
   if(profile)status='web_verified'
   else status='pending'
  }catch{status='pending'}
  checkpointAttempt(checkpoint,candidate,status);saveCheckpoint(checkpoint)
  if(status==='web_verified')verified++;else failed++
 }
 if(verified){
  const {query}=await import('../api-lib/db/tidb.js')
  const rows=(await query('SELECT name_key,profile_json FROM company_profiles')).rows
  const file=resolve(root,'data/company_profiles.json'),temp=file+'.tmp'
  writeFileSync(temp,JSON.stringify(Object.fromEntries(rows.map(row=>[row.name_key,typeof row.profile_json==='string'?JSON.parse(row.profile_json):row.profile_json]))),'utf8');renameSync(temp,file)
 }
 logger.log(JSON.stringify({mode:'remote',processed:eligible.length,verified,failed,...counts}))
 return {processed:eligible.length,verified,failed,...counts}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 run().catch(error=>{console.error(error.message);process.exitCode=1})
}
