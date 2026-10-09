// The same queries and response construction run against TiDB and local SQLite.
import {VN_PROVINCES} from '../vnProvinces.js'
import {REGION_BY_CODE} from '../../web/src/mapGeo.js'
import {rules} from './insight.js'
import {mscProfileUrl} from '../portfolioCloud.js'
export const SOURCES = ['msc_prices', 'msc_tenders', 'vss', 'dav']
export const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim()
export const provinceKeys=value=>{
  const original=fold(value),name=original.replace(/^(?:tinh|thanh pho|tp\.?)(?:\s+)/,'')
  return [...new Set([original,name,...['tinh ','thanh pho ','tp. ','tp '].map(prefix=>prefix+name)])]
}
const bad = message => { const e = new Error(message); e.status = 400; throw e }
const iso = d => d.toISOString().slice(0, 10)
function shift(date, months) {
  const d = new Date(`${date}T00:00:00Z`), day = d.getUTCDate()
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months)
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()))
  return iso(d)
}
export function normalizeQuery(input = {}, today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) bad('Bộ lọc không hợp lệ.')
  const mode = input.mode || 'macro'
  if (!['drug', 'company', 'territory', 'macro'].includes(mode)) bad('Chế độ không hợp lệ.')
  const allTime=input.months==='all'
  const months = allTime?'all':Number(input.months || 12)
  if (!allTime&&![3, 6, 12, 24].includes(months)) bad('Khoảng tháng không hợp lệ.')
  const end = allTime?today:input.end || today, start = allTime?'1900-01-01':input.start || `${shift(end, -(months - 1)).slice(0, 7)}-01`
  for (const value of [start, end]) if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || iso(new Date(value)) !== value) bad('Ngày không hợp lệ.')
  if (!allTime&&(start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 1461)) bad('Khoảng thời gian tối đa 4 năm.')
  const comparison = allTime?'none':input.comparison || 'yoy'
  if (!['yoy', 'previous','none'].includes(comparison)||comparison==='none'&&!allTime) bad('Kỳ đối chiếu không hợp lệ.')
  const role = input.role || 'winner'
  if (!['winner', 'manufacturer', 'registrant', 'all'].includes(role)) bad('Vai trò doanh nghiệp không hợp lệ.')
  const filters = {}
  if(input.filters && (typeof input.filters!=='object'||Array.isArray(input.filters)))bad('Bộ lọc nâng cao không hợp lệ.')
  for (const field of ['group', 'strength', 'form', 'route', 'province']) {
    if (input.filters?.[field]) filters[field] = String(input.filters[field]).trim().slice(0, 255)
  }
  if (filters.group && !/^[1-5]$/.test(filters.group)) bad('Nhóm kỹ thuật không hợp lệ.')
  const entity = String(input.entity || '').trim().slice(0, 512)
  const entityField = input.entityField || 'ingredient'
  if (!['ingredient','registration','name'].includes(entityField)) bad('Loại thực thể thuốc không hợp lệ.')
  const territoryField=input.territoryField||'province'
  if(!['province','facility','region'].includes(territoryField))bad('Loại địa bàn không hợp lệ.')
  if(mode==='territory'&&entity&&territoryField==='region'&&!Object.values(REGION_BY_CODE).includes(entity))bad('Khu vực không hợp lệ.')
  const entityMatch=input.entityMatch|| (mode==='company'?'contains':'exact')
  if(!['exact','contains'].includes(entityMatch))bad('Cách ghép thực thể không hợp lệ.')
  const companyFocus=input.companyFocus?String(input.companyFocus).trim():undefined
  if(companyFocus&&!['manufacturer','business'].includes(companyFocus))bad('Vai trò doanh nghiệp không hợp lệ.')
  const span = Date.parse(end) - Date.parse(start) + 86400000
  return { version: 1, mode, entity, entityField, territoryField, role, months, start, end, comparison, entityMatch, ...(companyFocus?{companyFocus}:{}), filters,
    ...(comparison==='none'?{}:{previousStart: comparison === 'yoy' ? shift(start, -12) : iso(new Date(Date.parse(start) - span)),
    previousEnd: comparison === 'yoy' ? shift(end, -12) : iso(new Date(Date.parse(start) - 86400000))}) }
}
export const queryKey = q => JSON.stringify(normalizeQuery(q))
export function savedOverview(snapshot,input){
  if(!snapshot||snapshot.version!==2||!Number.isFinite(Date.parse(snapshot.generatedAt)))bad('Báo cáo đã lưu không hợp lệ.')
  const query=normalizeQuery(snapshot.query,snapshot.query?.end)
  if(JSON.stringify(query)!==JSON.stringify(normalizeQuery(input,query.end)))bad('Báo cáo đã lưu không khớp bộ lọc.')
  const sources={}
  for(const source of SOURCES){
    const stats=snapshot.sources?.[source]
    if(!stats||!['available','unavailable','unsupported'].includes(stats.status)||!Array.isArray(stats.rows)||stats.rows.length>2000)bad('Nguồn báo cáo đã lưu không hợp lệ.')
    if(stats.rows.some(row=>!row||typeof row!=='object'||!['current','previous'].includes(row.period)||typeof row.kind!=='string'))bad('Dòng báo cáo đã lưu không hợp lệ.')
    sources[source]={status:stats.status,rows:stats.rows}
  }
  return {version:2,query,sources,generatedAt:snapshot.generatedAt,missing:snapshot.missing||{}}
}
export async function enrichTenderSources(adapter,q,items,knownHeaders){
  const tenderNos=[...new Set(items.filter(row=>!mscProfileUrl(row.source_url)).map(row=>row.tender_no).filter(Boolean))]
  let headers=knownHeaders||[]
  if(tenderNos.length&&!knownHeaders)try{
    const base=await adapter.relation('msc_tenders',{...q,mode:'macro',entity:'',filters:{}},'detail')
    headers=await adapter.query('msc_tenders',`SELECT tender_no, MIN(source_url) AS source_url FROM (${base}) tender_profiles WHERE tender_no IN (${tenderNos.map(()=>'?').join(',')}) AND source_url LIKE '%id=%' GROUP BY tender_no`,tenderNos)
  }catch{/* Retain valid existing links when package headers are unavailable. */}
  const links=new Map(headers.map(row=>[row.tender_no,mscProfileUrl(row.source_url)]))
  for(const row of items)row.source_url=mscProfileUrl(row.source_url)||links.get(row.tender_no)||''
  return items
}
function predicate(q, source, adapter) {
  const parts = [], args = []
  const add = (field, value) => { parts.push(`${field} = ?`); args.push(fold(value)) }
  const escapeClause=" ESCAPE '!'"
  const match=(field,value)=>{
    if(q.entityMatch==='contains'&&q.mode==='company'){
      const phrase=fold(value).replace(/[!%_]/g,c=>`!${c}`)
      parts.push(`${field} LIKE ?${escapeClause}`);args.push(`%${phrase}%`)
    }else add(field,value)
  }
  if (q.entity && q.mode === 'drug') {
    add(`${q.entityField}_key`,q.entity)
  } else if (q.entity && q.mode === 'company') {
    if(q.role==='all'){
      const fields=source==='dav'?(q.companyFocus==='manufacturer'?['manufacturer']:['manufacturer','registrant']):source==='msc_prices'||source==='vss'?['company','manufacturer']:['company']
      const operator=q.entityMatch==='contains'?`LIKE ?${escapeClause}`:'= ?'
      parts.push(`(${fields.map(field=>`${field}_key ${operator}`).join(' OR ')})`)
      const phrase=fold(q.entity).replace(/[!%_]/g,c=>`!${c}`)
      args.push(...fields.map(()=>q.entityMatch==='contains'?`%${phrase}%`:fold(q.entity)))
    }else match(`${q.role === 'manufacturer' ? 'manufacturer' : q.role === 'registrant' ? 'registrant' : 'company'}_key`,q.entity)
  }
  else if (q.entity && q.mode === 'territory') {
    if(q.territoryField==='region') {
      const names=Object.entries(REGION_BY_CODE).filter(([,r])=>r===q.entity).map(([code])=>VN_PROVINCES[code]).filter(Boolean)
      const values=[...new Set(names.flatMap(provinceKeys))]
      parts.push(`province_key IN (${values.map(()=>'?').join(',')})`);args.push(...values)
    } else if(q.territoryField==='province'){
      const values=provinceKeys(q.entity);parts.push(`province_key IN (${values.map(()=>'?').join(',')})`);args.push(...values)
    } else add(`${q.territoryField}_key`, q.entity)
  }
  for (const [key, value] of Object.entries(q.filters)) if(key==='province'){
    const values=provinceKeys(value);parts.push(`province_key IN (${values.map(()=>'?').join(',')})`);args.push(...values)
  }else add(key === 'group' ? 'group_key' : `${key}_key`, value)
  // Tender headers cannot prove a drug/formulation or technical-group match.
  const davGeo=Boolean(adapter?.geoSources?.includes?.('dav')||adapter?.geoSources?.has?.('dav'))
  const davTerritory=q.mode==='territory'&&q.entity&&['province','region'].includes(q.territoryField)&&davGeo
  const unavailable = source === 'msc_tenders' && (q.mode === 'drug' && q.entity || Object.keys(q.filters).some(k => k !== 'province'))
    || source === 'dav' && (q.mode === 'territory' && q.entity && !davTerritory || q.filters.province&&!davGeo || q.filters.group || q.role === 'winner' && q.mode === 'company' && q.entity)
    || source !== 'dav' && q.mode === 'company' && q.role === 'registrant' && q.entity
  return { sql: parts.length ? parts.join(' AND ') : '1=1', args, unavailable }
}
export async function sourceQuery(adapter,q,source,purpose) {
  let p
  const linked=source==='msc_tenders'&&(q.entity&&['drug','company'].includes(q.mode)||Object.keys(q.filters).some(k=>k!=='province'))
  const base=await adapter.relation(source,linked?{...q,entity:''}:q,purpose)
  p=predicate(q,source,adapter)
  if(linked){
    const pricePredicate=predicate(q,'msc_prices',adapter)
    if(!pricePredicate.unavailable){
      const prices=await adapter.relation('msc_prices',q,'detail')
      p={sql:`tender_no IN (SELECT tender_no FROM (${prices}) matching_prices WHERE ${pricePredicate.sql} AND tender_no IS NOT NULL AND tender_no <> '')`,args:pricePredicate.args,unavailable:false}
    }
  }
  return {base,p,linked}
}
const missing = {
  absorption: 'Chưa có nguồn thanh toán thực tế và liên kết hợp đồng.',
  discount: 'Chưa có giá kế hoạch tương ứng từng dòng thuốc và đơn vị.',
  licenses: 'Chưa có hồ sơ giấy phép đã xác minh.',
  costs: 'Chưa có giá vốn Bảo An.',
  identity: 'Chưa có mã số thuế và hồ sơ định danh doanh nghiệp đã xác minh.',
  tenderLevel: 'Chưa có phân loại chuẩn thầu tập trung cấp Sở / viện tự mua sắm.',
  guarantee: 'Chưa có mức bảo đảm dự thầu và điều khoản tương ứng.',
  hospitalTier: 'Chưa có phân hạng cơ sở y tế đã xác minh.',
}
export async function overview(adapter, input) {
  const query = normalizeQuery(input)
  const results = await Promise.all(SOURCES.map(async source => {
    const started=Date.now()
    try {
      const {base,p,linked}=await sourceQuery(adapter,query,source,'overview')
      if (p.unavailable) return [source, { status: 'unsupported', reason: 'Nguồn này không xác định được thực thể/bộ lọc đã chọn.', rows: [] }]
      const dates = source==='dav'?'1=1':query.months==='all'?`(date IS NULL OR (date >= '${query.start}' AND date <= '${query.end}'))`:`((date >= '${query.start}' AND date <= '${query.end}') OR (date >= '${query.previousStart}' AND date <= '${query.previousEnd}'))`
      const metrics = `COUNT(*) AS count, SUM(amount) AS amount, SUM(quantity) AS quantity, SUM(CASE WHEN CAST(quantity AS DECIMAL(28,3)) > 0 AND amount IS NOT NULL THEN quantity END) AS priced_quantity, SUM(CASE WHEN CAST(quantity AS DECIMAL(28,3)) > 0 AND amount IS NOT NULL THEN amount END) AS priced_amount, MIN(price) AS min_price, MAX(price) AS max_price, MAX(updated_at) AS updated_at`
      const soon = shift(query.end, 18)
      const summary = source === 'dav'
        ? `COUNT(DISTINCT CASE WHEN expiry >= '${query.end}' THEN registration END) AS active, COUNT(DISTINCT CASE WHEN expiry > '${query.end}' AND expiry <= '${soon}' THEN registration END) AS expiring, COUNT(DISTINCT CASE WHEN date >= '${shift(query.end, -12)}' AND date <= '${query.end}' THEN registration END) AS new_registrations, COUNT(DISTINCT CASE WHEN expiry IS NULL THEN registration END) AS unknown_expiry`
        : 'NULL AS active, NULL AS expiring, NULL AS new_registrations, NULL AS unknown_expiry'
      const totalRegistrations=source==='dav'?'COUNT(DISTINCT registration)':'NULL'
      const wonPackages=['msc_prices','msc_tenders'].includes(source)?"COUNT(DISTINCT NULLIF(tender_no,''))":'NULL'
      const coordinate="CONCAT(COALESCE(ingredient,''),' · ',COALESCE(strength,''),' · ',COALESCE(form,''),' · ',COALESCE(group_key,''),' · ',COALESCE(unit,''))"
      const dimensions=source==='dav'?(query.mode==='company'?[['manufacturer','manufacturer'],['registrant','registrant']]:[]):source==='msc_tenders'?[['month','SUBSTR(date,1,7)'],['status','status']]:[['month', 'SUBSTR(date,1,7)'], ['month_group', "CONCAT(SUBSTR(date,1,7),'|',group_key)"], ['group','group_key'],['province','province'],['ingredient','ingredient'],['company','company'],['manufacturer','manufacturer'],['facility','facility'],['price_coordinate',coordinate],['unit',"COALESCE(NULLIF(LOWER(TRIM(unit)),''),'Chưa rõ đơn vị')"]]
      if(['msc_prices','vss'].includes(source)&&query.entity){
        dimensions.push(['unit_month',`CONCAT(SUBSTR(date,1,7),'|',${coordinate})`],['product',"CONCAT(COALESCE(name,''),' · ',COALESCE(strength,''),' · ',COALESCE(form,''),' · ',COALESCE(unit,''),' · ',COALESCE(registration,''))"])
      }
      const branches = dimensions.map(([kind, field]) => {
        const label=adapter.text?adapter.text(field):field
        const rowMetrics=kind==='group'?metrics:['unit','unit_month','price_coordinate','product'].includes(kind)?metrics.replace('MIN(price) AS min_price, MAX(price) AS max_price','NULL AS min_price, NULL AS max_price'):'COUNT(*) AS count, SUM(amount) AS amount, NULL AS quantity, NULL AS priced_quantity, NULL AS priced_amount, NULL AS min_price, NULL AS max_price, MAX(updated_at) AS updated_at'
        const currentOnly=['province','ingredient','company','facility','product','manufacturer','registrant'].includes(kind)?"period='current'":''
        const complete=kind==='price_coordinate'?"COALESCE(ingredient,'')<>'' AND COALESCE(strength,'')<>'' AND COALESCE(form,'')<>'' AND group_key<>'' AND COALESCE(unit,'')<>''":''
        const where=[currentOnly,complete].filter(Boolean)
        const sql = `SELECT '${kind}' AS kind, period, ${label} AS label, ${rowMetrics}, NULL AS active, NULL AS expiring, NULL AS new_registrations, NULL AS unknown_expiry, NULL AS total_registrations, NULL AS won_packages FROM filtered ${where.length?'WHERE '+where.join(' AND '):''} GROUP BY period, ${field}`
        return ['province','ingredient','company','facility','product','unit_month','price_coordinate','manufacturer','registrant'].includes(kind) ? `SELECT * FROM (${sql} ORDER BY CAST(amount AS DECIMAL(28,3)) DESC, count DESC LIMIT ${['unit_month','price_coordinate'].includes(kind)?200:30}) rank_${kind}` : sql
      })
      // Only bounded aggregate rows leave the database; top lists are reduced below.
      const periods=source==='dav'||query.comparison==='none'?"SELECT *, 'current' AS period FROM source_filtered":`SELECT *, 'current' AS period FROM source_filtered WHERE date >= '${query.start}' AND date <= '${query.end}' UNION ALL SELECT *, 'previous' AS period FROM source_filtered WHERE date >= '${query.previousStart}' AND date <= '${query.previousEnd}'`
      // Overlapping 24-month/YoY windows each retain their own complete records.
      const sql = `WITH source_filtered AS ${adapter.materialize&&source!=='dav'&&query.comparison!=='none'?'MATERIALIZED ':''}(SELECT * FROM (${base}) canonical WHERE ${p.sql} AND ${dates}), filtered AS (${periods}) SELECT 'summary' AS kind, period, ${adapter.text?adapter.text("''"):"''"} AS label, ${metrics}, ${summary}, ${totalRegistrations} AS total_registrations, ${wonPackages} AS won_packages FROM filtered GROUP BY period${branches.length?' UNION ALL '+branches.join(' UNION ALL '):''} LIMIT 20001`
      const rows = (await adapter.query(source, sql, p.args)).map(row=>{
        const value={...row}
        for(const key of ['count','active','expiring','new_registrations','unknown_expiry','total_registrations','won_packages'])if(value[key]!=null)value[key]=Number(value[key])
        return value
      })
      if (rows.length > 20000) throw Object.assign(new Error('Phạm vi quá rộng.'),{userMessage:'Phạm vi quá rộng; hãy chọn thực thể hoặc bộ lọc cụ thể hơn.'})
      const compact = rows.filter(r => ['summary','month','month_group','group','status','unit','unit_month','price_coordinate'].includes(r.kind))
      for (const kind of ['province', 'ingredient', 'company', 'facility','product','manufacturer','registrant']) compact.push(...rows.filter(r => r.kind === kind && r.period === 'current' && r.label).sort((a,b) => Number(b.amount || b.count) - Number(a.amount || a.count)).slice(0,30))
      return [source, { status: 'available', rows: compact, durationMs:Date.now()-started, updatedAt:rows.find(r=>r.kind==='summary'&&r.period==='current')?.updated_at||null, linkedTenderCoverage: linked?'Chỉ gói có dòng thuốc MSC liên kết bằng mã thầu; chưa bao gồm TBMT thiếu chi tiết thuốc.':undefined, comparisonMissing: query.comparison==='none'?false:source !== 'dav' && !rows.some(r => r.kind === 'summary' && r.period === 'previous' && Number(r.count) > 0), ...(source==='vss'?{wonPackagesUnavailableReason:'Nguồn VSS không có mã gói ổn định để đếm số gói riêng biệt.'}:{}) }]
    } catch (e) { return [source, { status: 'unavailable', reason: e.userMessage||'Nguồn chưa sẵn sàng. Thử lại hoặc chọn bộ lọc hẹp hơn.', rows: [] }] }
  }))
  const data={ version: 2, query, generatedAt: new Date().toISOString(), sources: Object.fromEntries(results), missing, coverage: 'unknown', cached: false }
  return {...data,baseline:rules(data)}
}
export async function detail(adapter, input) {
  const q = normalizeQuery(input.query || input), source = input.source || 'msc_prices'
  if (!SOURCES.includes(source)) bad('Nguồn không hợp lệ.')
  const page = Math.max(0, Math.min(1000, Math.floor(Number(input.page) || 0)))
  const {base,p}=await sourceQuery(adapter,q,source,'detail')
  if(input.tenderNo){if(!['msc_prices','msc_tenders'].includes(source))bad('Nguồn không có mã TBMT.');p.sql+=' AND tender_no = ?';p.args.push(String(input.tenderNo).slice(0,100))}
  if (p.unavailable) return { items: [], hasMore: false, page, source, reason: 'Nguồn không hỗ trợ bộ lọc này.' }
  const date = source === 'dav' ? '1=1' : q.months==='all'?'(date IS NULL OR (date >= ? AND date <= ?))':'date >= ? AND date <= ?'
  const args = [...p.args, ...(source === 'dav' ? [] : [q.start, q.end])]
  if(input.panel==='products') {
    if(!['msc_prices','vss'].includes(source)) bad('Sản phẩm cần dữ liệu thuốc MSC hoặc VSS.')
    const dimension=['name','strength','form','unit','registration','group_key']
    const items=await adapter.query(source,`SELECT MIN(id) AS id, ${dimension.join(',')}, SUM(amount) AS amount, SUM(quantity) AS quantity FROM (${base}) canonical WHERE ${p.sql} AND ${date} GROUP BY ${dimension.join(',')} ORDER BY CAST(SUM(amount) AS DECIMAL(28,3)) DESC, ${dimension.join(',')} LIMIT 30`,args)
    // Only DAV identifies the registrant. Never substitute the winning contractor.
    const keys=value=>[...new Set([fold(value),...String(value||'').split(/[();,]/).map(fold)].filter(Boolean))]
    const registrations=[...new Set(items.flatMap(row=>keys(row.registration)))]
    let registrantUnavailable=false
    if(registrations.length)try {
      const dav=await adapter.relation('dav',{...q,mode:'macro',entity:'',filters:{}},'detail')
      const records=await adapter.query('dav',`SELECT DISTINCT registration, registrant FROM (${dav}) dav_products WHERE registration_key IN (${registrations.map(()=>'?').join(',')}) AND registrant IS NOT NULL AND registrant <> ''`,registrations)
      for(const row of items){const names=[...new Set(records.filter(record=>keys(record.registration).some(key=>keys(row.registration).includes(key))).map(record=>record.registrant))];row.registrant=names.join('; ')||null}
    }catch{registrantUnavailable=true}
    return {source,page:0,items,hasMore:false,panel:'products',registrantUnavailable}
  }
  if(input.panel==='competition') {
    if(!['msc_prices','vss'].includes(source)) bad('Ma trận cần dữ liệu thuốc MSC hoặc VSS.')
    const dimension=['ingredient','strength','form','group_key','company','unit']
    const sql=`SELECT CONCAT(COALESCE(ingredient,''),'|',COALESCE(strength,''),'|',COALESCE(form,''),'|',COALESCE(group_key,''),'|',COALESCE(company,''),'|',COALESCE(unit,'')) AS id, ${dimension.join(',')}, COUNT(*) AS count, SUM(amount) AS amount, SUM(quantity) AS quantity FROM (${base}) canonical WHERE ${p.sql} AND ${date} GROUP BY ${dimension.join(',')} ORDER BY CAST(SUM(amount) AS DECIMAL(28,3)) DESC, ingredient, strength, form, group_key, company, unit LIMIT 51 OFFSET ${page*50}`
    const rows=await adapter.query(source,sql,args)
    return {source,page,items:rows.slice(0,50),hasMore:rows.length>50,panel:'competition'}
  }
  // Stable source identity orders pagination; each source stores one row per identity.
  const rows = await adapter.query(source, `SELECT * FROM (${base}) canonical WHERE ${p.sql} AND ${date} ORDER BY date DESC, id ASC LIMIT 51 OFFSET ${page * 50}`, args)
  const items=rows.slice(0,50)
  if(source==='msc_prices')await enrichTenderSources(adapter,q,items)
  if(source==='msc_tenders')for(const item of items)item.source_url=mscProfileUrl(item.source_url)
  return { source, page, items, hasMore: rows.length > 50 }
}
export async function suggest(adapter, text) {
  const term = fold(text).slice(0,100)
  if (term.length < 2) return { items: [] }
  if(adapter.suggestions)return {items:await adapter.suggestions(term)}
  const base = await adapter.relation('dav')
  const pattern = `%${term.replace(/[\\%_]/g, c => `\\${c}`)}%`
  const rows = await adapter.query('dav', `SELECT ingredient, name, registration, manufacturer, registrant FROM (${base}) canonical WHERE ingredient_key LIKE ? OR name_key LIKE ? OR registration_key LIKE ? OR manufacturer_key LIKE ? OR registrant_key LIKE ? LIMIT 20`, Array(5).fill(pattern))
  const items = []
  for (const r of rows) for (const [mode, role, label,entityField] of [['drug', 'winner', r.ingredient,'ingredient'], ['drug', 'winner', r.registration,'registration'], ['drug','winner',r.name,'name'], ['company','all',r.manufacturer], ['company','all',r.registrant]]) if (label && fold(label).includes(term) && !items.some(i=>i.label === label && i.role === role && i.entityField===entityField)) items.push({ mode, role, label,entityField })
  const vss = await adapter.relation('vss')
  const provinces = await adapter.query('vss', `SELECT DISTINCT province FROM (${vss}) canonical WHERE province_key LIKE ? LIMIT 8`, [pattern])
  items.push(...provinces.filter(r=>r.province).map(r=>({mode:'territory',role:'winner',label:r.province})))
  const msc = await adapter.relation('msc_prices')
  const companies = await adapter.query('msc_prices', `SELECT DISTINCT company FROM (${msc}) canonical WHERE company_key LIKE ? LIMIT 8`, [pattern])
  items.push(...companies.filter(r=>r.company&&!items.some(i=>i.mode==='company'&&fold(i.label)===fold(r.company))).map(r=>({mode:'company',role:'all',label:r.company})))
  return { items: items.slice(0,24) }
}
