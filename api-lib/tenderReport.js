import { fold } from './turso.js'
import { sdkKeySql } from './db/sdkForms.js'
import { whereFor } from './db/searchSql.js'

export function reportQuery(input={}){
  const keyword=String(input.keyword||'').trim()
  const searches=Object.fromEntries(['ingredient','name','registration'].map(key=>[key,String(input[key]||'').trim()]).filter(([,value])=>value))
  if((Object.keys(searches).length?Object.values(searches):[keyword]).some(value=>value.length<3))throw Object.assign(new Error('Nhập ít nhất 3 ký tự hoạt chất, tên thuốc hoặc SĐK.'),{status:400})
  const day=value=>{const s=String(value||''),d=new Date(s);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)throw Object.assign(new Error('Khoảng ngày không hợp lệ.'),{status:400});return s}
  const start=day(input.start),end=day(input.end)
  if(start>end)throw Object.assign(new Error('Từ ngày phải trước hoặc bằng đến ngày.'),{status:400})
  return {keyword,...searches,start,end,searchField:['ingredient','name','registration'].includes(input.searchField)?input.searchField:'ingredient',group:/^[1-5]$/.test(input.group)?input.group:'',strength:String(input.strength||'').trim(),form:String(input.form||'').trim(),composition:['single','combination'].includes(input.composition)?input.composition:'all'}
}

export async function loadTenderReport(query,input){
  const q=reportQuery(input)
  const searches=['ingredient','name','registration'].filter(key=>q[key]).map(key=>[key,q[key]])
  if(!searches.length)searches.push([q.searchField,q.keyword])
  const where=['loai = ?','tungay_hd >= ?','tungay_hd < DATE_ADD(?, INTERVAL 1 DAY)'],args=['Tân dược',q.start,q.end]
  for(const [key,value] of searches){const field={ingredient:'hoatchat_f',name:'ten_f',registration:'sodk'}[key];where.push(`${field} ${key==='registration'?'=':'LIKE'} ?`);args.push(key==='registration'?value.replace(/\s/g,'').toUpperCase():`%${fold(value).replace(/[%_]/g,'')}%`)}
  if(q.group){where.push('nhomthau IN (?, ?, ?)');args.push(q.group,`N${q.group}`,`Nhóm ${q.group}`)}
  const msc=input.source==='msc'
  const filters={publishedFrom:q.start,publishedTo:q.end,strictDates:true,group_name:q.group,...Object.fromEntries(searches)}
  const priceWhere=msc?whereFor('msc_prices',filters,'tidb'):null
  const {rows}=await query(msc?`SELECT source_id AS fp_hash, name AS ten, ingredient AS hoatchat, strength AS hamluong, registration AS sodk, route AS duongdung, dosage_form AS dangbaoche, group_name AS nhomthau, manufacturer AS nhasx, country AS nuocsx, unit AS donvitinh, quantity AS soluong, unit_price AS gia, unit_price * quantity AS thanhtien, buyer AS ten_cskcb, province AS ten_tinh, tender_no AS goithau, published AS tungay_hd FROM msc_prices WHERE ${priceWhere.where} ORDER BY published DESC,source_id LIMIT 5001`:`SELECT * FROM vss_bids WHERE ${where.join(' AND ')} ORDER BY tungay_hd DESC,fp_hash LIMIT 5001`,msc?priceWhere.args:args)
  if(rows.length>5000)throw Object.assign(new Error('Có hơn 5.000 dòng. Hãy thu hẹp hoạt chất hoặc kỳ để lấy báo cáo đầy đủ.'),{status:422})
  const sdks=[...new Set(rows.map(row=>String(row.sodk||'').replace(/\s/g,'').toUpperCase()).filter(Boolean))],catalog=new Map()
  for(let i=0;i<sdks.length;i+=300){
    const chunk=sdks.slice(i,i+300),slots=chunk.map(()=>'?').join(',')
    const rs=await query(`SELECT so_dang_ky,so_dang_ky_cu,dang_bao_che,cty_dang_ky,cty_san_xuat,nuoc_san_xuat FROM dav_drugs WHERE ${sdkKeySql('so_dang_ky')} IN (${slots}) OR ${sdkKeySql('so_dang_ky_cu')} IN (${slots})`,[...chunk,...chunk])
    for(const row of rs.rows)for(const sdk of [row.so_dang_ky,row.so_dang_ky_cu]){
      const key=String(sdk||'').replace(/\s/g,'').toUpperCase();if(!key)continue
      if(!catalog.has(key))catalog.set(key,{forms:new Set(),companies:new Set(),manufacturers:new Set(),countries:new Set()})
      const entry=catalog.get(key)
      if(row.dang_bao_che?.trim())entry.forms.add(row.dang_bao_che.trim())
      if(row.cty_dang_ky?.trim())entry.companies.add(row.cty_dang_ky.trim())
      if(row.cty_san_xuat?.trim())entry.manufacturers.add(row.cty_san_xuat.trim())
      if(row.nuoc_san_xuat?.trim())entry.countries.add(row.nuoc_san_xuat.trim())
    }
  }
  const single=set=>set?.size===1?[...set][0]:''
  const number=value=>value==null||value===''?null:Number(value)
  const items=rows.map(row=>{
    const dav=catalog.get(String(row.sodk||'').replace(/\s/g,'').toUpperCase())
    return {id:row.fp_hash,brandName:row.ten||'',activeIngredient:row.hoatchat||'',strength:row.hamluong||'',regNumber:row.sodk||'',registrationCompany:single(dav?.companies),route:row.duongdung||'',dosageForm:single(dav?.forms)||row.dangbaoche||'',group:String(row.nhomthau||'').match(/[1-5]/)?.[0]||'',manufacturer:single(dav?.manufacturers)||row.nhasx||'',country:single(dav?.countries)||row.nuocsx||'',unit:row.donvitinh||'',quantity:number(row.soluong),unitPrice:number(row.gia),totalAmount:number(row.thanhtien),hospitalName:row.ten_cskcb||'',province:row.ten_tinh||'',procurementCode:row.goithau||row.quyetdinh||'',date:String(row.tungay_hd||'').slice(0,10),dateBasis:'Ngày bắt đầu HĐ'}
  })
  if(msc)for(const item of items)item.dateBasis='Ngày KQLCNT'
  return {items,query:{...q,source:msc?'msc':'vss'},source:msc?'MSC · hồ sơ DAV':'VSS · hồ sơ DAV',dateBasis:msc?'Ngày KQLCNT':'Ngày bắt đầu HĐ'}
}
