import scopeRows from './scopeCache.json' with { type: 'json' }
import { classifyLot } from '../lib/regulatory/baoanMatch.js'
import { baoanProducts } from './baoanCatalog.js'
import { groupDigit } from './metricsRollup.js'
import { fold } from './turso.js'

const NOTIFY = /notifyId=([0-9a-f-]{36})/i
let cloudScopes = []
let cloudScopesUntil = 0
let cloudScopesRequest = null

export async function refreshCloudScopes(db) {
  if (db?.dialect !== 'tidb' || Date.now() < cloudScopesUntil) return
  if (!cloudScopesRequest) {
    cloudScopesRequest = db.query('SELECT notify_id, tender_no, lots FROM msc_scope_lots').then((result) => {
      cloudScopes = (result.rows || []).map((row) => ({ id: row.notify_id, tender_no: row.tender_no, lots: typeof row.lots === 'string' ? JSON.parse(row.lots) : row.lots }))
      cloudScopesUntil = Date.now() + 60_000
    }).finally(() => { cloudScopesRequest = null })
  }
  await cloudScopesRequest
}

function rows() {
  const merged = new Map((Array.isArray(scopeRows) ? scopeRows : []).map((row) => [row.id || row.tender_no, row]))
  for (const row of cloudScopes) merged.set(row.id || row.tender_no, row)
  return [...merged.values()]
}

export function notifyId(item) {
  const url = String(item?.source_url || '')
  const found = url.match(NOTIFY)
  if (found) return found[1]
  const raw = String(item?.source_id || '')
  if (/^[0-9a-f-]{36}$/i.test(raw)) return raw
  return ''
}

function index() {
  const byId = new Map()
  const byNo = new Map()
  for (const row of rows()) {
    if (row.id) byId.set(String(row.id), row)
    if (row.tender_no) byNo.set(String(row.tender_no), row)
  }
  return { byId, byNo }
}

/** Tender numbers whose cached scope lines match an ingredient and/or nhóm 1–5. */
export function matchingTenderNos({ needle = '', groups = null } = {}) {
  const want = fold(needle).trim()
  const groupNeed = groups && groups.size ? groups : null
  if (!want && !groupNeed) return null
  const hits = new Set()
  for (const row of rows()) {
    const lots = row.lots || []
    const ok = lots.some((lot) => {
      const ingredientOk = !want || fold(`${lot.tenHoatChat || ''} ${lot.lotName || ''}`).includes(want)
      const groupOk = !groupNeed || groupNeed.has(groupDigit(lot.groupMedicine || lot.group || ''))
      return ingredientOk && groupOk
    })
    if (ok && row.tender_no) hits.add(String(row.tender_no))
  }
  return hits
}

export function scopeFor(item) {
  const { byId, byNo } = index()
  return byId.get(notifyId(item)) || byNo.get(String(item?.tender_no || '')) || null
}

export function publicLines(lots, catalog = baoanProducts()) {
  const lines = []
  for (const lot of lots || []) {
    if (!lot || typeof lot !== 'object') continue
    const classified = classifyLot(lot, catalog)
    lines.push({
      code: lot.medicineCode || '',
      name: lot.tenHoatChat || lot.lotName || '',
      strength: lot.nongDo || '',
      form: lot.dangBaoChe || '',
      route: lot.duongDung || '',
      qty: lot.quantity,
      unit: lot.uom || '',
      price: lot.pricePlan,
      group: lot.groupMedicine || lot.group || '',
      match: classified.level || '',
      status: classified.status,
      formCompatible: Boolean(classified.formCompatible),
      matchedCriteria: classified.matchedCriteria,
      legalBasis: classified.legalBasis || '',
      hits: classified.hits || [],
    })
  }
  return lines
}

/**
 * A cached tender-level label is only a crawl-time hint.  The catalogue can
 * change after the crawl, so every consumer must derive the displayed label
 * from the same line results it shows to the user.  One exact line wins;
 * otherwise a near line makes the package near.
 */
export function packageMatchFromLines(lines) {
  if ((lines || []).some((line) => line?.match === 'exact')) return 'exact'
  if ((lines || []).some((line) => line?.match === 'near')) return 'near'
  return ''
}

export function attachScope(items) {
  const catalog = baoanProducts()
  for (const item of items || []) {
    const row = scopeFor(item)
    const lots = row?.lots || []
    const lines = lots.length ? publicLines(lots, catalog) : []
    // Do not use row.match here: it was written when the tender was crawled
    // and can disagree with the per-line result after catalog updates.
    item.baoan_match = packageMatchFromLines(lines)
    if (lots.length) item.scope_lines = lines
    if (lots.length) {
      item.ingredient = [...new Set(lots.map((lot) => lot.tenHoatChat || lot.lotName || '').filter(Boolean))].join('; ')
      item.dosage_form = [...new Set(lots.map((lot) => lot.dangBaoChe || '').filter(Boolean))].join('; ')
    }
  }
  return items
}

function lotMatches(lot, ingredient, form) {
  const blob = fold(`${lot.tenHoatChat || ''} ${lot.lotName || ''}`)
  const formBlob = fold(lot.dangBaoChe || '')
  const words = ingredient.split(/\s+/).filter(Boolean)
  const forms = form.split(/\s+/).filter(Boolean)
  return words.every((word) => blob.includes(word)) && forms.every((word) => formBlob.includes(word))
}

export function scopeTenderNos(filters = {}) {
  const ingredient = fold(filters.ingredient || '').trim()
  const form = fold(filters.dosage_form || '').trim()
  const quick = String(filters.metricQuick || '')
  const level = quick === 'match_exact' ? 'exact' : quick === 'match_near' ? 'near' : ''
  if (!ingredient && !form && !level) return null
  const nos = []
  for (const row of rows()) {
    if ((ingredient || form) && !(row.lots || []).some((lot) => lotMatches(lot, ingredient, form))) continue
    const lines = publicLines(row.lots || [])
    if (level && packageMatchFromLines(lines) !== level) continue
    if (row.tender_no) nos.push(String(row.tender_no))
  }
  return [...new Set(nos)]
}

function priceOf(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function closeIso(raw) {
  const text = String(raw || '')
  const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}:\d{2}))?/)
  if (!match) return ''
  return match[2] ? `${match[1]}T${match[2]}` : match[1]
}

export function matchRows(items, level) {
  const wanted = level === 'exact' || level === 'near' ? level : 'all'
  const rowsOut = []
  for (const item of items || []) {
    const packageLevel = item.baoan_match || ''
    for (const line of item.scope_lines || publicLines(scopeFor(item)?.lots || [])) {
      const hitLevel = line.match || ''
      if (wanted === 'exact' && hitLevel !== 'exact') continue
      if (wanted === 'near' && !(hitLevel === 'near' && packageLevel === 'near')) continue
      if (wanted === 'all' && hitLevel !== 'exact' && hitLevel !== 'near') continue
      const hits = line.hits?.length ? line.hits : [{}]
      for (const hit of hits) {
        rowsOut.push({
          tenderNo: item.tender_no || '',
          name: item.name || '',
          buyer: item.buyer || '',
          province: item.province || '',
          innMt: line.name || '',
          strengthMt: line.strength || '',
          formMt: line.form || '',
          routeMt: line.route || '',
          unit: line.unit || '',
          price: priceOf(line.price),
          inn: hit.inn || '',
          brand: hit.brand || '',
          strength: hit.strength || '',
          form: hit.form || '',
          sdkDensity: null,
          closeDate: closeIso(item.close_date),
          link: /^https?:\/\//i.test(item.source_url || '') ? item.source_url : '',
          match: hitLevel,
        })
      }
    }
  }
  rowsOut.forEach((row, index) => { row.stt = index + 1 })
  return rowsOut
}
