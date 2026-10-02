/** Same tender-line rules as server/baoan_match.py (INN + dạng + hàm lượng). */

const STRENGTH = /(\d+(?:[.,]\d+)?)\s*(mg|mcg|microgam|µg|μg|ug|g|ml|iu|%)/gi
const PAREN = /\([^)]*\)/g
const VITAMIN_CODE = /^(?:b\d{1,2}|d\d?|k\d?|[ace])$/

function fold(text) {
  return String(text ?? '').toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function stems(inn) {
  const text = String(inn || '').replace(PAREN, ' ').replace(STRENGTH, ' ')
  const out = []
  for (const part of text.split(/\s*[;/+|,]\s*/)) {
    const token = fold(part).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (token.length >= 5) out.push(token)
  }
  return out
}

function strengths(text) {
  const found = new Set()
  const re = new RegExp(STRENGTH.source, 'gi')
  let m
  while ((m = re.exec(String(text || '')))) {
    let unit = m[2].toLowerCase().replace(/µg|μg/g, 'mcg').replace(/ug/g, 'mcg').replace(/microgam/g, 'mcg')
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

function present(stem, blob, tokens) {
  if (blob.includes(stem)) return true
  const split = stem.indexOf(' ')
  if (split < 0) return false
  const head = stem.slice(0, split)
  const code = stem.slice(split + 1)
  return head === 'vitamin' && tokens.has('vitamin') && tokens.has(code) && VITAMIN_CODE.test(code)
}

function family(text) {
  const token = fold(text).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!token) return ''
  if (token.includes('bao phim')) return 'vien nen bao phim'
  if (token.includes('nen') || token.includes('tablet')) return 'vien nen'
  if (token.includes('suoi') || token.includes('efferv')) return 'vien sui'
  if (token.includes('nang') || token.includes('capsule')) return 'vien nang'
  return token
}

function tenderGroup(text) {
  const m = fold(text).match(/([1-5])/)
  return m ? m[1] : ''
}

function groupOk(lotGroup, catalogGroup) {
  const lotG = tenderGroup(lotGroup)
  const catG = tenderGroup(catalogGroup)
  if (lotG && catG) return lotG === catG
  return true
}

function lotBlob(lot) {
  const blob = fold(`${lot.tenHoatChat || ''} ${lot.lotName || ''} ${lot.nongDo || ''}`)
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const form = family(lot.dangBaoChe || '')
  const strength = strengths(`${lot.nongDo || ''} ${lot.lotName || ''}`)
  return { blob, form, strength, tokens: new Set(blob.match(/[a-z0-9]+/g) || []) }
}

function catalogRows(items) {
  return (items || []).map(item => ({
    stems: stems(item.inn || item.hoatChat || ''),
    form: family(item.dosage_form || item.form || ''),
    strength: strengths(`${item.strength || ''} ${item.inn || ''}`),
    group: String(item.tender_group || item.group || ''),
    card: {
      brand: item.brand_name || item.brand || '',
      strength: item.strength || '',
      form: item.dosage_form || item.form || '',
      reg: item.reg_number || item.reg || '',
    },
  })).filter(row => row.stems.length)
}

export function classifyLot(lot, catalogItems) {
  const { blob, form, strength, tokens } = lotBlob(lot || {})
  const exact = []
  const near = []
  for (const item of catalogRows(catalogItems)) {
    if (!present(item.stems[0], blob, tokens)) continue
    const allInns = item.stems.every(stem => present(stem, blob, tokens))
    const formOk = Boolean(form) && form === item.form
    const strengthOk = Boolean(strength.size) && Boolean(item.strength.size)
      && strength.size === item.strength.size
      && [...strength].every(x => item.strength.has(x))
    const groupOkFlag = groupOk(lot.groupMedicine || lot.group || '', item.group)
    if (allInns && formOk && strengthOk && groupOkFlag) {
      exact.push(item.card)
      continue
    }
    const overlap = [...strength].filter(x => item.strength.has(x)).length
    near.push([allInns, formOk, overlap, item.card])
  }
  if (exact.length) return { level: 'exact', hits: exact.slice(0, 6) }
  if (near.length) {
    near.sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]) || (b[2] - a[2]))
    return { level: 'near', hits: near.slice(0, 4).map(row => row[3]) }
  }
  return { level: null, hits: [] }
}
