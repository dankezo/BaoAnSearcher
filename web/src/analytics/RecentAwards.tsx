import {useEffect,useRef,useState} from 'react'
import {request} from './client'
import EntityValue from './EntityValue'
import {Card} from './ui'
import {count,money} from './Charts'
import {SOURCE_LABELS} from './types'
import {DataTable} from '../components'
import type {AnalyticsQuery,DetailRow} from './types'

type AwardSource='msc_prices'|'vss'
type AwardSort='recent'|'amount'
type AwardsPage={source:AwardSource;sort:AwardSort;page:number;items:DetailRow[];hasMore:boolean;totalDistinctPackages:number|null;packageCountUnavailableReason?:string;reason?:string}
type OpenPackage=(row:DetailRow)=>void
type OpenEntity=(mode:'drug'|'company'|'territory',name:string,role?:AnalyticsQuery['role'],field?:'ingredient'|'name'|'registration'|'province'|'facility'|'region')=>void

async function loadAwards(query:AnalyticsQuery,source:AwardSource,sort:AwardSort,page:number,scope?:AnalyticsQuery,signal?:AbortSignal):Promise<AwardsPage>{
 return request<AwardsPage>('/api/analytics/awards',{query,source,sort,page,...(scope?{scope}:{})},signal)
}

export default function RecentAwards({query,scope,onOpenPackage,onEntity,onRelated,initialSource='msc_prices'}:{query:AnalyticsQuery;initialSource?:AwardSource;scope?:AnalyticsQuery;onOpenPackage?:OpenPackage;onEntity?:OpenEntity;onRelated?:(q:AnalyticsQuery)=>void}){
 void onEntity
 const [source,setSource]=useState<AwardSource>(initialSource),[sort,setSort]=useState<AwardSort>('recent'),[page,setPage]=useState(0)
 const [data,setData]=useState<AwardsPage>(),[error,setError]=useState(''),[loading,setLoading]=useState(false)
 const generation=useRef(0),selection=useRef('')
 const [retry,setRetry]=useState(0)
 useEffect(()=>{
  const key=JSON.stringify([query,scope,source,sort])
  if(selection.current!==key){selection.current=key;setData(undefined);if(page){setPage(0);return}}
  const id=++generation.current
  const controller=new AbortController()
  setLoading(true);setError('')
  loadAwards(query,source,sort,page,scope,controller.signal).then(value=>{if(generation.current===id)setData(value)}).catch(reason=>{if(generation.current===id&&!controller.signal.aborted)setError(reason instanceof TypeError?'Kết nối bị gián đoạn khi tải kết quả trúng thầu.':reason.name==='TimeoutError'?'Tải kết quả trúng thầu quá thời gian chờ.':reason.message)}).finally(()=>{if(generation.current===id)setLoading(false)})
  return()=>{generation.current++;controller.abort()}
 },[query,scope,source,sort,page,retry])
 const rows=data?.items||[]
 const entity=(value:string|null|undefined,mode:'drug'|'company'|'territory',role:AnalyticsQuery['role']='winner',field:'ingredient'|'name'|'registration'|'province'|'facility'='ingredient')=><EntityValue value={value} parentQuery={query} mode={mode} role={role} field={field} onRelated={onRelated}/>
 return <Card exportable={!!rows.length} title="Kết quả trúng thầu gần đây" hint="Các dòng trúng thầu MSC hoặc VSS trong kỳ và bộ lọc hiện tại. Số gói riêng chỉ có cho MSC theo mã TBMT; VSS không cung cấp mã gói ổn định.">
  {scope?.entity&&<p className="muted small">Phạm vi: <strong>{scope.entity}</strong>{query.entity&&query.entity!==scope.entity&&<> · {query.entity}</>}</p>}
  <div className="analytics-controls" role="group" aria-label="Nguồn kết quả trúng thầu">
   {(['msc_prices','vss'] as AwardSource[]).map(value=><button key={value} type="button" className={`btn ${source===value?'':'ghost'}`} aria-pressed={source===value} onClick={()=>setSource(value)}>{SOURCE_LABELS[value]}</button>)}
   <label>Sắp xếp <select value={sort} onChange={event=>setSort(event.target.value as AwardSort)}><option value="recent">Mới nhất</option><option value="amount">Giá trị cao nhất</option></select></label>
  </div>
  {data?.totalDistinctPackages!=null&&<p className="muted small">{count(data.totalDistinctPackages)} mã TBMT riêng trong phạm vi lọc</p>}
  {data?.packageCountUnavailableReason&&<p className="muted small">{data.packageCountUnavailableReason}</p>}
  {loading&&<p role="status" data-export-pending>Đang tải kết quả trúng thầu…</p>}{error&&<p role="alert">{error} <button className="btn ghost" onClick={()=>setRetry(value=>value+1)}>Thử lại</button></p>}{data?.reason&&<p>{data.reason}</p>}
  {!!rows.length&&<div className="analytics-awards-table"><DataTable rows={rows} rowKey={(row:DetailRow)=>row.id} selectable={false} showIndex={false} filtersVisible={false} minWidth={700} rowDoubleClickCapture cardKeys={['name','date','ingredient','facility','amount','company','manufacturer']} onRowDoubleClick={onOpenPackage?(row:DetailRow)=>onOpenPackage({...row,source}):undefined} columns={[
   {key:'date',label:'Ngày / Mã gói',render:(_:unknown,row:DetailRow)=><>{row.date||'—'}<small>{row.tender_no||'Chưa có mã TBMT'}</small>{row.source_url&&/^https?:\/\//.test(row.source_url)&&<a href={row.source_url} target="_blank" rel="noreferrer" onClick={event=>event.stopPropagation()}>Nguồn ↗</a>}</>},
   {key:'name',label:'Gói thầu / Thuốc · SĐK',render:(_:unknown,row:DetailRow)=><>{row.package_name||(Number(row.line_count||1)>1?`${row.line_count} dòng thuốc`:row.name)||'—'}{Number(row.line_count||1)===1&&<small>{entity(row.registration,'drug','winner','registration')}</small>}{row.line_count&&<small>{row.line_count} dòng thuốc liên quan</small>}</>},
   {key:'ingredient',label:'Hoạt chất',render:(_:unknown,row:DetailRow)=><>{Number(row.ingredient_count)>1?<AwardIngredients query={query} row={row} source={source}/>:entity(row.ingredient,'drug')}{Number(row.line_count||1)===1&&<small>{[(row.group_key||row.group_name?.match(/[1-5]/)?.[0])?`Nhóm ${row.group_key||row.group_name?.match(/[1-5]/)?.[0]}`:'',row.strength,row.form].filter(Boolean).join(' · ')}</small>}</>},
   {key:'company',label:'Nhà thầu',render:(_:unknown,row:DetailRow)=>Number(row.company_count)>1?`${count(row.company_count)} nhà thầu`:entity(row.company,'company')},
   {key:'manufacturer',label:'Nhà sản xuất',render:(_:unknown,row:DetailRow)=>Number(row.manufacturer_count)>1?`${count(row.manufacturer_count)} nhà sản xuất`:entity(row.manufacturer,'company','manufacturer')},
   {key:'facility',label:'Cơ sở / Tỉnh',render:(_:unknown,row:DetailRow)=><>{entity(row.facility,'territory','winner','facility')}<small>{entity(row.province,'territory','winner','province')}</small></>},
   {key:'amount',label:'Giá trị',render:(_:unknown,row:DetailRow)=><strong>{money(row.amount)}</strong>},
  ]}/></div>}
  {!loading&&!error&&!rows.length&&!data?.reason&&<p className="muted">Không có kết quả trúng thầu phù hợp trong kỳ này.</p>}
  <div className="analytics-controls"><button type="button" className="btn ghost" disabled={!page||loading} onClick={()=>setPage(value=>value-1)}>Trước</button><span>Trang {page+1}</span><button type="button" className="btn ghost" disabled={!data?.hasMore||loading} onClick={()=>setPage(value=>value+1)}>Sau</button></div>
 </Card>
}

function AwardIngredients({query,row,source}:{query:AnalyticsQuery;row:DetailRow;source:AwardSource}){
 const [items,setItems]=useState<DetailRow[]>(),[error,setError]=useState(''),[loading,setLoading]=useState(false)
 return <details className="analytics-award-ingredients" onToggle={event=>{if(event.currentTarget.open&&!items&&!loading){setLoading(true);request<{items:DetailRow[];hasMore:boolean}>('/api/analytics/detail',{query,source,tenderNo:row.tender_no,page:0}).then(value=>{setItems(value.items);if(value.hasMore)setError('Hiển thị 50 dòng đầu; mở mã gói để xem chi tiết.')}).catch(e=>setError(e.message)).finally(()=>setLoading(false))}}}><summary>{count(row.ingredient_count)} hoạt chất</summary>{loading&&<p role="status" data-export-pending>Đang tải thuốc…</p>}{error&&<p role="status">{error}</p>}{items?.map(item=><p key={item.id}>{[item.ingredient,item.strength,item.form,item.group_key?`Nhóm ${item.group_key}`:''].filter(Boolean).join(' · ')}</p>)}</details>
}
