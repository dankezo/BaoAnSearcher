import {useEffect,useRef,useState} from 'react'
import {request} from './client'
import EntityValue from './EntityValue'
import {Card} from './ui'
import {count,money} from './Charts'
import {SOURCE_LABELS} from './types'
import type {AnalyticsQuery,DetailRow} from './types'

type AwardSource='msc_prices'|'vss'
type AwardSort='recent'|'amount'
type AwardsPage={source:AwardSource;sort:AwardSort;page:number;items:DetailRow[];hasMore:boolean;totalDistinctPackages:number|null;packageCountUnavailableReason?:string;reason?:string}
type OpenPackage=(row:DetailRow)=>void
type OpenEntity=(mode:'drug'|'company'|'territory',name:string,role?:AnalyticsQuery['role'],field?:'ingredient'|'name'|'registration'|'province'|'facility'|'region')=>void

async function loadAwards(query:AnalyticsQuery,source:AwardSource,sort:AwardSort,page:number,scope?:AnalyticsQuery):Promise<AwardsPage>{
 return request<AwardsPage>('/api/analytics/awards',{query,source,sort,page,...(scope?{scope}:{})})
}

export default function RecentAwards({query,scope,onOpenPackage,onEntity,onRelated}:{query:AnalyticsQuery;scope?:AnalyticsQuery;onOpenPackage?:OpenPackage;onEntity?:OpenEntity;onRelated?:(q:AnalyticsQuery)=>void}){
 void onEntity
 const [source,setSource]=useState<AwardSource>('msc_prices'),[sort,setSort]=useState<AwardSort>('recent'),[page,setPage]=useState(0)
 const [data,setData]=useState<AwardsPage>(),[error,setError]=useState(''),[loading,setLoading]=useState(false)
 const generation=useRef(0)
 useEffect(()=>{setPage(0);setData(undefined)},[query,scope,source,sort])
 useEffect(()=>{
  const id=++generation.current
  setLoading(true);setError('')
  loadAwards(query,source,sort,page,scope).then(value=>{if(generation.current===id)setData(value)}).catch(reason=>{if(generation.current===id)setError(reason.message)}).finally(()=>{if(generation.current===id)setLoading(false)})
  return()=>{generation.current++}
 },[query,scope,source,sort,page])
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
  {loading&&<p role="status">Đang tải kết quả trúng thầu…</p>}{error&&<p role="alert">{error}</p>}{data?.reason&&<p>{data.reason}</p>}
  {!!rows.length&&<div className="analytics-table"><table><thead><tr><th>Ngày / Mã gói</th><th>Gói thầu / Thuốc · SĐK</th><th>Hoạt chất</th><th>Nhà thầu</th><th>Nhà sản xuất</th><th>Cơ sở / Tỉnh</th><th>Giá trị</th></tr></thead><tbody>{rows.map((row,index)=>{
   const progress=rows.length<2?1:1-index/(rows.length-1),background=`linear-gradient(90deg, rgba(22,163,74,${0.04+progress*0.11}), rgba(220,252,231,${0.08+progress*0.18}))`
   return <tr key={row.id} onDoubleClick={()=>onOpenPackage?.({...row,source})} title={onOpenPackage?'Nhấp đúp để mở chi tiết gói':''} style={{background}}>
    <td>{row.date||'—'}<small>{row.tender_no||'Chưa có mã TBMT'}</small>{row.source_url&&/^https?:\/\//.test(row.source_url)&&<a href={row.source_url} target="_blank" rel="noreferrer" onClick={event=>event.stopPropagation()}>Nguồn ↗</a>}</td>
    <td>{row.package_name||(Number(row.line_count||1)>1?`${row.line_count} dòng thuốc`:row.name)||'—'}{Number(row.line_count||1)===1&&<small>{entity(row.registration,'drug','winner','registration')}</small>}{row.line_count&&<small>{row.line_count} dòng thuốc liên quan</small>}</td>
    <td>{Number(row.ingredient_count)>1?`${count(row.ingredient_count)} hoạt chất`:entity(row.ingredient,'drug')}{Number(row.line_count||1)===1&&<small>{[row.strength,row.form].filter(Boolean).join(' · ')}</small>}</td>
    <td>{Number(row.company_count)>1?`${count(row.company_count)} nhà thầu`:entity(row.company,'company')}</td><td>{Number(row.manufacturer_count)>1?`${count(row.manufacturer_count)} nhà sản xuất`:entity(row.manufacturer,'company','manufacturer')}</td>
    <td>{entity(row.facility,'territory','winner','facility')}<small>{entity(row.province,'territory','winner','province')}</small></td><td><strong>{money(row.amount)}</strong></td>
   </tr>
  })}</tbody></table></div>}
  {!loading&&!error&&!rows.length&&!data?.reason&&<p className="muted">Không có kết quả trúng thầu phù hợp trong kỳ này.</p>}
  <div className="analytics-controls"><button type="button" className="btn ghost" disabled={!page||loading} onClick={()=>setPage(value=>value-1)}>Trước</button><span>Trang {page+1}</span><button type="button" className="btn ghost" disabled={!data?.hasMore||loading} onClick={()=>setPage(value=>value+1)}>Sau</button></div>
 </Card>
}
