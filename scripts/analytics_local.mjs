import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { overview, detail, suggest, savedOverview } from '../api-lib/analytics/core.js'
import { fields, mappings } from '../api-lib/analytics/cloud.js'
import { insight } from '../api-lib/analytics/insight.js'
import { portfolioCoordinates } from '../api-lib/analytics/portfolio.js'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {suggestionItems} from '../api-lib/analytics/suggestions.js'
import {recentAwards} from '../api-lib/analytics/awards.js'
import {crawlCompany} from '../api-lib/analytics/company.js'
const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk)
const request=JSON.parse(Buffer.concat(chunks).toString('utf8'))
const workers=new Map()
function bridge(source){
  if(workers.has(source))return workers.get(source)
  const profile=process.env.ANALYTICS_PROFILE_DIR?['-m','cProfile','-o',join(process.env.ANALYTICS_PROFILE_DIR,source+'.prof')]:[]
  const worker=spawn(process.env.ANALYTICS_PYTHON || 'python',[...profile,'server/analytics_sqlite.py'],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONUNBUFFERED:'1'}}), pending=new Map()
  const reject=e=>{for(const p of pending.values())p.reject(e);pending.clear()}
  worker.on('error',reject);worker.on('exit',()=>reject(new Error('SQLite bridge stopped')));worker.stderr.resume()
  createInterface({input:worker.stdout}).on('line',line=>{const r=JSON.parse(line),p=pending.get(r.id);pending.delete(r.id);if(p)r.error?p.reject(new Error(r.error)):p.resolve(r.rows)})
  const value={worker,pending,sequence:0};workers.set(source,value);return value
}
const schemas=new Map()
const profilesPath=process.env.ANALYTICS_COMPANY_PROFILES_PATH||(process.env.ANALYTICS_DB_DIR?join(process.env.ANALYTICS_DB_DIR,'company_profiles.json'):'data/company_profiles.json')
const adapter={
  // Reuse the canonical projection across current and comparison windows.
  materialize:true,
  geoSources:(()=>{try{return Object.keys(JSON.parse(readFileSync(profilesPath,'utf8'))).length?['dav']:[]}catch{return []}})(),
  suggestions(term){
    const rows=[]
    try{for(const line of readFileSync('data/rollups/suggest_values.jsonl','utf8').split('\n'))if(line.trim())rows.push(JSON.parse(line))}catch{}
    try{const doc=JSON.parse(readFileSync('web/public/data/suggest-static.json','utf8'));for(const bucket of Object.values(doc))for(const field of ['province','ten_tinh'])for(const item of bucket?.[field]||[])rows.push({field,value:typeof item==='string'?item:item.label||item.value})}catch{}
    return suggestionItems(rows,term)
  },
  async relation(source,q={},purpose){
    const raw=source==='dav'||source==='vss'?'raw':'normalized', table=source==='dav'?'drugs':source==='vss'?'bids':'records'
    const nested={ingredient:['thongTinThuocCoBan.hoatChatChinh','hoatChatChinh','hoatChat'],strength:['thongTinThuocCoBan.hamLuong','hamLuong'],form:['thongTinThuocCoBan.dangBaoChe','dangBaoChe'],date:['thongTinDangKyThuoc.ngayCapSoDangKy','ngayCapSoDangKy','ngayCap'],expiry:['thongTinDangKyThuoc.ngayHetHanSoDangKy','ngayHetHanSoDangKy','ngayHetHan'],manufacturer:['congTySanXuat.tenCongTySanXuat','tenCongTySanXuat','ctySanXuat'],registrant:['congTyDangKy.tenCongTyDangKy','tenCongTyDangKy','ctyDangKy']}
    const rawValue=f=>{
      if(source==='vss'&&f==='form')return `COALESCE(NULLIF(TRIM(json_extract(raw,'$.dangbaoche')),''),SDK_FORM(json_extract(raw,'$.sodk')))`
      if(f==='updated_at')return `COALESCE(json_extract(${raw},'$.collected_at'),json_extract(${raw},'$.created_date'),json_extract(${raw},'$.lastModificationTime'),json_extract(${raw},'$.creationTime'))`
      const paths=source==='dav'&&nested[f]?nested[f]:[source==='dav'?({name:'tenThuoc',registration:'soDangKy'}[f]||f):mappings[source][f]||f]
      const values=paths.map(p=>`json_extract(${raw},'$.${p}')`)
      return values.length>1?`COALESCE(${values.join(',')})`:values[0]
    }
    // SQLite's native JSON projection avoids parsing the same fact repeatedly in Python.
    const numeric=f=>`CASE WHEN json_type(${raw},'$._analyticsNumbers')='object' THEN CNUM(json_extract(${raw},'$._analyticsNumbers.${mappings[source][f]||f}')) WHEN json_extract(${raw},'$._analyticsCanonical')=1 THEN CNUM(${rawValue(f)}) ELSE DNUM(${rawValue(f)}) END`
    const expr=f=>f==='province'&&source==='dav'?`COMPANY_PROVINCE(${rawValue(q.companyFocus==='manufacturer'?'manufacturer':'registrant')},'${q.companyFocus==='manufacturer'?'factory':'office'}')`:f==='id'?(table==='records'?'source_id':'id'):f==='amount'&&source==='msc_prices'?`CMUL(${numeric('price')},${numeric('quantity')})`:['price','quantity','amount'].includes(f)?numeric(f):['date','expiry'].includes(f)?`ADATE(${rawValue(f)})`:rawValue(f)
    const wanted=purpose==='portfolio'?['ingredient','strength','group_name','registration']:purpose==='overview'?source==='dav'?['registration','date','expiry','updated_at','price','quantity','amount','province',...(q.mode==='company'?['manufacturer','registrant']:[])]:source==='msc_tenders'?['id','tender_no','date','updated_at','status','price','quantity','amount']:['updated_at','ingredient','strength','form','company','manufacturer','tender_no','province','facility','group_name','unit','price','quantity','amount','date',...(q.entity?['name','registration']:[])]:fields
    const cols=wanted.map(f=>`${expr(f)} AS ${f}`)
    let keys=['ingredient','name','registration','manufacturer','registrant','company','province','facility','strength','form','route']
    if(purpose==='portfolio')keys=['ingredient','strength','registration']
    if(purpose==='overview') keys=keys.filter(f=>Object.hasOwn(q.filters||{},f)||q.entity&&(q.mode==='drug'&&f===q.entityField||q.mode==='territory'&&f===(q.territoryField==='facility'?'facility':'province')||q.mode==='company'&&(q.role==='all'?['company','manufacturer','registrant'].includes(f):f===(q.role==='manufacturer'?'manufacturer':q.role==='registrant'?'registrant':'company'))))
    for(const f of keys) cols.push(`FOLD(${expr(f)}) AS ${f}_key`)
    cols.push(`AGROUP(${expr('group_name')}) AS group_key`)
    const clauses=table==='records'?[`kind='${source==='msc_prices'?'prices':'tenders'}'`]:[]
    if(!schemas.has(source))schemas.set(source,new Set((await adapter.query(source,"SELECT name FROM sqlite_master WHERE type IN ('table','index')",[])).map(r=>r.name)))
    const schema=schemas.get(source)
    if(purpose==='portfolio'&&q.registrations?.length){
      const values=q.registrations.map(value=>`'${value.replace(/'/g,"''")}'`).join(',')
      if(source==='msc_prices'&&schema.has('idx_records_kind_registration'))clauses.push(`rowid IN (SELECT rowid FROM records INDEXED BY idx_records_kind_registration WHERE kind='prices' AND FOLD(json_extract(normalized,'$.registration')) IN (${values}))`)
      if(source==='vss'&&schema.has('idx_bids_sodk'))clauses.push(`rowid IN (SELECT rowid FROM bids INDEXED BY idx_bids_sodk WHERE FOLD(sodk) IN (${values}))`)
    }
    if(source==='msc_prices'&&purpose==='overview'&&q.months!=='all'&&schema.has('idx_records_kind_cursor')){
      const cursor="coalesce(json_extract(normalized,'$.published'),json_extract(normalized,'$.close_date'),collected_at)"
      const start=[q.start,q.previousStart].filter(Boolean).sort()[0],end=[q.end,q.previousEnd].filter(Boolean).sort().at(-1)
      // Fetch candidate rowids in physical order while retaining legacy date
      // formats. The outer ADATE predicate still decides exact membership.
      clauses.push(`rowid IN (SELECT rowid FROM records INDEXED BY idx_records_kind_cursor WHERE kind='prices' AND ${cursor}>='${start}' AND ${cursor}<='${end}~' UNION SELECT rowid FROM records INDEXED BY idx_records_kind_cursor WHERE kind='prices' AND ${cursor} NOT GLOB '????-??-??*')`)
    }
    if(['dav','vss'].includes(source)&&schema.has('analytics_cloud_members')){try{const baseline=JSON.parse(readFileSync('data/analytics_production_baseline.json','utf8'));if(baseline.identityVerifiedAt)clauses.push(source==='dav'?'id IN (SELECT id FROM analytics_cloud_members)':"json_extract(raw,'$.fp_hash') IN (SELECT id FROM analytics_cloud_members)")}catch{}}
    if(table==='records'&&schema.has('analytics_cloud_members')){try{readFileSync('data/analytics_production_baseline.json');clauses.push('EXISTS (SELECT 1 FROM analytics_cloud_members cloud WHERE cloud.kind=records.kind AND cloud.id=records.source_id)')}catch{}}
    if(source==='msc_prices'&&schema.has('excel_matches'))clauses.push('NOT EXISTS (SELECT 1 FROM excel_matches m WHERE m.excel_id=records.source_id)')
    if(q?.entity&&q.territoryField!=='region'&&!(source==='dav'&&q.mode==='territory')) {
      let term=q.entity.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/'/g,"''").replace(/[%_]/g,'')
      if(q.mode==='territory'&&q.territoryField==='province')term=term.replace(/^(?:tinh|thanh pho|tp\.?)(?:\s+)/,'')
      clauses.push(`${table==='records'?'search_text':'search'} LIKE '%${term}%'`)
      if(table==='records'&&schema.has('records_search_fts')&&term.length>=3)clauses.push(`rowid IN (SELECT rowid FROM records_search_fts WHERE search_text LIKE '%${term}%')`)
      if(table==='bids'&&schema.has('idx_bids_search'))clauses.push(`rowid IN (SELECT rowid FROM bids INDEXED BY idx_bids_search WHERE search LIKE '%${term}%')`)
    }
    // A broad archive aggregate reads rows sequentially; the registration index
    // otherwise causes random table lookups without narrowing the candidate set.
    const scan=source==='msc_prices'&&purpose==='overview'&&!q.entity&&!Object.values(q.filters||{}).some(Boolean)?' NOT INDEXED':''
    let sql=`SELECT ${cols.join(',')} FROM ${table}${scan}`+(clauses.length?` WHERE ${clauses.join(' AND ')}`:'')
    if(source==='msc_tenders')sql=`SELECT * FROM (SELECT tender_rows.*,ROW_NUMBER() OVER (PARTITION BY COALESCE(NULLIF(tender_no,''),id) ORDER BY date DESC,updated_at DESC,id DESC) AS latest FROM (${sql}) tender_rows) latest_rows WHERE latest=1`
    return sql
  },
  query(source,sql,args){return new Promise((resolve,reject)=>{const b=bridge(source),id=++b.sequence;b.pending.set(id,{resolve,reject});b.worker.stdin.write(JSON.stringify({id,source,sql,args})+'\n')})}
}
try {
  const stored=request.action==='ai-insight'&&request.body.snapshot?savedOverview(request.body.snapshot,request.body.query):null
  const value=request.action==='company-profile'?await crawlCompany(request.body.legalName||request.body.query.entity):request.action==='awards'?await recentAwards(adapter,request.body):request.action==='suggest'?await suggest(adapter,request.q):request.action==='detail'?await detail(adapter,request.body):request.action==='ai-insight'?await insight(stored?{...stored,news:request.body._news||[],newsStatus:request.body._newsStatus||'unavailable',_refreshAt:request.body.refreshAt}:request.overview||await overview(adapter,request.body.query||request.body)):await overview(adapter,request.body)
  if(request.action==='overview'&&value.query.mode==='company') value.baoanCoordinates=await portfolioCoordinates(adapter)
  process.stdout.write(JSON.stringify(value))
} catch(e){process.stdout.write(JSON.stringify({error:e.message,status:e.status||500}));process.exitCode=1}
finally{for(const {worker} of workers.values())worker.stdin.end()}
