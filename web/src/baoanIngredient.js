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
  const result = classifyLot({
    tenHoatChat: source.name || source.ingredient || source.hoatChat || '',
    lotName: source.name || source.ingredient || '',
    nongDo: source.strength || source.hamLuong || '',
    dangBaoChe: source.form || source.dosage_form || source.dangBaoChe || '',
    duongDung: source.route || source.duongDung || '',
    groupMedicine: source.group || source.group_name || '',
  }, catalog)
  // In the map's compact ingredient preview, a POTENTIAL row is useful only
  // when its name carried both form and strength; a bare INN is not a match.
  const enoughForSuggestion = result.matchedCriteria?.strength === true
    && result.matchedCriteria?.dosageForm === true
  return result.status === 'MATCH' || (result.status === 'POTENTIAL' && enoughForSuggestion)
    ? result.hits.slice(0, limit)
    : []
}
