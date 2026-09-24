/** Status tags for SĐK commercial classification (DAV). */

export const TAG_XANH = 'TAG_XANH_LA'
export const TAG_VANG = 'TAG_VANG_XAC_MINH'
export const TAG_CAM = 'TAG_CAM_CMO'
export const TAG_XAM = 'TAG_XAM_LICH_SU'

export const DEFAULT_TAG_CONFIGS = [
  {
    id: TAG_XANH,
    colorHex: '#22c55e',
    label: 'Sẵn sàng dự thầu',
    shortTitle: 'Đủ điều kiện thầu thương mại (TT 40/2025)',
    description: 'SĐK còn hạn > 18 tháng, chu kỳ cấp ~5 năm, pháp lý sạch, không khớp Danh mục 93 cấm nhập khẩu.',
    defaultChecked: true,
  },
  {
    id: TAG_VANG,
    colorHex: '#eab308',
    label: 'Cần xác minh / Hạn ngắn',
    shortTitle: 'Rủi ro kỹ thuật / Đang nộp gia hạn',
    description: 'SĐK hạn còn lại < 18 tháng, hoặc cấp kỳ hạn ~3 năm, hoặc đã nộp giấy tiếp nhận gia hạn. Dùng dóng dữ liệu ngoại, cân nhắc khi chào thầu.',
    defaultChecked: true,
  },
  {
    id: TAG_CAM,
    colorHex: '#f97316',
    label: 'Bẫy Danh mục 93 (CMO)',
    shortTitle: 'Khớp Danh mục 93 nội địa (TT 03/2024)',
    description: 'Trùng hoạt chất + hàm lượng + dạng bào chế với DM93 (≥3 cơ sở EU-GMP nội). Cấm hàng nhập khẩu chào thầu; cơ hội đặt gia công (CMO) trong nước.',
    defaultChecked: true,
  },
  {
    id: TAG_XAM,
    colorHex: '#64748b',
    label: 'Lịch sử / Đã hết hạn',
    shortTitle: 'SĐK đã hết hiệu lực / Thu hồi',
    description: 'SĐK đã dừng lưu hành hoặc bị thu hồi/xóa. Giữ để tra cứu tiền lệ cấp phép khi làm hồ sơ dóng quốc tế.',
    defaultChecked: true,
  },
]

const LS_LABELS = 'baoan.tagLabels.v1'
const LS_SELECTED = 'baoan.tagSelected.v1'

export function loadTagConfigs() {
  let labels = {}
  try { labels = JSON.parse(localStorage.getItem(LS_LABELS) || '{}') || {} } catch { /* ignore */ }
  return DEFAULT_TAG_CONFIGS.map((t) => ({
    ...t,
    label: labels[t.id] || t.label,
  }))
}

export function saveTagLabel(id, label) {
  let labels = {}
  try { labels = JSON.parse(localStorage.getItem(LS_LABELS) || '{}') || {} } catch { /* ignore */ }
  labels[id] = label
  localStorage.setItem(LS_LABELS, JSON.stringify(labels))
}

export function defaultSelectedTags() {
  try {
    const raw = localStorage.getItem(LS_SELECTED)
    if (raw) {
      const arr = JSON.parse(raw)
      // Legacy: only-green or empty → treat as "all tags" so search isn't silently limited
      if (Array.isArray(arr) && arr.length) {
        const all = DEFAULT_TAG_CONFIGS.map((t) => t.id)
        if (arr.length === 1 && arr[0] === TAG_XANH) return all
        return arr
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_TAG_CONFIGS.filter((t) => t.defaultChecked).map((t) => t.id)
}

export function persistSelectedTags(ids) {
  try { localStorage.setItem(LS_SELECTED, JSON.stringify(ids)) } catch { /* ignore */ }
}

export function tagById(id, configs = DEFAULT_TAG_CONFIGS) {
  return configs.find((t) => t.id === id) || null
}

/** Client-side classify for static exports missing tagId. */
export function classifySdkTagClient(row) {
  if (row.tagId) return row.tagId
  const now = Date.now()
  const end = row.ngayHetHan ? Date.parse(String(row.ngayHetHan).slice(0, 19)) : NaN
  const expired = row.isHetHan || (Number.isFinite(end) && end < now)
  if (row.isDeleted || row.isDaRut || expired || row.isActive === false) return TAG_XAM
  if (row.dm93 === 'match') return TAG_CAM
  const ky = row.kyCapNam != null ? Number(row.kyCapNam) : null
  let months = row.monthsLeft
  if (months == null && Number.isFinite(end)) {
    months = (end - now) / (30.4375 * 24 * 3600 * 1000)
  }
  const pending = !!row.hasGiaHanPending
  const cycle3 = ky != null && ky >= 2.5 && ky < 4
  const cycle5 = ky != null && ky >= 4.5 && ky <= 6
  const short = months != null && months < 18
  if (short || cycle3 || pending) return TAG_VANG
  if (months != null && months >= 18 && cycle5 && row.dm93 !== 'match' && (row.hoatChat || '').trim()) {
    return TAG_XANH
  }
  return TAG_VANG
}

export function enrichRowTag(row) {
  const tagId = classifySdkTagClient(row)
  return { ...row, tagId }
}
