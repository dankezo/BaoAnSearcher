/** Folded hoạt chất match against the Bảo An catalog. One catalog load, no DAV scan. */

const STRENGTH = /(\d+(?:[.,]\d+)?)\s*(mg|mcg|microgam|µg|μg|ug|g|ml|iu|%)/gi
const VITAMIN_CODE = /^(?:b\d{1,2}|d\d?|k\d?|[ace])$/

function fold(text) {
  const s = String(text ?? '').toLowerCase().replace(/đ/g, 'd')
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function ingredientStems(inn) {
  const text = String(inn || '').replace(/\([^)]*\)/g, ' ').replace(STRENGTH, ' ')
  const stems = []
  for (const part of text.split(/\s*[;/+|,]\s*/)) {
    const token = fold(part).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (token.length >= 5) stems.push(token)
  }
  return stems
}

function present(stem, blob, tokens) {
  if (blob.includes(stem)) return true
  const split = stem.indexOf(' ')
  if (split < 0) return false
  const head = stem.slice(0, split)
  const code = stem.slice(split + 1)
  return head === 'vitamin' && tokens.has('vitamin') && tokens.has(code) && VITAMIN_CODE.test(code)
}

export function isExactBaoanMatch(row) {
  const level = String(row?.baoanMatch ?? row?.baoan_match ?? row?.match ?? '').trim().toLowerCase()
  return level === 'exact'
}

/** Exact khớp danh mục (hoạt chất + dạng + hàm lượng), cùng quy tắc MSC gói thầu. */
export function baoanLinesForIngredient(name, catalog, limit = 8) {
  const label = String(name || '').trim()
  if (!label || !catalog?.length) return []
  const lot = {
    tenHoatChat: label,
    lotName: label,
    nongDo: label,
    dangBaoChe: label,
  }
  return classifyLotExact(lot, catalog).slice(0, limit)
}

function normalizeForm(text) {
  const token = fold(text).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!token) return ''
  if (token.includes('bao phim')) return 'vien nen bao phim'
  if (token.includes('nen')) return 'vien nen'
  if (token.includes('suoi')) return 'vien sui'
  if (token.includes('nang')) return 'vien nang'
  return token
}

function strengthSet(text) {
  const found = new Set()
  const re = new RegExp(STRENGTH.source, 'gi')
  let m
  while ((m = re.exec(String(text || '')))) {
    let unit = m[2].toLowerCase().replace(/µg|μg/g, 'mcg').replace(/ug/g, 'mcg')
    let value = Number(String(m[1]).replace(',', '.'))
    if (Number.isNaN(value)) continue
    if (unit === 'mcg') {
      value /= 1000
      unit = 'mg'
    }
    found.add(`${value.toFixed(6)}|${unit}`)
  }
  return found
}

function classifyLotExact(lot, catalog) {
  const blob = fold(`${lot.tenHoatChat || ''} ${lot.lotName || ''} ${lot.nongDo || ''}`)
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const tokens = new Set(blob.match(/[a-z0-9]+/g) || [])
  const form = normalizeForm(lot.dangBaoChe || '')
  const strength = strengthSet(`${lot.nongDo || ''} ${lot.lotName || ''}`)
  const hits = []
  for (const item of catalog || []) {
    const stems = item.stems || ingredientStems(item.inn || item.hoatChat || '')
    if (!stems.length || !present(stems[0], blob, tokens)) continue
    if (!stems.every((stem) => present(stem, blob, tokens))) continue
    const itemForm = normalizeForm(item.form || item.dosage_form || '')
    const itemStrength = strengthSet(`${item.strength || ''} ${item.inn || ''}`)
    if (!form || form !== itemForm) continue
    if (!strength.size || !itemStrength.size || strength.size !== itemStrength.size) continue
    if ([...strength].some(x => !itemStrength.has(x))) continue
    hits.push({
      brand: item.brand || item.brand_name || '',
      strength: item.strength || '',
      form: item.form || item.dosage_form || '',
      reg: item.reg || item.reg_number || '',
    })
  }
  hits.sort((a, b) => String(a.brand).localeCompare(String(b.brand), 'vi'))
  return hits
}
