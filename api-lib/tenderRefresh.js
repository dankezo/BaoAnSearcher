import {randomUUID} from 'node:crypto'
import {query} from './db/tidb.js'
import {fold} from './turso.js'
import {clearAnalyticsCache} from './analytics/cache.js'

const LOCK='msc-manual-refresh'
const COLUMNS=['source_id','search','tender_no','name','buyer','province','published','published_raw','close_date','close_date_raw','open_date','status_code','bid_price','bid_price_raw','bid_form','source_url','collected_at','name_f','province_f']
const text=v=>String(v??'').trim()
const date=v=>/^\d{4}-\d{2}-\d{2}/.test(text(v))?text(v).slice(0,10):null
export function tenderRow(raw,at=new Date().toISOString()){
 const id=text(raw.id||raw.notifyId),published=date(raw.publicDate),no=text(raw.notifyNo||raw.notifyNoStand).toUpperCase().replace(/-\d{2}$/,'')
 if(!id||!no||!published||![1,'1',true].includes(raw.isMedicine))throw new Error('Nguồn trả gói thiếu mã/ngày đăng hoặc sai bộ lọc thuốc.')
 const name=text(raw.bidName||raw.name),province=[...new Set((Array.isArray(raw.locations)?raw.locations:[]).map(x=>text(x.provName)).filter(Boolean))].join('; ')
 const url=new URL('https://muasamcong.mpi.gov.vn/web/guest/contractor-selection')
 const notify=text(raw.notifyId||raw.id)
 url.search=new URLSearchParams({p_p_id:'egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2',p_p_lifecycle:'0',p_p_state:'normal',p_p_mode:'view',_egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2_render:'detail-v2',type:raw.type||'es-notify-contractor',id:notify,notifyId:notify,step:'tbmt',notifyNo:text(raw.notifyNo)})
 for(const key of ['stepCode','processApply','bidMode','planNo','isInternet','bidForm'])if(raw[key]!=null)url.searchParams.set(key,String(raw[key]))
 const price=Number(raw.bidPrice)
 return {source_id:id.slice(0,128),search:fold(JSON.stringify(raw)).slice(0,60000),tender_no:no.slice(0,128),name:name.slice(0,512),buyer:text(raw.investorName||raw.procuringName||raw.procuringEntityName).slice(0,512),province:province.slice(0,128),published,published_raw:text(raw.publicDate).slice(0,32),close_date:date(raw.bidCloseDate),close_date_raw:text(raw.bidCloseDate).slice(0,32),open_date:date(raw.bidOpenDate),status_code:text(raw.statusForNotify).slice(0,64),bid_price:raw.bidPrice!=null&&text(raw.bidPrice)&&Number.isFinite(price)&&price>=0&&price<=9999999999999.99?price.toFixed(2):null,bid_price_raw:raw.bidPrice==null?null:text(raw.bidPrice).slice(0,64),bid_form:text(raw.bidForm).slice(0,128),source_url:url.href,collected_at:at,name_f:fold(name).slice(0,512),province_f:fold(province).slice(0,128)}
}

export async function refreshTenders(onProgress=()=>{},{queryImpl=query,fetchImpl=fetch,env=process.env}={}){
 if(!env.MSC_CRAWL_KEY)throw Object.assign(new Error('Chưa cấu hình cập nhật gói thầu.'),{status:503})
 const id=randomUUID(),startedAt=new Date().toISOString(),initial={id,state:'running',startedAt,rows:0,pages:0}
 await queryImpl('INSERT INTO shared_query_cache(cache_key,payload,expires_at) VALUES (?,?,TIMESTAMPADD(SECOND,360,UTC_TIMESTAMP())) ON DUPLICATE KEY UPDATE payload=IF(expires_at<=UTC_TIMESTAMP(),VALUES(payload),payload),expires_at=IF(expires_at<=UTC_TIMESTAMP(),VALUES(expires_at),expires_at)',[LOCK,JSON.stringify(initial)])
 const lease=await queryImpl('SELECT payload, GREATEST(1,TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),expires_at)) AS retry_after FROM shared_query_cache WHERE cache_key=?',[LOCK])
 if(JSON.parse(lease.rows[0]?.payload||'{}').id!==id)throw Object.assign(new Error('Vừa có lượt cập nhật. Đợi vài phút rồi thử lại.'),{status:429,retryAfter:Number(lease.rows[0]?.retry_after)||180})
 let rows=0,added=0,pages=0,complete=false,lastDate='',error
 const seen=new Set()
 const deadline=Date.now()+130000
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'})
 try{
  onProgress({message:'Đang lấy gói mới từ MSC…',pages,rows})
  for(let page=0;page<3;page++){
   if(Date.now()>=deadline)throw new Error('Nguồn đang phản hồi chậm; các gói đã tải vẫn được giữ.')
   const response=await fetchImpl('https://baoan-public-crawl.dannyphan190.workers.dev/msc/search',{method:'POST',headers:{Authorization:`Bearer ${env.MSC_CRAWL_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({page,fresh:true}),signal:AbortSignal.timeout(Math.min(100000,Math.max(1,deadline-Date.now())))})
   const data=await response.json()
   if(!response.ok)throw Object.assign(new Error(data.error==='daily_msc_browser_budget_reached'||data.error==='browser_daily_limit_reached'?'Đã tới hạn mức cập nhật hôm nay. Dữ liệu đã tải vẫn được giữ.':data.error==='browser_rate_limited'?'Nguồn đang giới hạn lượt gọi. Đợi ít phút rồi cập nhật lại.':'Nguồn MSC chưa phản hồi. Thử cập nhật lại sau.'),{status:response.status===429?429:502})
   const result=data.page
   if(!Array.isArray(result?.content)||result.content.length>50||!Number.isInteger(result.totalPages)||result.totalPages<0||!result.content.length&&page<result.totalPages)throw new Error('Phản hồi nguồn chưa đầy đủ; chưa xác nhận cập nhật xong.')
   const batch=result.content.map(raw=>tenderRow(raw))
   if(new Set(batch.map(row=>row.source_id)).size!==batch.length||batch.some(row=>seen.has(row.source_id)))throw new Error('Nguồn lặp gói; dữ liệu cũ được giữ.')
   for(const row of batch)seen.add(row.source_id)
   for(const row of batch){if(lastDate&&row.published>lastDate)throw new Error('Nguồn chưa xếp gói theo ngày; chưa xác nhận tải đủ gói mới.');lastDate=row.published}
   if(batch.length){
    const numbers=[...new Set(batch.map(row=>row.tender_no))]
    const existing=await queryImpl(`SELECT tender_no FROM msc_tenders WHERE tender_no IN (${numbers.map(()=>'?').join(',')})`,numbers)
    const known=new Set(existing.rows.map(row=>row.tender_no));added+=numbers.filter(no=>!known.has(no)).length
    await queryImpl(`INSERT INTO msc_tenders(${COLUMNS.join(',')}) VALUES ${batch.map(()=>`(${COLUMNS.map(()=>'?').join(',')})`).join(',')} ON DUPLICATE KEY UPDATE ${COLUMNS.filter(key=>key!=='source_id').map(key=>`${key}=VALUES(${key})`).join(',')}`,batch.flatMap(row=>COLUMNS.map(key=>row[key])))
    rows+=batch.length
    await queryImpl("UPDATE app_metadata SET updated_at=CURRENT_TIMESTAMP WHERE key_name='msc_total'")
    clearAnalyticsCache()
   }
   pages++;onProgress({message:`Đã xử lý ${pages} trang · ${rows} gói`,pages,rows,added})
   if(!batch.length||page+1>=result.totalPages||lastDate<today){complete=true;break}
  }
  if(!complete)throw new Error(`Đã tải ${rows} gói; nguồn còn gói mới, chưa xác nhận tải đủ. Hãy cập nhật tiếp sau.`)
  const total=(await queryImpl("SELECT COUNT(DISTINCT COALESCE(NULLIF(tender_no,''),source_id)) AS total FROM msc_tenders")).rows[0].total
  await queryImpl("INSERT INTO app_metadata(key_name,total_records,updated_at) VALUES ('msc_total',?,CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE total_records=VALUES(total_records),updated_at=CURRENT_TIMESTAMP",[total])
  await queryImpl("UPDATE data_registry_meta SET total_records=?,status='healthy',last_synced_at=CURRENT_TIMESTAMP WHERE dataset_code='MSC_BID'",[total])
  clearAnalyticsCache()
  return {rows,added,pages,updatedAt:new Date().toISOString()}
 }catch(e){error=e;throw e}
 finally{
  await queryImpl("UPDATE shared_query_cache SET payload=? WHERE cache_key=? AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.id'))=?",[JSON.stringify({...initial,state:error?'error':'done',rows,added,pages,finishedAt:new Date().toISOString(),...(error?{message:error.message}:{})}),LOCK,id]).catch(()=>{})
 }
}
