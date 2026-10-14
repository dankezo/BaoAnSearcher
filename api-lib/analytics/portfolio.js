import { baoanProducts } from '../baoanCatalog.js'
import { fold, normalizeQuery, sourceQuery } from './core.js'
import { compareAwards } from '../portfolioCloud.js'
export async function portfolioCoordinates(adapter) {
  const registrations=baoanProducts().map(p=>fold(p.reg_number)).filter(Boolean)
  if(!registrations.length) return []
  const coordinates=[]
  for(const source of ['msc_prices','vss']) {
    try {
      const base=await adapter.relation(source,{registrations},'portfolio')
      const registrationField=adapter.prefilterCompanyText&&registrations.every(reg=>/^[a-z0-9-]+$/.test(reg))?'registration':'registration_key'
      const rows=await adapter.query(source,`SELECT DISTINCT ingredient_key, strength_key, group_key FROM (${base}) canonical WHERE ${registrationField} IN (${registrations.map(()=>'?').join(',')}) AND group_key <> '' LIMIT 501`,registrations)
      if(rows.length>500) continue
      for(const row of rows) if(row.ingredient_key&&row.strength_key&&/^[1-5]$/.test(row.group_key)) coordinates.push(row)
    } catch {/* Missing source cannot establish a technical group. */}
  }
  return coordinates
}

export async function companyStrategy(adapter,input) {
  const q=normalizeQuery(input)
  if(q.mode!=='company'||!q.entity)return undefined
  const {base,p}=await sourceQuery(adapter,q,'msc_prices','detail')
  if(p.unavailable)return {topProducts:[],baoanComparisons:[]}
  const date=q.months==='all'?'(date IS NULL OR date >= ? AND date <= ?)':'date >= ? AND date <= ?'
  // Rank the complete product across technical groups, rather than two coordinates of one SDK.
  const topProducts=await adapter.query('msc_prices',`SELECT MIN(name) AS name, MIN(registration) AS registration, SUM(amount) AS amount FROM (${base}) canonical WHERE ${p.sql} AND ${date} GROUP BY COALESCE(NULLIF(registration_key,''),name_key) ORDER BY CAST(SUM(amount) AS DECIMAL(28,3)) DESC LIMIT 2`,[...p.args,q.start,q.end])
  if(!topProducts.length)return {topProducts,baoanComparisons:[]}
  const partition='registration,ingredient,strength,form,group_key,unit'
  const priceFields='id,name,ingredient,strength,form,group_key,unit,registration,price,date,quantity'
  const latest=(relation,where)=>`SELECT ${priceFields} FROM (SELECT ${priceFields},ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY date DESC,id ASC) AS newest FROM (${relation}) canonical WHERE ${where} AND ${date} AND price > 0) priced WHERE newest=1 ORDER BY date DESC LIMIT 501`
  const catalog=baoanProducts(),registrations=[...new Set(catalog.map(row=>fold(row.reg_number)).filter(Boolean))]
  if(!registrations.length)return {topProducts,baoanComparisons:[]}
  const ownBase=await adapter.relation('msc_prices',{...q,mode:'macro',entity:'',filters:{}},'detail')
  const simpleRegistrations=registrations.every(reg=>/^[a-z0-9-]+$/.test(reg))
  const ownWhere=simpleRegistrations?'LOWER(registration) REGEXP ?':`(${registrations.map(()=>"registration_key LIKE ? ESCAPE '!'").join(' OR ')})`
  const ownArgs=simpleRegistrations?[registrations.join('|')]:registrations.map(reg=>`%${reg.replace(/[!%_]/g,c=>'!'+c)}%`)
  const [rivals,own]=await Promise.all([adapter.query('msc_prices',latest(base,p.sql),[...p.args,q.start,q.end]),adapter.query('msc_prices',latest(ownBase,ownWhere),[...ownArgs,q.start,q.end])])
  if(own.length>500||rivals.length>500)return {topProducts,baoanComparisons:[]}
  const award=row=>({...row,price:Number(row.price),dosageForm:row.form,group:row.group_key})
  const baoanComparisons=[]
  const compared=new Set()
  for(const product of [...topProducts,...rivals]){
    if(!product.registration)continue
    const registration=fold(product.registration)
    if(compared.has(registration))continue
    compared.add(registration)
    const prices=rivals.filter(row=>!own.some(ownRow=>ownRow.id===row.id)&&fold(row.registration)===fold(product.registration)).map(award)
    const result=compareAwards(own.map(award),prices)
    if(result.priceDeltaPct==null)continue
    const left=result.comparisonOwnAward,right=result.comparisonAward
    baoanComparisons.push({product:product.name,registration:product.registration,baoanProduct:left.name,baoanRegistration:left.registration,ingredient:right.ingredient,strength:right.strength,form:right.dosageForm,group:right.group,unit:right.unit,price:right.price,date:right.date,baoanPrice:left.price,baoanDate:left.date,priceDeltaPct:result.priceDeltaPct})
    if(baoanComparisons.length===2)break
  }
  return {topProducts,baoanComparisons}
}
