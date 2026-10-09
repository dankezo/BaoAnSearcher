import { documents } from '../../web/src/regulatoryData.js'
import { searchText } from './domain.js'
import { checked } from './store.js'
export const sources = [
  { id: 'baochinhphu-health', name: 'Báo Chính phủ — Y tế', url: 'https://baochinhphu.vn/xa-hoi/y-te.htm', kind: 'html', official: 1 },
  { id: 'baochinhphu-policy', name: 'Báo Chính phủ — Chính sách mới', url: 'https://baochinhphu.vn/chinh-sach-va-cuoc-song/chinh-sach-moi.htm', kind: 'html', official: 1 },
  { id: 'baochinhphu-procurement', name: 'Báo Chính phủ — Đấu thầu và mua sắm tập trung', url: 'https://baochinhphu.vn/dau-thau.html', kind: 'html', official: 1, keywords: 'đấu thầu,lựa chọn nhà thầu,mua sắm tập trung,hồ sơ mời thầu,thỏa thuận khung,đàm phán giá' },
  { id: 'moh', name: 'Bộ Y tế', url: 'https://moh.gov.vn', kind: 'html', official: 1 },
  { id: 'dav', name: 'Cục Quản lý Dược', url: 'https://dav.gov.vn', kind: 'html', official: 1 },
  { id: 'tvpl', name: 'Thư viện Pháp luật — nguồn tham khảo', url: 'https://thuvienphapluat.vn', kind: 'html', official: 0 },
]
export const seedDocuments = documents.map(d => ({ id: d.id, title: d.title, code: d.code, category: ['BE', 'Đấu thầu', 'BHYT'].includes(d.topic) ? d.topic : 'Khác', summary: d.note, source_url: d.url, issued_at: d.issued || null, effective_at: d.effective || null, legal_status: d.id.startsWith('draft') ? 'draft' : 'unknown', reviewed_at: d.verified ? '2026-09-28' : null, review_source: d.verified ? d.url : '', review_note: d.status, origin: 'seed' }))
seedDocuments.find(d => d.id === 'tender2024').source_url = 'https://vanban.chinhphu.vn/?docid=210303&pageid=27160'
seedDocuments.find(d => d.id === 'be2022').summary += ' Danh mục dược chất phải thử tương đương sinh học.'
seedDocuments.push(
  { id: 'tt22-2024', code: '22/2024/TT-BYT', title: 'Thanh toán chi phí thuốc, thiết bị y tế trực tiếp cho người có thẻ BHYT', category: 'BHYT', summary: 'Quy định thanh toán trực tiếp thuốc, thiết bị y tế cho người có thẻ bảo hiểm y tế. Văn bản đã bị bãi bỏ; xem khoản 42 Điều 1 TT 47/2025/TT-BYT.', issued_at: '2024-10-18', effective_at: '2025-01-01', expires_at: '2026-02-15', legal_status: 'expired', source_url: 'https://chinhphu.vn/?classid=0&docid=211507&pageid=27160', reviewed_at: '2026-09-28', review_source: 'https://vbpl.vn/boyte/Pages/vbpq-toanvan.aspx?ItemID=185588', review_note: 'Ngày hiệu lực TT22: Cổng Chính phủ. Bãi bỏ toàn bộ theo khoản 42 Điều 1 TT47, hiệu lực 15/02/2026; đối chiếu thêm bài thông tin của Báo Chính phủ ngày 31/12/2025.', origin: 'seed' },
  { id: 'tt47-2025', code: '47/2025/TT-BYT', title: 'Bãi bỏ một số văn bản quy phạm pháp luật do Bộ trưởng Bộ Y tế ban hành, liên tịch ban hành', category: 'BHYT', summary: 'Danh sách văn bản bãi bỏ bao gồm TT 22/2024/TT-BYT. Dùng để kiểm tra lịch sử hiệu lực khi tra cứu thanh toán trực tiếp thuốc.', issued_at: '2025-12-30', effective_at: '2026-02-15', legal_status: 'unknown', source_url: 'https://vbpl.vn/boyte/Pages/vbpq-toanvan.aspx?ItemID=185588', reviewed_at: '2026-09-28', review_source: 'https://baochinhphu.vn/bai-bo-toan-bo-mot-phan-van-ban-quy-pham-phap-luat-linh-vuc-y-te-102251231101817322.htm', review_note: 'Đã xác minh thông tin bãi bỏ TT22 và ngày hiệu lực của bản ban hành; chưa rà soát toàn bộ sửa đổi sau đó.', origin: 'seed' },
  { id: 'law22-2023', code: '22/2023/QH15', title: 'Luật Đấu thầu', category: 'Đấu thầu', summary: 'Khung pháp luật về lựa chọn nhà thầu. Tra cứu cùng quy định nhóm thuốc đấu thầu và TT 40/2025. Phải đối chiếu các luật sửa đổi và văn bản hợp nhất trước khi áp dụng.', issued_at: '2023-06-23', effective_at: '2024-01-01', legal_status: 'unknown', source_url: 'https://vanban.chinhphu.vn/?pageid=27160&docid=208419&classid=1&orggroupid=1', reviewed_at: null, review_source: '', review_note: 'Chưa đối chiếu tình trạng hiệu lực toàn bộ và từng phần.', origin: 'seed' },
)
export async function seed(db) {
  await seedSources(db)
  for (const d of seedDocuments) {
    const row = { ...d, search_text: searchText(d), updated_at: '2026-09-28T00:00:00.000Z' }
    checked(await db.from('regulatory_documents').upsert(row, { onConflict: 'id', ignoreDuplicates: true }))
  }
  for (const [a, b, relation, reason] of [
    ['tt22-2024', 'tt47-2025', 'repealed_by', 'TT47 bãi bỏ TT22; đây là quan hệ hiệu lực.'],
    ['tt22-2024', 'tender2025', 'related', 'Liên quan quy trình cung ứng, đấu thầu thuốc; không phải văn bản thay thế TT22.'],
    ['tt22-2024', 'law22-2023', 'related', 'Tham khảo khung đấu thầu khi nghiên cứu thiếu thuốc và cung ứng.'],
    ['tender2025', 'law22-2023', 'related', 'Căn cứ chung về lựa chọn nhà thầu; kiểm tra các luật sửa đổi.'],
    ['be2022', 'tender2025', 'related', 'Liên quan chứng minh BE và phân nhóm thuốc trong hồ sơ thầu.'],
  ]) checked(await db.from('regulatory_relations').upsert({ document_id: a, related_id: b, relation, reason }, { onConflict: 'document_id,related_id', ignoreDuplicates: true }))
}

export async function seedSources(db){
  checked(await db.from('regulatory_sources').upsert(sources.map(s=>({...s,official:!!s.official,keywords:s.keywords||'đấu thầu thuốc,tương đương sinh học,BHYT thuốc,Thông tư BYT,biệt dược gốc,thu hồi thuốc'})),{onConflict:'id',ignoreDuplicates:true}))
  // Repair the original homepage default without replacing admin-selected URLs or schedules.
  checked(await db.from('regulatory_sources').update({url:sources.find(s=>s.id==='baochinhphu-procurement').url}).eq('id','baochinhphu-procurement').eq('url','https://baochinhphu.vn/').eq('kind','html'))
}
