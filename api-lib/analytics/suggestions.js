import {fold} from './core.js'
import {REGION_ORDER} from '../../web/src/mapGeo.js'
import {VN_PROVINCES} from '../vnProvinces.js'

export const suggestionFields=[
 'hoat_chat','ingredient','hoatchat','ten_thuoc','tenThuoc','name','ten',
 'so_dang_ky','registration','sodk','cty_san_xuat','ctySanXuat','manufacturer','nhasx','nsx',
 'cty_dang_ky','ctyDangKy','ctyDK','registrant','winner','tennhathau','company','province','ten_tinh','facility','ten_cskcb','buyer','region'
]

const tokens=value=>fold(value).replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean)
function matchScore(label,term){
 const normalized=fold(label).replace(/[^a-z0-9]+/g,' ').trim(), query=fold(term).replace(/[^a-z0-9]+/g,' ').trim()
 const wanted=tokens(query), available=tokens(normalized)
 if(!wanted.length||!wanted.every(word=>available.some(token=>token===word||token.startsWith(word)||token.includes(word))))return 0
 if(normalized===query)return 4
 if(normalized.startsWith(query)||wanted.every(word=>available.some(token=>token.startsWith(word))))return 3
 if(wanted.every(word=>available.includes(word)))return 2
 return 1
}

export function suggestionItems(rows,term){
 const candidates=new Map()
 const provinces=Object.values(VN_PROVINCES)
 const knownProvinces=new Set(provinces.map(fold))
 const companyFields=['cty_san_xuat','ctysanxuat','manufacturer','nhasx','nsx','cty_dang_ky','ctydangky','ctydk','registrant','winner','tennhathau','company']
 const corporateLabel=value=>/(^| )(cong ty|cty|co phan|trach nhiem huu han|tnhh|joint stock|limited|corporation|corp)( |$)/.test(fold(value))
 for(const row of [...rows,...provinces.map(value=>({field:'province',value,cnt:0})),...REGION_ORDER.map(value=>({field:'region',value,cnt:0}))]){
  const label=String(row.value||'').trim(),f=String(row.field||'').toLowerCase(),section=String(row.section||'').toLowerCase()
  if(!suggestionFields.some(field=>field.toLowerCase()===f))continue
  if(!label||label.length>320||section==='msc_tenders'&&f==='name')continue
  const score=matchScore(label,term)
  if(!score)continue
  const exactProvince=knownProvinces.has(fold(label))
  const isProvince=exactProvince||['province','ten_tinh'].includes(f),isFacility=['facility','ten_cskcb','buyer'].includes(f),isRegion=f==='region'
  const isCompany=companyFields.includes(f)||corporateLabel(label)
  const mode=isProvince||isFacility||isRegion?'territory':isCompany?'company':'drug'
  const role=corporateLabel(label)&&!companyFields.includes(f)?'all':['cty_dang_ky','ctydangky','ctydk','registrant'].includes(f)?'registrant':['cty_san_xuat','ctysanxuat','manufacturer','nhasx','nsx'].includes(f)?'manufacturer':'winner'
  const entityField=['so_dang_ky','registration','sodk'].includes(f)?'registration':['ten_thuoc','tenthuoc','name','ten'].includes(f)?'name':'ingredient'
  const territoryField=isProvince?'province':isFacility?'facility':isRegion?'region':undefined
  const item={mode,role:mode==='territory'?'winner':role,label,...(mode==='drug'?{entityField}:{}),...(territoryField?{territoryField}:{})}
  const key=mode==='company'?`${mode}|${fold(label)}`:mode==='territory'?`${mode}|${territoryField}|${fold(label)}`:[mode,role,entityField,territoryField,fold(label)].join('|'),count=Number(row.cnt)||0,previous=candidates.get(key)
  if(mode==='company'){
   const roles=new Set(previous?._roles||[]);if(role!=='all')roles.add(role)
   const mergedRole='all'
   candidates.set(key,{...item,role:mergedRole,_roles:[...roles].sort(),...(roles.size>1?{roles:[...roles].sort()}:{}),score:Math.max(score,previous?.score||0),count:Math.max(count,previous?.count||0)})
  }else if(!previous||score>previous.score||score===previous.score&&count>previous.count)candidates.set(key,{...item,score,count})
 }
 const ranked=[...candidates.values()].sort((a,b)=>b.score-a.score||b.count-a.count||a.label.localeCompare(b.label))
 const matched=ranked.some(item=>item.score===4)?ranked.filter(item=>item.score===4):ranked
 return ['drug','company','territory'].flatMap(mode=>matched.filter(item=>item.mode===mode).slice(0,8).map(({score,count,_roles,...item})=>item))
}
