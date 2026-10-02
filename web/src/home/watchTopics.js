import { resolveBidStatusFromRow } from '../bidStatus.js'
import { REGION_ORDER, regionOf } from '../mapGeo.js'
import { VN_PROVINCES, provinceNameFromCode } from '../vnProvinces.js'
import { classifyTender } from './tenderRadar.js'

export const WATCH_KEY = 'home.watchTopics'

export const WATCH_STATUSES = [
  ['open', 'Đang mời thầu'],
  ['review', 'Đang xét thầu'],
  ['won', 'Có nhà thầu trúng thầu'],
  ['cancelled', 'Đã hủy TBMT'],
]

export const PROVINCE_NAMES = Object.values(VN_PROVINCES).sort((a, b) => a.localeCompare(b, 'vi'))

const DRUG_PLACE = ['ingredient', 'strength', 'form', 'region', 'province', 'company', 'contractor']

const REGION_BY_NAME = new Map()
for (const [code, name] of Object.entries(VN_PROVINCES)) {
  const region = regionOf(code)
  if (region) REGION_BY_NAME.set(fold(name), region)
}

function fold(text) {
  return String(text ?? '').toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function hasWords(haystack, needle) {
  const n = fold(needle).trim()
  if (!n) return true
  const h = fold(haystack)
  return n.split(/\s+/).every(word => h.includes(word))
}

function linesOf(row) {
  return Array.isArray(row?.scope_lines) ? row.scope_lines : []
}

function ingredientBlob(row) {
  return [row?.ingredient, ...linesOf(row).map(line => line?.name)].filter(Boolean).join(' ')
}

function strengthBlob(row) {
  return [row?.strength, row?.hamLuong, ...linesOf(row).map(line => line?.strength)].filter(Boolean).join(' ')
}

function formBlob(row) {
  return [row?.dosage_form, row?.form, ...linesOf(row).map(line => line?.form)].filter(Boolean).join(' ')
}

function companyBlob(row) {
  return [row?.buyer, row?.manufacturer, row?.company].filter(Boolean).join(' ')
}

function contractorBlob(row) {
  return [row?.winner, row?.contractor, row?.nhaThau].filter(Boolean).join(' ')
}

export function regionOfPlace(province) {
  const raw = String(province || '').trim()
  if (!raw) return ''
  if (REGION_ORDER.includes(raw)) return raw
  const named = provinceNameFromCode(raw)
  return REGION_BY_NAME.get(fold(named || raw)) || regionOf(raw) || ''
}

export function statusLabel(key) {
  return WATCH_STATUSES.find(([id]) => id === key)?.[1] || String(key || '')
}

export function emptyDraft() {
  return {
    ingredient: false,
    strength: false,
    form: false,
    region: false,
    province: false,
    company: false,
    contractor: false,
    status: false,
    sdk: false,
    ingredientText: '',
    strengthText: '',
    formText: '',
    regionValue: '',
    provinceValue: '',
    companyText: '',
    contractorText: '',
    statusValue: 'open',
    sdkText: '',
  }
}

export function criteriaFromDraft(draft) {
  const criteria = {}
  if (draft?.ingredient && String(draft.ingredientText || '').trim()) criteria.ingredient = draft.ingredientText.trim()
  if (draft?.strength && String(draft.strengthText || '').trim()) criteria.strength = draft.strengthText.trim()
  if (draft?.form && String(draft.formText || '').trim()) criteria.form = draft.formText.trim()
  if (draft?.region && draft.regionValue) criteria.region = draft.regionValue
  if (draft?.province && draft.provinceValue) criteria.province = draft.provinceValue
  if (draft?.company && String(draft.companyText || '').trim()) criteria.company = draft.companyText.trim()
  if (draft?.contractor && String(draft.contractorText || '').trim()) criteria.contractor = draft.contractorText.trim()
  if (draft?.status && draft.statusValue) criteria.status = draft.statusValue
  if (draft?.sdk && String(draft.sdkText || '').trim()) criteria.sdkIngredient = draft.sdkText.trim()
  return criteria
}

export function hasCriteria(criteria) {
  return Object.values(criteria || {}).some(value => String(value || '').trim())
}

export function mergeCriteria(base, extra) {
  const next = { ...(base || {}) }
  for (const [key, value] of Object.entries(extra || {})) {
    if (String(value || '').trim()) next[key] = value
  }
  return next
}

export function dropCriterion(criteria, key) {
  const next = { ...(criteria || {}) }
  delete next[key]
  return next
}

export function cleanTopicName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

export function defaultTopicName(criteria, index = 1) {
  const ingredient = String(criteria?.ingredient || '').trim()
  if (ingredient) return cleanTopicName(ingredient) || `Tiêu chí ${index}`
  const first = criterionEntries(criteria)[0]?.value
  if (String(first || '').trim()) return cleanTopicName(first)
  const n = Number(index) > 0 ? Number(index) : 1
  return `Tiêu chí ${n}`
}

export function topicSentence(criteria) {
  const c = criteria || {}
  const bits = []
  if (c.contractor) bits.push(`Nhà thầu ${c.contractor}`)
  const drug = []
  if (c.ingredient) drug.push(`hoạt chất ${c.ingredient}`)
  if (c.form) drug.push(`dạng ${c.form}`)
  if (c.strength) drug.push(`hàm lượng ${c.strength}`)
  if (drug.length) bits.push(`gói mới gồm ${drug.join(', ')}`)
  const place = [c.region, c.province].filter(Boolean)
  if (place.length) bits.push(`ở ${place.join(' / ')}`)
  if (c.company) bits.push(`công ty ${c.company}`)
  if (c.status) bits.push(`trạng thái ${statusLabel(c.status)}`)
  if (c.sdkIngredient) bits.push(`SĐK mới theo hoạt chất ${c.sdkIngredient}`)
  return bits.join(' · ')
}

export function criterionEntries(criteria) {
  const order = ['contractor', 'ingredient', 'form', 'strength', 'region', 'province', 'company', 'status', 'sdkIngredient']
  const labels = {
    contractor: 'Nhà thầu',
    ingredient: 'Hoạt chất',
    form: 'Dạng bào chế',
    strength: 'Hàm lượng',
    region: 'Khu vực',
    province: 'Tỉnh',
    company: 'Công ty',
    status: 'Trạng thái',
    sdkIngredient: 'SĐK mới',
  }
  return order
    .filter(key => String(criteria?.[key] || '').trim())
    .map(key => ({
      key,
      label: labels[key],
      value: key === 'status' ? statusLabel(criteria[key]) : criteria[key],
    }))
}

export function normalizeTopics(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(item => item && typeof item.id === 'string' && item.criteria && typeof item.criteria === 'object' && hasCriteria(item.criteria))
    .map((item, index) => ({
      id: item.id,
      name: cleanTopicName(item.name) || defaultTopicName(item.criteria, index + 1),
      criteria: item.criteria,
    }))
}

export function newWatchId() {
  return `watch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function rowMatches(row, criteria) {
  if (criteria.ingredient && !hasWords(ingredientBlob(row), criteria.ingredient)) return false
  if (criteria.strength && !hasWords(strengthBlob(row), criteria.strength)) return false
  if (criteria.form && !hasWords(formBlob(row), criteria.form)) return false
  if (criteria.province && !hasWords(row?.province || '', criteria.province)) return false
  if (criteria.region) {
    const place = regionOfPlace(row?.province) || regionOfPlace(row?.region)
    if (place !== criteria.region) return false
  }
  if (criteria.company && !hasWords(companyBlob(row), criteria.company)) return false
  if (criteria.contractor && !hasWords(contractorBlob(row), criteria.contractor)) return false
  if (criteria.status && resolveBidStatusFromRow(row).key !== criteria.status) return false
  return true
}

function missingNote(criteria, rows) {
  if (criteria.ingredient && !rows.some(row => ingredientBlob(row).trim())) {
    return 'Đã lưu hoạt chất. Trang đã tải chưa có trường hoạt chất để đếm.'
  }
  if (criteria.strength && !rows.some(row => strengthBlob(row).trim())) {
    return 'Đã lưu hàm lượng. Trang đã tải chưa có trường hàm lượng để đếm.'
  }
  if (criteria.form && !rows.some(row => formBlob(row).trim())) {
    return 'Đã lưu dạng bào chế. Trang đã tải chưa có trường dạng bào chế để đếm.'
  }
  if (criteria.province && !rows.some(row => String(row?.province || '').trim())) {
    return 'Đã lưu tỉnh. Trang đã tải chưa có trường tỉnh để đếm.'
  }
  if (criteria.region) {
    const places = rows.map(row => row?.province).filter(Boolean)
    if (!places.length) return 'Đã lưu khu vực. Trang đã tải chưa có tỉnh để suy ra khu vực.'
    if (!places.some(place => regionOfPlace(place))) return 'Đã lưu khu vực. Chưa suy ra khu vực từ tên tỉnh đã tải.'
  }
  if (criteria.company && !rows.some(row => companyBlob(row).trim())) {
    return 'Đã lưu công ty. Trang đã tải chưa có bên mời thầu hoặc nhà sản xuất để đếm.'
  }
  if (criteria.contractor && !rows.some(row => contractorBlob(row).trim())) {
    return 'Đã lưu nhà thầu. Trang đã tải chưa có trường nhà thầu để đếm.'
  }
  return ''
}

export function countTopic(criteria, rows = [], now = Date.now(), { capped = false } = {}) {
  const c = criteria || {}
  const tenderKeys = [...DRUG_PLACE, 'status'].filter(key => String(c[key] || '').trim())
  if (!tenderKeys.length) {
    return {
      kind: 'stored',
      live: null,
      rows: [],
      note: c.sdkIngredient
        ? 'Đã lưu tiêu chí SĐK mới. Chưa đếm số đăng ký trên trang chủ.'
        : '',
    }
  }
  const missing = missingNote(c, rows)
  if (missing) return { kind: 'missing', live: null, rows: [], note: missing }
  const pool = DRUG_PLACE.some(key => c[key])
    ? rows.filter(row => classifyTender(row, now).fresh)
    : rows
  const matched = pool.filter(row => rowMatches(row, c))
  const bits = [capped ? 'Đếm trên trang đã tải, danh sách còn trang tiếp.' : 'Đếm trên trang đã tải.']
  if (c.sdkIngredient) bits.push('SĐK mới chỉ lưu tiêu chí, chưa đếm trên trang chủ.')
  return { kind: 'live', live: matched.length, rows: matched, note: bits.join(' ') }
}
