import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fold } from './domain.js'
import { classifyLot } from './baoanMatch.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const CATALOG_PATH = join(ROOT, 'data', 'baoan_products.json')

let _items = null

function catalogItems() {
  if (!_items) {
    try {
      _items = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'))
    } catch {
      _items = []
    }
  }
  return _items
}

function regKeys(reg) {
  const raw = fold(String(reg || '')).replace(/[^a-z0-9]/g, '')
  const digits = String(reg || '').replace(/\D/g, '')
  const keys = [raw, digits]
  if (digits.length >= 8) {
    keys.push(digits.replace(/^893/, ''), digits.replace(/^0+/, ''))
  }
  return keys.filter((k, i, a) => k && k.length >= 6 && a.indexOf(k) === i)
}

/** Exact danh mục Bảo An mentioned in public text (SĐK or cùng quy tắc khớp dòng thầu). */
export function catalogTouch(title = '', summary = '') {
  const blob = fold(`${title} ${summary}`)
  const blobDigits = blob.replace(/[^a-z0-9]/g, '')
  const exact = []
  const seen = new Set()
  for (const item of catalogItems()) {
    const reg = String(item.reg_number || '').trim()
    const keys = regKeys(reg)
    if (keys.some(key => key.length >= 8 && blobDigits.includes(key.replace(/[^a-z0-9]/g, '')))) {
      const hit = { brand: item.brand_name || '', reg, strength: item.strength || '', form: item.dosage_form || '' }
      const id = reg || hit.brand
      if (id && !seen.has(id)) {
        seen.add(id)
        exact.push(hit)
      }
    }
  }
  for (const chunk of `${title} ${summary}`.split(/[;\n|]/)) {
    const lot = {
      tenHoatChat: chunk.trim(),
      lotName: chunk.trim(),
      nongDo: chunk.trim(),
      dangBaoChe: chunk.trim(),
    }
    const { status, hits } = classifyLot(lot, catalogItems())
    if (status !== 'MATCH') continue
    for (const hit of hits) {
      const id = hit.reg || hit.brand
      if (id && !seen.has(id)) {
        seen.add(id)
        exact.push(hit)
      }
    }
  }
  return { exact, innOnly: [] }
}

export function attachCatalogTouch(item) {
  const touch = catalogTouch(item.title, item.summary)
  return { ...item, catalog_touch: touch }
}
