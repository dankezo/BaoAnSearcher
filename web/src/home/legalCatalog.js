import { fold } from '../../../lib/regulatory/domain.js'

export const LEGAL_FILTERS = [
  ['all', 'Tất cả'],
  ['active', 'Đang hiệu lực'],
  ['transitional', 'Đang chuyển giao'],
  ['draft', 'Dự thảo'],
]

export const LEGAL_STATUS = {
  active: 'Đang hiệu lực',
  transitional: 'Đang chuyển giao',
  draft: 'Dự thảo',
}

/** Orientation cards. Official text still has to be checked before a bid decision. */
export const LEGAL_CORE = [
  {
    id: 'tt-40-2025',
    number: '40/2025/TT-BYT',
    title: 'Thông tư 40/2025/TT-BYT',
    issued: '2025-10-25',
    status: 'active',
    excerpt: 'Quy định đấu thầu thuốc tại cơ sở y tế công lập: phân nhóm 1–5, nguyên tắc gộp phần thầu và điều khoản chuyển tiếp. Cần đọc phụ lục và thời điểm áp dụng trước khi sửa hồ sơ.',
  },
  {
    id: 'nd-214-2025',
    number: '214/2025/NĐ-CP',
    title: 'Nghị định 214/2025/NĐ-CP',
    issued: '',
    status: 'active',
    excerpt: 'Quy định chi tiết thi hành Luật Đấu thầu, gồm ưu đãi thuốc sản xuất trong nước và các điều về lựa chọn nhà thầu. Đối chiếu Điều liên quan trước khi kết luận hồ sơ.',
  },
  {
    id: 'tt-79-2025',
    number: '79/2025/TT-BTC',
    title: 'Thông tư 79/2025/TT-BTC',
    issued: '',
    status: 'active',
    excerpt: 'Mẫu hồ sơ mời thầu điện tử và hướng dẫn bảo đảm dự thầu. Dùng khi kiểm tra E-HSMT và thư bảo lãnh, không thay cho văn bản chuyên môn của Bộ Y tế.',
  },
  {
    id: 'tt-12-2025',
    number: '12/2025/TT-BYT',
    title: 'Thông tư 12/2025/TT-BYT',
    issued: '',
    status: 'active',
    excerpt: 'Đăng ký lưu hành thuốc, thuốc gia công và hồ sơ gia hạn số đăng ký. Ảnh hưởng hồ sơ pháp lý của mô hình MAH đặt gia công.',
  },
  {
    id: 'tt-37-2024',
    number: '37/2024/TT-BYT',
    title: 'Thông tư 37/2024/TT-BYT',
    issued: '',
    status: 'active',
    excerpt: 'Nguyên tắc, tiêu chí và điều kiện thanh toán thuốc BHYT. Phần cơ chế chi trả thay thế Thông tư 20/2022; danh mục hoạt chất vẫn phải đối chiếu văn bản danh mục đang dùng.',
  },
  {
    id: 'tt-20-2022',
    number: '20/2022/TT-BYT',
    title: 'Thông tư 20/2022/TT-BYT',
    issued: '2022-12-31',
    status: 'transitional',
    excerpt: 'Danh mục thuốc BHYT. Cơ chế chi trả đã chuyển sang Thông tư 37/2024. Bảng hoạt chất, hàm lượng và tuyến viện vẫn tra cứu chuyển tiếp đến khi có thông tư danh mục mới.',
  },
  {
    id: 'tt-03-2024',
    number: '03/2024/TT-BYT',
    title: 'Thông tư 03/2024/TT-BYT',
    issued: '2024-04-16',
    status: 'transitional',
    excerpt: 'Danh mục thuốc sản xuất trong nước đạt EU-GMP thuộc diện không được chào nhập khẩu. Đang có dự thảo thay thế; vẫn phải đối chiếu hoạt chất, hàm lượng và dạng bào chế, không chỉ tên hoạt chất.',
  },
  {
    id: 'draft-bhyt',
    number: 'Dự thảo danh mục BHYT',
    title: 'Dự thảo Thông tư Danh mục thuốc BHYT mới',
    issued: '',
    status: 'draft',
    excerpt: 'Dự thảo bổ sung hoạt chất và điều chỉnh tỷ lệ thanh toán. Chưa phải văn bản áp dụng. Theo dõi để chuẩn bị danh mục, không sửa giá thầu theo dự thảo.',
  },
  {
    id: 'draft-be',
    number: 'Dự thảo phụ lục BE',
    title: 'Dự thảo Phụ lục BE mới',
    issued: '',
    status: 'draft',
    excerpt: 'Dự thảo bổ sung hoạt chất bắt buộc nghiên cứu tương đương sinh học. Bảo An không làm BE; dùng để loại phần thầu không thuộc định hướng Nhóm 2 SRA/EU-GMP và Nhóm 4 ngách.',
  },
]

function hasWord(hay, word) {
  if (/^\d+$/.test(word)) return new RegExp(`(?:^|\\D)${word}(?:\\D|$)`).test(hay)
  return hay.includes(word)
}

export function filterLegal(docs, { query = '', status = 'all' } = {}) {
  const words = fold(query).split(/[^a-z0-9]+/).filter(Boolean)
  return docs.filter(doc => {
    if (status !== 'all' && doc.status !== status) return false
    if (!words.length) return true
    const hay = fold(`${doc.number} ${doc.title} ${doc.excerpt}`)
    return words.every(word => hasWord(hay, word))
  })
}
