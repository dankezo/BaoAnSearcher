import {useEffect,useMemo,useState} from 'react'
import RecentAwards from './RecentAwards'
import {Dialog} from './ui'
import {request} from './client'
import {count,money} from './Charts'
import {DEFAULT_QUERY,SOURCE_LABELS} from './types'
import {DataTable} from '../components'
import type {AnalyticsQuery,DetailPage,DetailRow} from './types'

type PackageSource='msc_prices'|'vss'
type WorkspaceRow=DetailRow&{source?:PackageSource}
const PackageDialog=Dialog as typeof Dialog & ((props:Parameters<typeof Dialog>[0]&{className?:string})=>ReturnType<typeof Dialog>)
const show=(value:unknown)=>value==null||value===''?'—':String(value)

export default function PackageWorkspace({relatedQuery,scope,packageRow,initialSource='msc_prices',onOpenPackage,onClose}:{relatedQuery?:AnalyticsQuery;initialSource?:PackageSource;scope?:AnalyticsQuery;packageRow?:DetailRow;onOpenPackage:(row:DetailRow)=>void;onClose:()=>void}){
 const [detail,setDetail]=useState<DetailPage>(),[loading,setLoading]=useState(false),[error,setError]=useState('')
 const selected=packageRow as WorkspaceRow|undefined
 const source=selected?.source||'msc_prices'
 const tenderNo=selected?.tender_no||''
 const awardsQuery=useMemo(()=>relatedQuery||{...DEFAULT_QUERY,months:'all' as const,comparison:'none' as const},[relatedQuery])
 useEffect(()=>{
  let active=true
  const controller=new AbortController()
  setDetail(undefined);setError('')
  if(!selected||source!=='msc_prices'||!tenderNo){setLoading(false);return()=>{active=false}}
  setLoading(true)
  request<DetailPage>('/api/analytics/detail',{query:{...DEFAULT_QUERY,months:'all',comparison:'none'},source:'msc_prices',page:0,tenderNo},controller.signal)
   .then(value=>{if(active)setDetail(value)})
   .catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'Chưa tải được chi tiết gói thầu.')})
   .finally(()=>{if(active)setLoading(false)})
  return()=>{active=false;controller.abort()}
 },[selected?.id,source,tenderNo])
 const sourceUrl=selected?.source_url&&/^https?:\/\//.test(selected.source_url)?selected.source_url:''
 const isVss=source==='vss',multipleLines=Number(selected?.line_count||1)>1
 return <PackageDialog open={Boolean(relatedQuery||packageRow)} onClose={onClose} title={isVss?'Chi tiết bản ghi VSS':`Gói thầu ${tenderNo||'liên quan'}`} className={`analytics-package-dialog ${packageRow&&!relatedQuery?'package-only':''}`}>
  <div className={`analytics-package-layout ${packageRow?'has-package':''}`}>
   {packageRow&&selected&&<section className="analytics-package-detail" aria-label={isVss?'Chi tiết bản ghi VSS':'Chi tiết gói thầu MSC'}>
    <h2>{isVss?'Bản ghi VSS':`Mã TBMT ${tenderNo||'Chưa có mã'}`}</h2>
    <dl className="analytics-package-facts">
     <div><dt>Nguồn</dt><dd>{SOURCE_LABELS[source]}</dd></div><div><dt>Ngày</dt><dd>{show(selected.date)}</dd></div>
     <div><dt>Thuốc / gói</dt><dd>{show(selected.package_name||(multipleLines?'Các dòng thuốc phù hợp trong gói':selected.name))}</dd></div><div><dt>Số đăng ký</dt><dd>{multipleLines?'Xem từng dòng thuốc bên dưới':show(selected.registration)}</dd></div>
     <div><dt>Hoạt chất</dt><dd>{Number(selected.ingredient_count)>1?`${count(selected.ingredient_count)} hoạt chất`:show(selected.ingredient)}</dd></div><div><dt>Hàm lượng · dạng</dt><dd>{multipleLines?'Xem từng dòng thuốc bên dưới':[selected.strength,selected.form].filter(Boolean).join(' · ')||'—'}</dd></div>
     <div><dt>Nhà thầu</dt><dd>{Number(selected.company_count)>1?`${count(selected.company_count)} nhà thầu`:show(selected.company)}</dd></div><div><dt>Nhà sản xuất</dt><dd>{Number(selected.manufacturer_count)>1?`${count(selected.manufacturer_count)} nhà sản xuất`:show(selected.manufacturer)}</dd></div>
     <div><dt>Cơ sở · địa bàn</dt><dd>{[selected.facility,selected.province].filter(Boolean).join(' · ')||'—'}</dd></div>
     {!multipleLines&&<div><dt>Số lượng × đơn giá</dt><dd>{count(selected.quantity)} × {money(selected.price)}</dd></div>}
     {selected.package_bid_price&&<div><dt>Giá gói công bố</dt><dd>{money(selected.package_bid_price)}</dd></div>}<div><dt>Giá trị trúng thầu trong phạm vi lọc</dt><dd>{money(selected.amount)}</dd></div><div><dt>Trạng thái</dt><dd>{show(selected.status)}</dd></div>
    </dl>
    {sourceUrl&&<p><a href={sourceUrl} target="_blank" rel="noreferrer">Mở nguồn gốc ↗</a></p>}
    {isVss?<p className="muted small">VSS không cung cấp mã TBMT ổn định; đây là chi tiết của bản ghi đã chọn.</p>:<details key={tenderNo} open={typeof window==='undefined'||!window.matchMedia('(max-width:640px)').matches}><summary>Danh sách thuốc trong gói · tối đa 50 dòng</summary>{loading&&<p role="status">Đang tải danh sách thuốc…</p>}{error&&<p role="alert">{error}</p>}{detail?.reason&&<p>{detail.reason}</p>}<DataTable rows={detail?.items||[]} rowKey={(row:DetailRow)=>row.id} selectable={false} showIndex={false} filtersVisible={false} loading={loading} minWidth={800} emptyText="Không có dòng thuốc trong mã TBMT này." cardKeys={['name','ingredient','registration','group_key','quantity','amount','company']} columns={[
     {key:'name',label:'Thuốc',render:(value:unknown)=>show(value)},
     {key:'ingredient',label:'Hoạt chất · hàm lượng · dạng',render:(_:unknown,row:DetailRow)=>[row.ingredient,row.strength,row.form].filter(Boolean).join(' · ')||'—'},
     {key:'registration',label:'SĐK',render:(value:unknown)=>show(value)},
     {key:'group_key',label:'Nhóm · đơn vị',render:(_:unknown,row:DetailRow)=>[row.group_key,row.unit].filter(Boolean).join(' · ')||'—'},
     {key:'quantity',label:'Số lượng × đơn giá',render:(_:unknown,row:DetailRow)=>`${count(row.quantity)} × ${money(row.price)}`},
     {key:'amount',label:'Giá trị',render:(_:unknown,row:DetailRow)=>money(row.amount)},
     {key:'company',label:'Nhà thầu',render:(value:unknown)=>show(value)},
    ]}/>{detail?.hasMore&&<p className="muted small">Đang hiển thị 50 dòng đầu.</p>}</details>}
   </section>}
   {relatedQuery&&<section className="analytics-package-awards" aria-label="Các kết quả trúng thầu liên quan">
    {relatedQuery?<RecentAwards initialSource={initialSource} query={awardsQuery} scope={scope} onOpenPackage={onOpenPackage}/>:<p className="muted">Chọn một dòng trúng thầu để xem chi tiết.</p>}
   </section>}
  </div>
 </PackageDialog>
}
