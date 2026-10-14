import { publicLines, packageMatchFromLines } from './scopeMatch.js'
import { fold } from './turso.js'

const unpack = (value, fallback) => typeof value === 'string' ? JSON.parse(value) : value ?? fallback
const words = (value, needle) => fold(needle).split(/\s+/).filter(Boolean).every(word => fold(value).includes(word))
const oneOf = (value, needles) => !needles?.length || (Array.isArray(needles) ? needles : [needles]).some(needle => words(value, needle))
const group = value => (fold(value).trim().match(/^(?:nhom|group|n)?\s*([1-5])$/)||[])[1] || ''

export function quoteRow(record, now = new Date()) {
  const row = { ...unpack(record.normalized, {}) }
  const close = String(row.close_date || '').slice(0,19)
  const vnNow = new Date(now.getTime()+7*3600_000).toISOString().slice(0,19)
  row.status_label = row.cancel_reason || ['03','CANCEL'].includes(row.status_code) ? 'Đã hủy' : close ? close >= vnNow ? 'Chưa hết hạn nhận báo giá' : 'Đã hết hạn nhận báo giá' : 'Cần rà soát thời hạn'
  row.scope_lines = record.lots == null ? null : publicLines(unpack(record.lots, []))
  row.baoan_match = packageMatchFromLines(row.scope_lines || [])
  row.document_status = record.error ? `Lỗi tải hồ sơ: ${record.error}` : row.scope_lines?.length ? 'Đã tải danh mục' : record.lots != null ? 'Cần rà soát hồ sơ đính kèm' : 'Chưa tải hồ sơ'
  return row
}

export function quoteMatches(row, f = {}) {
  if (!words([row.tender_no,row.name,row.buyer,row.province,row.bid_name].join(' '),f.q||'')) return false
  if (['name','tender_no'].some(k => f[k] && !words(row[k]||'',f[k]))) return false
  if (['buyer','province'].some(k => !oneOf(row[k]||'',f[k]))) return false
  const date = String(row.published||'').slice(0,10)
  if (f.publishedFrom && date < f.publishedFrom || f.publishedTo && date > f.publishedTo) return false
  const lines = row.scope_lines || []
  const hasLineFilters = f.ingredient || f.dosage_form || f.group_name?.length
  const groups = Array.isArray(f.group_name) ? f.group_name : f.group_name ? [f.group_name] : []
  if (hasLineFilters && !lines.some(line => words(line.name,f.ingredient||'') && words(line.form,f.dosage_form||'') && (!groups.length || groups.some(g=>group(g) && group(g)===group(line.group))))) return false
  return !(['exact','near'].includes(f.metricQuick) && row.baoan_match !== f.metricQuick || f.metricQuick==='open' && row.status_label!=='Chưa hết hạn nhận báo giá')
}

export async function searchQuotes(db, filters={}, page=0, size=100) {
  // ponytail: small YCBG corpus (about 1,200 requests); move line filters to SQL if it grows materially.
  const groups=Array.isArray(filters.group_name)?filters.group_name.length:filters.group_name
  const needsLines=!!(filters.ingredient||filters.dosage_form||groups||['exact','near'].includes(filters.metricQuick))
  const result = await db.query(needsLines?'SELECT normalized,lots,error FROM msc_ycbg':'SELECT normalized,error FROM msc_ycbg')
  const items = (result.rows||[]).map(row=>quoteRow(row)).filter(row=>quoteMatches(row,filters))
  items.sort((a,b)=>String(b.published||'').localeCompare(String(a.published||'')) || b.id.localeCompare(a.id))
  let selected=items.slice(page*size,(page+1)*size)
  if(!needsLines&&selected.length){
    const hydrated=await db.query('SELECT normalized,lots,error FROM msc_ycbg WHERE id IN ('+selected.map(()=>'?').join(',')+')',selected.map(row=>row.id))
    const byId=new Map((hydrated.rows||[]).map(row=>{const value=quoteRow(row);return [value.id,value]}))
    selected=selected.map(row=>byId.get(row.id)||row)
  }
  const registry = await db.query("SELECT total_records,DATE_FORMAT(last_synced_at,'%Y-%m-%dT%H:%i:%sZ') AS last_synced_at FROM data_registry_meta WHERE dataset_code='MSC_YCBG'")
  const meta=registry.rows?.[0]
  const checkpoints=await db.query("SELECT key_name,total_records FROM app_metadata WHERE key_name IN ('msc_ycbg_full_scan_complete','msc_ycbg_source_total')")
  const values=Object.fromEntries((checkpoints.rows||[]).map(row=>[row.key_name,Number(row.total_records)]))
  return {total:items.length,page,size,hasMore:items.length>(page+1)*size,items:selected,meta:{count:Number(meta?.total_records||0),updated:meta?.last_synced_at||null,fullScanComplete:values.msc_ycbg_full_scan_complete===1,sourceTotal:values.msc_ycbg_source_total||0}}
}
