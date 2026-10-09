import {query} from '../db/tidb.js'
import {fold} from './core.js'
import {crawlCompany,companyNameMatches} from './company.js'
import {VN_PROVINCES} from '../vnProvinces.js'

export function addressProvince(address){
 const text=fold(address),matches=[]
 for(const name of Object.values(VN_PROVINCES)){
  const key=fold(name),aliases=key==='ho chi minh'?['tp hcm','tphcm','tp.hcm']:key==='thua thien hue'?['hue']:[]
  for(const label of [key,...aliases]){const escaped=label.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&');for(const match of text.matchAll(new RegExp('(?:^|[^a-z0-9])'+escaped+'(?=$|[^a-z0-9])','g')))matches.push({name,index:match.index})}
 }
 return matches.sort((a,b)=>b.index-a.index)[0]?.name||null
}
export async function companyProfiles(q,refresh=false,legalName){
 if(q.mode!=='company'||!q.entity)return {profiles:[],reason:'Nhập tên doanh nghiệp để xem hồ sơ.'}
 const phrase=fold(q.entity).replace(/[!%_]/g,c=>'!'+c)
 let profiles=[]
 try{profiles=(await query("SELECT profile_json FROM company_profiles WHERE name_key LIKE ? ESCAPE '!' ORDER BY legal_name LIMIT 20",[`%${phrase}%`])).rows.map(r=>typeof r.profile_json==='string'?JSON.parse(r.profile_json):r.profile_json)}catch{return {profiles:[],reason:'Chưa có bảng hồ sơ doanh nghiệp trên production.'}}
 if(!refresh)return {profiles}
 if(legalName&&!companyNameMatches(legalName,q.entity))throw Object.assign(new Error('Tên pháp nhân không thuộc phạm vi tìm kiếm.'),{status:400})
 const found=await crawlCompany(legalName||q.entity)
 if(found.status!=='verified')return {profiles,reason:found.reason||'Chưa xác minh được hồ sơ từ nguồn web.'}
 const previous=profiles.find(p=>fold(p.legalName)===fold(found.legalName))||{}
 const profile={...previous,...found,status:'web_verified',officeAddress:found.address||previous.officeAddress,officeProvince:addressProvince(found.address)||previous.officeProvince}
 for(const field of ['taxId','phone','email','website','imageUrl','introduction'])if(!profile[field]&&previous[field])profile[field]=previous[field]
 profile.sourceUrls=[...new Set([...(found.sourceUrls||[]),...(previous.sourceUrls||[])])].slice(0,10)
 await query('INSERT INTO company_profiles(name_key,legal_name,office_province,factory_province,profile_json,checked_at) VALUES (?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE legal_name=VALUES(legal_name),office_province=VALUES(office_province),factory_province=VALUES(factory_province),profile_json=VALUES(profile_json),checked_at=VALUES(checked_at)',[fold(profile.legalName),profile.legalName,profile.officeProvince||null,profile.factoryProvince||null,JSON.stringify(profile)])
 return {profiles:[profile,...profiles.filter(p=>fold(p.legalName)!==fold(profile.legalName))]}
}
