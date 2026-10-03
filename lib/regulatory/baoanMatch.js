/** Shared Bảo An tender eligibility engine (server, map, home and exports). */
import { DOSAGE_FORM_RULES, INGREDIENT_ALIASES, LEGAL_BASIS, SPECIAL_RELEASE_FORMS } from './matchPolicy.js'

const STRENGTH = /(\d+(?:[.,]\d+)?)\s*(mg|mcg|microgam|µg|μg|ug|g|ml|iu|ui|%)/gi
const RATIO = /(\d+(?:[.,]\d+)?)\s*(mg|mcg|microgam|µg|μg|ug|g)\s*\/\s*(\d+(?:[.,]\d+)?)?\s*ml/gi
const PAREN = /\([^)]*\)/g
const VITAMIN_CODE = /^(?:b\d{1,2}|d\d?|k\d?|[ace])$/

function fold(text) {
  return String(text ?? '').toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function compact(text) {
  return fold(text).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function normalizeIngredient(text) {
  return compact(text).split(' ').map(word => INGREDIENT_ALIASES[word] || word).join(' ').trim()
}

function stems(inn) {
  const text = String(inn || '').replace(PAREN, ' ').replace(STRENGTH, ' ')
  return text.split(/\s*[;/+|,]\s*/).map(normalizeIngredient).filter(token => token.length >= 5)
}

function massMg(value, unit) {
  const n = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(n)) return null
  const u = String(unit).toLowerCase().replace(/µg|μg|ug|microgam/g, 'mcg')
  if (u === 'g') return n * 1000
  return u === 'mcg' ? n / 1000 : n
}

/** Quantity-equivalent values: g/mg/mcg, IU/UI and % (w/v) are normalized. */
export function strengths(text) {
  const source = String(text || '')
  const found = new Set()
  let masked = source
  const ratioRe = new RegExp(RATIO.source, 'gi')
  let ratio
  while ((ratio = ratioRe.exec(source))) {
    const amount = massMg(ratio[1], ratio[2])
    const volume = Number(String(ratio[3] || '1').replace(',', '.'))
    if (amount != null && Number.isFinite(volume) && volume > 0) found.add(`${(amount / volume).toFixed(6)}|mg/ml`)
    masked = masked.replace(ratio[0], ' ')
  }
  const re = new RegExp(STRENGTH.source, 'gi')
  let m
  while ((m = re.exec(masked))) {
    const unit = m[2].toLowerCase()
    const value = Number(String(m[1]).replace(',', '.'))
    if (!Number.isFinite(value)) continue
    if (unit === '%') found.add(`${(value * 10).toFixed(6)}|mg/ml`)
    else if (unit === 'ml') found.add(`${value.toFixed(6)}|ml`)
    else if (unit === 'iu' || unit === 'ui') found.add(`${value.toFixed(6)}|iu`)
    else {
      const mg = massMg(m[1], unit)
      if (mg != null) found.add(`${mg.toFixed(6)}|mg`)
    }
  }
  return found
}

function present(stem, blob, tokens) {
  const parts = String(stem || '').split(' ').filter(Boolean)
  if (!parts.length) return false
  // Never use a substring comparison here. For example, "ofloxacin" is a
  // substring of "ciprofloxacin", but the active ingredients differ. The
  // folded token set remains order-insensitive for source strings such as
  // "hydrochloride, metformin".
  if (parts.every((part) => tokens.has(part))) return true
  if (parts.length !== 2) return false
  const [head, code] = parts
  return head === 'vitamin' && tokens.has('vitamin') && tokens.has(code) && VITAMIN_CODE.test(code)
}

export function formFamily(text) {
  const token = compact(text)
  if (!token) return ''
  if (token.includes('bao tan') || token.includes('enteric')) return 'vien bao tan o ruot'
  if (token.includes('giai phong') || token.includes('kiem soat') || /\b(?:retard|xr|er|sr|mr|cr)\b/.test(token)) return 'vien giai phong co kiem soat'
  if (token.includes('hoa tan nhanh') || token.includes('ra nhanh') || token.includes('phan tan')) return 'vien hoa tan nhanh'
  if (token.includes('suoi') || token.includes('efferv')) return 'vien sui'
  if (token.includes('bao duong')) return 'vien bao duong'
  if (token.includes('nang') || token.includes('capsule')) return 'vien nang'
  if (token.includes('bao phim')) return 'vien nen bao phim'
  if (token.includes('nen') || token.includes('tablet')) return 'vien nen'
  if (token.includes('dung dich') && token.includes('tiem')) return 'dung dich tiem'
  if (token.includes('hon dich') && token.includes('tiem')) return 'hon dich tiem'
  if (token.includes('nhu tuong') && token.includes('tiem')) return 'nhu tuong tiem'
  if (token.includes('bot') && token.includes('tiem')) return 'bot pha tiem'
  if (token.includes('tiem')) return 'thuoc tiem'
  if (token.includes('bot') && token.includes('uong')) return 'bot pha uong'
  if (token.includes('com') && token.includes('uong')) return 'com pha uong'
  if (token.includes('hon dich') && token.includes('uong')) return 'hon dich uong'
  if (token.includes('dung dich') && token.includes('uong')) return 'dung dich uong'
  if (token.includes('thuoc mo')) return 'thuoc mo'
  if (token.includes('kem') && (token.includes('boi') || token.includes('da'))) return 'kem boi da'
  if (token.includes('gel') && (token.includes('boi') || token.includes('da'))) return 'gel boi da'
  if (token.includes('nhu tuong') && (token.includes('boi') || token.includes('da'))) return 'nhu tuong boi'
  if (token.includes('dung ngoai')) return 'thuoc dung ngoai'
  if (token.includes('boi') && token.includes('da')) return 'thuoc boi da'
  if (token.includes('vien')) return 'vien'
  return ''
}

export function routeFamily(text) {
  const token = compact(text)
  if (!token) return ''
  if (token.includes('tiem truyen')) return 'tiem truyen'
  if (token.includes('tiem')) return 'tiem'
  if (token.includes('uong')) return 'uong'
  if (token.includes('nho mat')) return 'nho mat'
  if (token.includes('dung ngoai') || token.includes('boi da')) return 'dung ngoai'
  if (token.includes('dat am dao')) return 'dat am dao'
  if (token.includes('dat truc trang')) return 'dat truc trang'
  return ''
}

function groupOk(lotGroup, catalogGroup) {
  const digit = value => (fold(value).match(/([1-5])/) || [])[1] || ''
  const left = digit(lotGroup)
  const right = digit(catalogGroup)
  return !(left && right) || left === right
}

function formEligible(target, candidate) {
  if (!target || !candidate) return { value: null, legal: false }
  if (target === candidate) return { value: true, legal: false }
  if ((DOSAGE_FORM_RULES[target] || []).includes(candidate)) return { value: true, legal: true }
  // Appendix I has specific clauses for these forms.  Do not make a green
  // automatic match from a generic line; retain it for HSMT/KHLCNT review.
  if (SPECIAL_RELEASE_FORMS.includes(target) || SPECIAL_RELEASE_FORMS.includes(candidate)) return { value: null, legal: true }
  return { value: false, legal: false }
}

function lotData(lot) {
  const blob = normalizeIngredient(`${lot.tenHoatChat || ''} ${lot.lotName || ''} ${lot.nongDo || ''}`)
  return { blob, form: formFamily(lot.dangBaoChe || ''), route: routeFamily(lot.duongDung || lot.route || ''), strength: strengths(`${lot.nongDo || ''} ${lot.lotName || ''}`), tokens: new Set(blob.match(/[a-z0-9]+/g) || []) }
}

function catalogRows(items) {
  return (items || []).map(item => ({
    stems: stems(item.inn || item.hoatChat || ''),
    form: formFamily(item.dosage_form || item.form || ''),
    route: routeFamily(item.route || ''),
    strength: strengths(`${item.strength || ''} ${item.inn || ''}`),
    group: String(item.tender_group || item.group || ''),
    card: { brand: item.brand_name || item.brand || '', inn: item.inn || item.hoatChat || '', strength: item.strength || '', form: item.dosage_form || item.form || '', route: item.route || '', reg: item.reg_number || item.reg || '' },
  })).filter(row => row.stems.length)
}

function sameSet(left, right) {
  return Boolean(left.size && right.size) && left.size === right.size && [...left].every(value => right.has(value))
}

/**
 * MATCH = legally eligible with all supplied mandatory criteria.
 * POTENTIAL = related ingredient but an essential HSMT field is missing.
 * MISMATCH = a supplied route, strength, dosage form, or group conflicts.
 * `level: exact` remains for legacy UI and always means status MATCH.
 */
export function classifyLot(lot, catalogItems) {
  const source = lotData(lot || {})
  const matches = []
  const potentials = []
  const mismatches = []
  for (const item of catalogRows(catalogItems)) {
    if (!present(item.stems[0], source.blob, source.tokens)) continue
    const ingredient = item.stems.every(stem => present(stem, source.blob, source.tokens))
    if (!ingredient) continue
    const strength = source.strength.size && item.strength.size ? sameSet(source.strength, item.strength) : null
    const route = source.route && item.route ? source.route === item.route : null
    const form = formEligible(source.form, item.form)
    const group = groupOk(lot?.groupMedicine || lot?.group || '', item.group)
    const criteria = { ingredient, strength, route, dosageForm: form.value, group }
    // Route and tender group are hard stops. A supplied strength or dosage
    // form difference must never be green, but remains a yellow candidate for
    // HSMT review; otherwise the dashboard silently loses every "gần khớp"
    // row whenever the source provides a more specific presentation.
    const hardConflict = route === false || !group
    const softConflict = strength === false || form.value === false
    const complete = strength !== null && route !== null && form.value !== null
    const row = { item, criteria, legalForm: form.legal, complete }
    if (!hardConflict && !softConflict && complete) matches.push(row)
    else if (!hardConflict) potentials.push(row)
    else mismatches.push(row)
  }
  const evidenceScore = (row) => (
    Number(row.criteria.strength === true) * 4
    + Number(row.criteria.dosageForm === true) * 3
    + Number(row.criteria.route === true) * 2
    + Number(row.criteria.group === true)
  )
  // A review candidate with matching strength/form must lead the popup over
  // an alphabetically earlier product that merely shares the INN.
  const rank = (a, b) => (
    Number(b.legalForm) - Number(a.legalForm)
    || evidenceScore(b) - evidenceScore(a)
    || String(a.item.card.brand).localeCompare(String(b.item.card.brand), 'vi')
  )
  matches.sort(rank)
  potentials.sort(rank)
  if (matches.length) {
    const best = matches[0]
    return { status: 'MATCH', level: 'exact', formCompatible: best.legalForm, matchedCriteria: best.criteria, legalBasis: best.legalForm ? LEGAL_BASIS : '', hits: matches.slice(0, 6).map(row => row.item.card) }
  }
  if (potentials.length) {
    const best = potentials[0]
    return { status: 'POTENTIAL', level: 'near', formCompatible: best.legalForm, matchedCriteria: best.criteria, legalBasis: best.legalForm ? LEGAL_BASIS : '', hits: potentials.slice(0, 4).map(row => row.item.card) }
  }
  mismatches.sort(rank)
  const best = mismatches[0]
  return { status: 'MISMATCH', level: null, formCompatible: false, matchedCriteria: best?.criteria || { ingredient: false, strength: null, route: null, dosageForm: null, group: null }, legalBasis: '', hits: [] }
}
