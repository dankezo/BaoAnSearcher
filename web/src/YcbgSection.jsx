import { useCallback, useEffect, useRef, useState } from 'react'
import { api, fmtDateTime } from './api'
import { cloudMscSearch } from './supabaseCloud'
import { ScopeCatalog } from './MscSection'
import DateInput from './DateInput'
import { numberValue, lineValue } from './numbers'
import { DataTable, DetailModal, ErrorNote, Field, Pagination, TableToolbar, UpdatedNote, applyColumnFilters, exportSelectionOrAll, fetchAllPages, useSelection } from './components'

const COLS = [
  { key: 'tender_no', label: 'Mã YCBG', mono: true, nowrap: true },
  { key: 'name', label: 'Tên yêu cầu báo giá', width: 300, truncateAt: 96 },
  { key: 'buyer', label: 'Chủ đầu tư', width: 200 },
  { key: 'province', label: 'Tỉnh / TP', width: 140 },
  { key: 'published', label: 'Ngày đăng', text: r => fmtDateTime(r.published) },
  { key: 'close_date', label: 'Hạn nhận báo giá', text: r => fmtDateTime(r.close_date) },
  { key: 'status_label', label: 'Trạng thái', width: 180 },
  { key: 'baoan_match', label: 'Khớp Bảo An', text: r => r.baoan_match === 'exact' ? 'Khớp' : r.baoan_match === 'near' ? 'Cần rà soát' : 'Chưa có dòng khớp' },
  { key: 'document_status', label: 'Hồ sơ', width: 190 },
].map(column=>column.text?{...column,render:(_value,row)=>column.text(row)}:column)
const DETAIL = [
  { key: 'tender_no', label: 'Mã YCBG' }, { key: 'version', label: 'Phiên bản' },
  { key: 'name', label: 'Tên yêu cầu báo giá' }, { key: 'bid_name', label: 'Tên gói dự kiến' },
  { key: 'buyer', label: 'Chủ đầu tư' }, { key: 'province', label: 'Tỉnh / TP' },
  { key: 'published', label: 'Ngày đăng', text: r => fmtDateTime(r.published) },
  { key: 'receive_from', label: 'Nhận từ', text: r => fmtDateTime(r.receive_from) },
  { key: 'close_date', label: 'Hạn nhận báo giá', text: r => fmtDateTime(r.close_date) },
  { key: 'status_label', label: 'Trạng thái' }, { key: 'document_status', label: 'Hồ sơ' },
  { key: 'bid_form', label: 'Hình thức báo giá' }, { key: 'contact_name', label: 'Người liên hệ' },
  { key: 'contact_phone', label: 'Điện thoại' }, { key: 'contact_email', label: 'Email' },
  { key: 'contact_address', label: 'Địa chỉ' }, { key: 'content', label: 'Nội dung' },
  { key: 'cancel_reason', label: 'Lý do hủy' }, { key: 'source_url', label: 'Hồ sơ nguồn' },
]
const EMPTY = { q:'', tender_no:'', buyer:'', ingredient:'', dosage_form:'', province:'', group_name:[], metricQuick:'', publishedFrom:'', publishedTo:'' }

export default function YcbgSection({ localMode }) {
  const [draft,setDraft]=useState(EMPTY)
  const [filters,setFilters]=useState(EMPTY)
  const [size,setSize]=useState(100)
  const [page,setPage]=useState(0)
  const [data,setData]=useState({items:[],total:0})
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [detail,setDetail]=useState(null)
  const [exporting,setExporting]=useState(false)
  const [meta,setMeta]=useState(null)
  const [filtersRow,setFiltersRow]=useState(false)
  const [columnFilters,setColumnFilters]=useState({})
  const request=useRef(0)
  const selection=useSelection()
  const search=useCallback((f,p,sz)=>localMode ? api.mscSearch({kind:'ycbg',filters:f,page:p,size:sz}) : cloudMscSearch({kind:'ycbg',filters:f,page:p,size:sz}),[localMode])
  const load=useCallback(async()=>{
    const id=++request.current
    setLoading(true);setError('')
    try {
      const result=await search(filters,page,size)
      if(id===request.current) { setData(result); if(result.meta)setMeta(result.meta) }
    } catch(e) {if(id===request.current)setError(e.message)}
    finally {if(id===request.current)setLoading(false)}
  },[search,filters,page,size])
  useEffect(()=>{load();return()=>{request.current++}},[load])
  useEffect(()=>{if(localMode)api.mscYcbgMeta().then(setMeta).catch(()=>{})},[localMode,data.items])
  const field=(key,value)=>setDraft(d=>({...d,[key]:value}))
  const submit=e=>{
    e.preventDefault()
    if(draft.publishedFrom && draft.publishedTo && draft.publishedFrom>draft.publishedTo){setError('Từ ngày phải trước hoặc bằng đến ngày.');return}
    selection.clear();setPage(0);setFilters({...draft})
  }
  const fetchAll=()=>fetchAllPages((p,sz)=>search(filters,p,sz),{size:2000,cap:50000,strict:true})
  const doExport=async()=>{
    setExporting(true);setError('')
    try {
      const rows=selection.size?[...selection.selected.values()]:applyColumnFilters(await fetchAll(),COLS,columnFilters)
      const lines=rows.flatMap(row=>(row.scope_lines||[]).map(line=>({...line,qty:numberValue(line.qty),price:numberValue(line.price),total_value:lineValue(line.price,line.qty),tender_no:row.tender_no,baoan_products:(line.hits||[]).map(hit=>`${hit.brand} (${hit.reg})`).join('; ')})))
      await exportSelectionOrAll({columns:COLS,selected:new Map(rows.map(row=>[row.id,row])),fetchAll:async()=>rows,filename:'MSC_YCBG',sheetName:'YCBG',extraSheets:[{name:'Danh_muc_thuoc',columns:[{key:'tender_no',label:'Mã YCBG'},{key:'code',label:'Mã thuốc'},{key:'name',label:'Hoạt chất'},{key:'strength',label:'Hàm lượng'},{key:'form',label:'Dạng bào chế'},{key:'group',label:'Nhóm'},{key:'route',label:'Đường dùng'},{key:'unit',label:'ĐVT'},{key:'price',label:'Đơn giá',sum:true},{key:'qty',label:'Số lượng',sum:true},{key:'total_value',label:'Tổng GT',sum:true},{key:'match',label:'Mức khớp'},{key:'reviewReason',label:'Cần rà soát'},{key:'baoan_products',label:'Thuốc Bảo An'}],rows:lines}]})
    }
    catch(e){setError(e.message)}finally{setExporting(false)}
  }
  return <section className="section msc-section">
    <div className="section-head"><div><h1>MSC - YCBG</h1><p className="muted">Yêu cầu báo giá · từ khóa “thầu thuốc” · khớp tất cả từ (phân biệt dấu).</p></div></div>
    <UpdatedNote updated={meta?.updated} count={meta?.count ?? data.total} source="Mạng đấu thầu quốc gia" />
    {meta?.fullScanComplete===false && <p className="info-note" role="status">Chưa lấy đủ lịch sử YCBG: {meta.count}{meta.sourceTotal ? `/${meta.sourceTotal}` : ''} bản ghi đã lưu. Cập nhật tại Dữ liệu → MSC - YCBG.</p>}
    <form className="filter-panel" onSubmit={submit}>
      <div className="filter-grid">
        {[['q','Từ khóa'],['tender_no','Mã YCBG'],['buyer','Chủ đầu tư'],['ingredient','Hoạt chất'],['dosage_form','Dạng bào chế'],['province','Tỉnh / TP']].map(([key,label])=><Field key={key} label={label}><input className="input" aria-label={label} value={draft[key]} onChange={e=>field(key,e.target.value)} /></Field>)}
        <Field label="Nhóm thuốc"><select className="input" aria-label="Nhóm thuốc" value={draft.group_name[0]||''} onChange={e=>field('group_name',e.target.value?[e.target.value]:[])}><option value="">Tất cả nhóm</option>{[1,2,3,4,5].map(g=><option key={g} value={String(g)}>Nhóm {g}</option>)}</select></Field>
        <Field label="Khớp / thời hạn"><select className="input" aria-label="Khớp / thời hạn" value={draft.metricQuick} onChange={e=>field('metricQuick',e.target.value)}><option value="">Tất cả</option><option value="exact">Khớp Bảo An</option><option value="near">Cần rà soát</option><option value="open">Còn nhận báo giá</option></select></Field>
        <Field label="Đăng từ"><DateInput aria-label="Đăng từ" value={draft.publishedFrom} onValueChange={v=>field('publishedFrom',v)} /></Field>
        <Field label="Đăng đến"><DateInput aria-label="Đăng đến" value={draft.publishedTo} onValueChange={v=>field('publishedTo',v)} /></Field>
      </div>
      <div className="filter-actions"><button className="btn" type="submit" disabled={loading}>Tìm kiếm</button><button className="btn secondary" type="button" onClick={()=>{setDraft(EMPTY);setFilters(EMPTY);setPage(0);selection.clear()}}>Đặt lại</button></div>
    </form>
    <TableToolbar title="Yêu cầu báo giá thuốc" kicker="MSC - YCBG" selectedCount={selection.size} onClearSelection={selection.clear} onExport={doExport} exporting={exporting} filtersVisible={filtersRow} onToggleFilters={()=>setFiltersRow(v=>!v)} activeColumnFilters={Object.values(columnFilters).filter(Boolean).length} onClearColumnFilters={()=>setColumnFilters({})}><button type="button" className="btn secondary sm" disabled={loading} onClick={load}>Tải lại danh sách</button></TableToolbar>
    <ErrorNote>{error}</ErrorNote>
    <DataTable columns={COLS} rows={applyColumnFilters(data.items,COLS,columnFilters)} columnFilters={columnFilters} onColumnFilter={(key,value)=>setColumnFilters(f=>({...f,[key]:value}))} filtersVisible={filtersRow} rowKey={r=>r.id} startIndex={page*size} selected={selection.selected} onToggleRow={selection.toggle} onToggleAll={selection.setMany} onRowDoubleClick={setDetail} loading={loading} emptyText="Chưa có YCBG phù hợp. Lấy dữ liệu tại Dữ liệu → MSC - YCBG." minWidth={1100} trailing={{label:'Nguồn',render:r=><a href={r.source_url} target="_blank" rel="noreferrer">Hồ sơ ↗</a>}} />
    <Pagination total={data.total} page={page} size={size} shown={applyColumnFilters(data.items,COLS,columnFilters).length} pageSize={size} hasMore={data.hasMore} onPage={setPage} onPageSize={v=>{setSize(Number(v));setPage(0)}} />
    <DetailModal row={detail} fields={DETAIL} title={detail?.name||'Chi tiết YCBG'} subtitle={detail?.tender_no} onClose={()=>setDetail(null)} width={1120} extra={detail ? <><p className="muted small">{detail.document_status}. Nhóm chưa xác minh được giữ ở “Cần rà soát”.</p><ScopeCatalog title="Danh mục thuốc yêu cầu báo giá" lines={detail.scope_lines} tenderNo={detail.tender_no} /></> : null} renderValue={(f,row,val)=>f.key==='source_url'?<a href={row.source_url} target="_blank" rel="noreferrer">Mở hồ sơ nguồn</a>:val} />
  </section>
}
