import {normalizeQuery,sourceQuery,enrichTenderSources} from './core.js'

const PAGE_SIZE=50
const fail=message=>{const error=new Error(message);error.status=400;throw error}
const VSS_REASON='VSS không cung cấp mã gói ổn định; kết quả được hiển thị theo từng dòng thuốc.'
const FIELDS=['tender_no','updated_at','price','ingredient','name','strength','form','group_name','unit','registration','company','manufacturer','facility','province','source_url','status']

export async function recentAwards(adapter,input={},options={}){
 const query=normalizeQuery(input.query||input)
 const source=options.source||input.source||'msc_prices'
 const sort=options.sort||input.sort||'recent'
 const page=Math.max(0,Math.min(1000,Math.floor(Number(options.page??input.page)||0)))
 if(!['msc_prices','vss'].includes(source))fail('Nguồn kết quả trúng thầu không hợp lệ.')
 if(!['recent','amount'].includes(sort))fail('Cách sắp xếp kết quả trúng thầu không hợp lệ.')
 const {base,p}=await sourceQuery(adapter,query,source,'detail')
 const scopeInput=options.scope||input.scope
 if(scopeInput){
  const scope=normalizeQuery(scopeInput),{p:parent}=await sourceQuery(adapter,scope,source,'detail')
  p.sql=`(${p.sql}) AND (${parent.sql}) AND (date >= ? AND date <= ?${scope.months==='all'?' OR date IS NULL':''})`
  p.args.push(...parent.args,scope.start,scope.end);p.unavailable ||= parent.unavailable
 }
 if(p.unavailable)return {source,sort,page,items:[],hasMore:false,totalDistinctPackages:source==='vss'?null:0,
  packageCountUnavailableReason:source==='vss'?VSS_REASON:undefined,packageIdentityAvailable:source==='msc_prices',reason:'Nguồn không hỗ trợ bộ lọc này.'}
 // ALL time includes undated rows. Keep the date predicate parameterized for bounded windows.
 const date=query.months==='all'?'(date >= ? AND date <= ? OR date IS NULL)':'date >= ? AND date <= ?'
 const args=[...p.args,query.start,query.end]
 const order=source==='msc_prices'
  ? (sort==='amount'?'CAST(amount AS DECIMAL(28,3)) DESC, (date IS NULL) ASC, date DESC, id ASC':'(date IS NULL) ASC, date DESC, id ASC')
  : (sort==='amount'?'CAST(amount AS DECIMAL(28,3)) DESC, (date IS NULL) ASC, date DESC, id ASC':'(date IS NULL) ASC, date DESC, id ASC')
 let sql
 if(source==='msc_prices'){
  const representatives=[`MAX(date) AS date`,...['ingredient','company','manufacturer'].map(field=>`COUNT(DISTINCT NULLIF(${field},'')) AS ${field}_count`),...FIELDS.map(field=>`MIN(${field}) AS ${field}`)].join(', ')
  // Count the grouped TBMT identities in the same scan, before LIMIT/OFFSET.
  sql=`SELECT awards.*, COUNT(NULLIF(tender_no,'')) OVER () AS total_distinct_packages FROM (SELECT COALESCE(NULLIF(tender_no,''),id) AS id, ${representatives}, SUM(amount) AS amount, SUM(quantity) AS quantity, COUNT(*) AS line_count FROM (${base}) canonical WHERE ${p.sql} AND ${date} GROUP BY COALESCE(NULLIF(tender_no,''),id)) awards ORDER BY ${order} LIMIT ${PAGE_SIZE+1} OFFSET ${page*PAGE_SIZE}`
 }else{
  sql=`SELECT *, 1 AS line_count FROM (${base}) canonical WHERE ${p.sql} AND ${date} ORDER BY ${order} LIMIT ${PAGE_SIZE+1} OFFSET ${page*PAGE_SIZE}`
 }
 const rows=await adapter.query(source,sql,args),items=rows.slice(0,PAGE_SIZE)
 let packageCount=source==='msc_prices'?Number(rows[0]?.total_distinct_packages||0):null
 // A page beyond the last row still needs the total, but normal pages use one scan.
 if(source==='msc_prices'&&page>0&&!rows.length)packageCount=Number((await adapter.query(source,`SELECT COUNT(DISTINCT NULLIF(tender_no,'')) AS total FROM (${base}) canonical WHERE ${p.sql} AND ${date}`,args))[0]?.total||0)
 let packageHeaders=[]
 if(source==='msc_prices'&&items.length){
  const tenderNos=[...new Set(items.map(row=>row.tender_no).filter(Boolean))]
  if(tenderNos.length)try{
   const headerBase=await adapter.relation('msc_tenders',{...query,mode:'macro',entity:'',filters:{}},'detail')
   const headers=await adapter.query('msc_tenders',`SELECT tender_no, MIN(name) AS package_name, MIN(status) AS package_status, MIN(amount) AS package_bid_price, MIN(CASE WHEN source_url LIKE '%id=%' THEN source_url END) AS source_url FROM (${headerBase}) package_headers WHERE tender_no IN (${tenderNos.map(()=>'?').join(',')}) GROUP BY tender_no`,tenderNos)
   packageHeaders=headers
   const byTender=new Map(headers.map(header=>[header.tender_no,header]))
   for(const item of items){const header=byTender.get(item.tender_no);if(header){item.package_name=header.package_name;item.package_status=header.package_status;item.status=header.package_status;item.package_bid_price=header.package_bid_price}}
  }catch{/* Header enrichment is optional; keep the grouped medicine awards available. */}
 }
 if(source==='msc_prices')await enrichTenderSources(adapter,query,items,packageHeaders)
 return {source,sort,page,items,hasMore:rows.length>PAGE_SIZE,
  totalDistinctPackages:packageCount,
  packageIdentityAvailable:source==='msc_prices',packageCountUnavailableReason:source==='vss'?VSS_REASON:undefined}
}
