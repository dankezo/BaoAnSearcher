const fields={
 ingredient:['drug','ingredient'],hoatchat:['drug','ingredient'],hoatChat:['drug','ingredient'],inn:['drug','ingredient'],
 registration:['drug','registration'],soDangKy:['drug','registration'],sodk:['drug','registration'],reg_number:['drug','registration'],
 name:['drug','name'],ten:['drug','name'],tenThuoc:['drug','name'],brand_name:['drug','name'],
 winner:['company','winner'],company:['company','winner'],tennhathau:['company','winner'],
 manufacturer:['company','manufacturer'],nhasx:['company','manufacturer'],ctySanXuat:['company','manufacturer'],
 registrant:['company','registrant'],ctyDangKy:['company','registrant'],
 province:['territory','province'],ten_tinh:['territory','province'],facility:['territory','facility'],buyer:['territory','facility'],ten_cskcb:['territory','facility'],
 region:['territory','region'],khu_vuc:['territory','region'],
}
export function columnEntity(column,row){
 const kind=fields[column.key],value=row[column.key]
 // Tender names are package labels, not medicine identities.
 if(!kind||kind[0]==='drug'&&kind[1]==='name'&&(row.bid_price!=null||row.status_label!=null&&!row.ingredient)||value==null||typeof value==='object')return null
 const entity=String(value).trim();if(!entity||entity==='—')return null
 const [mode,field]=kind
 return {mode,entity,role:mode==='company'?'all':'winner',...(mode==='company'?{companyFocus:field==='manufacturer'?'manufacturer':'business',entityMatch:'contains'}:{}),entityField:mode==='drug'?field:'ingredient',territoryField:mode==='territory'?field:'province',months:12,comparison:'yoy',filters:{}}
}
export function openAnalytics(query){
 try{sessionStorage.setItem('baoan.analytics.open',JSON.stringify(query))}catch{}
 window.location.hash='analytics-overview'
 window.dispatchEvent(new CustomEvent('baoan-analytics-open',{detail:query}))
}
