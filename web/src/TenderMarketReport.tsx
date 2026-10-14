import { useEffect, useRef, useState, Fragment } from 'react'
import { ChevronDown, ChevronRight, FileDown, FileText, Search, Trash2 } from 'lucide-react'
import { DataTable, SuggestField } from './components'
import { api } from './api'
import { cloudSuggest } from './supabaseCloud'
import { request } from './analytics/client'
import { Dialog } from './analytics/ui'
import DateInput from './DateInput'
import SaveResultButton from './SaveResultButton'
import { tenderSnapshot } from './savedResultStore'
import { buildReport, reportColumns, rowValues, reportHistory, blockColors } from './tenderReport/model.mjs'
import { exportTenderReportToExcel } from './tenderReport/export.mjs'
import type { ReportQuery, StackQueryBlock, TenderMasterRow, TenderProductDetail, TenderPackageDetail } from './tenderReport/types'
import './analytics/analytics.css'
import './tenderReport/report.css'

const initial:ReportQuery={keyword:'',searchField:'ingredient',ingredient:'',name:'',registration:'',start:'2025-06-01',end:'2026-10-01',group:'',strength:'',form:'',composition:'all'}
const number=(value:number|null)=>value==null?'—':value.toLocaleString('vi-VN',{maximumFractionDigits:3})
const day=(value:string)=>value?value.split('-').reverse().join('/'):'Chưa có ngày'
const money=(value:number|null)=>value==null?'Chưa đủ thành tiền':`${number(value)} đồng`
type InputRow={strength:string;dosageForm:string;[key:string]:unknown}

export default function TenderMarketReport({localMode,savedBlocks,source=savedBlocks?.[0]?.query.source||"vss"}:{localMode:boolean;savedBlocks?:StackQueryBlock[];source?:"vss"|"msc"}){
  const msc=source==="msc", sourceLabel=msc?"MSC":"BHYT", dateLabel=msc?"KQLCNT":"HĐ"
  const [draft,setDraft]=useState({...initial,source}),[stack,setStack]=useState(false),[blocks,setBlocks]=useState<StackQueryBlock[]>(savedBlocks||[])
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[expanded,setExpanded]=useState<Set<string>>(new Set()),[details,setDetails]=useState(false)
  const [history,setHistory]=useState<{block:StackQueryBlock;product?:TenderProductDetail;row?:TenderMasterRow}|null>(null)
  const [choices,setChoices]=useState<{strength:string[];form:string[]}>({strength:[],form:[]})
  const controller=useRef<AbortController|null>(null),sequence=useRef(0)
  useEffect(()=>()=>{controller.current?.abort()},[])
  const set=<K extends keyof ReportQuery>(key:K,value:ReportQuery[K])=>setDraft(previous=>({...previous,[key]:value}))
  const clear=()=>{sequence.current++;controller.current?.abort();setBusy(false);setBlocks([]);setExpanded(new Set());setHistory(null);setError('')}
  async function search(override?:Partial<ReportQuery>){
    const q={...draft,...override}
    const fields=(['ingredient','name','registration'] as const).filter(key=>q[key]?.trim())
    if(!fields.length || fields.some(key=>(q[key]||'').trim().length<3)){setError('Nhập ít nhất 3 ký tự vào ô cần tra cứu.');return}
    q.keyword=fields.map(key=>(q[key]||'').trim()).join(' · ');q.searchField=fields[0]
    if(!q.start || !q.end || q.start>q.end){setError('Chọn khoảng ngày hợp lệ.');return}
    const seq=++sequence.current;controller.current?.abort();const abort=new AbortController();controller.current=abort
    setDraft(q);setBusy(true);setError('');setHistory(null)
    try{
      const result:{items:InputRow[]}=localMode?await api.tenderReport(q,abort.signal):await request('/api/tender/report',q,abort.signal)
      if(seq!==sequence.current)return
      setChoices({strength:[...new Set(result.items.map(item=>item.strength).filter(Boolean))].sort(),form:[...new Set(result.items.map(item=>item.dosageForm).filter(Boolean))].sort()})
      const block=buildReport(result.items,q) as StackQueryBlock
      if(!stack)setExpanded(new Set())
      setBlocks(previous=>{
        if(!stack)return [block]
        const found=previous.findIndex(item=>item.blockId===block.blockId)
        return found<0?[...previous,block]:previous.map((item,index)=>index===found?block:item)
      })
    }catch(e){if(seq===sequence.current)setError(e instanceof Error?e.message:'Chưa tải được báo cáo.')}
    finally{if(seq===sequence.current)setBusy(false)}
  }
  const toggle=(id:string)=>setExpanded(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next})
  const historyRows:TenderPackageDetail[]=history?reportHistory(history.block,history.product?.regNumber,history.product?.unit,history.row):[]
  const prices=historyRows.map(item=>item.unitPrice).filter((value):value is number=>value!=null)
  const historyQty=historyRows.some(item=>item.quantity==null)?null:historyRows.reduce((total,item)=>total+(item.quantity||0),0)
  const historyAmount=historyRows.some(item=>item.totalAmount==null)?null:historyRows.reduce((total,item)=>total+(item.totalAmount||0),0)
  const openHistory=(block:StackQueryBlock,row:TenderMasterRow,product?:TenderProductDetail)=>setHistory(product?.regNumber?{block,product}:{block,row:product?{...row,children:[product]}:row})
  function cells(block:StackQueryBlock,row:TenderMasterRow,product:TenderProductDetail|undefined,stt:number,child=false){
    return rowValues(row,product,stt,child).map((value,index)=>{
      const content=index>=12?number(value as number|null):String(value??'')
      return <td key={index} data-label={reportColumns[index]} data-empty={index!==9&&(value===''||value==null)||undefined} className={index>=12?'report-number':''}>
        {index===9?<div className="report-product-actions">
          {!child&&row.productCount>1?<button className="report-expand" onClick={()=>toggle(block.blockId+row.id)} aria-expanded={expanded.has(block.blockId+row.id)} aria-label={`Chi tiết ${row.ingredient} ${row.strength}, nhóm ${row.group}`}>{row.productCount}{expanded.has(block.blockId+row.id)?<ChevronDown size={15}/>:<ChevronRight size={15}/>}</button>:content}
          <details className="report-product-info"><summary>Thông tin thuốc</summary><dl>{[['Dạng dùng',row.route],['Dạng bào chế',row.dosageForm],...(product?[['Công ty đăng ký',product.registrationCompany],['Nhà sản xuất',product.manufacturer],['Nước',product.country]]:[])].map(([label,value])=><Fragment key={label}><dt>{label}</dt><dd>{value||'—'}</dd></Fragment>)}</dl></details>
        </div>:index===4&&product?.regNumber?<button className="report-sdk" title="Lịch sử thầu theo SĐK trong kỳ" onClick={()=>setHistory({block,product})}>{content}<FileText size={14}/></button>:index===12?<span>{content}{row.unit&&<small> {row.unit}</small>}</span>:content}
      </td>
    })
  }
  let stt=0
  return <div className="analytics-app tender-report">
    {!savedBlocks&&<header className="analytics-heading"><div><h1>Thống kê thầu {sourceLabel}</h1><p>{msc?"Đơn giá thuốc trúng thầu MSC, đối chiếu hồ sơ đăng ký DAV.":"Sản phẩm ghi nhận trong VSS, đối chiếu hồ sơ đăng ký DAV."}</p></div></header>}
    {!savedBlocks&&<form className="analytics-filter" onSubmit={e=>{e.preventDefault();void search()}}>
      <div className="analytics-controls report-search-controls">
        {([{key:'ingredient',field:'hoatchat',label:'Hoạt chất',placeholder:'Lacidipin, Lisinopril…'},{key:'registration',field:'sodk',label:'Số đăng ký',placeholder:'Nhập SĐK đầy đủ'},{key:'name',field:'ten',label:'Tên thuốc',placeholder:'Nhập tên thuốc'}] as const).map(({key,field,label,placeholder})=><SuggestField key={key} label={label} value={draft[key]||''} onChange={value=>{set(key,value);set('strength','');set('form','')}} onSearch={value=>void search({[key]:value})} suggest={value=>localMode?msc?value.trim().length<3?Promise.resolve([]):api.mscSearch({kind:'prices',filters:{[key]:value},page:0,size:40}).then((result:{items?:Record<string,string>[]})=>[...new Set((result.items||[]).map(row=>row[key]).filter(Boolean))]):api.suggest('vss',field,value).then((result:{items?:string[]})=>result.items||[]):cloudSuggest(msc?'msc_prices':'vss',msc?key:field,value)} placeholder={placeholder}/>)}
        <label>Từ ngày {dateLabel}<DateInput aria-label={`Từ ngày ${dateLabel}`} required value={draft.start} onValueChange={(value:string)=>set('start',value)}/></label>
        <label>Đến ngày {dateLabel}<DateInput aria-label={`Đến ngày ${dateLabel}`} required value={draft.end} onValueChange={(value:string)=>set('end',value)}/></label>
      </div>
      <div className="analytics-controls">
        <label>Thành phần<select value={draft.composition} onChange={e=>set('composition',e.target.value as ReportQuery['composition'])}><option value="all">Đơn chất và phối hợp</option><option value="single">Đơn chất</option><option value="combination">Phối hợp</option></select></label>
        <label>Nhóm kỹ thuật<select value={draft.group} onChange={e=>set('group',e.target.value)}><option value="">Tất cả</option>{[1,2,3,4,5].map(group=><option key={group} value={group}>Nhóm {group}</option>)}</select></label>
        <label>Hàm lượng<select value={draft.strength} onChange={e=>set('strength',e.target.value)}><option value="">Tất cả</option>{choices.strength.map(value=><option key={value}>{value}</option>)}</select></label>
        <label>Dạng bào chế<select value={draft.form} onChange={e=>set('form',e.target.value)}><option value="">Tất cả</option>{choices.form.map(value=><option key={value}>{value}</option>)}</select></label>
        <label>Tuyến viện<select disabled title="Kho dữ liệu chưa có phân hạng bệnh viện"><option>Chưa có dữ liệu phân hạng</option></select></label>
        <button type="submit" className="btn" disabled={busy}><Search size={15}/>{busy?'Đang tổng hợp…':'Tìm kiếm'}</button>
        <button type="button" className="btn ghost" onClick={clear}><Trash2 size={15}/>Xóa bảng</button>
        <button type="button" className="btn ghost" disabled={!blocks.some(block=>block.rows.length)||busy} onClick={()=>exportTenderReportToExcel(blocks,stack,details)}><FileDown size={15}/>Xuất Excel chuẩn</button>
        <SaveResultButton source="tender" defaultName={`${sourceLabel} · ${blocks.map(block=>block.queryKeyword).join(' · ')}`} disabled={!blocks.some(block=>block.rows.length)||busy} getSnapshot={()=>tenderSnapshot(blocks)}/>
      </div>
      <div className="report-switches"><label><input type="checkbox" role="switch" checked={stack} disabled={busy} onChange={e=>setStack(e.target.checked)}/>Chế độ Stack kết quả</label><label><input type="checkbox" checked={details} onChange={e=>setDetails(e.target.checked)}/>Xuất kèm dòng chi tiết</label></div>
    </form>}
    {!savedBlocks&&<details className="analytics-note report-guide"><summary>Cách tính và bộ lọc</summary>Các ô tìm kiếm kết hợp bằng AND; để trống ô không dùng. Số lượng = lượng trúng thầu. Đơn giá = thấp nhất trong kỳ. Thành tiền = tổng thành tiền từng dòng. Kỳ tính theo {msc?"ngày đăng KQLCNT":"ngày bắt đầu HĐ"}; loại dòng thiếu ngày. {msc&&"Thành tiền mỗi dòng = đơn giá × số lượng."}</details>}
    {error && <p className="error-note" role="alert">{error}</p>}
    {!blocks.length && <div className="analytics-card">Tìm hoạt chất để xem các hàm lượng, dạng đơn chất và dạng phối hợp trong kỳ.</div>}
    {blocks.length>0 && <div className="analytics-card report-results" aria-busy={busy}>
      <div className="report-scroll report-card-view"><table><thead><tr>{reportColumns.map((label,index)=><th key={label} title={index===13?'Đơn giá trúng thấp nhất trong kỳ':index===14?'Tổng thành tiền từng dòng thầu':undefined}>{label}</th>)}</tr></thead><tbody>
        {blocks.map((block,index)=><Fragment key={block.blockId}>
          <tr className="report-block" style={{background:'#'+blockColors[index%blockColors.length]}}><td colSpan={15}><strong>{block.queryKeyword}</strong> · {day(block.query.start)} đến {day(block.query.end)} · {block.query.composition==='single'?'Đơn chất':block.query.composition==='combination'?'Phối hợp':'Đơn chất và phối hợp'}{block.query.group?` · Nhóm ${block.query.group}`:''}{block.query.strength?` · ${block.query.strength}`:''}{block.query.form?` · ${block.query.form}`:''} · <span className="analytics-help-wrap"><button type="button" className="report-line-count" aria-describedby={`lines-${index}`}>{block.lineCount} dòng thầu ⓘ</button><span id={`lines-${index}`} role="tooltip" className="analytics-tooltip">Số bản ghi {msc?"MSC":"VSS"} thuộc bộ lọc và kỳ này, mỗi dòng tính một lần. Một gói thầu có thể gồm nhiều dòng thuốc; đây không phải số gói thầu hoặc lượng đã bán.</span></span> · tổng <strong>{money(block.totalAmount)}</strong></td></tr>
          {!block.rows.length && <tr><td colSpan={15}>Không có kết quả theo bộ lọc của khối này.</td></tr>}
          {block.rows.map(row=>{const id=block.blockId+row.id,ordinal=++stt;return <Fragment key={row.id}>
            <tr style={{background:'#'+blockColors[index%blockColors.length]}} onDoubleClick={()=>openHistory(block,row,row.singleProduct)}>{cells(block,row,row.singleProduct,ordinal)}</tr>
            {expanded.has(id) && row.productCount>1 && row.children.map(product=><tr key={product.id} className="report-child" onDoubleClick={()=>openHistory(block,row,product)}>{cells(block,row,product,ordinal,true)}</tr>)}
          </Fragment>})}
        </Fragment>)}
      </tbody></table></div>
      <p className="analytics-note">Bấm số sản phẩm để mở chi tiết. Bấm SĐK hoặc nhấp đúp dòng sản phẩm để xem lịch sử. “—” là dữ liệu thiếu; công ty đăng ký lấy từ DAV.</p>
    </div>}
    <Dialog open={!!history} onClose={()=>setHistory(null)} title={history?`Lịch sử trúng thầu: ${history.product?history.product.brandName+' – SĐK '+history.product.regNumber:history.row?.ingredient+' · '+history.row?.strength+' · Nhóm '+history.row?.group}`:''} className="report-dialog">
      {history && <><p>{day(history.block.query.start)} đến {day(history.block.query.end)} theo bộ lọc của khối. Dữ liệu {msc?"MSC":"VSS"}; ngày bên dưới là {msc?"ngày KQLCNT":"ngày bắt đầu HĐ"}.</p><DataTable rows={historyRows} rowKey={(row:TenderPackageDetail)=>row.id} selectable={false} showIndex={false} filtersVisible={false} minWidth={850} cardKeys={['hospitalName','brandName','regNumber','procurementCode','province','quantity','unitPrice','totalAmount','winDate']} columns={[
        {key:'brandName',label:'Tên thuốc'}, {key:'regNumber',label:'SĐK'},
        {key:'procurementCode',label:'Mã TBMT / Gói thầu',render:(value:string)=>value||'Chưa có mã gói'},
        {key:'hospitalName',label:'Bên mời thầu / CSYT',render:(value:string)=>value||'Chưa có tên CSYT'},
        {key:'province',label:'Tỉnh / TP',render:(value:string)=>value||'—'},
        {key:'quantity',label:'Số lượng trúng',render:number,align:'right'},
        {key:'unitPrice',label:'Đơn giá trúng',render:number,align:'right'},
        {key:'totalAmount',label:'Thành tiền',render:number,align:'right'},
        {key:'bidGroup',label:'Nhóm TCKT',render:(value:string)=>value||'—'},
        {key:'winDate',label:msc?'Ngày KQLCNT':'Ngày bắt đầu HĐ',render:day},
      ]}/><p>{historyRows.length} dòng trúng thầu · Tổng lượng: {number(historyQty)} {history.product?.unit||history.row?.unit} · Tổng thành tiền: {money(historyAmount)} · Giá thấp nhất / cao nhất: {number(prices.length?Math.min(...prices):null)} / {number(prices.length?Math.max(...prices):null)} đồng.</p><p className="analytics-note">{msc?"Mỗi dòng MSC là một đầu thuốc trong kết quả lựa chọn nhà thầu.":"Kho VSS chưa đủ mã TBMT và ngày có kết quả để đếm chính xác số gói thầu."} Mỗi dòng là một bản ghi trúng thầu.</p></>}
    </Dialog>
  </div>
}
