/** Browser adapter for the shared tender-eligibility engine. */
import { classifyLot } from '../../lib/regulatory/baoanMatch.js'

export function isExactBaoanMatch(row) {
  const status = String(row?.status ?? row?.baoanStatus ?? '').trim().toUpperCase()
  if (status) return status === 'MATCH'
  return String(row?.baoanMatch ?? row?.baoan_match ?? row?.match ?? '').trim().toLowerCase() === 'exact'
}

/**
 * Only return a green catalog hit when this row carries enough tender facts
 * for the shared engine to establish eligibility.  An ingredient name alone
 * is deliberately not presented as a legal match.
 */
export function baoanLinesForIngredient(row, catalog, limit = 8) {
  const source = typeof row === 'string'
    ? { name: row, strength: row, form: row, route: row }
    : (row || {})
  const lot = {
    tenHoatChat: source.name || source.ingredient || source.hoatChat || '',
    lotName: source.name || source.ingredient || '',
    nongDo: source.strength || source.hamLuong || '',
    dangBaoChe: source.form || source.dosage_form || source.dangBaoChe || '',
    duongDung: source.route || source.duongDung || '',
    groupMedicine: source.group || source.group_name || '',
  }
  // Classify one catalog item at a time. The aggregate matcher correctly
  // chooses a best status, but its review-hit list can also contain a weaker
  // product with the same INN. A compact map preview may only display the
  // individual items that themselves satisfy form + strength evidence.
  const hits = []
  for (const item of catalog || []) {
    const result = classifyLot(lot, [item])
    const enoughForSuggestion = result.matchedCriteria?.strength === true
      && result.matchedCriteria?.dosageForm === true
    if (result.status === 'MATCH' || (result.status === 'POTENTIAL' && enoughForSuggestion)) {
      hits.push(...result.hits)
    }
  }
  // In the map's compact ingredient preview, a POTENTIAL row is useful only
  // when its name carried both form and strength; a bare INN is not a match.
  return hits.slice(0, limit)
}
