import { useEffect, useRef, useState } from 'react'
import { cloudDavSearch, cloudMscSearch, cloudVssSearch, cloudDatasetDownload } from './supabaseCloud'
import { Dialog } from './analytics/ui'
import { ErrorNote, fetchAllPages } from './components'
import { downloadBlob, exportXlsx } from './export'
import { api } from './api'
import { lineValue, numberValue } from './numbers'
import DateInput from './DateInput'
import columnsByCode from './dataExportColumns.json'
import './analytics/analytics.css'
import './datasetDownload.css'

export default function DatasetDownload({ dataset, localMode, onClose }) {
  const [draft,setDraft] = useState({ start:'',end:'',ingredient:'',registration:'',name:'',group:'',province:'',format:'xlsx' })
  const [busy,setBusy] = useState(false),[error,setError] = useState(''),[progress,setProgress] = useState(0)
  const cancelled = useRef(false),controller = useRef(null)
  useEffect(()=>()=>{cancelled.current=true;controller.current?.abort()},[])
  const code = dataset.code
  const set = (key,value)=>setDraft(previous=>({...previous,[key]:value}))
  async function download() {
    if(draft.start && draft.end && draft.start>draft.end){setError('Từ ngày phải trước hoặc bằng đến ngày.');return}
    const filters = code==='VSS'?{hoatchat:draft.ingredient,sodk:draft.registration,ten:draft.name,nhomthau:draft.group,ten_tinh:draft.province}:code==='DAV'?{hoatChat:draft.ingredient,soDangKy:draft.registration,tenThuoc:draft.name,tenderGroup:draft.group?[draft.group]:[]}: {ingredient:draft.ingredient,registration:draft.registration,name:draft.name,group_name:draft.group,province:draft.province}
    const filtered = draft.start || draft.end || Object.values(filters).some(value=>Array.isArray(value)?value.length:!!value)
    setBusy(true);setError('');setProgress(0);cancelled.current=false
    try {
      if(localMode){
        const abort=new AbortController();controller.current=abort
        const blob=await api.datasetDownload({code,filters,start:draft.start,end:draft.end,format:draft.format},abort.signal)
        if(!cancelled.current)downloadBlob(blob,`${code}_du_lieu.${draft.format}`)
      }else if(!filtered && code!=='MSC_YCBG'){
        const result=await cloudDatasetDownload(code,draft.format)
        if(!result.url)throw new Error('Snapshot chưa sẵn sàng.')
        window.location.assign(result.url)
      }else{
        filters._export = true
        if(code==='VSS')Object.assign(filters,{tuNgay:draft.start,denNgay:draft.end})
        else if(code==='DAV')Object.assign(filters,{dateFrom:draft.start,dateTo:draft.end})
        else Object.assign(filters,{publishedFrom:draft.start,publishedTo:draft.end,strictDates:true})
        const search = code==='VSS'?cloudVssSearch:code==='DAV'?cloudDavSearch:body=>cloudMscSearch({...body,kind:code==='MSC_YCBG'?'ycbg':code==='MSC_PRICE'?'prices':'tenders'})
        const rows=await fetchAllPages((page,size,cursor)=>search({filters,page,size,cursor}),{size:5000,cap:50000,strict:true,onProgress:setProgress,shouldCancel:()=>cancelled.current})
        if(!rows.length)throw new Error('Không có dữ liệu theo bộ lọc đã chọn.')
        const columns=columnsByCode[code]
        const value=(row,column)=>{
          if(code==='VSS' && column.key==='thanhtien'){
            const numbers=row._analyticsNumbers
            return lineValue(numbers?numberValue(numbers.gia):numberValue(row.gia,true),numbers?numberValue(numbers.soluong):numberValue(row.soluong,true))
          }
          if(code==='MSC_PRICE' && column.key==='total_value')return lineValue(row.unit_price,row.quantity)
          return column.numeric && row[column.key]!=null && row[column.key]!==''?Number(row[column.key]):row[column.key]
        }
        if(draft.format==='xlsx')exportXlsx({columns,rows,getValue:value,filename:`${code}_du_lieu`,sheetName:code,extraSheets:[{name:'Bo_loc',columns:[{key:'key',label:'Tiêu chí'},{key:'value',label:'Giá trị'}],rows:[{key:'Từ ngày',value:draft.start||'Toàn bộ'},{key:'Đến ngày',value:draft.end||'Toàn bộ'},{key:'Số dòng',value:rows.length},{key:'Bộ lọc',value:JSON.stringify(filters)}]}]})
        else{
          const csvCell=v=>{const text=String(v??'');return '"'+(typeof v==='string' && /^[=+\-@]/.test(text)?"'":'')+text.replace(/"/g,'""')+'"'}
          const csv=[columns.map(c=>csvCell(c.label)).join(','),...rows.map(row=>columns.map(column=>csvCell(value(row,column))).join(','))].join('\r\n')
          downloadBlob(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}),`${code}_du_lieu.csv`)
        }
      }
      if(!cancelled.current)onClose()
    }catch(e){if(!cancelled.current)setError(e.message||'Không tải được dữ liệu.')}
    finally{if(!cancelled.current)setBusy(false)}
  }
  const close=()=>{cancelled.current=true;controller.current?.abort();onClose()}
  const dateLabel=code==='VSS'?'ngày bắt đầu HĐ':code==='DAV'?'ngày cấp SĐK':'ngày đăng / KQLCNT'
  return <Dialog open onClose={close} title={`Tải dữ liệu ${dataset.name}`} className="dataset-download"><form onSubmit={e=>{e.preventDefault();void download()}}>
    <p>Chọn khoảng {dateLabel} và bộ lọc cần tải. Để trống để lấy toàn bộ dữ liệu.</p>
    <div className="download-fields">
      <label>Từ ngày<DateInput aria-label="Từ ngày tải" value={draft.start} onValueChange={value=>set('start',value)}/></label>
      <label>Đến ngày<DateInput aria-label="Đến ngày tải" value={draft.end} onValueChange={value=>set('end',value)}/></label>
      {!['MSC_BID','MSC_YCBG'].includes(code) && <><label>Hoạt chất<input value={draft.ingredient} onChange={e=>set('ingredient',e.target.value)}/></label><label>Số đăng ký<input value={draft.registration} onChange={e=>set('registration',e.target.value)}/></label></>}
      <label>{['MSC_BID','MSC_YCBG'].includes(code)?'Tên gói / yêu cầu báo giá':'Tên thuốc'}<input value={draft.name} onChange={e=>set('name',e.target.value)}/></label>
      {!['MSC_BID','MSC_YCBG'].includes(code) && <label>Nhóm thầu<select value={draft.group} onChange={e=>set('group',e.target.value)}><option value="">Tất cả</option>{[1,2,3,4,5].map(n=><option key={n} value={code==='MSC_PRICE'?String(n):'N'+n}>Nhóm {n}</option>)}</select></label>}
      {code!=='DAV' && <label>Tỉnh / TP<input value={draft.province} onChange={e=>set('province',e.target.value)}/></label>}
      <label>Định dạng<select value={draft.format} onChange={e=>set('format',e.target.value)}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV (.csv)</option></select></label>
    </div>
    {!localMode && <p className="analytics-note">Tải tùy chỉnh tối đa 50.000 dòng. Bản đầy đủ tải trực tiếp từ Snapshot.</p>}
    {error && <ErrorNote>{error}</ErrorNote>}
    <div className="analytics-controls"><button type="submit" className="btn" disabled={busy}>{busy?`Đang tạo tệp${progress?' · '+progress+'%':''}…`:'Tải dữ liệu'}</button><button type="button" className="btn ghost" onClick={close}>{busy?'Hủy':'Đóng'}</button></div>
  </form></Dialog>
}
