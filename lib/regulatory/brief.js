import { createHash } from 'node:crypto'
import { fold } from './domain.js'
import { checked } from './store.js'
import { attachCatalogTouch } from './catalogTouch.js'

export const MODEL = 'gemini-3.1-flash-lite'
export const PROMPT_VERSION = 'tender-v6'
// A real quote does not establish that the model's inference follows from it.
// Keep a conservative fallback for unsupported tender eligibility/score claims.
// Scope is decided from the publisher's title/summary, before any AI score.
export function editorialRelevant(d) {
  const title=fold(d.title||''),text=fold(`${d.title||''} ${d.summary||''}`.replace(/\bthuộc\b/gi,' '))
  if (/xu ly rac|rac thai|quyen su dung dat|thu hoi dat|thuoc la|goi thau.*(xay dung|giao thong|cau duong)/.test(title)) return false
  if (/\bthuoc\b|duoc pham|cong ty duoc|luat duoc|duoc lieu|nganh duoc|kinh doanh duoc|phan phoi duoc|tuong duong sinh hoc|biet duoc goc|bhyt|bao hiem y te|ke don|thiet bi y te/.test(text)) return true
  // General tender law/policy can affect medicine procurement; sector-specific projects cannot.
  return /dau thau|lua chon nha thau|mua sam tap trung/.test(title) && /luat|nghi dinh|thong tu|quy dinh|chinh sach|hiep dinh|cptpp|evfta|ukvfta/.test(title)
}
export function attentionScore(d) {
  if (!editorialRelevant(d)) return 0
  const text=fold(`${d.title} ${d.summary}`),priority=d.insight?.priority||ruleInsight(d).priority
  const age=Date.now()-Date.parse(d.published_at||d.issued_at||'')
  if (priority>=95) return age>=0&&age<=14*86400000?100:60
  if (/gia (ban )?thuoc|kiem soat.*gia.*thuoc/.test(text)) return 95
  if (/ke don.*thuoc|thuoc.*ngoai tru|nhu cau.*thuoc/.test(text)) return 90
  if (/luat dau thau/.test(fold(d.title||''))) return 88
  if (/luat dau thau/.test(text)) return 82
  return Math.min(priority,75)
}
export function guardedInsight(d, insight) {
  if (!editorialRelevant(d)) return ruleInsight(d)
  if (insight?.method !== 'ai') return insight || ruleInsight(d)
  const inference = fold(`${insight.impact} ${insight.action}`)
  const conditional = /co the|neu |can |chua |phu thuoc/.test(fold(insight.impact))
  const unsupported = /du dieu kien.*(du thau|tham gia thau)|diem danh gia|diem nang luc|dam bao.*nguon cung|duy tri.*nguon cung|cam thau/.test(inference)
  if (!conditional || unsupported) return { ...ruleInsight(d), model: insight.model || MODEL }
  const medical=/\bthuoc\b|duoc pham|cong ty duoc|luat duoc|duoc lieu|nganh duoc/.test(fold(`${d.title} ${d.summary}`))
  return medical?insight:{...insight,priority:Math.min(insight.priority,ruleInsight(d).priority)}
}
export function fingerprint(d) {
  return createHash('sha256').update(JSON.stringify([PROMPT_VERSION, d.title, d.summary, d.code, d.issued_at, d.published_at, d.legal_status])).digest('hex')
}
export function ruleInsight(d) {
  const text = fold(`${d.title} ${d.summary}`.replace(/\bthuộc\b/gi, ' '))
  let priority = 25, reason = 'Thông tin ngành dược để theo dõi.', impact = 'Chưa đủ dữ kiện để xác định ảnh hưởng trực tiếp đến gói thầu.', action = 'Đọc văn bản gốc nếu có thuốc hoặc đối tác liên quan.'
  if (/thu hoi|dinh chi luu hanh|ngung luu hanh/.test(text)) {
    priority = 95; reason = 'Có thông tin thu hồi hoặc đình chỉ lưu hành.'; impact = 'Có thể ảnh hưởng danh mục chào thầu và khả năng giao hàng nếu đúng sản phẩm, lô hoặc đơn vị liên quan.'; action = 'Đối chiếu tên thuốc, số đăng ký và lô trong quyết định với hồ sơ thầu, hàng tồn và hợp đồng.'
  } else if (/dau thau|trung thau|nhom thuoc|tieu chi ky thuat|lua chon nha thau|mua sam tap trung|ho so moi thau|thoa thuan khung/.test(text)) {
    const medicine=/\bthuoc\b|duoc pham|cong ty duoc|luat duoc|duoc lieu|nganh duoc/.test(text)
    priority = medicine?85:70; reason = medicine?'Đề cập quy định hoặc danh mục dùng trong đấu thầu thuốc.':'Quy định hoặc thông tin đấu thầu chung cần theo dõi.'; impact = medicine?'Có thể thay đổi cách kiểm tra nhóm thầu và tài liệu chứng minh cho thuốc thuộc phạm vi văn bản.':'Có thể tác động quy trình lựa chọn nhà thầu hoặc mua sắm tập trung nếu thầu thuốc thuộc phạm vi áp dụng; chưa kết luận áp dụng cho gói cụ thể.'; action = 'Giao bộ phận thầu kiểm tra phạm vi, phụ lục, thời điểm áp dụng và điều khoản chuyển tiếp trước khi sửa hồ sơ.'
  } else if (/tuong duong sinh hoc|biet duoc goc|\bbe\b/.test(text)) {
    priority = 75; reason = 'Liên quan bằng chứng BE hoặc biệt dược gốc.'; impact = 'Có thể ảnh hưởng tài liệu chứng minh và phân nhóm dự thầu; chưa kết luận cho sản phẩm cụ thể.'; action = 'So khớp số đăng ký, dạng bào chế và tên thuốc trong danh mục công bố.'
  } else if (/bhyt|bao hiem y te|thanh toan/.test(text)) {
    priority = 65; reason = 'Liên quan phạm vi hoặc điều kiện thanh toán.'; impact = 'Có thể ảnh hưởng nhu cầu mua sắm và khả năng thanh toán của cơ sở y tế.'; action = 'Kiểm tra phạm vi, điều kiện thanh toán và văn bản đang có hiệu lực.'
  } else if (/gia (ban )?thuoc|kiem soat.*gia.*thuoc/.test(text)) {
    priority = 70; reason = 'Liên quan giá thuốc và quản lý chi phí cung ứng.'; impact = 'Có thể ảnh hưởng giá chào, kế hoạch mua sắm hoặc điều kiện cung ứng nếu thuốc thuộc phạm vi quy định.'; action = 'Đối chiếu phạm vi thuốc, cơ chế giá, thời điểm áp dụng và văn bản gốc trước khi sửa báo giá.'
  } else if (/ke don.*thuoc|thuoc.*ngoai tru|nhu cau.*thuoc/.test(text)) {
    priority = 65; reason = 'Liên quan kê đơn và nhu cầu sử dụng thuốc.'; impact = 'Có thể thay đổi nhu cầu cấp phát và kế hoạch cung ứng thuốc nếu chính sách được ban hành và áp dụng cho nhóm bệnh liên quan.'; action = 'Đối chiếu danh mục bệnh, thời điểm áp dụng và nhu cầu điều trị trước khi điều chỉnh dự báo mua sắm; đề xuất chưa phải quy định đã có hiệu lực.'
  } else if (/gia han|cap.*giay dang ky|dang ky luu hanh/.test(text)) {
    priority = 40; reason = 'Cập nhật giấy đăng ký lưu hành.'; impact = 'Ảnh hưởng hồ sơ pháp lý hoặc nguồn cung nếu có đúng thuốc doanh nghiệp đang chào thầu.'; action = 'Chỉ đưa vào xử lý khi phụ lục có số đăng ký hoặc nhà sản xuất liên quan.'
  }
  if (/xu phat.*(duoc|thuoc)/.test(text)) { priority=60; reason='Có quyết định xử phạt đơn vị trong lĩnh vực dược.'; impact='Cần kiểm tra hành vi và biện pháp khắc phục; xử phạt không tự đồng nghĩa bị cấm thầu.'; action='Đọc quyết định và đối chiếu đơn vị liên quan trong hồ sơ hoặc chuỗi cung ứng.' }
  if (/my pham|du toan ngan sach|quyet toan ngan sach/.test(text) && !/dau thau thuoc|thuoc chua benh/.test(text)) { priority=10; reason='Tin ngoài trọng tâm đấu thầu thuốc.'; impact='Chưa thấy căn cứ ảnh hưởng trực tiếp đến đấu thầu thuốc.'; action='Lưu tham khảo, không đưa vào nhóm cần xử lý.' }
  if (!editorialRelevant(d)) { priority=0;reason='Ngoài phạm vi thuốc và chính sách đấu thầu liên quan.';impact='Không đưa vào Bảng tin ngành dược.';action='Lưu ở kho nguồn để tra cứu nếu cần.' }
  if (d.legal_status === 'draft' || /du thao/.test(text)) { priority = Math.min(priority, 50); action = 'Theo dõi dự thảo và chuẩn bị góp ý; chưa áp dụng như quy định đã ban hành.' }
  return { document_id: d.id, input_hash: fingerprint(d), priority, reason, impact, action, evidence_quote: '', method: 'rules', model: '', generated_at: new Date().toISOString() }
}
export async function brief(db) {
  const cutoff = Date.now() - 90 * 86400000, cutoffDate = new Date(cutoff).toISOString().slice(0, 10)
  // Select recent publication and issue dates before limiting; an older legal archive
  // must not crowd out publisher news whose issue date is correctly left empty.
  const [published, issued, sources, runs] = await Promise.all([
    db.from('regulatory_documents').select('*').gte('published_at', cutoffDate).order('published_at', { ascending: false }).limit(150),
    db.from('regulatory_documents').select('*').or('origin.eq.crawl,source_id.not.is.null,published_at.not.is.null').gte('issued_at', cutoffDate).order('issued_at', { ascending: false }).limit(150),
    db.from('regulatory_sources').select('id,name,last_success,last_attempt,last_error,enabled').order('name'),
    db.from('regulatory_ai_runs').select('day,state,model,message,finished_at,reserved_usd').order('day', { ascending: false }).limit(1),
  ])
  const documents = [...new Map([...checked(published), ...checked(issued)].map(d => [d.id, d])).values()].map(({ content, ...document }) => document), sourceRows = checked(sources)
  const ids = documents.map(d => d.id)
  const insights = ids.length ? checked(await db.from('regulatory_insights').select('*').in('document_id', ids)) : []
  const items = documents.map(d => attachCatalogTouch({
    ...d,
    source_name: sourceRows.find(s => s.id === d.source_id)?.name,
    insight: guardedInsight(d, insights.find(i => i.document_id === d.id && i.input_hash === fingerprint(d))),
  }))
  for (const item of items) item.attention_score=attentionScore(item)
  const recent = items.filter(d => { const raw=d.published_at||d.issued_at||''; const t=Date.parse(raw.length===10?`${raw}T00:00:00+07:00`:raw); return editorialRelevant(d) && d.insight.priority>=30 && Number.isFinite(t) && t >= cutoff && t <= Date.now() })
  recent.sort((a,b) => b.attention_score - a.attention_score || b.insight.priority - a.insight.priority || String(b.published_at||b.issued_at).localeCompare(String(a.published_at||a.issued_at)))
  return { items: recent.slice(0, 30), total: recent.length, sources: sourceRows, ai: checked(runs)[0] || null }
}
