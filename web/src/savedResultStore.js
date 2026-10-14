import { getSupabase } from './supabaseClient'
import { exportXlsx, xmlEsc } from './export'
import { numberValue, formatNumber } from './numbers'
import { reportColumns, rowValues } from './tenderReport/model.mjs'
import { exportTenderReportToExcel } from './tenderReport/export.mjs'

export const RESULT_SOURCES = { dav:'DAV', vss:'VSS BHYT', msc_prices:'MSC · Đơn giá', msc_tenders:'MSC · Gói thầu', tender:'Thống kê thầu BHYT', analytics:'Phân tích tổng hợp', map:'Bản đồ thị trường' }
const MAX_BYTES = 8 * 1024 * 1024
export function validateSnapshot(snapshot) {
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.rows) || !snapshot.rows.length || !Array.isArray(snapshot.columns) || !snapshot.columns.length) throw new Error('Không có kết quả hợp lệ để lưu.')
  if (snapshot.rows.length > 50000 || new Blob([JSON.stringify(snapshot)]).size > MAX_BYTES) throw new Error('Kết quả quá lớn để lưu. Thu hẹp bộ lọc hoặc chọn các dòng cần lưu; dữ liệu chưa được lưu một phần.')
  return snapshot
}
export function tableSnapshot(title, columns, rows, filters) {
  return { version:1, kind:'table', title, filters, columns:columns.map(column=>Object.fromEntries(['key','label','width','align','nowrap','truncateAt','sum'].filter(key=>column[key]!=null).map(key=>[key,column[key]]).concat(column.numeric||column.sum?[['numeric',true]]:[]))), rows:rows.map(row=>({...row,...Object.fromEntries(columns.map(col=>[col.key,col.exportValue?col.exportValue(row):col.numeric?numberValue(row[col.key],col.vietnamese===true):col.text?col.text(row):row[col.key]??null]))})) }
}
export function tenderSnapshot(blocks) {
  let index=0
  return { version:1, kind:'tender', title:blocks[0]?.query.source==='msc'?'Thống kê thầu MSC':'Thống kê thầu BHYT', filters:blocks.map(block=>block.query), blocks,
    columns:reportColumns.map((label,i)=>({key:String(i),label})), rows:blocks.flatMap(block=>block.rows.flatMap(row=>row.children.map(product=>Object.fromEntries(rowValues(row,product,++index).map((value,i)=>[String(i),value]))))) }
}
async function account(expectedUser) {
  const client=getSupabase()
  if (!client) throw new Error('Chưa cấu hình lưu theo tài khoản.')
  const {data,error}=await client.auth.getSession()
  if (error) throw error
  const user=data.session?.user
  if (!user || expectedUser && user.id!==expectedUser) throw new Error('Phiên tài khoản đã thay đổi. Đăng nhập lại trước khi lưu.')
  return {client,user}
}
export async function saveResult(source,name,snapshot,expectedUser) {
  validateSnapshot(snapshot)
  if (!RESULT_SOURCES[source] || !name.trim() || name.trim().length>100) throw new Error('Tên kết quả cần từ 1 đến 100 ký tự.')
  const {client,user}=await account(expectedUser)
  const {data,error}=await client.from('user_saved_results').insert({user_id:user.id,source,name:name.trim(),row_count:snapshot.rows.length,snapshot}).select('id,name,source,row_count,created_at').single()
  if (error) throw error
  return data
}
export async function listResults(page=0,expectedUser) {
  const {client,user}=await account(expectedUser)
  const {data,error}=await client.from('user_saved_results').select('id,name,source,row_count,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).order('id',{ascending:false}).range(page*20,page*20+20)
  if (error) throw error
  return {items:data.slice(0,20),hasMore:data.length>20}
}
export async function loadResult(id,expectedUser) {
  const {client,user}=await account(expectedUser)
  const {data,error}=await client.from('user_saved_results').select('*').eq('user_id',user.id).eq('id',id).single()
  if (error) throw error
  validateSnapshot(data.snapshot)
  return data
}
export async function deleteResult(id,expectedUser) {
  const {client,user}=await account(expectedUser)
  const {data,error}=await client.from('user_saved_results').delete().eq('user_id',user.id).eq('id',id).select('id')
  if (error) throw error
  if (!data.length) throw new Error('Kết quả không còn tồn tại hoặc không thuộc tài khoản này.')
}
export function exportSavedExcel(result) {
  const snapshot=result.snapshot
  if (snapshot.kind==='tender') return exportTenderReportToExcel(snapshot.blocks,snapshot.blocks.length>1,true)
  exportXlsx({columns:snapshot.columns,rows:snapshot.rows,getValue:(row,col)=>row[col.key],filename:result.name,sheetName:'Ket_qua',extraSheets:[{name:'Bo_loc',columns:[{key:'key',label:'Thuộc tính'},{key:'value',label:'Giá trị'}],rows:[{key:'Lưu lúc',value:result.created_at},{key:'Nguồn',value:RESULT_SOURCES[result.source]},{key:'Bộ lọc',value:JSON.stringify(snapshot.filters)}],getValue:(row,col)=>row[col.key]}]})
}
export function savedPrintHtml(result) {
  const {snapshot}=result
  if (snapshot.html && typeof DOMParser!=='undefined') {
    const document=new DOMParser().parseFromString(snapshot.html,'text/html')
    document.querySelectorAll('script,iframe,object,embed,form,base,link,meta[http-equiv],foreignObject').forEach(node=>node.remove())
    document.querySelectorAll('*').forEach(node=>{for(const attr of [...node.attributes])if(/^on/i.test(attr.name)||['href','xlink:href','srcdoc'].includes(attr.name))node.removeAttribute(attr.name)})
    const policy=document.createElement('meta');policy.httpEquiv='Content-Security-Policy';policy.content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";document.head.prepend(policy)
    const caption=document.createElement('p');caption.textContent=`${result.name} · Lưu lúc ${new Date(result.created_at).toLocaleString('vi-VN')}`;document.body.prepend(caption)
    return '<!doctype html>'+document.documentElement.outerHTML
  }
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${xmlEsc(result.name)}</title><style>body{font:12px Arial;color:#183343;margin:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd5db;padding:5px;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}p{overflow-wrap:anywhere}@page{size:A4 landscape;margin:10mm}</style></head><body><h1>${xmlEsc(result.name)}</h1><p>${xmlEsc(RESULT_SOURCES[result.source])} · ${snapshot.rows.length} ${snapshot.kind==='tender'?'dòng sản phẩm':'dòng'} · Lưu lúc ${xmlEsc(new Date(result.created_at).toLocaleString('vi-VN'))}</p><p>Bộ lọc: ${xmlEsc(JSON.stringify(snapshot.filters))}</p><table><thead><tr>${snapshot.columns.map(col=>`<th>${xmlEsc(col.label)}</th>`).join('')}</tr></thead><tbody>${snapshot.rows.map(row=>`<tr>${snapshot.columns.map(col=>`<td>${xmlEsc(col.numeric?formatNumber(row[col.key]):row[col.key]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`
}
export function printSavedResult(result) {
  const preview=window.open('','_blank')
  if (!preview) throw new Error('Cho phép cửa sổ mới để mở bản in / PDF.')
  preview.document.open();preview.document.write(savedPrintHtml(result));preview.document.close()
  preview.document.fonts.ready.then(()=>{preview.focus();preview.print()})
}
