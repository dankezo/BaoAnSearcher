import {useEffect,useRef,useState} from 'react'
import type {KeyboardEvent,MouseEvent} from 'react'
import {loadDetail} from './client'
import {money,count} from './Charts'
import {Card,cardId} from './ui'
import EntityValue,{type EntityTargetQuery} from './EntityValue'
import {SOURCE_LABELS} from './types'
import {DataTable} from '../components'
import type {AnalyticsQuery,Source,DetailPage,DetailRow} from './types'
export default function DetailTable({query,source,onEntity,isRival,onEntityContextMenu,onRelated,onOpenPackage}:{query:AnalyticsQuery;source:Source;onEntity:(mode:'drug'|'company'|'territory',name:string,role?:AnalyticsQuery['role'],field?:'ingredient'|'name'|'registration'|'province'|'facility'|'region',companyFocus?:string)=>void;isRival?:(r:DetailRow)=>boolean;onEntityContextMenu?:(query:EntityTargetQuery,event:MouseEvent<HTMLSpanElement>|KeyboardEvent<HTMLSpanElement>)=>void;onRelated?:(query:EntityTargetQuery)=>void;onOpenPackage?:(row:DetailRow)=>void}){
  void onEntity // Keep the existing callback prop source-compatible; entity labels now open from the context menu.
  const [open,setOpen]=useState(()=>typeof location!=='undefined'&&new URLSearchParams(location.search).get('analyticsSection')===cardId(`${SOURCE_LABELS[source]} · hồ sơ chi tiết`)),[page,setPage]=useState(0),[data,setData]=useState<DetailPage>(),[error,setError]=useState(''),[loading,setLoading]=useState(false)
  const generation=useRef(0)
  useEffect(()=>{setPage(0);setData(undefined)},[query,source])
  useEffect(()=>{
    const id=++generation.current
    if(!open)return
    setLoading(true);setError('')
    loadDetail(query,source,page).then(v=>{if(generation.current===id)setData(v)}).catch(e=>{if(generation.current===id)setError(e.message)}).finally(()=>{if(generation.current===id)setLoading(false)})
    return()=>{generation.current++}
  },[query,source,page,open])
  const value=(text:string|null|undefined,mode:'drug'|'company'|'territory',role:AnalyticsQuery['role']='winner',field:'ingredient'|'name'|'registration'|'province'|'facility'|'region'='ingredient')=><EntityValue value={text} parentQuery={query} mode={mode} role={role} field={field} onContextMenu={onEntityContextMenu} onRelated={onRelated}/>
  return <Card title={`${SOURCE_LABELS[source]} · hồ sơ chi tiết`} exportable={open&&!!data?.items.length}><button className="btn ghost" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?'Đóng danh sách':'Mở danh sách · 50 dòng/trang'}</button>{open&&<>{loading&&<p role="status" data-export-pending>Đang tải…</p>}{error&&<p role="alert">{error}</p>}{data?.reason&&<p>{data.reason}</p>}<div className="analytics-awards-table"><DataTable rows={data?.items||[]} rowKey={(r:DetailRow)=>r.id} selectable={false} showIndex={false} filtersVisible={false} loading={loading} emptyText="Không có dòng phù hợp." minWidth={1000} cardKeys={['name','ingredient','registration','amount','quantity','group_key','company','province','date']} rowClassName={(r:DetailRow)=>isRival?.(r)?'analytics-rival':''} onRowDoubleClick={onOpenPackage} columns={[
    {key:'name',label:'Thuốc / Gói thầu',render:(_:unknown,r:DetailRow)=><>{isRival?.(r)&&<span title="Trùng hoạt chất, hàm lượng và nhóm Bảo An">⚠ </span>}{source==='msc_tenders'?r.name||'—':value(r.name,'drug','winner','name')}</>},
    {key:'ingredient',label:'Hoạt chất · Hàm lượng',render:(_:unknown,r:DetailRow)=><>{value(r.ingredient||r.registration,'drug','winner',r.ingredient?'ingredient':'registration')}<small>{[r.strength,r.form,r.route].filter(Boolean).join(' · ')}</small></>},
    {key:'registration',label:'SĐK / Mã thầu',render:(_:unknown,r:DetailRow)=><>{r.registration?value(r.registration,'drug','winner','registration'):r.tender_no||'—'}{r.source_url&&/^https?:\/\//.test(r.source_url)&&<a href={r.source_url} target="_blank" rel="noreferrer">Nguồn ↗</a>}</>},
    {key:'group_key',label:'Nhóm · ĐVT',render:(_:unknown,r:DetailRow)=>`${r.group_key||'—'} · ${r.unit||'—'}`},
    {key:'quantity',label:'Số lượng × Đơn giá',render:(_:unknown,r:DetailRow)=>`${count(r.quantity)} × ${money(r.price)}`},
    {key:'amount',label:'Giá trị',render:(_:unknown,r:DetailRow)=>money(r.amount)},
    {key:'company',label:'Doanh nghiệp',render:(_:unknown,r:DetailRow)=>([['company','winner'],['manufacturer','manufacturer'],['registrant','registrant']] as const).map(([field,role])=>r[field]&&<span className="analytics-entity-value-wrap" key={field}>{value(r[field],'company',role,'name')}<small>{role==='winner'?'Nhà thầu':role==='manufacturer'?'Nhà sản xuất':'Đơn vị đăng ký'}</small></span>)},
    {key:'province',label:'Địa bàn / CSYT',render:(_:unknown,r:DetailRow)=><>{value(r.province,'territory','winner','province')}{r.facility&&<>{' '}{value(r.facility,'territory','winner','facility')}</>}</>},
    {key:'date',label:'Ngày / Hết hạn',render:(_:unknown,r:DetailRow)=><>{r.date||'—'}{source==='dav'&&<small>Hết hạn: {r.expiry||'Chưa rõ'}</small>}{r.status&&<small>{r.status}</small>}</>},
  ]}/></div><div className="analytics-controls"><button className="btn ghost" disabled={!page||loading} onClick={()=>setPage(p=>p-1)}>Trước</button><span>Trang {page+1}</span><button className="btn ghost" disabled={!data?.hasMore||loading} onClick={()=>setPage(p=>p+1)}>Sau</button></div></>}</Card>
}
