import { baoanProducts } from '../baoanCatalog.js'
import { fold } from './core.js'
export async function portfolioCoordinates(adapter) {
  const registrations=baoanProducts().map(p=>fold(p.reg_number)).filter(Boolean)
  if(!registrations.length) return []
  const coordinates=[]
  for(const source of ['msc_prices','vss']) {
    try {
      const base=await adapter.relation(source,{registrations},'portfolio')
      const rows=await adapter.query(source,`SELECT DISTINCT ingredient_key, strength_key, group_key FROM (${base}) canonical WHERE registration_key IN (${registrations.map(()=>'?').join(',')}) AND group_key <> '' LIMIT 501`,registrations)
      if(rows.length>500) continue
      for(const row of rows) if(row.ingredient_key&&row.strength_key&&/^[1-5]$/.test(row.group_key)) coordinates.push(row)
    } catch {/* Missing source cannot establish a technical group. */}
  }
  return coordinates
}
