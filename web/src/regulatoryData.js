export const REVIEW_DATE = '2026-09-28'
export const BE_SOURCE = 'https://datafiles.chinhphu.vn/cpp/files/vbpq/2022/09/07-byt.pdf'
export const BE_SCOPE = 'Phụ lục I, đối chiếu Điều 3–5 và Điều 14–15 TT 07/2022. Cần xét dạng bào chế, đường dùng, miễn thử và chuyển tiếp; không phải kết luận cho một sản phẩm cụ thể.'
export const beIngredients = [
  ['Amlodipin', 'Amlodipine'], ['Azithromycin', ''], ['Carbamazepin', 'Carbamazepine'],
  ['Cefixim', 'Cefixime'], ['Cefuroxim axetil', 'Cefuroxime axetil'], ['Clarithromycin', ''],
  ['Glibenclamid', 'Glibenclamide'], ['Gliclazid', 'Gliclazide'], ['Metformin', ''],
  ['Metoprolol', ''], ['Nifedipin', 'Nifedipine'], ['Rifampicin', ''],
  ['Amoxicilin + acid clavulanic', 'Amoxicillin clavulanate'], ['Carvedilol', ''],
  ['Cefpodoxim', 'Cefpodoxime'], ['Ezetimibe', ''], ['Irbesartan', ''],
  ['Itraconazol', 'Itraconazole'], ['Risperidon', 'Risperidone'], ['Rosuvastatin', ''],
  ['Simvastatin', ''], ['Sulpirid', 'Sulpiride'], ['Sultamicillin', ''],
  ['Telmisartan', ''], ['Valproat natri', 'Sodium valproate'], ['Fenofibrat', 'Fenofibrate'],
].map(([hoatChat, aliases], i) => ({ stt: i + 1, hoatChat, aliases, dangBaoChe: 'Xem phạm vi tại Điều 4–5', ghiChu: BE_SCOPE }))

// Verification describes what was actually inspected, not an assertion of completeness.
export const documents = [
  { id: 'be2022', code: '07/2022/TT-BYT', topic: 'BE', title: 'Thuốc phải thử tương đương sinh học và hồ sơ nghiên cứu BE', issued: '2022-09-05', effective: '2022-11-01', status: 'Đã đối chiếu bản ban hành', url: BE_SOURCE, note: '26 dược chất tại Phụ lục I (trang PDF 20). Điều 14 quy định lộ trình; cần kiểm tra văn bản sửa đổi trước khi áp dụng.', verified: true },
  { id: 'tender2025', code: '40/2025/TT-BYT', topic: 'Đấu thầu', title: 'Đấu thầu thuốc tại cơ sở y tế công lập', issued: '2025-10-25', effective: '2025-10-25', status: 'Đã đối chiếu nguồn chính thức', url: 'https://vbpl.vn/boyte/Pages/vbpq-vanbanlienquan.aspx?ItemID=183369&dvid=325', note: 'Nguồn CSDL quốc gia xác nhận số văn bản và ngày hiệu lực. Chưa xác nhận toàn bộ sửa đổi phát sinh đến ngày tra cứu.', verified: true },
  { id: 'dm93', code: '03/2024/TT-BYT', topic: 'Danh mục 93', title: 'Danh mục thuốc có ít nhất 03 hãng trong nước đáp ứng tiêu chí', issued: '2024-04-16', effective: '', status: 'Danh mục nội bộ cần đối chiếu', url: 'https://xaydungchinhsach.chinhphu.vn/4-thong-tu-thao-go-toi-da-bat-cap-mua-sam-dau-thau-thuoc-vat-tu-11924052512335546.htm', note: 'Tái sử dụng 93 dòng hiện có của Bảo An. Đã xác định căn cứ TT 03/2024; chưa đối chiếu từng dòng với bản ký và chưa xác nhận thay thế năm 2026.', verified: false },
  { id: 'tender2024', code: '07/2024/TT-BYT', topic: 'Đấu thầu', title: 'Văn bản đấu thầu thuốc năm 2024 — tra cứu lịch sử', issued: '2024-05-17', effective: '', status: 'Văn bản lịch sử', url: 'https://xaydungchinhsach.chinhphu.vn/4-thong-tu-thao-go-toi-da-bat-cap-mua-sam-dau-thau-thuoc-vat-tu-11924052512335546.htm', note: 'Đối chiếu TT 40/2025 và điều khoản chuyển tiếp khi xử lý hồ sơ cũ.', verified: false },
  { id: 'draft2026', code: 'Dự thảo thay thế TT 03/2024', topic: 'Danh mục 93', title: 'Hồ sơ lấy ý kiến danh mục thuốc trong nước năm 2026', issued: '', effective: '', status: 'Dự thảo', url: 'https://dav.gov.vn/images/upload_file/2026/2du-thao-thong-tu-lan-2_1777451974.pdf', note: 'Chỉ tham khảo. Không dùng dự thảo thay cho danh mục đã ban hành.', verified: false },
  { id: 'draft2021', code: 'Dự thảo BE 04/09/2021', topic: 'BE', title: 'Phụ lục BE do người dùng cung cấp', issued: '2021-09-04', effective: '', status: 'Dự thảo · chưa đọc được tệp', url: 'https://vibonline.com.vn/wp-content/uploads/2021/09/32-du-thao-phu-luc-thong-tu-be-04092021_1631063702.pdf', note: 'Tên tệp xác định đây là dự thảo. Không nhập làm danh mục bắt buộc; danh mục tra cứu sử dụng bản TT 07/2022 chính thức.', verified: false },
]

export function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
export function searchRows(rows, query) {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  return rows.filter(row => words.every(word => normalize(Object.values(row).join(' ')).includes(word)))
}
