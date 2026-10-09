import { fold } from '../../../lib/regulatory/domain.js'

export function sourceBadge(item) {
  const blob = `${item?.source_url || ''} ${item?.source_name || ''} ${item?.category || ''}`
  const text = fold(blob)
  if (text.includes('dav.gov') || text.includes('cuc quan ly duoc')) return 'DAV'
  if (text.includes('muasamcong') || text.includes(' msc')) return 'MSC'
  if (/\bbhyt\b|bao hiem|vss/.test(text)) return 'BHYT'
  if (text.includes('moh.gov') || text.includes('bo y te')) return 'BYT'
  return 'TIN'
}

export function natureOf(item) {
  const text = fold(`${item?.title || ''} ${item?.summary || ''} ${item?.insight?.impact || ''}`)
  if (/thu hoi|dinh chi|cam nhap|xu phat|rui ro/.test(text)) return 'RISK_TRAP'
  if (/dau thau|danh muc|cong bo|gia han|cap moi/.test(text)) return 'OPPORTUNITY'
  return 'NEUTRAL'
}

export function splitBrief(items = []) {
  const ranked = [...items].sort((a, b) => (b.attention_score ?? b.insight?.priority ?? 0) - (a.attention_score ?? a.insight?.priority ?? 0))
  const critical = ranked.filter(item => (item.attention_score ?? item.insight?.priority ?? 0) >= 80).slice(0, 4)
  const ids = new Set(critical.map(item => item.id))
  return { critical, secondary: ranked.filter(item => !ids.has(item.id)) }
}
